// @input  -- one finished keyword opportunity result
// @output -- the funnel, the two lanes' tables, and what was held back
// @pos    -- read-only rendering for /[locale]/tools/hidden-keywords
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type {
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunityWithheld,
} from "@sf/public-tools/keyword-opportunity/types";

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";

/** Funnel steps in pipeline order, so the reader can follow where rows went. */
const FUNNEL_STEPS = [
  "generated",
  "deduplicated",
  "providerReturned",
  "providerNoData",
  "alreadyCovered",
  "serpSampled",
  "winnableEvidence",
  "shown",
] as const;

function Funnel({ result }: { readonly result: KeywordOpportunityResult }) {
  const t = useTranslations("tools.keywordMap");
  return (
    <div className={CARD}>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("funnelTitle")}
      </h3>
      <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("funnelIntro")}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-4">
        {FUNNEL_STEPS.map((step) => {
          const value = result.funnel[step];
          return (
            <div key={step}>
              <dt className={LABEL}>{t(`funnel.${step}`)}</dt>
              <dd className="mt-1 font-mono text-[18px] text-text-dark-primary tabular-nums">
                {/*
                 * Null is not zero and must not render as one. It means the
                 * Search Console sample was never read, so the count is a
                 * question nobody asked rather than an answer of none.
                 */}
                {value === null ? t("notMeasured") : value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function RowTable({
  rows,
  lane,
}: {
  readonly rows: readonly KeywordOpportunityRow[];
  readonly lane: "seo" | "geo";
}) {
  const t = useTranslations("tools.keywordMap");
  if (rows.length === 0) return null;

  return (
    <div className={CARD}>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t(`lane.${lane}.title`)}
      </h3>
      <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t(`lane.${lane}.intro`)}
      </p>

      {/* Wide on purpose; the page must never scroll sideways because of it. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-brand-border-card">
              <th scope="col" className={`${LABEL} pb-2`}>
                {t("columns.keyword")}
              </th>
              {lane === "seo" ? (
                <>
                  <th scope="col" className={`${LABEL} pb-2 text-right`}>
                    {t("columns.volume")}
                  </th>
                  <th scope="col" className={`${LABEL} pb-2 text-right`}>
                    {t("columns.difficulty")}
                  </th>
                  <th scope="col" className={`${LABEL} pb-2 text-right`}>
                    {t("columns.weakest")}
                  </th>
                </>
              ) : (
                <th scope="col" className={`${LABEL} pb-2`}>
                  {t("columns.supportingPage")}
                </th>
              )}
              <th scope="col" className={`${LABEL} pb-2`}>
                {t("columns.coverage")}
              </th>
              <th scope="col" className={`${LABEL} pb-2`}>
                {t("columns.nextChecks")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.keyword}
                className="border-b border-brand-border-card/60 align-top"
              >
                <td className="py-3 pr-4 text-[13.5px] text-text-dark-primary">
                  {row.keyword}
                </td>
                {lane === "seo" ? (
                  <>
                    <td className="py-3 pr-4 text-right font-mono text-[13px] text-text-dark-primary tabular-nums">
                      {row.validation.volume ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-[13px] text-text-dark-secondary tabular-nums">
                      {row.validation.difficulty ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-[13px] text-text-dark-secondary tabular-nums">
                      {row.serp.weakestTopTenDomainRank ?? "—"}
                    </td>
                  </>
                ) : (
                  <td className="py-3 pr-4 text-[12.5px] break-all text-text-dark-secondary">
                    {row.supportingPageUrl ?? "—"}
                  </td>
                )}
                <td className="py-3 pr-4 text-[12.5px] text-text-dark-secondary">
                  {t(`coverage.${row.coverage}`)}
                </td>
                <td className="py-3 text-[12.5px] text-text-dark-secondary">
                  <ul className="space-y-1">
                    {row.nextChecks.map((check) => (
                      <li key={check}>{t(`checks.${check}`)}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lane === "seo" ? (
        <p className="mt-3 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("weakestHint")}
        </p>
      ) : (
        <p className="mt-3 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("geoHint")}
        </p>
      )}
    </div>
  );
}

function Withheld({
  withheld,
}: {
  readonly withheld: readonly KeywordOpportunityWithheld[];
}) {
  const t = useTranslations("tools.keywordMap");
  if (withheld.length === 0) return null;

  // Grouped by reason rather than listed flat: a reader wants to know which
  // wall most candidates hit, and 142 rows of keyword-plus-reason is not a
  // readable answer to that.
  const byReason = new Map<string, string[]>();
  for (const entry of withheld) {
    byReason.set(entry.reason, [
      ...(byReason.get(entry.reason) ?? []),
      entry.keyword,
    ]);
  }

  return (
    <div className={CARD}>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("withheldTitle")}
      </h3>
      <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("withheldIntro")}
      </p>
      <div className="mt-4 space-y-4">
        {[...byReason.entries()].map(([reason, keywords]) => (
          <details key={reason} className="group">
            <summary className="cursor-pointer text-[13px] text-text-dark-primary marker:text-text-dark-secondary">
              {t(`withheld.${reason}`)}
              <span className="ml-2 font-mono text-[12px] text-text-dark-secondary tabular-nums">
                {keywords.length}
              </span>
            </summary>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[12.5px] text-text-dark-secondary">
              {keywords.map((keyword) => (
                <li key={keyword}>{keyword}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

export function KeywordMapResults({
  result,
}: {
  readonly result: KeywordOpportunityResult;
}) {
  const t = useTranslations("tools.keywordMap");
  const seo = result.rows.filter((row) => row.lane === "seo");
  const geo = result.rows.filter((row) => row.lane === "geo");

  return (
    <div className="mt-6 space-y-5">
      {/*
       * The run's own verdict on itself, first. A reader who scrolls straight
       * to the table must not have to infer from its length that a stage was
       * missing.
       */}
      {result.availability !== "available" ? (
        <p
          role="status"
          className="rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          {t(`availability.${result.availability}`)}
          {result.unavailableStages.length > 0 ? (
            <span className="mt-1 block">
              {t("stagesMissing", {
                stages: result.unavailableStages
                  .map((stage) => t(`stages.${stage}`))
                  .join(" · "),
              })}
            </span>
          ) : null}
        </p>
      ) : null}

      <RowTable rows={seo} lane="seo" />
      <RowTable rows={geo} lane="geo" />
      <Funnel result={result} />
      <Withheld withheld={result.withheld} />

      {result.nextStepSuggestions.length > 0 ? (
        <div className={CARD}>
          <h3 className="text-[15px] font-semibold text-text-dark-primary">
            {t("nextStepsTitle")}
          </h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-[1.6] text-text-dark-secondary">
            {result.nextStepSuggestions.map((step) => (
              <li key={step}>{t(`nextSteps.${step}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
