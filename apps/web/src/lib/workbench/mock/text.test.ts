import { describe, expect, it } from "vitest";
import {
  COMPETITOR_PLACEHOLDERS,
  competitorNames,
  domainOf,
  matchesBrand,
  normQ,
  oneLine,
  slugify,
  splitList,
} from "./text.ts";

const codePoints = (value: string): number => Array.from(value).length;

describe("slugify", () => {
  it("lowercases and dashes Latin words", () => {
    expect(slugify("Best SEO Tools")).toBe("best-seo-tools");
    expect(slugify("  --Hello,  World!--  ")).toBe("hello-world");
  });

  it("strips accents from Latin, Greek and Cyrillic letters", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
    expect(slugify("Ἀθῆναι")).toBe("αθηναι");
    expect(slugify("Йод")).toBe("иод");
    expect(slugify("поиск")).toBe("поиск");
  });

  it("keeps Japanese kana and kanji whole", () => {
    expect(slugify("問い合わせ")).toBe("問い合わせ");
    expect(slugify("グーグル")).toBe("グーグル");
    expect(slugify("ご利用")).toBe("ご利用");
  });

  it("keeps Korean syllables composed", () => {
    const slug = slugify("검색 최적화");
    expect(slug.normalize("NFC")).toBe("검색-최적화".normalize("NFC"));
    expect(slug).toBe("검색-최적화");
    expect(codePoints(slug)).toBe(6);
  });

  it("keeps Devanagari vowel signs and virama", () => {
    expect(slugify("हिन्दी")).toBe("हिन्दी");
    expect(slugify("हिन्दी भाषा")).toBe("हिन्दी-भाषा");
  });

  it("keeps characters outside the BMP", () => {
    expect(slugify("𠀀字")).toBe("𠀀字");
    expect(codePoints(slugify("𠀀字"))).toBe(2);
  });

  it("falls back to a hash slug when nothing survives", () => {
    expect(slugify("🚀🚀")).toMatch(/^q-[0-9a-z]+$/);
    expect(slugify("")).toMatch(/^q-[0-9a-z]+$/);
    expect(slugify("🚀🚀")).not.toBe(slugify("!!!"));
  });

  it("drops variation selectors left behind by emoji instead of emitting an invisible slug", () => {
    for (const emoji of ["❤️", "☀️", "✔️"])
      expect(slugify(emoji)).toMatch(/^q-[0-9a-z]+$/);
    expect(slugify("SEO ❤️")).toBe("seo");
    expect(slugify("❤️ SEO ✔️ tips")).toBe("seo-tips");
  });

  it("truncates to 60 code points", () => {
    const long = "中".repeat(70);
    expect(codePoints(slugify(long))).toBe(60);
    expect(codePoints(slugify("𠀀".repeat(70)))).toBe(60);
  });

  it("does not leave a trailing dash after truncation", () => {
    const value = `${"a".repeat(59)} b`;
    expect(slugify(value)).toBe("a".repeat(59));
  });
});

describe("domainOf", () => {
  it("extracts the bare host", () => {
    expect(domainOf("HTTPS://www.Foo.com/x")).toBe("foo.com");
    expect(domainOf("  acme.io ")).toBe("acme.io");
    expect(domainOf("ftp://x.com")).toBe("x.com");
    expect(domainOf("acme.io.")).toBe("acme.io");
    expect(domainOf("https://sub.acme.io:8080/a?b=c")).toBe("sub.acme.io");
    expect(domainOf("")).toBe("");
    expect(domainOf("   ")).toBe("");
  });

  it("falls back to string slicing when the URL does not parse", () => {
    expect(domainOf("http://www.exa mple.com/path")).toBe("exa mple.com");
    expect(domainOf("http://WWW.Exa mple.COM/x")).toBe("exa mple.com");
    expect(domainOf("exa mple.com.")).toBe("exa mple.com");
  });
});

describe("splitList", () => {
  it("splits on commas, trims and drops empties", () => {
    expect(splitList(" A , ,B ")).toEqual(["A", "B"]);
    expect(splitList("")).toEqual([]);
    expect(splitList(",,")).toEqual([]);
  });
});

describe("normQ", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normQ("  Best   SEO\tTools ")).toBe("best seo tools");
  });

  it("folds compatibility forms", () => {
    expect(normQ("ＳＥＯ")).toBe("seo");
  });
});

describe("matchesBrand", () => {
  it("matches Latin brands on word boundaries only", () => {
    expect(matchesBrand("genre music", "Gen")).toBe(false);
    expect(matchesBrand("gen pricing", "Gen")).toBe(true);
    expect(matchesBrand("acme-login", "Acme")).toBe(true);
    expect(matchesBrand("ACME   login", "acme")).toBe(true);
    expect(matchesBrand("regen tools", "Gen")).toBe(false);
  });

  it("matches CJK brands as substrings", () => {
    expect(matchesBrand("钉钉价格", "钉钉")).toBe(true);
    expect(matchesBrand("네이버지도", "네이버")).toBe(true);
    expect(matchesBrand("メルカリで買う", "メルカリ")).toBe(true);
    expect(matchesBrand("飞书文档", "钉钉")).toBe(false);
  });

  it("never matches a blank brand", () => {
    expect(matchesBrand("anything", " ")).toBe(false);
    expect(matchesBrand("anything", "")).toBe(false);
  });

  it("escapes regular expression syntax in the brand", () => {
    expect(matchesBrand("a.i tools", "a.i")).toBe(true);
    expect(matchesBrand("axi tools", "a.i")).toBe(false);
    expect(matchesBrand("c++ tutorial", "C++")).toBe(true);
  });
});

describe("oneLine", () => {
  it("folds line breaks and the whitespace around them into one space", () => {
    expect(oneLine("# 标题\n正文")).toBe("# 标题 正文");
    expect(oneLine("a  \r\n\r\n  b\rc\n")).toBe("a b c");
  });

  // A JavaScript regex `.` does not match U+2028 / U+2029, so marked drops a heading that holds one. NEL is folded with them.
  it("folds NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR like a newline", () => {
    expect(oneLine("Acme\u0085# 伪标题")).toBe("Acme # 伪标题");
    expect(oneLine("Acme \u2028 # 伪标题")).toBe("Acme # 伪标题");
    expect(oneLine("a\u2029\u2029b\u2028")).toBe("a b");
    expect(oneLine("a\r\n\u2028\u0085b")).toBe("a b");
  });

  it("keeps other whitespace between words as it is", () => {
    expect(oneLine("  a\t b c  ")).toBe("a\t b c");
  });
});

/** The implementation before the linear rewrite, kept only as a reference: its leading `\s*` backtracks quadratically on a long run without a break. */
const legacyOneLine = (value: string): string =>
  value.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, " ").trim();

describe("oneLine: same output as the previous regex", () => {
  const cases: readonly (readonly [input: string, expected: string])[] = [
    ["a\n b", "a b"],
    [" a \r\n\r\n b ", "a b"],
    ["a b", "a b"],
    ["a  b", "a  b"],
    ["a\t\nb", "a b"],
    ["\n", ""],
    ["", ""],
    ["a   \n b", "a b"],
    ["  \n  ", ""],
    ["a\n\n\nb", "a b"],
    ["a \n \n b", "a b"],
    ["a\u0085b", "a b"],
    ["a \t\u0085 b", "a b"],
    ["\u0085a\u0085", "a"],
    ["a\u2028b", "a b"],
    ["a \u2028 \n b", "a b"],
    ["a\u2029\u2029b", "a b"],
    ["a\r\n\u2029\tb", "a b"],
    ["a\u00A0\nb", "a b"],
    ["a\n\u00A0b", "a b"],
    ["a\u00A0b", "a\u00A0b"],
    ["a\t\tb", "a\t\tb"],
    ["\t\t", ""],
  ];

  it.each(cases)("oneLine(%j) is %j", (input, expected) => {
    expect(oneLine(input)).toBe(expected);
    expect(legacyOneLine(input)).toBe(expected);
  });

  it("matches the previous regex on every string up to 5 characters, except runs holding two or more NELs", () => {
    const alphabet = [
      "a",
      " ",
      "\t",
      "\r",
      "\n",
      "\u0085",
      "\u2028",
      "\u2029",
      "\u00A0",
    ];
    const stringsOf = (length: number): readonly string[] =>
      length === 0
        ? [""]
        : stringsOf(length - 1).flatMap((prefix) =>
            alphabet.map((char) => prefix + char),
          );
    const all = [0, 1, 2, 3, 4, 5].flatMap(stringsOf);
    const differing = all.filter(
      (value) => oneLine(value) !== legacyOneLine(value),
    );
    expect(all.length).toBe(66_430);
    expect(differing.length).toBeGreaterThan(0);
    expect(
      differing.filter((value) => value.split("\u0085").length < 3),
    ).toEqual([]);
  });

  // NEL is not `\s`, so the old trailing `\s*` stopped at the second NEL and each NEL got its own space.
  it("folds a run holding two NELs split by a space into one space, where the previous regex left two", () => {
    expect(oneLine("a\u0085 \u0085b")).toBe("a b");
    expect(legacyOneLine("a\u0085 \u0085b")).toBe("a  b");
  });
});

describe("oneLine: linear time", () => {
  // The previous regex took about 4 s on 100,000 spaces and grows quadratically, so a million takes minutes: 1 s is a loose bound, not a timing gate.
  it("returns a million spaces without a line break in under a second", () => {
    const value = `x${" ".repeat(1_000_000)}x`;
    const started = performance.now();
    const folded = oneLine(value);
    const elapsed = performance.now() - started;
    expect(folded).toBe(value);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("competitorNames", () => {
  it("uses the placeholders when no competitor is filled in", () => {
    expect(COMPETITOR_PLACEHOLDERS).toEqual([
      "[竞品 A]",
      "[竞品 B]",
      "[竞品 C]",
    ]);
    expect(competitorNames({ competitors: "" })).toEqual(
      COMPETITOR_PLACEHOLDERS,
    );
    expect(competitorNames({ competitors: " , , " })).toEqual(
      COMPETITOR_PLACEHOLDERS,
    );
  });

  it("splits the filled-in list", () => {
    expect(competitorNames({ competitors: " A , ,B " })).toEqual(["A", "B"]);
  });

  it("dedupes by normalized query and keeps the first spelling", () => {
    expect(competitorNames({ competitors: "Rival, rival" })).toEqual(["Rival"]);
    expect(
      competitorNames({ competitors: "rival, Other, RIVAL, ＲＩＶＡＬ" }),
    ).toEqual(["rival", "Other"]);
  });
});
