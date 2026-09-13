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
