import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import { parseGsc } from "./gsc.ts";

/** Cell-level parsing: header detection, delimiter choice and locale numbers. Record structure lives in gsc.test.ts. */
const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

describe("parseGsc: header detection", () => {
  it("only looks at the first record: a repeated header later is a skipped row, not data", () => {
    const text = lines(
      "a,1,2,3%,4",
      "Top queries,Clicks,Impressions,CTR,Position",
      "b,5,6,7%,8",
    );
    expect(parseGsc(text)).toEqual({
      rows: [row("a", 1, 2, 3, 4), row("b", 5, 6, 7, 8)],
      skipped: 1,
    });
  });

  it("does not take a first data line with one missing number for a header", () => {
    expect(parseGsc("new query,,40,,").rows).toEqual([
      row("new query", null, 40, null, null),
    ]);
  });

  it("does not take a two-cell first line for a header", () => {
    expect(parseGsc(lines("Query,Clicks", "a,1,2,3%,4"))).toEqual({
      rows: [row("a", 1, 2, 3, 4)],
      skipped: 1,
    });
  });
});

describe("parseGsc: delimiters", () => {
  it("reads a semicolon export with comma decimals", () => {
    const text = lines(
      "Top queries;Clicks;Impressions;CTR;Position",
      "ai seo;1.234;56;0,8%;12,3",
      "geo;7;1.000.000;0,01 %;1,5",
      "",
    );
    expect(parseGsc(text)).toEqual({
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

describe("parseGsc: numbers are quantities, not spellings", () => {
  const ctrOf = (cell: string): number | null =>
    parseGsc(`q\t1\t2\t${cell}\t4`).rows[0]?.ctr ?? null;
  const impressionsOf = (cell: string): number | null =>
    parseGsc(`q\t1\t${cell}\t3%\t4`).rows[0]?.impressions ?? null;

  it("reads 0.8%, 0,8 %, 0.8 and 0,8 as the same percent", () => {
    expect([
      ctrOf("0.8%"),
      ctrOf("0,8 %"),
      ctrOf("0.8"),
      ctrOf("0,8"),
      ctrOf(" 0.8 % "),
    ]).toEqual([0.8, 0.8, 0.8, 0.8, 0.8]);
  });

  it("reads thousands separators in every common spelling", () => {
    expect([
      impressionsOf("1,234"),
      impressionsOf("1.234"),
      impressionsOf("1 234"),
      impressionsOf("1\u00a0234"),
      impressionsOf("1\u202f234"),
      impressionsOf("1,234,567"),
      impressionsOf("1.234.567"),
    ]).toEqual([1234, 1234, 1234, 1234, 1234, 1234567, 1234567]);
  });

  it("takes the last of mixed separators as the decimal point", () => {
    expect([
      impressionsOf("1,234.5"),
      impressionsOf("1.234,5"),
      impressionsOf("12,345,678.25"),
    ]).toEqual([1234.5, 1234.5, 12345678.25]);
  });

  it("reads a leading-zero group as a decimal, never as thousands", () => {
    expect([ctrOf("0.123"), ctrOf("0,125%")]).toEqual([0.123, 0.125]);
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
      impressionsOf("1,23,456"),
      impressionsOf("1.234,5,6"),
      impressionsOf(".5"),
      impressionsOf("5."),
    ]).toEqual([null, null, null, null, null, null]);
  });

  it("returns null for missing or non-numeric cells, never 0", () => {
    expect(parseGsc("q\t\t2\tn/a\t—").rows).toEqual([
      row("q", null, 2, null, null),
    ]);
    expect(parseGsc("q,5").rows).toEqual([row("q", 5, null, null, null)]);
  });

  it("returns null for signs and exponents: GSC metrics are plain non-negative numbers", () => {
    // A data line first: a first record whose clicks and impressions are both unreadable is a header by design.
    expect(parseGsc(lines("a\t1\t2\t3%\t4", "q\t-1\t+2\t1e2\t4")).rows).toEqual(
      [row("a", 1, 2, 3, 4), row("q", null, null, null, 4)],
    );
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
