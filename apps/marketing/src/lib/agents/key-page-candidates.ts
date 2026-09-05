// @input  -- the collected page rows a finished crawl payload already carries
// @output -- a bounded neutral page set: key-page shortlist or full-site coverage
// @pos    -- server-side projection; reads no Profile and adds no collection

import { canonicalizeUrl } from "@sf/sources/canonical-url";
import { isAllowedAgentRunSiteUrl } from "./agent-run-options.ts";

import type {
  SeoAuditCrawlTier,
  SeoAuditReport,
} from "@sf/public-tools/seo-audit/types";

import type {
  AgentKeyPageCandidate,
  AgentKeyPageReason,
} from "./audit-contract.ts";

const CLUSTER_MIN_PAGES = 3;
const CLUSTER_MAX_PAGES = 20;
const CONTENT_INITIAL_LIMIT = 15;
const CANDIDATE_BUSINESS_THRESHOLD = 50;
const BLACKLIST_SEGMENTS = new Set([
  "about",
  "contact",
  "privacy",
  "terms",
  "cookie",
  "careers",
  "jobs",
  "team",
]);
const CONTENT_SEGMENTS = new Set(["blog", "posts", "news", "articles"]);

function isHtml(contentType: string | null): boolean {
  if (contentType === null) return false;
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

function isCollected(page: SeoAuditReport["pages"][number]): boolean {
  return (
    page.finalStatus !== null &&
    page.finalStatus >= 200 &&
    page.finalStatus < 300 &&
    isHtml(page.contentType)
  );
}

function candidate(
  page: SeoAuditReport["pages"][number],
  reason: AgentKeyPageReason,
): AgentKeyPageCandidate {
  return {
    // `page.url` is the crawl's fetch URL, which is the form every observation
    // carries. `subjectUrl` is a different normalisation, and picking it here
    // would make `projectRecordToTarget` miss every key page at once -- the
    // comparison only strips a fragment, it does not re-normalise.
    url: page.url,
    title: page.title,
    metaDescription: page.metaDescription,
    depth: page.depth,
    inboundLinks: page.inboundLinks,
    reason,
  };
}

interface PathInfo {
  readonly segments: readonly string[];
  readonly prefix: string | null;
}

function pathInfo(url: string): PathInfo {
  try {
    const pathSegments = new URL(url).pathname
      .split("/")
      .filter((segment) => segment !== "");
    const segments = pathSegments.map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
    const firstPathSegment = pathSegments[0];
    return {
      segments,
      // Keep the URL-safe spelling on the wire. Decoding is useful for the
      // blacklist, but a decoded space would make our own strict prefix guard
      // reject an otherwise valid path segment.
      prefix:
        pathSegments.length >= 2 && firstPathSegment !== undefined
          ? `/${firstPathSegment.toLowerCase()}/`
          : null,
    };
  } catch {
    return { segments: [], prefix: null };
  }
}

function isBlacklisted(url: string): boolean {
  const { segments } = pathInfo(url);
  if (segments.some((segment) => BLACKLIST_SEGMENTS.has(segment))) return true;
  if (segments.length !== 1) return false;
  const [topLevel] = segments;
  return (
    topLevel !== undefined &&
    [...BLACKLIST_SEGMENTS].some((keyword) =>
      topLevel.startsWith(`${keyword}-`),
    )
  );
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCanonicalHomeUrl(url: string, siteOrigin: string | null): boolean {
  try {
    const parsed = new URL(url);
    return (
      siteOrigin !== null &&
      parsed.origin === siteOrigin &&
      parsed.pathname === "/" &&
      parsed.search === ""
    );
  } catch {
    return false;
  }
}

/**
 * Choose the pages a run publishes as individually judgeable.
 *
 * Neutral on purpose: nothing here reads the visitor's Profile. Membership and
 * reasons come only from collected structure. Key-pages runs apply the five
 * selection rules; full-site runs append every remaining unique collected 2xx
 * HTML page. The client may reorder the complete set against a confirmed
 * Profile without filtering any row.
 * Keeping Profile context out of this projection also keeps a shared cached
 * crawl from carrying one visitor's business context to the next visitor.
 */
export function selectAgentKeyPageCandidates({
  pages,
  siteOrigin,
  inspectedTargetUrl,
  navigationUrls,
  manualUrls,
  crawlTier = "key-pages",
}: {
  readonly pages: SeoAuditReport["pages"];
  readonly siteOrigin: string;
  readonly inspectedTargetUrl: string | null;
  readonly navigationUrls: readonly string[];
  readonly manualUrls: readonly string[];
  readonly crawlTier?: SeoAuditCrawlTier;
}): {
  readonly candidates: readonly AgentKeyPageCandidate[];
  readonly omittedUrls: readonly string[];
  readonly manualUnavailableUrls: readonly string[];
} {
  let origin: string | null = null;
  try {
    origin = new URL(siteOrigin).origin;
  } catch {
    // A validated report supplies an origin. Keeping this local guard makes
    // this pure selector fail closed in focused tests too.
  }
  const bySubject = new Map<
    string,
    SeoAuditReport["pages"][number][]
  >();
  for (const page of pages) {
    if (!isCollected(page)) continue;
    const rows = bySubject.get(page.subjectUrl) ?? [];
    rows.push(page);
    bySubject.set(page.subjectUrl, rows);
  }
  const representativeRank = (
    page: SeoAuditReport["pages"][number],
  ): number =>
    inspectedTargetUrl !== null && page.url === inspectedTargetUrl
      ? 0
      : isCanonicalHomeUrl(page.url, origin)
        ? 1
        : 2;
  const collected = [...bySubject.values()]
    .map(
      (rows) =>
        rows.toSorted(
          (left, right) =>
            representativeRank(left) - representativeRank(right) ||
            compareAscii(left.url, right.url),
        )[0]!,
    )
    .toSorted((left, right) => compareAscii(left.url, right.url));

  const isHome = (page: SeoAuditReport["pages"][number]): boolean =>
    isCanonicalHomeUrl(page.url, origin);
  const isTarget = (page: SeoAuditReport["pages"][number]): boolean =>
    inspectedTargetUrl !== null && page.url === inspectedTargetUrl;

  const ordered: AgentKeyPageCandidate[] = [];
  const selectedSubjects = new Set<string>();
  const take = (
    page: SeoAuditReport["pages"][number],
    reason: AgentKeyPageReason,
  ): void => {
    if (selectedSubjects.has(page.subjectUrl)) return;
    selectedSubjects.add(page.subjectUrl);
    ordered.push(candidate(page, reason));
  };

  const home = collected.find(isHome);
  if (home !== undefined) take(home, "home");
  const target = collected.find(isTarget);
  if (target !== undefined) take(target, "target");

  const byIdentity = new Map<string, SeoAuditReport["pages"][number]>();
  for (const page of collected) {
    for (const identity of [page.subjectUrl, page.url, page.finalUrl]) {
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, page);
      }
    }
  }
  const normalizedManualUrls = [...new Set(manualUrls.flatMap((url) => {
      try {
        const parsed = new URL(url);
        if (
          origin !== null &&
          isAllowedAgentRunSiteUrl(url, origin) &&
          parsed.username === "" &&
          parsed.password === "" &&
          parsed.hash === ""
        ) {
          // Match the public crawler's rebase and canonical URL contract,
          // including HTTPS/www entry changes and stripped tracking params.
          const resolved = canonicalizeUrl(`${origin}${parsed.pathname}${parsed.search}`);
          return resolved ? [resolved.fetchUrl] : [];
        }
        return [];
      } catch {
        return [];
      }
    }))]
    .toSorted(compareAscii)
    .slice(0, 10);
  const manualUnavailableUrls: string[] = [];
  // A subject representative can discard a successful slash variant. Match
  // manual requests against actual successful journeys, not subject aliases;
  // a different slash sibling returning 200 cannot rescue a requested 404.
  const manualPages = pages.filter(isCollected);
  for (const url of normalizedManualUrls) {
    const page = manualPages.find((page) => page.url === url) ??
      manualPages.find((page) => page.finalUrl === url);
    if (page === undefined) {
      manualUnavailableUrls.push(url);
      continue;
    }
    take(page, "manual");
  }

  for (const url of navigationUrls) {
    const page = byIdentity.get(url);
    if (page !== undefined) take(page, "navigation");
  }

  const clusters = new Map<string, SeoAuditReport["pages"][number][]>();
  for (const page of collected) {
    const prefix = pathInfo(page.url).prefix;
    if (prefix === null) continue;
    const members = clusters.get(prefix) ?? [];
    members.push(page);
    clusters.set(prefix, members);
  }

  const oversizedClusters = new Set<string>();
  for (const prefix of [...clusters.keys()].toSorted(compareAscii)) {
    const members = clusters.get(prefix)!.toSorted((left, right) =>
      compareAscii(left.url, right.url),
    );
    if (members.length > CLUSTER_MAX_PAGES) {
      oversizedClusters.add(prefix);
      continue;
    }
    if (members.length < CLUSTER_MIN_PAGES) continue;
    for (const page of members) {
      if (!isBlacklisted(page.url)) {
        take(page, { kind: "cluster", prefix });
      }
    }
  }

  const content = collected
    .filter((page) => {
      if (selectedSubjects.has(page.subjectUrl) || isBlacklisted(page.url)) {
        return false;
      }
      const info = pathInfo(page.url);
      return (
        (info.segments[0] !== undefined &&
          CONTENT_SEGMENTS.has(info.segments[0])) ||
        (info.prefix !== null && oversizedClusters.has(info.prefix))
      );
    })
    .toSorted(
      (left, right) =>
        right.inboundLinks - left.inboundLinks ||
        compareAscii(left.url, right.url),
    )
    .slice(0, CONTENT_INITIAL_LIMIT);

  let contentLimit = CONTENT_INITIAL_LIMIT;
  if (ordered.length + content.length > CANDIDATE_BUSINESS_THRESHOLD) {
    contentLimit = 10;
  }
  if (
    ordered.length + Math.min(content.length, contentLimit) >
    CANDIDATE_BUSINESS_THRESHOLD
  ) {
    contentLimit = 5;
  }

  for (const page of content.slice(0, contentLimit)) {
    take(page, { kind: "content", inboundLinks: page.inboundLinks });
  }

  if (crawlTier === "full-site") {
    for (const page of collected) take(page, "full-site");
    return {
      candidates: ordered,
      omittedUrls: [],
      manualUnavailableUrls,
    };
  }

  return {
    candidates: ordered,
    omittedUrls: content.slice(contentLimit).map((page) => page.url),
    manualUnavailableUrls,
  };
}
