// @input  -- one QuickWinsResult from /api/tools/quick-wins
// @output -- the evidence table, the site's CTR curve, and everything we could not measure
// @pos    -- presentation only; every judgement it could make was left to the reader
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type { QuickWinsResult } from "@sf/public-tools";

/** Below this a probability is shown as a floor, never as a bare 0. */
const TAIL_FLOOR = 0.0001;

function percent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function count(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * A probability that underflowed is not an impossibility.
 *
 * Printing the literal 0 that double precision produces for an extreme tail
 * would tell the reader the result cannot happen, when what happened is that
 * we ran out of exponent.
 */
function tail(value: number | null): string {
  if (value === null) return "—";
  if (value < TAIL_FLOOR) return `< ${TAIL_FLOOR}`;
  return value.toFixed(4);
}

export function QuickWinsResults({ result }: { readonly result: QuickWinsResult }) {
  const t = useTranslations("tools.quickWins");
  const hasRows = result.rows.length > 0;

  return (
    <div className="mt-8 space-y-8">
      {/*
        The measured days, stated before any number. A 28-day table ending
        three days in the past reads as current unless the page says which
        days it covers.
      */}
      <p className="text-[13px] text-text-dark-secondary">
        {t("window", {
          startDate: result.window.startDate,
          endDate: result.window.endDate,
        })}
      </p>

      {hasRows ? (
        <section>
          <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
            {t("tableTitle")}
          </h3>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
            {t("tableIntro")}
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-brand-border/60">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-brand-bg-alt/50 text-[12px] text-text-dark-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("columns.query")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.position")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.impressions")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.clicks")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.observedCtr")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.baselineCtr")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.clickGap")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("columns.tailProbability")}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={row.query}
                    className="border-t border-brand-border/40 align-top"
                  >
                    <td className="px-3 py-2.5 text-text-dark-primary">
                      {row.query}
                      {row.baselineBandUnderOnePercent ? (
                        <span
                          title={t("bandWarning")}
                          className="ml-2 rounded border border-brand-warning/40 px-1.5 py-0.5 text-[11px] text-text-dark-secondary"
                        >
                          {row.bucketId}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{row.position.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{count(row.impressions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{count(row.clicks)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-primary">{percent(row.observedCtr)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{percent(row.baselineCtr)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-primary">
                      {row.clickGap >= 0 ? "+" : ""}
                      {count(row.clickGap)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{tail(row.tailProbability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
            {t("gapNote")}
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
            {t("tailNote")}
          </p>
        </section>
      ) : (
        <section className="rounded-xl border border-brand-border/60 bg-brand-bg/60 p-5">
          <h3 className="text-[15px] font-semibold text-text-dark-primary">
            {t("emptyTitle")}
          </h3>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
            {t("emptyBody")}
          </p>
        </section>
      )}

      <section>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
          {t("curveTitle")}
        </h3>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
          {t("curveIntro")}
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-brand-border/60">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="bg-brand-bg-alt/50 text-[12px] text-text-dark-secondary">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">{t("curveColumns.band")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("curveColumns.queries")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("curveColumns.impressions")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("curveColumns.ctr")}</th>
                <th scope="col" className="px-3 py-2.5 font-medium">{t("curveColumns.quality")}</th>
              </tr>
            </thead>
            <tbody>
              {result.curve.buckets.map((bucket) => (
                <tr key={bucket.bucketId} className="border-t border-brand-border/40">
                  <td className="px-3 py-2.5 text-text-dark-primary">{bucket.bucketId}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{count(bucket.queryCount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">{count(bucket.impressions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-primary">{percent(bucket.ctr)}</td>
                  <td className="px-3 py-2.5 text-text-dark-secondary">
                    {t(`bucketQuality.${bucket.quality}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result.curve.brandRowsExcluded > 0 ? (
          <p className="mt-3 text-[12px] text-text-dark-secondary">
            {t("brandExcluded", { count: result.curve.brandRowsExcluded })}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-brand-border/60 bg-brand-bg/60 p-5">
        <h3 className="text-[15px] font-semibold text-text-dark-primary">
          {t("anonymizationTitle")}
        </h3>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
          {result.anonymization === null ||
          result.anonymization.missingImpressionShare === null
            ? t("anonymizationUnknown")
            : t("anonymizationBody", {
                impressionShare: percent(
                  result.anonymization.missingImpressionShare,
                  0,
                ),
                clickShare: percent(result.anonymization.missingClickShare, 0),
              })}
        </p>
      </section>

      <DraftSection result={result} />

      <ExcludedCounts result={result} />

      <section>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
          {t("limitationsTitle")}
        </h3>
        <ul className="mt-3 space-y-3">
          {result.limitations.map((code) => (
            <li
              key={code}
              className="max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary"
            >
              {t(`limitations.${code}`)}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
          {t("storageNote")}
        </p>
      </section>
    </div>
  );
}

/**
 * Wording candidates, each shown with the page it was modelled on.
 *
 * The source link is not decoration. A draft nobody can trace to a named page
 * on their own site is generic advice, and generic advice is what got drafts
 * cut from v1; being able to open the comparable page and judge the pattern
 * is the only reason they were allowed back.
 */
function DraftSection({ result }: { readonly result: QuickWinsResult }) {
  const t = useTranslations("tools.quickWins");
  const skipped = Object.entries(result.draftsSkipped);
  if (result.drafts.length === 0 && skipped.length === 0) return null;

  return (
    <section>
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
        {t("draftsTitle")}
      </h3>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
        {t("draftsIntro")}
      </p>

      {result.drafts.length === 0 ? (
        <p className="mt-4 max-w-2xl rounded-xl border border-brand-border/60 bg-brand-bg/60 p-4 text-[13px] leading-relaxed text-text-dark-secondary">
          {t("draftsNone")}
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {result.drafts.map((draft) => (
            <li
              key={draft.query}
              className="rounded-xl border border-brand-border/60 bg-brand-bg/60 p-4"
            >
              <p className="text-[13px] font-medium text-text-dark-primary">
                {draft.query}
              </p>
              <dl className="mt-2 space-y-1.5 text-[13px]">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-text-dark-secondary">
                    {t("draftTitleLabel")}
                  </dt>
                  <dd className="text-text-dark-primary">{draft.title}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-text-dark-secondary">
                    {t("draftMetaLabel")}
                  </dt>
                  <dd className="text-text-dark-primary">
                    {draft.metaDescription}
                  </dd>
                </div>
              </dl>
              <p className="mt-2.5 text-[12px] text-text-dark-secondary">
                {t("draftsSource")}{" "}
                <a
                  href={draft.comparablePage}
                  rel="noreferrer nofollow"
                  target="_blank"
                  className="underline hover:no-underline"
                >
                  {draft.comparablePage}
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {skipped.map(([query, reason]) => (
            <li
              key={query}
              className="max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary"
            >
              <span className="text-text-dark-primary">{query}</span>
              {" — "}
              {t(`draftSkipped.${reason}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ExcludedCounts({ result }: { readonly result: QuickWinsResult }) {
  const t = useTranslations("tools.quickWins");
  const entries = Object.entries(result.excluded).filter(
    ([, value]) => value > 0,
  );
  if (entries.length === 0) return null;

  return (
    <section>
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
        {t("excludedTitle")}
      </h3>
      <ul className="mt-3 space-y-2">
        {entries.map(([reason, value]) => (
          <li
            key={reason}
            className="max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary"
          >
            {t(`exclusions.${reason}`, { count: value })}
          </li>
        ))}
      </ul>
    </section>
  );
}
