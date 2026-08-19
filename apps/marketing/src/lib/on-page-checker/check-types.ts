// @input  -- nothing; the shared vocabulary the on-page checks are written in
// @output -- check identity, outcome, category and the input bundle they read
// @pos    -- the seam between the neutral audit facts and this tool's judgement
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditSiteResources,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";

/**
 * Why judgement lives here and not in `@sf/public-tools`.
 *
 * That package's standing constraint is that it records observations and does
 * not grade them — the audit says a title is 71 characters, never that 71 is
 * bad. Scoring is a product opinion with weights we chose, so it belongs to the
 * tool that publishes the opinion. The facts below arrive already measured;
 * nothing here re-measures the page.
 */

/** Outcome of one check. `info` carries an observation that is not a verdict. */
export type CheckState = "pass" | "warn" | "fail" | "info";

export type CheckCategory =
  | "meta"
  | "content"
  | "keyword"
  | "links"
  | "media"
  | "social"
  | "technical"
  | "site";

/**
 * One finished check.
 *
 * `detail` names an i18n message and the values it interpolates rather than a
 * sentence, so the same check reads in either language and no English leaks
 * into a Chinese report.
 */
export interface OnPageCheck {
  readonly id: string;
  readonly category: CheckCategory;
  readonly state: CheckState;
  /** Points earned. Always 0 when `max` is 0. */
  readonly score: number;
  /**
   * Points available.
   *
   * Zero marks an observation that does not participate in the score — a fact
   * worth showing that we will not pretend to have graded.
   */
  readonly max: number;
  readonly detail: CheckDetail;
}

export interface CheckDetail {
  /** Message key under `tools.onPageChecker.checks`. */
  readonly key: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

/** Everything a check may read. Assembled once, passed to every check. */
export interface CheckInput {
  readonly targetUrl: string;
  readonly extract: SeoAuditTargetPageExtract;
  readonly evidence: KeywordEvidence;
  readonly siteResources: SeoAuditSiteResources;
  /**
   * Site-wide rules that named this page.
   *
   * Only rules whose population is every collected page can be read as a clean
   * pass when the page is absent from them; a conditional subset says nothing
   * about a page that never qualified, so those are only ever reported when the
   * page is present.
   */
  readonly siteRecords: readonly SeoAuditRecord[];
}

export function check(
  id: string,
  category: CheckCategory,
  state: CheckState,
  score: number,
  max: number,
  key: string,
  values?: Readonly<Record<string, string | number>>,
): OnPageCheck {
  return {
    id,
    category,
    state,
    score,
    max,
    detail: values === undefined ? { key } : { key, values },
  };
}

/** An observation shown but not graded. */
export function observation(
  id: string,
  category: CheckCategory,
  key: string,
  values?: Readonly<Record<string, string | number>>,
): OnPageCheck {
  return check(id, category, "info", 0, 0, key, values);
}

/**
 * The message key holding a check's display name.
 *
 * Site-wide checks are namespaced because their ids collide with page-level
 * ones. Shared so the list on screen and the copied report cannot disagree
 * about what a check is called.
 */
export function checkLabelKey(entry: OnPageCheck): string {
  return entry.category === "site"
    ? `site.${entry.id}._label`
    : `${entry.id}._label`;
}
