import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import type { ParsedGsc } from "./gsc.ts";
import { parseGsc } from "./gsc.ts";

/** Cell-level parsing: delimiter choice and locale numbers. Record structure lives in gsc.test.ts, headers in gsc-columns.test.ts. */
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

describe("parseGsc: delimiters", () => {
  it("reads a semicolon export with comma decimals", () => {
    const text = lines(
      "Top queries;Clicks;Impressions;CTR;Position",
      "ai seo;1.234;56;0,8%;12,3",
      "geo;7;1.000.000;0,01 %;1,5",
      "",
    );
    expect(rowsAndSkipped(text)).toEqual({
      rows: [
        row("ai seo", 1234, 56, 0.8, 12.3),
        row("geo", 7, 1000000, 0.01, 1.5),
      ],
      skipped: 0,
    });
  });

  it("reads a header-less semicolon export with comma decimals", () => {
    expect(parseGsc("ai seo;12;1.234;0,8%;12,3").rows).toEqual([
      row("ai seo", 12, 1234, 0.8, 12.3),
    ]);
  });

  it("scores several records: commas in the first query do not beat a consistent semicolon layout", () => {
    const text = "seo, geo, aeo;1;2;0,8%;12,3\nnext;5;6;7,5%;8,2";
    expect(rowsAndSkipped(text)).toEqual({
      rows: [
        row("seo, geo, aeo", 1, 2, 0.8, 12.3),
        row("next", 5, 6, 7.5, 8.2),
      ],
      skipped: 0,
    });
  });

  it("prefers commas over a semicolon inside an unquoted query", () => {
    expect(parseGsc("seo; geo,1,2,3%,4").rows).toEqual([
      row("seo; geo", 1, 2, 3, 4),
    ]);
  });

  it("prefers tabs over commas and semicolons", () => {
    expect(parseGsc("a, b; c\t1,5\t2\t3%\t4").rows).toEqual([
      row("a, b; c", 1.5, 2, 3, 4),
    ]);
  });
});

describe("parseGsc: counts are quantities, not spellings", () => {
  const impressionsOf = (cell: string): number | null =>
    parseGsc(`q\t1\t${cell}\t3%\t4`).rows[0]?.impressions ?? null;

  it("reads thousands separators in every common spelling", () => {
    expect([
      impressionsOf("1,234"),
      impressionsOf("1.234"),
      impressionsOf("1 234"),
      impressionsOf("1\u00a0234"),
      impressionsOf("1\u202f234"),
      impressionsOf("1,234,567"),
      impressionsOf("1.234.567"),
      impressionsOf("1'234"),
      impressionsOf("1\u2019234"),
      impressionsOf("12\u2019345\u2019678"),
    ]).toEqual([1234, 1234, 1234, 1234, 1234, 1234567, 1234567, 1234, 1234, 12345678]);
  });

  it("reads Indian lakh grouping", () => {
    expect([
      impressionsOf("1,23,456"),
      impressionsOf("12,34,567"),
      impressionsOf("1,00,00,000"),
    ]).toEqual([123456, 1234567, 10000000]);
  });

  it("reads a leading-zero comma as the decimal point, as it reads 0,5, never as lakh grouping", () => {
    expect([impressionsOf("0,5"), impressionsOf("0,123"), impressionsOf("0,005")]).toEqual([0.5, 0.123, 0.005]);
    expect([impressionsOf("0,12,345"), impressionsOf("0,123.5")]).toEqual([null, null]);
    expect([impressionsOf("1,23,456"), impressionsOf("10,00,000")]).toEqual([123456, 1000000]);
    expect(rowsAndSkipped(lines("Query;Clicks;Impressions;CTR;Position", "shoes;0,005;0,123;5%;7"))).toEqual({
      rows: [row("shoes", 0.005, 0.123, 5, 7)],
      skipped: 0,
    });
  });

  it("takes the last of mixed separators as the decimal point", () => {
    expect([
      impressionsOf("1,234.5"),
      impressionsOf("1.234,5"),
      impressionsOf("12,345,678.25"),
    ]).toEqual([1234.5, 1234.5, 12345678.25]);
  });

  it("reads a lone separator that cannot be a thousands group as a decimal point", () => {
    expect([
      impressionsOf("1234.5"),
      impressionsOf("1234,567"),
      impressionsOf("12,3456"),
    ]).toEqual([1234.5, 1234.567, 12.3456]);
  });

  it("returns null for malformed grouping instead of guessing", () => {
    expect([
      impressionsOf("12,34.5"),
      impressionsOf("1.2.3"),
      impressionsOf("12,3,456"),
      impressionsOf("1.234,5,6"),
      impressionsOf("1'23"),
      impressionsOf(".5"),
      impressionsOf("5."),
    ]).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("parseGsc: ctr and position are decimal-first", () => {
  const ctrOf = (cell: string): number | null =>
    parseGsc(`q\t1\t2\t${cell}\t4`).rows[0]?.ctr ?? null;
  const positionOf = (cell: string): number | null =>
    parseGsc(`q\t1\t2\t3%\t${cell}`).rows[0]?.position ?? null;

  it("reads 0.8%, 0,8 %, 0.8 and 0,8 as the same percent", () => {
    expect([
      ctrOf("0.8%"),
      ctrOf("0,8 %"),
      ctrOf("0.8"),
      ctrOf("0,8"),
      ctrOf(" 0.8 % "),
    ]).toEqual([0.8, 0.8, 0.8, 0.8, 0.8]);
  });

  it("reads a lone separator before three digits as the decimal point, never as thousands", () => {
    expect([ctrOf("0.123"), ctrOf("0,125%"), ctrOf("1.125%"), ctrOf("1,234")]).toEqual([
      0.123, 0.125, 1.125, 1.234,
    ]);
    expect([positionOf("1.125"), positionOf("1,125")]).toEqual([1.125, 1.125]);
    expect(parseGsc("q;1;2;3,5%;1,125").rows).toEqual([row("q", 1, 2, 3.5, 1.125)]);
  });

  it("returns null for grouped spellings: a CTR or rank never needs thousands", () => {
    expect([
      positionOf("1.234.567"),
      positionOf("1,234.5"),
      positionOf("1'234"),
      ctrOf("1,234,567%"),
    ]).toEqual([null, null, null, null]);
  });
});

describe("parseGsc: percent signs", () => {
  const ctrOf = (cell: string): number | null => parseGsc(`q\t1\t2\t${cell}\t4`).rows[0]?.ctr ?? null;

  it("does not stitch digits together across a stray or repeated percent sign", () => {
    expect(rowsAndSkipped("x;1%2;100;5%%;0%5")).toEqual({ rows: [row("x", null, 100, null, null)], skipped: 0 });
    expect(rowsAndSkipped(lines("Query;Clicks;Impressions;CTR;Position", "x;1%2;100;5%%;0%5"))).toEqual({
      rows: [row("x", null, 100, null, null)],
      skipped: 0,
    });
  });

  it("accepts one trailing percent sign on the CTR, spaces allowed", () => {
    expect([ctrOf("5%"), ctrOf("5,5 %"), ctrOf("0.05"), ctrOf(" 5 % ")]).toEqual([5, 5.5, 0.05, 5]);
  });

  it("returns null for a CTR with a leading, internal or second percent sign", () => {
    expect([ctrOf("%5"), ctrOf("0%5"), ctrOf("5%%"), ctrOf("5 % %"), ctrOf("%")]).toEqual([null, null, null, null, null]);
  });

  it("returns null for a percent sign in clicks, impressions or position", () => {
    expect(rowsAndSkipped("q\t5%\t60%\t3%\t4%")).toEqual({ rows: [row("q", null, null, 3, null)], skipped: 0 });
  });
});

describe("parseGsc: unavailable is null, never 0", () => {
  it("returns null for missing or non-numeric cells", () => {
    expect(parseGsc("q\t\t2\tn/a\t—").rows).toEqual([
      row("q", null, 2, null, null),
    ]);
    expect(parseGsc("q,5").rows).toEqual([row("q", 5, null, null, null)]);
  });

  it("returns null for signs and exponents: GSC metrics are plain non-negative numbers", () => {
    expect(parseGsc("q\t-1\t+2\t1e2\t4").rows).toEqual([
      row("q", null, null, null, 4),
    ]);
  });

  it("returns null for a plain number too large to represent", () => {
    const huge = "9".repeat(320);
    expect(parseGsc(`q\t${huge}\t2\t3%\t${huge}`).rows).toEqual([
      row("q", null, 2, 3, null),
    ]);
  });

  it("keeps real zeros: zero clicks, zero impressions and 0% CTR are observed values", () => {
    expect(parseGsc("q\t0\t0\t0%\t12").rows).toEqual([row("q", 0, 0, 0, 12)]);
  });

  it("stores a position of 0 or below as null: it is not a real rank", () => {
    expect(
      parseGsc(lines("a\t1\t2\t3%\t0", "b\t1\t2\t3%\t0.0", "c\t1\t2\t3%\t-2"))
        .rows,
    ).toEqual([
      row("a", 1, 2, 3, null),
      row("b", 1, 2, 3, null),
      row("c", 1, 2, 3, null),
    ]);
  });

  it("keeps the query as trimmed original text, not normalized", () => {
    expect(parseGsc("  Best  SEO Tools  \t1\t2\t3%\t4").rows).toEqual([
      row("Best  SEO Tools", 1, 2, 3, 4),
    ]);
  });
});
