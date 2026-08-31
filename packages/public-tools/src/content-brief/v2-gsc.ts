// @input -- scoped keywords and bounded Search Console page observations
// @output -- primary/supporting match ledger and owned-page candidates
// @pos -- pure v2 first-party projection; page aliases share candidates, not source rows
import type { GscPageRow, GscQueryPageRow } from "../gsc-analytics/index.ts";
import { keywordCoverageProperty } from "../keyword-opportunity/property.ts";
import { normalizePosition, compareCodeUnits } from "./verdict.ts";
import { briefV2PageKey } from "./v2-generation.ts";
import type { BriefV2Gsc, BriefV2Input, OwnedCandidate, ScopedQueryPage } from "./v2-generation-contract.ts";

function queryKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

function pageKey(value: string, property: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.href.length > 2048) return null;
    url.hash = "";
    return keywordCoverageProperty(url.href, [property]) === property ? url.href : null;
  } catch { return null; }
}

function readableMetrics(row: GscPageRow): boolean {
  return Number.isFinite(row.clicks) && row.clicks >= 0 && Number.isFinite(row.impressions) && row.impressions >= 0;
}

type Match = Omit<ScopedQueryPage, "id">;

function compareMatches(a: Match, b: Match): number {
  return (a.scope === "primary" ? 0 : 1) - (b.scope === "primary" ? 0 : 1)
    || compareCodeUnits(queryKey(a.keyword), queryKey(b.keyword))
    || b.impressions - a.impressions
    || compareCodeUnits(a.query, b.query)
    || compareCodeUnits(a.page, b.page);
}

function candidateUrls(matches: readonly ScopedQueryPage[], pages: readonly GscPageRow[]): string[] {
  const matchedPages = new Map<string, { url: string; scope: Match["scope"]; impressions: number }>();
  for (const match of matches) {
    const identity = briefV2PageKey(match.page);
    if (identity === null) continue;
    const previous = matchedPages.get(identity);
    // The match ledger is primary-first: supporting observations never add to a primary total.
    // Keep the first deterministically sorted observed URL, not a synthesized canonical URL.
    if (!previous) matchedPages.set(identity, { url: match.page, scope: match.scope, impressions: match.impressions });
    else if (previous.scope === match.scope) previous.impressions += match.impressions;
  }
  const matching = [...matchedPages.values()].sort((a, b) =>
    (a.scope === "primary" ? 0 : 1) - (b.scope === "primary" ? 0 : 1)
    || b.impressions - a.impressions || compareCodeUnits(a.url, b.url),
  ).map(({ url }) => url);
  const fallback = [...pages].sort((a, b) => b.impressions - a.impressions || compareCodeUnits(a.page, b.page)).map((row) => row.page);
  const seen = new Set<string>();
  return [...matching, ...fallback].filter((url) => {
    const identity = briefV2PageKey(url);
    if (identity === null || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 3);
}

/** The caller has already authenticated the property and bounded the source read. */
export function projectBriefV2Gsc(options: {
  readonly input: BriefV2Input;
  readonly property: string;
  readonly window: NonNullable<BriefV2Gsc["window"]>;
  readonly status: "complete" | "partial";
  readonly rows: readonly GscQueryPageRow[];
  readonly pages: readonly GscPageRow[];
}): { readonly gsc: BriefV2Gsc; readonly candidates: OwnedCandidate[] } {
  const keywords = new Map<string, { keyword: string; scope: Match["scope"] }>();
  keywords.set(queryKey(options.input.primary), { keyword: options.input.primary, scope: "primary" });
  for (const keyword of options.input.supporting) {
    const key = queryKey(keyword);
    if (!keywords.has(key)) keywords.set(key, { keyword, scope: "supporting" });
  }
  const seen = new Set<string>();
  const found: Match[] = [];
  let omitted = 0;
  let unreadable = false;
  for (const row of options.rows) {
    if (row.query.trim() === "" || Array.from(row.query).length > 2000 || !readableMetrics(row)) {
      unreadable = true;
      continue;
    }
    const page = pageKey(row.page, options.property);
    if (page === null) {
      unreadable = true;
      continue;
    }
    const match = keywords.get(queryKey(row.query));
    if (!match) continue;
    const key = JSON.stringify([row.query, page]);
    if (seen.has(key)) {
      omitted += 1;
      continue;
    }
    seen.add(key);
    found.push({ query: row.query, page, clicks: row.clicks, impressions: row.impressions, keyword: match.keyword, scope: match.scope, position: normalizePosition(row.position) });
  }
  found.sort(compareMatches);
  omitted += Math.max(0, found.length - 30);
  const matches = found.slice(0, 30).map((match, index): ScopedQueryPage => ({ id: `G${index + 1}`, ...match }));
  const pages = new Map<string, GscPageRow>();
  for (const row of options.pages) {
    const page = pageKey(row.page, options.property);
    if (page === null || !readableMetrics(row) || pages.has(page)) {
      unreadable = true;
      continue;
    }
    pages.set(page, { ...row, page });
  }
  const urls = candidateUrls(matches, [...pages.values()]);
  return {
    gsc: { status: omitted > 0 || unreadable ? "partial" : options.status, property: options.property, window: { ...options.window }, reason: null, matches, omitted_matches: omitted },
    candidates: urls.map((url, index) => ({ id: `T${index + 1}`, url, match_refs: matches.filter((match) => briefV2PageKey(match.page) === briefV2PageKey(url)).map((match) => match.id), read: "unavailable" })),
  };
}
