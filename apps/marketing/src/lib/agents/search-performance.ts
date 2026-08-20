// @input  -- the audited URL, the pages this crawl collected, and the visitor's grant
// @output -- search-performance evidence for that host, or null when nothing covers it
// @pos    -- server-only composition; the audit degrades to the gated state on any miss
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { brandTermCandidates, keywordCoverageProperty } from "@sf/public-tools";
import {
  buildSearchPerformanceRecords,
  type SearchPerformanceRaw,
} from "@sf/public-tools/seo-audit/search-performance";
import type { SeoAuditRecord, SeoAuditReport } from "@sf/public-tools";
import { buildIndexCoverageRecords } from "@sf/public-tools/seo-audit/index-coverage";
import {
  inspectUrlIndexStatus,
  type UrlInspectionResult,
} from "@sf/sources/gsc/url-inspection";

import type { GrantResolution } from "../auth/grant-cookie.ts";
import { resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import {
  AGENT_SEARCH_PERFORMANCE_VERSION,
  type AgentSearchPerformance,
} from "./audit-contract.ts";
import {
  createSearchPerformanceReader,
  type SearchPerformanceReadInput,
} from "./search-performance-reader.ts";

export interface SearchPerformanceDependencies {
  readonly resolveGrant: () => Promise<GrantResolution>;
  readonly read: (
    input: SearchPerformanceReadInput,
  ) => Promise<SearchPerformanceRaw>;
  /**
   * Google's own index verdict per declared URL, for A1.
   *
   * Optional: a deployment without it publishes "no index-status source was
   * configured", which is a different sentence from "your pages are not
   * indexed" and the only honest one when we never asked.
   */
  readonly inspectIndexStatus?: (input: {
    readonly siteUrl: string;
    readonly accessToken: string;
    readonly urls: readonly string[];
  }) => Promise<UrlInspectionResult>;
}

export const DEFAULT_SEARCH_PERFORMANCE_DEPENDENCIES: SearchPerformanceDependencies =
  {
    resolveGrant: resolveTrafficDropGrant,
    read: createSearchPerformanceReader({}),
    inspectIndexStatus: inspectUrlIndexStatus,
  };

/**
 * Reads this visitor's Search Console numbers for the audited host.
 *
 * Returns null for every way there is nothing to read: no grant, a grant that
 * covers no property for this host, or a read that failed. All three leave the
 * search checks reporting the authorization they need, which is a state the
 * visitor can act on — unlike a failed audit.
 *
 * Coverage is measured against the pages this crawl collected, not against
 * everything the property knows, because the checks are about the site this run
 * actually looked at.
 */
export async function readAgentSearchPerformance(
  input: {
    /** The crawl's own origin, which is the population every check counts. */
    readonly siteOrigin: string;
    readonly pages: SeoAuditReport["pages"];
    /**
     * The URL the crawl landed on for the submitted page, or null.
     *
     * The final URL, never the submitted one: Search Console keys its rows by
     * the URL it indexed, so filtering on a form that redirected returns no
     * rows and would be read as a page nobody has ever been shown.
     */
    readonly targetPageUrl?: string | null;
    /** Queries the visitor confirmed for that page. */
    readonly targetQueries?: readonly string[];
    /**
     * The URLs this site's sitemap declares, and whether that list is whole.
     *
     * A1's denominator. Incomplete means no rate is published at all — a
     * census over part of a population is a sample again, and this one's bias
     * runs toward calling a failing site healthy.
     */
    /**
     * The URLs the sitemap declared, spelled as it declared them.
     *
     * NOT the aggregation subject. URL Inspection answers about exact URLs, so
     * sending the subject form asked Google about `/x` for a sitemap that
     * declared `/x/` — a different page to Google, and typically an excluded
     * one, which reported a healthy trailing-slash site at Blocker.
     */
    readonly sitemapUrls?: readonly string[];
    readonly sitemapUrlsComplete?: boolean;
  },
  dependencies: SearchPerformanceDependencies = DEFAULT_SEARCH_PERFORMANCE_DEPENDENCIES,
): Promise<AgentSearchPerformance | null> {
  const grant = await dependencies.resolveGrant();
  if (grant.kind !== "grant") return null;

  // Selected against the crawl origin, not the submitted URL. Coverage counts
  // every page this crawl collected across that origin, so a property covering
  // only a section of it — `https://acme.test/blog/` for a crawl that also saw
  // `/pricing` — cannot answer for those pages, and listing them as never shown
  // would report "outside the property" as "measured zero".
  const property = keywordCoverageProperty(input.siteOrigin, grant.properties);
  if (property === null) return null;

  const raw = await dependencies.read({
    property,
    accessToken: grant.accessToken,
    targetPageUrl: input.targetPageUrl ?? null,
    targetQueries: input.targetQueries ?? [],
  });
  // Brand terms come from the property the visitor already authorised, not
  // from a field they have to fill in first.
  const records = buildSearchPerformanceRecords(
    raw,
    input.pages,
    brandTermCandidates(property),
  );
  if (records.length === 0) return null;

  // A1 rides the same grant and the same region. It is a separate endpoint on
  // a separate host with its own quota, so it is read separately and its
  // failure never takes the search rows down with it.
  const coverage = await readIndexCoverage({
    property,
    accessToken: grant.accessToken,
    sitemapUrls: input.sitemapUrls ?? [],
    sitemapUrlsComplete: input.sitemapUrlsComplete ?? false,
    inspect: dependencies.inspectIndexStatus,
  });

  return {
    version: AGENT_SEARCH_PERFORMANCE_VERSION,
    property,
    startDate: raw.startDate,
    endDate: raw.endDate,
    records: [...records, ...coverage],
  };
}

/**
 * A1's census, or the named reason there is none.
 *
 * Every early return is a different sentence. Collapsing them would tell a
 * visitor their pages are not indexed when the truth is that we never asked,
 * or that their sitemap is larger than one run can census.
 */
async function readIndexCoverage(input: {
  readonly property: string;
  readonly accessToken: string;
  /** As declared by the sitemap, because the provider answers per exact URL. */
  readonly sitemapUrls: readonly string[];
  readonly sitemapUrlsComplete: boolean;
  readonly inspect: SearchPerformanceDependencies["inspectIndexStatus"];
}): Promise<readonly SeoAuditRecord[]> {
  if (input.inspect === undefined) {
    return buildIndexCoverageRecords(null, "source_not_configured");
  }
  if (!input.sitemapUrlsComplete) {
    return buildIndexCoverageRecords(null, "sitemap_population_incomplete");
  }
  if (input.sitemapUrls.length === 0) {
    return buildIndexCoverageRecords(null, "no_sitemap_urls_declared");
  }
  try {
    const result = await input.inspect({
      siteUrl: input.property,
      accessToken: input.accessToken,
      urls: input.sitemapUrls,
    });
    if (result.status !== "ok") {
      return buildIndexCoverageRecords(null, result.reason);
    }
    // A URL Google answered about unusably is not a URL we may score. Dropping
    // it from the numerator while keeping it in the denominator would report a
    // page as unindexed on the strength of a malformed response.
    return buildIndexCoverageRecords(
      result.statuses.map((status) => ({
        url: status.url,
        verdict: status.verdict,
      })),
    );
  } catch {
    return buildIndexCoverageRecords(null, "provider_unavailable");
  }
}
