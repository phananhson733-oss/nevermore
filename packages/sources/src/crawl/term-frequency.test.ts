import { describe, expect, it } from "vitest";

import {
  buildTermFrequencyTables,
  TERM_TABLE_LIMITS,
  unitStream,
} from "./term-frequency.ts";

describe("unitStream", () => {
  it("counts a CJK character as one unit and keeps the order", () => {
    expect(unitStream("星盘 chart").map((unit) => unit.text)).toEqual([
      "星",
      "盘",
      "chart",
    ]);
  });

  it("merges everything non-CJK in one chunk into a single unit", () => {
    // The frozen counter removes the CJK code points and splits what is left,
    // so this chunk is three units and not four. Reading a phrase off the
    // stream has to agree with the total printed beside it.
    expect(unitStream("SEO工具checker").map((unit) => unit.text)).toEqual([
      "seochecker",
      "工",
      "具",
    ]);
  });

  it("strips the punctuation a word carries at either end", () => {
    expect(unitStream("(Pricing), plans!").map((unit) => unit.text)).toEqual([
      "pricing",
      "plans",
    ]);
  });
});

describe("buildTermFrequencyTables", () => {
  const body =
    "free birth chart calculator " +
    "free birth chart calculator " +
    "free birth chart reading " +
    "the astrology of the natal chart";

  it("ranks phrases of every length from one unit to five", () => {
    const tables = buildTermFrequencyTables(body);

    expect(tables.map((table) => table.size)).toEqual([1, 2, 3, 4, 5]);
    expect(tables[0]?.rows[0]).toEqual({ phrase: "chart", count: 4 });
    expect(tables[2]?.rows[0]).toEqual({
      phrase: "free birth chart",
      count: 3,
    });
  });

  it("keeps a stop word inside a phrase and out of the one-word table", () => {
    const tables = buildTermFrequencyTables(body);
    const single = tables.find((table) => table.size === 1);
    const triples = tables.find((table) => table.size === 3);

    // "the" appears three times and would otherwise lead the one-word table.
    expect(single?.rows.map((row) => row.phrase)).not.toContain("the");
    // But it is part of a phrase someone actually writes.
    expect(triples?.rows.map((row) => row.phrase)).toContain(
      "the astrology of",
    );
  });

  it("joins CJK phrases without inventing spaces", () => {
    const tables = buildTermFrequencyTables("免费星盘计算器 免费星盘计算器");
    const triples = tables.find((table) => table.size === 3);

    expect(triples?.rows[0]).toEqual({ phrase: "免费星", count: 2 });
  });

  it("orders ties by phrase so two runs over one page agree", () => {
    const tables = buildTermFrequencyTables("beta alpha gamma");
    expect(tables[0]?.rows.map((row) => row.phrase)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("stays inside its row budget", () => {
    const many = Array.from({ length: 200 }, (_, index) => `term${index}`).join(
      " ",
    );
    const tables = buildTermFrequencyTables(many);

    for (const table of tables) {
      expect(table.rows.length).toBeLessThanOrEqual(
        TERM_TABLE_LIMITS.rowsPerSize,
      );
    }
  });

  it("returns nothing for a page with no body text", () => {
    expect(buildTermFrequencyTables("")).toEqual([]);
  });
});

describe("phrases that span a mixed-script chunk", () => {
  it("does not invent a phrase the page never shows", () => {
    // `SEO工具checker` counts as three units, but the non-CJK half is
    // `seochecker` — two pieces of the source that are not next to each other.
    // A two-unit phrase built across it reads `seochecker工`, which appears
    // nowhere on the page.
    const tables = buildTermFrequencyTables("SEO工具checker SEO工具checker");
    const pairs = tables.find((table) => table.size === 2);

    expect(tables[0]?.rows.map((row) => row.phrase)).toContain("seochecker");
    for (const row of pairs?.rows ?? []) {
      expect(row.phrase).not.toContain("seochecker");
    }
  });

  it("still builds phrases across ordinary CJK text", () => {
    const tables = buildTermFrequencyTables("免费星盘计算器 免费星盘计算器");
    expect(tables.find((table) => table.size === 2)?.rows[0]?.phrase).toBe("免费");
  });
});
