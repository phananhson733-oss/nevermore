// @input  -- the collected page rows a finished crawl payload already carries
// @output -- a bounded, neutral shortlist of pages worth judging individually
// @pos    -- server-side projection; reads no Profile and adds no collection

import type { SeoAuditReport } from "@sf/public-tools/seo-audit/types";

import type { AgentKeyPageCandidate } from "./audit-contract.ts";

/**
 * How many candidates the projection publishes.
 *
 * The client narrows this to the pages a Profile actually points at, so the
 * server's job is to hand over enough structure to choose from without turning
 * the response into a second copy of the crawl. Twenty-four matches the bound
 * the GEO site index already runs at.
 */
export const AGENT_KEY_PAGE_CANDIDATE_LIMIT = 24;

/** Depths a candidate may come from, nearest first. */
const CANDIDATE_DEPTHS: readonly number[] = [1, 2];

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
  };
}

/**
 * Choose the pages a run publishes as individually judgeable.
 *
 * Neutral on purpose: nothing here reads the visitor's Profile. The order is
 * home page, the submitted page, then the shallowest pages the site links to
 * most -- a structural claim the crawl can support on its own. Which of these
 * matter to this particular business is the client's question, asked against a
 * confirmed Profile, and asking it here would put one visitor's context into a
 * projection built from a payload cached across visitors.
 */
export function selectAgentKeyPageCandidates({
  pages,
  siteOrigin,
  inspectedTargetUrl,
}: {
  readonly pages: SeoAuditReport["pages"];
  readonly siteOrigin: string;
  readonly inspectedTargetUrl: string | null;
}): readonly AgentKeyPageCandidate[] {
  const collected: SeoAuditReport["pages"][number][] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!isCollected(page)) continue;
    // One row per subject: a crawl can reach the same page by several paths,
    // and listing it twice would spend the budget on one page.
    if (seen.has(page.subjectUrl)) continue;
    seen.add(page.subjectUrl);
    collected.push(page);
  }

  const homeUrls = new Set(
    [`${siteOrigin}/`, siteOrigin].map((value) => value.replace(/\/+$/, "/")),
  );
  const isHome = (page: SeoAuditReport["pages"][number]): boolean =>
    homeUrls.has(page.url) || homeUrls.has(`${page.url.replace(/\/+$/, "")}/`);
  const isTarget = (page: SeoAuditReport["pages"][number]): boolean =>
    inspectedTargetUrl !== null && page.url === inspectedTargetUrl;

  const ordered: SeoAuditReport["pages"][number][] = [];
  const take = (page: SeoAuditReport["pages"][number]): void => {
    if (ordered.includes(page)) return;
    ordered.push(page);
  };

  const home = collected.find(isHome);
  if (home !== undefined) take(home);
  const target = collected.find(isTarget);
  if (target !== undefined) take(target);

  for (const depth of CANDIDATE_DEPTHS) {
    const tier = collected
      .filter((page) => page.depth === depth && !ordered.includes(page))
      .toSorted(
        (left, right) =>
          right.inboundLinks - left.inboundLinks ||
          left.url.localeCompare(right.url, "en"),
      );
    for (const page of tier) {
      if (ordered.length >= AGENT_KEY_PAGE_CANDIDATE_LIMIT) break;
      take(page);
    }
  }

  return ordered.slice(0, AGENT_KEY_PAGE_CANDIDATE_LIMIT).map(candidate);
}
