// @input  -- final Search Console day rows and optional query evidence for two weeks
// @output -- one deterministic, evidence-bounded daily search briefing envelope
// @pos    -- pure core; network, auth, quota and persistence stay outside this module

import { createPublicToolResult } from "../contract.ts";
import {
  MIN_DIMENSION_COVERAGE,
  queryPageCoverage,
  type GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import { latestFinalWindow, shiftDate } from "../gsc-analytics/window.ts";
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
  DailyBriefingLimitationCode,
  DailyBriefingMode,
  DailyBriefingObservationBand,
  DailyBriefingPropertyChangeKind,
  DailyBriefingPropertyNoiseFloor,
  DailyBriefingPropertyTrend,
  DailyBriefingQueryEvidence,
  DailyBriefingQueryObservation,
  DailyBriefingQueryWatchlist,
  DailyBriefingSignalFunnel,
  DailyBriefingWindowCoverage,
  DailyBriefingWindows,
} from "./types.ts";

export const DAILY_BRIEFING_SCHEMA_VERSION = "daily_search_briefing.v2";
export const BRIEFING_WINDOW_DAYS = 7;
export const DAILY_CADENCE_MIN_IMPRESSIONS = 1_000;
export const BRIEFING_MIN_ROW_IMPRESSIONS = 100;
export const BRIEFING_MATERIAL_CHANGE_RATIO = 0.15;
export const BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE = 3;
export const BRIEFING_STABLE_POSITION_DELTA = 0.5;
export const DAILY_BRIEFING_ACTION_LIMIT = 3;
export const BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS = 1_000;
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

const BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS = 50;
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
  return rows.filter(
    (row) =>
      row.query.trim() !== "" &&
      row.page.trim() !== "" &&
      isMetricRowValid(row),
  );
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
  // Page attribution crosses the two reads, so it stays invalid when Search
  // Console aggregated them differently, even though each read is internally
  // fine and the query-level signal survives.
  if (!queryEvidenceBasisComparable(evidence)) return null;
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
  // Page attribution crosses the two reads, so it stays invalid when Search
  // Console aggregated them differently, even though each read is internally
  // fine and the query-level signal survives.
  if (!queryEvidenceBasisComparable(evidence)) return null;
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
  readonly pageAttributionWithheld: number;
  readonly clickDeclineCapableQueries: number;
  readonly ctrOpportunityCapableQueries: number;
  readonly positionCapableQueries: number;
  readonly ctrLane: DailyBriefingCtrLane;
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
  for (const row of table.rows) {
    if (row.observedCtr === null || !(row.baselineCtr > 0)) continue;
    const shortfallRatio = (row.baselineCtr - row.observedCtr) / row.baselineCtr;
    if (
      row.clickGap < BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE ||
      shortfallRatio < BRIEFING_MATERIAL_CHANGE_RATIO
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
  let observationCandidates = 0;
  let actionEligibleQueries = 0;
  let clickDeclineCapableQueries = 0;
  let positionCapableQueries = 0;
  for (const current of currentRows) {
    if (
      current.impressions >= BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS &&
      current.impressions < BRIEFING_MIN_ROW_IMPRESSIONS
    ) {
      observationCandidates += 1;
    }
    if (current.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS) {
      actionEligibleQueries += 1;
    }
    const previous = previousByQuery.get(current.query);
    if (
      previous === undefined ||
      current.impressions < BRIEFING_MIN_ROW_IMPRESSIONS ||
      previous.impressions < BRIEFING_MIN_ROW_IMPRESSIONS
    ) {
      continue;
    }

    // Both windows carry a comparable sample, so this query can be asked every
    // paired question below.
    if (previous.clicks >= BRIEFING_CLICK_DECLINE_MIN_PREVIOUS_CLICKS) {
      clickDeclineCapableQueries += 1;
    }
    if (
      withinActionableBand(current.position) ||
      withinActionableBand(previous.position)
    ) {
      positionCapableQueries += 1;
    }

    const clickChange = current.clicks - previous.clicks;
    const clickChangeRatio = ratio(previous.clicks, current.clicks);
    const positionDelta = current.position - previous.position;

    if (
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
      continue;
    }

    // Average position, not rank: this says the query's impression-weighted
    // position moved into the top band, never that the page holds place N.
    if (
      Number.isFinite(current.position) &&
      Number.isFinite(previous.position) &&
      previous.position > BRIEFING_TOP_BAND_MAX_POSITION &&
      current.position <= BRIEFING_TOP_BAND_MAX_POSITION &&
      current.position > 0 &&
      previous.position - current.position >= BRIEFING_TOP_BAND_MIN_IMPROVEMENT
    ) {
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
      continue;
    }

    // A decline outside the actionable band is real and useless: nothing done
    // to the page this week decides whether position eighty-six earns a click.
    if (
      positionDelta >= BRIEFING_POSITION_DECLINE_MIN_DELTA &&
      (withinActionableBand(current.position) ||
        withinActionableBand(previous.position))
    ) {
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

  const pairBasisComparable =
    queryEvidenceBasisComparable(currentEvidence) &&
    queryEvidenceBasisComparable(previousEvidence);
  const currentQueryPages = pairBasisComparable
    ? validQueryPageRows(currentEvidence.queryPageRead?.rows ?? [])
    : [];
  const previousQueryPages = pairBasisComparable
    ? validQueryPageRows(previousEvidence.queryPageRead?.rows ?? [])
    : [];
  const currentCoverage = queryPageCoverage(currentRows, currentQueryPages);
  const previousCoverage = queryPageCoverage(previousRows, previousQueryPages);
  const previousPairs = new Set(
    previousQueryPages.map((row) => `${row.query}\u0000${row.page}`),
  );
  const firstObserved: ChangeCandidate[] = [];
  const pageAttributionWithheld = new Set<string>();

  for (const pair of currentQueryPages) {
    const current = currentByQuery.get(pair.query);
    if (
      current === undefined ||
      current.impressions < BRIEFING_MIN_ROW_IMPRESSIONS ||
      pair.impressions < BRIEFING_MIN_ROW_IMPRESSIONS ||
      pair.position < FIRST_OBSERVED_MIN_POSITION ||
      pair.position >= FIRST_OBSERVED_MAX_POSITION ||
      previousPairs.has(`${pair.query}\u0000${pair.page}`)
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
    const previousCoverageSufficient =
      previous === undefined ||
      (previous.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS &&
        previousCoverageRatio !== null &&
        previousCoverageRatio !== undefined &&
        previousCoverageRatio >= MIN_DIMENSION_COVERAGE);
    if (!currentCoverageSufficient || !previousCoverageSufficient) {
      pageAttributionWithheld.add(`${pair.query}\u0000${pair.page}`);
      continue;
    }

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

  return {
    currentRows,
    candidates: [
      ...opportunities,
      ...declines,
      ...pageOneCrossings,
      ...positionDeclines,
      ...firstObserved,
    ],
    observedQueryRows: currentRows.length,
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
    pageAttributionWithheld: pageAttributionWithheld.size,
    clickDeclineCapableQueries,
    ctrOpportunityCapableQueries: table.rows.length,
    positionCapableQueries,
    ctrLane: ctrLaneFor(
      input.brandTermsConfirmed,
      curve,
      table.rows.length,
    ),
  };
}

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

function queryWatchlistFor({
  changes,
  currentEvidence,
  evidence,
  previousEvidence,
}: {
  readonly changes: readonly DailyBriefingChange[];
  readonly currentEvidence: DailyBriefingQueryEvidence | null;
  readonly evidence: DailyBriefingQueryWatchlist["evidence"];
  readonly previousEvidence: DailyBriefingQueryEvidence | null;
}): DailyBriefingQueryWatchlist {
  if (
    evidence !== "observed" ||
    currentEvidence?.queryRead === null ||
    currentEvidence?.queryRead === undefined ||
    previousEvidence?.queryRead === null ||
    previousEvidence?.queryRead === undefined
  ) {
    return { evidence, items: [] };
  }

  const remaining = Math.max(0, DAILY_BRIEFING_ACTION_LIMIT - changes.length);
  if (remaining === 0) return { evidence, items: [] };

  const selectedQueries = new Set(changes.map((change) => change.query));
  const previousByQuery = mapByQuery(
    validQueryRows(previousEvidence.queryRead.rows),
  );
  const observations = validQueryRows(currentEvidence.queryRead.rows)
    .flatMap<DailyBriefingQueryObservation>((current) => {
      if (
        selectedQueries.has(current.query) ||
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
      const previous = previousByQuery.get(current.query) ?? null;
      return [
        {
          kind,
          band: observationBandFor(current.position),
          query: current.query,
          page,
          pageEvidence: page === null ? "unavailable" : "observed",
          current,
          previous,
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
    })
    .slice(0, remaining);

  return { evidence, items: observations };
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
  basis: DailyBriefingPropertyNoiseFloor["basis"],
  previousValue: number,
  observedChange: number,
): DailyBriefingPropertyNoiseFloor {
  const minimumForAction =
    Number.isFinite(previousValue) && previousValue > 0
      ? BRIEFING_PROPERTY_NOISE_SIGMA * Math.sqrt(previousValue)
      : Number.POSITIVE_INFINITY;
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
  if (
    weekly.evidence !== "observed" ||
    weekly.current === null ||
    weekly.previous === null ||
    weekly.current.impressions < BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS ||
    weekly.previous.impressions < BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS
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

  let kind: DailyBriefingPropertyChangeKind | null = null;
  let destination: "traffic-drop-diagnosis" | "seo-quick-wins" | null = null;
  let noiseFloor: DailyBriefingPropertyNoiseFloor | null = null;

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

  return {
    change: {
      kind,
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
}: {
  readonly brandTermsConfirmed: boolean;
  readonly counts: {
    readonly clickDeclineCapableQueries: number;
    readonly ctrOpportunityCapableQueries: number;
    readonly positionCapableQueries: number;
    readonly ctrLane: DailyBriefingCtrLane;
  } | null;
  readonly evidence: DailyBriefingLaneCapability["evidence"];
}): DailyBriefingLaneCapability {
  if (counts === null) {
    const unavailable: DailyBriefingLaneState = "unavailable";
    return {
      evidence,
      clickDeclineCapableQueries: null,
      ctrOpportunityCapableQueries: null,
      positionCapableQueries: null,
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
    };
  }

  const clickLane: DailyBriefingLaneState =
    counts.clickDeclineCapableQueries > 0 ? "evaluated" : "not_applicable";
  const positionLane: DailyBriefingLaneState =
    counts.positionCapableQueries > 0 ? "evaluated" : "not_applicable";

  return {
    evidence,
    clickDeclineCapableQueries: counts.clickDeclineCapableQueries,
    ctrOpportunityCapableQueries: counts.ctrOpportunityCapableQueries,
    positionCapableQueries: counts.positionCapableQueries,
    ctrLane: counts.ctrLane,
    lanes: {
      click_opportunity: counts.ctrLane.state,
      stable_position_click_decline: clickLane,
      average_position_crossed_page_one_band: positionLane,
      actionable_position_decline: positionLane,
      first_observed: "evaluated",
    },
  };
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
  const currentEvidence = input.currentQueryEvidence ?? null;
  const previousEvidence = input.previousQueryEvidence ?? null;
  const currentState = queryEvidenceState(currentEvidence);
  const previousState = queryEvidenceState(previousEvidence);
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
    (currentState === "unavailable" || previousState === "unavailable")
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
  let filteredObservedRows = 0;
  let countComplete = false;
  let observedSignalCounts: Omit<
    DailyBriefingSignalFunnel,
    "evidence" | "selectedQueryChanges" | "propertyTrendShown"
  > | null = null;
  let capabilityCounts: {
    readonly clickDeclineCapableQueries: number;
    readonly ctrOpportunityCapableQueries: number;
    readonly positionCapableQueries: number;
    readonly ctrLane: DailyBriefingCtrLane;
  } | null = null;

  if (
    currentEvidence !== null &&
    previousEvidence !== null &&
    currentRowsState === "observed" &&
    previousRowsState === "observed" &&
    comparableQueryWindows
  ) {
    const candidateSet = candidatesFor(input, currentEvidence, previousEvidence);
    if (input.brandTermsConfirmed) {
      const candidateQueries = new Set(
        candidateSet.candidates.map((candidate) => candidate.query),
      );
      filteredObservedRows = Math.max(
        0,
        candidateSet.currentRows.length - candidateQueries.size,
      );
      countComplete = true;
    }
    const selected = selectChanges(candidateSet.candidates, currentEvidence);
    changes = selected.changes;
    actions = selected.actions;
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
      pageAttributionWithheld:
        candidateSet.pageAttributionWithheld + selected.pageAttributionWithheld,
    };
    capabilityCounts = {
      clickDeclineCapableQueries: candidateSet.clickDeclineCapableQueries,
      ctrOpportunityCapableQueries: candidateSet.ctrOpportunityCapableQueries,
      positionCapableQueries: candidateSet.positionCapableQueries,
      ctrLane: candidateSet.ctrLane,
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

  const laneCapability = laneCapabilityFor({
    counts: capabilityCounts,
    evidence: funnelEvidence,
    brandTermsConfirmed: input.brandTermsConfirmed,
  });
  const mode: DailyBriefingMode =
    capabilityCounts !== null &&
    capabilityCounts.clickDeclineCapableQueries === 0 &&
    capabilityCounts.ctrOpportunityCapableQueries === 0
      ? "position_first"
      : "change_detection";

  const queryWatchlist = queryWatchlistFor({
    changes,
    currentEvidence,
    evidence: funnelEvidence,
    previousEvidence,
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
      mode,
      // A property whose click lanes cannot be evaluated has nothing new to
      // detect each morning, so it is not offered a daily cadence.
      cadence:
        mode === "position_first" ||
        day.evidence === "unavailable" ||
        currentWeek === null ||
        currentWeek.impressions < DAILY_CADENCE_MIN_IMPRESSIONS
          ? "weekly"
          : "daily",
      laneCapability,
      changes,
      actions,
      propertyTrend,
      signalFunnel,
      queryWatchlist,
      filteredObservedRows,
      countComplete,
      coverage,
      anonymization: {
        current: currentAnonymization.value,
        previous: previousAnonymization.value,
      },
      limitations: [...limitations],
    },
  );
}
