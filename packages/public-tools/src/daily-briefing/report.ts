// @input  -- final Search Console day rows and optional query evidence for two weeks
// @output -- one deterministic, evidence-bounded daily search briefing envelope
// @pos    -- pure core; network, auth, quota and persistence stay outside this module

import { createPublicToolResult } from "../contract.ts";
import {
  MIN_DIMENSION_COVERAGE,
  queryPageCoverage,
  type GscPageRow,
  type GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import {
  latestFinalWindow,
  pacificDate,
  shiftDate,
} from "../gsc-analytics/window.ts";
import { buildEvidenceTable } from "../quick-wins/evidence.ts";
import { aggregationBasesAgree } from "../quick-wins/report.ts";
import { buildSiteCtrCurve } from "../site-baseline/ctr-curve.ts";
import { splitBrandQueries } from "../site-baseline/normalize.ts";
import type {
  GscQueryRow,
  SiteCtrCurve,
} from "../site-baseline/types.ts";
import type {
  BuildDailyBriefingInput,
  DailyBriefingAction,
  DailyBriefingAnonymization,
  DailyBriefingChange,
  DailyBriefingChangeKind,
  DailyBriefingCoverage,
  DailyBriefingEnvelope,
  DailyBriefingEvidenceState,
  DailyBriefingKpiComparison,
  DailyBriefingKpiDelta,
  DailyBriefingKpis,
  DailyBriefingCtrLane,
  DailyBriefingCtrLaneBlocker,
  DailyBriefingLaneCapability,
  DailyBriefingLaneState,
  DailyBriefingLaneRowCounts,
  DailyBriefingLimitationCode,
  DailyBriefingMode,
  DailyBriefingNoiseFloor,
  DailyBriefingObservationBand,
  DailyBriefingPageChecks,
  DailyBriefingPageCheck,
  DailyBriefingPageCheckBaseline,
  DailyBriefingPageCheckBlocker,
  DailyBriefingPageAccounting,
  DailyBriefingPageAction,
  DailyBriefingPageChange,
  DailyBriefingPageChangeKind,
  DailyBriefingPageLaneState,
  DailyBriefingPropertyActionKind,
  DailyBriefingPropertyChangeKind,
  DailyBriefingPropertyTrend,
  DailyBriefingQueryEvidence,
  DailyBriefingProvisionalMove,
  DailyBriefingProvisionalMoves,
  DailyBriefingQueryObservation,
  DailyBriefingQueryObservationKind,
  DailyBriefingQueryWatchlist,
  DailyBriefingRowAccounting,
  DailyBriefingSignalFunnel,
  DailyBriefingSuggestedCheck,
  DailyBriefingSuggestedChecks,
  DailyBriefingWindowCoverage,
  DailyBriefingWindows,
} from "./types.ts";

export const DAILY_BRIEFING_SCHEMA_VERSION = "daily_search_briefing.v8";
export const BRIEFING_WINDOW_DAYS = 7;
/** Daily points held once so the UI can switch 7/28/90-day views locally. */
export const DAILY_BRIEFING_TREND_DAYS = 90;
export const DAILY_CADENCE_MIN_IMPRESSIONS = 1_000;
export const BRIEFING_MIN_ROW_IMPRESSIONS = 100;
export const BRIEFING_MATERIAL_CHANGE_RATIO = 0.15;
export const BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE = 3;
export const BRIEFING_STABLE_POSITION_DELTA = 0.5;
export const DAILY_BRIEFING_ACTION_LIMIT = 3;
/**
 * Page rows a briefing will carry, counted apart from the query ones.
 *
 * Page and query rows are different populations. Taking page rows out of what
 * the query rows left over let the number of query candidates decide whether a
 * page measurement was visible, which is one population ranked by the size of
 * the other.
 */
export const DAILY_BRIEFING_PAGE_LIMIT = 2;

/**
 * Prior-window impressions a page needs before its collapse is worth naming.
 *
 * The handed-down spec expresses this floor as a hundred monthly impressions.
 * This tool compares two seven-day windows and has no monthly read, and
 * restating a monthly figure as `weekly x 30/7` would publish an extrapolation
 * as an observation. Thirty is that floor carried into the window actually
 * measured, rounded up rather than down: at thirty the collapse threshold
 * below removes twenty-four impressions, comfortably past the counting floor
 * of `2*sqrt(30) = 10.95` that this lane must also clear.
 */
export const BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS = 30;

/**
 * Share of a page's impressions that must disappear before it is a collapse.
 *
 * A ratio, in a spec whose general rules ask for absolute judgements. The
 * absolute half of the test is the floor above and the counting floor this
 * lane also applies; the ratio is what separates "this page stopped being
 * shown" from "this page was shown less", which is the distinction that makes
 * the action worth doing at all.
 */
export const BRIEFING_PAGE_COLLAPSE_RATIO = 0.8;

/**
 * Clicks a page must have been expected before drawing none of them is a fact.
 *
 * Three, because a count whose mean is three comes back empty about five
 * per cent of the time: `e^-3 = 0.0498`. Below it "no clicks" is the ordinary
 * outcome and naming it would send the reader to look at pages that are
 * behaving exactly as their volume predicts. The spec this implements asks for
 * a fixed two hundred monthly impressions instead, which on a property
 * converting at the measured 0.87% expects 1.7 clicks — a level where seeing
 * none happens two runs in three.
 */
export const BRIEFING_ZERO_CLICK_MIN_EXPECTED_CLICKS = 3;

/**
 * Impressions a query needs this window before its rate is called anomalous.
 *
 * Three hundred, above the hundred the shared evidence table already applies.
 * That floor is shared with the quick-wins tool and is not this briefing's to
 * move; this one sits on top of it and applies here only.
 */
export const BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS = 300;

/**
 * Impressions the query's own position band must hold, with the query removed.
 *
 * Two thousand, well above the five hundred the shared curve treats as a
 * usable band. The baseline is a leave-one-out rate, so the sample that
 * matters is the band's impressions minus the row being measured — the number
 * the comparison actually rests on rather than the number it sits beside.
 *
 * The window is this briefing's seven days. The spec calls this "historical",
 * but no read in this tool covers more than the current window, and restating
 * a seven-day count as a historical one would describe a measurement nobody
 * took.
 */
export const BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS = 2_000;

/** Clicks the site's own curve must predict before a shortfall is material. */
export const BRIEFING_CTR_ANOMALY_MIN_EXPECTED_CLICKS = 5;

/** Share of the predicted clicks that must be missing. */
export const BRIEFING_CTR_ANOMALY_MAX_OBSERVED_SHARE = 0.5;

export const BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE = 100;
export const BRIEFING_PROPERTY_POSITION_DELTA = 1;

/**
 * Upper edge of the average-position band a visitor can act on today.
 *
 * Beyond it a position move is real but not yet a task: nothing done to the
 * page this week changes whether a query sitting near ninety earns a click.
 */
export const BRIEFING_ACTIONABLE_POSITION_MAX = 30;
/** Average position at or under which a query occupies the top result band. */
export const BRIEFING_TOP_BAND_MAX_POSITION = 10;
/** Improvement a crossing must carry before it outruns week-to-week drift. */
export const BRIEFING_TOP_BAND_MIN_IMPROVEMENT = 1.5;
/** Worsening a position decline must carry inside the actionable band. */
export const BRIEFING_POSITION_DECLINE_MIN_DELTA = 3;
/** Prior-window clicks a query needs before a click decline could be seen. */
export const BRIEFING_CLICK_DECLINE_MIN_PREVIOUS_CLICKS =
  BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE;
/**
 * Standard deviations of counting noise a property change must clear.
 *
 * Weekly clicks are counts, so their spread scales with the square root of the
 * base. Two sigma keeps a fifteen percent move on a small base from being
 * announced as a material decline.
 */
export const BRIEFING_PROPERTY_NOISE_SIGMA = 2;
/** Upper edge of the band an observation is still worth checking this week. */
export const BRIEFING_OBSERVATION_NEAR_BAND_MAX = 20;
/** Upper edge of the band an observation is worth revisiting later. */
export const BRIEFING_OBSERVATION_MID_BAND_MAX = 40;

/**
 * Impressions a current row needs before it is worth naming at all.
 *
 * Also the prior-window floor for a provisional position move: enough of a
 * sample to see that the average position moved, never enough to call the
 * move a change.
 */
export const BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS = 50;
const FIRST_OBSERVED_MIN_POSITION = 8;
const FIRST_OBSERVED_MAX_POSITION = 21;

const EMPTY_DELTA: DailyBriefingKpiDelta = {
  clicks: null,
  clicksRatio: null,
  impressions: null,
  impressionsRatio: null,
  ctr: null,
  position: null,
};

export function dailyBriefingWindowsFor(now: Date): DailyBriefingWindows {
  const current7Days = latestFinalWindow(now, {
    lengthDays: BRIEFING_WINDOW_DAYS,
  });
  const previous7End = shiftDate(current7Days.startDate, -1);
  const previous7Days = {
    startDate: shiftDate(previous7End, -(BRIEFING_WINDOW_DAYS - 1)),
    endDate: previous7End,
  };
  const latestDay = {
    startDate: current7Days.endDate,
    endDate: current7Days.endDate,
  };
  const previousDate = shiftDate(current7Days.endDate, -1);

  return {
    latestDay,
    previousDay: { startDate: previousDate, endDate: previousDate },
    current7Days,
    previous7Days,
    readRange: {
      startDate: previous7Days.startDate,
      endDate: current7Days.endDate,
    },
  };
}

/**
 * Fresh visualisation windows. These never replace `dailyBriefingWindowsFor`:
 * action evidence remains the finalised 14-day comparison above.
 */
export function dailyBriefingTrendWindowsFor(now: Date): {
  readonly daily: { readonly startDate: string; readonly endDate: string };
  readonly hourly: { readonly startDate: string; readonly endDate: string };
} {
  const endDate = pacificDate(now);
  return {
    daily: {
      startDate: shiftDate(endDate, -(DAILY_BRIEFING_TREND_DAYS - 1)),
      endDate,
    },
    // Two PT calendar dates cover the last 24 hourly buckets across midnight.
    hourly: { startDate: shiftDate(endDate, -1), endDate },
  };
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function isMetricRowValid(row: {
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}): boolean {
  return (
    Number.isFinite(row.clicks) &&
    row.clicks >= 0 &&
    Number.isFinite(row.impressions) &&
    row.impressions >= 0 &&
    row.clicks <= row.impressions &&
    Number.isFinite(row.position) &&
    row.position >= 0
  );
}

function emptyTrendSeries(): import("./types.ts").DailyBriefingTrendSeries {
  return {
    evidence: "unavailable",
    points: [],
    firstIncompleteDate: null,
    firstIncompleteHour: null,
  };
}

function trendSeriesFor(
  read: import("./types.ts").DailyBriefingTrendRead | null | undefined,
  kind: "daily" | "hourly",
): import("./types.ts").DailyBriefingTrendSeries {
  if (read === null || read === undefined) return emptyTrendSeries();

  const points: import("./types.ts").DailyBriefingTrendPoint[] = [];
  // `hourly_all` explicitly asks Search Console for its freshest hourly
  // processing state, not for a finalised fact. The metadata narrows where
  // the incomplete tail begins when Google can report it; its absence must
  // not upgrade an hourly point to final evidence.
  let partial =
    kind === "hourly" ||
    read.firstIncompleteDate !== null ||
    read.firstIncompleteHour !== null;
  const seen = new Set<string>();

  for (const row of read.rows) {
    const keyIsValid = kind === "daily" ? isDateKey(row.key) : row.key !== "";
    if (!keyIsValid || seen.has(row.key) || !isMetricRowValid(row)) {
      partial = true;
      continue;
    }
    seen.add(row.key);
    points.push({
      key: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
      position: row.impressions > 0 ? row.position : null,
    });
  }
  points.sort((left, right) => left.key.localeCompare(right.key));

  return {
    evidence:
      points.length === 0 ? "not_observed" : partial ? "partial" : "observed",
    points,
    firstIncompleteDate: read.firstIncompleteDate,
    firstIncompleteHour: read.firstIncompleteHour,
  };
}

function normalizedDateRows(
  input: BuildDailyBriefingInput,
  windows: DailyBriefingWindows,
): {
  readonly rows: ReadonlyMap<
    string,
    BuildDailyBriefingInput["dateRows"][number]
  >;
  readonly omitted: boolean;
} {
  const rows = new Map<string, BuildDailyBriefingInput["dateRows"][number]>();
  const conflicts = new Set<string>();
  let omitted = false;

  for (const row of input.dateRows) {
    if (
      !isDateKey(row.date) ||
      row.date < windows.readRange.startDate ||
      row.date > windows.readRange.endDate ||
      !isMetricRowValid(row)
    ) {
      omitted = true;
      continue;
    }
    if (rows.has(row.date)) {
      rows.delete(row.date);
      conflicts.add(row.date);
      omitted = true;
      continue;
    }
    if (!conflicts.has(row.date)) rows.set(row.date, row);
  }

  return { rows, omitted };
}

function kpisForDates(
  rows: ReadonlyMap<string, BuildDailyBriefingInput["dateRows"][number]>,
  dates: readonly string[],
): DailyBriefingKpis | null {
  const selected = dates.map((date) => rows.get(date));
  if (selected.some((row) => row === undefined)) return null;

  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const row of selected) {
    if (row === undefined) return null;
    clicks += row.clicks;
    impressions += row.impressions;
    weightedPosition += row.position * row.impressions;
  }

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? weightedPosition / impressions : null,
  };
}

function datesIn(window: {
  readonly startDate: string;
  readonly endDate: string;
}): string[] {
  const dates: string[] = [];
  for (
    let date = window.startDate;
    date <= window.endDate;
    date = shiftDate(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
}

function ratio(before: number, after: number): number | null {
  if (!(Number.isFinite(before) && before > 0 && Number.isFinite(after)))
    return null;
  return (after - before) / before;
}

function compareKpis(
  current: DailyBriefingKpis | null,
  previous: DailyBriefingKpis | null,
): DailyBriefingKpiComparison {
  if (current === null || previous === null) {
    return { evidence: "unavailable", current, previous, delta: EMPTY_DELTA };
  }

  return {
    evidence: "observed",
    current,
    previous,
    delta: {
      clicks: current.clicks - previous.clicks,
      clicksRatio: ratio(previous.clicks, current.clicks),
      impressions: current.impressions - previous.impressions,
      impressionsRatio: ratio(previous.impressions, current.impressions),
      ctr:
        current.ctr === null || previous.ctr === null
          ? null
          : current.ctr - previous.ctr,
      position:
        current.position === null || previous.position === null
          ? null
          : current.position - previous.position,
    },
  };
}

/**
 * The state of the query rows alone.
 *
 * Query-level lanes are statements about a query, so they must not go dark
 * because the query/page attachment failed. Coupling them cost the briefing
 * every position signal whenever one of six soft-failing reads came back
 * empty, which is the same "no usable information" failure one layer down.
 */
function queryRowsState(
  evidence: DailyBriefingQueryEvidence | null,
): Exclude<DailyBriefingEvidenceState, "not_observed"> {
  if (evidence === null || evidence.queryRead === null) return "unavailable";
  if (evidence.queryRead.paging.truncated) return "partial";
  if (evidence.queryRead.responseAggregationType === null) return "unavailable";
  return "observed";
}

/** The state of the query rows and their page attachment together. */
function queryEvidenceState(
  evidence: DailyBriefingQueryEvidence | null,
): Exclude<DailyBriefingEvidenceState, "not_observed"> {
  if (
    evidence === null ||
    evidence.queryRead === null ||
    evidence.queryPageRead === null
  ) {
    return "unavailable";
  }
  if (
    evidence.queryRead.paging.truncated ||
    evidence.queryPageRead.paging.truncated
  ) {
    return "partial";
  }
  if (
    evidence.queryRead.responseAggregationType === null ||
    evidence.queryPageRead.responseAggregationType === null ||
    evidence.queryRead.responseAggregationType !==
      evidence.queryPageRead.responseAggregationType
  ) {
    return "unavailable";
  }
  return "observed";
}

function queryWindowsComparable(
  current: DailyBriefingQueryEvidence | null,
  previous: DailyBriefingQueryEvidence | null,
): boolean {
  const currentBasis = current?.queryRead?.responseAggregationType;
  const previousBasis = previous?.queryRead?.responseAggregationType;
  return (
    currentBasis !== null &&
    currentBasis !== undefined &&
    previousBasis !== null &&
    previousBasis !== undefined &&
    currentBasis === previousBasis
  );
}

/**
 * Whether this window's page attachment can attribute a query to a page.
 *
 * A truncated page read is a prefix of the pages a query has, so the page it
 * names as dominant may simply be the first one returned. Coverage already
 * reports that as partial; the attribution built on it must not read as
 * observed, and must not become a handoff.
 */
function pageAttributionUsable(
  evidence: DailyBriefingQueryEvidence | null,
): boolean {
  return (
    evidence?.queryPageRead != null &&
    !evidence.queryPageRead.paging.truncated &&
    !evidence.queryRead?.paging.truncated &&
    queryEvidenceBasisComparable(evidence)
  );
}

function queryEvidenceBasisComparable(
  evidence: DailyBriefingQueryEvidence | null,
): boolean {
  const queryBasis = evidence?.queryRead?.responseAggregationType;
  const queryPageBasis = evidence?.queryPageRead?.responseAggregationType;
  return (
    queryBasis !== null &&
    queryBasis !== undefined &&
    queryPageBasis !== null &&
    queryPageBasis !== undefined &&
    queryBasis === queryPageBasis
  );
}

function signalFunnelEvidence(
  current: DailyBriefingQueryEvidence | null,
  previous: DailyBriefingQueryEvidence | null,
): DailyBriefingSignalFunnel["evidence"] {
  // Page attachment problems are reported through page attribution and
  // coverage, not by blanking the query-level funnel.
  if (
    queryRowsState(current) === "unavailable" ||
    queryRowsState(previous) === "unavailable" ||
    !queryWindowsComparable(current, previous)
  ) {
    return "unavailable";
  }
  if (
    queryRowsState(current) === "partial" ||
    queryRowsState(previous) === "partial"
  ) {
    return "partial";
  }
  return "observed";
}

function validQueryRows(rows: readonly GscQueryRow[]): readonly GscQueryRow[] {
  const unique = new Map<string, GscQueryRow>();
  const conflicts = new Set<string>();
  for (const row of rows) {
    if (row.query.trim() === "" || !isMetricRowValid(row)) continue;
    if (unique.has(row.query)) {
      unique.delete(row.query);
      conflicts.add(row.query);
      continue;
    }
    if (!conflicts.has(row.query)) unique.set(row.query, row);
  }
  return [...unique.values()];
}

function validQueryPageRows(
  rows: readonly GscQueryPageRow[],
): readonly GscQueryPageRow[] {
  // Normalized the same way `validPageRows` normalizes the page dimension.
  // Trimming one side only gave the same URL two identities, so a page under
  // an action could still be offered as a page with no known change.
  return rows.flatMap((row) => {
    const page = row.page.trim();
    if (row.query.trim() === "" || page === "" || !isMetricRowValid(row)) {
      return [];
    }
    return [{ ...row, page }];
  });
}

function coverageOf(
  evidence: DailyBriefingQueryEvidence | null,
): DailyBriefingWindowCoverage {
  const state = queryEvidenceState(evidence);
  if (evidence?.queryRead === null || evidence?.queryRead === undefined) {
    return {
      evidence: state,
      queryRows: 0,
      queryPageRows: evidence?.queryPageRead?.rows.length ?? 0,
      eligibleQueries: 0,
      coveredQueries: 0,
      minimumQueryPageCoverage: MIN_DIMENSION_COVERAGE,
    };
  }

  const rows = validQueryRows(evidence.queryRead.rows);
  const queryPages = validQueryPageRows(evidence.queryPageRead?.rows ?? []);
  const byQuery = queryPageCoverage(rows, queryPages);
  const eligible = rows.filter(
    (row) => row.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS,
  );

  return {
    evidence: state,
    queryRows: rows.length,
    queryPageRows: queryPages.length,
    eligibleQueries: eligible.length,
    coveredQueries: eligible.filter((row) => {
      const value = byQuery.get(row.query);
      return (
        value !== null && value !== undefined && value >= MIN_DIMENSION_COVERAGE
      );
    }).length,
    minimumQueryPageCoverage: MIN_DIMENSION_COVERAGE,
  };
}

interface AnonymizationResult {
  readonly value: DailyBriefingAnonymization;
  readonly limitation:
    | "aggregation_basis_mismatch"
    | "anonymization_gap_uncomputable"
    | null;
}

function missingShare(total: number, observed: number): number | null {
  if (!(Number.isFinite(total) && total > 0 && Number.isFinite(observed)))
    return null;
  if (observed > total) return null;
  return (total - observed) / total;
}

function anonymizationOf(
  evidence: DailyBriefingQueryEvidence | null,
): AnonymizationResult {
  const unavailable = (): AnonymizationResult => ({
    value: {
      evidence: "unavailable",
      queryImpressions: null,
      propertyImpressions: null,
      missingImpressionShare: null,
      queryClicks: null,
      propertyClicks: null,
      missingClickShare: null,
    },
    limitation: null,
  });
  if (evidence?.queryRead === null || evidence?.queryRead === undefined) {
    return unavailable();
  }

  const rows = validQueryRows(evidence.queryRead.rows);
  const queryImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const queryClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totals = evidence.propertyTotals;
  if (totals === null) return unavailable();

  const base = {
    queryImpressions,
    propertyImpressions: totals.impressions,
    queryClicks,
    propertyClicks: totals.clicks,
  };
  if (evidence.queryRead.paging.truncated) {
    return {
      value: {
        evidence: "partial",
        ...base,
        missingImpressionShare: null,
        missingClickShare: null,
      },
      limitation: null,
    };
  }
  if (
    !aggregationBasesAgree(totals, evidence.queryRead.responseAggregationType)
  ) {
    return {
      value: {
        evidence: "unavailable",
        ...base,
        missingImpressionShare: null,
        missingClickShare: null,
      },
      limitation: "aggregation_basis_mismatch",
    };
  }

  const missingImpressionShare = missingShare(
    totals.impressions,
    queryImpressions,
  );
  const missingClickShare = missingShare(totals.clicks, queryClicks);
  if (missingImpressionShare === null || missingClickShare === null) {
    return {
      value: {
        evidence: "unavailable",
        ...base,
        missingImpressionShare: null,
        missingClickShare: null,
      },
      limitation: "anonymization_gap_uncomputable",
    };
  }

  return {
    value: {
      evidence: "observed",
      ...base,
      missingImpressionShare,
      missingClickShare,
    },
    limitation: null,
  };
}

function mapByQuery(
  rows: readonly GscQueryRow[],
): ReadonlyMap<string, GscQueryRow> {
  return new Map(rows.map((row) => [row.query, row]));
}

function pageForQuery(
  query: string,
  evidence: DailyBriefingQueryEvidence,
): string | null {
  if (evidence.queryRead === null || evidence.queryPageRead === null)
    return null;
  if (!pageAttributionUsable(evidence)) return null;
  const queryPages = validQueryPageRows(evidence.queryPageRead.rows);
  const coverage = queryPageCoverage(
    validQueryRows(evidence.queryRead.rows),
    queryPages,
  ).get(query);
  if (
    coverage === null ||
    coverage === undefined ||
    coverage < MIN_DIMENSION_COVERAGE
  ) {
    return null;
  }
  const rows = queryPages
    .filter(
      (row) =>
        row.query === query && row.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS,
    )
    .sort(
      (a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page),
    );
  return rows[0]?.page ?? null;
}

function pageForObservation(
  query: string,
  evidence: DailyBriefingQueryEvidence,
  minimumImpressions: number,
): string | null {
  if (evidence.queryRead === null || evidence.queryPageRead === null)
    return null;
  if (!pageAttributionUsable(evidence)) return null;
  const queryPages = validQueryPageRows(evidence.queryPageRead.rows);
  const coverage = queryPageCoverage(
    validQueryRows(evidence.queryRead.rows),
    queryPages,
  ).get(query);
  if (
    coverage === null ||
    coverage === undefined ||
    coverage < MIN_DIMENSION_COVERAGE
  ) {
    return null;
  }
  const rows = queryPages
    .filter(
      (row) => row.query === query && row.impressions >= minimumImpressions,
    )
    .sort(
      (a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page),
    );
  return rows[0]?.page ?? null;
}

/** Everything the lane capability and the mode are derived from. */
interface CapabilityCounts {
  readonly clickDeclineCapableQueries: number;
  readonly ctrOpportunityCapableQueries: number;
  readonly strictPairedPositionQueries: number;
  readonly provisionalPairedPositionQueries: number;
  readonly currentFloorOnlyQueries: number;
  readonly ctrLane: DailyBriefingCtrLane;
  readonly lanes: Readonly<
    Record<DailyBriefingChangeKind, DailyBriefingLaneState>
  >;
}

interface ChangeCandidate {
  readonly kind: DailyBriefingChangeKind;
  readonly query: string;
  /** Fixed for pair-level first_observed; derived later for query-level signals. */
  readonly page: string | null;
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow | null;
  readonly baselineCtr: number | null;
  readonly clickGap: number | null;
  readonly clickChange: number | null;
  readonly clickChangeRatio: number | null;
  readonly positionDelta: number | null;
  readonly order: number;
}

/**
 * Whether a position is close enough to act on this week.
 *
 * Written as a positive assertion so a NaN falls outside the band instead of
 * being carried into an action.
 */
function withinActionableBand(position: number): boolean {
  return (
    Number.isFinite(position) &&
    position > 0 &&
    position <= BRIEFING_ACTIONABLE_POSITION_MAX
  );
}

function ctrLaneFor(
  brandTermsConfirmed: boolean,
  curve: SiteCtrCurve,
  baselineRows: number,
): DailyBriefingCtrLane {
  if (!brandTermsConfirmed) {
    return {
      state: "not_applicable",
      blockers: ["brand_terms_not_confirmed"],
      usableBaselineBands: null,
    };
  }

  const usableBaselineBands = curve.buckets.filter(
    (bucket) => bucket.quality === "usable",
  ).length;
  if (usableBaselineBands > 0) {
    return { state: "evaluated", blockers: [], usableBaselineBands };
  }

  const blockers: DailyBriefingCtrLaneBlocker[] = [];
  if (curve.rowsUsed === 0) {
    blockers.push("no_position_band_coverage");
  }
  if (
    curve.buckets.some(
      (bucket) => bucket.quality === "insufficient_impressions",
    )
  ) {
    blockers.push("insufficient_band_impressions");
  }
  if (
    curve.buckets.some((bucket) => bucket.quality === "insufficient_queries")
  ) {
    blockers.push("insufficient_band_queries");
  }

  return {
    state: "not_applicable",
    blockers,
    usableBaselineBands: baselineRows > 0 ? usableBaselineBands : 0,
  };
}

function candidatesFor(
  input: BuildDailyBriefingInput,
  currentEvidence: DailyBriefingQueryEvidence,
  previousEvidence: DailyBriefingQueryEvidence,
): {
  readonly currentRows: readonly GscQueryRow[];
  readonly candidates: readonly ChangeCandidate[];
  readonly observedQueryRows: number;
  readonly observationCandidates: number;
  readonly actionEligibleQueries: number;
  readonly ctrBaselineRows: number | null;
  readonly clickOpportunityCandidates: number | null;
  readonly stableDeclineCandidates: number;
  readonly pageOneBandCandidates: number;
  readonly positionDeclineCandidates: number;
  readonly firstObservedCandidates: number;
  readonly provisionalMoves: readonly DailyBriefingProvisionalMove[];
  readonly pageAttributionWithheld: number;
  readonly clickDeclineCapableQueries: number;
  readonly ctrOpportunityCapableQueries: number;
  readonly strictPairedPositionQueries: number;
  readonly provisionalPairedPositionQueries: number;
  readonly currentFloorOnlyQueries: number;
  readonly ctrLane: DailyBriefingCtrLane;
  readonly lanes: Readonly<Record<DailyBriefingChangeKind, DailyBriefingLaneState>>;
  readonly byLane: Readonly<
    Record<DailyBriefingChangeKind, DailyBriefingLaneRowCounts>
  >;
} {
  const currentAll = validQueryRows(currentEvidence.queryRead?.rows ?? []);
  const previousAll = validQueryRows(previousEvidence.queryRead?.rows ?? []);
  const opportunitySplit = input.brandTermsConfirmed
    ? splitBrandQueries(currentAll, input.brandTerms)
    : { brand: [], nonBrand: [] };
  const currentRows = currentAll;
  const previousRows = previousAll;
  const currentByQuery = mapByQuery(currentRows);
  const previousByQuery = mapByQuery(previousRows);
  const curve = buildSiteCtrCurve(
    opportunitySplit.nonBrand,
    opportunitySplit.brand.length,
  );
  const table = buildEvidenceTable(opportunitySplit.nonBrand, curve);

  const opportunities: ChangeCandidate[] = [];
  const bucketsById = new Map(
    curve.buckets.map((bucket) => [bucket.bucketId, bucket]),
  );
  // Rows this lane could ask its question of, which is not every row the
  // shared table produced: the three sample conditions below decide whether a
  // shortfall here could mean anything, and a row failing them was never
  // evaluated rather than evaluated and found clean.
  let ctrAnomalyCapableRows = 0;
  for (const row of table.rows) {
    if (row.observedCtr === null || !(row.baselineCtr > 0)) continue;
    // Leave-one-out, matching the baseline: the band's impressions with this
    // row's own removed are the sample the comparison actually stands on.
    const bucket = bucketsById.get(row.bucketId);
    const bandImpressions =
      bucket === undefined ? 0 : bucket.impressions - row.impressions;
    // Positive assertions, so a NaN fails them rather than passing.
    if (
      !(row.impressions >= BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS) ||
      !(bandImpressions >= BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS) ||
      !(row.expectedClicks >= BRIEFING_CTR_ANOMALY_MIN_EXPECTED_CLICKS)
    ) {
      continue;
    }
    ctrAnomalyCapableRows += 1;
    if (
      !(
        row.clicks <=
        BRIEFING_CTR_ANOMALY_MAX_OBSERVED_SHARE * row.expectedClicks
      )
    ) {
      continue;
    }
    const current = currentByQuery.get(row.query);
    if (current === undefined) continue;
    const previous = previousByQuery.get(row.query) ?? null;
    opportunities.push({
      kind: "click_opportunity",
      query: row.query,
      page: null,
      current,
      previous,
      baselineCtr: row.baselineCtr,
      clickGap: row.clickGap,
      clickChange: previous === null ? null : current.clicks - previous.clicks,
      clickChangeRatio:
        previous === null ? null : ratio(previous.clicks, current.clicks),
      positionDelta:
        previous === null ? null : current.position - previous.position,
      order: row.clickGap,
    });
  }
  opportunities.sort(
    (a, b) => b.order - a.order || a.query.localeCompare(b.query),
  );

  const declines: ChangeCandidate[] = [];
  const pageOneCrossings: ChangeCandidate[] = [];
  const positionDeclines: ChangeCandidate[] = [];
  const provisionalPairs: {
    readonly kind: DailyBriefingProvisionalMove["kind"];
    readonly current: GscQueryRow;
    readonly previous: GscQueryRow;
    readonly positionDelta: number;
    readonly order: number;
  }[] = [];
  let observationCandidates = 0;
  let actionEligibleQueries = 0;
  let clickDeclineCapableQueries = 0;
  let strictPairedPositionQueries = 0;
  let provisionalPairedPositionQueries = 0;
  let currentFloorOnlyQueries = 0;
  let crossingCapableQueries = 0;
  let positionDeclineCapableQueries = 0;
  for (const current of currentRows) {
    const currentAtFloor = current.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS;
    if (
      current.impressions >= BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS &&
      !currentAtFloor
    ) {
      observationCandidates += 1;
    }
    if (currentAtFloor) actionEligibleQueries += 1;
    if (!currentAtFloor) continue;

    const previous = previousByQuery.get(current.query);
    const previousAtFloor =
      previous !== undefined &&
      previous.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS;
    const previousProvisional =
      previous !== undefined &&
      !previousAtFloor &&
      previous.impressions >= BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS;
    if (previous === undefined || (!previousAtFloor && !previousProvisional)) {
      currentFloorOnlyQueries += 1;
      continue;
    }

    const positionsComparable =
      Number.isFinite(current.position) &&
      Number.isFinite(previous.position) &&
      current.position > 0 &&
      previous.position > 0;
    const positionDelta = current.position - previous.position;
    const crossedIntoTopBand =
      positionsComparable &&
      previous.position > BRIEFING_TOP_BAND_MAX_POSITION &&
      current.position <= BRIEFING_TOP_BAND_MAX_POSITION &&
      previous.position - current.position >= BRIEFING_TOP_BAND_MIN_IMPROVEMENT;
    const declinedInsideBand =
      positionsComparable &&
      positionDelta >= BRIEFING_POSITION_DECLINE_MIN_DELTA &&
      (withinActionableBand(current.position) ||
        withinActionableBand(previous.position));

    // A prior window of 50-99 impressions can show that the average position
    // moved; it cannot carry the word "change". The move is collected as an
    // observation and never reaches a lane, a change or an action.
    if (previousProvisional) {
      if (!positionsComparable) continue;
      provisionalPairedPositionQueries += 1;
      if (crossedIntoTopBand) {
        provisionalPairs.push({
          kind: "provisional_page_one_band_entry",
          current,
          previous,
          positionDelta,
          order: previous.position - current.position,
        });
      } else if (declinedInsideBand) {
        provisionalPairs.push({
          kind: "provisional_actionable_position_decline",
          current,
          previous,
          positionDelta,
          order: positionDelta,
        });
      }
      continue;
    }

    // Both windows carry a comparable sample, so this query can be asked every
    // paired question below. Each lane is asked independently: short-circuiting
    // to the next query on the first hit made source order act as a priority,
    // which is the ordering bug KIND_RANK exists to prevent.
    if (previous.clicks >= BRIEFING_CLICK_DECLINE_MIN_PREVIOUS_CLICKS) {
      clickDeclineCapableQueries += 1;
    }
    if (positionsComparable) {
      strictPairedPositionQueries += 1;
      if (previous.position > BRIEFING_TOP_BAND_MAX_POSITION) {
        crossingCapableQueries += 1;
      }
      if (
        withinActionableBand(current.position) ||
        withinActionableBand(previous.position)
      ) {
        positionDeclineCapableQueries += 1;
      }
    }

    const clickChange = current.clicks - previous.clicks;
    const clickChangeRatio = ratio(previous.clicks, current.clicks);

    if (
      previous.clicks >= BRIEFING_CLICK_DECLINE_MIN_PREVIOUS_CLICKS &&
      clickChange <= -BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE &&
      clickChangeRatio !== null &&
      clickChangeRatio <= -BRIEFING_MATERIAL_CHANGE_RATIO &&
      Math.abs(positionDelta) <= BRIEFING_STABLE_POSITION_DELTA
    ) {
      declines.push({
        kind: "stable_position_click_decline",
        query: current.query,
        page: null,
        current,
        previous,
        baselineCtr: null,
        clickGap: null,
        clickChange,
        clickChangeRatio,
        positionDelta,
        order: -clickChange,
      });
    }

    // Average position, not rank: this says the query's impression-weighted
    // position moved into the top band, never that the page holds place N.
    if (crossedIntoTopBand) {
      pageOneCrossings.push({
        kind: "average_position_crossed_page_one_band",
        query: current.query,
        page: null,
        current,
        previous,
        baselineCtr: null,
        clickGap: null,
        clickChange,
        clickChangeRatio,
        positionDelta,
        order: previous.position - current.position,
      });
    }

    // A decline outside the actionable band is real and useless: nothing done
    // to the page this week decides whether position eighty-six earns a click.
    if (declinedInsideBand) {
      positionDeclines.push({
        kind: "actionable_position_decline",
        query: current.query,
        page: null,
        current,
        previous,
        baselineCtr: null,
        clickGap: null,
        clickChange,
        clickChangeRatio,
        positionDelta,
        order: positionDelta,
      });
    }
  }
  declines.sort((a, b) => b.order - a.order || a.query.localeCompare(b.query));
  pageOneCrossings.sort(
    (a, b) => b.order - a.order || a.query.localeCompare(b.query),
  );
  positionDeclines.sort(
    (a, b) => b.order - a.order || a.query.localeCompare(b.query),
  );

  const pairAttributionUsable =
    pageAttributionUsable(currentEvidence) &&
    pageAttributionUsable(previousEvidence);
  const currentQueryPages = pairAttributionUsable
    ? validQueryPageRows(currentEvidence.queryPageRead?.rows ?? [])
    : [];
  const previousQueryPages = pairAttributionUsable
    ? validQueryPageRows(previousEvidence.queryPageRead?.rows ?? [])
    : [];
  const currentCoverage = queryPageCoverage(currentRows, currentQueryPages);
  const previousCoverage = queryPageCoverage(previousRows, previousQueryPages);
  const previousPairs = new Set(
    previousQueryPages.map((row) => `${row.query}\u0000${row.page}`),
  );
  const firstObserved: ChangeCandidate[] = [];
  const pageAttributionWithheld = new Set<string>();
  // Queries whose pairs this lane actually got to compare against the prior
  // read, and queries it found something in. Counted distinctly so a query
  // carrying two new pairs cannot make the lane look busier than the property.
  const firstObservedEvaluableQueries = new Set<string>();
  const firstObservedSignalQueries = new Set<string>();

  for (const pair of currentQueryPages) {
    const current = currentByQuery.get(pair.query);
    if (
      current === undefined ||
      current.impressions < BRIEFING_MIN_ROW_IMPRESSIONS ||
      pair.impressions < BRIEFING_MIN_ROW_IMPRESSIONS
    ) {
      continue;
    }

    const currentCoverageRatio = currentCoverage.get(pair.query);
    const previous = previousByQuery.get(pair.query);
    const previousCoverageRatio = previousCoverage.get(pair.query);
    const currentCoverageSufficient =
      currentCoverageRatio !== null &&
      currentCoverageRatio !== undefined &&
      currentCoverageRatio >= MIN_DIMENSION_COVERAGE;
    const previousPageCoverageSufficient =
      previousCoverageRatio !== null &&
      previousCoverageRatio !== undefined &&
      previousCoverageRatio >= MIN_DIMENSION_COVERAGE;
    // Thin page evidence and a missing comparison window are different
    // failures. Counting the second as a withheld page said the landing page
    // of a query whose page this same run displays had been withheld.
    if (
      !currentCoverageSufficient ||
      (previous !== undefined &&
        previous.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS &&
        !previousPageCoverageSufficient)
    ) {
      pageAttributionWithheld.add(`${pair.query}\u0000${pair.page}`);
      continue;
    }
    // No prior window at the floor: nothing was withheld, the question simply
    // could not be asked of this pair.
    if (previous !== undefined && previous.impressions < BRIEFING_MIN_ROW_IMPRESSIONS) {
      continue;
    }

    // Evaluable is claimed here rather than at the impression floor: an
    // attribution we could not trust was never evaluated, and filing it under
    // "evaluated, no signal" would rebuild the conflation the row split exists
    // to remove. A pair that survives to here was compared against the prior
    // read, whether or not the comparison found anything.
    firstObservedEvaluableQueries.add(pair.query);

    if (
      pair.position < FIRST_OBSERVED_MIN_POSITION ||
      pair.position >= FIRST_OBSERVED_MAX_POSITION ||
      previousPairs.has(`${pair.query}\u0000${pair.page}`)
    ) {
      continue;
    }

    firstObservedSignalQueries.add(pair.query);
    firstObserved.push({
      kind: "first_observed",
      query: pair.query,
      page: pair.page,
      current: {
        query: pair.query,
        clicks: pair.clicks,
        impressions: pair.impressions,
        position: pair.position,
      },
      previous: null,
      baselineCtr: null,
      clickGap: null,
      clickChange: null,
      clickChangeRatio: null,
      positionDelta: null,
      order: pair.impressions,
    });
  }
  firstObserved.sort(
    (a, b) =>
      b.order - a.order ||
      a.query.localeCompare(b.query) ||
      (a.page ?? "").localeCompare(b.page ?? ""),
  );

  // Resolved after the loop because page attribution needs the whole read.
  const provisionalMoves: DailyBriefingProvisionalMove[] = provisionalPairs
    .sort(
      (a, b) =>
        PROVISIONAL_KIND_RANK[a.kind] - PROVISIONAL_KIND_RANK[b.kind] ||
        b.order - a.order ||
        a.current.query.localeCompare(b.current.query),
    )
    .map((entry) => {
      const page = pageForObservation(
        entry.current.query,
        currentEvidence,
        BRIEFING_MIN_ROW_IMPRESSIONS,
      );
      return {
        kind: entry.kind,
        evidence: "observed" as const,
        query: entry.current.query,
        page,
        pageEvidence: (page === null ? "unavailable" : "observed") as
          | "observed"
          | "unavailable",
        current: entry.current,
        previous: entry.previous,
        positionDelta: entry.positionDelta,
      };
    });

  const observedQueryRows = currentRows.length;
  const ctrLane = ctrLaneFor(input.brandTermsConfirmed, curve, table.rows.length);
  // The rows this lane could ask about, not the rows the shared table built.
  // Reading it off `table.rows.length` counted every query with a usable
  // leave-one-out baseline as evaluated, including the ones this briefing's
  // own sample conditions never let it look at.
  const ctrOpportunityCapableQueries = ctrAnomalyCapableRows;
  const lanes: Record<DailyBriefingChangeKind, DailyBriefingLaneState> = {
    // A usable position band is not a usable per-query baseline. The curve
    // needs the band; the lane needs a leave-one-out baseline for the query
    // itself, and five queries of a hundred impressions can satisfy the first
    // while every one of them fails the second. Reading the lane off the band
    // let a run report "the lane was evaluated" beside "no row was evaluable".
    click_opportunity:
      ctrLane.state === "unavailable"
        ? "unavailable"
        : ctrOpportunityCapableQueries > 0
          ? "evaluated"
          : "not_applicable",
    stable_position_click_decline:
      clickDeclineCapableQueries > 0 ? "evaluated" : "not_applicable",
    average_position_crossed_page_one_band:
      crossingCapableQueries > 0 ? "evaluated" : "not_applicable",
    actionable_position_decline:
      positionDeclineCapableQueries > 0 ? "evaluated" : "not_applicable",
    // This lane stands on the page attachment, not on the query rows. Marking
    // it evaluated whenever the funnel could be computed claimed a comparison
    // that never happened when the attachment was missing or truncated.
    first_observed: !pairAttributionUsable
      ? "unavailable"
      : firstObservedEvaluableQueries.size > 0
        ? "evaluated"
        : "not_applicable",
  };

  const laneRows = (
    capable: number,
    candidateCount: number,
  ): DailyBriefingLaneRowCounts => ({
    notEvaluated: Math.max(0, observedQueryRows - capable),
    evaluatedNoSignal: Math.max(0, capable - candidateCount),
    candidates: candidateCount,
  });

  return {
    currentRows,
    candidates: [
      ...opportunities,
      ...declines,
      ...pageOneCrossings,
      ...positionDeclines,
      ...firstObserved,
    ],
    observedQueryRows,
    observationCandidates,
    actionEligibleQueries,
    ctrBaselineRows: input.brandTermsConfirmed ? table.rows.length : null,
    clickOpportunityCandidates: input.brandTermsConfirmed
      ? opportunities.length
      : null,
    stableDeclineCandidates: declines.length,
    pageOneBandCandidates: pageOneCrossings.length,
    positionDeclineCandidates: positionDeclines.length,
    firstObservedCandidates: firstObserved.length,
    provisionalMoves,
    pageAttributionWithheld: pageAttributionWithheld.size,
    clickDeclineCapableQueries,
    ctrOpportunityCapableQueries,
    strictPairedPositionQueries,
    provisionalPairedPositionQueries,
    currentFloorOnlyQueries,
    ctrLane,
    lanes,
    byLane: {
      click_opportunity: laneRows(
        ctrOpportunityCapableQueries,
        opportunities.length,
      ),
      stable_position_click_decline: laneRows(
        clickDeclineCapableQueries,
        declines.length,
      ),
      average_position_crossed_page_one_band: laneRows(
        crossingCapableQueries,
        pageOneCrossings.length,
      ),
      actionable_position_decline: laneRows(
        positionDeclineCapableQueries,
        positionDeclines.length,
      ),
      first_observed: laneRows(
        firstObservedEvaluableQueries.size,
        firstObservedSignalQueries.size,
      ),
    },
  };
}

/** Crossings before declines: entering the top band is the rarer fact. */
const PROVISIONAL_KIND_RANK: Readonly<
  Record<DailyBriefingProvisionalMove["kind"], number>
> = {
  provisional_page_one_band_entry: 0,
  provisional_actionable_position_decline: 1,
};

const DESTINATIONS: Readonly<
  Record<DailyBriefingChangeKind, DailyBriefingAction["destination"]>
> = {
  click_opportunity: "seo-quick-wins",
  stable_position_click_decline: "traffic-drop-diagnosis",
  average_position_crossed_page_one_band: "on-page-seo-check",
  actionable_position_decline: "traffic-drop-diagnosis",
  first_observed: "on-page-seo-check",
};

/**
 * How much of a visitor's day each lane deserves.
 *
 * This is the product's ranking, stated once. The previous code walked the
 * lanes in source order and took the first candidate from each, so three
 * strong opportunities of one kind could never fill the briefing while one
 * weaker candidate of another kind always could: a code ordering wearing a
 * priority's clothes.
 */
const KIND_RANK: Readonly<Record<DailyBriefingChangeKind, number>> = {
  click_opportunity: 0,
  average_position_crossed_page_one_band: 1,
  stable_position_click_decline: 2,
  actionable_position_decline: 3,
  first_observed: 4,
};

/** Collision-free identity for one withheld attribution. */
function withheldKey(candidate: ChangeCandidate): string {
  return JSON.stringify([candidate.kind, candidate.query, candidate.page]);
}

function selectChanges(
  candidates: readonly ChangeCandidate[],
  currentEvidence: DailyBriefingQueryEvidence,
): {
  readonly changes: readonly DailyBriefingChange[];
  readonly actions: readonly DailyBriefingAction[];
  readonly pageAttributionWithheld: number;
} {
  const pageAttributionWithheld = new Set<string>();

  // Candidates arrive already sorted within their lane, so a stable sort by
  // rank alone preserves each lane's own magnitude order.
  const ranked = [...candidates].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind],
  );

  const resolved: {
    readonly candidate: ChangeCandidate;
    readonly page: string | null;
  }[] = [];
  const usedQueries = new Set<string>();
  for (const candidate of ranked) {
    if (usedQueries.has(candidate.query)) continue;
    const page =
      candidate.page ?? pageForQuery(candidate.query, currentEvidence);
    if (page === null) {
      pageAttributionWithheld.add(withheldKey(candidate));
      // first_observed is a statement about one query/page pair: without the
      // page there is no signal left to report. Every other lane is a
      // statement about the query, so a missing page withholds the handoff.
      if (candidate.kind === "first_observed") continue;
    }
    usedQueries.add(candidate.query);
    resolved.push({ candidate, page });
  }

  const selected = resolved.slice(0, DAILY_BRIEFING_ACTION_LIMIT);
  // A briefing that spends its whole budget on signals it cannot hand off,
  // while one it can hand off waits outside the cut, is the same empty page
  // this work exists to remove. Give up the weakest un-handoffable row for it.
  if (selected.length > 0 && selected.every((entry) => entry.page === null)) {
    const handoffable = resolved
      .slice(DAILY_BRIEFING_ACTION_LIMIT)
      .find((entry) => entry.page !== null);
    if (handoffable !== undefined) {
      selected.splice(selected.length - 1, 1, handoffable);
    }
  }

  const changes: DailyBriefingChange[] = [];
  const actions: DailyBriefingAction[] = [];
  for (const { candidate, page } of selected) {
    changes.push({
      kind: candidate.kind,
      evidence:
        candidate.kind === "first_observed" ? "not_observed" : "observed",
      query: candidate.query,
      page,
      pageEvidence: page === null ? "unavailable" : "observed",
      current: candidate.current,
      previous: candidate.previous,
      clickChange: candidate.clickChange,
      clickChangeRatio: candidate.clickChangeRatio,
      positionDelta: candidate.positionDelta,
      baselineCtr: candidate.baselineCtr,
      clickGap: candidate.clickGap,
    });
    if (page !== null) {
      actions.push({
        kind: candidate.kind,
        destination: DESTINATIONS[candidate.kind],
        query: candidate.query,
        page,
      });
    }
  }

  return {
    changes,
    actions,
    pageAttributionWithheld: pageAttributionWithheld.size,
  };
}

/**
 * Which band of the result page an observation currently sits in.
 *
 * Bands, not ranks: this is the impression-weighted average position Search
 * Console reports, so it says where the property tends to be seen, never that
 * a page holds a fixed place.
 */
function observationBandFor(position: number): DailyBriefingObservationBand {
  if (!Number.isFinite(position) || position <= 0) return "far";
  if (position <= BRIEFING_TOP_BAND_MAX_POSITION) return "page_one";
  if (position <= BRIEFING_OBSERVATION_NEAR_BAND_MAX) return "near_page_one";
  if (position <= BRIEFING_OBSERVATION_MID_BAND_MAX) return "mid";
  return "far";
}

/**
 * Order observations by what a visitor could act on, not by how loud they are.
 *
 * Sorting on click delta first collapses to impressions on a property whose
 * queries have no clicks, which is how a query at average position ninety
 * ended up above one that had just moved into the top band.
 */
function observationRank(item: DailyBriefingQueryObservation): number {
  const floorReached = item.kind === "sample_floor_reached";
  switch (item.band) {
    case "page_one":
      return floorReached ? 0 : 2;
    case "near_page_one":
      return floorReached ? 1 : 2;
    case "mid":
      return floorReached ? 3 : 4;
    case "far":
      return floorReached ? 5 : 6;
  }
}

function emptyBandCounts(): Record<DailyBriefingObservationBand, number> {
  return { page_one: 0, near_page_one: 0, mid: 0, far: 0 };
}

function queryWatchlistFor({
  budget,
  currentEvidence,
  evidence,
  excludedQueries,
  previousEvidence,
}: {
  /** Display rows left after changes and provisional moves have taken theirs. */
  readonly budget: number;
  readonly currentEvidence: DailyBriefingQueryEvidence | null;
  readonly evidence: DailyBriefingQueryWatchlist["evidence"];
  /** Queries already named elsewhere on the page. */
  readonly excludedQueries: ReadonlySet<string>;
  readonly previousEvidence: DailyBriefingQueryEvidence | null;
}): DailyBriefingQueryWatchlist {
  if (
    evidence !== "observed" ||
    currentEvidence?.queryRead === null ||
    currentEvidence?.queryRead === undefined ||
    previousEvidence?.queryRead === null ||
    previousEvidence?.queryRead === undefined
  ) {
    return {
      evidence,
      items: [],
      candidates: null,
      withheldByBand: null,
      withheldByKind: null,
    };
  }

  const previousByQuery = mapByQuery(
    validQueryRows(previousEvidence.queryRead.rows),
  );
  const observations = validQueryRows(currentEvidence.queryRead.rows)
    .flatMap<DailyBriefingQueryObservation>((current) => {
      if (
        excludedQueries.has(current.query) ||
        current.impressions < BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS
      ) {
        return [];
      }
      const kind =
        current.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS
          ? "sample_floor_reached"
          : "sample_building";
      const minimumPageImpressions =
        kind === "sample_floor_reached"
          ? BRIEFING_MIN_ROW_IMPRESSIONS
          : BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS;
      const page = pageForObservation(
        current.query,
        currentEvidence,
        minimumPageImpressions,
      );
      // Below the provisional floor the prior window cannot carry a position
      // comparison, and rendering "11.8 -> 9.7" from a 49-impression week is
      // exactly the low-sample claim the floors exist to refuse.
      const priorWindow = previousByQuery.get(current.query);
      const priorComparable =
        priorWindow !== undefined &&
        priorWindow.impressions >= BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS;
      const previous = priorComparable ? (priorWindow ?? null) : null;
      // Refusing the comparison must not also erase that a prior window
      // existed: "not observed" and "observed, too small to compare" are
      // different facts and the row would otherwise report the wrong one.
      const previousBelowFloor =
        priorWindow !== undefined && !priorComparable
          ? priorWindow.impressions
          : null;
      return [
        {
          kind,
          band: observationBandFor(current.position),
          query: current.query,
          page,
          pageEvidence: page === null ? "unavailable" : "observed",
          current,
          previous,
          previousBelowFloor,
          positionDelta:
            previous === null ||
            !Number.isFinite(current.position) ||
            !Number.isFinite(previous.position)
              ? null
              : current.position - previous.position,
        },
      ];
    })
    .sort((a, b) => {
      const rankDelta = observationRank(a) - observationRank(b);
      if (rankDelta !== 0) return rankDelta;
      // Inside one band, a bigger move is the more informative row. A row with
      // no prior window has no move to compare and sorts after the ones that do.
      const aMove = a.positionDelta === null ? -1 : Math.abs(a.positionDelta);
      const bMove = b.positionDelta === null ? -1 : Math.abs(b.positionDelta);
      if (aMove !== bMove) return bMove - aMove;
      const aClickDelta =
        a.previous === null ? -1 : Math.abs(a.current.clicks - a.previous.clicks);
      const bClickDelta =
        b.previous === null ? -1 : Math.abs(b.current.clicks - b.previous.clicks);
      return (
        bClickDelta - aClickDelta ||
        b.current.impressions - a.current.impressions ||
        a.query.localeCompare(b.query)
      );
    });

  // Rows that cleared every observation threshold and then lost the display
  // budget are a different fact from rows that cleared nothing. Calling both
  // of them "below the threshold" is the lie this count exists to prevent.
  const items = observations.slice(0, Math.max(0, budget));
  const withheldByBand = emptyBandCounts();
  const withheldByKind: Record<DailyBriefingQueryObservationKind, number> = {
    sample_floor_reached: 0,
    sample_building: 0,
  };
  for (const withheld of observations.slice(items.length)) {
    withheldByBand[withheld.band] += 1;
    withheldByKind[withheld.kind] += 1;
  }

  return {
    evidence,
    items,
    candidates: observations.length,
    withheldByBand,
    withheldByKind,
  };
}

/**
 * The spread a weekly count carries on its own.
 *
 * Weekly clicks and impressions are counts, so their run-to-run variation
 * scales with the square root of the base. Below this the direction of a move
 * is not established, and dispatching a diagnosis for it sends a visitor to
 * look for a cause that may not exist.
 */
function noiseFloorFor(
  basis: DailyBriefingNoiseFloor["basis"],
  previousValue: number,
  observedChange: number,
): DailyBriefingNoiseFloor | null {
  // Without a positive base there is no spread to measure against. Returning
  // an infinite floor would satisfy the type and then serialize to null over
  // the wire, so the trend is withheld instead.
  if (!(Number.isFinite(previousValue) && previousValue > 0)) return null;
  const minimumForAction =
    BRIEFING_PROPERTY_NOISE_SIGMA * Math.sqrt(previousValue);
  return {
    basis,
    observedChange,
    minimumForAction,
    cleared: Math.abs(observedChange) >= minimumForAction,
  };
}

function propertyTrendFor(
  weekly: DailyBriefingKpiComparison,
): DailyBriefingPropertyTrend {
  const empty: DailyBriefingPropertyTrend = {
    change: null,
    action: null,
    noiseFloor: null,
  };
  // No property-wide impression floor. A fixed floor does not scale with the
  // sample, so it withheld moves the per-basis noise floor had already judged
  // large enough: a property whose weekly clicks fell 23 to 13 cleared two
  // sigma and was still dropped for sitting under a thousand impressions.
  // `noiseFloorFor` is the gate that scales with the base, and on a count it
  // is a stricter test than any volume threshold can be.
  if (
    weekly.evidence !== "observed" ||
    weekly.current === null ||
    weekly.previous === null
  ) {
    return empty;
  }

  const current = weekly.current;
  const previous = weekly.previous;
  const clickChange = current.clicks - previous.clicks;
  const clickChangeRatio = ratio(previous.clicks, current.clicks);
  const impressionChange = current.impressions - previous.impressions;
  const impressionChangeRatio = ratio(
    previous.impressions,
    current.impressions,
  );
  const positionDelta =
    current.position === null || previous.position === null
      ? null
      : current.position - previous.position;

  let kind: DailyBriefingPropertyActionKind | null = null;
  let destination: "traffic-drop-diagnosis" | "seo-quick-wins" | null = null;
  let noiseFloor: DailyBriefingNoiseFloor | null = null;

  if (
    clickChange <= -BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE &&
    clickChangeRatio !== null &&
    clickChangeRatio <= -BRIEFING_MATERIAL_CHANGE_RATIO
  ) {
    kind = "sitewide_click_decline";
    destination = "traffic-drop-diagnosis";
    noiseFloor = noiseFloorFor("clicks", previous.clicks, clickChange);
  } else if (
    impressionChange <= -BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE &&
    impressionChangeRatio !== null &&
    impressionChangeRatio <= -BRIEFING_MATERIAL_CHANGE_RATIO &&
    positionDelta !== null &&
    positionDelta >= BRIEFING_PROPERTY_POSITION_DELTA
  ) {
    kind = "sitewide_visibility_decline";
    destination = "traffic-drop-diagnosis";
    noiseFloor = noiseFloorFor(
      "impressions",
      previous.impressions,
      impressionChange,
    );
  } else {
    const clickGainClears =
      clickChange >= BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE &&
      clickChangeRatio !== null &&
      clickChangeRatio >= BRIEFING_MATERIAL_CHANGE_RATIO;
    const impressionAndPositionGainClears =
      impressionChange >= BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE &&
      impressionChangeRatio !== null &&
      impressionChangeRatio >= BRIEFING_MATERIAL_CHANGE_RATIO &&
      positionDelta !== null &&
      positionDelta <= -BRIEFING_PROPERTY_POSITION_DELTA;
    if (clickGainClears) {
      kind = "sitewide_visibility_gain";
      destination = "seo-quick-wins";
      noiseFloor = noiseFloorFor("clicks", previous.clicks, clickChange);
    } else if (impressionAndPositionGainClears) {
      kind = "sitewide_visibility_gain";
      destination = "seo-quick-wins";
      noiseFloor = noiseFloorFor(
        "impressions",
        previous.impressions,
        impressionChange,
      );
    }
  }

  if (kind === null || destination === null || noiseFloor === null) {
    return empty;
  }

  // The threshold says a move happened; the noise floor says whether the
  // sample can carry the word "material". Encoding an uncleared move as a
  // decline made the heading assert what the sentence under it withdrew, so
  // the kind itself now stops short of the claim.
  const reportedKind: DailyBriefingPropertyChangeKind = noiseFloor.cleared
    ? kind
    : noiseFloor.basis === "clicks"
      ? "sitewide_click_observation"
      : "sitewide_visibility_observation";

  return {
    change: {
      kind: reportedKind,
      evidence: "observed",
      query: null,
      page: null,
      current,
      previous,
      clickChange,
      clickChangeRatio,
      impressionChange,
      impressionChangeRatio,
      positionDelta,
    },
    // The trend is reported either way; only the handoff waits for a sample
    // large enough to carry the claim.
    action: noiseFloor.cleared ? { kind, destination } : null,
    noiseFloor,
  };
}

/* ── the page dimension ──────────────────────────────────────────────── */

/**
 * Why this dimension exists beside the query one.
 *
 * Search Console anonymizes low-volume queries, not pages. On one measured
 * property the query rows accounted for 9 of 37 weekly clicks; the page rows
 * accounted for all 37. Every click-driven query lane is blind to that
 * remainder, and on a small property the remainder is most of the property.
 *
 * These lanes read `pageRead` and never the `[query,page]` split, which Search
 * Console drops rows from and which therefore understates each page by exactly
 * the amount this dimension exists to recover.
 */
/**
 * The basis a page row has to be reported on to mean what these lanes read it
 * as. Two windows agreeing on the wrong basis agree about the wrong thing:
 * a property-aggregated response says nothing per page, and comparing two of
 * them would produce a page-specific claim from rows that are not per page.
 */
const PAGE_AGGREGATION_BASIS = "byPage";

function pageRowsState(
  evidence: DailyBriefingQueryEvidence | null,
): Exclude<DailyBriefingEvidenceState, "not_observed"> {
  if (evidence === null || evidence.pageRead === null) return "unavailable";
  // Basis before truncation: a response on the wrong basis is not a prefix of
  // the right one, so calling it partial would promise the rest is coming.
  if (evidence.pageRead.responseAggregationType !== PAGE_AGGREGATION_BASIS) {
    return "unavailable";
  }
  if (evidence.pageRead.paging.truncated) return "partial";
  return "observed";
}

interface PageRowSet {
  readonly rows: readonly GscPageRow[];
  /**
   * Pages whose rows were dropped as contradictory or invalid.
   *
   * Carried separately because dropping a row and never seeing one are
   * different facts, and only the second means the page was absent. Folding
   * them together let a page with two disagreeing prior rows be reported as
   * first observed — turning unusable evidence into proof of absence, which
   * is the one substitution this tool exists to refuse.
   */
  readonly unusable: ReadonlySet<string>;
  /** Rows that named no page at all, which no identity set can represent. */
  readonly blank: number;
}

/**
 * Rows keyed uniquely by page, with contradictions dropped rather than summed.
 *
 * Same discipline as `validQueryRows`: one URL appearing twice in one window
 * is two readings that disagree, and adding them invents a third.
 */
function validPageRows(rows: readonly GscPageRow[]): PageRowSet {
  const unique = new Map<string, GscPageRow>();
  const unusable = new Set<string>();
  let blank = 0;
  for (const row of rows) {
    // One identity, and every map, set and lookup downstream uses it. Deriving
    // a trimmed key and then keying by the raw string made "…/a " and "…/a"
    // two different pages, which let a row rejected under one spelling be
    // reported as absent under the other.
    const page = row.page.trim();
    if (page === "") {
      // A row came back and named nothing. Skipping it made the window look
      // one row emptier than it was; there is no identity to put in the set,
      // so it is counted on its own.
      blank += 1;
      continue;
    }
    const normalized: GscPageRow = { ...row, page };
    if (!isMetricRowValid(row) || unique.has(page) || unusable.has(page)) {
      unique.delete(page);
      unusable.add(page);
      continue;
    }
    unique.set(page, normalized);
  }
  return { rows: [...unique.values()], unusable, blank };
}

interface PageCandidate {
  readonly change: DailyBriefingPageChange;
  readonly order: number;
}

const PAGE_CHANGE_LANES: readonly DailyBriefingPageChangeKind[] = [
  "page_impression_collapse",
  "page_click_decline",
  "page_first_observed",
];

/**
 * Whether a page lane actually settled a row.
 *
 * Asked of the counts, not the state. `partially_readable` covers two cases —
 * the lane settled some rows and could not read others, and the lane settled
 * NONE because the only rows it had were unreadable — and reading it as "ran"
 * let a window whose single page had contradictory prior rows drive
 * `change_detection` and a daily cadence off zero settled rows.
 */
function pageLaneSettledRows(
  counts: DailyBriefingLaneRowCounts | null | undefined,
): boolean {
  return (
    counts !== null &&
    counts !== undefined &&
    counts.evaluatedNoSignal + counts.candidates > 0
  );
}

/**
 * A page that stopped being shown outranks one that lost clicks, which in turn
 * outranks one that has only just appeared.
 *
 * Collapse leads because it is the only page signal whose likely cause is the
 * page itself failing — removed, blocked, redirected — rather than the market
 * moving around it. A page that collapsed almost always lost clicks too, and
 * this order is what decides which of the two the reader is shown.
 */
const PAGE_KIND_RANK: Readonly<Record<DailyBriefingPageChangeKind, number>> = {
  page_impression_collapse: 0,
  page_click_decline: 1,
  page_first_observed: 2,
};

const PAGE_DESTINATIONS: Readonly<
  Record<DailyBriefingPageChangeKind, DailyBriefingPageAction["destination"]>
> = {
  page_impression_collapse: "traffic-drop-diagnosis",
  page_click_decline: "traffic-drop-diagnosis",
  page_first_observed: "on-page-seo-check",
};

interface PageCandidateSet {
  readonly candidates: readonly PageCandidate[];
  readonly observedRows: number;
  /**
   * Records the prior window returned, which is the collapse lane's base.
   *
   * Every other page lane walks the current window and is counted against
   * `observedRows`. The collapse lane walks the prior one, because the
   * strongest collapse is a page the current window no longer returns at all
   * and such a page is in no current-row denominator. Reporting its split
   * against `observedRows` would have printed three numbers that do not add up
   * to the total stated beside them.
   */
  readonly previousObservedRows: number;
  /** Current rows returned but not readable; counted, never dropped. */
  readonly unreadableCurrentRows: number;
  readonly pageFloorRows: number;
  readonly pairedPageRows: number;
  readonly lanes: Readonly<
    Record<DailyBriefingPageChangeKind, DailyBriefingPageLaneState>
  >;
  readonly byLane: Readonly<
    Record<DailyBriefingPageChangeKind, DailyBriefingLaneRowCounts>
  >;
}

function pageLaneState(
  capable: number,
  readableRows: number,
  unreadableRows: number,
): DailyBriefingPageLaneState {
  // Asked before capability, because a lane that resolved nine rows and could
  // not read the tenth has not established anything about the tenth. Returning
  // "evaluated" on the strength of the nine dropped the caveat entirely.
  if (unreadableRows > 0) {
    return readableRows === 0 && capable === 0
      ? "unavailable"
      : "partially_readable";
  }
  if (capable > 0) return "evaluated";
  return "not_applicable";
}

function pageLaneRows(
  observedRows: number,
  capable: number,
  candidates: number,
): DailyBriefingLaneRowCounts {
  return {
    notEvaluated: Math.max(0, observedRows - capable),
    evaluatedNoSignal: Math.max(0, capable - candidates),
    candidates,
  };
}

function pageCandidatesFor(
  currentEvidence: DailyBriefingQueryEvidence | null,
  previousEvidence: DailyBriefingQueryEvidence | null,
): PageCandidateSet | null {
  if (
    pageRowsState(currentEvidence) !== "observed" ||
    pageRowsState(previousEvidence) !== "observed"
  ) {
    return null;
  }

  const currentSet = validPageRows(currentEvidence?.pageRead?.rows ?? []);
  const priorSet = validPageRows(previousEvidence?.pageRead?.rows ?? []);
  const currentRows = currentSet.rows;
  const previousByPage = new Map(priorSet.rows.map((row) => [row.page, row]));
  const currentByPage = new Map(currentRows.map((row) => [row.page, row]));

  // Absence is the one claim an unattributable prior record can break for
  // every page at once: a row that named no page could have been any of them.
  // The comparison lane is unaffected — it needs a matching prior row and
  // simply will not find one.
  const priorAbsenceProvable =
    priorSet.blank === 0 &&
    (previousEvidence?.pageRead?.unreadableRows ?? 0) === 0;
  // The same test, pointed the other way, for the one lane that reads absence
  // from the current window. Truncation is already excluded upstream: this
  // function returns early unless both reads are `observed`, which is what
  // makes "the current window returned no row for this page" mean the page
  // received no impressions rather than "we stopped reading before it".
  const currentAbsenceProvable =
    currentSet.blank === 0 &&
    (currentEvidence?.pageRead?.unreadableRows ?? 0) === 0;
  const declines: PageCandidate[] = [];
  const collapses: PageCandidate[] = [];
  const firstObserved: PageCandidate[] = [];
  let pageFloorRows = 0;
  let pairedPageRows = 0;
  let declineCapableRows = 0;
  let firstObservedCapableRows = 0;
  let absenceBlockedRows = 0;
  let priorUnusableRows = 0;
  let collapseCapableRows = 0;
  let collapseReadableRows = 0;
  let collapseBlockedRows = 0;
  let currentUnusableRows = 0;

  for (const current of currentRows) {
    if (current.impressions < BRIEFING_MIN_ROW_IMPRESSIONS) continue;
    pageFloorRows += 1;
    // A prior row we had to throw away is not a prior window we did not have.
    // Neither lane may ask about this page: the decline lane has nothing to
    // subtract from, and the first-observed lane would be reading a discarded
    // row as absence.
    if (priorSet.unusable.has(current.page)) {
      // Neither lane may ask, and the reason is unreadable prior evidence —
      // not that the property has nothing either lane could measure.
      priorUnusableRows += 1;
      continue;
    }
    const previous = previousByPage.get(current.page);

    // Absent, not merely small. Search Console does return zero-impression
    // rows, and a row nobody was shown is observationally the same as no row;
    // a page that had 60 impressions and now has 300 is a page that grew, and
    // calling that "first observed" would be a different claim than the one
    // this lane is allowed to make.
    if (previous === undefined || previous.impressions === 0) {
      if (!priorAbsenceProvable) {
        // This row, and only this row, is the one the unattributable prior
        // record leaves undecided. Counting the whole prior drop against the
        // lane said it could not speak for rows it had in fact resolved.
        absenceBlockedRows += 1;
        continue;
      }
      firstObservedCapableRows += 1;
      if (withinActionableBand(current.position)) {
        firstObserved.push({
          change: {
            kind: "page_first_observed",
            evidence: "observed",
            page: current.page,
            // Null, even when a zero-impression row exists. That row carries
            // no measured position — Search Console cannot weight a position
            // over no impressions — and rendering it produced "0.0 → 12.0",
            // an unmeasured value shown as a number.
            previous: null,
            current,
            clickChange: null,
            clickChangeRatio: null,
            impressionChange: null,
            impressionChangeRatio: null,
            positionDelta: null,
            noiseFloor: null,
          },
          order: current.impressions,
        });
      }
      continue;
    }

    // A prior row exists and was shown, so whether this page is new is
    // settled: it is not. That is the first-observed lane asking its question
    // and getting an answer, so the row is evaluated with no signal rather
    // than filed as one the lane never asked about.
    firstObservedCapableRows += 1;

    // The comparison lane is a different question. A prior window between one
    // impression and the sample floor cannot anchor one, so that row is
    // un-evaluated *there* while remaining answered above.
    if (previous.impressions < BRIEFING_MIN_ROW_IMPRESSIONS) continue;
    pairedPageRows += 1;

    if (previous.clicks < BRIEFING_CLICK_DECLINE_MIN_PREVIOUS_CLICKS) continue;
    declineCapableRows += 1;

    const clickChange = current.clicks - previous.clicks;
    const clickChangeRatio = ratio(previous.clicks, current.clicks);
    if (
      clickChange > -BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE ||
      clickChangeRatio === null ||
      clickChangeRatio > -BRIEFING_MATERIAL_CHANGE_RATIO
    ) {
      continue;
    }

    // The query click lane earns its claim from a stable average position:
    // clicks fell while the position held. A page's average position is
    // blended across every query it ranks for, so that test is not available
    // here and the counting-noise floor takes its place. Without one of the
    // two this lane would announce ordinary week-to-week spread as a decline.
    const noiseFloor = noiseFloorFor("clicks", previous.clicks, clickChange);
    if (noiseFloor === null || !noiseFloor.cleared) continue;

    declines.push({
      change: {
        kind: "page_click_decline",
        evidence: "observed",
        page: current.page,
        previous,
        current,
        clickChange,
        clickChangeRatio,
        impressionChange: current.impressions - previous.impressions,
        impressionChangeRatio: ratio(previous.impressions, current.impressions),
        positionDelta:
          Number.isFinite(current.position) &&
          Number.isFinite(previous.position) &&
          current.position > 0 &&
          previous.position > 0
            ? current.position - previous.position
            : null,
        noiseFloor,
      },
      order: -clickChange,
    });
  }

  // A second pass, over the prior window rather than the current one.
  //
  // Every lane above starts from a page the current window returned, which is
  // exactly the set a collapsed page can be missing from. Asking the question
  // from the other side is what lets this lane speak about a page that stopped
  // being shown at all — the case whose likely cause is the page itself, and
  // the one the reader most needs named.
  for (const previous of priorSet.rows) {
    // Readability first, and before the sample floor, so that "we could not
    // look" is never reported as "there was nothing to look at". A row below
    // the floor was read and rejected; one whose other side we could not read
    // was neither.
    //
    // A current row we had to throw away is not a current window without one.
    // Reading it as absence would report a page as collapsed on the strength
    // of evidence we discarded.
    if (currentSet.unusable.has(previous.page)) {
      currentUnusableRows += 1;
      continue;
    }
    const current = currentByPage.get(previous.page) ?? null;
    if (current === null && !currentAbsenceProvable) {
      // Only the rows that turn on absence are blocked. A page the current
      // window did return is settled either way, whatever else came back
      // unattributable beside it.
      collapseBlockedRows += 1;
      continue;
    }
    collapseReadableRows += 1;
    if (previous.impressions < BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS) {
      continue;
    }
    collapseCapableRows += 1;

    // Zero, and honestly so: the window is known complete, so a page it does
    // not name received no impressions. The position is a different matter and
    // stays unrepresented below — Search Console cannot weight a position over
    // impressions nobody received, and rendering one would be inventing the
    // very number this lane exists to say is gone.
    const currentImpressions = current?.impressions ?? 0;
    const impressionChange = currentImpressions - previous.impressions;
    const impressionChangeRatio = ratio(previous.impressions, currentImpressions);
    if (
      impressionChangeRatio === null ||
      impressionChangeRatio > -BRIEFING_PAGE_COLLAPSE_RATIO
    ) {
      continue;
    }

    // The counting floor, carried as evidence and kept as a guard it does not
    // currently need to be.
    //
    // At the sample floor above it cannot reject anything: a drop of `0.8*N`
    // clears `2*sqrt(N)` for every `N >= 6.25`, so the ratio test already
    // implies this one from thirty impressions upward. It is computed because
    // the report renders the floor beside the drop, and the comparison is left
    // in because it starts doing real work the moment that sample floor is
    // lowered below seven. It is not a second gate today, and describing it as
    // one would credit this lane with a check it never performs.
    const noiseFloor = noiseFloorFor(
      "impressions",
      previous.impressions,
      impressionChange,
    );
    if (noiseFloor === null || !noiseFloor.cleared) continue;

    const currentClicks = current?.clicks ?? 0;
    collapses.push({
      change: {
        kind: "page_impression_collapse",
        evidence: "observed",
        page: previous.page,
        previous,
        current,
        clickChange: currentClicks - previous.clicks,
        clickChangeRatio: ratio(previous.clicks, currentClicks),
        impressionChange,
        impressionChangeRatio,
        // Null whenever either side lacks a measured position, which for this
        // lane includes every page the current window no longer returns.
        positionDelta:
          current !== null &&
          Number.isFinite(current.position) &&
          Number.isFinite(previous.position) &&
          current.position > 0 &&
          previous.position > 0
            ? current.position - previous.position
            : null,
        noiseFloor,
      },
      order: -impressionChange,
    });
  }

  collapses.sort(
    (a, b) => b.order - a.order || a.change.page.localeCompare(b.change.page),
  );
  declines.sort(
    (a, b) => b.order - a.order || a.change.page.localeCompare(b.change.page),
  );
  firstObserved.sort(
    (a, b) => b.order - a.order || a.change.page.localeCompare(b.change.page),
  );

  // Current-window rows we could not read still happened. Leaving them out of
  // the denominator made "0 of 0 rows" out of a window that returned one, and
  // made an unreadable page indistinguishable from an absent one.
  // Records returned, counted as records. Deriving this from the identities
  // that survived meant two contradictory rows for one URL reported as one
  // record returned and one unreadable — two rows arrived and two were
  // discarded. Reader drops are added because a record erased before the
  // report saw it still arrived.
  const observedRows =
    (currentEvidence?.pageRead?.rows.length ?? 0) +
    (currentEvidence?.pageRead?.unreadableRows ?? 0);
  // Everything that arrived and did not become a usable row.
  const unreadableCurrentRows = Math.max(0, observedRows - currentRows.length);
  // The collapse lane's own base, counted the same way on the other window.
  const previousObservedRows =
    (previousEvidence?.pageRead?.rows.length ?? 0) +
    (previousEvidence?.pageRead?.unreadableRows ?? 0);
  // And its own unreadable count. The other lanes carry the current window's
  // discards because that is the window they walk; this one walks the prior
  // window, and reading its state off the current window's discards let a run
  // whose entire prior read was unusable report "nothing to measure here"
  // instead of "we could not look".
  const unreadablePriorRows = Math.max(
    0,
    previousObservedRows - priorSet.rows.length,
  );
  return {
    // Pre-sorted within each lane; `selectPageChanges` sorts by rank alone and
    // relies on a stable sort to keep each lane's own magnitude order.
    candidates: [...collapses, ...declines, ...firstObserved],
    observedRows,
    previousObservedRows,
    pageFloorRows,
    pairedPageRows,
    // "Not applicable" says the property has nothing this lane could ever
    // measure. A window whose rows were ALL unreadable has not established
    // that, so it reports the state that means "we could not look". A window
    // with readable rows did establish it, whatever else came back beside
    // them — saying "could not be read" there would be false about the rows
    // that were.
    lanes: {
      // Counted on the prior window, like the lane itself, and its readable
      // count is rows BOTH windows could be read for. Passing the prior row
      // count alone said the lane had looked at a page whose current side it
      // had just thrown away.
      page_impression_collapse: pageLaneState(
        collapseCapableRows,
        collapseReadableRows,
        unreadablePriorRows + currentUnusableRows + collapseBlockedRows,
      ),
      page_click_decline: pageLaneState(
        declineCapableRows,
        currentRows.length,
        unreadableCurrentRows + priorUnusableRows,
      ),
      page_first_observed: pageLaneState(
        firstObservedCapableRows,
        currentRows.length,
        unreadableCurrentRows + priorUnusableRows + absenceBlockedRows,
      ),
    },
    // Both lanes carry the unreadable rows in `notEvaluated`, which is what
    // `pageLaneRows` produces for them: they are in `observedRows` and in
    // neither capability count.
    byLane: {
      page_impression_collapse: pageLaneRows(
        previousObservedRows,
        collapseCapableRows,
        collapses.length,
      ),
      page_click_decline: pageLaneRows(
        observedRows,
        declineCapableRows,
        declines.length,
      ),
      page_first_observed: pageLaneRows(
        observedRows,
        firstObservedCapableRows,
        firstObserved.length,
      ),
    },
    unreadableCurrentRows,
  };
}

/**
 * Why a page named by a query change is still reported.
 *
 * It was suppressed for a while, on the theory that one URL should occupy one
 * row. But the two rows do not measure the same thing: the query row is one
 * query on that page, the page row is every query on it including the ones
 * Search Console anonymized, and they can move in opposite directions. Hiding
 * the second behind the first is the population substitution this tool exists
 * to refuse — and a count saying "one candidate was suppressed" preserves the
 * cardinality, not the measurement. Both are shown, each labelled with its own
 * scope.
 */
function selectPageChanges(
  candidates: readonly PageCandidate[],
  budget: number,
): {
  readonly changes: readonly DailyBriefingPageChange[];
  readonly actions: readonly DailyBriefingPageAction[];
  readonly eligible: number;
} {
  const ranked = [...candidates].sort(
    (a, b) => PAGE_KIND_RANK[a.change.kind] - PAGE_KIND_RANK[b.change.kind],
  );

  const seen = new Set<string>();
  const eligible: DailyBriefingPageChange[] = [];
  for (const candidate of ranked) {
    const page = candidate.change.page;
    // Only against itself: one page cannot be reported by both page lanes at
    // once, because the second would restate the first about the same rows.
    if (seen.has(page)) continue;
    seen.add(page);
    eligible.push(candidate.change);
  }

  const changes = eligible.slice(0, Math.max(0, budget));
  return {
    changes,
    // Every page change carries its page by construction, so unlike the query
    // lanes there is no withheld-attribution case to fall through here.
    actions: changes.map((change) => ({
      kind: change.kind,
      destination: PAGE_DESTINATIONS[change.kind],
      page: change.page,
    })),
    eligible: eligible.length,
  };
}

/** Bands where opening the page today can still change the outcome. */
const CHECKABLE_BANDS: readonly DailyBriefingObservationBand[] = [
  "page_one",
  "near_page_one",
];

/**
 * Turn the rows the page already shows into things to do with them.
 *
 * A check is not a weak action. An action says "this changed, here is the
 * evidence"; a check says "nothing here is known to have changed, and this is
 * still where the property stands today". Only the second is available when no
 * lane could measure a change, and offering it is what stops the page from
 * listing rows it called worth looking at directly above a heading that says
 * nothing is worth doing.
 *
 * Drawn from the displayed watchlist rather than the full candidate set on
 * purpose: a check pointing at a row the reader cannot see is one they cannot
 * evaluate.
 */
/**
 * Why no page-dimension result is consulted here.
 *
 * A check is a statement about one query: nothing is known to have changed for
 * it, and this is where it currently sits. A page-level decline on the same
 * URL is a statement about every query on that page. Both can be true at once,
 * and letting the second delete the first is one population deciding the
 * other's output — the substitution this tool exists to refuse. The copy names
 * the query scope so the two cannot be read as contradicting.
 *
 * A query that already carries an action cannot appear here at all: the
 * watchlist this reads is built with those queries already excluded.
 */
/**
 * Pages shown often enough that drawing no clicks is worth looking at.
 *
 * Measured against the property's own rate, never an industry curve. The
 * threshold cannot be a fixed impression count because what makes zero clicks
 * surprising is how many clicks the property itself would have produced from
 * that many impressions, and that varies by more than an order of magnitude
 * between properties.
 *
 * Restricted to the top position band. A page averaging position forty draws
 * no clicks because almost nobody sees it, and "go and look at how this result
 * appears" is not a thing anyone can act on for a result that is not on the
 * page being looked at.
 *
 * Pages already carrying a page action are left out. That is the same rule
 * `selectPageChanges` applies inside itself — one page, one row — and not the
 * cross-population substitution this tool refuses: both statements here are
 * about the same pages in the same window, so the second would restate the
 * first about the same rows.
 */
function pageChecksFor({
  brandTermsConfirmed,
  brandTerms,
  currentEvidence,
  actionedPages,
}: {
  readonly brandTermsConfirmed: boolean;
  readonly brandTerms: readonly string[];
  readonly currentEvidence: DailyBriefingQueryEvidence | null;
  readonly actionedPages: ReadonlySet<string>;
}): DailyBriefingPageChecks {
  const empty = (
    evidence: DailyBriefingPageChecks["evidence"],
    blockers: readonly DailyBriefingPageCheckBlocker[],
  ): DailyBriefingPageChecks => ({
    evidence,
    baseline: null,
    blockers,
    items: [],
    examinedRows: null,
  });

  if (pageRowsState(currentEvidence) !== "observed") {
    // Only the current window is needed — this is a statement about now — so
    // an unread prior window does not reach here.
    return empty("unavailable", []);
  }

  const blockers: DailyBriefingPageCheckBlocker[] = [];
  if (!brandTermsConfirmed) blockers.push("brand_terms_not_confirmed");
  const totals = currentEvidence?.propertyTotals ?? null;
  if (totals === null) blockers.push("property_totals_unavailable");
  else if (totals.responseAggregationType !== PAGE_AGGREGATION_BASIS) {
    // A quotient of two differently aggregated measurements is a defect, not
    // an approximation. Search Console reports the basis it actually used,
    // which is not always the one that was asked for.
    blockers.push("aggregation_basis_mismatch");
  }
  if (blockers.length > 0 || totals === null) {
    return empty("unavailable", blockers);
  }

  // Brand rows are subtracted from the property totals rather than summed on
  // their own, so the anonymized long tail stays in the denominator where it
  // belongs. Only the brand rows Search Console returned can be removed; any
  // that were anonymized stay in, along with their clicks. Brand queries are a
  // property's highest-volume queries and are the last to be withheld, so what
  // survives here is small — and it moves the rate up, which makes this gate
  // harder to pass rather than easier.
  const brandRows = splitBrandQueries(
    validQueryRows(currentEvidence?.queryRead?.rows ?? []),
    brandTerms,
  ).brand;
  let brandImpressions = 0;
  let brandClicks = 0;
  for (const row of brandRows) {
    brandImpressions += row.impressions;
    brandClicks += row.clicks;
  }
  const impressions = totals.impressions - brandImpressions;
  const clicks = totals.clicks - brandClicks;
  // Positive assertions, so a NaN fails them. A negative remainder means the
  // two reads disagree about the same window, which is not a rate.
  if (
    !(Number.isFinite(impressions) && impressions > 0) ||
    !(Number.isFinite(clicks) && clicks >= 0)
  ) {
    return empty("unavailable", ["no_property_impressions"]);
  }

  const baseline: DailyBriefingPageCheckBaseline = {
    ctr: clicks / impressions,
    impressions,
    clicks,
    brandQueriesExcluded: brandRows.length,
  };

  const rows = validPageRows(currentEvidence?.pageRead?.rows ?? []).rows;
  const items: DailyBriefingPageCheck[] = [];
  for (const row of rows) {
    if (actionedPages.has(row.page)) continue;
    if (row.clicks !== 0) continue;
    if (
      !Number.isFinite(row.position) ||
      row.position <= 0 ||
      row.position > BRIEFING_TOP_BAND_MAX_POSITION
    ) {
      continue;
    }
    const expectedClicks = row.impressions * baseline.ctr;
    if (
      !Number.isFinite(expectedClicks) ||
      expectedClicks < BRIEFING_ZERO_CLICK_MIN_EXPECTED_CLICKS
    ) {
      continue;
    }
    items.push({
      page: row.page,
      impressions: row.impressions,
      position: row.position,
      expectedClicks,
      destination: "on-page-seo-check",
    });
  }
  items.sort(
    (a, b) => b.expectedClicks - a.expectedClicks || a.page.localeCompare(b.page),
  );

  return {
    evidence: "observed",
    baseline,
    blockers: [],
    items,
    examinedRows: rows.length,
  };
}

function suggestedChecksFor(
  watchlist: DailyBriefingQueryWatchlist,
): DailyBriefingSuggestedChecks {
  // Partial is not observed. The watchlist itself withholds its counts when
  // the rows were only a prefix, and a zero here would claim we examined every
  // displayed row and found none un-checkable — on a run that displayed none.
  if (watchlist.evidence !== "observed") {
    return { evidence: watchlist.evidence, items: [], notCheckable: null };
  }

  const items: DailyBriefingSuggestedCheck[] = [];
  let notCheckable = 0;
  for (const item of watchlist.items) {
    const page = item.page;
    if (page === null || !CHECKABLE_BANDS.includes(item.band)) {
      notCheckable += 1;
      continue;
    }
    items.push({
      query: item.query,
      page,
      band: item.band,
      sampleKind: item.kind,
      destination: "on-page-seo-check",
    });
  }

  return { evidence: watchlist.evidence, items, notCheckable };
}

/**
 * What this property's own rows let each lane ask.
 *
 * The action-eligible query count cannot answer this. A query sitting at
 * average position ninety with a hundred impressions clears that floor and
 * still cannot produce one click signal, so counting it as capability is how
 * a briefing promises change detection it can never deliver.
 */
function laneCapabilityFor({
  brandTermsConfirmed,
  counts,
  evidence,
  pages,
}: {
  readonly brandTermsConfirmed: boolean;
  readonly counts: CapabilityCounts | null;
  readonly evidence: DailyBriefingLaneCapability["evidence"];
  // Read independently of the query counts: the query rows can be unusable
  // while the page rows are fine, and on a small property that is the case
  // that matters most.
  readonly pages: PageCandidateSet | null;
}): DailyBriefingLaneCapability {
  if (counts === null) {
    const unavailable: DailyBriefingLaneState = "unavailable";
    return {
      evidence,
      clickDeclineCapableQueries: null,
      ctrOpportunityCapableQueries: null,
      strictPairedPositionQueries: null,
      provisionalPairedPositionQueries: null,
      currentFloorOnlyQueries: null,
      ctrLane: {
        state: unavailable,
        blockers: brandTermsConfirmed ? [] : ["brand_terms_not_confirmed"],
        usableBaselineBands: null,
      },
      lanes: {
        click_opportunity: unavailable,
        stable_position_click_decline: unavailable,
        average_position_crossed_page_one_band: unavailable,
        actionable_position_decline: unavailable,
        first_observed: unavailable,
      },
      pairedPageRows: pages?.pairedPageRows ?? null,
      pageFloorRows: pages?.pageFloorRows ?? null,
      pageLanes: pages?.lanes ?? {
        page_impression_collapse: unavailable,
        page_click_decline: unavailable,
        page_first_observed: unavailable,
      },
    };
  }

  return {
    evidence,
    clickDeclineCapableQueries: counts.clickDeclineCapableQueries,
    ctrOpportunityCapableQueries: counts.ctrOpportunityCapableQueries,
    strictPairedPositionQueries: counts.strictPairedPositionQueries,
    provisionalPairedPositionQueries: counts.provisionalPairedPositionQueries,
    currentFloorOnlyQueries: counts.currentFloorOnlyQueries,
    ctrLane: counts.ctrLane,
    lanes: counts.lanes,
    pairedPageRows: pages?.pairedPageRows ?? null,
    pageFloorRows: pages?.pageFloorRows ?? null,
    pageLanes: pages?.lanes ?? {
      page_impression_collapse: "unavailable",
      page_click_decline: "unavailable",
      page_first_observed: "unavailable",
    },
  };
}

const STRICT_CHANGE_LANES: readonly DailyBriefingChangeKind[] = [
  "click_opportunity",
  "stable_position_click_decline",
  "average_position_crossed_page_one_band",
  "actionable_position_decline",
  "first_observed",
];

/**
 * The briefing this property's evidence supports, stated from that evidence.
 *
 * The earlier two-way split asked only whether a click-driven lane had input,
 * so a run where no position lane could be evaluated either still announced
 * itself as position-first. Every branch here is answerable from `lanes` and
 * the paired counts beside it.
 */
function modeFor(
  counts: CapabilityCounts | null,
  pages: PageCandidateSet | null,
): DailyBriefingMode {
  // Asked before the query counts: a property whose queries are all anonymized
  // can still have a page lane that was genuinely evaluated, and reporting that
  // run as `unavailable` would deny a detection the tool just performed.
  if (
    pages !== null &&
    PAGE_CHANGE_LANES.some((lane) => pageLaneSettledRows(pages.byLane[lane]))
  ) {
    return "change_detection";
  }
  if (counts === null) return "unavailable";
  if (STRICT_CHANGE_LANES.some((lane) => counts.lanes[lane] === "evaluated")) {
    return "change_detection";
  }
  if (counts.provisionalPairedPositionQueries > 0) return "position_observation";
  return "current_position_watchlist";
}

export function buildDailyBriefing(
  input: BuildDailyBriefingInput,
): DailyBriefingEnvelope {
  const windows = dailyBriefingWindowsFor(input.now);
  const normalized = normalizedDateRows(input, windows);
  const latest = kpisForDates(normalized.rows, [windows.latestDay.endDate]);
  const previousDay = kpisForDates(normalized.rows, [
    windows.previousDay.endDate,
  ]);
  const currentWeek = kpisForDates(
    normalized.rows,
    datesIn(windows.current7Days),
  );
  const previousWeek = kpisForDates(
    normalized.rows,
    datesIn(windows.previous7Days),
  );
  const day = compareKpis(latest, previousDay);
  const weekly = compareKpis(currentWeek, previousWeek);
  const trend = {
    daily: trendSeriesFor(input.trend?.daily, "daily"),
    hourly: trendSeriesFor(input.trend?.hourly, "hourly"),
  };
  const currentEvidence = input.currentQueryEvidence ?? null;
  const previousEvidence = input.previousQueryEvidence ?? null;
  const currentRowsState = queryRowsState(currentEvidence);
  const previousRowsState = queryRowsState(previousEvidence);
  const comparableQueryWindows = queryWindowsComparable(
    currentEvidence,
    previousEvidence,
  );
  const funnelEvidence = signalFunnelEvidence(
    currentEvidence,
    previousEvidence,
  );
  const coverage: DailyBriefingCoverage = {
    current: coverageOf(currentEvidence),
    previous: coverageOf(previousEvidence),
  };
  const currentAnonymization = anonymizationOf(currentEvidence);
  const previousAnonymization = anonymizationOf(previousEvidence);
  const limitations = new Set<DailyBriefingLimitationCode>();

  if (day.evidence === "unavailable" || weekly.evidence === "unavailable") {
    limitations.add("daily_data_incomplete");
  }
  if (normalized.omitted) limitations.add("daily_rows_omitted");
  if (
    currentRowsState === "unavailable" ||
    previousRowsState === "unavailable" ||
    !comparableQueryWindows
  ) {
    limitations.add("query_evidence_unavailable");
  }
  // A missing page attachment no longer deletes query signals, so it is
  // reported as what it now costs: page attribution and the handoff.
  if (
    currentRowsState !== "unavailable" &&
    previousRowsState !== "unavailable" &&
    (!pageAttributionUsable(currentEvidence) ||
      !pageAttributionUsable(previousEvidence))
  ) {
    limitations.add("query_page_coverage_below_floor");
  }
  if (
    (currentEvidence !== null && currentEvidence.propertyTotals === null) ||
    (previousEvidence !== null && previousEvidence.propertyTotals === null)
  ) {
    limitations.add("property_totals_unavailable");
  }
  if (currentRowsState === "partial" || previousRowsState === "partial") {
    limitations.add("query_evidence_partial");
  }
  if (currentAnonymization.limitation !== null) {
    limitations.add(currentAnonymization.limitation);
  }
  if (previousAnonymization.limitation !== null) {
    limitations.add(previousAnonymization.limitation);
  }
  if (
    [currentEvidence, previousEvidence].some(
      (evidence) =>
        evidence?.queryRead !== null &&
        evidence?.queryRead !== undefined &&
        evidence.queryPageRead !== null &&
        evidence.queryRead.responseAggregationType !== null &&
        evidence.queryPageRead.responseAggregationType !== null &&
        evidence.queryRead.responseAggregationType !==
          evidence.queryPageRead.responseAggregationType,
    )
  ) {
    limitations.add("aggregation_basis_mismatch");
  }
  if (
    currentEvidence?.queryRead !== null &&
    currentEvidence?.queryRead !== undefined &&
    previousEvidence?.queryRead !== null &&
    previousEvidence?.queryRead !== undefined &&
    !comparableQueryWindows
  ) {
    limitations.add("aggregation_basis_mismatch");
  }
  if (!input.brandTermsConfirmed) limitations.add("brand_terms_not_confirmed");

  let changes: readonly DailyBriefingChange[] = [];
  let actions: readonly DailyBriefingAction[] = [];
  let allProvisionalMoves: readonly DailyBriefingProvisionalMove[] = [];
  let rowAccounting: DailyBriefingRowAccounting = {
    evidence: funnelEvidence,
    observedRows: null,
    notSelectedVisibleRows: null,
    byLane: null,
  };
  let observedSignalCounts: Omit<
    DailyBriefingSignalFunnel,
    "evidence" | "selectedQueryChanges" | "propertyTrendShown"
  > | null = null;
  let capabilityCounts: CapabilityCounts | null = null;

  if (
    currentEvidence !== null &&
    previousEvidence !== null &&
    currentRowsState === "observed" &&
    previousRowsState === "observed" &&
    comparableQueryWindows
  ) {
    const candidateSet = candidatesFor(input, currentEvidence, previousEvidence);
    const selected = selectChanges(candidateSet.candidates, currentEvidence);
    changes = selected.changes;
    actions = selected.actions;
    allProvisionalMoves = candidateSet.provisionalMoves;
    rowAccounting = {
      evidence: "observed",
      observedRows: candidateSet.observedQueryRows,
      notSelectedVisibleRows: Math.max(
        0,
        new Set(candidateSet.candidates.map((candidate) => candidate.query))
          .size - changes.length,
      ),
      byLane: candidateSet.byLane,
    };
    observedSignalCounts = {
      observedQueryRows: candidateSet.observedQueryRows,
      observationCandidates: candidateSet.observationCandidates,
      actionEligibleQueries: candidateSet.actionEligibleQueries,
      ctrBaselineRows: candidateSet.ctrBaselineRows,
      clickOpportunityCandidates: candidateSet.clickOpportunityCandidates,
      stableDeclineCandidates: candidateSet.stableDeclineCandidates,
      pageOneBandCandidates: candidateSet.pageOneBandCandidates,
      positionDeclineCandidates: candidateSet.positionDeclineCandidates,
      firstObservedCandidates: candidateSet.firstObservedCandidates,
      provisionalMoveCandidates: candidateSet.provisionalMoves.length,
      pageAttributionWithheld:
        candidateSet.pageAttributionWithheld + selected.pageAttributionWithheld,
    };
    capabilityCounts = {
      clickDeclineCapableQueries: candidateSet.clickDeclineCapableQueries,
      ctrOpportunityCapableQueries: candidateSet.ctrOpportunityCapableQueries,
      strictPairedPositionQueries: candidateSet.strictPairedPositionQueries,
      provisionalPairedPositionQueries:
        candidateSet.provisionalPairedPositionQueries,
      currentFloorOnlyQueries: candidateSet.currentFloorOnlyQueries,
      ctrLane: candidateSet.ctrLane,
      lanes: candidateSet.lanes,
    };
    if (
      candidateSet.pageAttributionWithheld > 0 ||
      selected.pageAttributionWithheld > 0
    ) {
      limitations.add("query_page_coverage_below_floor");
    }
  }

  // The trend belongs to the property, not to whatever the query lanes found.
  // Gating it on an empty change list made a query signal delete the only
  // site-wide fact in the briefing.
  const propertyTrend = propertyTrendFor(weekly);
  if (propertyTrend.change !== null && propertyTrend.action === null) {
    limitations.add("property_change_inside_noise_floor");
  }

  // Read independently of the query evidence above. The two dimensions fail
  // separately, and on a property whose queries are mostly anonymized the page
  // rows are the only place the clicks are visible at all.
  const pageCandidateSet = pageCandidatesFor(currentEvidence, previousEvidence);
  if (pageCandidateSet === null) limitations.add("page_evidence_unavailable");

  const laneCapability = laneCapabilityFor({
    counts: capabilityCounts,
    evidence: funnelEvidence,
    brandTermsConfirmed: input.brandTermsConfirmed,
    pages: pageCandidateSet,
  });
  const mode = modeFor(capabilityCounts, pageCandidateSet);

  // The page lanes have their own budget, so no count of query candidates can
  // decide whether a page measurement is shown.
  const pageSelection =
    pageCandidateSet === null
      ? { changes: [], actions: [], eligible: 0 }
      : selectPageChanges(pageCandidateSet.candidates, DAILY_BRIEFING_PAGE_LIMIT);
  const pageChanges: readonly DailyBriefingPageChange[] = pageSelection.changes;
  const pageActions: readonly DailyBriefingPageAction[] = pageSelection.actions;
  const pageAccounting: DailyBriefingPageAccounting =
    pageCandidateSet === null
      ? {
          // Unavailable dominates partial. A comparison needs both windows,
          // so one of them missing entirely is not "partly read" however
          // complete the other one is. Reaching here means at least one window
          // is not observed, so the remaining case really is a prefix.
          evidence:
            pageRowsState(currentEvidence) === "unavailable" ||
            pageRowsState(previousEvidence) === "unavailable"
              ? "unavailable"
              : "partial",
          observedRows: null,
          previousObservedRows: null,
          notSelectedVisibleRows: null,
          unreadableRows: null,
          byLane: null,
        }
      : {
          evidence: "observed",
          observedRows: pageCandidateSet.observedRows,
          previousObservedRows: pageCandidateSet.previousObservedRows,
          notSelectedVisibleRows: Math.max(
            0,
            pageSelection.eligible - pageChanges.length,
          ),
          unreadableRows: pageCandidateSet.unreadableCurrentRows,
          byLane: pageCandidateSet.byLane,
        };

  // What the query and page changes left. A provisional move names a movement,
  // so it outranks a row that only names a position, and the watchlist takes
  // whatever survives both.
  const provisionalBudget = Math.max(
    0,
    DAILY_BRIEFING_ACTION_LIMIT - changes.length,
  );
  // A query the page is about to report as a change is not also provisional:
  // the same query would hold an action while the provisional note under it
  // promised there was none. Filtered against the *selected* changes rather
  // than the candidate set, so a candidate that lost the display budget keeps
  // its provisional row instead of falling out of both lists.
  const selectedChangeQueries = new Set(changes.map((change) => change.query));
  const eligibleProvisionalMoves = allProvisionalMoves.filter(
    (move) => !selectedChangeQueries.has(move.query),
  );
  const provisionalMoves: DailyBriefingProvisionalMoves = {
    evidence: funnelEvidence,
    items: eligibleProvisionalMoves.slice(0, provisionalBudget),
    candidates:
      funnelEvidence === "observed" ? eligibleProvisionalMoves.length : null,
    priorWindowImpressionRange: [
      BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS,
      BRIEFING_MIN_ROW_IMPRESSIONS - 1,
    ],
  };
  const queryWatchlist = queryWatchlistFor({
    budget: provisionalBudget - provisionalMoves.items.length,
    currentEvidence,
    evidence: funnelEvidence,
    excludedQueries: new Set([
      ...selectedChangeQueries,
      ...eligibleProvisionalMoves.map((move) => move.query),
    ]),
    previousEvidence,
  });
  // Built from the watchlist that was just displayed, so every check points at
  // a row the reader can see.
  const suggestedChecks = suggestedChecksFor(queryWatchlist);
  const pageChecks = pageChecksFor({
    brandTermsConfirmed: input.brandTermsConfirmed,
    brandTerms: input.brandTerms,
    currentEvidence,
    actionedPages: new Set(pageActions.map((action) => action.page)),
  });
  const signalFunnel: DailyBriefingSignalFunnel =
    observedSignalCounts === null
      ? {
          evidence: funnelEvidence,
          observedQueryRows:
            funnelEvidence === "partial"
              ? validQueryRows(currentEvidence?.queryRead?.rows ?? []).length
              : null,
          observationCandidates: null,
          actionEligibleQueries: null,
          ctrBaselineRows: null,
          clickOpportunityCandidates: null,
          stableDeclineCandidates: null,
          pageOneBandCandidates: null,
          positionDeclineCandidates: null,
          firstObservedCandidates: null,
          provisionalMoveCandidates: null,
          pageAttributionWithheld: null,
          selectedQueryChanges: changes.length,
          propertyTrendShown: propertyTrend.change !== null,
        }
      : {
          evidence: "observed",
          ...observedSignalCounts,
          selectedQueryChanges: changes.length,
          propertyTrendShown: propertyTrend.change !== null,
        };

  return createPublicToolResult(
    {
      tool: "daily_search_briefing",
      schemaVersion: DAILY_BRIEFING_SCHEMA_VERSION,
      scope: "property",
      completedAt: input.now.toISOString(),
    },
    {
      windows,
      day,
      weekly,
      trend,
      mode,
      // A daily cadence is a claim that each morning brings something new to
      // detect, and only the click-driven lanes move on that timescale: an
      // average position is a week's worth of impressions weighted together.
      // Reading this off `mode` was safe while mode meant "a click lane has
      // input"; now that mode is broader, the click lanes are asked directly.
      cadence:
        (laneCapability.lanes.click_opportunity !== "evaluated" &&
          laneCapability.lanes.stable_position_click_decline !== "evaluated" &&
          !pageLaneSettledRows(pageAccounting.byLane?.page_click_decline)) ||
        day.evidence === "unavailable" ||
        currentWeek === null ||
        currentWeek.impressions < DAILY_CADENCE_MIN_IMPRESSIONS
          ? "weekly"
          : "daily",
      laneCapability,
      changes,
      actions,
      pageChanges,
      pageActions,
      propertyTrend,
      signalFunnel,
      queryWatchlist,
      provisionalMoves,
      rowAccounting,
      pageAccounting,
      pageChecks,
      suggestedChecks,
      coverage,
      anonymization: {
        current: currentAnonymization.value,
        previous: previousAnonymization.value,
      },
      limitations: [...limitations],
    },
  );
}
