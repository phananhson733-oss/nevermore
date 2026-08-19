// @input  -- CrUX p75 field values for the submitted page, or nothing
// @output -- evidence records for the Core Web Vitals checks (8.1-8.4)
// @pos    -- pure projection; owns no credential, makes no request
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditRecord } from "./types.ts";

/**
 * Which CrUX level the numbers came from.
 *
 * Published, never smoothed over. Origin-level data is the whole site's p75,
 * so reading it as this page's is how a fast page inherits a slow site's
 * verdict and a slow page hides behind a fast one.
 */
export type CruxSourceLevel = "url" | "origin";

export interface PagePerformanceRaw {
  /** The URL the sample was requested for, as sent. */
  readonly url: string;
  readonly sourceLevel: CruxSourceLevel;
  /** Milliseconds. Null for a metric CrUX did not report. */
  readonly lcp: number | null;
  readonly inp: number | null;
  /** Unitless layout-shift score. */
  readonly cls: number | null;
  readonly ttfb: number | null;
  /** Which form factor was requested, so the reader knows whose experience. */
  readonly formFactor: "mobile" | "desktop";
}

const METRICS = [
  { id: "core_web_vital_lcp", label: "lcp_ms", read: (raw: PagePerformanceRaw) => raw.lcp },
  { id: "core_web_vital_inp", label: "inp_ms", read: (raw: PagePerformanceRaw) => raw.inp },
  { id: "core_web_vital_cls", label: "cls_score", read: (raw: PagePerformanceRaw) => raw.cls },
  { id: "core_web_vital_ttfb", label: "ttfb_ms", read: (raw: PagePerformanceRaw) => raw.ttfb },
] as const;

/**
 * Records for the Core Web Vitals checks.
 *
 * All four on every run that had a region, whatever CrUX reported. A metric
 * CrUX withheld is `unverified` with the reason named — never a zero, which for
 * every one of these is the best possible value.
 *
 * `population` is `target_page` because that is literally true and because the
 * page projection cannot narrow a record that is already about one page: under
 * a conditional subset a page that passes produces no observation to match and
 * comes back indistinguishable from one that was never measured.
 */
/**
 * Why a run has no field values, in the caller's own words.
 *
 * Every entry is a different sentence on purpose. A rejected key and an
 * exhausted quota are our problems, and reporting either as "CrUX has no data
 * for this page" states something about the site's traffic that was never
 * observed. The first version of this collapsed all of them into the last one,
 * and a live call then proved the key in use was invalid — so the product was
 * telling visitors their site had no field data while never having asked.
 */
export type PagePerformanceGap =
  | "source_not_configured"
  | "no_field_data"
  | "provider_rejected_credentials"
  | "provider_quota_exhausted"
  | "provider_unavailable";

const GAP_LIMITATION: Readonly<Record<PagePerformanceGap, string>> = {
  source_not_configured: "no_field_data_source_was_configured_for_this_run",
  no_field_data: "crux_reported_no_field_data_for_this_metric_on_this_url",
  provider_rejected_credentials:
    "the_field_data_provider_rejected_this_deployments_credentials",
  provider_quota_exhausted:
    "the_field_data_providers_quota_for_this_deployment_was_already_spent",
  provider_unavailable: "the_field_data_provider_did_not_answer_this_run",
};

export function buildPagePerformanceRecords(
  raw: PagePerformanceRaw | null | undefined,
  /** Why there is nothing, when `raw` is absent. */
  gap: PagePerformanceGap = "source_not_configured",
): readonly SeoAuditRecord[] {
  return METRICS.map(({ id, label, read }) => {
    const value = raw === null || raw === undefined ? null : read(raw);
    if (raw === null || raw === undefined || value === null) {
      return {
        id,
        category: "page_performance",
        state: "unverified",
        unit: "pages",
        population: "target_page",
        tested: 0,
        affected: 0,
        observations: [],
        // A metric missing from an answered response IS about the page; the
        // caller's reason only applies when nothing was read at all.
        limitation:
          raw === null || raw === undefined
            ? GAP_LIMITATION[gap]
            : GAP_LIMITATION.no_field_data,
      } satisfies SeoAuditRecord;
    }
    return {
      id,
      category: "page_performance",
      state: "observed",
      unit: "pages",
      population: "target_page",
      tested: 1,
      // One affected observation, which is what lets the rule run at all: the
      // evaluator reads `affected === 0` as a clean pass before it reaches an
      // aggregate rule, so a measured record must carry its observation.
      affected: 1,
      observations: [
        {
          url: raw.url,
          values: [
            { label, value },
            { label: "crux_source_level", value: raw.sourceLevel },
            { label: "crux_form_factor", value: raw.formFactor },
          ],
        },
      ],
      limitation:
        raw.sourceLevel === "origin"
          ? "crux_had_no_url_level_data_so_these_are_the_whole_origin_p75_values"
          : "crux_p75_of_real_visits_over_a_28_day_window_lags_a_change_you_just_shipped",
    } satisfies SeoAuditRecord;
  });
}

export const PAGE_PERFORMANCE_RECORD_IDS: readonly string[] = METRICS.map(
  (metric) => metric.id,
);

export const PAGE_PERFORMANCE_EVIDENCE_LABELS: readonly string[] = [
  ...METRICS.map((metric) => metric.label),
  "crux_source_level",
  "crux_form_factor",
];

export const PAGE_PERFORMANCE_LIMITATION_CODES: readonly string[] = [
  ...Object.values(GAP_LIMITATION),
  "crux_had_no_url_level_data_so_these_are_the_whole_origin_p75_values",
  "crux_p75_of_real_visits_over_a_28_day_window_lags_a_change_you_just_shipped",
];
