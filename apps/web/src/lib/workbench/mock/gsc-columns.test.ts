import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import type { ParsedGsc } from "./gsc.ts";
import { parseGsc } from "./gsc.ts";

/** Header recognition and header-driven column mapping. Record structure lives in gsc.test.ts, cell values in gsc-cells.test.ts. */
const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

/**
 * `rows` and `skipped` only. The header metadata `parseGsc` also returns (Q7)
 * has its own cases in `gsc-columns.test.ts`, so leaving it out here keeps each
 * of these assertions about the records it is named for.
 */
function rowsAndSkipped(text: string): Pick<ParsedGsc, "rows" | "skipped"> {
  const { rows, skipped } = parseGsc(text);
  return { rows, skipped };
}

describe("parseGsc: header detection", () => {
  it("only looks at the first record: a repeated header later is a skipped row, not data", () => {
    const text = lines(
      "a,1,2,3%,4",
      "Top queries,Clicks,Impressions,CTR,Position",
      "b,5,6,7%,8",
    );
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("a", 1, 2, 3, 4), row("b", 5, 6, 7, 8)],
      skipped: 1,
    });
  });

  it("does not take a first data line with one missing number for a header", () => {
    expect(parseGsc("new query,,40,,").rows).toEqual([
      row("new query", null, 40, null, null),
    ]);
  });

  it("takes a two-column first record with known labels for a header: its labels say what the second column is", () => {
    expect(rowsAndSkipped(lines("Query,Position", "shoes,7"))).toEqual({
      rows: [row("shoes", null, null, null, 7)],
      skipped: 0,
    });
    expect(rowsAndSkipped(lines("Query,Clicks", "shoes,7"))).toEqual({
      rows: [row("shoes", 7, null, null, null)],
      skipped: 0,
    });
    expect(rowsAndSkipped(lines("Query,Clicks", "a,1,2,3%,4"))).toEqual({
      rows: [row("a", 1, null, null, null)],
      skipped: 0,
    });
  });

  it("does not take a digit-free first record without a known label for a header: it is a row with nothing available, counted as skipped", () => {
    expect(rowsAndSkipped("shoes\t-\t-\t-\t-")).toEqual({ rows: [], skipped: 1 });
    expect(rowsAndSkipped(lines("shoes\t-\t-\t-\t-", "a\t1\t2\t3%\t4"))).toEqual({
      rows: [row("a", 1, 2, 3, 4)],
      skipped: 1,
    });
  });

  it("does not take a first record with an unreadable clicks cell but a number elsewhere for a header", () => {
    expect(rowsAndSkipped("new query,n/a,40,1%,3")).toEqual({
      rows: [row("new query", null, 40, 1, 3)],
      skipped: 0,
    });
  });

  it("does not take a first record with empty clicks and impressions for a header", () => {
    expect(rowsAndSkipped("new query,,,1%,3")).toEqual({
      rows: [row("new query", null, null, 1, 3)],
      skipped: 0,
    });
    // No digit anywhere, but no cell is a known label either, so this lone query is a record, not a header.
    expect(rowsAndSkipped(lines("lonely,,,n/a,—", "a,1,2,3%,4"))).toEqual({
      rows: [row("a", 1, 2, 3, 4)],
      skipped: 1,
    });
  });

  it("never takes a record containing a digit for a header", () => {
    expect(rowsAndSkipped("q\t—\tn/a\t1%\t3")).toEqual({
      rows: [row("q", null, null, 1, 3)],
      skipped: 0,
    });
    expect(rowsAndSkipped(lines("Top 10 queries\tClicks\tImpressions", "a\t1\t2"))).toEqual({
      rows: [row("a", 1, 2, null, null)],
      skipped: 1,
    });
  });

  it("does not eat a Swiss-grouped first data record as a header", () => {
    expect(rowsAndSkipped("q\t1\u2019234\t12\u2019345\t9,9 %\t3,2")).toEqual({
      rows: [row("q", 1234, 12345, 9.9, 3.2)],
      skipped: 0,
    });
  });

  it("reads a Swiss-grouped later record", () => {
    const text = lines("a\t1\t2\t3%\t4", "q\t1'234\t12\u2019345\t9,9 %\t3,2");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("a", 1, 2, 3, 4), row("q", 1234, 12345, 9.9, 3.2)],
      skipped: 0,
    });
  });
});

describe("parseGsc: columns follow the header labels", () => {
  it("reads a GSC table without the CTR column by label", () => {
    const text = "Top queries\tClicks\tImpressions\tPosition\nai seo\t5\t60\t3.2";
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("ai seo", 5, 60, null, 3.2)],
      skipped: 0,
    });
  });

  it("reads a table with only clicks and position", () => {
    expect(rowsAndSkipped(lines("Top queries\tClicks\tPosition", "ai seo\t5\t3.2"))).toEqual({
      rows: [row("ai seo", 5, null, null, 3.2)],
      skipped: 0,
    });
  });

  it("reads a Chinese header without CTR by label", () => {
    const text = lines("热门查询\t点击次数\t展示次数\t排名", "ai seo\t5\t60\t3.2");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("ai seo", 5, 60, null, 3.2)],
      skipped: 0,
    });
  });

  it("reads columns in any order, with labels matched case-insensitively after trimming", () => {
    const text = lines(" POSITION ,ctr,Impressions,CLICKS,Queries", "3.2,8.3%,60,5,ai seo");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("ai seo", 5, 60, 8.3, 3.2)],
      skipped: 0,
    });
  });

  it("reads Chinese columns in any order", () => {
    const text = lines("排名,点击率,展示次数,点击次数,热门查询", "3.2,8.3%,60,5,ai seo");
    expect(parseGsc(text).rows).toEqual([row("ai seo", 5, 60, 8.3, 3.2)]);
  });

  it("finds the query column under every query label", () => {
    const labels = ["Top queries", "Queries", "query", "热门查询", "查询", "Häufigste Suchanfragen", "Suchanfragen", "Suchanfrage"];
    expect(
      labels.map((label) => parseGsc(lines(`Clicks\t${label}\tImpressions`, "1\tai seo\t2")).rows),
    ).toEqual(labels.map(() => [row("ai seo", 1, 2, null, null)]));
  });

  it("leaves a metric null when the header has no column for it, even if the row has extra cells", () => {
    const text = lines("Top queries\tClicks\tImpressions", "ai seo\t5\t60\t8.3%\t3.2");
    expect(parseGsc(text).rows).toEqual([row("ai seo", 5, 60, null, null)]);
  });

  it("reads by position when the header names the query but no metric", () => {
    const text = lines("Query\tTotal clicks\tTotal impressions\tClick rate\tAvg. position", "ai seo\t5\t60\t8,3 %\t3,2");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("ai seo", 5, 60, 8.3, 3.2)],
      skipped: 0,
    });
  });

  it("counts a first record whose labels no alias set knows as skipped and reads the rest by position", () => {
    const text = lines("Zoekterm\tKlikken\tWeergaven\tRatio\tPlaats", "ai seo\t5\t60\t8,3 %\t3,2");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("ai seo", 5, 60, 8.3, 3.2)],
      skipped: 1,
    });
  });
});

describe("parseGsc: German headers", () => {
  it("reads a German semicolon export by label", () => {
    const text = lines("Häufigste Suchanfragen;Klicks;Impressionen;CTR;Position", "schuhe;5;100;5%;2,5");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("schuhe", 5, 100, 5, 2.5)],
      skipped: 0,
    });
  });

  it("reads reordered German columns under the alternative German labels", () => {
    const text = lines("Durchschnittliche Position;Klickrate;Impressionen;Klicks;Suchanfrage", "2,5;5%;100;5;schuhe");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("schuhe", 5, 100, 5, 2.5)],
      skipped: 0,
    });
  });

  it("matches a German label in capitals and with a decomposed umlaut", () => {
    const text = lines("POSITION\tHA\u0308UFIGSTE SUCHANFRAGEN\tKLICKS", "2,5\tschuhe\t5");
    expect(rowsAndSkipped(text)).toEqual({
      rows: [row("schuhe", 5, null, null, 2.5)],
      skipped: 0,
    });
  });
});

/**
 * What the import panel is allowed to say about the columns (Q7). The panel must
 * not infer "this column was not recognised" from "every row's value is null":
 * a recognised column whose cells are all blank looks exactly the same that way,
 * and naming it as unrecognised would send the user to fix a header that is fine.
 */
describe("parseGsc: header recognition metadata (Q7)", () => {
  const ALL_MAPPED = { clicks: true, impressions: true, ctr: true, position: true } as const;

  it("names the metrics a recognised header mapped, and the ones it did not", () => {
    const parsed = parseGsc(lines("Top queries\tClicks\tPosition", "ai seo\t5\t3.2"));
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.recognized).toEqual({ clicks: true, impressions: false, ctr: false, position: true });
    expect(parsed.rows).toEqual([row("ai seo", 5, null, null, 3.2)]);
  });

  it("reads the recognition off the header, not off the values: blank cells in a mapped column are not an unmapped column", () => {
    // Both pastes yield rows whose clicks are all null, so a check derived from
    // the row values could not tell the two apart.
    const blankCells = parseGsc(lines("Top queries\tClicks\tPosition", "ai seo\t\t3.2", "geo\t\t8.1"));
    const noColumn = parseGsc(lines("Top queries\tPosition", "ai seo\t3.2", "geo\t8.1"));
    expect(blankCells.rows.map((r) => r.clicks)).toEqual([null, null]);
    expect(noColumn.rows.map((r) => r.clicks)).toEqual([null, null]);
    expect(blankCells.recognized.clicks).toBe(true);
    expect(noColumn.recognized.clicks).toBe(false);
    // Same for a column that was mapped but whose cells are unreadable.
    const unreadable = parseGsc(lines("Top queries\tClicks\tPosition", "ai seo\tn/a\t3.2", "geo\t—\t8.1"));
    expect(unreadable.rows.map((r) => r.clicks)).toEqual([null, null]);
    expect(unreadable.recognized.clicks).toBe(true);
  });

  it("maps every metric under a recognised full header, in any language or order", () => {
    for (const header of [
      "Top queries\tClicks\tImpressions\tCTR\tPosition",
      "热门查询\t点击次数\t展示次数\t点击率\t排名",
      "Position\tCTR\tImpressions\tClicks\tQueries",
    ]) {
      const parsed = parseGsc(lines(header, "ai seo\t5\t60\t8.3\t3.2"));
      expect(parsed.headerDetected, header).toBe(true);
      expect(parsed.recognized, header).toEqual(ALL_MAPPED);
    }
  });

  it("reports no recognised header for a bare paste, while still mapping the export's column order", () => {
    const parsed = parseGsc(lines("ai seo\t5\t60\t8.3%\t3.2", "geo\t1\t2\t3%\t4"));
    expect(parsed.headerDetected).toBe(false);
    // Positional fallback: the four metrics do have columns, they were just never
    // named. `headerDetected` is what tells a reader the mapping was assumed.
    expect(parsed.recognized).toEqual(ALL_MAPPED);
    expect(parsed.rows).toHaveLength(2);
  });

  it("reports no recognised header when the first record names the query but no metric", () => {
    const text = lines("Query\tTotal clicks\tTotal impressions\tClick rate\tAvg. position", "ai seo\t5\t60\t8,3 %\t3,2");
    const parsed = parseGsc(text);
    expect(parsed.headerDetected).toBe(false);
    expect(parsed.recognized).toEqual(ALL_MAPPED);
    // The record was still taken for a header: it is not a row and not a skip.
    expect(parsed.rows).toEqual([row("ai seo", 5, 60, 8.3, 3.2)]);
    expect(parsed.skipped).toBe(0);
  });

  it("reports no recognised header when no label is known, and counts that record as skipped", () => {
    const parsed = parseGsc(lines("Zoekterm\tKlikken\tWeergaven\tRatio\tPlaats", "ai seo\t5\t60\t8,3 %\t3,2"));
    expect(parsed.headerDetected).toBe(false);
    expect(parsed.recognized).toEqual(ALL_MAPPED);
    expect(parsed.skipped).toBe(1);
  });

  it("reports the same metadata for an empty paste as for a bare one: nothing was recognised", () => {
    for (const text of ["", "\n\r\n", "\uFEFF"]) {
      const parsed = parseGsc(text);
      expect(parsed.headerDetected, JSON.stringify(text)).toBe(false);
      expect(parsed.recognized, JSON.stringify(text)).toEqual(ALL_MAPPED);
      expect(parsed.rows, JSON.stringify(text)).toEqual([]);
    }
  });
});
