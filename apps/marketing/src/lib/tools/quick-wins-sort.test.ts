import { describe, expect, it } from "vitest";
import type { QuickWinEvidenceRow } from "@sf/public-tools";

import {
  DEFAULT_SORT,
  ariaSort,
  nextSort,
  sortEvidenceRows,
} from "./quick-wins-sort.ts";

function row(
  query: string,
  overrides: Partial<QuickWinEvidenceRow> = {},
): QuickWinEvidenceRow {
  return {
    query,
    position: 8.4,
    bucketId: "8-11",
    impressions: 1000,
    clicks: 5,
    observedCtr: 0.005,
    baselineCtr: 0.01,
    expectedClicks: 10,
    clickGap: 5,
    tailProbability: 0.02,
    baselineBandUnderOnePercent: false,
    ...overrides,
  };
}

function queries(rows: readonly QuickWinEvidenceRow[]): string[] {
  return rows.map((r) => r.query);
}

describe("sortEvidenceRows", () => {
  it("does not mutate the array it was given", () => {
    const rows = [row("b", { clickGap: 1 }), row("a", { clickGap: 9 })];

    sortEvidenceRows(rows, { key: "clickGap", direction: "desc" });

    expect(queries(rows)).toEqual(["b", "a"]);
  });

  it("orders numbers in both directions", () => {
    const rows = [
      row("mid", { impressions: 500 }),
      row("high", { impressions: 900 }),
      row("low", { impressions: 100 }),
    ];

    expect(
      queries(sortEvidenceRows(rows, { key: "impressions", direction: "desc" })),
    ).toEqual(["high", "mid", "low"]);
    expect(
      queries(sortEvidenceRows(rows, { key: "impressions", direction: "asc" })),
    ).toEqual(["low", "mid", "high"]);
  });

  it("keeps unavailable values last in BOTH directions", () => {
    // A rate we could not compute is not the smallest rate. Letting null fall
    // to whichever end the direction implies would put "we do not know" at the
    // top of an ascending sort and read as "these are the worst".
    const rows = [
      row("known", { observedCtr: 0.02 }),
      row("unknown", { observedCtr: null }),
      row("other", { observedCtr: 0.001 }),
    ];

    expect(
      queries(sortEvidenceRows(rows, { key: "observedCtr", direction: "desc" })),
    ).toEqual(["known", "other", "unknown"]);
    expect(
      queries(sortEvidenceRows(rows, { key: "observedCtr", direction: "asc" })),
    ).toEqual(["other", "known", "unknown"]);
  });

  it("treats a non-finite number the same as an absent one", () => {
    // NaN compares false against everything, which makes a comparator
    // intransitive and the resulting order arbitrary. It has to be pulled out
    // before it reaches the comparison, not compared and hoped about.
    const rows = [
      row("nan", { clickGap: Number.NaN }),
      row("real", { clickGap: 3 }),
    ];

    expect(
      queries(sortEvidenceRows(rows, { key: "clickGap", direction: "desc" })),
    ).toEqual(["real", "nan"]);
    expect(
      queries(sortEvidenceRows(rows, { key: "clickGap", direction: "asc" })),
    ).toEqual(["real", "nan"]);
  });

  it("sorts the query column as text, not as a number", () => {
    const rows = [row("zebra"), row("apple"), row("Banana")];

    expect(
      queries(sortEvidenceRows(rows, { key: "query", direction: "asc" })),
    ).toEqual(["apple", "Banana", "zebra"]);
  });

  it("preserves the engine's order between equal values", () => {
    // The rows arrive sorted by gap. A tie in the column being sorted is not a
    // licence to reshuffle the ordering the engine already established.
    const rows = [row("first"), row("second"), row("third")];

    expect(
      queries(sortEvidenceRows(rows, { key: "impressions", direction: "desc" })),
    ).toEqual(["first", "second", "third"]);
  });
});

describe("nextSort", () => {
  it("opens a numeric column at its most interesting end", () => {
    expect(nextSort(DEFAULT_SORT, "impressions")).toEqual({
      key: "impressions",
      direction: "desc",
    });
  });

  it("opens the query column alphabetically", () => {
    expect(nextSort(DEFAULT_SORT, "query")).toEqual({
      key: "query",
      direction: "asc",
    });
  });

  it("reverses a column that is already sorted", () => {
    expect(nextSort({ key: "clicks", direction: "desc" }, "clicks")).toEqual({
      key: "clicks",
      direction: "asc",
    });
    expect(nextSort({ key: "clicks", direction: "asc" }, "clicks")).toEqual({
      key: "clicks",
      direction: "desc",
    });
  });
});

describe("ariaSort", () => {
  it("announces the direction only on the sorted column", () => {
    const sort = { key: "clickGap", direction: "desc" } as const;

    expect(ariaSort(sort, "clickGap")).toBe("descending");
    expect(ariaSort(sort, "clicks")).toBe("none");
    expect(ariaSort({ key: "clicks", direction: "asc" }, "clicks")).toBe(
      "ascending",
    );
  });
});

describe("DEFAULT_SORT", () => {
  it("is the order the engine already produced", () => {
    // The table opens showing what the engine ranked, so the first thing a
    // visitor sees is not a different reading of the same data.
    expect(DEFAULT_SORT).toEqual({ key: "clickGap", direction: "desc" });
  });
});
