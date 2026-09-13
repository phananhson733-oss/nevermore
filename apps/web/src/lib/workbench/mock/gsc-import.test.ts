import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import { parseGsc } from "./gsc.ts";
import { dedupeGscRows, GSC_IMPORT_MAX_ROWS, importGsc } from "./gsc-import.ts";
import { buildRows } from "./keywords.ts";

/**
 * The import boundary's one ruling (T10 Step 1b): a query that appears twice
 * keeps the row it appeared with FIRST, and nothing is added together. Whether
 * the second row is the same export pasted twice or another date range cannot
 * be told from a `GscRow` (no page, no country, no dates), so summing would
 * double a real click count in the first case and weighting would invent an
 * average in both. The duplicates are disclosed instead, as part of "skipped".
 *
 * Every metric below is distinct per row, so "kept the first", "kept the
 * last" and "summed" produce three different rows and each is a separate red.
 */

const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

describe("importGsc: repeated queries", () => {
  it("keeps the first occurrence of a repeated query, unchanged, and counts the rest as skipped duplicates", () => {
    const result = importGsc(
      lines(
        "seo tool\t10\t100\t1%\t4",
        "other query\t1\t50\t2%\t12",
        "seo tool\t20\t300\t5%\t9",
      ),
    );
    expect(result.rows).toEqual([row("seo tool", 10, 100, 1, 4), row("other query", 1, 50, 2, 12)]);
    expect(result.duplicates).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.parsed).toBe(2);
  });

  it("treats spellings that normQ folds together as one query and keeps the first spelling with its own numbers", () => {
    const result = importGsc(
      lines(
        "SEO  Tool\t10\t100\t1%\t4",
        "ｓｅｏ tool\t20\t300\t5%\t9",
        " seo tool \t30\t700\t7%\t15",
      ),
    );
    // First row, verbatim: not 60 clicks (summed), not 30 (last), not a weighted position.
    expect(result.rows).toEqual([row("SEO  Tool", 10, 100, 1, 4)]);
    expect(result.duplicates).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.parsed).toBe(1);
  });

  it("adds duplicates to the parser's own skips without folding one count into the other", () => {
    const result = importGsc(
      lines(
        "Query\tClicks\tImpressions\tCTR\tPosition",
        "seo tool\t10\t100\t1%\t4",
        "lonely query without numbers",
        "seo tool\t20\t300\t5%\t9",
        "geo tool\t3\t40\t2%\t22",
      ),
    );
    expect(result.rows.map((entry) => entry.query)).toEqual(["seo tool", "geo tool"]);
    expect(result.duplicates).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.parsed).toBe(2);
  });

  it("reports zero duplicates and the parser's own counts when every query is distinct", () => {
    const text = lines("a\t1\t10\t1%\t3", "b\t2\t20\t2%\t13", "c\t3\t30\t3%\t33", "no metrics here");
    const parsed = parseGsc(text);
    const result = importGsc(text);
    expect(result.rows).toEqual(parsed.rows);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(parsed.skipped);
    expect(result.skipped).toBe(1);
    expect(result.parsed).toBe(3);
  });
});

describe("importGsc: row cap", () => {
  it("caps at GSC_IMPORT_MAX_ROWS by default and says how many unique rows there were", () => {
    const text = Array.from({ length: GSC_IMPORT_MAX_ROWS + 2 }, (_, i) => `query ${i}\t1\t10\t1%\t5`).join("\n");
    const result = importGsc(text);
    expect(GSC_IMPORT_MAX_ROWS).toBe(5000);
    expect(result.rows).toHaveLength(5000);
    expect(result.parsed).toBe(5002);
    expect(result.rows.at(-1)?.query).toBe("query 4999");
  });

  it("applies the cap after removing duplicates, so a repeated row does not take a unique row's place", () => {
    const result = importGsc(
      lines("a\t1\t10\t1%\t3", "A\t9\t90\t9%\t9", "b\t2\t20\t2%\t13", "c\t3\t30\t3%\t33", "d\t4\t40\t4%\t43"),
      3,
    );
    expect(result.rows.map((entry) => entry.query)).toEqual(["a", "b", "c"]);
    expect(result.parsed).toBe(4);
    expect(result.duplicates).toBe(1);
    // Cut rows are not "skipped": they parsed, and the truncation line names them.
    expect(result.skipped).toBe(1);
  });

  it("does not cap a result at or under the limit", () => {
    const result = importGsc(lines("a\t1\t10\t1%\t3", "b\t2\t20\t2%\t13", "c\t3\t30\t3%\t33"), 3);
    expect(result.rows).toHaveLength(3);
    expect(result.parsed).toBe(3);
  });
});

describe("importGsc: header metadata", () => {
  it("passes parseGsc's header detection and recognised columns through untouched", () => {
    const text = lines("Query,Clicks,Position", "seo tool,10,4", "seo tool,20,9");
    const parsed = parseGsc(text);
    const result = importGsc(text);
    expect(result.headerDetected).toBe(true);
    expect(result.recognized).toEqual({ clicks: true, impressions: false, ctr: false, position: true });
    expect(result.headerDetected).toBe(parsed.headerDetected);
    expect(result.recognized).toEqual(parsed.recognized);
  });

  it("keeps `recognized` null when no header named a metric", () => {
    const result = importGsc(lines("seo tool\t10\t100\t1%\t4"));
    expect(result.headerDetected).toBe(false);
    expect(result.recognized).toBeNull();
  });
});

describe("dedupeGscRows", () => {
  it("drops a row whose query folds to nothing and counts it apart from duplicates", () => {
    // parseGsc trims queries, so this shape does not come out of a paste today;
    // `buildRows` filters it all the same, and the import must not keep a row
    // the keyword matrix would silently drop.
    const result = dedupeGscRows([row("　", 1, 1, 1, 1), row("seo", 2, 2, 2, 2), row("SEO", 3, 3, 3, 3)]);
    expect(result.rows).toEqual([row("seo", 2, 2, 2, 2)]);
    expect(result.duplicates).toBe(1);
    expect(result.blank).toBe(1);
  });
});

describe("importGsc agrees with the keyword matrix on what one query is", () => {
  it("leaves buildRows nothing further to collapse among the imported GSC rows", () => {
    // buildRows has its own first-spelling-wins dedupe by normQ
    // (keywords.ts `dedupeByQuery`). If the import keyed on anything else, the
    // data-sources table and the overview's candidate count would disagree.
    const text = lines(
      "SEO  Tool\t10\t100\t1%\t4",
      "ｓｅｏ tool\t20\t300\t5%\t9",
      "Geo Tool\t3\t40\t2%\t22",
      "geo tool\t4\t50\t3%\t25",
      "answer engine\t5\t60\t4%\t31",
    );
    const imported = importGsc(text).rows;
    const matrix = buildRows([], { brand: "Example", competitors: "" }, imported).filter(
      (entry) => entry.source === "gsc",
    );
    expect(imported).toHaveLength(3);
    expect(matrix).toHaveLength(imported.length);
    expect(matrix.map((entry) => entry.clicks).toSorted()).toEqual([10, 3, 5].toSorted());
  });
});
