import { createPublicToolResult } from "../contract.ts";
import { buildTrafficActions } from "./actions.ts";
import { buildTrafficChecks, type TrafficCheckInputs } from "./checks.ts";
import { detectTrafficChangePoint } from "./changepoint.ts";
import { buildTrafficFindings } from "./findings.ts";
import { firstVisibleDate, historySpanDays, sortByDate } from "./series.ts";
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
      actions: buildTrafficActions(findings),
      checks: buildTrafficChecks({
        changePoint,
        findings,
        series,
        // The run date, so "is this property still visible" is asked about
        // now rather than about whenever the last row happens to be.
        runDate: input.completedAt.slice(0, 10),
        ...(input.checkInputs ? { inputs: input.checkInputs } : {}),
      }),
    },
  );
}
