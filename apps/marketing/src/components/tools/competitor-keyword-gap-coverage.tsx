// @input  -- one v3 competitor gap envelope, the viewer locale, and the tool translator
// @output -- per-competitor coverage cards with the sample rule, run limitations, and the six evidence boundaries
// @pos    -- stateless coverage and boundary sections below the Marketing competitor gap results table

import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapResultV3,
} from "@sf/public-tools/competitor-keyword-gap";

import {
  BADGE,
  CARD,
  number,
  translated,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

const EVIDENCE_BOUNDARIES = [
  "dfsEstimates",
  "gscOwnSample",
  "competitorOutcomesUnavailable",
  "manualSnapshot",
  "dfsSnapshot",
  "preScreen",
] as const;

/** GSC answered but returned nothing: distinct from "not observed", and worth a property check. */
export function gscReturnedNoRows(
  result: CompetitorKeywordGapResultV3,
): boolean {
  return result.overlayStatus === "available" && result.gscQueryRowCount === 0;
}

function CoverageCards({
  result,
  locale,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-text-dark-primary">
            {t("coverage.title")}
          </h3>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("coverage.scope", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}
          </div>
        </div>
        <span className={BADGE}>
          {t("coverage.requested", { count: result.requestedCompetitors })}
        </span>
      </div>
      <div
        data-sample-rule
        className="mt-3 text-[12px] leading-[1.6] text-text-dark-secondary"
      >
        {t("coverage.sampleRule", {
          maxRank: result.sampleRule.maxCompetitorRank,
          limit: result.sampleRule.perCompetitorLimit,
        })}
      </div>
      <ul className="mt-4 grid gap-3 xl:grid-cols-2">
        {result.competitors.map((competitor) => (
          <li
            key={competitor.domain}
            data-competitor-status={competitor.status}
            className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-text-dark-primary">
                {competitor.domain}
              </span>
              <span className={BADGE}>
                {translated(t, `coverage.${competitor.status}`)}
              </span>
            </div>
            <div className="mt-2 text-[12px] text-text-dark-secondary">
              {competitor.totalCount === null
                ? t("coverage.rows", {
                    returned: number(competitor.returnedRows, locale),
                    total: "—",
                  })
                : t("coverage.rowsInRule", {
                    returned: number(competitor.returnedRows, locale),
                    total: number(competitor.totalCount, locale),
                  })}
            </div>
            {competitor.failureCode !== null ? (
              <div className="mt-1 text-[11.5px] text-text-dark-secondary">
                {t("coverage.failure", { code: competitor.failureCode })}
              </div>
            ) : null}
            {competitor.truncated ? (
              <div className="mt-1.5 text-[12px] text-brand-warning">
                {t("coverage.truncated")}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Limitations({
  result,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly t: Translate;
}) {
  const items = [
    ...(result.resultTruncated ? ["limitations.resultTruncated"] : []),
    ...(result.gscQueryTruncated ? ["limitations.gscQueryTruncated"] : []),
    ...(result.gscQueryPageTruncated
      ? ["limitations.gscQueryPageTruncated"]
      : []),
    ...(result.overlayStatus === "unavailable"
      ? ["limitations.gscUnavailable"]
      : []),
    ...(gscReturnedNoRows(result) ? ["limitations.gscNoRows"] : []),
  ];
  if (items.length === 0) return null;
  return (
    <section className="rounded-card border border-brand-warning/30 bg-brand-warning/[0.08] p-[22px]">
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("limitations.title")}
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {items.map((key) => (
          <li key={key}>{translated(t, key)}</li>
        ))}
      </ul>
    </section>
  );
}

export function CoverageDetails({
  envelope,
  locale,
  t,
}: {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { result } = envelope;
  const hasWarning =
    envelope.run.status !== "complete" ||
    result.resultTruncated ||
    result.gscQueryTruncated ||
    result.gscQueryPageTruncated ||
    result.overlayStatus === "partial" ||
    result.overlayStatus === "unavailable" ||
    gscReturnedNoRows(result) ||
    result.competitors.some(
      (competitor) =>
        competitor.status === "unavailable" || competitor.truncated,
    );

  return (
    <details data-coverage-details open={hasWarning} className={CARD}>
      <summary className="cursor-pointer text-[15px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
        {t("coverage.detailsSummary")}
      </summary>
      <div className="mt-4 space-y-4">
        <CoverageCards result={result} locale={locale} t={t} />
        <Limitations result={result} t={t} />
      </div>
    </details>
  );
}

export function EvidenceBoundaries({ t }: { readonly t: Translate }) {
  return (
    <section data-evidence-boundaries className={CARD}>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("boundaries.title")}
      </h3>
      <ul className="mt-3 grid gap-2 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
        {EVIDENCE_BOUNDARIES.map((key) => (
          <li key={key} className="rounded-[10px] bg-brand-bg px-4 py-3">
            {translated(t, `boundaries.${key}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
