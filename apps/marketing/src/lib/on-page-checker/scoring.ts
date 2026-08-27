// @input  -- the audit result and the visitor's keyword evidence
// @output -- every check, per-category subtotals, and one 0-100 score
// @pos    -- the tool's published opinion; the facts it reads stay neutral
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditSiteResources,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";
import type {
  CheckCategory,
  CheckInput,
  OnPageCheck,
} from "./check-types.ts";
import { contentChecks, metaChecks } from "./checks-meta.ts";
import { keywordChecks, topicFocus } from "./checks-keyword.ts";
import { siteChecks } from "./checks-site.ts";
import { linkChecks, technicalChecks } from "./checks-technical.ts";

export const SCORING_VERSION = "on_page_score.v1";

export type ScoreGrade = "A" | "B" | "C" | "D";

export interface CategoryScore {
  readonly category: CheckCategory;
  readonly score: number;
  readonly max: number;
  readonly checks: readonly OnPageCheck[];
}

/**
 * Why a score can be capped below what the points add up to.
 *
 * Some failures make the rest of the sheet beside the point, and a weighted sum
 * cannot express that: each is worth a few points against a hundred, so a page
 * that fails one still lands in the nineties on everything else. Measured on a
 * page returning 404 under `noindex` but otherwise flawless, the uncapped score
 * was 95 — an A for a page that does not exist and may not be indexed.
 *
 * A cap is therefore not a penalty. It is the ceiling on what any score can
 * honestly claim while that condition holds.
 */
export type ScoreCap =
  | "topic_focus"
  | "body_words"
  | "body_bytes"
  | "not_indexable"
  | "not_reachable"
  | "keyword_unmeasured";

export const SCORE_CAP_REASONS: readonly ScoreCap[] = [
  "topic_focus",
  "body_words",
  "body_bytes",
  "not_indexable",
  "not_reachable",
  "keyword_unmeasured",
];

export interface OnPageScore {
  readonly version: typeof SCORING_VERSION;
  /**
   * Null when the visitor named no target query.
   *
   * Not zero and not a number over the categories that did run. Keyword
   * placement is the largest graded category and the input to the topic cap;
   * renormalising over the remaining ones divides by a smaller denominator and
   * makes the same page score *higher* — which is the measurement behind the
   * `keyword_unmeasured` ceiling below. A number that is not comparable to
   * another page's number is worse than no number, so a URL-only run publishes
   * its checks and its category subtotals and stops there.
   */
  readonly score: number | null;
  readonly grade: ScoreGrade | null;
  readonly earned: number;
  readonly available: number;
  readonly categories: readonly CategoryScore[];
  readonly checks: readonly OnPageCheck[];
  /** Caps that actually bound this score, in the order they were applied. */
  readonly caps: readonly { readonly reason: ScoreCap; readonly ceiling: number }[];
  /** 0–1, or null when no keyword evidence was derived. */
  readonly topicFocus: number | null;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly info: number;
    readonly graded: number;
  };
}

export const CATEGORY_ORDER: readonly CheckCategory[] = [
  "meta",
  "content",
  "keyword",
  "links",
  "media",
  "social",
  "technical",
  "site",
];

/** Focus below which the score is held down, and to what. */
const FOCUS_CAPS: readonly { readonly below: number; readonly ceiling: number }[] =
  [
    { below: 0.15, ceiling: 25 },
    { below: 0.35, ceiling: 45 },
    { below: 0.55, ceiling: 65 },
  ];

/**
 * Body length below which the score is held down, and to what.
 *
 * Measured in `text_units.v1`, so the same band applies to a page written with
 * word gaps and to one written without them. That unit is now published for
 * every page, which is why the byte approximation below is only a fallback.
 */
const UNIT_CAPS: readonly { readonly below: number; readonly ceiling: number }[] =
  [
    { below: 100, ceiling: 35 },
    { below: 300, ceiling: 55 },
    { below: 600, ceiling: 75 },
  ];

/**
 * The same ceilings for a crawl that carried no side-car to count with.
 *
 * Visible-text bytes at roughly three per CJK character, so these are the unit
 * thresholds restated in bytes rather than a second, looser standard. Reached
 * only when `staticBodyUnits` is absent; without any measure at all the
 * thin-content ceiling used to disappear entirely and a hundred-character page
 * scored 100.
 */
const BYTE_CAPS: readonly { readonly below: number; readonly ceiling: number }[] =
  [
    { below: 400, ceiling: 35 },
    { below: 1_000, ceiling: 55 },
    { below: 2_000, ceiling: 75 },
  ];

/**
 * Ceiling while the page cannot be indexed or does not resolve.
 *
 * Not a judgement about the markup, which may be perfect. It is that no amount
 * of on-page work reaches a search result from here, so no score above this can
 * mean what a visitor would read it to mean.
 */
const BLOCKED_CEILING = 30;
const UNREACHABLE_CEILING = 20;

/**
 * Ceiling when the keyword region could not be derived at all.
 *
 * Keyword placement is the largest graded category and the input to the topic
 * cap. Without it the remaining checks still grade, but they grade structure on
 * a page whose subject was never established — and dividing by a smaller
 * denominator made that page score *higher*, not lower. Measured: 100/A.
 */
const KEYWORD_UNMEASURED_CEILING = 60;

function gradeOf(score: number): ScoreGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 60) return "C";
  return "D";
}

function lowestCeiling(
  value: number | null,
  bands: readonly { readonly below: number; readonly ceiling: number }[],
): number | null {
  if (value === null) return null;
  for (const band of bands) {
    if (value < band.below) return band.ceiling;
  }
  return null;
}

export function buildOnPageScore(input: {
  readonly extract: SeoAuditTargetPageExtract;
  /** Null for a URL-only run: the visitor named no target query. */
  readonly evidence: KeywordEvidence | null;
  readonly siteResources: SeoAuditSiteResources;
  readonly siteRecords: readonly SeoAuditRecord[];
}): OnPageScore {
  const checkInput: CheckInput = {
    targetUrl: input.extract.url,
    extract: input.extract,
    evidence: input.evidence,
    siteResources: input.siteResources,
    siteRecords: input.siteRecords,
  };

  const checks = [
    ...metaChecks(checkInput),
    ...contentChecks(checkInput),
    ...keywordChecks(checkInput),
    ...linkChecks(checkInput),
    ...technicalChecks(checkInput),
    ...siteChecks(checkInput),
  ];

  const earned = checks.reduce((total, entry) => total + entry.score, 0);
  const available = checks.reduce((total, entry) => total + entry.max, 0);
  // A run where nothing could be graded scores nothing rather than 100: an
  // empty numerator over an empty denominator is not a perfect page.
  const raw = available === 0 ? 0 : Math.round((earned / available) * 100);
  // No query, no score. Every other field below is still measured and still
  // published — the checks ran, the category subtotals are complete for the
  // categories that ran — but the headline number would be read against pages
  // whose keyword category was graded, and it is not the same measurement.
  const scored = input.evidence !== null;

  const focus = topicFocus(checkInput);
  const candidates: { readonly reason: ScoreCap; readonly ceiling: number | null }[] =
    [
      { reason: "topic_focus", ceiling: lowestCeiling(focus, FOCUS_CAPS) },
      // Units when the crawl counted them, bytes when it did not. Never both:
      // one measure of length, one ceiling derived from it.
      input.extract.staticBodyUnits === null
        ? {
            reason: "body_bytes" as const,
            ceiling: lowestCeiling(
              input.extract.declared?.visibleTextBytes ?? null,
              BYTE_CAPS,
            ),
          }
        : {
            reason: "body_words" as const,
            ceiling: lowestCeiling(
              input.extract.staticBodyUnits.units,
              UNIT_CAPS,
            ),
          },
      {
        reason: "not_reachable",
        ceiling:
          input.extract.response.finalStatus !== null &&
          input.extract.response.finalStatus >= 400
            ? UNREACHABLE_CEILING
            : null,
      },
      {
        reason: "not_indexable",
        ceiling: input.extract.response.robotsIndexable ? null : BLOCKED_CEILING,
      },
      {
        reason: "keyword_unmeasured",
        // Only for a query that was named and could not be compared. Never
        // having asked is handled by publishing no score at all, and charging
        // this ceiling for it would mark a page down for the visitor's choice.
        ceiling:
          input.evidence === null || input.evidence.availability === "available"
            ? null
            : KEYWORD_UNMEASURED_CEILING,
      },
    ];

  const caps = scored
    ? candidates.filter(
        (candidate): candidate is {
          readonly reason: ScoreCap;
          readonly ceiling: number;
        } => candidate.ceiling !== null && candidate.ceiling < raw,
      )
    : // A ceiling bounds a number. With no number there is nothing to bound,
      // and listing ceilings beside an absent score reads as a penalty for
      // asking a question this run never asked.
      [];
  const score = scored
    ? caps.reduce((value, cap) => Math.min(value, cap.ceiling), raw)
    : null;

  const categories = CATEGORY_ORDER.map((category) => {
    const owned = checks.filter((entry) => entry.category === category);
    return {
      category,
      score: owned.reduce((total, entry) => total + entry.score, 0),
      max: owned.reduce((total, entry) => total + entry.max, 0),
      checks: owned,
    };
  }).filter((entry) => entry.checks.length > 0);

  return {
    version: SCORING_VERSION,
    score,
    grade: score === null ? null : gradeOf(score),
    earned,
    available,
    categories,
    checks,
    caps,
    topicFocus: focus,
    counts: {
      pass: checks.filter((entry) => entry.state === "pass").length,
      warn: checks.filter((entry) => entry.state === "warn").length,
      fail: checks.filter((entry) => entry.state === "fail").length,
      info: checks.filter((entry) => entry.state === "info").length,
      graded: checks.filter((entry) => entry.max > 0).length,
    },
  };
}
