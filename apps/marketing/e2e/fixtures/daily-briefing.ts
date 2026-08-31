// @input  -- synthetic, anonymous GSC-shaped records; no provider credentials or network
// @output -- v10 briefing fixtures built and verified through the real pure functions
// @pos    -- local browser regression data, never evidence of a real GSC website visit

import type {
  DailyBriefingQueryEvidence,
  GscQueryClient,
  GscQueryPageRow,
  GscQueryRow,
} from "@sf/public-tools";
import { buildDailyBriefing } from "../../../../packages/public-tools/src/daily-briefing/report.ts";
import { verifyDailyBriefing } from "../../../../packages/public-tools/src/daily-briefing/verification.ts";

export const SYNTHETIC_PROPERTY = "sc-domain:briefing-fixture.test";
export const SYNTHETIC_QUERY = "synthetic query + & тест";
export const SYNTHETIC_PAIR_QUERY = "synthetic paired query / ? + 中文";
export const SYNTHETIC_PAGE = "https://briefing-fixture.test/detail/a?lang=en&v=2";
export const SYNTHETIC_NOW = new Date("2026-08-31T06:45:00.000Z");
export const CURRENT_START = "2026-08-24";
export const CURRENT_END = "2026-08-30";
export const PREVIOUS_START = "2026-08-17";
export const PREVIOUS_END = "2026-08-23";

const CURRENT: readonly GscQueryRow[] = [
  { query: SYNTHETIC_QUERY, clicks: 24, impressions: 240, position: 4 },
  { query: SYNTHETIC_PAIR_QUERY, clicks: 30, impressions: 200, position: 4 },
];
const PREVIOUS: readonly GscQueryRow[] = [
  { query: SYNTHETIC_QUERY, clicks: 48, impressions: 240, position: 4 },
];
const CURRENT_PAIRS: readonly GscQueryPageRow[] = [
  { query: SYNTHETIC_PAIR_QUERY, page: SYNTHETIC_PAGE, clicks: 20, impressions: 160, position: 1.9 },
  { query: SYNTHETIC_PAIR_QUERY, page: "https://briefing-fixture.test/secondary", clicks: 10, impressions: 40, position: 12.4 },
];

function evidence(rows: readonly GscQueryRow[], pairs: readonly GscQueryPageRow[]): DailyBriefingQueryEvidence {
  const paging = { pagesFetched: 1, truncated: false };
  return {
    queryRead: { rows, paging, unreadableRows: 0, responseAggregationType: "byProperty" },
    queryPageTotalsRead: { rows, paging, unreadableRows: 0, responseAggregationType: "byPage" },
    queryPageRead: { rows: pairs, paging, unreadableRows: 0, responseAggregationType: "byPage" },
    pageRead: null,
    propertyTotals: null,
  };
}

export async function syntheticDailyBriefing(partial = false) {
  // The complete case is read after PT midnight. The partial case is read
  // while August 30 is still the current PT day and cannot be final evidence.
  const now = partial ? SYNTHETIC_NOW : new Date("2026-08-31T08:45:00.000Z");
  const dateRows = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-08-${17 + index}`,
    clicks: 10,
    impressions: 500,
    position: 4.5,
  }));
  // Deliberately synthetic distribution, preserving only the screenshot's
  // aggregate regression: the earlier eight hours are 318 clicks / 1,543 impressions.
  const hourly = Array.from({ length: 24 }, (_, index) => ({
    key: new Date(Date.parse("2026-08-29T23:00:00Z") + index * 3_600_000).toISOString(),
    clicks: index < 8 ? (index === 7 ? 38 : 40) : (index === 23 ? 86 : 82),
    impressions: index < 8 ? (index === 7 ? 192 : 193) : (index === 23 ? 415 : 417),
    position: 5.8,
  }));
  const firstIncompleteDate = partial ? CURRENT_END : null;
  const candidate = buildDailyBriefing({
    now,
    dateRows,
    firstIncompleteDate,
    trend: {
      hourly: { rows: hourly, firstIncompleteDate: null, firstIncompleteHour: "2026-08-30T15:00:00Z" },
      daily: { rows: dateRows.map(({ date, ...metrics }) => ({ key: date, ...metrics })), firstIncompleteDate, firstIncompleteHour: null },
    },
    currentQueryEvidence: evidence(CURRENT, CURRENT_PAIRS),
    previousQueryEvidence: evidence(PREVIOUS, []),
    brandTerms: ["synthetic-brand"],
    brandTermsConfirmed: true,
  });

  // This in-memory client exercises the verifier but never calls Google.
  // A request outside the exact fixture scope fails closed instead of returning
  // a permissive catch-all response that could conceal incorrect filters.
  const client: GscQueryClient = async (request) => {
    const current = request.startDate === CURRENT_START && request.endDate === CURRENT_END;
    const previous = request.startDate === PREVIOUS_START && request.endDate === PREVIOUS_END;
    if ((!current && !previous) || request.dimensions.length !== 0 || request.dataState !== "all") {
      throw new Error("Unexpected synthetic verification window or dimensions");
    }
    const query = request.filters?.find((filter) => filter.dimension === "query")?.expression;
    const page = request.filters?.find((filter) => filter.dimension === "page")?.expression;
    const isPair = page !== undefined;
    const rows = isPair
      ? (current ? CURRENT_PAIRS : []).filter((row) => row.query === query && row.page === page)
      : (current ? CURRENT : PREVIOUS).filter((row) => row.query === query);
    const aggregation = isPair ? "byPage" : "byProperty";
    if (request.aggregationType !== aggregation || request.filters?.length !== (isPair ? 2 : 1)
      || (query !== SYNTHETIC_QUERY && query !== SYNTHETIC_PAIR_QUERY)
      || (isPair && page !== SYNTHETIC_PAGE)) {
      throw new Error("Unexpected synthetic verification filters or aggregation");
    }
    return { rows: rows.map((row) => ({ keys: [], ...row })), responseAggregationType: aggregation };
  };
  return verifyDailyBriefing(candidate, client, { now: () => now });
}
