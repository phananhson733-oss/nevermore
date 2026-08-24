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
import type { GscQueryRow } from "../site-baseline/types.ts";
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
  DailyBriefingLimitationCode,
  DailyBriefingPropertyChangeKind,
  DailyBriefingPropertyFallback,
  DailyBriefingQueryEvidence,
  DailyBriefingSignalFunnel,
  DailyBriefingWindowCoverage,
  DailyBriefingWindows,
} from "./types.ts";

export const DAILY_BRIEFING_SCHEMA_VERSION = "daily_search_briefing.v1";
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
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
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
  readonly rows: ReadonlyMap<string, BuildDailyBriefingInput["dateRows"][number]>;
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

function datesIn(window: { readonly startDate: string; readonly endDate: string }): string[] {
  const dates: string[] = [];
  for (let date = window.startDate; date <= window.endDate; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function ratio(before: number, after: number): number | null {
  if (!(Number.isFinite(before) && before > 0 && Number.isFinite(after))) return null;
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
  if (
    !queryEvidenceBasisComparable(current) ||
    !queryEvidenceBasisComparable(previous) ||
    !queryWindowsComparable(current, previous)
  ) {
    return "unavailable";
  }
  if (
    current?.queryRead?.paging.truncated === true ||
    current?.queryPageRead?.paging.truncated === true ||
    previous?.queryRead?.paging.truncated === true ||
    previous?.queryPageRead?.paging.truncated === true
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
      return value !== null && value !== undefined && value >= MIN_DIMENSION_COVERAGE;
    }).length,
    minimumQueryPageCoverage: MIN_DIMENSION_COVERAGE,
  };
}

interface AnonymizationResult {
  readonly value: DailyBriefingAnonymization;
  readonly limitation: "aggregation_basis_mismatch" | "anonymization_gap_uncomputable" | null;
}

function missingShare(total: number, observed: number): number | null {
  if (!(Number.isFinite(total) && total > 0 && Number.isFinite(observed))) return null;
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
  if (!aggregationBasesAgree(totals, evidence.queryRead.responseAggregationType)) {
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

  const missingImpressionShare = missingShare(totals.impressions, queryImpressions);
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

function mapByQuery(rows: readonly GscQueryRow[]): ReadonlyMap<string, GscQueryRow> {
  return new Map(rows.map((row) => [row.query, row]));
}

function pageForQuery(
  query: string,
  evidence: DailyBriefingQueryEvidence,
): string | null {
  if (evidence.queryRead === null || evidence.queryPageRead === null) return null;
  const queryPages = validQueryPageRows(evidence.queryPageRead.rows);
  const coverage = queryPageCoverage(
    validQueryRows(evidence.queryRead.rows),
    queryPages,
  ).get(query);
  if (coverage === null || coverage === undefined || coverage < MIN_DIMENSION_COVERAGE) {
    return null;
  }
  const rows = queryPages
    .filter(
      (row) =>
        row.query === query &&
        row.impressions >= BRIEFING_MIN_ROW_IMPRESSIONS,
    )
    .sort(
      (a, b) =>
        b.impressions - a.impressions || a.page.localeCompare(b.page),
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
  readonly firstObservedCandidates: number;
  readonly pageAttributionWithheld: number;
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
  let observationCandidates = 0;
  let actionEligibleQueries = 0;
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
    const clickChange = current.clicks - previous.clicks;
    const clickChangeRatio = ratio(previous.clicks, current.clicks);
    const positionDelta = current.position - previous.position;
    if (
      clickChange > -BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE ||
      clickChangeRatio === null ||
      clickChangeRatio > -BRIEFING_MATERIAL_CHANGE_RATIO ||
      Math.abs(positionDelta) > BRIEFING_STABLE_POSITION_DELTA
    ) {
      continue;
    }
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
  declines.sort((a, b) => b.order - a.order || a.query.localeCompare(b.query));

  const currentQueryPages = validQueryPageRows(
    currentEvidence.queryPageRead?.rows ?? [],
  );
  const previousQueryPages = validQueryPageRows(
    previousEvidence.queryPageRead?.rows ?? [],
  );
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
    candidates: [...opportunities, ...declines, ...firstObserved],
    observedQueryRows: currentRows.length,
    observationCandidates,
    actionEligibleQueries,
    ctrBaselineRows: input.brandTermsConfirmed ? table.rows.length : null,
    clickOpportunityCandidates: input.brandTermsConfirmed
      ? opportunities.length
      : null,
    stableDeclineCandidates: declines.length,
    firstObservedCandidates: firstObserved.length,
    pageAttributionWithheld: pageAttributionWithheld.size,
  };
}

const DESTINATIONS: Readonly<Record<DailyBriefingChangeKind, DailyBriefingAction["destination"]>> = {
  click_opportunity: "seo-quick-wins",
  stable_position_click_decline: "traffic-drop-diagnosis",
  first_observed: "on-page-seo-check",
};

function selectChanges(
  candidates: readonly ChangeCandidate[],
  currentEvidence: DailyBriefingQueryEvidence,
): {
  readonly changes: readonly DailyBriefingChange[];
  readonly actions: readonly DailyBriefingAction[];
  readonly pageAttributionWithheld: number;
} {
  const changes: DailyBriefingChange[] = [];
  const actions: DailyBriefingAction[] = [];
  const usedQueries = new Set<string>();
  const pageAttributionWithheld = new Set<string>();
  const kinds: readonly DailyBriefingChangeKind[] = [
    "click_opportunity",
    "stable_position_click_decline",
    "first_observed",
  ];

  for (const kind of kinds) {
    for (const candidate of candidates) {
      if (candidate.kind !== kind || usedQueries.has(candidate.query)) continue;
      const page = candidate.page ?? pageForQuery(candidate.query, currentEvidence);
      if (page === null) {
        pageAttributionWithheld.add(
          `${candidate.kind}\u0000${candidate.query}\u0000${candidate.page ?? ""}`,
        );
        continue;
      }
      usedQueries.add(candidate.query);
      changes.push({
        kind,
        evidence: kind === "first_observed" ? "not_observed" : "observed",
        query: candidate.query,
        page,
        current: candidate.current,
        previous: candidate.previous,
        clickChange: candidate.clickChange,
        clickChangeRatio: candidate.clickChangeRatio,
        positionDelta: candidate.positionDelta,
        baselineCtr: candidate.baselineCtr,
        clickGap: candidate.clickGap,
      });
      actions.push({
        kind,
        destination: DESTINATIONS[kind],
        query: candidate.query,
        page,
      });
      break;
    }
  }

  return {
    changes: changes.slice(0, DAILY_BRIEFING_ACTION_LIMIT),
    actions: actions.slice(0, DAILY_BRIEFING_ACTION_LIMIT),
    pageAttributionWithheld: pageAttributionWithheld.size,
  };
}

function propertyFallbackFor(
  weekly: DailyBriefingKpiComparison,
): DailyBriefingPropertyFallback | null {
  if (
    weekly.evidence !== "observed" ||
    weekly.current === null ||
    weekly.previous === null ||
    weekly.current.impressions < BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS ||
    weekly.previous.impressions < BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS
  ) {
    return null;
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
  let destination: DailyBriefingPropertyFallback["action"]["destination"] | null =
    null;

  if (
    clickChange <= -BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE &&
    clickChangeRatio !== null &&
    clickChangeRatio <= -BRIEFING_MATERIAL_CHANGE_RATIO
  ) {
    kind = "sitewide_click_decline";
    destination = "traffic-drop-diagnosis";
  } else if (
    impressionChange <= -BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE &&
    impressionChangeRatio !== null &&
    impressionChangeRatio <= -BRIEFING_MATERIAL_CHANGE_RATIO &&
    positionDelta !== null &&
    positionDelta >= BRIEFING_PROPERTY_POSITION_DELTA
  ) {
    kind = "sitewide_visibility_decline";
    destination = "traffic-drop-diagnosis";
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
    if (clickGainClears || impressionAndPositionGainClears) {
      kind = "sitewide_visibility_gain";
      destination = "seo-quick-wins";
    }
  }

  if (kind === null || destination === null) return null;

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
    action: { kind, destination },
  };
}

/** Build one report solely from supplied observations. */
export function buildDailyBriefing(
  input: BuildDailyBriefingInput,
): DailyBriefingEnvelope {
  const windows = dailyBriefingWindowsFor(input.now);
  const normalized = normalizedDateRows(input, windows);
  const latest = kpisForDates(normalized.rows, [windows.latestDay.endDate]);
  const previousDay = kpisForDates(normalized.rows, [windows.previousDay.endDate]);
  const currentWeek = kpisForDates(normalized.rows, datesIn(windows.current7Days));
  const previousWeek = kpisForDates(normalized.rows, datesIn(windows.previous7Days));
  const day = compareKpis(latest, previousDay);
  const weekly = compareKpis(currentWeek, previousWeek);
  const currentEvidence = input.currentQueryEvidence ?? null;
  const previousEvidence = input.previousQueryEvidence ?? null;
  const currentState = queryEvidenceState(currentEvidence);
  const previousState = queryEvidenceState(previousEvidence);
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
    currentEvidence === null ||
    previousEvidence === null ||
    currentEvidence.queryRead === null ||
    previousEvidence.queryRead === null ||
    currentEvidence.queryPageRead === null ||
    previousEvidence.queryPageRead === null ||
    currentState === "unavailable" ||
    previousState === "unavailable"
  ) {
    limitations.add("query_evidence_unavailable");
  }
  if (
    (currentEvidence !== null && currentEvidence.propertyTotals === null) ||
    (previousEvidence !== null && previousEvidence.propertyTotals === null)
  ) {
    limitations.add("property_totals_unavailable");
  }
  if (currentState === "partial" || previousState === "partial") {
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
    "evidence" | "selectedQueryChanges" | "propertyFallbackShown"
  > | null = null;

  if (
    currentEvidence !== null &&
    previousEvidence !== null &&
    currentState === "observed" &&
    previousState === "observed" &&
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
      firstObservedCandidates: candidateSet.firstObservedCandidates,
      pageAttributionWithheld:
        candidateSet.pageAttributionWithheld +
        selected.pageAttributionWithheld,
    };
    if (
      candidateSet.pageAttributionWithheld > 0 ||
      selected.pageAttributionWithheld > 0
    ) {
      limitations.add("query_page_coverage_below_floor");
    }
  }
  const propertyFallback =
    changes.length === 0 ? propertyFallbackFor(weekly) : null;
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
          firstObservedCandidates: null,
          pageAttributionWithheld: null,
          selectedQueryChanges: changes.length,
          propertyFallbackShown: propertyFallback !== null,
        }
      : {
          evidence: "observed",
          ...observedSignalCounts,
          selectedQueryChanges: changes.length,
          propertyFallbackShown: propertyFallback !== null,
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
      cadence:
        day.evidence === "unavailable" ||
        currentWeek === null ||
        currentWeek.impressions < DAILY_CADENCE_MIN_IMPRESSIONS
          ? "weekly"
          : "daily",
      changes,
      actions,
      propertyFallback,
      signalFunnel,
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
