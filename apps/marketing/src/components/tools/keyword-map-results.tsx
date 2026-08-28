// @input  -- one finished keyword opportunity result and the page's locale
// @output -- a compact run summary, decision lanes, mounted row evidence, gaps, groups, and exclusions
// @pos    -- read-only rendering for /[locale]/tools/low-competition-keywords
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type {
  KeywordOpportunityCluster,
  KeywordOpportunityIncomplete,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunitySignalEvidence,
  KeywordOpportunityWithheld,
} from "@sf/public-tools/keyword-opportunity/types";
import {
  KEYWORD_STAGE_GSC_COVERAGE,
  KEYWORD_STAGE_SERP_SAMPLE,
} from "@sf/public-tools/keyword-opportunity/types";
import type { KeywordOpportunityCheck } from "@sf/public-tools/keyword-opportunity/types";
import {
  keywordOpportunityCsv,
  keywordOpportunityCsvFilename,
  keywordOpportunityDisplayRows,
} from "@sf/public-tools/keyword-opportunity/csv";
// Relative, not `@/`: the shared Vitest config maps `@/` to apps/web only, so
// an aliased import would make this file unimportable from a test.
import { formatCount } from "../../lib/tools/quick-wins-format";
import { localePath } from "../../lib/locale-path";

/** The shared console's surfaces, so this report reads like its siblings. */
const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const SECTION_TITLE = "text-[16.5px] font-semibold text-text-dark-primary";
const SECTION_INTRO =
  "mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary";
const LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
/** Keyword pills, same shape the quick-wins actions use for their query lists. */
const PILL =
  "rounded-full border border-brand-border-strong bg-brand-panel-sunken px-3 py-1 font-mono text-[11px] text-text-dark-primary";
const NAV_LINK =
  "flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info";
const TABLE_TEXT = "text-[13px] leading-[1.45]";
const META_TEXT = "text-[12px] leading-[1.35]";
const KEYWORD_TEXT =
  "text-[15.5px] font-semibold leading-[1.25] text-text-dark-primary";
const DATA_CHIP =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] border border-brand-border-strong bg-brand-panel-sunken px-2 py-[3px] font-mono text-[11.5px] leading-[1.35] text-text-dark-primary";
const STATE_PILL =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] leading-[1.3]";

/**
 * The gates a candidate passes, in the order it passes them.
 *
 * `providerReturned` is deliberately absent even though the payload carries
 * it: it is exactly `volumePositive + explicitZero`, and those two are the
 * ones that mean something. A term the provider priced at zero and a term the
 * provider had nothing on are different facts — the whole three-state volume
 * design exists to keep them apart — and folding them into one tile hid the
 * distinction on the surface built to show it.
 */
export const FUNNEL_STEPS = [
  "generated",
  "deduplicated",
  "providerNoData",
  "explicitZero",
  "volumePositive",
  "alreadyCovered",
  "serpSampled",
  "winnableEvidence",
  "shown",
] as const;

/**
 * Fixed, not `auto-fit`.
 *
 * The tiles are hairline-separated by a 1px gap over the container's colour,
 * so any column the last row does not fill renders as a slab of divider
 * colour rather than as nothing. An `auto-fit` track count changes with the
 * viewport, which means no arrangement of the gates avoids it at every width.
 * Three columns divide the gate count exactly; `funnelGridDividesEvenly`
 * guards the pairing.
 */
export const FUNNEL_COLUMNS = 3;

/**
 * The stage each gate's count comes out of, where one exists.
 *
 * `funnel.alreadyCovered` arrives as `null` when its stage did not run, but
 * the SERP counters do not: a failed sampling stage leaves `serpSampled: 0`
 * and `winnableEvidence: 0`, which read as "we looked at twenty page ones and
 * found nothing" on the same card whose verdict says nobody looked at all.
 * The rule is the same for every tile — a gate whose stage is missing has no
 * count — so it is written once here rather than left to the payload's shape.
 *
 * `serp_sample_cost_capped` is deliberately not in this map. A capped run
 * sampled fewer page ones than it wanted to, but the ones it did sample are
 * real, and blanking a partial measurement is its own kind of lie.
 */
const STEP_STAGE: Partial<Record<(typeof FUNNEL_STEPS)[number], string>> = {
  alreadyCovered: KEYWORD_STAGE_GSC_COVERAGE,
  serpSampled: KEYWORD_STAGE_SERP_SAMPLE,
  winnableEvidence: KEYWORD_STAGE_SERP_SAMPLE,
};

export function funnelGridDividesEvenly(): boolean {
  return FUNNEL_STEPS.length % FUNNEL_COLUMNS === 0;
}

/**
 * A label for a payload value this bundle may have no copy for.
 *
 * Every key on this surface built from the result is routed through here, and
 * the reason is a deploy, not a type. Compile-time completeness proves the
 * bundle knows every member of the union **in the same build**. A visitor's
 * tab holds the bundle from whichever build it loaded, and this tool's second
 * request lands minutes later — so a run started before a release and finished
 * after it asks an old bundle to name a value only the new one has.
 *
 * That is not hypothetical. Splitting `no_measured_demand` into
 * `volume_priced_at_zero` / `volume_not_returned` shipped on 2026-08-11, and
 * the first real run afterwards rendered
 * "tools.keywordMap.withheld.volume_not_returned  48" in the held-back list,
 * because next-intl resolves a missing key to its own dotted path rather than
 * throwing. The bare value is terse but it is the thing itself; the dotted
 * path is our internals in front of a visitor.
 */
function useOptionalLabel(): (key: string, fallback: string) => string {
  const t = useTranslations("tools.keywordMap");
  return (key, fallback) => {
    // Built from payload data, so it cannot be proved a member of the
    // message-key union at compile time — which is the reason this exists.
    const candidate = key as Parameters<typeof t.has>[0];
    return t.has(candidate) ? t(candidate) : fallback;
  };
}

export function KeywordMapResults({
  result,
  locale,
  onRetryWithSeeds,
}: {
  readonly result: KeywordOpportunityResult;
  readonly locale: string;
  /**
   * Carries a withheld group back into the seed field for a narrower re-run.
   * Optional so the component stays renderable from a test or a static
   * context that has no live tool above it.
   */
  readonly onRetryWithSeeds?: (keywords: readonly string[]) => void;
}) {
  // The shared v2 order uses positive-signal count, AIO discount, volume and a
  // stable keyword tie-break inside each lane. It lives in one helper so the
  // CSV export cannot disagree with the tables about order.
  const ordered = keywordOpportunityDisplayRows(result.rows);
  const seo = ordered.filter((row) => row.lane === "seo");
  const geo = ordered.filter((row) => row.lane === "geo");
  // A group of one is not a group. Every keyword that matched nothing becomes
  // its own cluster in the payload, so rendering them all turns "terms that
  // belong on one page" into a second copy of the results table.
  const groups = result.clusters.filter(
    (cluster) => cluster.keywords.length > 1,
  );
  const incomplete = result.incomplete ?? [];

  return (
    <div className="mt-8 space-y-4">
      <Verdict result={result} />
      <ResultSummary
        result={result}
        locale={locale}
        incompleteCount={incomplete.length}
      />

      {result.rows.length === 0 && incomplete.length === 0 ? (
        <EmptyState degraded={result.unavailableStages.length > 0} />
      ) : result.rows.length > 0 ? (
        <>
          <RowTable rows={seo} lane="seo" locale={locale} />
          <RowTable rows={geo} lane="geo" locale={locale} />
        </>
      ) : null}

      <Incomplete incomplete={incomplete} />
      <Groups groups={groups} />
      <Withheld
        withheld={result.withheld}
        onRetryWithSeeds={onRetryWithSeeds}
      />
      <WhereNext locale={locale} />
    </div>
  );
}

/**
 * The one copy of a run that survives the tab.
 *
 * Workflow checkpoints are temporary execution state, not a report history.
 * This download remains the visitor-owned durable copy of the visible rows.
 * It carries the same evidence as the tables, blanks included — an unavailable
 * number stays an empty cell rather than becoming a zero.
 */
function ExportButton({
  result,
}: {
  readonly result: KeywordOpportunityResult;
}) {
  const t = useTranslations("tools.keywordMap");

  function download() {
    const blob = new Blob([keywordOpportunityCsv(result)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = keywordOpportunityCsvFilename(result);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] border border-brand-border-strong px-4 text-[13px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
    >
      {t("exportCsv")}
    </button>
  );
}

/** Download the public evidence ledger; Workflow checkpoint writes happen upstream. */
function AuditJsonButton({
  result,
}: {
  readonly result: KeywordOpportunityResult;
}) {
  const t = useTranslations("tools.keywordMap");

  function download() {
    const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `keyword-opportunity-audit-${result.marketCode.toLowerCase()}-${result.languageCode.toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] border border-brand-border-strong px-4 text-[13px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
    >
      {t("exportAuditJson")}
    </button>
  );
}

/**
 * What the run thinks of itself, and what to change — together, at the top.
 *
 * The suggestions are only ever populated by a degraded run: thin context, too
 * few surviving rows, or a stage that did not complete. That makes them the
 * answer to the first question a disappointing report raises, and they used to
 * sit below the withheld list — the furthest point from the reader who needed
 * them most.
 */
function Verdict({ result }: { readonly result: KeywordOpportunityResult }) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const degraded = result.availability !== "available";
  if (!degraded && result.nextStepSuggestions.length === 0) return null;

  return (
    /*
     * Not a live region, though the banner it replaced was one. The tool that
     * renders this already keeps an `sr-only` `role="status"` for the run
     * finishing, and both would fire on the same tick — two announcements
     * competing, one of them content the reader is about to reach anyway,
     * since this is the first thing in the report.
     */
    <section className="rounded-card border border-brand-warning/25 bg-brand-warning/[0.08] p-[22px] md:p-[26px]">
      {degraded ? (
        <>
          <p className="text-[13.5px] leading-[1.6] text-brand-warning">
            {label(`availability.${result.availability}`, result.availability)}
          </p>
          {result.unavailableStages.length > 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-brand-warning">
              {t("stagesMissing", {
                stages: result.unavailableStages
                  .map((stage) => label(`stages.${stage}`, stage))
                  .join(" · "),
              })}
            </p>
          ) : null}
        </>
      ) : null}

      {result.nextStepSuggestions.length > 0 ? (
        <div className={degraded ? "mt-4" : ""}>
          <p className={LABEL}>{t("nextStepsTitle")}</p>
          <ul className="mt-2 space-y-1.5">
            {result.nextStepSuggestions.map((step) => (
              <li
                key={step}
                className="text-[13px] leading-[1.6] text-text-dark-primary"
              >
                {label(`nextSteps.${step}`, step)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** False when this gate's count comes out of a stage that did not run. */
export function stageRan(
  step: (typeof FUNNEL_STEPS)[number],
  unavailableStages: readonly string[],
): boolean {
  const stage = STEP_STAGE[step];
  return stage === undefined || !unavailableStages.includes(stage);
}

/** Scope, outcome and the optional screening trace in one compact surface. */
function ResultSummary({
  result,
  locale,
  incompleteCount,
}: {
  readonly result: KeywordOpportunityResult;
  readonly locale: string;
  readonly incompleteCount: number;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();

  return (
    <section data-result-summary="" className={CARD}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className={SECTION_TITLE}>{t("eligibleTitle")}</h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("runContext", {
              site: result.context.siteUrl,
              market: label(`markets.${result.marketCode}`, result.marketCode),
              language: label(
                `languages.${result.languageCode}`,
                result.languageCode,
              ),
              pages: result.context.pagesFetched,
              productPages: result.context.productPagesFetched,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.rows.length > 0 ? <ExportButton result={result} /> : null}
          <AuditJsonButton result={result} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <SummaryMetric
          label={t("summary.included")}
          value={formatCount(result.rows.length, locale)}
          tone="included"
        />
        <SummaryMetric
          label={t("summary.incomplete")}
          value={formatCount(incompleteCount, locale)}
          tone="incomplete"
        />
        <SummaryMetric
          label={t("summary.withheld")}
          value={formatCount(result.withheld.length, locale)}
          tone="withheld"
        />
      </div>

      {result.rows.length > 0 ? (
        <p className={SECTION_INTRO}>{t("eligibleIntro")}</p>
      ) : null}
      <div className="mt-4 border-t border-brand-border-faint pt-3">
        <p className={SECTION_INTRO}>{t("contextBoundary")}</p>
        {result.context.selection === undefined ? null : (
          <p className={SECTION_INTRO}>
            {t("contextSelection", {
              eligible: result.context.selection.eligibleCandidates,
              excluded: result.context.selection.excludedCandidates,
              attempted: result.context.selection.attemptedCandidates,
              truncated: result.context.selection.truncatedCandidates,
            })}
          </p>
        )}
        {result.context.stopReason !== "completed" ? (
          <p className={SECTION_INTRO}>
            {t("contextStopped", {
              reason: label(
                `contextStops.${result.context.stopReason}`,
                result.context.stopReason,
              ),
            })}
          </p>
        ) : null}
      </div>

      <details
        data-screening-process=""
        className="group mt-4 border-t border-brand-border-faint pt-3"
      >
        <summary className="cursor-pointer text-[13px] font-medium text-text-dark-primary transition-colors marker:text-text-dark-secondary hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
          {t("summary.screeningProcess")}
        </summary>
        <p className={`${SECTION_INTRO} mt-3`}>{t("funnelIntro")}</p>

        {/* 1px gap over the divider colour: the counts read as one table of
            gates rather than nine chips that happen to sit near each other. */}
        <div className="rounded-card border-brand-border-card bg-brand-border-card mt-4 grid grid-cols-3 gap-px overflow-hidden border">
          {FUNNEL_STEPS.map((step) => (
            <Tile
              key={step}
              label={t(`funnel.${step}`)}
              value={
                stageRan(step, result.unavailableStages)
                  ? result.funnel[step]
                  : null
              }
              locale={locale}
              /* The funnel's payoff is its last number, so that is the one the
                 eye should land on — the order stays strictly the pipeline's. */
              emphasis={step === "shown"}
            />
          ))}
        </div>
        <ProcessLedger result={result} locale={locale} />
      </details>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone: "included" | "incomplete" | "withheld";
}) {
  const toneClass =
    tone === "included"
      ? "border-brand-success/25 bg-brand-success/[0.07]"
      : tone === "incomplete"
        ? "border-brand-warning/25 bg-brand-warning/[0.07]"
        : "border-brand-border-card bg-brand-panel-sunken";
  return (
    <div className={`rounded-[10px] border px-3.5 py-3 ${toneClass}`}>
      <p className="font-mono text-[18px] leading-none tabular-nums text-text-dark-primary">
        {value}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-tight text-text-dark-secondary">
        {label}
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  locale,
  emphasis,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly locale: string;
  readonly emphasis: boolean;
}) {
  const t = useTranslations("tools.keywordMap");

  return (
    <div
      /* Three columns hold on a phone too. Stacking them would put nine
         tiles and 780px of scroll between the wait and the keywords the
         visitor waited for; the type steps down instead. */
      className={`px-3 py-3.5 sm:px-5 sm:py-4 ${
        emphasis ? "bg-brand-panel-raised" : "bg-brand-panel-sunken"
      }`}
    >
      {/*
       * Null is not zero and must not be rendered as one, nor as the em dash
       * an unavailable number gets elsewhere: a dash in a row of counts reads
       * as "none". It means the Search Console sample was never read, so the
       * tile says so, in the tone the rest of the page uses for a gap in the
       * evidence rather than in the tone it uses for a measurement.
       */}
      {value === null ? (
        <p className="text-[12px] leading-tight font-medium text-brand-warning sm:text-[13px]">
          {t("notMeasured")}
        </p>
      ) : (
        <p
          className={`font-mono text-[17px] leading-none tabular-nums sm:text-[22px] ${
            emphasis ? "text-brand-accent-text" : "text-text-dark-primary"
          }`}
        >
          {formatCount(value, locale)}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-tight text-text-dark-secondary sm:mt-2.5 sm:text-[12.5px]">
        {label}
      </p>
    </div>
  );
}

function formatBreakdown(
  counts: Readonly<Record<string, number>>,
  labelFor: (key: string) => string,
  locale: string,
): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${labelFor(key)} ${formatCount(count, locale)}`)
    .join(" · ");
}

function ProcessLedger({
  result,
  locale,
}: {
  readonly result: KeywordOpportunityResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const process = result.process;
  if (process === undefined) return null;

  const measuredCount = (value: number | null): string =>
    value === null ? t("notMeasured") : formatCount(value, locale);

  const supportingPageBreakdown = formatBreakdown(
    {
      ...process.supportingPages.sources,
      source_unreported: process.supportingPages.sourceUnreported,
      unavailable: process.supportingPages.unavailable,
    },
    (key) => label(`supportingPageSources.${key}`, key),
    locale,
  );
  const withheldBreakdown = formatBreakdown(
    process.decisions.withheldReasons,
    (key) => label(`withheld.${key}`, key),
    locale,
  );
  const incompleteBreakdown = formatBreakdown(
    process.decisions.incompleteReasons,
    (key) => label(`incomplete.${key}`, key),
    locale,
  );
  const failureBreakdown = formatBreakdown(
    process.serp.failureReasons,
    (key) => label(`process.failureReasons.${key}`, key),
    locale,
  );
  const durationBreakdown = (
    [
      ["coverage", process.durationsMs.coverage],
      ["validation", process.durationsMs.validation],
      ["serpSampling", process.durationsMs.serpSampling],
      ["serpInterpretation", process.durationsMs.serpInterpretation],
      ["domainEnrichment", process.durationsMs.domainEnrichment],
      ["report", process.durationsMs.report],
    ] as const
  )
    .flatMap(([key, value]) =>
      value === null
        ? []
        : [
            `${label(`process.durationStages.${key}`, key)} ${formatCount(value, locale)}ms`,
          ],
    )
    .join(" · ");
  const accounted =
    process.validation.accounted &&
    process.serp.accounted &&
    process.decisions.accounted &&
    process.supportingPages.accounted;

  return (
    <div className="mt-4 space-y-2.5 border-t border-brand-border-faint pt-3">
      <p className={LABEL}>{t("process.title")}</p>
      <p className={SECTION_INTRO}>
        {t("process.serpSummary", {
          planned: measuredCount(process.serp.planned),
          dispatched: measuredCount(process.serp.dispatched),
          completed: process.serp.completed,
          failed: process.serp.failed,
        })}
      </p>
      {process.serp.legacyStatusUnreported > 0 ? (
        <p className={SECTION_INTRO}>
          {t("process.legacyStatusUnreported", {
            count: process.serp.legacyStatusUnreported,
          })}
        </p>
      ) : null}
      {failureBreakdown === "" ? null : (
        <p className={SECTION_INTRO}>
          {t("process.serpFailures", { reasons: failureBreakdown })}
        </p>
      )}
      <p className={SECTION_INTRO}>
        {t("process.validation", {
          requested: measuredCount(process.validation.requested),
          available: process.validation.available,
          explicitZero: process.validation.explicitZero,
          providerNoData: process.validation.providerNoData,
        })}
      </p>
      <p className={SECTION_INTRO}>
        {t("process.supportingPages", {
          breakdown: supportingPageBreakdown,
        })}
      </p>
      <p className={SECTION_INTRO}>
        {t("process.decisions", {
          eligible: process.decisions.eligible,
          withheld: process.decisions.withheld,
          incomplete: process.decisions.incomplete,
        })}
      </p>
      {withheldBreakdown === "" ? null : (
        <p className={SECTION_INTRO}>
          {t("process.withheldReasons", { reasons: withheldBreakdown })}
        </p>
      )}
      {incompleteBreakdown === "" ? null : (
        <p className={SECTION_INTRO}>
          {t("process.incompleteReasons", { reasons: incompleteBreakdown })}
        </p>
      )}
      {process.decisions.positiveWithUnavailableSignals > 0 ? (
        <p className={SECTION_INTRO}>
          {t("process.positiveWithUnavailable", {
            count: process.decisions.positiveWithUnavailableSignals,
          })}
        </p>
      ) : null}
      <p className={SECTION_INTRO}>
        {process.thresholds.lowOrganicTrafficThreshold === null
          ? t("process.thresholdUnavailable")
          : t("process.threshold", {
              policy: process.thresholds.policyVersion ?? "—",
              months:
                process.thresholds.youngDomainMonths === null
                  ? "—"
                  : process.thresholds.youngDomainMonths,
              tier: process.thresholds.siteRankTier ?? "—",
              rank:
                process.thresholds.siteDomainRank === null
                  ? "—"
                  : formatCount(process.thresholds.siteDomainRank, locale),
              threshold: formatCount(
                process.thresholds.lowOrganicTrafficThreshold,
                locale,
              ),
            })}
      </p>
      <p className={SECTION_INTRO}>
        {process.durationsMs.total === null
          ? t("process.durationsPartial", {
              breakdown: durationBreakdown === "" ? "—" : durationBreakdown,
            })
          : t("process.durations", {
              total: formatCount(process.durationsMs.total, locale),
              breakdown: durationBreakdown === "" ? "—" : durationBreakdown,
            })}
      </p>
      <p className={SECTION_INTRO}>
        {t(accounted ? "process.accounted" : "process.unaccounted")}
      </p>
    </div>
  );
}

/**
 * A run that produced no rows still produced a finding, and has to say so.
 *
 * Without this the funnel above is followed by the withheld list, and a reader
 * is left to infer from two absences that the tables were meant to be there.
 *
 * The body splits on whether every stage ran, because the two empties are not
 * the same claim. When they all ran, the candidates were judged and dropped —
 * a finding. When one did not, some were never judged at all, and saying they
 * were "priced, checked or sampled out" would dress a gap in the evidence as
 * a result.
 */
function EmptyState({ degraded }: { readonly degraded: boolean }) {
  const t = useTranslations("tools.keywordMap");

  return (
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>{t("emptyTitle")}</h3>
      <p className={SECTION_INTRO}>
        {t(degraded ? "emptyBodyPartial" : "emptyBody")}
      </p>
    </section>
  );
}

/**
 * The checks every row of a table shares, hoisted out of the rows.
 *
 * The live review measured the check column at roughly half the table's width
 * with sixteen identical cells in it. The shared checks are still the same
 * claim — they are stated once above the table — and each row keeps only what
 * distinguishes it. Hoisting is by intersection, not by fiat, so a check that
 * genuinely varies stays in the rows.
 */
export function commonChecks(
  rows: readonly KeywordOpportunityRow[],
): readonly KeywordOpportunityCheck[] {
  const first = rows[0];
  if (first === undefined || rows.length < 2) return [];
  return first.nextChecks.filter((check) =>
    rows.every((row) => row.nextChecks.includes(check)),
  );
}

function RowTable({
  rows,
  lane,
  locale,
}: {
  readonly rows: readonly KeywordOpportunityRow[];
  readonly lane: "seo" | "geo";
  readonly locale: string;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  if (rows.length === 0) return null;

  const shared = commonChecks(rows);
  const sharedSet = new Set(shared);
  const headingId = `keyword-lane-${lane}`;
  const columnCount = lane === "seo" ? 6 : 5;

  return (
    <section className={`${CARD} min-w-0`}>
      <h3 id={headingId} className={SECTION_TITLE}>
        {t(`lane.${lane}.title`)}
      </h3>
      <p className={SECTION_INTRO}>{t(`lane.${lane}.intro`)}</p>
      {shared.length > 0 ? (
        <p className={SECTION_INTRO}>
          {t("commonChecksIntro")}{" "}
          {shared.map((check) => label(`checks.${check}`, check)).join(" · ")}
        </p>
      ) : null}

      <div
        data-keyword-scroll={lane}
        tabIndex={0}
        role="region"
        aria-labelledby={headingId}
        className="mt-4 max-w-full overflow-x-auto focus-visible:rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <table
          data-keyword-table={lane}
          className={`${TABLE_TEXT} w-full border-collapse text-left ${
            lane === "seo" ? "min-w-[1160px]" : "min-w-[1120px]"
          }`}
        >
          <caption className="sr-only">{t(`lane.${lane}.title`)}</caption>
          <thead>
            <tr className="border-b border-brand-border-card">
              <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2`}>
                {t(
                  lane === "seo"
                    ? "columns.keywordIntent"
                    : "columns.questionIntent",
                )}
              </th>
              {lane === "seo" ? (
                <>
                  <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2 text-right`}>
                    {t("columns.volume")}
                  </th>
                  <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2`}>
                    {t("columns.competition")}
                  </th>
                </>
              ) : (
                <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2`}>
                  {t("columns.supportingPage")}
                </th>
              )}
              <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2`}>
                {t("columns.signals")}
              </th>
              <th scope="col" className={`${LABEL} whitespace-nowrap pr-5 pb-2`}>
                {t("columns.aiOverview")}
              </th>
              <th scope="col" className={`${LABEL} whitespace-nowrap pb-2`}>
                {t("columns.coverageReview")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <KeywordResultRow
                key={row.keyword}
                row={row}
                lane={lane}
                locale={locale}
                shared={sharedSet}
                columnCount={columnCount}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className={SECTION_INTRO}>
        {lane === "seo" ? t("weakestHint") : t("geoHint")}
      </p>
    </section>
  );
}

function KeywordResultRow({
  row,
  lane,
  locale,
  shared,
  columnCount,
}: {
  readonly row: KeywordOpportunityRow;
  readonly lane: "seo" | "geo";
  readonly locale: string;
  readonly shared: ReadonlySet<KeywordOpportunityCheck>;
  readonly columnCount: number;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const [expanded, setExpanded] = useState(false);
  const reactId = useId();
  const detailId = `keyword-evidence-${reactId.replaceAll(":", "")}`;

  return (
    <>
      <tr
        data-keyword-row={row.keyword}
        data-keyword-summary=""
        className="border-b border-brand-border-card/60 align-top"
      >
        <td className="w-[220px] py-4 pr-5">
          <p className={KEYWORD_TEXT}>{row.keyword}</p>
          <dl className={`${META_TEXT} mt-3 space-y-2 text-text-dark-secondary`}>
            <IntentSummary
              label={t("columns.providerIntent")}
              value={<ProviderIntentCell row={row} />}
            />
            <IntentSummary
              label={t("columns.serpIntent")}
              value={<SerpIntentCell row={row} />}
            />
          </dl>
        </td>
        {lane === "seo" ? (
          <>
            <td className="w-[100px] py-4 pr-5 text-right tabular-nums">
              <p className={META_TEXT}>{t("columns.volume")}</p>
              <span className={`${DATA_CHIP} mt-1.5`}>
                {row.validation.volume === null
                  ? t("values.notReturned")
                  : formatCount(row.validation.volume, locale)}
              </span>
            </td>
            <td className="w-[190px] py-4 pr-5">
              <div className="flex flex-wrap gap-1.5">
                <span className={DATA_CHIP}>
                  {t("columns.difficulty")} {" "}
                  {row.validation.difficulty === null
                    ? t("values.notReturned")
                    : formatCount(row.validation.difficulty, locale)}
                </span>
                <span className={DATA_CHIP}>
                  {t("columns.weakest")} {" "}
                  {row.serp.weakestTopTenDomainRank === null
                    ? t("values.notReturned")
                    : formatCount(row.serp.weakestTopTenDomainRank, locale)}
                </span>
              </div>
              {typeof row.serp.weakestTopTenDomain === "string" ? (
                <p className={`${META_TEXT} mt-2 break-all text-text-dark-secondary`}>
                  {row.serp.weakestTopTenDomain}
                  {typeof row.serp.weakestTopTenPosition === "number"
                    ? ` · #${row.serp.weakestTopTenPosition}`
                    : ""}
                </p>
              ) : null}
            </td>
          </>
        ) : (
          <td className="w-[190px] py-4 pr-5">
            <SupportingPageSummary
              supportingPage={row.supportingPage}
              value={row.supportingPageUrl}
            />
          </td>
        )}
        <td className="w-[230px] py-4 pr-5 text-text-dark-secondary">
          <CompactSignalList row={row} locale={locale} />
        </td>
        <td className="w-[170px] py-4 pr-5">
          <AiOverviewSummary
            evidence={row.aiOverview}
            itemTypes={row.serp.pageOneItemTypes}
            decision={row.decision}
          />
        </td>
        <td className="w-[230px] py-4 text-text-dark-secondary">
          <span
            className={`${STATE_PILL} border-brand-border-strong bg-brand-panel-sunken text-text-dark-primary`}
          >
            {label(`coverage.${row.coverage}`, row.coverage)}
          </span>
          <div className={`${META_TEXT} mt-3`}>
            <p className="font-medium text-text-dark-primary">
              {t("columns.remainingDecisions")}
            </p>
            <div className="mt-1.5">
              <RowChecks checks={row.nextChecks} shared={shared} />
            </div>
          </div>
          <button
            type="button"
            data-keyword-toggle={row.keyword}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((current) => !current)}
            className="mt-3 inline-flex min-h-11 items-center rounded-[9px] border border-brand-border-strong px-3 text-[12.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t(expanded ? "evidence.hide" : "evidence.show")}
          </button>
        </td>
      </tr>
      {expanded ? (
        <EvidenceDetailRow
          id={detailId}
          row={row}
          locale={locale}
          columnCount={columnCount}
        />
      ) : null}
    </>
  );
}

function IntentSummary({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-text-dark-faint">{label}</dt>
      <dd className={`${DATA_CHIP} mt-1`}>{value}</dd>
    </div>
  );
}

type SupportingPagePresentation =
  | { readonly state: "not_observed" | "unavailable" }
  | {
      readonly state: "available";
      readonly source: string | null;
      readonly compact: string;
      readonly full: string;
    };

function supportingPagePresentation(
  supportingPage: KeywordOpportunityRow["supportingPage"] | undefined,
  value: string | null,
): SupportingPagePresentation {
  const pageUrl =
    supportingPage?.availability === "available" ? supportingPage.url : value;
  if (pageUrl === null) {
    return {
      state: supportingPage === undefined ? "not_observed" : "unavailable",
    };
  }
  try {
    const parsed = new URL(pageUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.host === ""
    ) {
      return { state: "unavailable" };
    }
    return {
      state: "available",
      source:
        supportingPage?.availability === "available"
          ? supportingPage.source
          : null,
      compact: `${parsed.host}${parsed.pathname}`,
      full: pageUrl,
    };
  } catch {
    return { state: "unavailable" };
  }
}

function SupportingPageSummary({
  supportingPage,
  value,
}: {
  readonly supportingPage: KeywordOpportunityRow["supportingPage"] | undefined;
  readonly value: string | null;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const page = supportingPagePresentation(supportingPage, value);
  if (page.state === "available") {
    return (
      <div className={`${META_TEXT} space-y-1 break-words text-text-dark-secondary`}>
        <p>{page.compact}</p>
        {page.source === null ? null : (
          <p className="text-text-dark-faint">
            {label(`supportingPageSources.${page.source}`, page.source)}
          </p>
        )}
      </div>
    );
  }
  return (
    <span
      className={`${STATE_PILL} ${
        page.state === "not_observed"
          ? "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary"
          : "border-brand-warning/25 bg-brand-warning/[0.08] text-brand-warning"
      }`}
    >
      {t(`supportingPage.${page.state}`)}
    </span>
  );
}

/** Provider intent is a returned fact; null is not an inferred replacement. */
function ProviderIntentCell({
  row,
}: {
  readonly row: KeywordOpportunityRow;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const intent =
    row.validation.providerIntent === undefined
      ? row.validation.intent
      : row.validation.providerIntent;
  return intent === null
    ? t("providerIntentMissing")
    : label(`intents.${intent}`, intent);
}

/** The inferred intent stays separate here; its provenance lives in details. */
function SerpIntentCell({ row }: { readonly row: KeywordOpportunityRow }) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  if (row.serpIntent === null || row.serpIntent === undefined) {
    return (
      <span className="text-text-dark-faint">{t("inferenceUnavailable")}</span>
    );
  }

  return label(`intents.${row.serpIntent.intent}`, row.serpIntent.intent);
}

type CompactSignalState = "observed" | "not_observed" | "unavailable";

function CompactSignalList({
  row,
  locale,
}: {
  readonly row: KeywordOpportunityRow;
  readonly locale: string;
}) {
  const t = useTranslations("tools.keywordMap");
  const young = row.signals?.youngDomain;
  const traffic = row.signals?.lowOrganicTrafficDomain;
  const community = row.signals?.communityResult;

  return (
    <ul className="space-y-2.5">
      <CompactSignal
        name="young_domain"
        state={young?.state ?? "unavailable"}
        detail={
          young?.state === "observed"
            ? t("signalCompact.youngObserved", {
                domain: young.observation.domain,
                months: formatCount(young.observation.ageMonths, locale),
              })
            : null
        }
      />
      <CompactSignal
        name="low_organic_traffic_domain"
        state={traffic?.state ?? "unavailable"}
        detail={
          traffic?.state === "observed"
            ? t("signalCompact.lowTrafficObserved", {
                domain: traffic.observation.domain,
                etv: formatCount(traffic.observation.organicEtv, locale),
              })
            : null
        }
      />
      <CompactSignal
        name="community_result"
        state={community?.state ?? "unavailable"}
        detail={
          community?.state === "observed"
            ? t("signalCompact.communityObserved", {
                domain: community.observation.domain,
                position: formatCount(community.observation.position, locale),
              })
            : null
        }
      />
    </ul>
  );
}

function CompactSignal({
  name,
  state,
  detail,
}: {
  readonly name: string;
  readonly state: CompactSignalState;
  readonly detail: string | null;
}) {
  const label = useOptionalLabel();
  const stateClass =
    state === "observed"
      ? "border-brand-success/30 bg-brand-success/[0.08] text-brand-success"
      : state === "not_observed"
        ? "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary"
        : "border-brand-warning/25 bg-brand-warning/[0.08] text-brand-warning";

  return (
    <li>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-text-dark-primary">
          {label(`signalNames.${name}`, name)}
        </span>
        <span className={`${STATE_PILL} ${stateClass}`}>
          {label(`signalStates.${state}`, state)}
        </span>
      </div>
      {detail === null ? null : (
        <p className={`${META_TEXT} mt-1 text-text-dark-secondary`}>{detail}</p>
      )}
    </li>
  );
}

function aiOverviewAvailability(
  evidence: KeywordOpportunityRow["aiOverview"],
  itemTypes: readonly string[] | null | undefined,
): "observed" | "not_observed" | "unavailable" {
  return (
    evidence?.availability ??
    (itemTypes === null || itemTypes === undefined
      ? "unavailable"
      : itemTypes.includes("ai_overview")
        ? "observed"
        : "not_observed")
  );
}

function AiOverviewSummary({
  evidence,
  itemTypes,
  decision,
}: {
  readonly evidence: KeywordOpportunityRow["aiOverview"];
  readonly itemTypes: readonly string[] | null | undefined;
  readonly decision: KeywordOpportunityRow["decision"];
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const availability = aiOverviewAvailability(evidence, itemTypes);
  const assessment = evidence?.answerAssessment ?? "unavailable";
  const discounted =
    decision?.discounts.includes("ai_overview_answer_discount") === true;
  const availabilityClass =
    availability === "observed"
      ? "border-brand-warning/25 bg-brand-warning/[0.08] text-brand-warning"
      : availability === "not_observed"
        ? "border-brand-success/30 bg-brand-success/[0.08] text-brand-success"
        : "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary";

  return (
    <div className="space-y-2.5">
      <div>
        <p className={META_TEXT}>{t("aio.providerLabel")}</p>
        <span className={`${STATE_PILL} ${availabilityClass} mt-1`}>
          {label(`aioAvailability.${availability}`, availability)}
        </span>
      </div>
      <div>
        <p className={META_TEXT}>{t("aio.assessmentLabel")}</p>
        <span
          className={`${STATE_PILL} mt-1 border-brand-border-strong bg-brand-panel-sunken text-text-dark-primary`}
        >
          {label(`aioAssessments.${assessment}`, assessment)}
        </span>
      </div>
      {discounted ? (
        <p className={`${META_TEXT} text-brand-warning`}>
          {t("aio.discountLabel")}: {t("discounts.ai_overview_answer_discount")}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceDetailRow({
  id,
  row,
  locale,
  columnCount,
}: {
  readonly id: string;
  readonly row: KeywordOpportunityRow;
  readonly locale: string;
  readonly columnCount: number;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const intent = row.serpIntent;
  const supportingPage = supportingPagePresentation(
    row.supportingPage,
    row.supportingPageUrl,
  );

  return (
    <tr
      id={id}
      data-keyword-detail={row.keyword}
      className="border-b border-brand-border-card/60 bg-brand-panel-sunken/60"
    >
      <td colSpan={columnCount} className="px-4 py-5">
        <h4 className="text-[14px] font-semibold text-text-dark-primary">
          {t("evidence.title")}
        </h4>
        <div className="mt-4 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className={LABEL}>{t("evidence.intentTitle")}</p>
            <dl className={`${META_TEXT} mt-3 space-y-2.5`}>
              <EvidenceFact label={t("columns.providerIntent")}>
                <ProviderIntentCell row={row} />
              </EvidenceFact>
              <EvidenceFact label={t("columns.serpIntent")}>
                <SerpIntentCell row={row} />
              </EvidenceFact>
              <EvidenceFact label={t("evidence.source")}>
                {intent === null || intent === undefined
                  ? "—"
                  : label(
                      `serpIntentSources.${intent.source}`,
                      intent.source,
                    )}
              </EvidenceFact>
              <EvidenceFact label={t("evidence.observedAt")}>
                {intent?.observedAt ?? row.serp.observedAt ?? "—"}
              </EvidenceFact>
              <EvidenceFact label={t("evidence.modelId")}>
                {intent?.modelId ?? "—"}
              </EvidenceFact>
              <EvidenceFact label={t("evidence.promptVersion")}>
                {intent?.promptVersion ?? "—"}
              </EvidenceFact>
            </dl>
          </div>

          <div>
            <p className={LABEL}>{t("evidence.signalsTitle")}</p>
            <div className={`${META_TEXT} mt-3`}>
              <SignalEvidenceList row={row} locale={locale} />
            </div>
          </div>

          <div>
            <p className={LABEL}>{t("columns.aiOverview")}</p>
            <div className={`${META_TEXT} mt-3`}>
              <AiOverviewCell
                evidence={row.aiOverview}
                itemTypes={row.serp.pageOneItemTypes}
                decision={row.decision}
              />
            </div>
          </div>

          <div>
            <p className={LABEL}>{t("evidence.reviewTitle")}</p>
            <dl className={`${META_TEXT} mt-3 space-y-2.5`}>
              <EvidenceFact label={t("columns.coverage")}>
                {label(`coverage.${row.coverage}`, row.coverage)}
              </EvidenceFact>
              {supportingPage.state === "available" ? (
                <>
                  <EvidenceFact label={t("evidence.supportingPageUrl")}>
                    <span className="break-all">{supportingPage.full}</span>
                  </EvidenceFact>
                  <EvidenceFact label={t("evidence.supportingPageSource")}>
                    {supportingPage.source === null
                      ? "—"
                      : label(
                          `supportingPageSources.${supportingPage.source}`,
                          supportingPage.source,
                        )}
                  </EvidenceFact>
                </>
              ) : null}
              <EvidenceFact label={t("columns.remainingDecisions")}>
                <FullRowChecks checks={row.nextChecks} />
              </EvidenceFact>
            </dl>
          </div>
        </div>
      </td>
    </tr>
  );
}

function EvidenceFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-text-dark-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-text-dark-primary">{children}</dd>
    </div>
  );
}

function FullRowChecks({
  checks,
}: {
  readonly checks: readonly KeywordOpportunityCheck[];
}) {
  const label = useOptionalLabel();
  if (checks.length === 0) return <span>—</span>;
  return (
    <ul className="space-y-1">
      {checks.map((check) => (
        <li key={check}>{label(`checks.${check}`, check)}</li>
      ))}
    </ul>
  );
}

function SignalBlock<Observation>({
  name,
  evidence,
  renderObserved,
}: {
  readonly name: string;
  readonly evidence: KeywordOpportunitySignalEvidence<Observation> | undefined;
  readonly renderObserved: (observation: Observation) => React.ReactNode;
}) {
  const label = useOptionalLabel();
  const state = evidence?.state ?? "unavailable";
  const reason =
    evidence?.state === "unavailable"
      ? evidence.reason
      : evidence === undefined
        ? "legacy_result_unreported"
        : null;

  return (
    <li>
      <p className="font-medium text-text-dark-primary">
        {label(`signalNames.${name}`, name)} {" · "}
        {label(`signalStates.${state}`, state)}
      </p>
      {evidence?.state === "observed" ? (
        <div className="mt-0.5 text-text-dark-secondary">
          {renderObserved(evidence.observation)}
        </div>
      ) : reason !== null ? (
        <p className="mt-0.5 text-text-dark-faint">
          {label(`evidenceReasons.${reason}`, reason)}
        </p>
      ) : null}
    </li>
  );
}

/** Three independent facts; a negative and an unavailable read never merge. */
function SignalEvidenceList({
  row,
  locale,
}: {
  readonly row: KeywordOpportunityRow;
  readonly locale: string;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const signals = row.signals;
  const community = signals?.communityResult;
  const communityResult =
    community?.state === "observed"
      ? (row.serp.organicResults ?? []).find(
          (result) =>
            result.url === community.observation.url ||
            (result.position === community.observation.position &&
              result.domain === community.observation.domain),
        )
      : undefined;

  return (
    <ul className="space-y-3">
      <SignalBlock
        name="young_domain"
        evidence={signals?.youngDomain}
        renderObserved={(observation) => (
          <>
            <p>
              {t("signalEvidence.youngObserved", {
                domain: observation.domain,
                date: observation.registrationDate.slice(0, 10),
                months: formatCount(observation.ageMonths, locale),
              })}
            </p>
            <p className="mt-0.5 break-all text-text-dark-faint">
              {t("evidence.registrationDate")}: {observation.registrationDate}
            </p>
            <p className="mt-0.5 break-all text-text-dark-faint">
              {t("evidence.observedAt")}: {observation.observedAt}
            </p>
          </>
        )}
      />
      <SignalBlock
        name="low_organic_traffic_domain"
        evidence={signals?.lowOrganicTrafficDomain}
        renderObserved={(observation) => (
          <>
            <p>
              {t("signalEvidence.lowTrafficObserved", {
                domain: observation.domain,
                etv: formatCount(observation.organicEtv, locale),
                threshold: formatCount(observation.threshold, locale),
              })}
            </p>
            <p className="mt-0.5 text-text-dark-faint">
              {t("evidence.marketLanguage", {
                market: observation.marketCode,
                language: observation.languageCode,
              })}
            </p>
            <p className="mt-0.5 break-all text-text-dark-faint">
              {t("evidence.observedAt")}: {observation.observedAt}
            </p>
          </>
        )}
      />
      <SignalBlock
        name="community_result"
        evidence={community}
        renderObserved={(observation) => (
          <>
            <p>
              {t("signalEvidence.communityObserved", {
                source: label(
                  `communitySources.${observation.source}`,
                  observation.source,
                ),
                domain: observation.domain,
                position: formatCount(observation.position, locale),
              })}
            </p>
            <p className="break-all">{observation.url}</p>
            <p>
              {communityResult?.title ?? t("signalEvidence.titleUnavailable")}
            </p>
          </>
        )}
      />
    </ul>
  );
}

/**
 * Three states, none of them collapsible into another.
 *
 * A present v2 evidence object is authoritative and keeps the provider's
 * availability separate from the model's answer assessment. Older payloads do
 * not carry that object, so only those fall back to the provider item-type
 * list; their assessment remains unavailable.
 */
function AiOverviewCell({
  evidence,
  itemTypes,
  decision,
}: {
  /** Present v2 evidence is authoritative over the legacy item-type proxy. */
  readonly evidence: KeywordOpportunityRow["aiOverview"];
  /**
   * `undefined` is accepted alongside the contract's `null` for the same
   * reason the handler tolerates tokens without `headings`: a run started on
   * the previous deployment finishes on this one, and its payload predates
   * the field. Both read as "not reported".
   */
  readonly itemTypes: readonly string[] | null | undefined;
  readonly decision: KeywordOpportunityRow["decision"];
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  const availability = aiOverviewAvailability(evidence, itemTypes);
  const assessment = evidence?.answerAssessment ?? "unavailable";
  const discounted =
    decision?.discounts.includes("ai_overview_answer_discount") === true;

  return (
    <div className="min-w-[220px] space-y-2">
      <p>
        <span className="block font-medium text-text-dark-primary">
          {t("aio.providerLabel")}
        </span>
        <span
          className={
            availability === "observed"
              ? "text-brand-warning"
              : availability === "unavailable"
                ? "text-text-dark-faint"
                : "text-text-dark-secondary"
          }
        >
          {availability === "unavailable" ? "— " : ""}
          {label(`aioAvailability.${availability}`, availability)}
        </span>
      </p>
      <p>
        <span className="block font-medium text-text-dark-primary">
          {t("aio.assessmentLabel")}
        </span>
        <span className="text-text-dark-secondary">
          {label(`aioAssessments.${assessment}`, assessment)}
        </span>
      </p>
      {discounted ? (
        <p className="rounded-[6px] border border-brand-warning/25 bg-brand-warning/[0.08] px-2 py-1 text-brand-warning">
          {t("aio.discountLabel")}: {t("discounts.ai_overview_answer_discount")}
        </p>
      ) : null}
      {evidence?.reason !== null && evidence?.reason !== undefined ? (
        <p className="text-text-dark-faint">
          {t("evidence.reason")}: {" "}
          {label(`evidenceReasons.${evidence.reason}`, evidence.reason)}
        </p>
      ) : null}
      {evidence?.loadedAsync !== null &&
      evidence?.loadedAsync !== undefined ? (
        <p className="text-text-dark-faint">
          {t("evidence.loadedAsync")}: {" "}
          {t(evidence.loadedAsync ? "values.yes" : "values.no")}
        </p>
      ) : null}
      {evidence?.modelId !== null && evidence?.modelId !== undefined ? (
        <p className="font-mono text-[10.5px] break-all text-text-dark-faint">
          {t("evidence.modelId")}: {evidence.modelId}
        </p>
      ) : null}
      {evidence?.promptVersion !== null &&
      evidence?.promptVersion !== undefined ? (
        <p className="font-mono text-[10.5px] break-all text-text-dark-faint">
          {t("evidence.promptVersion")}: {evidence.promptVersion}
        </p>
      ) : null}
    </div>
  );
}

/** Candidates whose required evidence did not complete, grouped by the gap. */
function Incomplete({
  incomplete,
}: {
  readonly incomplete: readonly KeywordOpportunityIncomplete[];
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  if (incomplete.length === 0) return null;

  const byReason = new Map<KeywordOpportunityIncomplete["reason"], string[]>();
  for (const entry of incomplete) {
    byReason.set(entry.reason, [
      ...(byReason.get(entry.reason) ?? []),
      entry.keyword,
    ]);
  }

  return (
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>
        {t("incompleteTitle")} · {t("sectionCount", { count: incomplete.length })}
      </h3>
      <p className={SECTION_INTRO}>{t("incompleteIntro")}</p>
      <div className="mt-4 space-y-3">
        {[...byReason.entries()].map(([reason, keywords]) => (
          <details key={reason} className="group">
            <summary className="cursor-pointer text-[13px] text-text-dark-primary transition-colors marker:text-text-dark-secondary hover:text-brand-accent-text">
              {label(`incomplete.${reason}`, reason)}
              <span className="ml-2 font-mono text-[12px] text-text-dark-secondary tabular-nums">
                {keywords.length}
              </span>
            </summary>
            <ul className="mt-2.5 flex list-none flex-wrap gap-2 p-0">
              {keywords.map((keyword) => (
                <li key={keyword} className={PILL}>
                  {keyword}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <div className="mt-5 border-t border-brand-border-faint pt-4">
        <p className={LABEL}>{t("incompleteRetryTitle")}</p>
        <p className={SECTION_INTRO}>{t("incompleteRetry")}</p>
      </div>
    </section>
  );
}

/** A row's own checks, minus the ones the whole table already states. */
function RowChecks({
  checks,
  shared,
}: {
  readonly checks: readonly KeywordOpportunityCheck[];
  readonly shared: ReadonlySet<KeywordOpportunityCheck>;
}) {
  const label = useOptionalLabel();
  const own = checks.filter((check) => !shared.has(check));
  if (own.length === 0) {
    return <span className="text-text-dark-faint">—</span>;
  }
  return (
    <ul className="space-y-1">
      {own.map((check) => (
        <li key={check}>{label(`checks.${check}`, check)}</li>
      ))}
    </ul>
  );
}

/**
 * Terms whose wording overlaps enough that one page could serve them.
 *
 * The engine has computed this on every run since the first one and no surface
 * has ever shown it. It is the only part of the payload that answers "how many
 * pages is this list", which is the question between a keyword list and a plan.
 */
function Groups({
  groups,
}: {
  readonly groups: readonly KeywordOpportunityCluster[];
}) {
  const t = useTranslations("tools.keywordMap");
  if (groups.length === 0) return null;

  return (
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>{t("clustersTitle")}</h3>
      <p className={SECTION_INTRO}>{t("clustersIntro")}</p>

      <div className="mt-4">
        {groups.map((group) => (
          <article
            key={group.id}
            className="border-t border-brand-border-faint py-4 first:border-t-0 first:pt-0"
          >
            <h4 className="text-[14px] font-semibold text-text-dark-primary">
              {group.label}
            </h4>
            <ul className="mt-2.5 flex list-none flex-wrap gap-2 p-0">
              {group.keywords.map((keyword) => (
                <li key={keyword} className={PILL}>
                  {keyword}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function Withheld({
  withheld,
  onRetryWithSeeds,
}: {
  readonly withheld: readonly KeywordOpportunityWithheld[];
  readonly onRetryWithSeeds?: (keywords: readonly string[]) => void;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
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
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>
        {t("withheldTitle")} · {t("sectionCount", { count: withheld.length })}
      </h3>
      <p className={SECTION_INTRO}>{t("withheldIntro")}</p>
      <div className="mt-4 space-y-3">
        {[...byReason.entries()].map(([reason, keywords]) => (
          <details key={reason} className="group">
            <summary className="cursor-pointer text-[13px] text-text-dark-primary transition-colors marker:text-text-dark-secondary hover:text-brand-accent-text">
              {label(`withheld.${reason}`, reason)}
              <span className="ml-2 font-mono text-[12px] text-text-dark-secondary tabular-nums">
                {keywords.length}
              </span>
            </summary>
            <ul className="mt-2.5 flex list-none flex-wrap gap-2 p-0">
              {keywords.map((keyword) => (
                <li key={keyword} className={PILL}>
                  {keyword}
                </li>
              ))}
            </ul>
            {/*
             * Compatibility for a result emitted by the former capped sampler.
             * New v2 runs attempt every candidate except explicit zero and never emit this
             * reason, but a tab can finish a run across a deployment boundary.
             */}
            {reason === "serp_sample_budget_exhausted" &&
            onRetryWithSeeds !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  onRetryWithSeeds(keywords);
                }}
                className="mt-3 inline-flex h-10 items-center justify-center rounded-[10px] border border-brand-border-strong px-4 text-[13px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("retryWithSeeds")}
              </button>
            ) : null}
          </details>
        ))}
      </div>
      <div className="mt-5 border-t border-brand-border-faint pt-4">
        <p className={LABEL}>{t("withheldGuidanceTitle")}</p>
        <p className={SECTION_INTRO}>{t("withheldGuidance")}</p>
      </div>
    </section>
  );
}

/**
 * The exit card.
 *
 * `ConnectedToolPage` drops its page-bottom "URL Agents to use next"
 * aside once the visitor has connected — on the grounds that the report below
 * carries its own. This report did not, so a finished run was the one page on
 * the site with nowhere to go next. Same links as the shared aside; only the
 * heading changes, because a reader who has read a report is not being invited
 * to start.
 */
function WhereNext({ locale }: { readonly locale: string }) {
  const t = useTranslations("tools.keywordMap");

  return (
    <aside className={CARD}>
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
        {t("whereNextTitle")}
      </p>
      <p className="mt-3 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
        {t("whereNextBody")}
      </p>
      <div className="mt-5 space-y-3">
        <Link href={localePath(locale, "/agents/seo")} className={NAV_LINK}>
          {t("whereNextAudit")}
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link href={localePath(locale, "/agents/tech")} className={NAV_LINK}>
          {t("whereNextLinks")}
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </aside>
  );
}
