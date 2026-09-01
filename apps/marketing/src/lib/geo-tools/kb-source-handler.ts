// @input -- authenticated same-origin source collection for an owned saved KB
// @output -- an immutable V2 receipt; no Persona or model generation
// @pos -- source admission, bounded transports and required persistence
import { z } from "zod";
import { latestFinalWindow } from "@sf/public-tools/gsc-analytics";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import type { AnyGeoKbPayload } from "./kb-v2-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { geoEnrichmentIdentity, type GeoKbEnrichmentDependencies, type GeoEnrichmentAsset } from "./kb-enrichment-handler.ts";
import { selectGeoGscProperty, type GeoEnrichmentPage } from "./kb-enrichment.ts";
import { GEO_KB_SOURCE_SCHEMA, GEO_KB_SOURCE_LIMITS, type GeoGscSourceV2, type GeoKbSourceBodyV2, type GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import { collectGeoQueryEvidenceV2, extractGeoCompetitorSourceV2, inspectGeoFactSourceV2, finalizeGeoKbSourceReportV2 } from "./kb-sources.ts";

export interface GeoKbSourceAsset extends Omit<GeoEnrichmentAsset, "payload"> { readonly payload: AnyGeoKbPayload }
export type GeoKbSourceDependencies = Omit<GeoKbEnrichmentDependencies, "persistReceipt" | "readAsset"> & {
  readonly readAsset: (input: { readonly userId: string; readonly kbId: string }) => Promise<{ readonly kind: "ok"; readonly value: GeoKbSourceAsset } | { readonly kind: "missing" | "unavailable" | "no_draft" }>;
  readonly persistReceipt: ((input: { readonly userId: string; readonly report: GeoKbSourceReportV2 }) => Promise<{ readonly kind: "ok" | "unavailable" }>) | null;
};
const requestSchema = z.object({ kbId: z.string().uuid() }).strict();
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function sourceMetadata(asset: GeoKbSourceAsset, dependencies: GeoKbSourceDependencies): Omit<GeoKbSourceBodyV2, "gsc" | "competitors" | "facts"> {
  if (!Number.isSafeInteger(asset.draftVersion) || asset.draftVersion < 1) throw new Error("Source collection requires a saved draft");
  if (asset.payload.profileCopy && canonicalGeoV2Text(profileCopyReference(asset.payload.profileCopy)) !== canonicalGeoV2Text(asset.profileReference)) throw new Error("Source Profile differs from saved copy");
  if (normalizeAccountWebsiteUrl(asset.payload.targetUrl)?.host !== asset.targetHost || !Array.isArray(asset.payload.competitors) || asset.payload.competitors.length > GEO_KB_SOURCE_LIMITS.competitors || !Array.isArray(asset.payload.facts) || asset.payload.facts.length > GEO_KB_SOURCE_LIMITS.facts) throw new Error("Invalid source asset");
  if (asset.payload.competitors.some((competitor) => !text(competitor.domain, 253) || competitor.domain !== "" && normalizeAccountWebsiteUrl(`https://${competitor.domain}`)?.host !== competitor.domain)) throw new Error("Invalid competitor scope");
  if (asset.payload.facts.some((fact) => !text(fact.key, 200) || fact.key.trim() === "" || !text(fact.value, 200) || !text(fact.sourceUrl, 2048))) throw new Error("Invalid fact input");
  return { schemaVersion: GEO_KB_SOURCE_SCHEMA, receiptId: dependencies.newId(), kbId: asset.kbId, targetHost: asset.targetHost,
    draftVersion: asset.draftVersion, draftHash: geoV2Digest(asset.payload), profileReference: asset.profileReference, createdAt: dependencies.now().toISOString() };
}

async function readGscSource(dependencies: GeoKbSourceDependencies, targetHost: string, clientIp: string, connected: boolean, window: GeoGscSourceV2["window"]): Promise<GeoGscSourceV2> {
  let property: string | null = null;
  const unavailable = (reason: Extract<GeoGscSourceV2, { status: "unavailable" }>["reason"]): GeoGscSourceV2 => ({
    status: "unavailable", reason, property, window, queryCount: null, truncated: null, observedAt: null, queries: [],
  });
  if (!connected) return unavailable("not_connected");
  let release: (() => void) | null = null;
  try {
    const session = await dependencies.readGscSession();
    if (session.properties === null) return unavailable("not_connected");
    property = selectGeoGscProperty(targetHost, session.properties);
    if (property === null) return unavailable("property_not_granted");
    const gate = await dependencies.openGscGate(clientIp);
    if (!gate.ok) return unavailable("rate_limited");
    release = gate.release;
    const grant = await dependencies.resolveGrant();
    if (grant.kind !== "grant") return unavailable("grant_unavailable");
    if (!grant.properties.includes(property)) return unavailable("property_not_granted");
    const read = await dependencies.readQueries({ property, accessToken: grant.accessToken, window });
    if (!Array.isArray(read.queries) || typeof read.truncated !== "boolean") return unavailable("invalid_response");
    let queries;
    try { queries = collectGeoQueryEvidenceV2(read.queries); } catch { return unavailable("invalid_response"); }
    return { status: "available", reason: null, property, window, queryCount: queries.length, truncated: read.truncated, observedAt: dependencies.now().toISOString(), queries: [...queries] };
  } catch { return unavailable("fetch_failed"); }
  finally { release?.(); }
}

export async function handleGeoKbSources(request: Request, dependencies: GeoKbSourceDependencies): Promise<Response> {
  const authentication = await dependencies.authenticate().catch(() => ({ status: "unavailable" as const }));
  if (authentication.status !== "authenticated") return privateError(authentication.status === "unauthenticated" ? "auth_required" : "auth_unavailable", authentication.status === "unauthenticated" ? 401 : 503);
  const body = await readAccountMutationJson(request, 1024);
  if (!body.ok) return body.response;
  const input = requestSchema.safeParse(body.value);
  if (!input.success) return privateError("invalid_request", 400);
  let connection: ReturnType<typeof geoEnrichmentIdentity>;
  try { connection = geoEnrichmentIdentity(authentication.googleSubject, await dependencies.readIdentity()); }
  catch { return privateError("auth_unavailable", 503); }
  if (connection === "mismatch") return privateError("gsc_identity_mismatch", 401);
  if (dependencies.persistReceipt === null) return privateError("store_unavailable", 503);
  const loaded = await dependencies.readAsset({ userId: authentication.userId, kbId: input.data.kbId }).catch(() => ({ kind: "unavailable" as const }));
  if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : loaded.kind === "no_draft" ? "no_draft" : "store_unavailable", loaded.kind === "missing" ? 404 : loaded.kind === "no_draft" ? 409 : 503);
  const asset = loaded.value;
  let metadata: ReturnType<typeof sourceMetadata>;
  let window: GeoGscSourceV2["window"];
  try {
    if (asset.kbId !== input.data.kbId) throw new Error("Mismatched source asset");
    metadata = sourceMetadata(asset, dependencies);
    window = latestFinalWindow(dependencies.now(), { lengthDays: 90 });
    // Validate all receipt metadata before any source gate or network dispatch.
    finalizeGeoKbSourceReportV2({ ...metadata, competitors: [], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window, queryCount: null, truncated: null, observedAt: null, queries: [] } });
  } catch { return privateError("store_unavailable", 503); }
  const clientIp = dependencies.clientIp(request), deadline = dependencies.now().getTime() + 70_000;
  const pages = new Map<string, Promise<GeoEnrichmentPage>>();
  const pageFor = (url: string): Promise<GeoEnrichmentPage> => {
    if (normalizeAccountWebsiteUrl(url) === null) return Promise.resolve({ kind: "unavailable", reason: "missing_url", url: null });
    const cached = pages.get(url);
    if (cached !== undefined) return cached;
    const remaining = deadline - dependencies.now().getTime();
    if (remaining <= 0) return Promise.resolve({ kind: "unavailable", reason: "fetch_failed", url });
    const page = dependencies.fetchPage(url, clientIp, Math.min(remaining, GEO_KB_SOURCE_LIMITS.fetchMs)).catch((): GeoEnrichmentPage => ({ kind: "unavailable", reason: "fetch_failed", url }));
    pages.set(url, page);
    return page;
  };
  try {
    const gsc = await readGscSource(dependencies, asset.targetHost, clientIp, connection === "matched", window);
    const competitors: GeoKbSourceReportV2["competitors"] = [];
    for (const [index, competitor] of asset.payload.competitors.entries()) {
      const page = competitor.domain === "" ? { kind: "unavailable" as const, reason: "missing_url" as const, url: null } : await pageFor(`https://${competitor.domain}/`);
      competitors.push(extractGeoCompetitorSourceV2(competitor.domain, page, `C${index + 1}`));
    }
    const facts: GeoKbSourceReportV2["facts"] = [];
    for (const [index, fact] of asset.payload.facts.entries()) {
      const page = fact.value.trim() === "" ? { kind: "unavailable" as const, reason: "missing_url" as const, url: null } : await pageFor(fact.sourceUrl);
      facts.push(inspectGeoFactSourceV2(fact, page, `F${index + 1}`));
    }
    const report = finalizeGeoKbSourceReportV2({ ...metadata, createdAt: dependencies.now().toISOString(), competitors, facts, gsc });
    const stored = await dependencies.persistReceipt({ userId: authentication.userId, report });
    return stored.kind === "ok" ? privateJson({ data: report }) : privateError("store_unavailable", 503);
  } catch { return privateError("store_unavailable", 503); }
}
