import { describe, expect, it } from "vitest";
import { SERP_POOL, kwMetrics, serpTop } from "./keywords.ts";

/** Estimate pins: kwMetrics ranges, the long-tail word count, serpTop sampling. */

describe("kwMetrics", () => {
  interface Script {
    readonly words: readonly string[];
    /** Same-script letters: a digit suffix would itself be a word under a Latin-and-digits rule, hollowing the pin. */
    readonly suffixes: string;
  }
  const LATIN: Script = {
    words: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"],
    suffixes: "abcdefghijklmnopqrstuv",
  };
  const HANGUL: Script = {
    words: ["검색", "최적화", "도구", "추천", "방법", "비교", "가격"],
    suffixes: "가나다라마바사아자차카타파하거너더러머버서어",
  };
  const CYRILLIC: Script = {
    words: [
      "поиск",
      "лучших",
      "инструментов",
      "для",
      "малого",
      "бизнеса",
      "сайта",
    ],
    suffixes: "абвгдежзийклмнопрстуфх",
  };
  const HAN =
    "搜索引擎优化工具选择适合中小企业团队的内容营销方案对比价格和效果评估指南";
  const KANA =
    "けんさくえんじんさいてきかのためのどうぐをえらぶほうほうとちゅういするてんのまとめ";
  const KATAKANA = "カキクケコサシスセソタチツテト";
  const samples = (
    count: number,
    make: (index: number) => string,
  ): readonly string[] =>
    Array.from({ length: count }, (_, index) => make(index));
  /** Space-separated words; a same-script letter per sample varies the hash without adding a word. */
  const spaced = (script: Script, count: number, offset: number): string => {
    const suffix =
      Array.from(script.suffixes)[offset % script.suffixes.length] ?? "";
    return samples(
      count,
      (index) =>
        `${script.words[(index + offset) % script.words.length] ?? ""}${suffix}`,
    ).join(" ");
  };
  const slice = (text: string, count: number, offset: number): string =>
    Array.from(text)
      .slice(offset, offset + count)
      .join("");
  /** `カーキー…`: every other character is the Script=Common mark ー. */
  const prolonged = (pairs: number, offset: number): string =>
    samples(
      pairs,
      (index) =>
        `${Array.from(KATAKANA)[(index + offset) % KATAKANA.length] ?? ""}ー`,
    ).join("");
  const volumes = (queries: readonly string[]): readonly number[] =>
    queries.map((query) => kwMetrics(query).volume);
  /** Head terms draw from [200, 4400] and long tails from [40, 360]: 20 queries cannot all land in the other band by chance. */
  const expectLongTail = (make: (offset: number) => string): void => {
    for (const volume of volumes(samples(20, make)))
      expect(volume).toBeLessThanOrEqual(360);
  };
  const expectHead = (make: (offset: number) => string): void => {
    for (const volume of volumes(samples(20, make)))
      expect(volume).toBeGreaterThanOrEqual(200);
  };

  it("is deterministic and keyed by the normalized query", () => {
    expect(kwMetrics("best seo tools")).toEqual(kwMetrics("best seo tools"));
    expect(kwMetrics("Best SEO  Tools")).toEqual(kwMetrics("best seo tools"));
    expect(kwMetrics("best seo tools")).not.toEqual(
      kwMetrics("best crm tools"),
    );
  });

  it("keeps every field in its range and shape", () => {
    for (const query of samples(200, (index) => `metric probe ${index}`)) {
      const { volume, kd, cpc, aio } = kwMetrics(query);
      expect(Number.isInteger(volume / 10)).toBe(true);
      expect(volume).toBeGreaterThanOrEqual(40);
      expect(volume).toBeLessThanOrEqual(4400);
      expect(Number.isInteger(kd)).toBe(true);
      expect(kd).toBeGreaterThanOrEqual(8);
      expect(kd).toBeLessThanOrEqual(78);
      expect(cpc).toMatch(/^\d+\.\d{2}$/);
      expect(Number(cpc)).toBeGreaterThanOrEqual(0.6);
      expect(Number(cpc)).toBeLessThanOrEqual(9.6);
      expect(typeof aio).toBe("boolean");
    }
  });

  it("treats more than five space-separated words as long tail, five as head, in any spaced script", () => {
    expectLongTail((offset) => spaced(LATIN, 6, offset));
    expectHead((offset) => spaced(LATIN, 5, offset));
    expectLongTail((offset) => spaced(HANGUL, 6, offset));
    expectHead((offset) => spaced(HANGUL, 5, offset));
    expectLongTail((offset) => spaced(CYRILLIC, 6, offset));
  });

  it("counts two Han or kana characters as one word", () => {
    expectLongTail((offset) => slice(HAN, 11, offset));
    expectHead((offset) => slice(HAN, 10, offset));
    expectLongTail((offset) => slice(KANA, 11, offset));
    expectHead((offset) => slice(KANA, 10, offset));
    expectLongTail(
      (offset) => `${slice(HAN, 4, offset)} ${spaced(LATIN, 4, offset)}`,
    );
    expectLongTail(
      (offset) => `${slice(HAN, 9, offset)} ${spaced(LATIN, 1, offset)}`,
    );
    expectHead(
      (offset) => `${slice(HAN, 2, offset)} ${spaced(LATIN, 4, offset)}`,
    );
  });

  it("counts the prolonged sound mark ー as kana, not as a word of its own", () => {
    // 10 characters are 5 words; counting each ー as a spaced word would make them 7.5.
    expectHead((offset) => prolonged(5, offset));
    expectLongTail((offset) => prolonged(6, offset));
  });

  it("gives a long Chinese sentence a long-tail volume", () => {
    const { volume } = kwMetrics(
      "中小企业怎么选择适合自己团队的搜索引擎优化工具",
    );
    expect(volume).toBeGreaterThanOrEqual(40);
    expect(volume).toBeLessThanOrEqual(360);
  });
});

describe("serpTop", () => {
  it("pins the shared generic pool", () => {
    expect(SERP_POOL).toEqual([
      "g2.com",
      "reddit.com",
      "capterra.com",
      "medium.com",
      "producthunt.com",
    ]);
  });

  it("samples three distinct pool domains, deterministically", () => {
    const tops = Array.from({ length: 50 }, (_, index) =>
      serpTop(`serp probe ${index}`),
    );
    for (const top of tops) {
      expect(top).toHaveLength(3);
      expect(new Set(top).size).toBe(3);
      for (const domain of top) expect(SERP_POOL).toContain(domain);
    }
    expect(serpTop("best seo tools")).toEqual(serpTop("Best  SEO tools"));
    expect(new Set(tops.map((top) => top.join(","))).size).toBeGreaterThan(1);
  });
});
