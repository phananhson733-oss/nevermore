// @input  -- one Daily Briefing envelope, property identity, quota facts, and tab storage
// @output -- localized KPI, evidence, change, handoff, manual-check, and limitation panels
// @pos    -- non-persistent result artifact inside the Daily Briefing tool

"use client";

import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Database,
  Eye,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type {
  DailyBriefingAction,
  DailyBriefingChange,
  DailyBriefingChangeKind,
  DailyBriefingEnvelope,
  DailyBriefingKpiComparison,
  DailyBriefingLaneCapability,
  DailyBriefingLaneState,
  DailyBriefingPageLaneState,
  DailyBriefingMode,
  DailyBriefingObservationBand,
  DailyBriefingPageAccounting,
  DailyBriefingPageAction,
  DailyBriefingPageChangeKind,
  DailyBriefingPropertyChange,
  DailyBriefingPropertyTrend,
  DailyBriefingProvisionalMove,
  DailyBriefingQueryWatchlist,
  DailyBriefingRowAccounting,
  DailyBriefingSignalFunnel,
  DailyBriefingSuggestedCheck,
} from "@sf/public-tools";
import { localePath } from "../../lib/locale-path";
import { writeToolHandoff } from "../../lib/tools/tool-handoff";

const CARD =
  "rounded-[12px] border border-brand-border-card bg-brand-bg p-4 md:p-[18px]";
const EYEBROW =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
/** Query rows this page will show, changes and observations together. */
const DISPLAY_ROW_LIMIT = 3;
/**
 * Page rows this page will show, counted apart from the query ones.
 *
 * A shared budget spent query-first let three query candidates hide every page
 * measurement, which is the size of one population deciding the visibility of
 * the other.
 */
const DISPLAY_PAGE_ROW_LIMIT = 2;
const TABLE_HEADER =
  "font-mono text-[11px] font-semibold tracking-[0.1em] text-text-dark-secondary uppercase";

type RateLimitFacts = {
  readonly remaining: number | null;
  readonly limit: number;
};

interface DailyBriefingResultsProps {
  readonly locale: string;
  readonly property: string;
  readonly envelope: DailyBriefingEnvelope;
  readonly rateLimit: RateLimitFacts | null;
}

interface ResultPreviewSectionProps {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly body: string;
  readonly kind: "changes" | "actions";
}

interface NoiseSummaryProps {
  readonly funnel: DailyBriefingSignalFunnel;
  readonly laneCapability: DailyBriefingLaneCapability;
}

interface SignalPathEvidenceProps {
  readonly funnel: DailyBriefingSignalFunnel;
  readonly laneCapability: DailyBriefingLaneCapability;
  readonly rowAccounting: DailyBriefingRowAccounting;
  readonly pageAccounting: DailyBriefingPageAccounting;
}

type MetricKey = "clicks" | "impressions" | "ctr" | "position";

const METRICS: readonly MetricKey[] = [
  "clicks",
  "impressions",
  "ctr",
  "position",
];

function number(locale: string, value: number): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricValue(
  locale: string,
  comparison: DailyBriefingKpiComparison,
  metric: MetricKey,
): string | null {
  const value = comparison.current?.[metric] ?? null;
  if (value === null) return null;
  if (metric === "ctr") return percent(value);
  if (metric === "position") return value.toFixed(1);
  return number(locale, value);
}

function metricDelta(
  locale: string,
  comparison: DailyBriefingKpiComparison,
  metric: MetricKey,
): string | null {
  const value = comparison.delta[metric];
  if (value === null) return null;
  let absolute: string;
  switch (metric) {
    case "ctr":
      absolute = percent(Math.abs(value));
      break;
    case "position":
      absolute = Math.abs(value).toFixed(1);
      break;
    default:
      absolute = number(locale, Math.abs(value));
  }
  if (value > 0) return `+${absolute}`;
  if (value < 0) return `-${absolute}`;
  return absolute;
}

function metricLabel(
  metric: MetricKey,
): "kpis.clicks" | "kpis.impressions" | "kpis.ctr" | "kpis.averagePosition" {
  switch (metric) {
    case "clicks":
      return "kpis.clicks";
    case "impressions":
      return "kpis.impressions";
    case "ctr":
      return "kpis.ctr";
    case "position":
      return "kpis.averagePosition";
  }
}

function destination(
  actionDestination: DailyBriefingAction["destination"],
): {
  readonly path: string;
  readonly labelKey:
    | "actionDestinations.seo-quick-wins"
    | "actionDestinations.traffic-drop-diagnosis"
    | "actionDestinations.on-page-seo-check";
} {
  switch (actionDestination) {
    case "seo-quick-wins":
      return {
        path: "/tools/seo-quick-wins",
        labelKey: "actionDestinations.seo-quick-wins",
      };
    case "traffic-drop-diagnosis":
      return {
        path: "/tools/traffic-drop-diagnosis",
        labelKey: "actionDestinations.traffic-drop-diagnosis",
      };
    case "on-page-seo-check":
      return {
        path: "/tools/on-page-seo-check",
        labelKey: "actionDestinations.on-page-seo-check",
      };
  }
}

function metricsLine(
  t: ReturnType<typeof useTranslations>,
  locale: string,
  row: DailyBriefingChange["current"],
): string {
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : null;
  return t("changes.metrics", {
    clicks: number(locale, row.clicks),
    impressions: number(locale, row.impressions),
    ctr: ctr === null ? t("kpis.unavailable") : percent(ctr),
    position: Number.isFinite(row.position)
      ? row.position.toFixed(1)
      : t("kpis.unavailable"),
  });
}

function comparison(
  previous: number | null,
  current: number,
  format: (value: number) => string,
  notObserved: string,
): string {
  return `${previous === null ? notObserved : format(previous)} → ${format(current)}`;
}

function nullableComparison(
  previous: number | null,
  current: number | null,
  format: (value: number) => string,
  unavailable: string,
): string {
  const formatObserved = (value: number | null) =>
    value === null || !Number.isFinite(value) ? unavailable : format(value);
  return `${formatObserved(previous)} → ${formatObserved(current)}`;
}

function signedMetric(
  locale: string,
  value: number | null,
  unavailable: string,
  digits = 1,
): string {
  if (value === null || !Number.isFinite(value)) return unavailable;
  const formatted =
    digits === 0
      ? number(locale, Math.abs(value))
      : Math.abs(value).toFixed(digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return digits === 0 ? "0" : (0).toFixed(digits);
}

/**
 * Why the page state is asked about at all.
 *
 * The two dimensions fail separately. Keying this card on the query state
 * alone let a run whose page paths ran, and found nothing, announce that
 * "comparable query/page evidence is unavailable" — one population's failure
 * printed over the other's measured result.
 */
function reviewEmptyMessageKey(
  evidence: DailyBriefingQueryWatchlist["evidence"],
  pageRead: boolean,
):
  | "review.empty"
  | "review.partial"
  | "review.unavailable"
  | "review.partialQueryRead"
  | "review.unavailableQueryRead" {
  switch (evidence) {
    case "observed":
      return "review.empty";
    case "partial":
      return pageRead ? "review.partialQueryRead" : "review.partial";
    case "unavailable":
      return pageRead ? "review.unavailableQueryRead" : "review.unavailable";
  }
}

/**
 * Why this run is weekly, in the terms of the evidence that decided it.
 *
 * Written as an exhaustive switch so adding a mode fails the build instead of
 * silently rendering the sentence that explains a different one.
 */
function cadenceDetailKey(
  mode: DailyBriefingMode,
  dailyCadence: boolean,
  clickLaneEvaluated: boolean,
): string {
  if (dailyCadence) return "facts.dailyReason";
  switch (mode) {
    case "change_detection":
      // A property with plenty of impressions and no click lane is weekly
      // because of the lane, not the sample. Saying "the sample is too small"
      // there names a gate the run never hit.
      return clickLaneEvaluated
        ? "facts.weeklyReason"
        : "facts.noClickLaneReason";
    case "position_observation":
      return "facts.positionObservationReason";
    case "current_position_watchlist":
      return "facts.currentWatchlistReason";
    case "unavailable":
      return "facts.unavailableReason";
  }
}

function reviewIntroKey(mode: DailyBriefingMode): string {
  switch (mode) {
    case "change_detection":
      return "review.intro";
    case "position_observation":
      return "review.introPositionObservation";
    case "current_position_watchlist":
      return "review.introCurrentWatchlist";
    case "unavailable":
      return "review.introUnavailable";
  }
}

const OBSERVATION_BANDS: readonly DailyBriefingObservationBand[] = [
  "page_one",
  "near_page_one",
  "mid",
  "far",
];

/**
 * Name the observations the row budget dropped, band by band.
 *
 * A row that cleared every threshold and lost the cut is not a row that fell
 * below one, and the fold summary used to call both of them the same thing.
 */
function withheldBreakdown(
  t: ReturnType<typeof useTranslations>,
  locale: string,
  withheldByBand: Readonly<
    Record<DailyBriefingObservationBand, number>
  > | null,
): string | null {
  if (withheldByBand === null) return null;
  const parts = OBSERVATION_BANDS.filter(
    (band) => withheldByBand[band] > 0,
  ).map((band) =>
    t(`review.withheldBands.${band}`, { count: withheldByBand[band] }),
  );
  if (parts.length === 0) return null;
  return parts.join(locale === "zh" ? "、" : ", ");
}

function propertyWeeklyComparisons(
  t: ReturnType<typeof useTranslations>,
  locale: string,
  change: DailyBriefingPropertyChange,
): {
  readonly clicks: string;
  readonly ctr: string;
  readonly impressions: string;
  readonly position: string;
} {
  return {
    clicks: nullableComparison(
      change.previous.clicks,
      change.current.clicks,
      (value) => number(locale, value),
      t("kpis.unavailable"),
    ),
    impressions: nullableComparison(
      change.previous.impressions,
      change.current.impressions,
      (value) => number(locale, value),
      t("kpis.unavailable"),
    ),
    ctr: nullableComparison(
      change.previous.ctr,
      change.current.ctr,
      percent,
      t("kpis.unavailable"),
    ),
    position: nullableComparison(
      change.previous.position,
      change.current.position,
      (value) => value.toFixed(1),
      t("kpis.unavailable"),
    ),
  };
}

function matchingActions(
  envelope: DailyBriefingEnvelope,
): readonly {
  readonly action: DailyBriefingAction;
  readonly change: DailyBriefingChange;
}[] {
  return envelope.result.actions
    .flatMap((action) => {
      const change = envelope.result.changes.find(
        (candidate) =>
          candidate.kind === action.kind &&
          candidate.query === action.query &&
          candidate.page === action.page,
      );
      return change ? [{ action, change }] : [];
    })
    .slice(0, 3);
}

function ResultPreviewSection({
  id,
  title,
  intro,
  body,
  kind,
}: ResultPreviewSectionProps) {
  return (
    <section
      aria-labelledby={id}
      data-result-preview={kind}
      className="scroll-mt-8"
    >
      <h3
        id={id}
        className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
      >
        {title}
      </h3>
      <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {intro}
      </p>
      <div className={`${CARD} mt-4`}>
        <p className="max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {body}
        </p>
      </div>
    </section>
  );
}

function NoiseSummary({ funnel, laneCapability }: NoiseSummaryProps) {
  const t = useTranslations("tools.dailyBriefing");
  const strictPaired = laneCapability.strictPairedPositionQueries;
  const clickDecline = laneCapability.clickDeclineCapableQueries;
  const provisional = laneCapability.provisionalPairedPositionQueries;
  const currentOnly = laneCapability.currentFloorOnlyQueries;
  // The impression floor says a row carries a sample. It never says a lane
  // looked at the row, which is why the counts beside it are the ones that
  // answer "was anything actually compared".
  const observedSummary =
    funnel.evidence === "observed" &&
    funnel.observedQueryRows !== null &&
    funnel.actionEligibleQueries !== null &&
    strictPaired !== null &&
    clickDecline !== null &&
    provisional !== null &&
    currentOnly !== null
      ? t("noise.observed", {
          observed: funnel.observedQueryRows,
          eligible: funnel.actionEligibleQueries,
          strictPaired,
          clickDecline,
          provisional,
          currentOnly,
        })
      : null;
  const partialSummary =
    funnel.evidence === "partial" && funnel.observedQueryRows !== null
      ? t("noise.partial", { observed: funnel.observedQueryRows })
      : null;

  return (
    <section
      aria-labelledby="daily-briefing-noise"
      data-result-section="noise"
      className="mt-5 rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft px-4 py-3.5"
    >
      <h4
        id="daily-briefing-noise"
        className={`${EYEBROW} text-brand-accent-text`}
      >
        {t("noise.label")}
      </h4>
      <p className="mt-2 max-w-4xl text-[12.5px] leading-[1.65] text-text-dark-secondary">
        {observedSummary ?? partialSummary ?? t("noise.unavailable")}
      </p>
      {observedSummary !== null && funnel.observationCandidates !== null ? (
        <p className="mt-1.5 max-w-4xl text-[12.5px] leading-[1.65] text-text-dark-secondary">
          {t("noise.observationOnly", { count: funnel.observationCandidates })}
        </p>
      ) : null}
    </section>
  );
}

const PAGE_SIGNAL_PATHS: readonly {
  readonly key: string;
  readonly copyKey: string;
  readonly kind: DailyBriefingPageChangeKind;
}[] = [
  {
    key: "page-click-decline",
    copyKey: "pageClickDecline",
    kind: "page_click_decline",
  },
  {
    key: "page-first-observed",
    copyKey: "pageFirstObserved",
    kind: "page_first_observed",
  },
];

const SIGNAL_PATHS: readonly {
  readonly key: string;
  readonly copyKey: string;
  readonly kind: DailyBriefingChangeKind;
}[] = [
  {
    key: "click-opportunity",
    copyKey: "clickOpportunity",
    kind: "click_opportunity",
  },
  {
    key: "stable-decline",
    copyKey: "stableDecline",
    kind: "stable_position_click_decline",
  },
  {
    key: "page-one-band",
    copyKey: "pageOneBand",
    kind: "average_position_crossed_page_one_band",
  },
  {
    key: "position-decline",
    copyKey: "positionDecline",
    kind: "actionable_position_decline",
  },
  {
    key: "first-observed",
    copyKey: "firstObserved",
    kind: "first_observed",
  },
];

function PathTier({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mt-5">
      <h5 className={EYEBROW}>{title}</h5>
      <div className="mt-2.5 grid gap-3">{children}</div>
    </div>
  );
}

/**
 * Which paths ran, which could not, and where every row went.
 *
 * This replaces a seven-cell grid whose every cell read "observed - 0". That
 * grid could not tell a path with nothing to measure from a path that never
 * ran, and it stamped "observed" on both. Each line here carries its own
 * requirement and its own row split, so the distinction is readable rather
 * than encoded in a badge.
 */
function SignalPathEvidence({
  funnel,
  laneCapability,
  rowAccounting,
  pageAccounting,
}: SignalPathEvidenceProps) {
  const t = useTranslations("tools.dailyBriefing");
  const byLane = rowAccounting.byLane;
  const ctrLane = laneCapability.ctrLane;
  const withheld = funnel.pageAttributionWithheld;

  return (
    <div data-signal-paths className="mt-6 border-t border-brand-border pt-5">
      <h4 className="text-[13px] font-semibold text-text-dark-primary">
        {t("evidence.paths.title")}
      </h4>
      <p className="mt-1.5 max-w-4xl text-[12px] leading-[1.6] text-text-dark-secondary">
        {t("evidence.paths.intro")}
      </p>

      <PathTier title={t("evidence.paths.tiers.baseline")}>
        <PathLine
          id="ctr-baseline"
          state={ctrLane.state}
          name={t("evidence.paths.ctrBaseline.name")}
          finding={null}
          requirement={t("evidence.paths.laneRequirement", {
            requirement: t("evidence.paths.ctrBaseline.requirement"),
          })}
          outcome={
            ctrLane.state === "evaluated" && ctrLane.usableBaselineBands !== null
              ? t("evidence.paths.ctrBaseline.evaluated", {
                  bands: ctrLane.usableBaselineBands,
                })
              : ctrLane.state === "unavailable"
                ? t("evidence.paths.ctrBaseline.unavailable")
                : ctrLane.blockers.length === 0
                  ? t("ctrLane.blockers.unknown")
                  : ctrLane.blockers
                      .map((blocker) => t(`ctrLane.blockers.${blocker}`))
                      .join(" ")
          }
        />
      </PathTier>

      <PathTier title={t("evidence.paths.tiers.lanes")}>
        {rowAccounting.observedRows !== null ? (
          <p className="text-[12px] leading-[1.6] text-text-dark-secondary">
            {t("evidence.paths.rowsIntro", {
              rows: rowAccounting.observedRows,
            })}
          </p>
        ) : null}
        {SIGNAL_PATHS.map((path) => {
          const state = laneCapability.lanes[path.kind];
          const counts = byLane === null ? null : byLane[path.kind];
          return (
            <PathLine
              key={path.key}
              id={path.key}
              state={state}
              name={t(`evidence.paths.lanes.${path.copyKey}.name`)}
              requirement={t("evidence.paths.laneRequirement", {
                requirement: t(
                  `evidence.paths.lanes.${path.copyKey}.requirement`,
                ),
              })}
              // The precondition says what could be asked; the hit condition
              // says what would have counted as an answer. A reader needs both
              // to work out why their query is not on the page.
              finding={t("evidence.paths.laneFinding", {
                finding: t(`evidence.paths.lanes.${path.copyKey}.finding`),
              })}
              outcome={
                state === "unavailable" || counts === null
                  ? t("evidence.paths.laneUnavailable")
                  : t("evidence.paths.rowSplit", { ...counts })
              }
            />
          );
        })}
      </PathTier>

      <PathTier title={t("evidence.paths.tiers.pageLanes")}>
        {/* Its own row count, deliberately beside the query one rather than
            added to it. Pages and queries are different populations and a
            single total would measure neither. */}
        {pageAccounting.observedRows !== null ? (
          <p
            data-page-rows-intro
            className="text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            {t("evidence.paths.pageRowsIntro", {
              rows: pageAccounting.observedRows,
            })}
            {pageAccounting.unreadableRows !== null &&
            pageAccounting.unreadableRows > 0
              ? ` ${t("evidence.paths.pageUnreadableRows", {
                  count: pageAccounting.unreadableRows,
                })}`
              : null}
          </p>
        ) : (
          <p className="text-[12px] leading-[1.6] text-text-dark-secondary">
            {t("evidence.paths.pageUnavailable")}
          </p>
        )}
        {PAGE_SIGNAL_PATHS.map((path) => {
          const state = laneCapability.pageLanes[path.kind];
          const counts =
            pageAccounting.byLane === null
              ? null
              : pageAccounting.byLane[path.kind];
          return (
            <PathLine
              key={path.key}
              id={path.key}
              state={state}
              name={t(`evidence.paths.pageLanes.${path.copyKey}.name`)}
              requirement={t("evidence.paths.laneRequirement", {
                requirement: t(
                  `evidence.paths.pageLanes.${path.copyKey}.requirement`,
                ),
              })}
              finding={t("evidence.paths.laneFinding", {
                finding: t(`evidence.paths.pageLanes.${path.copyKey}.finding`),
              })}
              outcome={
                state === "unavailable" || counts === null
                  ? t("evidence.paths.laneUnavailable")
                  : // The split still applies to the rows it could read, so it
                    // is printed beside the caveat rather than replaced by it.
                    `${t("evidence.paths.rowSplit", { ...counts })}${
                      state === "partially_readable"
                        ? ` ${t("evidence.paths.lanePartiallyReadable")}`
                        : ""
                    }`
              }
            />
          );
        })}
      </PathTier>

      <PathTier title={t("evidence.paths.selectionTitle")}>
        {/* Passing every stated gate is not the same as reaching the table.
            Three presentation rules stand between a candidate and a row, and
            leaving them unstated made the two lines above look sufficient. */}
        <p
          data-selection-rules
          className="border-l border-brand-border pl-3 text-[11.5px] leading-[1.55] text-text-dark-secondary"
        >
          {t("evidence.paths.selectionRules")}
        </p>
        {/* One line per population, never their sum. The two accountings
            count different things, so adding them invents a total that
            measures neither — and a null on either side is not a zero on the
            other. */}
        {(
          [
            ["query", rowAccounting.notSelectedVisibleRows],
            ["page", pageAccounting.notSelectedVisibleRows],
          ] as const
        ).map(([scope, notShown]) => (
          <p
            key={scope}
            data-selection-not-shown={scope}
            className="border-l border-brand-border pl-3 font-mono text-[11px] leading-[1.6] text-text-dark-secondary"
          >
            {notShown === null
              ? t(
                  scope === "query"
                    ? "evidence.paths.selectionUnavailableQuery"
                    : "evidence.paths.selectionUnavailablePage",
                )
              : notShown === 0
                ? t(
                    scope === "query"
                      ? "evidence.paths.selectionAllShownQuery"
                      : "evidence.paths.selectionAllShownPage",
                  )
                : t(
                    scope === "query"
                      ? "evidence.paths.selectionNotShownQuery"
                      : "evidence.paths.selectionNotShownPage",
                    { count: notShown },
                  )}
          </p>
        ))}
      </PathTier>

      <PathTier title={t("evidence.paths.tiers.suppression")}>
        <PathLine
          id="page-attribution"
          state={withheld === null ? "unavailable" : "evaluated"}
          name={t("evidence.paths.pageAttribution.name")}
          finding={null}
          requirement={null}
          outcome={
            withheld === null
              ? t("evidence.paths.pageAttribution.unavailable")
              : withheld === 0
                ? t("evidence.paths.pageAttribution.none")
                : t("evidence.paths.pageAttribution.observed", {
                    count: withheld,
                  })
          }
        />
      </PathTier>
    </div>
  );
}

function PathLine({
  finding,
  id,
  name,
  outcome,
  requirement,
  state,
}: {
  readonly id: string;
  readonly name: string;
  readonly finding: string | null;
  readonly outcome: string;
  readonly requirement: string | null;
  readonly state: DailyBriefingLaneState | DailyBriefingPageLaneState;
}) {
  return (
    <div
      data-signal-path={id}
      data-path-state={state}
      className="border-l border-brand-border pl-3"
    >
      <p className="text-[12.5px] leading-[1.5] font-semibold text-text-dark-primary">
        {name}
      </p>
      {requirement === null ? null : (
        <p className="mt-1 max-w-4xl text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {requirement}
        </p>
      )}
      {finding === null ? null : (
        <p className="mt-0.5 max-w-4xl text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {finding}
        </p>
      )}
      <p
        data-path-outcome
        className="mt-1 max-w-4xl font-mono text-[11px] leading-[1.6] text-text-dark-secondary"
      >
        {outcome}
      </p>
    </div>
  );
}

export function DailyBriefingResultPreview() {
  const t = useTranslations("tools.dailyBriefing");

  return (
    <div className="mt-8 space-y-8">
      <ResultPreviewSection
        id="daily-briefing-preview-changes"
        kind="changes"
        title={t("review.title")}
        intro={t("review.intro")}
        body={t("preview.changes")}
      />
      <ResultPreviewSection
        id="daily-briefing-preview-actions"
        kind="actions"
        title={t("actions.title")}
        intro={t("actions.intro")}
        body={t("preview.actions")}
      />
    </div>
  );
}

export function DailyBriefingResults({
  locale,
  property,
  envelope,
  rateLimit,
}: DailyBriefingResultsProps) {
  const t = useTranslations("tools.dailyBriefing");
  const [manualChecked, setManualChecked] = useState(false);
  const [securityChecked, setSecurityChecked] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const { result } = envelope;
  const dailyAvailable =
    result.cadence === "daily" && result.day.evidence === "observed";
  const queryActions = matchingActions(envelope);
  // The site-wide trend is the property's own fact. It used to be dropped the
  // moment any query signal was selected, which deleted the only whole-site
  // statement in the briefing exactly when the briefing had the most to say.
  const propertyChange = result.propertyTrend.change;
  const propertyAction = result.propertyTrend.action;
  const propertyNoiseFloor = result.propertyTrend.noiseFloor;
  const propertyComparisons =
    propertyChange === null
      ? null
      : propertyWeeklyComparisons(t, locale, propertyChange);
  const propertyTarget =
    propertyAction === null ? null : destination(propertyAction.destination);
  const currentCoverage = result.coverage.current;
  const currentAnonymization = result.anonymization.current;
  const shownChanges = result.changes.slice(0, DISPLAY_ROW_LIMIT);
  // Its own budget, not what the query rows left over. Allocating page
  // evidence from query leftovers made the number of query candidates decide
  // whether a page measurement was visible at all, which is one population
  // ranked by the size of the other.
  const shownPageChanges = result.pageChanges.slice(0, DISPLAY_PAGE_ROW_LIMIT);
  // Provisional moves name a movement, so they outrank rows that only name a
  // position. The engine already applies this budget; the page applies it
  // again so no contract change can put a fourth row on screen.
  const shownProvisional = result.provisionalMoves.items.slice(
    0,
    Math.max(0, DISPLAY_ROW_LIMIT - shownChanges.length),
  );
  const watchlistItems =
    result.queryWatchlist.evidence === "observed"
      ? result.queryWatchlist.items
      : [];
  const shownObservations = watchlistItems.slice(
    0,
    Math.max(
      0,
      DISPLAY_ROW_LIMIT - shownChanges.length - shownProvisional.length,
    ),
  );
  const withheldObservations = Math.max(
    0,
    (result.queryWatchlist.candidates ?? 0) - shownObservations.length,
  );
  const withheldObservationBands = withheldBreakdown(
    t,
    locale,
    result.queryWatchlist.withheldByBand,
  );
  const withheldProvisional = Math.max(
    0,
    (result.provisionalMoves.candidates ?? 0) - shownProvisional.length,
  );
  const pageActions = result.pageActions
    .flatMap((action) => {
      const change = result.pageChanges.find(
        (candidate) =>
          candidate.kind === action.kind && candidate.page === action.page,
      );
      return change ? [{ action, change }] : [];
    })
    .slice(0, DISPLAY_ROW_LIMIT);
  // Checks are offered against current standing, never against a change, so
  // they are listed after every evidence-backed action and labelled as what
  // they are. Only the checks whose row is actually on screen are offered.
  const suggestedChecks = result.suggestedChecks.items;
  // Left as null when nothing was read. Coercing to zero here would have the
  // checks panel say "no shown row failed to become a check" about a run that
  // showed none.
  const notCheckable = result.suggestedChecks.notCheckable;
  const uncheckableShown = notCheckable !== null && notCheckable > 0;
  const ctrLane = result.laneCapability.ctrLane;
  // Only the click-driven lanes move on a daily timescale, which is what
  // decides both the cadence and the sentence explaining it.
  // The page click lane counts here too. Leaving it out let a run whose page
  // clicks were measured, and which went weekly purely on the impression
  // floor, explain itself with "only position paths could be evaluated".
  const clickLaneEvaluated =
    result.laneCapability.lanes.click_opportunity === "evaluated" ||
    result.laneCapability.lanes.stable_position_click_decline === "evaluated" ||
    result.laneCapability.pageLanes.page_click_decline === "evaluated" ||
    result.laneCapability.pageLanes.page_click_decline === "partially_readable";

  // Every count in the summary is query-derived, so when the query rows were
  // never read none of them may be printed: a run that could not look is not
  // a run that found nothing. The shown counts are also labelled as shown,
  // never as the category total the display budget cut them down from.
  const queryEvidenceRead = result.queryWatchlist.candidates !== null;
  const provisionalCandidates = result.provisionalMoves.candidates ?? 0;
  // Page changes are counted whether or not the query read succeeded: the two
  // dimensions fail separately, and a run whose queries were unreadable can
  // still put a page row in the table above this summary.
  // "0 site trend observations" is a measurement. A weekly comparison that
  // could not be read did not measure zero of them, and `propertyTrend.change`
  // is null in both cases.
  const foldTrend =
    result.weekly.evidence === "observed"
      ? t("evidence.foldTrend", { count: propertyChange === null ? 0 : 1 })
      : t("evidence.foldTrendUnavailable");
  const foldPageChanges =
    shownPageChanges.length > 0
      ? t("evidence.foldPageChanges", { count: shownPageChanges.length })
      : null;
  const foldSummary = (
    queryEvidenceRead
      ? [
          t("evidence.foldChanges", { count: shownChanges.length }),
          foldPageChanges,
          provisionalCandidates > 0
            ? t("evidence.foldProvisional", {
                shown: shownProvisional.length,
                candidates: provisionalCandidates,
              })
            : null,
          foldTrend,
          t("evidence.foldObservationsShown", {
            shown: shownObservations.length,
            candidates: result.queryWatchlist.candidates ?? 0,
          }),
        ]
      : [
          t("evidence.foldQueryEvidenceUnavailable"),
          foldPageChanges,
          foldTrend,
        ]
  )
    .filter((part): part is string => part !== null)
    .join(" · ");

  function handoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    action: DailyBriefingAction,
    index: number,
  ) {
    let written = false;
    try {
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: action.destination,
        scope: "query_page",
        property,
        query: action.query,
        page: action.page,
        evidenceId: `daily:${index}:${action.kind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  function pageHandoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    action: DailyBriefingPageAction,
  ) {
    let written = false;
    try {
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: action.destination,
        // A page and no query: the queries that moved it are anonymized, and
        // inventing one to fit the query_page shape would hand the next tool a
        // term this briefing never saw.
        scope: "page",
        property,
        query: null,
        page: action.page,
        evidenceId: `daily:page:${action.kind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  function checkHandoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    check: DailyBriefingSuggestedCheck,
  ) {
    let written = false;
    try {
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: check.destination,
        scope: "query_page",
        property,
        query: check.query,
        page: check.page,
        // Deliberately not an action index. A check never entered the action
        // list and must not be counted as one downstream.
        evidenceId: `daily:check:${check.sampleKind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  function provisionalHandoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    move: DailyBriefingProvisionalMove,
  ) {
    let written = false;
    try {
      if (move.page === null) {
        event.preventDefault();
        setHandoffFailed(true);
        return;
      }
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: "on-page-seo-check",
        scope: "query_page",
        property,
        query: move.query,
        page: move.page,
        // Deliberately not an action index: this row never entered the action
        // list and must not be counted as one downstream.
        evidenceId: `daily:provisional:${move.kind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  function propertyHandoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    trend: DailyBriefingPropertyTrend,
  ) {
    let written = false;
    try {
      if (trend.action === null || trend.change === null) {
        event.preventDefault();
        setHandoffFailed(true);
        return;
      }
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: trend.action.destination,
        scope: "property",
        property,
        query: null,
        page: null,
        evidenceId: `daily:property:${trend.change.kind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-[12.5px] text-brand-success"
      >
        <Check aria-hidden="true" className="size-4" />
        {t("runComplete")}
      </p>

      <section
        aria-labelledby="daily-briefing-facts"
        data-result-section="facts"
      >
        <h3 id="daily-briefing-facts" className="sr-only">
          {t("facts.dataThrough")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FactCard
            icon={<Database aria-hidden="true" className="size-4" />}
            label={t("facts.dataThrough")}
            value={result.windows.latestDay.endDate}
          />
          <FactCard
            icon={<Eye aria-hidden="true" className="size-4" />}
            label={t("facts.timeBasis")}
            value={t("facts.timeBasisBody")}
          />
          <FactCard
            icon={<Gauge aria-hidden="true" className="size-4" />}
            label={t("facts.cadence")}
            value={
              result.cadence === "daily" ? t("facts.daily") : t("facts.weekly")
            }
            detail={t(
              cadenceDetailKey(
                result.mode,
                result.cadence === "daily",
                clickLaneEvaluated,
              ),
            )}
          />
          <FactCard
            icon={<ShieldCheck aria-hidden="true" className="size-4" />}
            label={t("facts.sharedRuns")}
            value={
              rateLimit === null || rateLimit.remaining === null
                ? t("facts.quotaUnavailable")
                : t("facts.quotaAvailable", {
                    remaining: rateLimit.remaining,
                    limit: rateLimit.limit,
                  })
            }
          />
        </div>
      </section>

      <section
        aria-labelledby="daily-briefing-kpis"
        data-result-section="kpis"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h3
            id="daily-briefing-kpis"
            className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
          >
            {t("kpis.title")}
          </h3>
          <p className="max-w-xl text-[12.5px] leading-[1.55] text-text-dark-secondary">
            {t("kpis.positionNote")}
          </p>
        </div>
        {!dailyAvailable ? (
          <p className="mt-3 text-[12.5px] text-brand-warning">
            {t("kpis.dailySuppressed")}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <KpiCard
              key={metric}
              metric={metric}
              label={t(metricLabel(metric))}
              locale={locale}
              day={result.day}
              weekly={result.weekly}
              dailyAvailable={dailyAvailable}
            />
          ))}
        </div>
      </section>


      <section
        aria-labelledby="daily-briefing-changes"
        data-result-section="changes"
      >
        <h3
          id="daily-briefing-changes"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("review.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t(reviewIntroKey(result.mode))}
        </p>
        {ctrLane.state !== "evaluated" ? (
          <div
            data-ctr-lane-blocked
            className={`${CARD} mt-4 border-brand-warning/30 bg-brand-warning/[0.06]`}
          >
            <p className={`${EYEBROW} text-brand-warning`}>
              {t("ctrLane.notEvaluated")}
            </p>
            <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.65] text-text-dark-secondary">
              {ctrLane.blockers.length === 0
                ? t("ctrLane.blockers.unknown")
                : ctrLane.blockers
                    .map((blocker) => t(`ctrLane.blockers.${blocker}`))
                    .join(" ")}
            </p>
            {ctrLane.blockers.includes("brand_terms_not_confirmed") ? (
              <a
                data-ctr-lane-confirm-link
                href="#daily-briefing-brand-terms"
                className="mt-3 inline-flex text-[11.5px] leading-[1.6] font-semibold text-brand-accent-text underline decoration-brand-accent/35 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("ctrLane.confirmAndRerun")}
              </a>
            ) : null}
          </div>
        ) : null}
        {shownChanges.length === 0 &&
        shownPageChanges.length === 0 &&
        shownProvisional.length === 0 &&
        shownObservations.length === 0 ? (
          <div data-change-empty className={`${CARD} mt-4`}>
            <p className="max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {t(
                reviewEmptyMessageKey(
                  result.queryWatchlist.evidence,
                  result.pageAccounting.evidence === "observed",
                ),
              )}
            </p>
          </div>
        ) : (
          <div
            role="table"
            aria-label={t("review.title")}
            className="mt-4 overflow-hidden rounded-[12px] border border-brand-border-card bg-brand-bg"
          >
            <div
              role="row"
              className="sr-only border-brand-border-card bg-brand-panel px-4 py-4 md:not-sr-only md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5"
            >
              {[
                t("review.columns.status"),
                t("review.columns.queryPage"),
                t("review.columns.clicks"),
                t("review.columns.position"),
                t("review.columns.interpretation"),
              ].map((header) => (
                <div
                  key={header}
                  role="columnheader"
                  className={TABLE_HEADER}
                >
                  {header}
                </div>
              ))}
            </div>
            {/* Both populations get a boundary, and the page rows come after
                every query row rather than between them. A single heading in
                the middle left the query observations rendering below it, so
                they read as part of the page population. */}
            {shownPageChanges.length > 0 &&
            shownChanges.length +
              shownProvisional.length +
              shownObservations.length >
              0 ? (
              <div
                role="row"
                data-review-group="query"
                className="border-t border-brand-border-card bg-brand-panel px-4 py-2.5"
              >
                <div role="cell" className={EYEBROW}>
                  {t("review.queryGroup")}
                </div>
              </div>
            ) : null}
            {shownChanges.map((change, index) => (
              <div
                key={`change:${index}:${change.kind}`}
                role="row"
                data-review-row
                data-change
                className="grid min-w-0 gap-3 border-t border-brand-border-card px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5 md:px-4 md:py-5"
              >
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.status")}
                  </span>
                  <div className="mt-2 flex min-w-0 items-start gap-2.5 md:mt-0">
                    <span className="mt-0.5 shrink-0 rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2 py-0.5 font-mono text-[9.5px] text-brand-accent-text">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h4 className="break-words text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                        {t(`changeKinds.${change.kind}.title`)}
                      </h4>
                      <p className="mt-1.5 font-mono text-[9.5px] leading-[1.4] tracking-[0.04em] text-brand-accent-text uppercase">
                        {t(`evidenceStates.${change.evidence}`)}
                      </p>
                    </div>
                  </div>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.queryPage")}
                  </span>
                  <p className="mt-2 break-words text-[12.5px] leading-[1.5] font-medium text-text-dark-primary md:mt-0">
                    {change.query}
                  </p>
                  <p className="mt-1 break-all text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {change.pageEvidence === "observed" && change.page !== null
                      ? change.page
                      : t("review.pageUnavailable")}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.clicks")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.clicks ?? null,
                      change.current.clicks,
                      (value) => number(locale, value),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.position")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.position ?? null,
                      change.current.position,
                      (value) =>
                        Number.isFinite(value)
                          ? value.toFixed(1)
                          : t("kpis.unavailable"),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.interpretation")}
                  </span>
                  <p className="mt-2 break-words text-[12px] leading-[1.6] text-text-dark-secondary md:mt-0">
                    {t(`changeKinds.${change.kind}.body`)}
                  </p>
                </div>
              </div>
            ))}
            {shownProvisional.map((move) => (
              <div
                key={`provisional:${move.kind}:${move.query}`}
                role="row"
                data-review-row
                data-provisional-row
                className="grid min-w-0 gap-3 border-t border-brand-border-card px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5 md:px-4 md:py-5"
              >
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.status")}
                  </span>
                  <p className="mt-2 inline-flex rounded-full border border-dashed border-brand-border bg-transparent px-2.5 py-1 text-[11px] font-semibold text-text-dark-secondary md:mt-0">
                    {t(`provisionalMoveKinds.${move.kind}.title`)}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.queryPage")}
                  </span>
                  <p className="mt-2 break-words text-[12.5px] leading-[1.5] font-medium text-text-dark-primary md:mt-0">
                    {move.query}
                  </p>
                  <p className="mt-1 break-all text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {move.pageEvidence === "observed" && move.page !== null
                      ? move.page
                      : t("review.pageUnavailable")}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.clicks")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      move.previous.clicks,
                      move.current.clicks,
                      (value) => number(locale, value),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.position")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      move.previous.position,
                      move.current.position,
                      (value) =>
                        Number.isFinite(value)
                          ? value.toFixed(1)
                          : t("kpis.unavailable"),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.interpretation")}
                  </span>
                  <p className="mt-2 break-words text-[12px] leading-[1.6] text-text-dark-secondary md:mt-0">
                    {t(`provisionalMoveKinds.${move.kind}.body`)}
                  </p>
                  <p
                    data-provisional-note
                    className="mt-1.5 break-words text-[11.5px] leading-[1.55] text-text-dark-secondary"
                  >
                    {t("provisional.note", {
                      impressions: number(locale, move.previous.impressions),
                    })}
                  </p>
                  {move.page !== null ? (
                    <Link
                      data-provisional-check-link
                      href={localePath(locale, "/tools/on-page-seo-check")}
                      onClick={(event) => provisionalHandoff(event, move)}
                      className="mt-2 inline-flex text-[11.5px] leading-[1.6] font-semibold text-brand-accent-text underline decoration-brand-accent/35 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                    >
                      {t("provisional.checkPage")}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {shownObservations.map((observation) => {
              // "Not observed" is false for a query whose prior window exists
              // and is merely too small to compare against.
              const priorFallback =
                observation.previousBelowFloor === null
                  ? t("changes.notObserved")
                  : t("review.priorBelowFloor");
              return (
              <div
                key={`observation:${observation.kind}:${observation.query}`}
                role="row"
                data-review-row
                data-observation-row
                className="grid min-w-0 gap-3 border-t border-brand-border-card px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5 md:px-4 md:py-5"
              >
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.status")}
                  </span>
                  <p className="mt-2 inline-flex rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2.5 py-1 text-[11px] font-semibold text-brand-accent-text md:mt-0">
                    {t(`review.observationKinds.${observation.kind}.title`)}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.queryPage")}
                  </span>
                  <p className="mt-2 break-words text-[12.5px] leading-[1.5] font-medium text-text-dark-primary md:mt-0">
                    {observation.query}
                  </p>
                  <p className="mt-1 break-all text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {observation.pageEvidence === "observed" &&
                    observation.page !== null
                      ? observation.page
                      : t("review.pageUnavailable")}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.clicks")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      observation.previous?.clicks ?? null,
                      observation.current.clicks,
                      (value) => number(locale, value),
                      priorFallback,
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.position")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      observation.previous?.position ?? null,
                      observation.current.position,
                      (value) =>
                        Number.isFinite(value)
                          ? value.toFixed(1)
                          : t("kpis.unavailable"),
                      priorFallback,
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.interpretation")}
                  </span>
                  <p className="mt-2 break-words text-[12px] leading-[1.6] text-text-dark-secondary md:mt-0">
                    {t(`review.observationBands.${observation.band}.body`)}
                  </p>
                </div>
              </div>
              );
            })}
            {shownPageChanges.length > 0 ? (
              <div
                role="row"
                data-review-group="page"
                className="border-t border-brand-border-card bg-brand-panel px-4 py-2.5"
              >
                <div role="cell" className={EYEBROW}>
                  {t("review.pageGroup")}
                </div>
              </div>
            ) : null}
            {shownPageChanges.map((change, index) => (
              <div
                key={`page-change:${change.kind}:${change.page}`}
                role="row"
                data-review-row
                data-page-change
                className="grid min-w-0 gap-3 border-t border-brand-border-card px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5 md:px-4 md:py-5"
              >
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.status")}
                  </span>
                  <div className="mt-2 flex min-w-0 items-start gap-2.5 md:mt-0">
                    <span
                      data-page-row-rank
                      className="mt-0.5 shrink-0 rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2 py-0.5 font-mono text-[9.5px] text-brand-accent-text"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h4 className="break-words text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                        {t(`pageChangeKinds.${change.kind}.title`)}
                      </h4>
                      <p className="mt-1.5 font-mono text-[9.5px] leading-[1.4] tracking-[0.04em] text-brand-accent-text uppercase">
                        {t(`evidenceStates.${change.evidence}`)}
                      </p>
                    </div>
                  </div>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.queryPage")}
                  </span>
                  {/* Named as a whole page on purpose. This row has no query
                      behind it, and leaving the cell to imply one would be the
                      substitution the rest of the page refuses. */}
                  <p className="mt-2 break-words text-[12.5px] leading-[1.5] font-medium text-text-dark-primary md:mt-0">
                    {t("review.pageScope")}
                  </p>
                  <p className="mt-1 break-all text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {change.page}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.clicks")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.clicks ?? null,
                      change.current.clicks,
                      (value) => number(locale, value),
                      t("review.pageNotObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.position")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.position ?? null,
                      change.current.position,
                      (value) =>
                        Number.isFinite(value)
                          ? value.toFixed(1)
                          : t("kpis.unavailable"),
                      t("review.pageNotObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("review.columns.interpretation")}
                  </span>
                  <p className="mt-2 break-words text-[12px] leading-[1.6] text-text-dark-secondary md:mt-0">
                    {t(`pageChangeKinds.${change.kind}.body`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        {shownProvisional.length > 0 ? (
          <p
            data-provisional-note-intro
            className="mt-3 max-w-4xl text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            {t("provisional.intro", {
              min: result.provisionalMoves.priorWindowImpressionRange[0],
              max: result.provisionalMoves.priorWindowImpressionRange[1],
            })}
          </p>
        ) : null}
        {withheldProvisional > 0 ? (
          <p
            data-provisional-withheld
            className="mt-1.5 max-w-4xl text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            {t("provisional.withheld", { count: withheldProvisional })}
          </p>
        ) : null}
        {withheldObservations > 0 && withheldObservationBands !== null ? (
          <p
            data-observations-withheld
            className="mt-1.5 max-w-4xl text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            {t("review.withheld", {
              count: withheldObservations,
              breakdown: withheldObservationBands,
              atFloor:
                result.queryWatchlist.withheldByKind?.sample_floor_reached ?? 0,
              building:
                result.queryWatchlist.withheldByKind?.sample_building ?? 0,
            })}
          </p>
        ) : null}
      </section>

      {propertyChange !== null && propertyComparisons !== null ? (
        <section
          aria-labelledby="daily-briefing-site-trend"
          data-result-section="site-trend"
          data-site-trend
        >
          <h3
            id="daily-briefing-site-trend"
            className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
          >
            {t("siteTrend.title")}
          </h3>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("siteTrend.intro")}
          </p>
          <div className={`${CARD} mt-4`}>
            <p className={`${EYEBROW} text-brand-accent-text`}>
              {t("siteTrend.evidence")}
            </p>
            <h4 className="mt-2 text-[17px] font-semibold text-text-dark-primary">
              {t(
                `propertyChangeKinds.${propertyChange.kind}.title`,
              )}
            </h4>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [t("kpis.clicks"), propertyComparisons.clicks],
                [t("kpis.impressions"), propertyComparisons.impressions],
                [t("kpis.ctr"), propertyComparisons.ctr],
                [t("kpis.averagePosition"), propertyComparisons.position],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[9px] border border-brand-border-card bg-brand-panel px-3.5 py-3"
                >
                  <p className={EYEBROW}>{label}</p>
                  <p className="mt-2 font-mono text-[12px] text-text-dark-primary">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-4xl text-[12.5px] leading-[1.65] text-text-dark-secondary">
              {t(`propertyChangeKinds.${propertyChange.kind}.body`, {
                clicks: signedMetric(
                  locale,
                  propertyChange.clickChange,
                  t("kpis.unavailable"),
                  0,
                ),
                impressions: signedMetric(
                  locale,
                  propertyChange.impressionChange,
                  t("kpis.unavailable"),
                  0,
                ),
                position: signedMetric(
                  locale,
                  propertyChange.positionDelta,
                  t("kpis.unavailable"),
                ),
              })}
            </p>
            {propertyAction !== null ? (
              <a
                data-site-trend-action-link
                href="#daily-briefing-actions"
                className="mt-3 inline-flex text-[11.5px] leading-[1.6] font-semibold text-brand-accent-text underline decoration-brand-accent/35 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("siteTrend.actionListed")}
              </a>
            ) : propertyNoiseFloor !== null ? (
              <p
                data-site-trend-noise-floor
                className="mt-3 max-w-4xl text-[12px] leading-[1.6] text-text-dark-secondary"
              >
                {t("siteTrend.insideNoiseFloor", {
                  observed: Math.abs(propertyNoiseFloor.observedChange).toFixed(
                    0,
                  ),
                  minimum: propertyNoiseFloor.minimumForAction.toFixed(1),
                })}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="daily-briefing-actions"
        data-result-section="actions"
      >
        <h3
          id="daily-briefing-actions"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("actions.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("actions.intro")}
        </p>
        {queryActions.length === 0 &&
        pageActions.length === 0 &&
        propertyAction === null ? (
          <div data-action-empty className={`${CARD} mt-4`}>
            <p className="max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {shownProvisional.length === 0
                ? // A hidden provisional candidate may still carry a page, so
                  // this branch may not claim no handoff is justified. It
                  // reports the absence of a strict action and what the row
                  // budget left out.
                  withheldProvisional > 0
                  ? t("actions.emptyWithWithheldProvisional", {
                      count: withheldProvisional,
                    })
                  : t("actions.empty")
                : // A provisional row without page evidence offers no check
                  // link, so the sentence must not point at one.
                  t(
                    shownProvisional.some((move) => move.page !== null)
                      ? "actions.emptyWithProvisionalCheck"
                      : "actions.emptyWithProvisional",
                  )}
            </p>
          </div>
        ) : (
          <div data-actions-list className="mt-4 grid gap-3">
            {/* Grouped in the rendering, not only in the code. Resetting each
                group's numbers internally left one flat list on screen, where
                query action 3 still sat above page action 1 under a heading
                that claims a certainty order. */}
            {queryActions.length > 0 ? (
              <p data-action-group="query" className={EYEBROW}>
                {t("actions.groupQuery")}
              </p>
            ) : null}
            {queryActions.map(({ action, change }, index) => {
              const target = destination(action.destination);
              return (
                <article
                  key={`action:${index}:${action.kind}`}
                  data-action-row
                  data-action-rank={index + 1}
                  className={`${CARD} flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3.5">
                    <span
                      data-action-rank-badge
                      aria-label={t("actions.rank", { rank: index + 1 })}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-accent/30 bg-brand-accent-soft font-mono text-[11px] font-semibold text-brand-accent-text"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[16px] font-semibold text-text-dark-primary">
                        {t(`actionKinds.${action.kind}.title`)}
                      </h4>
                      <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                        {t(`actionKinds.${action.kind}.body`)}
                      </p>
                      <div
                        data-action-evidence
                        className="mt-3 border-l border-brand-border pl-3"
                      >
                        <p className={EYEBROW}>{t("actions.evidence")}</p>
                        <p className="mt-1.5 break-words text-[12.5px] font-medium text-text-dark-primary">
                          {change.query}
                        </p>
                        <p className="mt-1 break-all text-[11.5px] leading-[1.5] text-text-dark-secondary">
                          {change.page ?? t("review.pageUnavailable")}
                        </p>
                        <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-dark-secondary">
                          {metricsLine(t, locale, change.current)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Link
                    data-action-link
                    href={localePath(locale, target.path)}
                    onClick={(event) => handoff(event, action, index)}
                    className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-brand-accent/30 bg-brand-accent-soft px-3.5 py-2.5 text-[13px] font-semibold text-brand-accent-text transition-colors hover:border-brand-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent lg:w-auto lg:shrink-0 lg:self-center"
                  >
                    {t(target.labelKey)}
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                  </Link>
                </article>
              );
            })}
            {/* Numbered from one again, under its own heading. A single
                sequence running through query, page and property actions
                reads as one priority order over three different populations,
                and nothing measured says a query action outranks a page
                one. */}
            {pageActions.length > 0 ? (
              <p data-action-group="page" className={EYEBROW}>
                {t("actions.groupPage")}
              </p>
            ) : null}
            {pageActions.map(({ action, change }, index) => {
              const target = destination(action.destination);
              const rank = index + 1;
              return (
                <article
                  key={`page-action:${action.kind}:${action.page}`}
                  data-action-row
                  data-page-action
                  data-action-rank={rank}
                  className={`${CARD} flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3.5">
                    <span
                      data-action-rank-badge
                      aria-label={t("actions.rank", { rank })}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-accent/30 bg-brand-accent-soft font-mono text-[11px] font-semibold text-brand-accent-text"
                    >
                      {rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[16px] font-semibold text-text-dark-primary">
                        {t(`pageActionKinds.${action.kind}.title`)}
                      </h4>
                      <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                        {t(`pageActionKinds.${action.kind}.body`)}
                      </p>
                      <div
                        data-action-evidence
                        className="mt-3 border-l border-brand-border pl-3"
                      >
                        <p className={EYEBROW}>{t("actions.evidence")}</p>
                        <p className="mt-1.5 break-words text-[12.5px] font-medium text-text-dark-primary">
                          {t("review.pageScope")}
                        </p>
                        <p className="mt-1 break-all text-[11.5px] leading-[1.5] text-text-dark-secondary">
                          {change.page}
                        </p>
                        <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-dark-secondary">
                          {metricsLine(t, locale, {
                            query: "",
                            clicks: change.current.clicks,
                            impressions: change.current.impressions,
                            position: change.current.position,
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Link
                    data-action-link
                    href={localePath(locale, target.path)}
                    onClick={(event) => pageHandoff(event, action)}
                    className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-brand-accent/30 bg-brand-accent-soft px-3.5 py-2.5 text-[13px] font-semibold text-brand-accent-text transition-colors hover:border-brand-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent lg:w-auto lg:shrink-0 lg:self-center"
                  >
                    {t(target.labelKey)}
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                  </Link>
                </article>
              );
            })}
            {propertyAction !== null &&
            propertyComparisons !== null &&
            propertyTarget !== null ? (
              <p data-action-group="property" className={EYEBROW}>
                {t("actions.groupProperty")}
              </p>
            ) : null}
            {propertyAction !== null &&
            propertyComparisons !== null &&
            propertyTarget !== null ? (
              <article
                data-action-row
                data-property-action
                data-action-rank={1}
                className={`${CARD} flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <span
                    data-action-rank-badge
                    aria-label={t("actions.rank", {
                      rank: 1,
                    })}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-accent/30 bg-brand-accent-soft font-mono text-[11px] font-semibold text-brand-accent-text"
                  >
                    {1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[16px] font-semibold text-text-dark-primary">
                      {t(
                        `propertyActionKinds.${propertyAction.kind}.title`,
                      )}
                    </h4>
                    <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                      {t(
                        `propertyActionKinds.${propertyAction.kind}.body`,
                      )}
                    </p>
                    <div
                      data-action-evidence
                      className="mt-3 border-l border-brand-border pl-3"
                    >
                      <p className={EYEBROW}>{t("actions.propertyEvidence")}</p>
                      <p className="mt-1.5 break-all text-[12.5px] font-medium text-text-dark-primary">
                        {property}
                      </p>
                      <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-dark-secondary">
                        {t("actions.propertyWeekly", propertyComparisons)}
                      </p>
                    </div>
                  </div>
                </div>
                <Link
                  data-action-link
                  href={localePath(locale, propertyTarget.path)}
                  onClick={(event) => propertyHandoff(event, result.propertyTrend)}
                  className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-brand-accent/30 bg-brand-accent-soft px-3.5 py-2.5 text-[13px] font-semibold text-brand-accent-text transition-colors hover:border-brand-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent lg:w-auto lg:shrink-0 lg:self-center"
                >
                  {t(propertyTarget.labelKey)}
                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </article>
            ) : null}
          </div>
        )}
        {suggestedChecks.length > 0 || uncheckableShown ? (
          <div
            data-suggested-checks
            className="mt-6 border-t border-brand-border pt-5"
          >
            {/* The heading belongs to the checks. When every shown row failed
                to become one there is nothing to introduce, only a gap to
                explain, so the panel narrows to that sentence. */}
            {suggestedChecks.length > 0 ? (
              <>
                <h4 className="text-[15px] font-semibold text-text-dark-primary">
                  {t("checks.title")}
                </h4>
                <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {t("checks.intro")}
                </p>
              </>
            ) : null}
            <div className="mt-3 grid gap-3">
              {suggestedChecks.map((check) => {
                const target = destination(check.destination);
                return (
                  <article
                    key={`check:${check.query}:${check.page}`}
                    data-check-row
                    className={`${CARD} flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center`}
                  >
                    <div className="min-w-0 flex-1">
                      {/* Labelled as standing, not as evidence. The whole
                          point of a check is that it claims no change. */}
                      <p className={EYEBROW}>{t("checks.evidence")}</p>
                      <p className="mt-1.5 break-words text-[12.5px] font-medium text-text-dark-primary">
                        {check.query}
                      </p>
                      <p className="mt-1 break-all text-[11.5px] leading-[1.5] text-text-dark-secondary">
                        {check.page}
                      </p>
                      <p className="mt-1.5 text-[12px] leading-[1.6] text-text-dark-secondary">
                        {t(`review.observationBands.${check.band}.body`)}
                      </p>
                    </div>
                    <Link
                      data-check-link
                      href={localePath(locale, target.path)}
                      onClick={(event) => checkHandoff(event, check)}
                      className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-brand-border bg-brand-panel px-3.5 py-2.5 text-[13px] font-semibold text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent lg:w-auto lg:shrink-0 lg:self-center"
                    >
                      {t(target.labelKey)}
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                    </Link>
                  </article>
                );
              })}
            </div>
            {uncheckableShown ? (
              <p
                data-checks-not-checkable
                className="mt-3 max-w-3xl text-[11.5px] leading-[1.6] text-text-dark-secondary"
              >
                {t("checks.notCheckable", { count: notCheckable ?? 0 })}
              </p>
            ) : null}
          </div>
        ) : null}
        {handoffFailed ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[10px] border border-brand-warning/30 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("handoffError")}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="daily-briefing-manual"
        data-result-section="manual"
        className={CARD}
      >
        <h3
          id="daily-briefing-manual"
          className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("manual.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("manual.body")}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <ManualCheck
            title={t("manual.manualActions")}
            href="https://search.google.com/search-console/manual-actions"
            checked={manualChecked}
            onCheck={() => setManualChecked(true)}
          />
          <ManualCheck
            title={t("manual.securityIssues")}
            href="https://search.google.com/search-console/security-issues"
            checked={securityChecked}
            onCheck={() => setSecurityChecked(true)}
          />
        </div>
      </section>

      <section
        aria-labelledby="daily-briefing-evidence"
        data-result-section="evidence"
        className={CARD}
      >
        <details data-evidence-details>
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
            <h3
              id="daily-briefing-evidence"
              className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
            >
              {t("evidence.title")}
            </h3>
            <span
              data-evidence-fold-summary
              className="text-[12px] leading-[1.6] text-text-dark-secondary"
            >
              {foldSummary}
            </span>
          </summary>
        <p className="mt-3 max-w-4xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("evidence.thresholdSummary")}
        </p>
        <NoiseSummary
          funnel={result.signalFunnel}
          laneCapability={result.laneCapability}
        />
        <SignalPathEvidence
          funnel={result.signalFunnel}
          laneCapability={result.laneCapability}
          rowAccounting={result.rowAccounting}
          pageAccounting={result.pageAccounting}
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <EvidenceCard
            title={t("evidence.coverageTitle")}
            state={t(`evidenceStates.${currentCoverage.evidence}`)}
            body={
              currentCoverage.evidence === "observed" ||
              currentCoverage.evidence === "partial"
                ? t("evidence.coverageObserved", {
                    covered: currentCoverage.coveredQueries,
                    eligible: currentCoverage.eligibleQueries,
                    floor: percent(currentCoverage.minimumQueryPageCoverage),
                  })
                : t("evidence.coverageUnavailable")
            }
          />
          <EvidenceCard
            title={t("evidence.anonymizationTitle")}
            state={t(`evidenceStates.${currentAnonymization.evidence}`)}
            body={
              (currentAnonymization.evidence === "observed" ||
                currentAnonymization.evidence === "partial") &&
              currentAnonymization.missingImpressionShare !== null &&
              currentAnonymization.missingClickShare !== null
                ? t("evidence.anonymizationObserved", {
                    impressions: percent(
                      currentAnonymization.missingImpressionShare,
                    ),
                    clicks: percent(currentAnonymization.missingClickShare),
                  })
                : t("evidence.anonymizationUnavailable")
            }
          />
        </div>
        </details>
      </section>

      <section
        aria-labelledby="daily-briefing-limits"
        data-result-section="limitations"
      >
        <h3
          id="daily-briefing-limits"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("limitations.title")}
        </h3>
        {result.limitations.length === 0 ? (
          <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
            {t("limitations.empty")}
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 text-[13px] leading-[1.6] text-text-dark-secondary">
            {result.limitations.map((code) => (
              <li
                key={code}
                className="flex gap-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-warning"
                />
                {t(`limitationCodes.${code}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="daily-briefing-method"
        data-result-section="methodology"
        className={CARD}
      >
        <h3
          id="daily-briefing-method"
          className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("methodology.title")}
        </h3>
        <ul className="mt-4 grid gap-3 text-[12.5px] leading-[1.65] text-text-dark-secondary md:grid-cols-2">
          {[
            t("methodology.time"),
            t("methodology.position"),
            t("methodology.anonymization"),
            t("methodology.noPersistence"),
          ].map((item) => (
            <li key={item} className="border-l border-brand-border pl-3">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FactCard({
  icon,
  label,
  value,
  detail,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <article className={CARD}>
      <div className="flex items-center gap-2 text-brand-accent">
        {icon}
        <p className={EYEBROW}>{label}</p>
      </div>
      <p className="mt-3 text-[14px] leading-[1.45] font-semibold text-text-dark-primary">
        {value}
      </p>
      {detail ? (
        <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {detail}
        </p>
      ) : null}
    </article>
  );
}

function KpiCard({
  metric,
  label,
  locale,
  day,
  weekly,
  dailyAvailable,
}: {
  readonly metric: MetricKey;
  readonly label: string;
  readonly locale: string;
  readonly day: DailyBriefingKpiComparison;
  readonly weekly: DailyBriefingKpiComparison;
  readonly dailyAvailable: boolean;
}) {
  const t = useTranslations("tools.dailyBriefing");
  const dayValue = dailyAvailable ? metricValue(locale, day, metric) : null;
  const dayDelta = dailyAvailable ? metricDelta(locale, day, metric) : null;
  const weekValue = metricValue(locale, weekly, metric);
  const weekDelta = metricDelta(locale, weekly, metric);

  return (
    <article data-kpi={metric} className={`${CARD} min-w-0`}>
      <p className={EYEBROW}>{label}</p>
      <div className="mt-4 space-y-4">
        {dailyAvailable ? (
          <MetricPeriod
            period="day"
            label={t("kpis.latestDay")}
            value={dayValue ?? t("kpis.unavailable")}
            delta={dayDelta}
          />
        ) : null}
        <MetricPeriod
          period="week"
          label={t("kpis.currentSevenDays")}
          value={weekValue ?? t("kpis.unavailable")}
          delta={weekDelta}
        />
      </div>
    </article>
  );
}

function MetricPeriod({
  period,
  label,
  value,
  delta,
}: {
  readonly period: "day" | "week";
  readonly label: string;
  readonly value: string;
  readonly delta: string | null;
}) {
  const t = useTranslations("tools.dailyBriefing");
  return (
    <div data-kpi-period={period}>
      <p className="text-[11.5px] text-text-dark-secondary">{label}</p>
      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
        <p className="truncate text-[22px] leading-none font-semibold tracking-[-0.03em] text-text-dark-primary">
          {value}
        </p>
        <p className="shrink-0 font-mono text-[10px] text-text-dark-secondary">
          {t("kpis.change", {
            delta: delta ?? t("kpis.unavailable"),
          })}
        </p>
      </div>
    </div>
  );
}

function EvidenceCard({
  title,
  state,
  body,
}: {
  readonly title: string;
  readonly state: string;
  readonly body: string;
}) {
  return (
    <article className="rounded-[10px] border border-brand-border-card bg-brand-panel px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-text-dark-primary">
          {title}
        </h4>
        <span className="font-mono text-[9.5px] tracking-[0.06em] text-brand-accent-text uppercase">
          {state}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
        {body}
      </p>
    </article>
  );
}

function ManualCheck({
  title,
  href,
  checked,
  onCheck,
}: {
  readonly title: string;
  readonly href: string;
  readonly checked: boolean;
  readonly onCheck: () => void;
}) {
  const t = useTranslations("tools.dailyBriefing");
  return (
    <article className="rounded-[10px] border border-brand-border-card bg-brand-panel p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h4 className="text-[14px] font-semibold text-text-dark-primary">
          {title}
        </h4>
        <a
          data-manual-link
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-brand-accent-text underline underline-offset-2"
        >
          {t("manual.open")}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      <p className="mt-3 text-[12.5px] text-text-dark-secondary">
        {checked ? t("manual.checked") : t("manual.unconfirmed")}
      </p>
      {!checked ? (
        <button
          type="button"
          onClick={onCheck}
          className="mt-3 min-h-9 text-left text-[12px] font-medium text-text-dark-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("manual.markChecked")}
        </button>
      ) : null}
    </article>
  );
}
