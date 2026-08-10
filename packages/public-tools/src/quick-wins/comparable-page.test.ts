import { describe, expect, it } from "vitest";

import type {
  GscPageRow,
  GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import {
  MIN_COMPARABLE_PAGE_IMPRESSIONS,
  MIN_CTR_ADVANTAGE,
  buildComparablePageIndex,
  selectComparablePage,
  selectComparablePageFrom,
} from "./comparable-page.ts";

function page(
  url: string,
  impressions: number,
  clicks: number,
  position = 9,
): GscPageRow {
  return { page: url, impressions, clicks, position };
}

function carries(
  query: string,
  url: string,
  impressions = 900,
): GscQueryPageRow {
  return { query, page: url, impressions, clicks: 1, position: 9 };
}

const SUBJECT = "https://example.com/weak";

describe("selectComparablePage", () => {
  it("names a same-band page that earns clearly more", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.subjectPage).toBe(SUBJECT);
    expect(result.comparablePage).toBe("https://example.com/strong");
    // Named so a reader can check what the draft was modelled on. A draft
    // whose source cannot be inspected is a generic template.
    expect(result.comparableCtr).toBeCloseTo(0.1);
    expect(result.subjectCtr).toBeCloseTo(0.001);
  });

  it("refuses when the page split does not cover the query", () => {
    // Search Console drops rows in a [query,page] split. Without coverage we
    // do not know which page actually carries the query, so naming one would
    // be a guess presented as evidence.
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 0.4,
    });

    expect(result.kind).toBe("low_dimension_coverage");
  });

  it("refuses when coverage is unavailable", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [page(SUBJECT, 3000, 3)],
      queryPages: [carries("q", SUBJECT)],
      coverage: null,
    });

    expect(result.kind).toBe("low_dimension_coverage");
  });

  it("refuses when no page in the band earns clearly more", () => {
    // No comparable page means no draft. Falling back to a generic template
    // is exactly what got drafts cut from v1 in the first place.
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 30),
        page("https://example.com/similar", 2000, 21),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    expect(result.kind).toBe("no_comparable_high_ctr_page");
  });

  it("ignores candidates without enough impressions of their own", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 3),
        page(
          "https://example.com/lucky",
          MIN_COMPARABLE_PAGE_IMPRESSIONS - 1,
          50,
        ),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    // 50/99 is a huge rate, and it is one click away from being a different
    // number. A baseline drawn from it is noise wearing a percentage sign.
    expect(result.kind).toBe("no_comparable_high_ctr_page");
  });

  it("only compares pages in the same position band", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 3, 9),
        // Position 2 earns more for reasons that have nothing to do with how
        // it is worded.
        page("https://example.com/top", 2000, 400, 2),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    expect(result.kind).toBe("no_comparable_high_ctr_page");
  });

  it("picks the strongest qualifying candidate", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/ok", 2000, 100),
        page("https://example.com/best", 2000, 300),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.comparablePage).toBe("https://example.com/best");
  });

  it("refuses when the query has no identifiable subject page", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [page("https://example.com/strong", 2000, 200)],
      queryPages: [],
      coverage: 1,
    });

    expect(result.kind).toBe("no_subject_page");
  });

  it("picks the page carrying most of the query as the subject", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [
        page("https://example.com/minor", 3000, 3),
        page(SUBJECT, 3000, 3),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [
        {
          query: "q",
          page: "https://example.com/minor",
          impressions: 100,
          clicks: 0,
          position: 9,
        },
        { query: "q", page: SUBJECT, impressions: 900, clicks: 1, position: 9 },
      ],
      coverage: 1,
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.subjectPage).toBe(SUBJECT);
  });

  it("never names the subject as its own comparable", () => {
    const result = selectComparablePage({
      query: "q",
      pages: [page(SUBJECT, 3000, 300)],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    });

    expect(result.kind).toBe("no_comparable_high_ctr_page");
  });

  it("exposes the advantage threshold it applied", () => {
    expect(MIN_CTR_ADVANTAGE).toBeGreaterThan(1);
  });
});

describe("selectComparablePageFrom", () => {
  /**
   * The indexed path exists only so the planner can ask this question for
   * every row without rebuilding the page map each time. It is worth having
   * only if it answers identically, so every scenario is run both ways and
   * compared — a divergence here is a silently different draft, or a silently
   * different reason for not having one.
   */
  const SCENARIOS: readonly {
    readonly name: string;
    readonly pages: readonly GscPageRow[];
    readonly queryPages: readonly GscQueryPageRow[];
    readonly coverage: number | null;
  }[] = [
    {
      name: "a clear winner in the same band",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "two candidates tied on rate",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/first", 2000, 200),
        page("https://example.com/second", 1000, 100),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "the only candidate is the subject itself",
      pages: [page(SUBJECT, 3000, 300)],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "the best candidate misses the advantage threshold",
      pages: [
        page(SUBJECT, 3000, 300),
        page("https://example.com/near", 2000, 210),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "the candidate is under the impression floor",
      pages: [
        page(SUBJECT, 3000, 3),
        page(
          "https://example.com/thin",
          MIN_COMPARABLE_PAGE_IMPRESSIONS - 1,
          200,
        ),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "the candidate sits in another band",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/top", 2000, 200, 1),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
    {
      name: "the split names a page we have no totals for",
      pages: [page("https://example.com/other", 2000, 200)],
      queryPages: [carries("q", "https://example.com/missing")],
      coverage: 1,
    },
    {
      name: "two split rows, the larger one wins the subject slot",
      pages: [
        page(SUBJECT, 3000, 3),
        page("https://example.com/minor", 3000, 3),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [
        carries("q", "https://example.com/minor", 100),
        carries("q", SUBJECT, 900),
      ],
      coverage: 1,
    },
    {
      name: "coverage too low to name a subject",
      pages: [page(SUBJECT, 3000, 3)],
      queryPages: [carries("q", SUBJECT)],
      coverage: 0.1,
    },
    {
      name: "coverage unknown",
      pages: [page(SUBJECT, 3000, 3)],
      queryPages: [carries("q", SUBJECT)],
      coverage: null,
    },
    {
      name: "a subject earning nothing at all",
      pages: [
        page(SUBJECT, 3000, 0),
        page("https://example.com/strong", 2000, 200),
      ],
      queryPages: [carries("q", SUBJECT)],
      coverage: 1,
    },
  ];

  for (const scenario of SCENARIOS) {
    it(`agrees with the single-pass version: ${scenario.name}`, () => {
      const direct = selectComparablePage({ query: "q", ...scenario });
      const indexed = selectComparablePageFrom(
        buildComparablePageIndex(scenario.pages, scenario.queryPages),
        { query: "q", coverage: scenario.coverage },
      );

      expect(indexed).toEqual(direct);
    });
  }

  it("answers many queries from one index", () => {
    const pages = [
      page("https://example.com/a", 3000, 3),
      page("https://example.com/b", 3000, 6),
      page("https://example.com/strong", 2000, 200),
    ];
    const queryPages = [
      carries("a", "https://example.com/a"),
      carries("b", "https://example.com/b"),
    ];
    const index = buildComparablePageIndex(pages, queryPages);

    for (const query of ["a", "b"]) {
      expect(
        selectComparablePageFrom(index, { query, coverage: 1 }),
        query,
      ).toEqual(
        selectComparablePage({ query, pages, queryPages, coverage: 1 }),
      );
    }
  });
});
