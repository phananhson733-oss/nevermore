import { describe, expect, it } from "vitest";
import type { GscPageRow, GscQueryPageRow } from "../gsc-analytics/index.ts";
import type { BriefV2Input } from "./v2-generation-contract.ts";
import { parseBriefV2Context } from "./v2-generation.ts";
import { buildResearchBundle } from "./v2-research.ts";
import * as projector from "./v2-gsc.ts";

const INPUT: BriefV2Input = {
  primary: "Content Brief",
  supporting: ["SEO outline", "topic research"],
  market: "US",
  language: "en",
};
const WINDOW = { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 } as const;
const PROPERTY = "sc-domain:owned.test";

function row(overrides: Partial<GscQueryPageRow> = {}): GscQueryPageRow {
  return { query: "Content Brief", page: "https://owned.test/brief", clicks: 0, impressions: 1, position: 67, ...overrides };
}

function project(
  rows: readonly GscQueryPageRow[],
  pages: readonly GscPageRow[] = [],
  input: BriefV2Input = INPUT,
  property: string = PROPERTY,
  status: "complete" | "partial" = "complete",
) {
  expect(projector.projectBriefV2Gsc).toBeTypeOf("function");
  return projector.projectBriefV2Gsc({ input, property, window: WINDOW, status, rows, pages });
}

describe("projectBriefV2Gsc", () => {
  it("retains low-impression, low-position supporting matches without claiming a primary match", () => {
    expect(project([row({ query: "seo outline" })])).toEqual({
      gsc: {
        status: "complete", property: PROPERTY, window: WINDOW, reason: null, omitted_matches: 0,
        matches: [{ id: "G1", query: "seo outline", keyword: "SEO outline", scope: "supporting", page: "https://owned.test/brief", clicks: 0, impressions: 1, position: 67 }],
      },
      candidates: [{ id: "T1", url: "https://owned.test/brief", match_refs: ["G1"], read: "unavailable" }],
    });
  });

  it("uses exact NFKC, whitespace-folded, lowercased identity while preserving raw queries", () => {
    const raw = "  Ｃｏｎｔｅｎｔ\t BRIEF \n";
    const result = project([
      row({ query: raw }),
      row({ query: "content brief" }),
      row({ query: "best content brief" }),
      row({ query: "content briefing" }),
      row({ query: "topic strategy" }),
    ]);
    expect(result.gsc.matches.map(({ query, scope, keyword }) => ({ query, scope, keyword }))).toEqual([
      { query: raw, scope: "primary", keyword: "Content Brief" },
      { query: "content brief", scope: "primary", keyword: "Content Brief" },
    ]);
    expect(result.gsc.omitted_matches).toBe(0);
  });

  it("gives primary identity precedence over a duplicate supporting input", () => {
    const result = project([row()], [], { ...INPUT, supporting: ["Ｃｏｎｔｅｎｔ brief"] });
    expect(result.gsc.matches[0]).toMatchObject({ scope: "primary", keyword: "Content Brief" });
  });

  it("orders primary before supporting keywords, then impressions and raw query/page ties independently of input order", () => {
    const rows = [
      row({ query: "topic research", page: "https://owned.test/topic", impressions: 999 }),
      row({ query: "seo outline", page: "https://owned.test/outline", impressions: 100 }),
      row({ query: "content brief", page: "https://owned.test/z", impressions: 3 }),
      row({ query: "CONTENT BRIEF", page: "https://owned.test/b", impressions: 3 }),
      row({ query: "CONTENT BRIEF", page: "https://owned.test/a", impressions: 3 }),
      row({ query: "Content Brief", impressions: 9 }),
    ];
    const result = project(rows);
    expect(result).toEqual(project([...rows].reverse()));
    expect(result.gsc.matches.map(({ id, query, page }) => [id, query, page])).toEqual([
      ["G1", "Content Brief", "https://owned.test/brief"],
      ["G2", "CONTENT BRIEF", "https://owned.test/a"],
      ["G3", "CONTENT BRIEF", "https://owned.test/b"],
      ["G4", "content brief", "https://owned.test/z"],
      ["G5", "seo outline", "https://owned.test/outline"],
      ["G6", "topic research", "https://owned.test/topic"],
    ]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("represents position %s as unavailable rather than zero", (position) => {
    expect(project([row({ position })]).gsc.matches[0]?.position).toBeNull();
  });

  it("keeps an available empty sample distinct from an unavailable read", () => {
    expect(project([row({ query: "unrelated" })]).gsc).toEqual({
      status: "complete", property: PROPERTY, window: WINDOW, reason: null, matches: [], omitted_matches: 0,
    });
    expect(project([], [], INPUT, PROPERTY, "partial").gsc.status).toBe("partial");
  });

  it("caps the matching ledger at thirty and reports only omitted matching observations", () => {
    const rows = Array.from({ length: 35 }, (_, index) => row({ page: `https://owned.test/${index}`, impressions: index }));
    const result = project([...rows, row({ query: "unrelated" })]);
    expect(result.gsc.matches).toHaveLength(30);
    expect(result.gsc.matches[0]).toMatchObject({ id: "G1", impressions: 34 });
    expect(result.gsc.matches[29]).toMatchObject({ id: "G30", impressions: 5 });
    expect(result.gsc).toMatchObject({ status: "partial", omitted_matches: 5 });
    expect(result.candidates).toHaveLength(3);
  });

  it("retains the first identical query/page observation and marks duplicate omissions without summing", () => {
    const result = project([
      row({ page: "https://OWNED.test:443/brief#top", clicks: 2, impressions: 5 }),
      row({ page: "https://owned.test/brief#other", clicks: 12, impressions: 50 }),
      row({ query: "content brief", clicks: 3, impressions: 7 }),
    ]);
    expect(result.gsc).toMatchObject({ status: "partial", omitted_matches: 1 });
    expect(result.gsc.matches).toHaveLength(2);
    expect(result.gsc.matches.find(({ query }) => query === "Content Brief")).toMatchObject({ clicks: 2, impressions: 5, page: "https://owned.test/brief" });
    expect(result.candidates).toEqual([{ id: "T1", url: "https://owned.test/brief", match_refs: ["G1", "G2"], read: "unavailable" }]);
  });

  it("groups page aliases into one candidate without merging their observed rows or inventing a representative URL", () => {
    const sourceRows = [
      row({ page: "https://owned.test/guide", clicks: 2, impressions: 5 }),
      row({ page: "https://owned.test/guide/?utm_source=x", clicks: 3, impressions: 12 }),
    ];
    const result = project(sourceRows);
    expect(result.gsc).toMatchObject({ status: "complete", omitted_matches: 0 });
    expect(result.gsc.matches).toEqual([
      { id: "G1", query: "Content Brief", keyword: "Content Brief", scope: "primary", page: "https://owned.test/guide/?utm_source=x", clicks: 3, impressions: 12, position: 67 },
      { id: "G2", query: "Content Brief", keyword: "Content Brief", scope: "primary", page: "https://owned.test/guide", clicks: 2, impressions: 5, position: 67 },
    ]);
    expect(result.candidates).toEqual([
      { id: "T1", url: "https://owned.test/guide/?utm_source=x", match_refs: ["G1", "G2"], read: "unavailable" },
    ]);
    expect(result).toEqual(project([...sourceRows].reverse()));
  });

  it("does not spend remaining candidate slots on canonical aliases from property page rows", () => {
    const sourcePages = [
      { page: "https://owned.test/guide/", clicks: 4, impressions: 100, position: 8 },
      { page: "https://owned.test/related/?utm_source=x", clicks: 3, impressions: 90, position: 9 },
      { page: "https://owned.test/related", clicks: 2, impressions: 50, position: 10 },
      { page: "https://owned.test/other", clicks: 1, impressions: 10, position: 11 },
    ];
    const result = project([row({ page: "https://owned.test/guide" })], sourcePages);
    expect(result.candidates.map(({ url }) => url)).toEqual([
      "https://owned.test/guide", "https://owned.test/related/?utm_source=x", "https://owned.test/other",
    ]);
    expect(result.gsc.status).toBe("complete");
    expect(result).toEqual(project([row({ page: "https://owned.test/guide" })], [...sourcePages].reverse()));
  });

  it("prioritizes primary pages before supporting pages and orders supporting candidates by impressions, not keyword", () => {
    const result = project([
      row({ page: "https://owned.test/primary", impressions: 1 }),
      row({ query: "seo outline", page: "https://owned.test/outline", impressions: 20 }),
      row({ query: "topic research", page: "https://owned.test/topic", impressions: 50 }),
    ], [{ page: "https://owned.test/popular", clicks: 10, impressions: 9000, position: 2 }]);
    expect(result.candidates).toEqual([
      { id: "T1", url: "https://owned.test/primary", match_refs: ["G1"], read: "unavailable" },
      { id: "T2", url: "https://owned.test/topic", match_refs: ["G3"], read: "unavailable" },
      { id: "T3", url: "https://owned.test/outline", match_refs: ["G2"], read: "unavailable" },
    ]);
  });

  it("orders matching page candidates by the primary-scope sum, without letting supporting impressions overtake it", () => {
    const result = project([
      row({ query: "content brief", page: "https://owned.test/a", impressions: 5 }),
      row({ query: "CONTENT BRIEF", page: "https://owned.test/a", impressions: 5 }),
      row({ page: "https://owned.test/b", impressions: 9 }),
      row({ query: "seo outline", page: "https://owned.test/b", impressions: 900 }),
    ]);
    expect(result.candidates.map(({ url, match_refs }) => ({ url, match_refs }))).toEqual([
      { url: "https://owned.test/a", match_refs: ["G2", "G3"] },
      { url: "https://owned.test/b", match_refs: ["G1", "G4"] },
    ]);
  });

  it("fills remaining candidate slots from in-property page rows and preserves all match refs", () => {
    const result = project([row(), row({ query: "seo outline", impressions: 4 })], [
      { page: "https://owned.test/b", clicks: 10, impressions: 500, position: 2 },
      { page: "https://owned.test/a#part", clicks: 10, impressions: 500, position: 2 },
      { page: "https://owned.test/c", clicks: 10, impressions: 400, position: 2 },
      { page: "https://owned.test/brief", clicks: 10, impressions: 1000, position: 2 },
    ]);
    expect(result.candidates).toEqual([
      { id: "T1", url: "https://owned.test/brief", match_refs: ["G1", "G2"], read: "unavailable" },
      { id: "T2", url: "https://owned.test/a", match_refs: [], read: "unavailable" },
      { id: "T3", url: "https://owned.test/b", match_refs: [], read: "unavailable" },
    ]);
    expect(result.gsc.status).toBe("complete");
  });

  it("can select observed property pages when the query sample has no scoped matches", () => {
    const result = project([], [{ page: "https://owned.test/a", clicks: 0, impressions: 0, position: 0 }]);
    expect(result.gsc.matches).toEqual([]);
    expect(result.candidates).toEqual([{ id: "T1", url: "https://owned.test/a", match_refs: [], read: "unavailable" }]);
  });

  it.each([
    "https://unowned.test/brief",
    "https://owned.test.evil.test/brief",
    "https://notowned.test/brief",
    "https://name:password@owned.test/brief",
    "file:///owned.test/brief",
    "not a URL",
    `https://owned.test/${"a".repeat(2048)}`,
    `https://owned.test/${"中".repeat(300)}`,
  ])("excludes invalid or out-of-property page %s from both ledgers", (page) => {
    const result = project([row({ page })], [{ page, clicks: 1, impressions: 1, position: 1 }]);
    expect(result.gsc).toMatchObject({ status: "partial", matches: [], omitted_matches: 0 });
    expect(result.candidates).toEqual([]);
  });

  it("accepts domain subproperties but keeps URL-prefix scheme, port and path boundaries", () => {
    expect(project([row({ page: "http://blog.owned.test/a" })]).gsc.matches).toHaveLength(1);
    const rows = [
      "https://owned.test/guide/a", "https://owned.test/guide", "http://owned.test/guide/a",
      "https://owned.test:8443/guide/a", "https://owned.test/guideline/a", "https://owned.test/Guide/a",
      "https://blog.owned.test/guide/a",
    ].map((page) => row({ page }));
    const result = project(rows, [], INPUT, "https://owned.test/guide/");
    expect(result.gsc.matches.map(({ page }) => page)).toEqual(["https://owned.test/guide", "https://owned.test/guide/a"]);
    expect(result.gsc.status).toBe("partial");
  });

  it.each([
    { clicks: Number.NaN }, { clicks: -1 }, { impressions: Number.POSITIVE_INFINITY }, { impressions: -1 },
  ])("omits unreadable metrics without inventing omitted matching counts: %j", (metrics) => {
    const result = project([row(metrics)], [row({ ...metrics, page: "https://owned.test/page" })]);
    expect(result.gsc).toMatchObject({ status: "partial", matches: [], omitted_matches: 0 });
    expect(result.candidates).toEqual([]);
  });

  it("preserves bounded raw query DATA and omits overlong queries instead of truncating their identity", () => {
    const raw = "\u0000content brief";
    const result = project([row({ query: " ".repeat(2000) + "Content Brief" }), row({ query: raw })]);
    expect(result.gsc).toMatchObject({ status: "partial", matches: [], omitted_matches: 0 });
    const full = "Content" + " ".repeat(1988) + "Brief";
    expect(project([row({ query: full })]).gsc.matches[0]?.query).toBe(full);
  });

  it("does not mutate input arrays or retain the mutable input window", () => {
    const rows = Object.freeze([Object.freeze(row())]);
    const pages = Object.freeze([Object.freeze({ page: "https://owned.test/a", clicks: 0, impressions: 1, position: 0 })]);
    const window = { ...WINDOW };
    const result = projector.projectBriefV2Gsc({ input: INPUT, property: PROPERTY, window, status: "complete", rows, pages });
    expect(result.gsc.window).not.toBe(window);
    expect(result.gsc.matches[0]).not.toBe(rows[0]);
    expect(result.candidates).toHaveLength(2);
  });

  it("produces a context accepted by the exact v2 parser, including source spelling variants and known omissions", () => {
    const research = buildResearchBundle([], []);
    expect(research.ok).toBe(true);
    if (!research.ok) return;
    const rows = Array.from({ length: 35 }, (_, index) => row({ page: `https://owned.test/${index}`, impressions: index }));
    const aliases = [row({ page: "https://owned.test/guide" }), row({ page: "https://owned.test/guide/?utm_source=x" })];
    for (const sourceRows of [[], [row({ query: "  CONTENT\n BRIEF  " }), row({ query: "content brief" })], [...rows, ...rows], aliases]) {
      const projected = project(sourceRows);
      expect(parseBriefV2Context({ input: INPUT, research: research.value, facts: [], profile_snapshot: null, ...projected }).ok).toBe(true);
    }
  });
});
