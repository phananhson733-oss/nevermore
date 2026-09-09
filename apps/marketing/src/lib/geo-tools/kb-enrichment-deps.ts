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
import { canonicalCrawlTargetKey } from "../tools/crawl-cache.ts";
import { openCrawlGate } from "../tools/crawl-gate.ts";
import { openGscGate } from "../tools/gsc-gate.ts";
import { readKeywordIdentity } from "../tools/keyword-workflow-handler.ts";
import { readTrafficDropSession, resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import { GEO_KB_ENRICHMENT_LIMITS } from "./kb-enrichment-contract.ts";
import type { GeoKbEnrichmentDependencies } from "./kb-enrichment-handler.ts";
import type { GeoEnrichmentPage } from "./kb-enrichment.ts";
import { GEO_KNOWLEDGE_EVIDENCE_LIMITS, type GeoKnowledgeEvidenceReadResource, type GeoKnowledgeResourceResult } from "./kb-knowledge-evidence.ts";
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

type GeoKnowledgeUnavailableReason = Extract<GeoKnowledgeResourceResult, { readonly kind: "unavailable" }>["reason"];

function knowledgeTransportReason(code: string): GeoKnowledgeUnavailableReason {
  if (code === "timeout") return "timeout";
  if (code === "blocked" || code === "cross_origin" || code === "invalid_redirect") return "blocked";
  return "fetch_failed";
}

function knowledgeHttpReason(status: number): GeoKnowledgeUnavailableReason | null {
  if (status === 206) return "partial_body";
  if (status >= 200 && status <= 299) return null;
  if (status === 404 || status === 410) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "rate_limited";
  return "fetch_failed";
}

/**
 * The one hop a knowledge collection may follow: the same site, still on https.
 *
 * "The same site" is the crawl gate's own answer, not a string comparison of
 * hosts. `canonicalCrawlTargetKey` strips a single `www.` label and nothing
 * else, and the gate has always budgeted an apex and that sibling together
 * precisely because "the crawler permits that one entry redirect". Comparing
 * raw hosts here contradicted that: a site registered at its apex that answers
 * on `www` had its homepage, robots.txt, sitemap.xml and llms.txt all refused
 * as `cross_origin`, which `knowledgeTransportReason` files as `blocked`. The
 * collection then held no evidence, the generation refused it as
 * `invalid_input`, and the run reported `invalid_output` -- a model failure for
 * a site nobody had managed to read.
 *
 * It stays fail-closed everywhere else. A URL without a parsable host answers
 * null and is refused; only the single conventional label comes off, so
 * `www.www.example.com`, `wwwexample.com`, `api.example.com` and any unrelated
 * host reached through a `www.` of its own remain different sites; and an https
 * origin still never follows a downgrade.
 */
function sameHostHttpsPreservingRedirect(fromUrl: string, toUrl: string): boolean {
  try {
    const from = new URL(fromUrl), to = new URL(toUrl);
    const fromKey = canonicalCrawlTargetKey(from.href), toKey = canonicalCrawlTargetKey(to.href);
    // `fromKey` must be a real host: a scheme that carries no host (mailto:,
    // data:) normalises to "", and two of those compare equal to each other.
    //
    // Port is compared separately because the gate's key does not carry one --
    // it answers on hostname alone, by design, since an apex and its `www` are
    // one traffic budget whatever port they serve. Reusing that key as the
    // whole origin test would let a site redirect this collection onto any
    // other port it listens on, and the transport's DNS/IP guard cannot object:
    // the hostname never changed, so it resolves to the same permitted address.
    return fromKey !== null && fromKey !== "" && fromKey === toKey && from.port === to.port
      && !(from.protocol === "https:" && to.protocol !== "https:");
  } catch { return false; }
}

/** SSRF-safe, quota-gated transport for the immutable knowledge evidence collector. */
export function createGeoKnowledgeResourceReader(clientKey: string, options: {
  readonly fetchResource?: typeof fetchPublicResource;
  readonly openGate?: typeof openCrawlGate;
  readonly now?: () => Date;
} = {}): GeoKnowledgeEvidenceReadResource {
  // One reader instance is one bounded collection. The crawl gate admits the
  // collection once per target host, just as a crawler is gated once before
  // it reads multiple pages; otherwise the gate's per-target run budget would
  // be incorrectly spent once per page.
  //
  // Memoised under the gate's OWN target identity, not the raw host. The gate
  // budgets an apex and its `www` sibling together (`canonicalCrawlTargetKey`),
  // so keying on the raw host admitted them separately and spent one hourly
  // allowance twice -- which also made `planGeoEvidenceReuse`'s promise of one
  // opening per gate key untrue at the only place that opens one.
  const admissions = new Map<string, GeoKnowledgeUnavailableReason | null>();
  return async input => {
    const unavailable = (reason: GeoKnowledgeUnavailableReason): GeoKnowledgeResourceResult => ({ kind: "unavailable", url: input.url, reason });
    let host: string;
    try { host = canonicalCrawlTargetKey(input.url) ?? new URL(input.url).host; }
    catch { return unavailable("blocked"); }
    let release: (() => void) | null = null;
    if (!admissions.has(host)) {
      let gate: Awaited<ReturnType<typeof openCrawlGate>>;
      try { gate = await (options.openGate ?? openCrawlGate)(clientKey, input.url); }
      catch { admissions.set(host, "fetch_failed"); return unavailable("fetch_failed"); }
      if (!gate.ok) {
        const reason = gate.response.status === 400 ? "blocked" : gate.response.status === 409 || gate.response.status === 429 ? "rate_limited" : "fetch_failed";
        admissions.set(host, reason);
        return unavailable(reason);
      }
      if (gate.kind !== "crawl") {
        gate.release(); admissions.set(host, "fetch_failed");
        return unavailable("fetch_failed");
      }
      admissions.set(host, null); release = gate.release;
    }
    const admission = admissions.get(host);
    if (admission !== null) return unavailable(admission ?? "fetch_failed");
    const requestedTimeout = input.timeoutMs ?? 8_000;
    const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1, Math.min(Math.floor(requestedTimeout), 8_000)) : 8_000;
    try {
      const result = await (options.fetchResource ?? fetchPublicResource)(input.url, {
        timeoutMs, maxBodyBytes: GEO_KNOWLEDGE_EVIDENCE_LIMITS.pageBytes, maxRedirects: 2,
        allowRedirect: sameHostHttpsPreservingRedirect,
      });
      if (result.kind === "error") return unavailable(knowledgeTransportReason(result.code));
      const httpReason = knowledgeHttpReason(result.finalStatus);
      if (httpReason !== null) return unavailable(httpReason);
      if (!result.bodyComplete) return unavailable("partial_body");
      if (result.contentType === null) return unavailable("invalid_response");
      return { kind: "ok", url: result.finalUrl, body: result.body, contentType: result.contentType,
        observedAt: (options.now ?? (() => new Date()))().toISOString() };
    } catch { return unavailable("fetch_failed"); }
    finally { release?.(); }
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
