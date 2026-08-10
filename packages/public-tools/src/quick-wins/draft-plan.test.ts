import { describe, expect, it } from "vitest";

import type {
  GscPageRow,
  GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import { MAX_DRAFT_ROWS, planDrafts } from "./draft-plan.ts";
import type { QuickWinEvidenceRow } from "./types.ts";

function row(query: string, clickGap: number): QuickWinEvidenceRow {
  return {
    query,
    position: 9,
    bucketId: "8-11",
    impressions: 3000,
    clicks: 3,
    observedCtr: 0.001,
    baselineCtr: 0.006,
    expectedClicks: 18,
    clickGap,
    tailProbability: 0.0001,
    baselineBandUnderOnePercent: false,
    track: "read_the_serp",
  };
}

function page(url: string, impressions: number, clicks: number): GscPageRow {
  return { page: url, impressions, clicks, position: 9 };
}

function carries(query: string, url: string): GscQueryPageRow {
  return { query, page: url, impressions: 900, clicks: 1, position: 9 };
}

/** A page set where every query has a strong same-band comparable. */
function healthyPages(queries: readonly string[]) {
  const pages: GscPageRow[] = [page("https://x.test/strong", 2000, 400)];
  const queryPages: GscQueryPageRow[] = [];
  for (const q of queries) {
    pages.push(page(`https://x.test/${q}`, 3000, 3));
    queryPages.push(carries(q, `https://x.test/${q}`));
  }
  return { pages, queryPages };
}

describe("planDrafts", () => {
  it("plans at most MAX_DRAFT_ROWS tasks, taking the largest gaps first", () => {
    const queries = Array.from(
      { length: MAX_DRAFT_ROWS + 3 },
      (_, i) => `q${i}`,
    );
    const { pages, queryPages } = healthyPages(queries);
    // Ascending gap, so the planner must reorder rather than take the first N.
    const rows = queries.map((q, i) => row(q, i + 1));

    const plan = planDrafts({
      rows,
      pages,
      queryPages,
      coverage: new Map(queries.map((q) => [q, 1])),
    });

    expect(plan.tasks).toHaveLength(MAX_DRAFT_ROWS);
    expect(plan.tasks[0]?.query).toBe(`q${queries.length - 1}`);
  });

  it("caps the crawl to the pages those tasks actually name", () => {
    // The crawl budget is the reason MAX_DRAFT_ROWS exists. Every extra task
    // is two more third-party requests inside a request the visitor is
    // watching.
    const queries = Array.from(
      { length: MAX_DRAFT_ROWS + 3 },
      (_, i) => `q${i}`,
    );
    const { pages, queryPages } = healthyPages(queries);

    const plan = planDrafts({
      rows: queries.map((q, i) => row(q, i + 1)),
      pages,
      queryPages,
      coverage: new Map(queries.map((q) => [q, 1])),
    });

    // MAX_DRAFT_ROWS subjects plus the one shared comparable.
    expect(plan.urlsToFetch).toHaveLength(MAX_DRAFT_ROWS + 1);
    expect(new Set(plan.urlsToFetch).size).toBe(plan.urlsToFetch.length);
  });

  it("records why a row got no task instead of dropping it silently", () => {
    const plan = planDrafts({
      rows: [row("uncovered", 10)],
      pages: [page("https://x.test/a", 3000, 3)],
      queryPages: [carries("uncovered", "https://x.test/a")],
      coverage: new Map([["uncovered", 0.2]]),
    });

    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.get("uncovered")).toBe("low_dimension_coverage");
  });

  it("skips rows that beat their own curve", () => {
    // A negative gap is a page doing well. Drafting a rewrite for it would be
    // the tool inventing work.
    const { pages, queryPages } = healthyPages(["winner"]);

    const plan = planDrafts({
      rows: [row("winner", -5)],
      pages,
      queryPages,
      coverage: new Map([["winner", 1]]),
    });

    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.get("winner")).toBe("no_shortfall");
  });

  it("carries both pages' CTRs into the task so the prompt can cite them", () => {
    const { pages, queryPages } = healthyPages(["q"]);

    const plan = planDrafts({
      rows: [row("q", 15)],
      pages,
      queryPages,
      coverage: new Map([["q", 1]]),
    });

    const task = plan.tasks[0];
    expect(task).toBeDefined();
    expect(task!.subjectPage).toBe("https://x.test/q");
    expect(task!.comparablePage).toBe("https://x.test/strong");
    expect(task!.subjectCtr).toBeCloseTo(0.001);
    expect(task!.comparableCtr).toBeCloseTo(0.2);
  });

  it("only blames the cap for rows that would otherwise have got a task", () => {
    // The cap used to be checked before the comparable search, so every row
    // past the budget was labelled "beyond the per-run cap" — including rows
    // that have no comparable page and would have produced nothing at any
    // budget. That reads as "raise the cap and you get a draft", which is a
    // promise the evidence does not support.
    const withComparable = Array.from(
      { length: MAX_DRAFT_ROWS + 1 },
      (_, i) => `has-comparable-${i}`,
    );
    const { pages, queryPages } = healthyPages(withComparable);

    // One more row whose subject page has no same-band peer at all: it sits
    // at position 1 while every other page in the set sits at 9.
    pages.push({
      page: "https://x.test/lonely",
      impressions: 3000,
      clicks: 3,
      position: 1,
    });
    queryPages.push(carries("lonely", "https://x.test/lonely"));

    const queries = [...withComparable, "lonely"];
    const plan = planDrafts({
      // Smallest gap, so it sorts last and lands well past the cap.
      rows: [
        ...withComparable.map((q, i) => row(q, 100 + i)),
        row("lonely", 1),
      ],
      pages,
      queryPages,
      coverage: new Map(queries.map((q) => [q, 1])),
    });

    expect(plan.tasks).toHaveLength(MAX_DRAFT_ROWS);
    // The row that lost to the budget says so.
    expect(plan.skipped.get("has-comparable-0")).toBe("beyond_draft_cap");
    // The row that had nothing to copy says THAT, cap or no cap.
    expect(plan.skipped.get("lonely")).toBe("no_comparable_high_ctr_page");
  });

  it("returns an empty plan for an empty table rather than throwing", () => {
    const plan = planDrafts({
      rows: [],
      pages: [],
      queryPages: [],
      coverage: new Map(),
    });

    expect(plan.tasks).toEqual([]);
    expect(plan.urlsToFetch).toEqual([]);
  });
});
