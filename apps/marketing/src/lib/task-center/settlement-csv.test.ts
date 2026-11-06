// @input  -- settlement CSV text in our template and its edge cases
// @output -- proof that only clean files become rows, and amounts become exact minor units
// @pos    -- unit test for settlement-csv.ts and admin.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { isTaskAdminEmail } from "./admin.ts";
import {
  currencyExponent,
  isKnownCurrency,
  MAX_SETTLEMENT_BYTES,
  parseSettlementCsv,
  toMinorUnits,
} from "./settlement-csv.ts";

describe("parseSettlementCsv", () => {
  it("reads the template, with a BOM, CRLF and quoted cells", () => {
    const text =
      "﻿date,code,orders,ad_amount,income\r\n" +
      "2026-11-04,K7M2XQ9P,12,30.50,8.25\r\n" +
      '"2026/11/5","k7m2xq9p",,"1000",\r\n' +
      "\r\n";
    expect(parseSettlementCsv(text, "USD")).toEqual({
      ok: true,
      rows: [
        { day: "2026-11-04", code: "k7m2xq9p", orders: 12, adAmountMinor: 3050, incomeMinor: 825 },
        { day: "2026-11-05", code: "k7m2xq9p", orders: null, adAmountMinor: 100000, incomeMinor: null },
      ],
    });
  });

  it("accepts Chinese headers and a currency without minor units", () => {
    const text = "日期,推广码,收益\n2026-11-04,k7m2xq9p,1500\n";
    expect(parseSettlementCsv(text, "JPY")).toEqual({
      ok: true,
      rows: [{ day: "2026-11-04", code: "k7m2xq9p", orders: null, adAmountMinor: null, incomeMinor: 1500 }],
    });
    expect(parseSettlementCsv("日期,推广码,收益\n2026-11-04,k7m2xq9p,15.5\n", "JPY")).toMatchObject({
      ok: false,
      problems: [{ line: 2, problem: "bad_income" }],
    });
  });

  it("names every bad line instead of importing part of a file", () => {
    const text = [
      "date,code,orders,income",
      "2026-02-30,k7m2xq9p,1,1",
      "2026-11-04,o0o0o0o0,1,1",
      "2026-11-04,k7m2xq9p,-1,1",
      "2026-11-04,k7m2xq9p,1,1.234",
      "2026-11-04,k7m2xq9p,,",
      "2026-11-04,k7m2xq9p,1,1",
      "2026-11-04,K7M2XQ9P,2,2",
    ].join("\n");
    expect(parseSettlementCsv(text, "USD")).toEqual({
      ok: false,
      problems: [
        { line: 2, problem: "bad_date" },
        { line: 3, problem: "bad_code" },
        { line: 4, problem: "bad_orders" },
        { line: 5, problem: "bad_income" },
        { line: 6, problem: "no_figures" },
        { line: 8, problem: "duplicate_row" },
      ],
    });
  });

  it("refuses a file without the columns it needs, or without rows", () => {
    expect(parseSettlementCsv("date,code\n2026-11-04,k7m2xq9p\n", "USD")).toEqual({
      ok: false,
      problems: [{ line: 1, problem: "missing_columns" }],
    });
    expect(parseSettlementCsv("date,code,income\n", "USD")).toEqual({
      ok: false,
      problems: [{ line: 1, problem: "empty_file" }],
    });
    expect(parseSettlementCsv('date,code,income\n"2026-11-04,k7m2xq9p,1\n', "USD")).toEqual({
      ok: false,
      // The line the open quote starts on, not the header.
      problems: [{ line: 2, problem: "unbalanced_quotes" }],
    });
  });

  it("refuses what could be read two ways", () => {
    // An unquoted thousands separator splits 1,000.00 into two cells.
    expect(parseSettlementCsv("date,code,income\n2026-11-04,k7m2xq9p,1,000.00\n", "USD")).toEqual({
      ok: false,
      problems: [{ line: 2, problem: "extra_cells" }],
    });
    // Here the empty income is what was pushed past the end: 1,000.00 is not 1.00 with no income.
    expect(parseSettlementCsv("date,code,orders,ad_amount,income\n2026-11-04,k7m2xq9p,12,1,000.00,\n", "USD")).toEqual({
      ok: false,
      problems: [{ line: 2, problem: "extra_cells" }],
    });
    // Short rows are fine: the missing trailing figures are unknown.
    expect(parseSettlementCsv("date,code,orders,income\n2026-11-04,k7m2xq9p,3\n", "USD")).toMatchObject({ ok: true });
    expect(parseSettlementCsv('date,code,income\n2026-11-04,k7m2xq9p,"1"2\n', "USD")).toEqual({
      ok: false,
      problems: [{ line: 2, problem: "text_after_quote" }],
    });
    expect(parseSettlementCsv("date,code,income,收益\n2026-11-04,k7m2xq9p,0,100.00\n", "USD")).toEqual({
      ok: false,
      problems: [{ line: 1, problem: "duplicate_column" }],
    });
  });

  it("limits the file by its UTF-8 bytes, not its UTF-16 length", () => {
    const text = `date,code,income,note\n2026-11-04,k7m2xq9p,1,${"中".repeat(750_000)}\n`;
    expect(text.length).toBeLessThan(MAX_SETTLEMENT_BYTES);
    expect(parseSettlementCsv(text, "USD")).toEqual({ ok: false, problems: [{ line: 1, problem: "too_large" }] });
  });

  it("counts lines across a quoted newline", () => {
    const text = 'date,code,income\n2026-11-04,k7m2xq9p,"1\n"\n2026-11-04,bad,1\n';
    expect(parseSettlementCsv(text, "USD")).toEqual({
      ok: false,
      problems: [{ line: 4, problem: "bad_code" }],
    });
  });
});

describe("minor units", () => {
  it("converts on the string, never through a float", () => {
    expect(toMinorUnits("0.29", 2)).toBe(29);
    expect(toMinorUnits("1.1", 2)).toBe(110);
    expect(toMinorUnits("12", 2)).toBe(1200);
    expect(toMinorUnits("1.", 2)).toBeNull();
    expect(toMinorUnits("1e3", 2)).toBeNull();
    expect(toMinorUnits("99999999999999999", 2)).toBeNull();
  });

  it("knows currencies from Intl", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(isKnownCurrency("USD")).toBe(true);
    expect(isKnownCurrency("usd")).toBe(false);
    expect(isKnownCurrency("ZZZ")).toBe(false);
  });
});

describe("isTaskAdminEmail", () => {
  const env = { TASK_ADMIN_EMAILS: " Ops@GenGrowth.ai, ,other@example.com" };

  it("matches case-insensitively and ignores blank entries", () => {
    expect(isTaskAdminEmail("ops@gengrowth.ai", env)).toBe(true);
    expect(isTaskAdminEmail(" OTHER@example.com ", env)).toBe(true);
    expect(isTaskAdminEmail("someone@gengrowth.ai", env)).toBe(false);
  });

  it("never lets a missing email or an empty list through", () => {
    expect(isTaskAdminEmail(null, env)).toBe(false);
    expect(isTaskAdminEmail("", env)).toBe(false);
    expect(isTaskAdminEmail("ops@gengrowth.ai", {})).toBe(false);
  });
});
