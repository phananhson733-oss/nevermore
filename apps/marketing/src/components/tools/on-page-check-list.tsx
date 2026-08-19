"use client";

// @input  -- the finished checks, grouped by category
// @output -- the per-check verdict list, one collapsible block per category
// @pos    -- the detail behind the headline score
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";
import type {
  CheckState,
  OnPageCheck,
} from "../../lib/on-page-checker/check-types.ts";
import { checkLabelKey } from "../../lib/on-page-checker/check-types.ts";
import type { CategoryScore } from "../../lib/on-page-checker/scoring.ts";

const STATE_MARK: Readonly<Record<CheckState, string>> = {
  pass: "✓",
  warn: "!",
  fail: "✕",
  info: "i",
};

const STATE_TONE: Readonly<Record<CheckState, string>> = {
  pass: "text-brand-accent-text",
  warn: "text-brand-warning",
  fail: "text-brand-error",
  info: "text-text-dark-faint",
};

/**
 * The message path for a check's own name.
 *
 * Site-wide rules are keyed by their audit rule id, which lives under its own
 * namespace so a rule and a markup check can never collide on a name.
 */
export function OnPageCheckList({
  categories,
}: {
  readonly categories: readonly CategoryScore[];
}) {
  const t = useTranslations("tools.onPageChecker");
  const tc = useTranslations("tools.onPageChecker.scoreCategories");
  const tk = useTranslations("tools.onPageChecker.checks");

  return (
    <div className="grid gap-3">
      {categories.map((category) => {
        const failed = category.checks.some((entry) => entry.state === "fail");
        const warned = category.checks.some((entry) => entry.state === "warn");
        // A category holding nothing but observations was never graded, and a
        // green tick on it reads as "we checked these and they passed". The
        // page with no images was the case that exposed it.
        const graded = category.max > 0;
        const mark: CheckState = !graded
          ? "info"
          : failed
            ? "fail"
            : warned
              ? "warn"
              : "pass";
        return (
          <details
            className="rounded-xl border border-brand-border-card bg-brand-panel"
            key={category.category}
            // Anything with something wrong in it opens on arrival: a visitor
            // should not have to hunt for the reason the score is what it is.
            open={failed || warned}
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2.5 px-4 py-3 md:px-5">
              <span
                aria-hidden="true"
                className={`font-mono text-[13px] ${STATE_TONE[mark]}`}
              >
                {STATE_MARK[mark]}
              </span>
              <span className="text-[14.5px] text-text-dark-primary">
                {tc(category.category)}
              </span>
              {category.max > 0 && (
                <span className="font-mono text-[11.5px] tabular-nums text-text-dark-faint">
                  {category.score} / {category.max}
                </span>
              )}
            </summary>
            <div className="grid gap-0 border-t border-brand-border-card">
              {category.checks.map((entry) => (
                <div
                  className="grid gap-1 border-b border-brand-border-card/60 px-4 py-3 last:border-b-0 md:px-5"
                  key={entry.id}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className={`font-mono text-[12px] ${STATE_TONE[entry.state]}`}
                    >
                      {STATE_MARK[entry.state]}
                    </span>
                    <span className="text-[13.5px] text-text-dark-primary">
                      {tk(checkLabelKey(entry))}
                    </span>
                    {entry.max > 0 ? (
                      <span className="font-mono text-[11px] tabular-nums text-text-dark-faint">
                        {entry.score}/{entry.max}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-text-dark-faint">
                        {t("score.notGraded")}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] leading-[1.65] text-text-dark-secondary">
                    {tk(entry.detail.key, entry.detail.values)}
                  </p>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
