// @input  -- Google's own index verdict for each URL the sitemap declares
// @output -- the evidence record behind A1
// @pos    -- pure projection; owns no credential, makes no request
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditRecord } from "./types.ts";

/**
 * What Google said about one declared URL.
 *
 * Only the typed fields. `coverageState` is not here on purpose: it is the
 * only field that separates "discovered, not indexed" from the other exclusion
 * reasons, and the API types it as a bare localized string with no
 * enumeration. Reading it would let a Google wording change turn A3 into a
 * silent, permanent pass — so A3 stays unbuilt rather than built on sand.
 */
export interface IndexCoverageEntry {
  readonly url: string;
  /** `PASS` is Search Console's "Valid"; `NEUTRAL` is its "Excluded". */
  readonly verdict: "VERDICT_UNSPECIFIED" | "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL";
}

export type IndexCoverageGap =
  | "source_not_configured"
  | "sitemap_population_incomplete"
  | "no_sitemap_urls_declared"
  | "quota_exhausted"
  | "not_authorized"
  | "provider_unavailable";

const GAP_LIMITATION: Readonly<Record<IndexCoverageGap, string>> = {
  source_not_configured: "no_index_status_source_was_configured_for_this_run",
  sitemap_population_incomplete:
    "the_sitemap_declares_more_urls_than_this_run_can_census_so_no_rate_is_published",
  no_sitemap_urls_declared: "this_site_declares_no_sitemap_urls_to_measure",
  quota_exhausted: "the_propertys_url_inspection_quota_was_already_spent",
  not_authorized: "this_grant_does_not_cover_url_inspection_for_this_property",
  provider_unavailable: "the_index_status_source_did_not_finish_this_run",
};

/**
 * The record behind A1.
 *
 * The denominator is the sitemap: the set of pages the site itself declares it
 * wants indexed. That is a complete population whose completeness is
 * observable, which the pages our crawl happened to reach is not — the crawl
 * orders its frontier by page value and stops at depth six, so what it omits
 * is deep pagination, facets and thin archives, and those are exactly the
 * pages least likely to be indexed. A rate over the crawl sample runs high,
 * and A1 publishes a Blocker below 70%: the error would land on the side of
 * telling a failing site it passed.
 *
 * `PASS` counts as indexed and everything else does not. `NEUTRAL` is Search
 * Console's "Excluded", which is a real exclusion whatever its reason, and
 * `VERDICT_UNSPECIFIED` is Google declining to say — neither is evidence the
 * page is in the index.
 */
export function buildIndexCoverageRecords(
  entries: readonly IndexCoverageEntry[] | null | undefined,
  gap: IndexCoverageGap = "source_not_configured",
): readonly SeoAuditRecord[] {
  if (entries === null || entries === undefined || entries.length === 0) {
    return [
      {
        id: "sitemap_url_not_indexed",
        category: "search_performance",
        state: "unverified",
        unit: "pages",
        population: "site_resource",
        targetTested: null,
        tested: 0,
        affected: 0,
        observations: [],
        limitation: GAP_LIMITATION[gap],
      } satisfies SeoAuditRecord,
    ];
  }

  const notIndexed = entries.filter((entry) => entry.verdict !== "PASS");
  const aggregateValues = [
    {
      label: "index_coverage_rate",
      value: (entries.length - notIndexed.length) / entries.length,
    },
    { label: "sitemap_urls_inspected", value: entries.length },
  ] as const;
  // A measured aggregate needs one observation even when the site is clean;
  // otherwise the record contract reads `affected: 0` as a simple absence and
  // never applies A1's aggregate threshold. When URLs are missing, carry that
  // aggregate on the first actionable URL so `affected` remains the number of
  // URLs the reader can open rather than an off-by-one aggregate row.
  const observations =
    notIndexed.length === 0
      ? [{ url: null, values: aggregateValues }]
      : notIndexed.map((entry, index) => ({
          url: entry.url,
          values: [
            ...(index === 0 ? aggregateValues : []),
            { label: "index_status_verdict", value: entry.verdict },
          ],
        }));
  return [
    {
      id: "sitemap_url_not_indexed",
      category: "search_performance",
      state: "observed",
      unit: "pages",
      population: "site_resource",
      targetTested: null,
      tested: entries.length,
      affected: observations.length,
      observations,
      limitation: "index_status_is_googles_own_verdict_per_declared_url",
    } satisfies SeoAuditRecord,
  ];
}

export const INDEX_COVERAGE_RECORD_IDS: readonly string[] = [
  "sitemap_url_not_indexed",
];

export const INDEX_COVERAGE_EVIDENCE_LABELS: readonly string[] = [
  "index_coverage_rate",
  "sitemap_urls_inspected",
  "index_status_verdict",
];

export const INDEX_COVERAGE_LIMITATION_CODES: readonly string[] = [
  ...Object.values(GAP_LIMITATION),
  "index_status_is_googles_own_verdict_per_declared_url",
];
