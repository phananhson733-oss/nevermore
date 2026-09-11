// @input  -- one rival's domain, the shared identity cache and the gated SSRF-safe page reader
// @output -- what that rival's own homepage calls it, or the reason the page could not say
// @pos    -- server only (cheerio, the crawl cache); it writes no draft and never confirms anything

/**
 * The lookup half of the competitor gesture.
 *
 * The Profile names a rival by its host and nothing else, so the row a draft
 * carries has no name until someone supplies one. This reads the name off the
 * rival's own homepage -- JSON-LD `Organization`/`WebSite`, then
 * `og:site_name`, then `<title>` -- through the same reader the run's collect
 * step uses, so it spends the same per-owner crawl allowance and admits the
 * same hosts. What it finds is a PROPOSAL: the owner confirms it, edits it, or
 * types a name instead, and only that gesture writes the draft.
 *
 * The answer is shared. A brand's name is a fact about a public domain, not
 * about the account that asked, so a successful read goes into the
 * `geo-competitor-identity` namespace of the crawl cache for a day and the
 * next owner naming the same rival pays nothing. Failures are not cached: a
 * timeout at 08:00 is no reason to answer "unavailable" until tomorrow.
 */
import {
  normalizeCompetitorDomain,
  readCachedCompetitorIdentity,
  writeCachedCompetitorIdentity,
  type GeoCompetitorIdentity,
} from "./kb-competitor-identity-cache.ts";
import { extractCompetitorIdentity } from "./kb-enrichment.ts";
import type { GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import {
  GEO_KB_V3_COMPETITOR_IDENTITY_REASONS,
  type GeoKbV3CompetitorIdentityMethod,
  type GeoKbV3CompetitorIdentityReason,
} from "../../components/tools/geo-kb-v3-wire.ts";

/** The same ceiling one page read has in the run's collect step. */
export const GEO_KB_V3_COMPETITOR_PAGE_TIMEOUT_MS = 8_000;

export type { GeoKbV3CompetitorIdentityMethod, GeoKbV3CompetitorIdentityReason };

export type GeoKbV3CompetitorIdentity =
  | {
      readonly status: "available";
      readonly domain: string;
      readonly brandName: string;
      readonly aliases: readonly string[];
      /** Null when the answer came from the shared cache, which keeps no method. */
      readonly method: GeoKbV3CompetitorIdentityMethod | null;
      readonly sourceUrl: string;
      readonly observedAt: string;
      readonly cached: boolean;
    }
  | {
      readonly status: "unavailable";
      readonly domain: string;
      readonly reason: GeoKbV3CompetitorIdentityReason;
    };

export interface GeoKbV3CompetitorIdentityDependencies {
  /** The gated reader, built per owner so the admission is theirs. */
  readonly read: GeoKnowledgeEvidenceReadResource;
  readonly readCache: (host: string) => Promise<GeoCompetitorIdentity | null>;
  readonly writeCache: (identity: GeoCompetitorIdentity) => Promise<void>;
  readonly now: () => Date;
}

const REASONS = new Set<string>(GEO_KB_V3_COMPETITOR_IDENTITY_REASONS);

/**
 * The reader's vocabulary is wider than this one. Anything it says that this
 * contract has no word for is a failed fetch: true, and the only honest word.
 */
function readerReason(reason: string): GeoKbV3CompetitorIdentityReason {
  return REASONS.has(reason) ? (reason as GeoKbV3CompetitorIdentityReason) : "fetch_failed";
}

function isHtml(contentType: string): boolean {
  return /^(text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(contentType.trim());
}

export function geoKbV3CompetitorHomeUrl(host: string): string {
  return `https://${host}/`;
}

export async function identifyGeoKbV3Competitor(
  domain: string,
  dependencies: GeoKbV3CompetitorIdentityDependencies,
): Promise<GeoKbV3CompetitorIdentity> {
  const unavailable = (reason: GeoKbV3CompetitorIdentityReason): GeoKbV3CompetitorIdentity => ({ status: "unavailable", domain, reason });
  const host = normalizeCompetitorDomain(domain);
  if (host === null) return unavailable("missing_url");
  const sourceUrl = geoKbV3CompetitorHomeUrl(host);

  const cached = await dependencies.readCache(host).catch(() => null);
  if (cached !== null && cached.brandName !== null) {
    return {
      status: "available", domain: host, brandName: cached.brandName, aliases: [...cached.aliases],
      method: null, sourceUrl, observedAt: cached.observedAt, cached: true,
    };
  }

  let read;
  try {
    read = await dependencies.read({ url: sourceUrl, expected: "html", timeoutMs: GEO_KB_V3_COMPETITOR_PAGE_TIMEOUT_MS });
  } catch {
    return unavailable("fetch_failed");
  }
  if (read.kind !== "ok") {
    // Our own gate said no: nothing reached the site, and the collect step
    // files the same case the same way.
    if (read.reached !== true) return unavailable("rate_limited");
    return unavailable(readerReason(read.reason));
  }
  if (!isHtml(read.contentType)) return unavailable("not_html");

  const extracted = extractCompetitorIdentity(host, { kind: "ok", url: read.url, body: read.body, observedAt: read.observedAt }, "C1");
  if (extracted.status !== "available") return unavailable(readerReason(extracted.reason));

  const identity: GeoCompetitorIdentity = { domain: host, brandName: extracted.brandName, aliases: extracted.aliases, observedAt: extracted.observedAt };
  await dependencies.writeCache(identity).catch(() => undefined);
  return {
    status: "available", domain: host, brandName: extracted.brandName, aliases: [...extracted.aliases],
    method: extracted.method, sourceUrl: extracted.sourceUrl, observedAt: extracted.observedAt, cached: false,
  };
}

/** The production cache halves; the reader is built per owner by the runtime. */
export const DEFAULT_GEO_KB_V3_COMPETITOR_IDENTITY_CACHE: Pick<GeoKbV3CompetitorIdentityDependencies, "readCache" | "writeCache"> = {
  readCache: (host) => readCachedCompetitorIdentity(host),
  writeCache: (identity) => writeCachedCompetitorIdentity(identity),
};
