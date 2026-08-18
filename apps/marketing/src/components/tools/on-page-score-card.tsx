"use client";

// @input  -- one finished score and the page facts behind it
// @output -- the headline number, category bars, and the page's own vitals
// @pos    -- the top of the evidence stage, above the per-check detail
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";
import type { OnPageScore } from "../../lib/on-page-checker/scoring.ts";

function gradeTone(grade: OnPageScore["grade"]): string {
  if (grade === "A") return "text-brand-accent-text";
  if (grade === "B") return "text-brand-accent-text";
  if (grade === "C") return "text-brand-warning";
  return "text-brand-error";
}

function barTone(score: number, max: number): string {
  if (max === 0) return "bg-brand-border-card";
  const share = score / max;
  if (share >= 0.9) return "bg-brand-accent";
  if (share >= 0.6) return "bg-brand-warning";
  return "bg-brand-error";
}

/** One page vital, shown as a chip. Absent values are omitted, never zeroed. */
function Vital({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="rounded-md border border-brand-border-card px-2.5 py-1 font-mono text-[11.5px] text-text-dark-secondary">
      {label} <span className="text-text-dark-primary">{value}</span>
    </span>
  );
}

export function OnPageScoreCard({
  score,
  extract,
}: {
  readonly score: OnPageScore;
  readonly extract: SeoAuditTargetPageExtract;
}) {
  const t = useTranslations("tools.onPageChecker");
  const tc = useTranslations("tools.onPageChecker.scoreCategories");
  const declared = extract.declared;
  const response = extract.response;

  const vitals: readonly { readonly label: string; readonly value: string }[] = [
    response.finalStatus === null
      ? null
      : { label: t("vitals.status"), value: String(response.finalStatus) },
    response.responseMs === null
      ? null
      : { label: t("vitals.responseMs"), value: `${response.responseMs}ms` },
    declared === null
      ? null
      : {
          label: t("vitals.htmlSize"),
          value: `${Math.round(declared.htmlBytes / 1024)}KB`,
        },
    extract.staticBodyWords === null
      ? null
      : { label: t("vitals.words"), value: String(extract.staticBodyWords) },
    {
      label: t("vitals.internalLinks"),
      value: String(response.internalOutlinks),
    },
    declared === null
      ? null
      : {
          label: t("vitals.externalLinks"),
          value: String(declared.externalLinks.total),
        },
    declared === null
      ? null
      : { label: t("vitals.images"), value: String(declared.images.total) },
    declared?.lang == null
      ? null
      : { label: t("vitals.lang"), value: declared.lang },
  ].filter(
    (entry): entry is { readonly label: string; readonly value: string } =>
      entry !== null,
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <p
          className={`font-mono text-[44px] leading-none tabular-nums ${gradeTone(score.grade)}`}
        >
          {score.score}
        </p>
        <div className="grid gap-1">
          <p className={`text-[15px] ${gradeTone(score.grade)}`}>
            {t(`grades.${score.grade}`)}
          </p>
          <p className="text-[12.5px] text-text-dark-faint">
            {t("score.counts", {
              pass: score.counts.pass,
              graded: score.counts.graded,
              warn: score.counts.warn,
              fail: score.counts.fail,
            })}
          </p>
        </div>
        {score.topicFocus !== null && (
          <span className="rounded-full border border-brand-border-card px-3 py-1 font-mono text-[11.5px] text-text-dark-secondary">
            {t("score.topicFocus", {
              percent: Math.round(score.topicFocus * 100),
            })}
          </span>
        )}
      </div>

      {/*
        A capped score would otherwise be unexplainable: the checks on screen
        add up to more than the number above them.
      */}
      {score.caps.length > 0 && (
        <div className="grid gap-1 rounded-lg border border-brand-warning/40 bg-brand-warning/5 p-3">
          {score.caps.map((cap) => (
            <p className="text-[13px] text-brand-warning" key={cap.reason}>
              {t(`score.caps.${cap.reason}`, { ceiling: cap.ceiling })}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {score.categories
          .filter((category) => category.max > 0)
          .map((category) => (
            <div className="grid gap-1.5" key={category.category}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] text-text-dark-primary">
                  {tc(category.category)}
                </p>
                <p className="font-mono text-[11.5px] tabular-nums text-text-dark-faint">
                  {category.score}/{category.max}
                </p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-brand-border-card">
                <div
                  className={`h-full rounded-full ${barTone(category.score, category.max)}`}
                  style={{
                    width: `${category.max === 0 ? 0 : Math.round((category.score / category.max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {vitals.map((vital) => (
          <Vital key={vital.label} label={vital.label} value={vital.value} />
        ))}
      </div>

      <p className="text-[12.5px] leading-[1.6] text-text-dark-faint">
        {t("score.disclaimer")}
      </p>
    </div>
  );
}
