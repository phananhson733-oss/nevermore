import { createPublicToolResult } from "../contract.ts";
import { buildTrafficActions } from "./actions.ts";
import { buildTrafficChecks, type TrafficCheckInputs } from "./checks.ts";
import { detectTrafficChangePoint } from "./changepoint.ts";
import { buildTrafficFindings } from "./findings.ts";
import { daysBetween, sortByDate } from "./series.ts";
import type { TrafficDailyPoint, TrafficDropEnvelope } from "./types.ts";

export const TRAFFIC_DROP_SCHEMA_VERSION = "traffic_drop.daily.v1";

export interface TrafficDropInput {
  /** Daily property totals. Order does not matter; gaps are left as gaps. */
  readonly daily: readonly TrafficDailyPoint[];
  /** ISO timestamp the run completed. Supplied by the caller, never generated here. */
  readonly completedAt: string;
  readonly checkInputs?: TrafficCheckInputs;
}

/**
 * First day the property actually had visibility.
 *
 * Search Console hands back rows for days a young property existed but drew
 * nothing; counting those as history would make a two-month-old site look
 * eligible for a year-over-year read.
 */
function firstNonEmptyDate(
  series: readonly TrafficDailyPoint[],
): string | null {
  return series.find((day) => day.impressions > 0)?.date ?? null;
}

/**
 * Days of history, measured as the calendar span the property has been
 * visible for.
 *
 * Deliberately not `series.length`: Search Console omits days a property drew
 * nothing, so a row count understates the age of any site with quiet
 * stretches — and every history gate in the engine reads this number.
 */
function historySpan(series: readonly TrafficDailyPoint[]): number {
  const first = firstNonEmptyDate(series);
  const last = series[series.length - 1]?.date;
  if (!first || !last) return 0;
  return daysBetween(first, last) + 1;
}

/**
 * Run the whole diagnosis over one daily series.
 *
 * Windows, findings, actions and checks are all derived here in one pass: the
 * caller supplies data and gets a report, and cannot supply a comparison
 * window (Owner 2026-07-31 — a window you choose is a conclusion you choose).
 */
export function buildTrafficDropReport(
  input: TrafficDropInput,
): TrafficDropEnvelope {
  const series = sortByDate(input.daily);
  const changePoint = detectTrafficChangePoint(series);
  const findings = buildTrafficFindings(series, changePoint);
  const first = series[0];
  const last = series[series.length - 1];

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
      dataStartDate: firstNonEmptyDate(series) ?? first?.date ?? null,
      dataEndDate: last?.date ?? null,
      dayCount: historySpan(series),
      changePoint,
      findings,
      actions: buildTrafficActions(findings),
      checks: buildTrafficChecks({
        changePoint,
        findings,
        series,
        ...(input.checkInputs ? { inputs: input.checkInputs } : {}),
      }),
    },
  );
}
