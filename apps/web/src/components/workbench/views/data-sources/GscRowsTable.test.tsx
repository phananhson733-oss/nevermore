/** @vitest-environment jsdom */

/**
 * The rows table can lie in four ways, each pinned here:
 *
 * - print 0 (or nothing) where a number is not there, instead of "—";
 * - call rows with no usable position "unranked" — missing evidence stated as
 *   an observed negative (codex #5);
 * - label the operator's own rows as sample data, or fail to label the sample's
 *   (Q6: the marker follows `gscRowsSource`, never unconditionally);
 * - swap the two numbers in "showing the first N of M" (Step 4b). The sentence
 *   is asserted whole, as a literal, with 60 and 402: the catalogue test cannot
 *   see a swap (both arguments are present), and building the expectation from
 *   the catalogue would reproduce whatever order the component passed.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { GscRow, GscRowsSource } from "@/lib/workbench/types";
import { Chip, type ChipTone } from "../../ui/Chip.tsx";
import { DS_PROJECT_ID, gscRow, mountPlain, type DsLocale } from "./data-sources-test-harness.tsx";
import { GSC_TABLE_LIMIT, GscRowsTable } from "./GscRowsTable.tsx";

let cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function render(rows: readonly GscRow[], source: GscRowsSource | null = "user", locale: DsLocale = "en"): HTMLElement {
  const mounted = mountPlain(<GscRowsTable projectId={DS_PROJECT_ID} rows={rows} source={source} />, locale);
  cleanups = [...cleanups, mounted.unmount];
  return mounted.container;
}

function manyRows(count: number): readonly GscRow[] {
  return Array.from({ length: count }, (_, i) => gscRow(`query ${i}`, i, i * 10, 1, 5));
}

function bodyRows(scope: HTMLElement): readonly HTMLTableRowElement[] {
  return [...scope.querySelectorAll("tbody tr")].filter((tr): tr is HTMLTableRowElement => tr instanceof HTMLTableRowElement);
}

function cellTexts(tr: HTMLTableRowElement): readonly string[] {
  return [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
}

function chipClass(tone: ChipTone): string {
  const mounted = mountPlain(<Chip tone={tone}>x</Chip>);
  const className = mounted.container.querySelector("span")?.className ?? "";
  mounted.unmount();
  return className;
}

describe("GscRowsTable: empty", () => {
  it("shows the empty state and no table, count or keyword link", () => {
    const scope = render([], null);
    expect(scope.textContent).toContain("No GSC rows yet");
    expect(scope.querySelector("table")).toBeNull();
    expect(scope.querySelector("[data-wb-gsc-count]")).toBeNull();
    expect(scope.querySelector("a")).toBeNull();
  });
});

describe("GscRowsTable: the first rows and how many there are", () => {
  it("renders the first 60 of 402 rows and says so in that order (en)", () => {
    const scope = render(manyRows(402));
    expect(GSC_TABLE_LIMIT).toBe(60);
    expect(bodyRows(scope)).toHaveLength(60);
    expect(scope.querySelector("[data-wb-showing]")?.textContent).toBe("Showing the first 60 of 402 rows");
    expect(scope.querySelector("[data-wb-gsc-count]")?.textContent).toBe("402 rows");
    expect(cellTexts(bodyRows(scope)[59] as HTMLTableRowElement)[0]).toBe("query 59");
  });

  it("says the same in zh-CN, whose sentence orders the numbers the same way", () => {
    const scope = render(manyRows(402), "user", "zh-CN");
    expect(scope.querySelector("[data-wb-showing]")?.textContent).toBe("显示前 60 行，共 402 行");
  });

  it("does not say it at exactly 60 rows, and does at 61", () => {
    expect(render(manyRows(60)).querySelector("[data-wb-showing]")).toBeNull();
    expect(render(manyRows(61)).querySelector("[data-wb-showing]")?.textContent).toBe("Showing the first 60 of 61 rows");
  });
});

describe("GscRowsTable: cells", () => {
  it("prints a dash for a missing number and keeps a real zero", () => {
    const scope = render([gscRow("no numbers", 0, null, null, null)]);
    expect(cellTexts(bodyRows(scope)[0] as HTMLTableRowElement)).toEqual(["no numbers", "0", "—", "—", "—", "Unknown"]);
  });

  it("formats counts, CTR as the percent it is stored as, and position", () => {
    const scope = render([gscRow("seo tool", 1234, 56789, 0.7, 14.2)]);
    expect(cellTexts(bodyRows(scope)[0] as HTMLTableRowElement)).toEqual([
      "seo tool",
      "1,234",
      "56,789",
      "0.7%",
      "14.2",
      "Near page one",
    ]);
  });

  it("labels each status from the enum catalogue, with the neutral tone for unknown", () => {
    const scope = render([
      gscRow("ranked", 1, 1, 1, 4),
      gscRow("borderline", 1, 1, 1, 14),
      gscRow("gap", 1, 1, 1, 40),
      gscRow("unknown", 1, 1, 1, null),
    ]);
    const chips = bodyRows(scope).map((tr) => tr.querySelector("td:last-child span span") ?? tr.querySelector("td:last-child span"));
    expect(chips.map((chip) => chip?.textContent)).toEqual(["Ranking", "Near page one", "Gap", "Unknown"]);
    expect(chips.map((chip) => chip?.className)).toEqual([
      chipClass("seo"),
      chipClass("warn"),
      chipClass("bad"),
      chipClass("neutral"),
    ]);
  });
});

describe("GscRowsTable: rows with an unknown position", () => {
  it("counts them as unknown, never as unranked", () => {
    const scope = render([gscRow("a", 1, 1, 1, null), gscRow("b", 1, 1, 1, null), gscRow("c", 1, 1, 1, 8)]);
    expect(scope.querySelector("[data-wb-unknown-rank]")?.textContent).toBe("2 rows with an unknown position");
    expect(scope.textContent?.toLowerCase()).not.toContain("unranked");
    expect(scope.textContent?.toLowerCase()).not.toContain("no ranking");
  });

  it("says it in zh-CN as 排名未知, not 无排名", () => {
    const scope = render([gscRow("a", 1, 1, 1, null), gscRow("b", 1, 1, 1, null)], "user", "zh-CN");
    expect(scope.querySelector("[data-wb-unknown-rank]")?.textContent).toBe("2 条排名未知");
    expect(scope.textContent).not.toContain("无排名");
  });

  it("says nothing when every row has a position", () => {
    expect(render([gscRow("c", 1, 1, 1, 8)]).querySelector("[data-wb-unknown-rank]")).toBeNull();
  });
});

describe("GscRowsTable: the sample marker follows gscRowsSource (Q6)", () => {
  const rows = [gscRow("seo tool", 3, 90, 3.3, 7.5)];

  it("marks sample rows, once, in the table's header", () => {
    const scope = render(rows, "sample");
    const marks = scope.querySelectorAll("[data-wb-gsc-sample]");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("Sample data");
  });

  it.each([
    ["user", "en", "sample"],
    ["user", "zh-CN", "示例"],
    [null, "en", "sample"],
    [null, "zh-CN", "示例"],
  ] as const)("does not mark %s rows as sample (%s)", (source, locale, word) => {
    const scope = render(rows, source, locale);
    expect(scope.querySelector("[data-wb-gsc-sample]")).toBeNull();
    expect(scope.textContent?.toLowerCase()).not.toContain(word);
  });
});

describe("GscRowsTable: structure", () => {
  it("links to the keyword matrix and renders no inline style", () => {
    const scope = render([gscRow("seo tool", 3, 90, 3.3, 7.5)]);
    expect(scope.querySelector("a")?.getAttribute("href")).toBe(`/p/${DS_PROJECT_ID}/keywords`);
    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
