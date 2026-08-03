import { createPublicToolResult } from "../contract.ts";
import { buildTrafficActions } from "./actions.ts";
import { describeBrandSplit, type QueryWindowEvidence } from "./brand-split.ts";
import { buildTrafficChecks, type TrafficCheckInputs } from "./checks.ts";
import { detectTrafficChangePoint } from "./changepoint.ts";
import {
  compareToRankingUpdates,
  RANKING_UPDATE_TABLE,
  type RankingUpdateTable,
} from "./core-updates.ts";
import { buildTrafficFindings } from "./findings.ts";
import {
  DEFAULT_MANUAL_ACTION_STATUS,
  observeManualAction,
  type ManualActionStatus,
} from "./manual-action.ts";
import { describeQueryCohort } from "./query-cohort.ts";
import { firstVisibleDate, historySpanDays, sortByDate } from "./series.ts";
import type {
  TrafficDailyPoint,
  TrafficDropEnvelope,
  TrafficSiteSignals,
} from "./types.ts";

/**
 * Bumped from v1: the result gained `siteSignals`, and `actions` gained
 * `signalBasis`. A stored v1 payload does not have either.
 */
export const TRAFFIC_DROP_SCHEMA_VERSION = "traffic_drop.daily.v2";

/**
 * The two comparison windows the query-dimension reads covered.
 *
 * Supplied by the caller because the reads happen at the transport boundary,
 * and null when they did not happen at all — the normal case for a run that
 * could not spend the extra Search Console budget. Null must never be confused
 * with "we looked and found nothing"; every consumer of it reports
 * `query_read_not_performed`.
 */
export interface TrafficQueryEvidence {
  readonly before: QueryWindowEvidence;
  readonly after: QueryWindowEvidence;
}

export interface TrafficDropInput {
  /** Daily property totals. Order does not matter; gaps are left as gaps. */
  readonly daily: readonly TrafficDailyPoint[];
  /** ISO timestamp the run completed. Supplied by the caller, never generated here. */
  readonly completedAt: string;
  readonly checkInputs?: TrafficCheckInputs;
  /**
   * What the visitor reported about their Manual Actions page.
   *
   * Defaults to `not_checked`, which is the honest default: a run that was
   * never asked has not been told.
   */
  readonly manualAction?: ManualActionStatus;
  readonly queryEvidence?: TrafficQueryEvidence | null;
  /** Brand terms as confirmed by the visitor. A domain guess is not one. */
  readonly brandTerms?: readonly string[];
  readonly brandTermsConfirmed?: boolean;
  /** Injected so a test can pin the timeline without editing the shipped table. */
  readonly rankingUpdateTable?: RankingUpdateTable;
}

/**
 * Run the whole diagnosis over one daily series.
 *
 * Windows, findings, actions, checks and the site-signal group are all derived
 * here in one pass: the caller supplies data and gets a report, and cannot
 * supply a comparison window (Owner 2026-07-31 — a window you choose is a
 * conclusion you choose).
 *
 * Nothing in the output answers "was this site demoted". That is not an
 * oversight and not a scoping compromise:
 *
 * - Google publishes no signal for it, so there is no ground truth against
 *   which any threshold could be calibrated or any claim falsified.
 * - The observations below are drawn from one dataset over one window chosen
 *   by one detector. They are not independent of each other, so counting how
 *   many of them fired would manufacture the appearance of corroboration.
 * - Every shape they can produce has several ordinary explanations, and at
 *   least one of those is usually cheaper to check and cheaper to fix.
 *
 * What the report gives instead: the one status that IS knowable (from the
 * visitor, in ten seconds), the observations with their coverage attached, and
 * the reasons each of them might be wrong.
 */
export function buildTrafficDropReport(
  input: TrafficDropInput,
): TrafficDropEnvelope {
  const series = sortByDate(input.daily);
  const changePoint = detectTrafficChangePoint(series);
  const findings = buildTrafficFindings(series, changePoint);
  const last = series[series.length - 1];

  const queryEvidence = input.queryEvidence ?? null;
  const siteSignals: TrafficSiteSignals = {
    manualAction: observeManualAction(
      input.manualAction ?? DEFAULT_MANUAL_ACTION_STATUS,
    ),
    coreUpdateTimeline: compareToRankingUpdates(
      changePoint.windows,
      input.rankingUpdateTable ?? RANKING_UPDATE_TABLE,
    ),
    brandSplit: describeBrandSplit(
      queryEvidence === null
        ? null
        : {
            before: queryEvidence.before,
            after: queryEvidence.after,
            brandTerms: input.brandTerms ?? [],
            brandTermsConfirmed: input.brandTermsConfirmed ?? false,
          },
    ),
    queryCohort: describeQueryCohort(queryEvidence),
  };

  return createPublicToolResult(
    {
      tool: "traffic_drop_diagnosis",
      schemaVersion: TRAFFIC_DROP_SCHEMA_VERSION,
      scope: "property",
      completedAt: input.completedAt,
    },
    {
      // Bounds come from the data or are null. A property with no rows has no
      // date range, and stamping today's date on it would fabricate one.
      //
      // The start date and the day count are the same measurement read two
      // ways, so they are derived from the same place and go null together.
      // Falling back to the first ROW when nothing was ever visible used to
      // print "0 days of history · starting 2025-04-01" — a span and a date
      // that contradict each other on one line.
      dataStartDate: firstVisibleDate(series),
      dataEndDate: last?.date ?? null,
      dayCount: historySpanDays(series),
      changePoint,
      findings,
      actions: buildTrafficActions(findings, siteSignals),
      checks: buildTrafficChecks({
        changePoint,
        findings,
        series,
        siteSignals,
        // The run date, so "is this property still visible" is asked about
        // now rather than about whenever the last row happens to be.
        runDate: input.completedAt.slice(0, 10),
        ...(input.checkInputs ? { inputs: input.checkInputs } : {}),
      }),
      siteSignals,
    },
  );
}
