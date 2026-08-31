// @input  -- authenticated POST containing only an owned KB id
// @output -- persisted enrichment evidence for review, never an implicit draft write
// @pos    -- identity → owner read → bounded sources → immutable receipt

import { z } from "zod";
import { latestFinalWindow } from "@sf/public-tools/gsc-analytics";
import type { WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import type { GscGateResult } from "../tools/gsc-gate.ts";
import type { GeoKbPayload, GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { GEO_KB_ENRICHMENT_LIMITS, GEO_KB_ENRICHMENT_SCHEMA, type GeoGscEnrichment, type GeoKbEnrichmentReport } from "./kb-enrichment-contract.ts";
import { clusterGeoQueries, extractCompetitorIdentity, finalizeGeoEnrichmentReport, inspectGeoFact, selectGeoGscProperty, type GeoEnrichmentPage } from "./kb-enrichment.ts";

export interface GeoEnrichmentAsset {
  readonly kbId: string;
  readonly targetHost: string;
  readonly draftVersion: number;
  readonly payload: GeoKbPayload;
  readonly profileReference: WebsiteProfileReferenceV1 | null;
}
export interface GeoKbEnrichmentDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readIdentity: () => Promise<{ readonly sub: string } | null>;
  readonly readAsset: (input: { readonly userId: string; readonly kbId: string }) => Promise<{ readonly kind: "ok"; readonly value: GeoEnrichmentAsset } | { readonly kind: "missing" | "unavailable" | "no_draft" }>;
  readonly readGscSession: () => Promise<{ readonly properties: readonly string[] | null }>;
  readonly openGscGate: (clientIp: string) => Promise<GscGateResult>;
  readonly resolveGrant: () => Promise<GrantResolution>;
  readonly readQueries: (input: { readonly property: string; readonly accessToken: string; readonly window: { readonly startDate: string; readonly endDate: string } }) => Promise<{ readonly queries: readonly string[]; readonly truncated: boolean }>;
  readonly fetchPage: (url: string, clientIp: string, timeoutMs: number) => Promise<GeoEnrichmentPage>;
  /** Null means the receipt store is not wired: refuse before any private/source read. */
  readonly persistReceipt: ((input: { readonly userId: string; readonly report: GeoKbEnrichmentReport }) => Promise<{ readonly kind: "ok" | "unavailable" }>) | null;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly clientIp: (request: Request) => string;
}

/** Missing GSC is optional; a present, different subject is a security refusal. */
export function geoEnrichmentIdentity(googleSubject: string | null | undefined, identity: { readonly sub: string } | null): "matched" | "not_connected" | "mismatch" {
  if (identity === null) return "not_connected";
  return googleSubject !== undefined && googleSubject !== null && googleSubject !== "" && googleSubject === identity.sub ? "matched" : "mismatch";
}
const requestSchema = z.object({ kbId: z.string().uuid() }).strict();

async function readGsc(dependencies: GeoKbEnrichmentDependencies, targetHost: string, clientIp: string, connected: boolean): Promise<GeoGscEnrichment> {
  const window = latestFinalWindow(dependencies.now(), { lengthDays: 90 });
  const unavailable = (reason: Extract<GeoGscEnrichment, { status: "unavailable" }>["reason"], property: string | null = null): GeoGscEnrichment => ({
    status: "unavailable", reason, property, window, queryCount: null, truncated: null, observedAt: null, roles: [],
  });
  if (!connected) return unavailable("not_connected");
  let release: (() => void) | null = null;
  try {
    const session = await dependencies.readGscSession();
    if (session.properties === null) return unavailable("not_connected");
    const property = selectGeoGscProperty(targetHost, session.properties);
    if (property === null) return unavailable("property_not_granted");
    const gate = await dependencies.openGscGate(clientIp);
    if (!gate.ok) return unavailable("rate_limited", property);
    release = gate.release;
    const grant = await dependencies.resolveGrant();
    if (grant.kind !== "grant") return unavailable("grant_unavailable", property);
    if (!grant.properties.includes(property)) return unavailable("property_not_granted", property);
    const read = await dependencies.readQueries({ property, accessToken: grant.accessToken, window });
    if (read.queries.length > GEO_KB_ENRICHMENT_LIMITS.queryRows || typeof read.truncated !== "boolean" ||
        read.queries.some((query) => typeof query !== "string" || query.trim() === "" || query.length > 512)) return unavailable("invalid_response", property);
    const queries = [...new Set(read.queries)];
    return { status: "available", reason: null, property, window, queryCount: queries.length,
      truncated: read.truncated, observedAt: dependencies.now().toISOString(), roles: clusterGeoQueries(queries) };
  } catch {
    return unavailable("fetch_failed");
  } finally { release?.(); }
}

export async function handleGeoKbEnrichment(request: Request, dependencies: GeoKbEnrichmentDependencies): Promise<Response> {
  const authentication = await dependencies.authenticate().catch(() => ({ status: "unavailable" as const }));
  if (authentication.status !== "authenticated") return privateError(authentication.status === "unauthenticated" ? "auth_required" : "auth_unavailable", authentication.status === "unauthenticated" ? 401 : 503);
  const body = await readAccountMutationJson(request, 1_024);
  if (!body.ok) return body.response;
  const input = requestSchema.safeParse(body.value);
  if (!input.success) return privateError("invalid_request", 400);
  let connection: ReturnType<typeof geoEnrichmentIdentity>;
  try { connection = geoEnrichmentIdentity(authentication.googleSubject, await dependencies.readIdentity()); }
  catch { return privateError("auth_unavailable", 503); }
  if (connection === "mismatch") return privateError("gsc_identity_mismatch", 401);
  if (dependencies.persistReceipt === null) return privateError("store_unavailable", 503);
  const loaded = await dependencies.readAsset({ userId: authentication.userId, kbId: input.data.kbId })
    .catch(() => ({ kind: "unavailable" as const }));
  if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : loaded.kind === "no_draft" ? "no_draft" : "store_unavailable", loaded.kind === "missing" ? 404 : loaded.kind === "no_draft" ? 409 : 503);
  const asset = loaded.value;
  if (asset.kbId !== input.data.kbId || normalizeAccountWebsiteUrl(asset.payload.targetUrl)?.host !== asset.targetHost) return privateError("store_unavailable", 503);
  const clientIp = dependencies.clientIp(request);
  const deadline = dependencies.now().getTime() + 70_000;
  const pages = new Map<string, Promise<GeoEnrichmentPage>>();
  const pageFor = (url: string): Promise<GeoEnrichmentPage> => {
    const remaining = deadline - dependencies.now().getTime();
    if (normalizeAccountWebsiteUrl(url) === null) return Promise.resolve({ kind: "unavailable", reason: "missing_url", url: null });
    if (remaining <= 0) return Promise.resolve({ kind: "unavailable", reason: "fetch_failed", url });
    const cached = pages.get(url);
    if (cached !== undefined) return cached;
    const page = dependencies.fetchPage(url, clientIp, Math.min(remaining, GEO_KB_ENRICHMENT_LIMITS.fetchMs))
      .catch((): GeoEnrichmentPage => ({ kind: "unavailable", reason: "fetch_failed", url }));
    pages.set(url, page);
    return page;
  };
  const gsc = await readGsc(dependencies, asset.targetHost, clientIp, connection === "matched");
  const competitors: GeoKbEnrichmentReport["competitors"] = [];
  for (const [index, competitor] of asset.payload.competitors.slice(0, GEO_KB_ENRICHMENT_LIMITS.competitors).entries()) {
    const page = competitor.domain === "" ? { kind: "unavailable" as const, reason: "missing_url" as const, url: null } : await pageFor(`https://${competitor.domain}/`);
    competitors.push(extractCompetitorIdentity(competitor.domain, page, `C${index + 1}`));
  }
  const facts: GeoKbEnrichmentReport["facts"] = [];
  for (const [index, fact] of asset.payload.facts.slice(0, GEO_KB_ENRICHMENT_LIMITS.facts).entries()) {
    facts.push(inspectGeoFact(fact, await pageFor(fact.sourceUrl), `F${index + 1}`));
  }
  const report = finalizeGeoEnrichmentReport({ schemaVersion: GEO_KB_ENRICHMENT_SCHEMA, receiptId: dependencies.newId(),
    kbId: asset.kbId, targetHost: asset.targetHost, draftVersion: asset.draftVersion,
    draftHash: geoKbDigest(asset.payload as unknown as GeoKbValue), profileReference: asset.profileReference,
    createdAt: dependencies.now().toISOString(), competitors, gsc, facts, skippedLayers: gsc.roles.length === 0 ? ["problem", "evaluation"] : [] });
  const stored = await dependencies.persistReceipt({ userId: authentication.userId, report }).catch(() => ({ kind: "unavailable" as const }));
  return stored.kind === "ok" ? privateJson({ data: report }) : privateError("store_unavailable", 503);
}
