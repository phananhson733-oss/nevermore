// @input  -- small page sets with hand-computed overlap
// @output -- proof the published 70% is decided exactly, and that the guards
//            against false positives cannot erase the duplication they guard
// @pos    -- unit coverage for the measurement behind 4.5

import { describe, expect, it } from "vitest";

import {
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
