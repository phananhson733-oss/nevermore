// @input  -- verified account, sealed Google session and SSRF-safe public transport
// @output -- actual bounded source adapters; receipt persistence deliberately injected
// @pos    -- the only enrichment runtime side-effect seam

import { randomUUID } from "node:crypto";
import { fetchPublicResource } from "@sf/sources/public-http";
import { createSearchAnalyticsClient, type SearchAnalyticsFetch } from "@sf/sources/gsc/search-analytics";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { extractClientIp } from "../rate-limit.ts";
import { openCrawlGate } from "../tools/crawl-gate.ts";
import { openGscGate } from "../tools/gsc-gate.ts";
import { readKeywordIdentity } from "../tools/keyword-workflow-handler.ts";
import { readTrafficDropSession, resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import { GEO_KB_ENRICHMENT_LIMITS } from "./kb-enrichment-contract.ts";
import type { GeoKbEnrichmentDependencies } from "./kb-enrichment-handler.ts";
import type { GeoEnrichmentPage } from "./kb-enrichment.ts";
import { readGeoKnowledgeBase } from "./kb-store.ts";
import { persistGeoEnrichmentReceipt } from "./asset-context-store.ts";

export function createGeoEnrichmentQueryReader(options: { readonly fetchImpl?: SearchAnalyticsFetch } = {}): GeoKbEnrichmentDependencies["readQueries"] {
  return async ({ property, accessToken, window }) => {
    const deadline = Date.now() + 20_000;
    const client = createSearchAnalyticsClient({ siteUrl: property, accessToken,
      requestTimeoutMs: 10_000, maxResponseBytes: 1_048_576,
      remainingMs: () => deadline - Date.now(), ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    const response = await client({ dimensions: ["query"], ...window, rowLimit: GEO_KB_ENRICHMENT_LIMITS.queryRows, startRow: 0, dataState: "final", aggregationType: "byProperty" });
    if (response.rows.length > GEO_KB_ENRICHMENT_LIMITS.queryRows || response.rows.some((row) => row.keys.length !== 1 || row.keys[0]?.trim() === "" || (row.keys[0]?.length ?? 0) > 512)) throw new Error("invalid query response");
    return { queries: response.rows.map((row) => row.keys[0]!), truncated: response.rows.length === GEO_KB_ENRICHMENT_LIMITS.queryRows };
  };
}

export function createGeoEnrichmentPageReader(options: {
  readonly fetchResource?: typeof fetchPublicResource;
  readonly openGate?: typeof openCrawlGate;
  readonly now?: () => Date;
} = {}): GeoKbEnrichmentDependencies["fetchPage"] {
  return async (url, clientIp, timeoutMs) => {
    const unavailable = (reason: Extract<GeoEnrichmentPage, { kind: "unavailable" }>["reason"]): GeoEnrichmentPage => ({ kind: "unavailable", reason, url });
    const gate = await (options.openGate ?? openCrawlGate)(clientIp, url);
    if (!gate.ok) return unavailable("rate_limited");
    try {
      const result = await (options.fetchResource ?? fetchPublicResource)(url, {
        timeoutMs: Math.min(timeoutMs, GEO_KB_ENRICHMENT_LIMITS.fetchMs),
        maxBodyBytes: GEO_KB_ENRICHMENT_LIMITS.pageBytes, maxRedirects: 2,
        allowRedirect: (from, to) => {
          const source = normalizeAccountWebsiteUrl(from);
          const destination = normalizeAccountWebsiteUrl(to);
          return source !== null && destination !== null && source.host === destination.host &&
            !(from.startsWith("https:") && to.startsWith("http:"));
        },
      });
      if (result.kind !== "ok") return unavailable("fetch_failed");
      if (result.finalStatus < 200 || result.finalStatus > 299) return unavailable("fetch_failed");
      if (!result.bodyComplete) return unavailable("partial_body");
      if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(result.contentType ?? "")) return unavailable("not_html");
      return { kind: "ok", url: result.finalUrl, body: result.body, observedAt: (options.now ?? (() => new Date()))().toISOString() };
    } catch { return unavailable("fetch_failed"); }
    finally { gate.release(); }
  };
}

export const DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES: GeoKbEnrichmentDependencies = {
  authenticate: getServerAuthenticatedUser,
  readIdentity: readKeywordIdentity,
  readAsset: async ({ userId, kbId }) => {
    const loaded = await readGeoKnowledgeBase({ userId, kbId });
    if (loaded.kind === "missing") return { kind: "missing" };
    if (loaded.kind !== "ok") return { kind: "unavailable" };
    if (loaded.value.draft === null) return { kind: "no_draft" };
    const site = normalizeAccountWebsiteUrl(loaded.value.origin);
    if (site === null) return { kind: "unavailable" };
    const profile = await findAccountWebsiteByUrl(userId, loaded.value.origin);
    if (profile.kind === "unavailable") return { kind: "unavailable" };
    return { kind: "ok", value: { kbId: loaded.value.kbId, targetHost: site.host,
      payload: loaded.value.draft.payload, draftVersion: loaded.value.draft.draftVersion,
      profileReference: profile.kind === "ok" ? profile.value.reference : null } };
  },
  readGscSession: readTrafficDropSession,
  openGscGate,
  resolveGrant: resolveTrafficDropGrant,
  readQueries: createGeoEnrichmentQueryReader(),
  fetchPage: createGeoEnrichmentPageReader(),
  persistReceipt: persistGeoEnrichmentReceipt,
  now: () => new Date(), newId: randomUUID,
  clientIp: (request) => extractClientIp(request.headers),
};
