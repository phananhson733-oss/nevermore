import { describe, expect, it } from "vitest";

import {
  KEYWORD_COVERAGE_MIN_IMPRESSIONS,
  KEYWORD_COVERAGE_STRONG_POSITION,
  KEYWORD_COVERAGE_TOKEN_OVERLAP,
  buildKeywordCoverageIndex,
  isKeywordAlreadyCovered,
  keywordTokens,
  observeKeywordCoverage,
} from "./coverage.ts";
import type {
  KeywordCoverageInventory,
  KeywordCoveragePage,
  KeywordCoverageQueryRow,
} from "./coverage.ts";
import { KEYWORD_OPPORTUNITY_COVERAGE_STATES } from "./types.ts";

function row(
  query: string,
  impressions: number,
  position: number,
): KeywordCoverageQueryRow {
  return { query, impressions, position };
}

function queryPageRow(
  query: string,
  page: string,
  impressions: number,
  position: number,
) {
  return { query, page, impressions, position };
}

/** A crawled page described by the words its title visibly targets. */
function page(url: string, title: string): KeywordCoveragePage {
  return { url, tokens: keywordTokens(title) };
}

const NO_PAGES: readonly KeywordCoveragePage[] = [];
const EMPTY_INDEX = buildKeywordCoverageIndex([]);

function inventory(
  urls: readonly string[],
  overrides: Partial<KeywordCoverageInventory> = {},
): KeywordCoverageInventory {
  return {
    urls,
    fetched: true,
    complete: true,
    documentsRead: 1,
    truncationReasons: [],
    ...overrides,
  };
}

const COMPLETE_EMPTY_INVENTORY = inventory([]);

describe("coverage thresholds", () => {
  it("pins the three numbers every other case in this file is written against", () => {
    // These are read back by the surface copy and by the funnel counts, so a
    // silent edit here would change what the tool tells a visitor is covered
    // without any assertion below going red.
    expect(KEYWORD_COVERAGE_MIN_IMPRESSIONS).toBe(10);
    expect(KEYWORD_COVERAGE_STRONG_POSITION).toBe(10);
    expect(KEYWORD_COVERAGE_TOKEN_OVERLAP).toBe(0.8);
  });
});

describe("keywordTokens", () => {
  it("keeps accented letters whole instead of splitting the word at the accent", () => {
    // Splitting "café" into "caf" would drop the overlap of a French title
    // below the threshold and report a covered page as an untouched opening.
    expect([...keywordTokens("Café Münster")]).toEqual(["café", "münster"]);
  });

  it("tokenizes CJK text, which carries no spaces to split on", () => {
    // Without \p{Letter} coverage of Han characters a Chinese candidate would
    // produce an empty token set and could never match any crawled page.
    expect([...keywordTokens("关键词工具 免费")]).toEqual([
      "关键词工具",
      "免费",
    ]);
  });

  it("drops punctuation and folds case so two spellings of one phrase compare equal", () => {
    expect([...keywordTokens("Best CRM, for  startups!")]).toEqual([
      "best",
      "crm",
      "for",
      "startups",
    ]);
  });

  it("counts digits as content, since version and year terms are real queries", () => {
    expect([...keywordTokens("crm 2026")]).toEqual(["crm", "2026"]);
  });

  it("deduplicates repeats so a title cannot inflate overlap by repeating a word", () => {
    expect(keywordTokens("crm crm crm").size).toBe(1);
  });

  it("returns an empty set for text with no letters or digits", () => {
    // relatedPage divides by this size, so an empty set has to be handled
    // before the division rather than produce NaN.
    expect(keywordTokens("--- ...").size).toBe(0);
    expect(keywordTokens("").size).toBe(0);
  });
});

describe("buildKeywordCoverageIndex", () => {
  it("weights position by impressions rather than keeping the best-placed row", () => {
    // One incidental first-place impression next to ninety-nine at position 40
    // is a query the site does not really serve. Taking the best row would
    // report it as strongly covered and hide the opening for the whole run.
    const index = buildKeywordCoverageIndex([
      row("best crm", 1, 1),
      row("best crm", 99, 40),
    ]);

    expect(index.get("best crm")?.impressions).toBe(100);
    expect(index.get("best crm")?.weightedPosition).toBeCloseTo(39.61, 5);
  });

  it("does not take the worst row either — the average is over impressions", () => {
    const index = buildKeywordCoverageIndex([
      row("best crm", 90, 2),
      row("best crm", 10, 40),
    ]);

    expect(index.get("best crm")?.weightedPosition).toBeCloseTo(5.8, 5);
  });

  it("ignores rows with no impressions, whose position is a number about nobody", () => {
    // A zero-impression row still carries a position value. Folding it in
    // would move the weighted average using a row that was never served, and
    // a query made only of such rows must not exist in the index at all.
    const index = buildKeywordCoverageIndex([
      row("ghost query", 0, 1),
      row("ghost query", -5, 1),
      row("real query", 20, 4),
      row("real query", 0, 100),
    ]);

    expect(index.has("ghost query")).toBe(false);
    expect(index.get("real query")?.impressions).toBe(20);
    expect(index.get("real query")?.weightedPosition).toBe(4);
  });

  it("folds case and whitespace variants into one bucket before weighting", () => {
    // Search Console reports these as separate rows; treating them separately
    // would split the impressions and drop both halves under the minimum.
    const index = buildKeywordCoverageIndex([
      row("Best CRM", 6, 3),
      row("best   crm", 6, 3),
    ]);

    expect(index.size).toBe(1);
    expect(index.get("best crm")?.impressions).toBe(12);
  });

  it("returns an empty index for an empty window instead of throwing", () => {
    expect(buildKeywordCoverageIndex([]).size).toBe(0);
  });

  it("retains the exact query metrics and attaches its positive query-page URL", () => {
    const index = buildKeywordCoverageIndex(
      [row("best crm", 40, 4)],
      [queryPageRow("best crm", "https://example.com/gsc-page", 12, 3)],
    );

    expect(index.get("best crm")).toEqual({
      impressions: 40,
      weightedPosition: 4,
      supportingPageUrl: "https://example.com/gsc-page",
    });
  });

  it("chooses a query-page winner by impressions, position, then URL", () => {
    const mostImpressions = buildKeywordCoverageIndex(
      [row("best crm", 100, 8)],
      [
        queryPageRow("best crm", "https://example.com/a", 9, 1),
        queryPageRow("best crm", "https://example.com/b", 10, 20),
      ],
    );
    const bestPosition = buildKeywordCoverageIndex(
      [row("best crm", 100, 8)],
      [
        queryPageRow("best crm", "https://example.com/a", 10, 5),
        queryPageRow("best crm", "https://example.com/b", 10, 4),
      ],
    );
    const urlTieBreak = buildKeywordCoverageIndex(
      [row("best crm", 100, 8)],
      [
        queryPageRow("best crm", "https://example.com/b", 10, 4),
        queryPageRow("best crm", "https://example.com/a", 10, 4),
      ],
    );

    expect(mostImpressions.get("best crm")?.supportingPageUrl).toBe(
      "https://example.com/b",
    );
    expect(bestPosition.get("best crm")?.supportingPageUrl).toBe(
      "https://example.com/b",
    );
    expect(urlTieBreak.get("best crm")?.supportingPageUrl).toBe(
      "https://example.com/a",
    );
  });

  it("uses a positive query-page row without requiring a complete split", () => {
    const index = buildKeywordCoverageIndex(
      [row("best crm", 100, 8)],
      [queryPageRow("best crm", "https://example.com/known", 1, 80)],
    );

    expect(index.get("best crm")?.supportingPageUrl).toBe(
      "https://example.com/known",
    );
  });

  it("does not turn an empty page or nonpositive metric into page evidence", () => {
    const index = buildKeywordCoverageIndex(
      [row("best crm", 100, 8)],
      [
        queryPageRow("best crm", "", 100, 1),
        queryPageRow("best crm", "https://example.com/zero", 0, 1),
        queryPageRow("best crm", "https://example.com/nan", Number.NaN, 1),
      ],
    );

    expect(index.get("best crm")?.supportingPageUrl).toBeNull();
  });
});

describe("observeKeywordCoverage", () => {
  it("calls an exact query with enough impressions and a top-ten average strongly covered", () => {
    const index = buildKeywordCoverageIndex([row("best crm", 40, 4)]);

    expect(observeKeywordCoverage("best crm", index, NO_PAGES)).toEqual({
      state: "observed_exact_strong",
      supportingPage: { state: "not_observed" },
      supportingPageUrl: null,
    });
  });

  it("calls the same query weakly covered once the weighted position leaves page one", () => {
    // Weak is still covered — the site serves the query — but it is the state
    // that tells the reader there is room to improve rather than nothing to do.
    const index = buildKeywordCoverageIndex([row("best crm", 40, 18)]);

    expect(observeKeywordCoverage("best crm", index, NO_PAGES).state).toBe(
      "observed_exact_weak",
    );
  });

  it("refuses to read one lucky first-place impression as strong coverage", () => {
    // The guard this whole module exists for: 1 impression at position 1 plus
    // 99 at position 40 averages to 39.61, so the verdict must be weak.
    const index = buildKeywordCoverageIndex([
      row("best crm", 1, 1),
      row("best crm", 99, 40),
    ]);

    expect(observeKeywordCoverage("best crm", index, NO_PAGES).state).toBe(
      "observed_exact_weak",
    );
  });

  it("treats a weighted position exactly at the strong threshold as strong", () => {
    const atBoundary = buildKeywordCoverageIndex([row("best crm", 10, 10)]);
    const justPast = buildKeywordCoverageIndex([row("best crm", 10, 10.5)]);

    expect(observeKeywordCoverage("best crm", atBoundary, NO_PAGES).state).toBe(
      "observed_exact_strong",
    );
    expect(observeKeywordCoverage("best crm", justPast, NO_PAGES).state).toBe(
      "observed_exact_weak",
    );
  });

  it("accepts exactly the minimum impressions and rejects one fewer", () => {
    const enough = buildKeywordCoverageIndex([row("best crm", 10, 3)]);
    const tooFew = buildKeywordCoverageIndex([row("best crm", 9, 3)]);

    expect(observeKeywordCoverage("best crm", enough, NO_PAGES).state).toBe(
      "observed_exact_strong",
    );
    expect(
      observeKeywordCoverage(
        "best crm",
        tooFew,
        NO_PAGES,
        null,
        COMPLETE_EMPTY_INVENTORY,
      ).state,
    ).toBe("not_observed_in_bounded_inventory");
  });

  it("lets a thin exact row fall through to the title check rather than deciding on it", () => {
    // Nine impressions cannot settle a position, but the site may still have a
    // page on the topic — the reader should see that page, labelled unverified.
    const tooFew = buildKeywordCoverageIndex([row("best crm", 9, 1)]);
    const pages = [page("https://example.com/crm", "Best CRM")];

    expect(observeKeywordCoverage("best crm", tooFew, pages)).toEqual({
      state: "related_coverage_unverified",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crm",
      },
      supportingPageUrl: "https://example.com/crm",
    });
  });

  it("matches a query only after normalization, so casing never splits the lookup", () => {
    const index = buildKeywordCoverageIndex([row("best crm", 40, 4)]);

    expect(observeKeywordCoverage("  Best   CRM ", index, NO_PAGES).state).toBe(
      "observed_exact_strong",
    );
  });

  it("attaches the overlapping page to an exact hit too, so the reader can open it", () => {
    const index = buildKeywordCoverageIndex([row("best crm", 40, 4)]);
    const pages = [page("https://example.com/crm", "The best CRM, reviewed")];

    expect(observeKeywordCoverage("best crm", index, pages)).toEqual({
      state: "observed_exact_strong",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crm",
      },
      supportingPageUrl: "https://example.com/crm",
    });
  });

  it("prefers the measured query-page URL to lexical and generator fallbacks", () => {
    const index = buildKeywordCoverageIndex(
      [row("best crm", 40, 4)],
      [queryPageRow("best crm", "https://example.com/gsc", 30, 4)],
    );
    const pages = [page("https://example.com/lexical", "Best CRM")];

    expect(
      observeKeywordCoverage(
        "best crm",
        index,
        pages,
        "https://example.com/attributed",
      ),
    ).toEqual({
      state: "observed_exact_strong",
      supportingPage: {
        state: "observed",
        source: "gsc_observed_query_page",
        url: "https://example.com/gsc",
      },
      supportingPageUrl: "https://example.com/gsc",
    });
  });

  it("keeps positive GSC and crawled-page evidence ahead of sitemap slug evidence", () => {
    const index = buildKeywordCoverageIndex([row("best crm", 40, 4)]);
    const pages = [page("https://example.com/crawled", "Best CRM")];
    const sitemap = inventory(["https://example.com/best-crm"]);

    expect(
      observeKeywordCoverage("best crm", index, pages, null, sitemap),
    ).toEqual({
      state: "observed_exact_strong",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crawled",
      },
      supportingPageUrl: "https://example.com/crawled",
    });

    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, pages, null, sitemap),
    ).toEqual({
      state: "related_coverage_unverified",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crawled",
      },
      supportingPageUrl: "https://example.com/crawled",
    });
  });

  it("reports title overlap as unverified, never as observed serving", () => {
    // Two pages sharing vocabulary is not proof either one ranks, so lexical
    // evidence tops out at related_coverage_unverified.
    const pages = [page("https://example.com/crm", "Best CRM for startups")];

    expect(
      observeKeywordCoverage("best crm for startups", EMPTY_INDEX, pages),
    ).toEqual({
      state: "related_coverage_unverified",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crm",
      },
      supportingPageUrl: "https://example.com/crm",
    });
  });

  it("accepts a title carrying exactly the required share of the candidate's tokens", () => {
    // Four of five tokens is 0.8 on the nose; the threshold is inclusive.
    const pages = [
      page("https://example.com/crm", "Best CRM software for you"),
    ];

    expect(
      observeKeywordCoverage(
        "best crm software for startups",
        EMPTY_INDEX,
        pages,
      ).state,
    ).toBe("related_coverage_unverified");
  });

  it("refuses a title that carries most but not enough of the candidate's tokens", () => {
    // Three of four tokens is 0.75. Calling that related would let a generic
    // page suppress a genuinely different candidate.
    const pages = [page("https://example.com/crm", "Best CRM guide")];

    expect(
      observeKeywordCoverage(
        "best crm for startups",
        EMPTY_INDEX,
        pages,
        null,
        COMPLETE_EMPTY_INVENTORY,
      ),
    ).toEqual({
      state: "not_observed_in_bounded_inventory",
      supportingPage: { state: "not_observed" },
      supportingPageUrl: null,
    });
  });

  it("returns the first page in crawl order when several titles clear the bar", () => {
    // The result is shown as a link, so the choice has to be deterministic
    // rather than dependent on set iteration luck.
    const pages = [
      page("https://example.com/a", "Best CRM"),
      page("https://example.com/b", "Best CRM too"),
    ];

    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, pages).supportingPageUrl,
    ).toBe("https://example.com/a");
  });

  it("matches an accented or CJK candidate against a crawled title", () => {
    const pages = [
      page("https://example.com/zh", "关键词工具 免费 在线"),
      page("https://example.com/fr", "Le meilleur logiciel de café"),
    ];

    expect(
      observeKeywordCoverage("关键词工具 免费", EMPTY_INDEX, pages)
        .supportingPageUrl,
    ).toBe("https://example.com/zh");
    expect(
      observeKeywordCoverage("logiciel café", EMPTY_INDEX, pages)
        .supportingPageUrl,
    ).toBe("https://example.com/fr");
  });

  it("says only that a term was not found in the complete bounded inventory", () => {
    expect(
      observeKeywordCoverage(
        "best crm",
        EMPTY_INDEX,
        NO_PAGES,
        null,
        COMPLETE_EMPTY_INVENTORY,
      ),
    ).toEqual({
      state: "not_observed_in_bounded_inventory",
      supportingPage: { state: "not_observed" },
      supportingPageUrl: null,
    });
  });

  it("reports inventory unavailable when no inventory travelled with the run", () => {
    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES).state,
    ).toBe("inventory_unavailable");
    expect(observeKeywordCoverage("best crm", null, NO_PAGES).state).toBe(
      "inventory_unavailable",
    );
  });

  it("reports an unavailable fetch and an incomplete fetch separately", () => {
    const unavailable = inventory([], {
      fetched: false,
      complete: false,
      documentsRead: 0,
      truncationReasons: ["document_unavailable"],
    });
    const truncated = inventory(["https://example.com/other"], {
      complete: false,
      truncationReasons: ["url_cap"],
    });

    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES, null, unavailable)
        .state,
    ).toBe("inventory_unavailable");
    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES, null, truncated)
        .state,
    ).toBe("inventory_truncated");
  });

  it("uses only normalized URL path tokens for a possible existing page", () => {
    const sitemap = inventory([
      "https://example.com/products/caf%C3%A9-crm?source=secret-keyword",
    ]);

    expect(
      observeKeywordCoverage("café crm", EMPTY_INDEX, NO_PAGES, null, sitemap),
    ).toEqual({
      state: "possible_existing_page",
      supportingPage: {
        state: "observed",
        source: "inventory_url_match",
        url: "https://example.com/products/caf%C3%A9-crm?source=secret-keyword",
      },
      supportingPageUrl:
        "https://example.com/products/caf%C3%A9-crm?source=secret-keyword",
    });
    expect(
      observeKeywordCoverage(
        "secret keyword",
        EMPTY_INDEX,
        NO_PAGES,
        null,
        sitemap,
      ).state,
    ).toBe("not_observed_in_bounded_inventory");
  });

  it("keeps a slug match possible even when the inventory is truncated", () => {
    const sitemap = inventory(["https://example.com/best-crm"], {
      complete: false,
      truncationReasons: ["token_budget"],
    });

    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES, null, sitemap),
    ).toEqual({
      state: "possible_existing_page",
      supportingPage: {
        state: "observed",
        source: "inventory_url_match",
        url: "https://example.com/best-crm",
      },
      supportingPageUrl: "https://example.com/best-crm",
    });
  });

  it("ignores a malformed pathname without throwing or claiming no page exists", () => {
    const malformed = inventory(["https://example.com/%E0%A4%A"]);

    expect(() =>
      observeKeywordCoverage(
        "best crm",
        EMPTY_INDEX,
        NO_PAGES,
        null,
        malformed,
      ),
    ).not.toThrow();
    expect(
      observeKeywordCoverage(
        "best crm",
        EMPTY_INDEX,
        NO_PAGES,
        null,
        malformed,
      ).state,
    ).toBe("inventory_truncated");
  });

  it("still reads the crawled pages when the query sample was never read", () => {
    // Page similarity comes from the crawl, not Search Console, so losing one
    // must not silently disable the other — the GEO lane is judged on it.
    const pages = [page("https://example.com/crm", "Best CRM")];

    expect(observeKeywordCoverage("best crm", null, pages)).toEqual({
      state: "related_coverage_unverified",
      supportingPage: {
        state: "observed",
        source: "lexical_page_match",
        url: "https://example.com/crm",
      },
      supportingPageUrl: "https://example.com/crm",
    });
  });

  it("names the page a candidate was attributed to without claiming coverage", () => {
    // A question is mostly grammar, so token overlap finds nothing for it —
    // the first live run matched none of its 44 question-form candidates. The
    // generator already said which page the claim came from, and that is a
    // supporting page. It is NOT evidence the site ranks, so the state stays
    // exactly where the absence of evidence left it.
    expect(
      observeKeywordCoverage(
        "can i audit a website without owning it",
        EMPTY_INDEX,
        [page("https://example.com/audit", "Free SEO audit")],
        "https://example.com/audit",
        COMPLETE_EMPTY_INVENTORY,
      ),
    ).toEqual({
      state: "not_observed_in_bounded_inventory",
      supportingPage: {
        state: "observed",
        source: "llm_proposition_source",
        url: "https://example.com/audit",
      },
      supportingPageUrl: "https://example.com/audit",
    });
  });

  it("prefers what a page says over what the generator attributed", () => {
    // Overlap is computed from the page's own words; attribution is an
    // assertion about where a claim came from. When both are available the
    // measured one wins.
    expect(
      observeKeywordCoverage(
        "best crm",
        EMPTY_INDEX,
        [page("https://example.com/crm", "Best CRM")],
        "https://example.com/somewhere-else",
      ).supportingPageUrl,
    ).toBe("https://example.com/crm");
  });

  it("survives a candidate with no tokens instead of dividing by zero", () => {
    // An empty wanted-set would make every page match at NaN >= 0.8 (false) or,
    // worse, 0/0. The guard returns before the division.
    const pages = [page("https://example.com/crm", "Best CRM")];

    expect(
      observeKeywordCoverage(
        "!!!",
        EMPTY_INDEX,
        pages,
        null,
        COMPLETE_EMPTY_INVENTORY,
      ),
    ).toEqual({
      state: "not_observed_in_bounded_inventory",
      supportingPage: { state: "not_observed" },
      supportingPageUrl: null,
    });
  });

  it("survives a crawled page with an empty token set", () => {
    const pages = [page("https://example.com/empty", "---")];

    expect(
      observeKeywordCoverage(
        "best crm",
        EMPTY_INDEX,
        pages,
        null,
        COMPLETE_EMPTY_INVENTORY,
      ).state,
    ).toBe("not_observed_in_bounded_inventory");
  });
});

describe("isKeywordAlreadyCovered", () => {
  it("withholds a row only on measured Search Console serving", () => {
    expect(isKeywordAlreadyCovered("observed_exact_strong")).toBe(true);
    expect(isKeywordAlreadyCovered("observed_exact_weak")).toBe(true);
  });

  it("keeps a lexically related row visible, because hiding it loses real openings", () => {
    // The Tranche 1 spike: title overlap alone misfired badly when the crawl
    // never reached the site's product pages. A guess must not delete a row.
    expect(isKeywordAlreadyCovered("related_coverage_unverified")).toBe(false);
    expect(isKeywordAlreadyCovered("not_observed_in_gsc_query_sample")).toBe(
      false,
    );
    expect(isKeywordAlreadyCovered("possible_existing_page")).toBe(false);
    expect(isKeywordAlreadyCovered("not_observed_in_bounded_inventory")).toBe(
      false,
    );
    expect(isKeywordAlreadyCovered("inventory_unavailable")).toBe(false);
    expect(isKeywordAlreadyCovered("inventory_truncated")).toBe(false);
  });

  it("answers for every coverage state the contract declares", () => {
    // A state added to the union without a decision here would silently take
    // the false branch and start showing rows the site already serves.
    const decided = KEYWORD_OPPORTUNITY_COVERAGE_STATES.filter((state) =>
      isKeywordAlreadyCovered(state),
    );

    expect(decided).toEqual(["observed_exact_strong", "observed_exact_weak"]);
  });
});
