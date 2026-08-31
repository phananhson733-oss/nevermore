// @input  -- candidate briefing and a request-scoped official Search Analytics client
// @output -- exact-filter verification evidence; unverifiable findings are withheld
// @pos    -- final API evidence gate, never a claim of a GSC website browser visit

import type { ReadBudget } from "../gsc-analytics/reader.ts";
import type { GscQueryClient, GscQueryRequest, GscRawRow } from "../gsc-analytics/types.ts";
import type { GscWindow } from "../gsc-analytics/window.ts";
import type { DailyBriefingEnvelope, DailyBriefingKpis } from "./types.ts";

export type DailyBriefingMetricScope = "query" | "query_page" | "page" | "property";

export interface DailyBriefingVerifiedItem {
  readonly metricScope: DailyBriefingMetricScope;
  readonly query: string | null;
  readonly page: string | null;
  readonly status: "verified" | "mismatch" | "unavailable";
  readonly aggregationType: "byProperty" | "byPage";
  readonly current: DailyBriefingKpis | null;
  readonly previous: DailyBriefingKpis | null;
}

export interface DailyBriefingVerification {
  readonly source: "google_search_console_api";
  readonly websiteChecked: false;
  readonly checkedAt: string;
  readonly verifiedCount: number;
  readonly withheldCount: number;
  readonly items: readonly DailyBriefingVerifiedItem[];
}

type Metrics = Pick<DailyBriefingKpis, "clicks" | "impressions" | "position">;
interface Subject {
  readonly metricScope: DailyBriefingMetricScope;
  readonly query: string | null;
  readonly page: string | null;
  readonly current: Metrics | null;
  /** Undefined means no previous-window claim; null means absence was claimed. */
  readonly previous: Metrics | null | undefined;
  readonly previousImpressions?: number;
  readonly comparative: boolean;
}

function subjectKey(subject: Pick<Subject, "metricScope" | "query" | "page">): string {
  return JSON.stringify([subject.metricScope, subject.query, subject.page]);
}

function measured(row: GscRawRow): DailyBriefingKpis | undefined {
  if (![row.clicks, row.impressions, row.position].every(Number.isFinite) ||
    row.clicks < 0 || row.impressions < row.clicks || row.position < 0 ||
    (row.impressions > 0 && row.position <= 0)) return undefined;
  return {
    clicks: row.clicks, impressions: row.impressions,
    ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
    position: row.impressions > 0 ? row.position : null,
  };
}

function matches(expected: Metrics | null, actual: DailyBriefingKpis | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return expected.clicks === actual.clicks && expected.impressions === actual.impressions &&
    (expected.position === null || (actual.position !== null &&
      Math.abs(expected.position - actual.position) <= 1e-9));
}

function filtersFor(subject: Subject): NonNullable<GscQueryRequest["filters"]> {
  return [
    ...(subject.query === null ? [] : [{ dimension: "query" as const, expression: subject.query }]),
    ...(subject.page === null ? [] : [{ dimension: "page" as const, expression: subject.page }]),
  ];
}

function validSubject(subject: Subject): boolean {
  const hasQuery = subject.query !== null && subject.query.trim() !== "";
  const hasPage = subject.page !== null && subject.page.trim() !== "";
  if (subject.metricScope === "query_page") return hasQuery && hasPage;
  if (subject.metricScope === "query") return hasQuery && subject.page === null;
  if (subject.metricScope === "page") return hasPage && subject.query === null;
  return subject.query === null && subject.page === null;
}

async function readSubject(
  client: GscQueryClient, subject: Subject, window: GscWindow,
  aggregationType: "byProperty" | "byPage", budget: ReadBudget | undefined,
  requireComplete: boolean,
): Promise<DailyBriefingKpis | null | undefined> {
  if (budget?.isExpired() === true || !validSubject(subject)) return undefined;
  try {
    const response = await client({
      dimensions: [], ...window, rowLimit: 1, startRow: 0, aggregationType,
      dataState: "all", filters: filtersFor(subject),
    });
    if (response.responseAggregationType !== aggregationType || response.rows.length > 1) return undefined;
    const incomplete = response.metadata?.firstIncompleteDate;
    if (requireComplete && incomplete != null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(incomplete) || incomplete <= window.endDate)) return undefined;
    const row = response.rows[0];
    if (row !== undefined && row.keys.length !== 0) return undefined;
    return row === undefined ? null : measured(row);
  } catch {
    return undefined;
  }
}

export async function verifyDailyBriefing(
  envelope: DailyBriefingEnvelope,
  client: GscQueryClient,
  options: { readonly budget?: ReadBudget; readonly now?: () => Date } = {},
): Promise<DailyBriefingEnvelope> {
  const result = envelope.result;
  const subjects: Subject[] = [
    ...result.changes.map(change => ({
      metricScope: change.metricScope, query: change.query,
      page: change.metricScope === "query_page" ? change.page : null,
      current: change.current, previous: change.previous,
      comparative: true,
    })),
    ...result.pageChanges.map(change => ({ metricScope: "page" as const, query: null, page: change.page, current: change.current, previous: change.previous, comparative: true })),
    ...result.queryWatchlist.items.map(item => ({
      metricScope: item.metricScope, query: item.query,
      page: null,
      current: item.current,
      previous: item.previousEvidence === "not_observed" ? null : item.previous ?? undefined,
      ...(item.previousBelowFloor === null ? {} : { previousImpressions: item.previousBelowFloor }),
      comparative: item.previous !== null || item.previousEvidence === "not_observed",
    })),
    ...result.provisionalMoves.items.map(item => ({
      metricScope: item.metricScope, query: item.query,
      page: null,
      current: item.current, previous: item.previous,
      comparative: true,
    })),
    ...result.pageChecks.items.map(item => ({
      metricScope: "page" as const, query: null, page: item.page,
      current: { clicks: 0, impressions: item.impressions, position: item.position }, previous: undefined,
      comparative: false,
    })),
    ...(result.propertyTrend.change === null ? [] : [{
      metricScope: "property" as const, query: null, page: null,
      current: result.propertyTrend.change.current, previous: result.propertyTrend.change.previous,
      comparative: true,
    }]),
  ];
  // Reuse one exact read for the same subject while checking every claim that
  // depends on it. A duplicate cannot silently overwrite an earlier expectation.
  const grouped = new Map<string, Subject[]>();
  for (const subject of subjects) {
    const key = subjectKey(subject);
    grouped.set(key, [...(grouped.get(key) ?? []), subject]);
  }
  const entries = [...grouped.values()];
  const items: DailyBriefingVerifiedItem[] = [];
  // At most four provider requests in flight, within the original run budget.
  for (let offset = 0; offset < entries.length; offset += 2) {
    const checked = await Promise.all(entries.slice(offset, offset + 2).map(async claims => {
      const subject = claims[0]!;
      const aggregationType = subject.metricScope === "query" || subject.metricScope === "property" ? "byProperty" as const : "byPage" as const;
      const needsPrevious = claims.some(claim => claim.previous !== undefined || claim.previousImpressions !== undefined);
      const comparative = claims.some(claim => claim.comparative);
      const windows = result.windows;
      const [current, previous] = windows === null || (comparative && !result.freshness.comparisonEligible)
        ? [undefined, undefined]
        : await Promise.all([
            readSubject(client, subject, windows.current7Days, aggregationType, options.budget, comparative),
            needsPrevious ? readSubject(client, subject, windows.previous7Days, aggregationType, options.budget, comparative) : Promise.resolve(null),
          ]);
      const unavailable = current === undefined || (needsPrevious && previous === undefined);
      const agrees = !unavailable && claims.every(claim => matches(claim.current, current!) &&
        (claim.previous === undefined || matches(claim.previous, previous!)) &&
        (claim.previousImpressions === undefined || claim.previousImpressions === previous?.impressions));
      return {
        metricScope: subject.metricScope, query: subject.query, page: subject.page,
        status: unavailable ? "unavailable" as const : agrees ? "verified" as const : "mismatch" as const,
        aggregationType, current: current ?? null, previous: previous ?? null,
      };
    }));
    items.push(...checked);
  }
  const verified = new Set(items.filter(item => item.status === "verified").map(subjectKey));
  const keep = (metricScope: DailyBriefingMetricScope, query: string | null, page: string | null): boolean =>
    verified.has(subjectKey({ metricScope, query, page: metricScope === "query_page" || metricScope === "page" ? page : null }));
  const changes = result.changes.filter(item => keep(item.metricScope, item.query, item.page))
    .map(item => item.metricScope === "query" ? { ...item, page: null, pageEvidence: "unavailable" as const } : item);
  const pageChanges = result.pageChanges.filter(item => keep("page", null, item.page));
  const observations = result.queryWatchlist.items.filter(item => keep(item.metricScope, item.query, item.page))
    .map(item => ({ ...item, page: null, pageEvidence: "unavailable" as const }));
  const provisional = result.provisionalMoves.items.filter(item => keep(item.metricScope, item.query, item.page))
    .map(item => ({ ...item, page: null, pageEvidence: "unavailable" as const }));
  const propertyTrend = keep("property", null, null) ? result.propertyTrend : { change: null, action: null, noiseFloor: null };
  const withheldCount = items.length - verified.size;
  return {
    ...envelope,
    result: {
      ...result,
      changes,
      actions: result.actions.filter(action => changes.some(change => change.kind === action.kind && change.query === action.query && change.page === action.page)),
      pageChanges,
      pageActions: result.pageActions.filter(action => pageChanges.some(change => change.kind === action.kind && change.page === action.page)),
      queryWatchlist: { ...result.queryWatchlist, items: observations },
      provisionalMoves: { ...result.provisionalMoves, items: provisional },
      suggestedChecks: { ...result.suggestedChecks, items: result.suggestedChecks.items.filter(check => observations.some(item => item.query === check.query && item.page === check.page)) },
      pageChecks: { ...result.pageChecks, items: result.pageChecks.items.filter(item => keep("page", null, item.page)) },
      propertyTrend,
      signalFunnel: { ...result.signalFunnel, selectedQueryChanges: changes.length, propertyTrendShown: propertyTrend.change !== null },
      verification: {
        source: "google_search_console_api", websiteChecked: false,
        checkedAt: (options.now ?? (() => new Date()))().toISOString(),
        verifiedCount: verified.size, withheldCount, items,
      },
    },
  };
}
