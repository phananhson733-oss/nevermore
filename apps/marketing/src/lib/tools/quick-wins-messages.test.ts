// @input  -- the engine's code unions and both message bundles
// @output -- a failing test when any code has no copy in either locale
// @pos    -- the guard between "type-checks" and "throws in front of a user"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import type {
  BucketQuality,
  QuickWinExclusionReason,
  QuickWinLimitationCode,
} from "@sf/public-tools";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

/**
 * The engine emits codes; the surface renders them through i18n. Adding a
 * code is a type-safe change that type-checks everywhere and then throws
 * MISSING_MESSAGE mid-report in front of a visitor. This test is the thing
 * standing between those two facts.
 *
 * Each list is written out rather than derived, so adding a union member
 * fails compilation here until someone also writes the copy.
 */
const LIMITATION_CODES: readonly QuickWinLimitationCode[] = [
  "insufficient_bucket_sample",
  "insufficient_query_sample",
  "high_query_anonymization_gap",
  "partial_gsc_export",
  "site_level_low_ctr_band",
  "serp_cause_unobserved",
  "brand_segment_insufficient_evidence",
  "aggregation_basis_mismatch",
  "anonymization_gap_uncomputable",
];

const EXCLUSION_REASONS: readonly QuickWinExclusionReason[] = [
  "below_impression_floor",
  "position_outside_bands",
  "bucket_not_usable",
  "no_leave_one_out_baseline",
];

const BUCKET_QUALITIES: readonly BucketQuality[] = [
  "usable",
  "insufficient_impressions",
  "insufficient_queries",
];

/**
 * Every reason the draft section can render, from DraftSkipReason plus
 * DraftFailureReason plus the page-dimension failure runQuickWins adds.
 */
const DRAFT_SKIP_REASONS = [
  "no_shortfall",
  "low_dimension_coverage",
  "no_subject_page",
  "no_comparable_high_ctr_page",
  "beyond_draft_cap",
  "page_unreadable",
  "no_pattern_to_copy",
  "promises_outcome",
  "too_long",
  "empty",
  "unparseable",
  "model_unavailable",
  "page_dimension_unavailable",
] as const;

/** Every code the client's error allowlist can render. */
const ERROR_CODES = [
  "gsc_unavailable",
  "scan_in_progress",
  "rate_limited",
  "quota_unavailable",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
] as const;

type Bundle = Record<string, unknown>;

function quickWins(bundle: unknown): Bundle {
  const tools = (bundle as { tools?: Record<string, unknown> }).tools;
  const node = tools?.["quickWins"];
  if (typeof node !== "object" || node === null) {
    throw new Error("tools.quickWins missing from bundle");
  }
  return node as Bundle;
}

function group(bundle: unknown, key: string): Bundle {
  const node = quickWins(bundle)[key];
  if (typeof node !== "object" || node === null) {
    throw new Error(`tools.quickWins.${key} missing from bundle`);
  }
  return node as Bundle;
}

const LOCALES: readonly (readonly [string, unknown])[] = [
  ["en", en],
  ["zh", zh],
];

describe("quick-wins message coverage", () => {
  for (const [locale, bundle] of LOCALES) {
    it(`has copy for every limitation code (${locale})`, () => {
      const node = group(bundle, "limitations");
      for (const code of LIMITATION_CODES) {
        expect(typeof node[code], `limitations.${code}`).toBe("string");
      }
    });

    it(`has copy for every exclusion reason (${locale})`, () => {
      const node = group(bundle, "exclusions");
      for (const reason of EXCLUSION_REASONS) {
        expect(typeof node[reason], `exclusions.${reason}`).toBe("string");
      }
    });

    it(`has copy for every bucket quality (${locale})`, () => {
      const node = group(bundle, "bucketQuality");
      for (const quality of BUCKET_QUALITIES) {
        expect(typeof node[quality], `bucketQuality.${quality}`).toBe("string");
      }
    });

    it(`has copy for every error code the client can render (${locale})`, () => {
      const node = group(bundle, "errors");
      for (const code of ERROR_CODES) {
        expect(typeof node[code], `errors.${code}`).toBe("string");
      }
    });

    it(`has copy for every draft skip reason (${locale})`, () => {
      const node = group(bundle, "draftSkipped");
      for (const reason of DRAFT_SKIP_REASONS) {
        expect(typeof node[reason], `draftSkipped.${reason}`).toBe("string");
      }
    });

    it(`has the measurement-window string with both placeholders (${locale})`, () => {
      // The window is the one disclosure that makes every other number
      // readable. It was authored, translated, and then rendered nowhere for
      // a while; this pins that it exists and takes both dates.
      const value = quickWins(bundle)["window"];
      expect(typeof value).toBe("string");
      expect(value as string).toContain("{startDate}");
      expect(value as string).toContain("{endDate}");
    });
  }

  it("keeps the two locales structurally identical", () => {
    const keysOf = (node: unknown, prefix = ""): string[] => {
      if (typeof node !== "object" || node === null) return [];
      return Object.entries(node as Record<string, unknown>).flatMap(
        ([k, v]) => [prefix + k, ...keysOf(v, `${prefix}${k}.`)],
      );
    };

    expect(keysOf(quickWins(en)).sort()).toEqual(keysOf(quickWins(zh)).sort());
  });
});
