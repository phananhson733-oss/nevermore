import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import { parseGsc } from "./gsc.ts";

/**
 * A first record is a header only when it names a column (codex S10a #1). A
 * record whose FIRST cell is a metric label and that names no query column
 * anywhere is not one: the first column is where the query is read from when
 * no label names it, so taking such a record as a header maps that metric onto
 * the query column and reads every following query as that metric. On a
 * header-less paste whose first query happens to be spelled `position`, the
 * next row was skipped (`shoes`), or its query was stored as a rank (`2026`
 * became position 2026) and replaced the operator's saved rows.
 *
 * Headers that name the query column, or whose metric labels sit beside an
 * unnamed first column, are read as before.
 */

const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

describe("parseGsc: a first query spelled like a metric is data, not a header", () => {
  it("keeps the next row's numbers when the first query is `position`", () => {
    const parsed = parseGsc(lines("position\t-\t-\t-\t-", "shoes\t3\t4\t5\t6"));
    expect(parsed.rows).toEqual([row("shoes", 3, 4, 5, 6)]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.headerDetected).toBe(false);
    expect(parsed.recognized).toBeNull();
  });

  it("does not store a numeric query as a position", () => {
    const parsed = parseGsc(lines("position\t-\t-\t-\t-", "2026\t3\t4\t5\t6"));
    expect(parsed.rows).toEqual([row("2026", 3, 4, 5, 6)]);
    expect(parsed.skipped).toBe(1);
  });

  it("applies to every metric label, in every supported language", () => {
    for (const label of ["Clicks", "impressions", "CTR", "点击次数", "Durchschnittliche Position"]) {
      const parsed = parseGsc(lines(`${label}\t-\t-\t-\t-`, "shoes\t3\t4\t5\t6"));
      expect(parsed.rows, label).toEqual([row("shoes", 3, 4, 5, 6)]);
      expect(parsed.headerDetected, label).toBe(false);
    }
  });
});

describe("parseGsc: real headers are still headers", () => {
  it("reads a partial header that names the query column: Query,Position", () => {
    const parsed = parseGsc(lines("Query,Position", "shoes,6", "boots,12"));
    expect(parsed.rows).toEqual([row("shoes", null, null, null, 6), row("boots", null, null, null, 12)]);
    expect(parsed.skipped).toBe(0);
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.recognized).toEqual({ clicks: false, impressions: false, ctr: false, position: true });
  });

  it("reads a header whose metric labels come first when a later cell names the query", () => {
    const parsed = parseGsc(lines("Position\tClicks\tQuery", "6\t3\tshoes"));
    expect(parsed.rows).toEqual([row("shoes", 3, null, null, 6)]);
    expect(parsed.headerDetected).toBe(true);
  });

  it("reads a header whose first column is unnamed and whose metrics sit beside it", () => {
    const parsed = parseGsc(lines("Keyword\tClicks\tPosition", "shoes\t3\t6"));
    expect(parsed.rows).toEqual([row("shoes", 3, null, null, 6)]);
    expect(parsed.headerDetected).toBe(true);
  });
});
