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
 * Two failures make the rest of the sheet beside the point. A page that is not
 * about the keyword can have flawless markup and still never rank for it, and
 * a page with almost no copy has nothing for the other checks to be about.
 * Without a cap, both would score in the eighties on structure alone.
 */
export type ScoreCap = "topic_focus" | "body_words";

export interface OnPageScore {
  readonly version: typeof SCORING_VERSION;
  readonly score: number;
  readonly grade: ScoreGrade;
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

/** Static body words below which the score is held down, and to what. */
const WORD_CAPS: readonly { readonly below: number; readonly ceiling: number }[] =
  [
    { below: 100, ceiling: 35 },
    { below: 300, ceiling: 55 },
    { below: 600, ceiling: 75 },
  ];

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
  readonly evidence: KeywordEvidence;
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

  const focus = topicFocus(checkInput);
  const caps: { readonly reason: ScoreCap; readonly ceiling: number }[] = [];
  const focusCeiling = lowestCeiling(focus, FOCUS_CAPS);
  if (focusCeiling !== null && focusCeiling < raw) {
    caps.push({ reason: "topic_focus", ceiling: focusCeiling });
  }
  const wordCeiling = lowestCeiling(input.extract.staticBodyWords, WORD_CAPS);
  if (wordCeiling !== null && wordCeiling < raw) {
    caps.push({ reason: "body_words", ceiling: wordCeiling });
  }
  const score = caps.reduce((value, cap) => Math.min(value, cap.ceiling), raw);

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
    grade: gradeOf(score),
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
