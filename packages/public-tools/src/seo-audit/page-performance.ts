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

/**
 * What the page weighed when Lighthouse loaded it.
 *
 * Separate from `PagePerformanceRaw` because it comes from the lab half of the
 * PageSpeed response, not the CrUX field half. A page can have one and not the
 * other, and merging them would make each hostage to the other's absence.
 */
export interface PageWeightRaw {
  /** The URL Lighthouse finished on — the post-redirect form. */
  readonly url: string;
  /** Sum of every network request's transferred bytes. */
  readonly totalTransferBytes: number;
}

/** The catalogue's published rule for 8.5, restated where it is enforced. */
export const PAGE_WEIGHT_BUDGET_BYTES = 2 * 1024 * 1024;

/** The catalogue's published rule for 5.2, restated where it is enforced. */
export const IMAGE_TRANSFER_BUDGET_BYTES = 200 * 1024;

/** What one image cost to transfer. */
export interface ImageWeightRaw {
  readonly url: string;
  readonly transferredBytes: number;
  /**
   * Whether the whole file arrived.
   *
   * False means the read stopped at the budget, so `transferredBytes` is a
   * floor rather than a total — which is all this check needs, because a file
   * that reaches the budget has already failed the rule.
   */
  readonly complete: boolean;
}

const METRICS = [
  {
    id: "core_web_vital_lcp",
    label: "lcp_ms",
    read: (raw: PagePerformanceRaw) => raw.lcp,
  },
  {
    id: "core_web_vital_inp",
    label: "inp_ms",
    read: (raw: PagePerformanceRaw) => raw.inp,
  },
  {
    id: "core_web_vital_cls",
    label: "cls_score",
    read: (raw: PagePerformanceRaw) => raw.cls,
  },
  {
    id: "core_web_vital_ttfb",
    label: "ttfb_ms",
    read: (raw: PagePerformanceRaw) => raw.ttfb,
  },
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
        // The named page was not tested: nothing was measured for it.
        targetTested: null,
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
      // This record is about the named page and it was measured.
      targetTested: true,
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

/**
 * The record behind 8.5, from the lab half of the same PageSpeed response.
 *
 * One record, always emitted, `unverified` when nothing was weighed. The
 * observation carries the byte count rather than a verdict so the catalogue's
 * published 2 MB rule stays the only place the threshold lives.
 */
export function buildPageWeightRecords(
  weight: PageWeightRaw | null | undefined,
  gap: PagePerformanceGap = "source_not_configured",
): readonly SeoAuditRecord[] {
  if (weight === null || weight === undefined) {
    return [
      {
        id: "page_total_transfer_bytes",
        category: "page_performance",
        state: "unverified",
        unit: "pages",
        population: "target_page",
        targetTested: null,
        tested: 0,
        affected: 0,
        observations: [],
        limitation: GAP_LIMITATION[gap],
      } satisfies SeoAuditRecord,
    ];
  }
  return [
    {
      id: "page_total_transfer_bytes",
      category: "page_performance",
      state: "observed",
      unit: "pages",
      population: "target_page",
      targetTested: true,
      tested: 1,
      affected: 1,
      observations: [
        {
          url: weight.url,
          values: [
            { label: "total_transfer_bytes", value: weight.totalTransferBytes },
          ],
        },
      ],
      limitation: "page_weight_is_one_lab_load_on_an_emulated_mobile_device",
    } satisfies SeoAuditRecord,
  ];
}

/**
 * The record behind 5.2, from a bounded fetch of each declared image.
 *
 * Deliberately NOT derived from the Lighthouse lab run beside it. Lighthouse
 * records only what its emulated mobile Chrome fetched during one no-scroll
 * navigation, so a `loading="lazy"` image below the fold never appears and a
 * `srcset` yields the small mobile candidate. A page carrying twenty-four
 * images would report "0 affected of 3 tested" directly under 5.3, which
 * counts every `<img>` in the markup — two surfaces disagreeing about the same
 * page, with the failure landing on the side of a false pass.
 */
export function buildImageWeightRecords(
  images: readonly ImageWeightRaw[] | null | undefined,
  /** Named so an unmeasurable run says which kind of nothing it got. */
  limitation = "no_image_weights_were_measured_for_this_run",
  /**
   * Whether every image the page declares was weighed.
   *
   * A partial sample cannot clear this check. "None of the images I managed to
   * fetch is over budget" is not "none of the page's images is over budget",
   * and the gap between them is where the heavy image lives: one small image
   * plus twenty-four failed fetches would otherwise render as a clean page.
   * A partial sample may still FAIL — finding one oversized image is proof —
   * so it is only the clean verdict that is withheld.
   *
   * Required, with no default. A default of `true` makes omission read as
   * proof of completeness, so the next caller that forgets it silently gets
   * the fail-open behaviour this argument was added to remove.
   */
  complete: boolean,
): readonly SeoAuditRecord[] {
  if (images === null || images === undefined || images.length === 0) {
    return [
      {
        id: "image_over_transfer_budget",
        category: "page_performance",
        state: "unverified",
        unit: "pages",
        population: "target_page",
        targetTested: null,
        tested: 0,
        affected: 0,
        observations: [],
        limitation,
      } satisfies SeoAuditRecord,
    ];
  }
  // A file that filled the cap is at least the budget, and the published rule
  // is "below 200KB" — so reaching it is already over, whatever the true total.
  const over = images.filter(
    (image) =>
      !image.complete || image.transferredBytes >= IMAGE_TRANSFER_BUDGET_BYTES,
  );
  // Nothing over budget, but we did not see every image: that is an unfinished
  // measurement, not a pass.
  if (over.length === 0 && !complete) {
    return [
      {
        id: "image_over_transfer_budget",
        category: "page_performance",
        state: "unverified",
        unit: "pages",
        population: "target_page",
        targetTested: null,
        tested: 0,
        affected: 0,
        observations: [],
        limitation: "not_every_declared_image_could_be_weighed_this_run",
      } satisfies SeoAuditRecord,
    ];
  }
  return [
    {
      id: "image_over_transfer_budget",
      category: "page_performance",
      state: "observed",
      unit: "pages",
      population: "target_page",
      targetTested: true,
      tested: images.length,
      affected: over.length,
      observations: over.map((image) => ({
        url: image.url,
        values: [
          { label: "image_transfer_bytes", value: image.transferredBytes },
          // Published so a floor is never read as a total.
          { label: "image_size_is_exact", value: image.complete },
        ],
      })),
      limitation: "image_weights_are_the_bytes_this_run_transferred",
    } satisfies SeoAuditRecord,
  ];
}

export const PAGE_PERFORMANCE_RECORD_IDS: readonly string[] = [
  ...METRICS.map((metric) => metric.id),
  "page_total_transfer_bytes",
  "image_over_transfer_budget",
];

export const PAGE_PERFORMANCE_EVIDENCE_LABELS: readonly string[] = [
  ...METRICS.map((metric) => metric.label),
  "crux_source_level",
  "crux_form_factor",
  "total_transfer_bytes",
  "image_transfer_bytes",
  "image_size_is_exact",
];

export const PAGE_PERFORMANCE_LIMITATION_CODES: readonly string[] = [
  ...Object.values(GAP_LIMITATION),
  "crux_had_no_url_level_data_so_these_are_the_whole_origin_p75_values",
  "crux_p75_of_real_visits_over_a_28_day_window_lags_a_change_you_just_shipped",
  "page_weight_is_one_lab_load_on_an_emulated_mobile_device",
  "image_weights_are_the_bytes_this_run_transferred",
  "no_image_weights_were_measured_for_this_run",
  "the_page_declared_no_images_to_weigh",
  "this_run_did_not_carry_the_target_pages_declared_images",
  "no_declared_image_could_be_fetched_this_run",
  "not_every_declared_image_could_be_weighed_this_run",
];
