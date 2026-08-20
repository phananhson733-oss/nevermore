// @input  -- small page sets with hand-computed overlap
// @output -- proof the published 70% is decided exactly, and that the guards
//            against false positives cannot erase the duplication they guard
// @pos    -- unit coverage for the measurement behind 4.5

import { describe, expect, it } from "vitest";

import {
  couldReachThreshold,
  measurePageSimilarity,
  NEAR_DUPLICATE_SIMILARITY,
  type PageSimilarityInput,
} from "./page-similarity.ts";

const FOOTER =
  "copyright acme incorporated all rights reserved privacy policy terms cookie preferences";

const words = (prefix: string, from: number, to: number): string =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`).join(
    " ",
  );

function page(
  url: string,
  paragraphs: readonly string[],
  partOfASequence = false,
): PageSimilarityInput {
  return { url, paragraphs, partOfASequence };
}

/** Four filler pages with nothing in common, so the run clears MIN_PAGES. */
const filler = (count: number): PageSimilarityInput[] =>
  Array.from({ length: count }, (_, i) =>
    page(`https://acme.test/filler${i}`, [words(`f${i}_`, 1, 60)]),
  );

const measure = (pages: readonly PageSimilarityInput[]) => {
  const out = measurePageSimilarity(pages);
  return (url: string) => out.find((entry) => entry.url === url);
};

describe("the published 70% is decided exactly, not estimated", () => {
  // Shingles are five-token windows. Two 30-token pages sharing their first 28
  // tokens share the 24 windows that fall entirely inside that prefix, out of a
  // 28-window union: 24/28 = 0.857 exactly, every run, on every machine.
  it("reports the hand-computed overlap for a genuine near-duplicate", () => {
    const find = measure([
      page("https://acme.test/a", [words("t", 1, 30)]),
      page("https://acme.test/b", [`${words("t", 1, 28)} u1 u2`]),
      ...filler(3),
    ]);

    // 64-slot MinHash agreement on this pair lands anywhere from 0.56 to 0.88;
    // reading the estimate as the verdict passed a truly 80%-overlapping pair
    // roughly half the time. The exact number is the only thing precise enough
    // to compare against a sentence that says "70%".
    expect(find("https://acme.test/a")?.similarity).toBeCloseTo(24 / 28, 10);
    expect(find("https://acme.test/a")?.nearest).toBe("https://acme.test/b");
    expect(find("https://acme.test/a")?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_SIMILARITY,
    );
  });

  // Same construction, sharing 24 tokens instead of 28: 20 shared windows in a
  // 32-window union = 0.625, which is under the bar.
  it("reports the hand-computed overlap for a pair that is merely similar", () => {
    const find = measure([
      page("https://acme.test/a", [words("t", 1, 30)]),
      page("https://acme.test/b", [`${words("t", 1, 24)} u1 u2 u3 u4 u5 u6`]),
      ...filler(3),
    ]);

    expect(find("https://acme.test/a")?.similarity).toBeCloseTo(20 / 32, 10);
    expect(find("https://acme.test/a")?.similarity).toBeLessThan(
      NEAR_DUPLICATE_SIMILARITY,
    );
  });

  it("publishes the threshold the catalogue prints", () => {
    // The catalogue sentence is "Below 70%; otherwise Warning". If this
    // constant moves, that sentence has to move with it.
    expect(NEAR_DUPLICATE_SIMILARITY).toBe(0.7);
  });
});

describe("site chrome", () => {
  it("is stripped, so a shared footer does not make every page a duplicate", () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      page(`https://acme.test/p${i}`, [words(`body${i}_`, 1, 60), FOOTER]),
    );

    expect(measure(pages)("https://acme.test/p0")?.similarity).toBe(0);
  });

  it("never swallows a block that is a page's own content", () => {
    // The defect this exists to prevent: the chrome bar on a five-page site is
    // four pages, so an article body copied onto four of them was classified as
    // furniture and deleted before anything was compared. The leftover tails
    // scored low and all four passed — the more completely a site duplicated
    // its main content, the more certainly this check called it distinct.
    const body = words("article", 1, 120);
    const pages = [
      ...Array.from({ length: 4 }, (_, i) =>
        page(`https://acme.test/copy${i}`, [body, words(`tail${i}_`, 1, 12)]),
      ),
      page("https://acme.test/original", [words("other", 1, 120)]),
    ];

    const find = measure(pages);
    expect(find("https://acme.test/copy0")?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_SIMILARITY,
    );
    expect(find("https://acme.test/copy0")?.nearest).toMatch(/\/copy[1-3]$/);
  });
});

describe("pages that carry no score say why", () => {
  it("refuses a site too small to separate chrome from duplication", () => {
    const pages = Array.from({ length: 3 }, (_, i) =>
      page(`https://acme.test/p${i}`, [words(`b${i}_`, 1, 60)]),
    );

    for (const entry of measurePageSimilarity(pages)) {
      expect(entry.similarity).toBeNull();
      expect(entry.unscored).toBe(
        "too_few_pages_to_separate_chrome_from_duplication",
      );
    }
  });

  it("refuses a page with too little distinctive text left", () => {
    const find = measure([
      page("https://acme.test/thin", ["thanks for reading"]),
      ...filler(4),
    ]);

    expect(find("https://acme.test/thin")?.similarity).toBeNull();
    expect(find("https://acme.test/thin")?.unscored).toBe(
      "too_little_distinctive_text_to_compare",
    );
  });

  it("separates a clean page from an uncovered one", () => {
    // Zero is a measurement — compared against every sibling, shares nothing.
    // Reporting it as null told the reader "that rule did not cover this page"
    // about a page that passed.
    const find = measure(filler(5));

    expect(find("https://acme.test/filler0")?.similarity).toBe(0);
    expect(find("https://acme.test/filler0")?.unscored).toBeNull();
    expect(find("https://acme.test/filler0")?.nearest).toBeNull();
  });
});

describe("the pagination exemption", () => {
  it("excludes a declared sequence member, and says so", () => {
    const find = measure([
      page("https://acme.test/page/2", [words("t", 1, 60)], true),
      ...filler(4),
    ]);

    expect(find("https://acme.test/page/2")?.similarity).toBeNull();
    expect(find("https://acme.test/page/2")?.unscored).toBe(
      "excluded_because_the_page_declares_pagination",
    );
  });

  it("ignores the declaration when the whole site makes it", () => {
    // rel=next/prev is markup the site controls and has carried no indexing
    // meaning at Google since 2019, so one line in a layout template used to
    // exempt every page from this check at zero cost.
    const body = words("article", 1, 120);
    const pages = [
      ...Array.from({ length: 4 }, (_, i) =>
        page(
          `https://acme.test/copy${i}`,
          [body, words(`tail${i}_`, 1, 12)],
          true,
        ),
      ),
      page("https://acme.test/other", [words("other", 1, 120)], true),
    ];

    const find = measure(pages);
    expect(find("https://acme.test/copy0")?.unscored).toBeNull();
    expect(find("https://acme.test/copy0")?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_SIMILARITY,
    );
  });
});

describe("scripts written without spaces", () => {
  const ZH_A =
    "增长营销的核心在于持续验证假设而不是一次性投放团队需要建立可重复的实验流程并把结果沉淀成资产" +
    "搜索引擎优化是其中最稳定的渠道之一因为它的复利效应来自内容与链接的长期积累";
  const ZH_B = `${ZH_A}但是投放节奏需要单独规划`;

  it("judges a Chinese page instead of calling it too short", () => {
    // Splitting on spaces made one clause into one token: this paragraph
    // produced six tokens and two shingles, fell under MIN_SHINGLES, and the
    // check reported Chinese pages as uncoverable rather than measuring them.
    const find = measure([
      page("https://acme.test/zh-a", [ZH_A]),
      ...filler(4),
    ]);

    expect(find("https://acme.test/zh-a")?.distinctiveShingles).toBeGreaterThan(
      20,
    );
    expect(find("https://acme.test/zh-a")?.unscored).toBeNull();
  });

  it("finds two near-identical Chinese pages", () => {
    const find = measure([
      page("https://acme.test/zh-a", [ZH_A]),
      page("https://acme.test/zh-b", [ZH_B]),
      ...filler(3),
    ]);

    expect(find("https://acme.test/zh-a")?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_SIMILARITY,
    );
    expect(find("https://acme.test/zh-a")?.nearest).toBe(
      "https://acme.test/zh-b",
    );
  });

  it("keeps latin runs inside mixed text whole", () => {
    const find = measure([
      page("https://acme.test/mixed-a", [
        "iphone15手机壳 材质说明 " + words("spec", 1, 40),
      ]),
      ...filler(4),
    ]);

    // Exploding the whole chunk per character would shred "iphone15" into
    // eight tokens and change what a five-token shingle means for latin text.
    expect(find("https://acme.test/mixed-a")?.unscored).toBeNull();
  });
});

describe("a truncated search cannot claim a page is clean", () => {
  it("reports unscored rather than clean when there were too many candidates", () => {
    // Forty pages that each share a long block with every other and carry a
    // distinct tail, so all thirty-nine siblings clear the candidate floor
    // while none reaches the published bar. The exact pass runs out of budget,
    // and the comparisons it skipped could only have raised the score — so "no
    // duplicate found" is not "no duplicate exists". The shared block sits in
    // the same paragraph as the tail so the paragraph differs per page and the
    // chrome filter has nothing to strip.
    const shared = words("shared", 1, 100);
    const pages = Array.from({ length: 40 }, (_, i) =>
      page(`https://acme.test/t${i}`, [`${shared} ${words(`u${i}_`, 1, 40)}`]),
    );

    const results = measurePageSimilarity(pages);
    const clean = results.filter((entry) => entry.similarity === 0);
    const truncated = results.filter(
      (entry) =>
        entry.unscored === "too_many_similar_pages_to_compare_them_all_exactly",
    );

    expect(truncated.length).toBeGreaterThan(0);
    expect(clean).toHaveLength(0);
  });

  it("still reports a duplicate it did find, because that needs no full field", () => {
    const body = words("article", 1, 200);
    const pages = [
      ...Array.from({ length: 30 }, (_, i) =>
        page(`https://acme.test/copy${i}`, [body, words(`tail${i}_`, 1, 10)]),
      ),
      ...filler(4),
    ];

    const find = measure(pages);
    expect(find("https://acme.test/copy0")?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_SIMILARITY,
    );
  });
});

/**
 * Two holes a pre-merge review found in the rewrite above, both of the class
 * the rewrite existed to close: a page reported as distinct on evidence that
 * had been thrown away before anything was compared.
 */
describe("what gets thrown away before the comparison", () => {
  it("refuses a page whose text is mostly blocks repeated across the site", () => {
    // Each paragraph individually clears the per-paragraph ceiling, so all of
    // them were deleted as furniture and the tails scored near zero. Combined
    // they are the page. This method cannot tell that from a short page under
    // a heavy footer, and a page it cannot tell about must not be scored.
    const bodyA = words("shared_a", 1, 150);
    const bodyB = words("shared_b", 1, 150);
    const pages = [
      ...Array.from({ length: 4 }, (_, i) =>
        page(`https://acme.test/copy${i}`, [
          bodyA,
          bodyB,
          words(`tail${i}_`, 1, 30),
        ]),
      ),
      page("https://acme.test/other", [words("other", 1, 400)]),
    ];

    const find = measure(pages);
    expect(find("https://acme.test/copy0")?.similarity).toBeNull();
    expect(find("https://acme.test/copy0")?.unscored).toBe(
      "most_of_this_page_is_text_repeated_across_the_site",
    );
    // The page that shares nothing is still judged, and is still clean.
    expect(find("https://acme.test/other")?.similarity).toBe(0);
  });

  it("admits candidates by arithmetic, so no estimate can hide a duplicate", () => {
    // A 64-slot MinHash agreement used to decide which pairs were ever
    // compared exactly. A genuine near-duplicate whose estimate landed low was
    // therefore neither measured nor counted as skipped, and the page returned
    // a scored zero. Admission is now `J <= min/max`, which is arithmetic: a
    // pair it excludes cannot reach the bar whatever any signature says.
    const find = measure([
      page("https://acme.test/a", [words("t", 1, 30)]),
      page("https://acme.test/b", [`${words("t", 1, 28)} u1 u2`]),
      ...filler(3),
    ]);

    expect(find("https://acme.test/a")?.similarity).toBeCloseTo(24 / 28, 10);
  });

  it("excludes a pair too different in size to reach the bar", () => {
    // 30 shingles against 300 caps the overlap at 0.1, well under the rail —
    // excluded without a comparison, and correctly so.
    const find = measure([
      page("https://acme.test/short", [words("s", 1, 34)]),
      page("https://acme.test/long", [words("s", 1, 304)]),
      ...filler(3),
    ]);

    expect(find("https://acme.test/short")?.similarity).toBe(0);
    expect(find("https://acme.test/short")?.unscored).toBeNull();
  });
});

describe("the admission bound itself", () => {
  it("is the arithmetic ceiling on Jaccard, not an estimate", () => {
    // |A ∩ B| <= min(|A|,|B|) and |A ∪ B| >= max(|A|,|B|), so J <= min/max.
    // Exactly at the rail is admitted, because the bound is a ceiling and the
    // pair may sit on it.
    expect(couldReachThreshold(70, 100)).toBe(true);
    expect(couldReachThreshold(100, 70)).toBe(true);
    expect(couldReachThreshold(69, 100)).toBe(false);
    expect(couldReachThreshold(100, 100)).toBe(true);
  });

  it("admits nothing against an empty side", () => {
    expect(couldReachThreshold(0, 0)).toBe(false);
    expect(couldReachThreshold(0, 50)).toBe(false);
  });

  it("moves with the published threshold rather than a constant of its own", () => {
    const justUnder = Math.floor(100 * NEAR_DUPLICATE_SIMILARITY) - 1;
    expect(couldReachThreshold(justUnder, 100)).toBe(false);
    expect(couldReachThreshold(Math.ceil(100 * NEAR_DUPLICATE_SIMILARITY), 100)).toBe(true);
  });

  /*
   * What this file cannot test, stated rather than implied.
   *
   * The defect this bound replaced was a MinHash floor deciding which pairs
   * were ever compared exactly. Reintroducing one would not turn this suite
   * red: the failure it causes is probabilistic, so a fixture either happens
   * to have a low agreement or it does not, and a search over forty thousand
   * constructed pairs found no case where a genuine 70% pair's 64-slot
   * agreement fell below 0.3. The absence of such a fixture is exactly why a
   * probabilistic filter must not sit upstream of a published clean verdict —
   * the failure is rare, silent, and unreproducible on demand. The protection
   * here is the arithmetic above; there is no test that can stand in for it.
   */
});
