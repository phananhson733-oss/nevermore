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

/** A crawled page described by the words its title visibly targets. */
function page(url: string, title: string): KeywordCoveragePage {
  return { url, tokens: keywordTokens(title) };
}

const NO_PAGES: readonly KeywordCoveragePage[] = [];
const EMPTY_INDEX = buildKeywordCoverageIndex([]);

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
});

describe("observeKeywordCoverage", () => {
  it("calls an exact query with enough impressions and a top-ten average strongly covered", () => {
    const index = buildKeywordCoverageIndex([row("best crm", 40, 4)]);

    expect(observeKeywordCoverage("best crm", index, NO_PAGES)).toEqual({
      state: "observed_exact_strong",
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
    expect(observeKeywordCoverage("best crm", tooFew, NO_PAGES).state).toBe(
      "not_observed_in_gsc_query_sample",
    );
  });

  it("lets a thin exact row fall through to the title check rather than deciding on it", () => {
    // Nine impressions cannot settle a position, but the site may still have a
    // page on the topic — the reader should see that page, labelled unverified.
    const tooFew = buildKeywordCoverageIndex([row("best crm", 9, 1)]);
    const pages = [page("https://example.com/crm", "Best CRM")];

    expect(observeKeywordCoverage("best crm", tooFew, pages)).toEqual({
      state: "related_coverage_unverified",
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
      supportingPageUrl: "https://example.com/crm",
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
      observeKeywordCoverage("best crm for startups", EMPTY_INDEX, pages),
    ).toEqual({
      state: "not_observed_in_gsc_query_sample",
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

  it("says nothing was observed when there is neither a query row nor a page", () => {
    // Spelled out in full because Search Console anonymises a large share of
    // queries: this is "we did not see it", not "the site does not rank".
    expect(observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES)).toEqual({
      state: "not_observed_in_gsc_query_sample",
      supportingPageUrl: null,
    });
  });

  it("separates a sample that was read and came back empty from one never read", () => {
    // The dishonesty the first live run shipped: the Search Console read
    // failed on every request and every row still said "not observed in the
    // sample" — a positive claim about a sample nobody fetched. An empty map
    // is a real answer (a property that served nothing); null is the absence
    // of one, and the two must never collapse.
    expect(
      observeKeywordCoverage("best crm", EMPTY_INDEX, NO_PAGES).state,
    ).toBe("not_observed_in_gsc_query_sample");
    expect(observeKeywordCoverage("best crm", null, NO_PAGES).state).toBe(
      "gsc_query_sample_not_read",
    );
  });

  it("still reads the crawled pages when the query sample was never read", () => {
    // Page similarity comes from the crawl, not Search Console, so losing one
    // must not silently disable the other — the GEO lane is judged on it.
    const pages = [page("https://example.com/crm", "Best CRM")];

    expect(observeKeywordCoverage("best crm", null, pages)).toEqual({
      state: "related_coverage_unverified",
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
      ),
    ).toEqual({
      state: "not_observed_in_gsc_query_sample",
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

    expect(observeKeywordCoverage("!!!", EMPTY_INDEX, pages)).toEqual({
      state: "not_observed_in_gsc_query_sample",
      supportingPageUrl: null,
    });
  });

  it("survives a crawled page with an empty token set", () => {
    const pages = [page("https://example.com/empty", "---")];

    expect(observeKeywordCoverage("best crm", EMPTY_INDEX, pages).state).toBe(
      "not_observed_in_gsc_query_sample",
    );
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
