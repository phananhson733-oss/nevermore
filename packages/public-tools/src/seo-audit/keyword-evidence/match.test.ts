import { describe, expect, it } from "vitest";

import {
  countOccurrencesInList,
  countOccurrencesInText,
  tokenizationOf,
  urlCovered,
} from "./match.ts";

describe("tokenizationOf", () => {
  it("routes a Latin query through the whitespace branch", () => {
    expect(tokenizationOf("natal chart")).toBe("whitespace");
  });

  it("routes a pure CJK query through the character branch", () => {
    expect(tokenizationOf("占星工具")).toBe("cjk_chars");
  });

  it("labels a query that carries both scripts as mixed", () => {
    expect(tokenizationOf("seo 工具")).toBe("mixed");
  });
});

describe("countOccurrencesInText (whitespace branch)", () => {
  const branch = "whitespace" as const;

  it("counts a single-token query", () => {
    expect(countOccurrencesInText("chart", "a chart here", branch)).toBe(1);
  });

  it("requires multi-word queries to be adjacent and in order", () => {
    expect(countOccurrencesInText("seo tool", "best seo tool here", branch)).toBe(
      1,
    );
    expect(countOccurrencesInText("seo tool", "seo great tool", branch)).toBe(0);
    expect(countOccurrencesInText("seo tool", "tool seo", branch)).toBe(0);
  });

  it("matches on token boundaries, not substrings", () => {
    // A substring matcher would count "chart" inside "charter".
    expect(countOccurrencesInText("chart", "charter school", branch)).toBe(0);
  });

  it("counts repeats without overlapping", () => {
    expect(countOccurrencesInText("a a", "a a a a", branch)).toBe(2);
  });

  it("is case and whitespace insensitive through the shared pipeline", () => {
    expect(
      countOccurrencesInText("natal chart", "  NATAL   Chart ", branch),
    ).toBe(1);
  });

  it("returns zero for text that has no countable content", () => {
    expect(countOccurrencesInText("chart", "", branch)).toBe(0);
    expect(countOccurrencesInText("chart", "   ", branch)).toBe(0);
  });
});

describe("countOccurrencesInText (CJK branch)", () => {
  it("ignores whitespace on both sides so a split query still matches", () => {
    expect(countOccurrencesInText("关键词工具", "关键 词工具", "cjk_chars")).toBe(
      1,
    );
  });

  it("counts repeats without overlapping", () => {
    expect(countOccurrencesInText("占星", "占星占星占星", "cjk_chars")).toBe(3);
    expect(countOccurrencesInText("占占", "占占占占", "cjk_chars")).toBe(2);
  });

  it("matches a mixed-script query against mixed page text", () => {
    expect(countOccurrencesInText("seo 工具", "我们的 SEO工具 很好", "mixed")).toBe(
      1,
    );
  });

  it("returns zero when the characters are absent", () => {
    expect(countOccurrencesInText("占星", "astrology", "cjk_chars")).toBe(0);
  });
});

describe("countOccurrencesInList", () => {
  const branch = "whitespace" as const;

  it("sums matches across elements", () => {
    expect(
      countOccurrencesInList("chart", ["birth chart", "chart guide"], branch),
    ).toBe(2);
  });

  it("never matches across an element boundary", () => {
    // Concatenating headings would invent an adjacency the page never had.
    expect(
      countOccurrencesInList("chart calculator", ["chart", "calculator"], branch),
    ).toBe(0);
  });

  it("returns zero for an empty list", () => {
    expect(countOccurrencesInList("chart", [], branch)).toBe(0);
  });
});

describe("urlCovered", () => {
  it("matches an exact-match domain the token matcher would miss", () => {
    // The whole URL is one whitespace token, so the ordinary branch fails.
    expect(countOccurrencesInText("astrology wiki", "https://www.astrologywiki.com/", "whitespace")).toBe(0);
    expect(urlCovered("astrology wiki", "https://www.astrologywiki.com/")).toBe(
      true,
    );
  });

  it("matches a keyword written with a hyphen in the path", () => {
    expect(urlCovered("seo tool", "https://example.com/seo-tool")).toBe(true);
  });

  it("matches a single word inside a slug", () => {
    expect(urlCovered("seo", "https://example.com/seo-tool")).toBe(true);
  });

  it("stays false when the keyword is absent", () => {
    expect(urlCovered("horoscope", "https://example.com/seo-tool")).toBe(false);
  });

  it("ignores case and separators on both sides", () => {
    expect(urlCovered("Natal Chart", "https://EXAMPLE.com/Natal_Chart/")).toBe(
      true,
    );
  });

  it("matches CJK slugs after percent-decoding is already applied upstream", () => {
    expect(urlCovered("占星", "https://example.com/占星/")).toBe(true);
  });

  it("returns false for an unusable url", () => {
    expect(urlCovered("chart", "")).toBe(false);
  });
});

describe("no dynamic regular expressions are built from visitor input", () => {
  it("treats regex metacharacters as literal text", () => {
    // A matcher that interpolated the query into a RegExp would either throw
    // or match everything here.
    expect(countOccurrencesInText("a.c", "a.c", "whitespace")).toBe(1);
    expect(countOccurrencesInText("a.c", "abc", "whitespace")).toBe(0);
    expect(countOccurrencesInText("(", "(", "whitespace")).toBe(1);
    expect(countOccurrencesInText("[a-z]+", "[a-z]+", "whitespace")).toBe(1);
  });

  it("does not degrade on a pathological repeat", () => {
    const started = Date.now();
    countOccurrencesInText("a".repeat(40), "a".repeat(5000), "cjk_chars");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
