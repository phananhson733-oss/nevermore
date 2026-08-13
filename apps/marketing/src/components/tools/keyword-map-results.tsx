// @input  -- one finished keyword opportunity result and the page's locale
// @output -- the run's verdict, its funnel, the two lanes, groups, and what was held back
// @pos    -- read-only rendering for /[locale]/tools/low-competition-keywords
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type {
  KeywordOpportunityCluster,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunityWithheld,
} from "@sf/public-tools/keyword-opportunity/types";
import {
  KEYWORD_STAGE_GSC_COVERAGE,
  KEYWORD_STAGE_SERP_SAMPLE,
} from "@sf/public-tools/keyword-opportunity/types";
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
}: {
  readonly result: KeywordOpportunityResult;
  readonly locale: string;
}) {
  const seo = result.rows.filter((row) => row.lane === "seo");
  const geo = result.rows.filter((row) => row.lane === "geo");
  // A group of one is not a group. Every keyword that matched nothing becomes
  // its own cluster in the payload, so rendering them all turns "terms that
  // belong on one page" into a second copy of the results table.
  const groups = result.clusters.filter(
    (cluster) => cluster.keywords.length > 1,
  );

  return (
    <div className="mt-8 space-y-4">
      <Verdict result={result} />
      <RunSummary result={result} locale={locale} />

      {result.rows.length === 0 ? (
        <EmptyState degraded={result.unavailableStages.length > 0} />
      ) : (
        <>
          <RowTable rows={seo} lane="seo" />
          <RowTable rows={geo} lane="geo" />
        </>
      )}

      <Groups groups={groups} />
      <Withheld withheld={result.withheld} />
      <WhereNext locale={locale} />
    </div>
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
            {label(
              `availability.${result.availability}`,
              result.availability,
            )}
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

/** What was read, and what each stage of the run saw. */
function RunSummary({
  result,
  locale,
}: {
  readonly result: KeywordOpportunityResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();

  return (
    <section className={CARD}>
      <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
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
    </section>
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

function RowTable({
  rows,
  lane,
}: {
  readonly rows: readonly KeywordOpportunityRow[];
  readonly lane: "seo" | "geo";
}) {
  const t = useTranslations("tools.keywordMap");
  const label = useOptionalLabel();
  if (rows.length === 0) return null;

  return (
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>{t(`lane.${lane}.title`)}</h3>
      <p className={SECTION_INTRO}>{t(`lane.${lane}.intro`)}</p>

      {/* Wide on purpose; the page must never scroll sideways because of it. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-brand-border-card">
              <th scope="col" className={`${LABEL} pr-4 pb-2`}>
                {t("columns.keyword")}
              </th>
              {lane === "seo" ? (
                <>
                  <th scope="col" className={`${LABEL} pr-4 pb-2 text-right`}>
                    {t("columns.volume")}
                  </th>
                  <th scope="col" className={`${LABEL} pr-4 pb-2 text-right`}>
                    {t("columns.difficulty")}
                  </th>
                  <th scope="col" className={`${LABEL} pr-4 pb-2 text-right`}>
                    {t("columns.weakest")}
                  </th>
                </>
              ) : (
                <th scope="col" className={`${LABEL} pr-4 pb-2`}>
                  {t("columns.supportingPage")}
                </th>
              )}
              <th scope="col" className={`${LABEL} pr-4 pb-2`}>
                {t("columns.coverage")}
              </th>
              <th scope="col" className={`${LABEL} pr-4 pb-2`}>
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
                  {label(`coverage.${row.coverage}`, row.coverage)}
                </td>
                <td className="py-3 text-[12.5px] text-text-dark-secondary">
                  <ul className="space-y-1">
                    {row.nextChecks.map((check) => (
                      <li key={check}>{label(`checks.${check}`, check)}</li>
                    ))}
                  </ul>
                </td>
              </tr>
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
}: {
  readonly withheld: readonly KeywordOpportunityWithheld[];
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
      <h3 className={SECTION_TITLE}>{t("withheldTitle")}</h3>
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
          </details>
        ))}
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
        <Link
          href={localePath(locale, "/agents/seo")}
          className={NAV_LINK}
        >
          {t("whereNextAudit")}
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link
          href={localePath(locale, "/agents/tech")}
          className={NAV_LINK}
        >
          {t("whereNextLinks")}
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </aside>
  );
}
