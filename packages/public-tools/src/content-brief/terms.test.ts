import { describe, expect, it } from "vitest";

import { RELEVANCE_BIGRAM_TERMS_MAX, relevanceScore, relevanceTerms } from "./terms.ts";

describe("relevanceTerms", () => {
  it("keeps the whole phrase strongest and its content words weaker", () => {
    const terms = relevanceTerms(["mercury retrograde meaning"]);

    expect(terms.find((term) => term.value === "mercury retrograde meaning")?.weight).toBe(3);
    expect(terms.find((term) => term.value === "mercury")?.weight).toBe(1);
    expect(terms.find((term) => term.value === "retrograde")?.weight).toBe(1);
    expect(terms.find((term) => term.value === "meaning")?.weight).toBe(1);
  });

  it("drops function words and tokens shorter than three characters", () => {
    const values = relevanceTerms(["what is the ab of approval workflow"]).map((term) => term.value);

    expect(values).not.toContain("what");
    expect(values).not.toContain("the");
    expect(values).not.toContain("ab");
    expect(values).toContain("approval");
    expect(values).toContain("workflow");
  });

  it("segments an unspaced Chinese phrase into bigrams instead of one dead token", () => {
    const terms = relevanceTerms(["水逆是什么意思"]);
    const values = terms.map((term) => term.value);

    expect(values).toContain("水逆是什么意思");
    expect(values).toContain("水逆");
    expect(values).toContain("意思");
    expect(terms.find((term) => term.value === "水逆")?.weight).toBe(0.5);
  });

  it("does not also register the unsegmented run as a word token", () => {
    // A phrase that is its own only token coalesces in the map at weight 3, so
    // it looks covered whether or not the guard exists. It takes a second token
    // to make the phrase and the run different values.
    const terms = relevanceTerms(["水逆是什么意思 details"]);

    // Absent entirely: the phrase here is the whole two-token string, so the
    // run can only appear if the guard let it in as a weight-1 word.
    expect(terms.filter((term) => term.value === "水逆是什么意思")).toEqual([]);
    expect(terms.find((term) => term.value === "水逆是什么意思 details")?.weight).toBe(3);
  });

  it("keeps a single-character run whole rather than producing no term", () => {
    // "猫" alone survives as the whole phrase either way; it needs a neighbour
    // before the single-character branch is the only thing that can produce it.
    const terms = relevanceTerms(["猫 犬"]);

    expect(relevanceScore("猫", null, terms)).toBeGreaterThan(0);
    expect(terms.find((term) => term.value === "犬")?.weight).toBe(0.5);
  });

  it("registers a value once at its strongest weight across phrases", () => {
    const terms = relevanceTerms(["approval workflow", "approval"]);

    expect(terms.filter((term) => term.value === "approval")).toHaveLength(1);
    expect(terms.find((term) => term.value === "approval")?.weight).toBe(3);
  });

  it("returns nothing for blank input", () => {
    expect(relevanceTerms([])).toEqual([]);
    expect(relevanceTerms(["", "   "])).toEqual([]);
  });

  it("caps the bigram tail of the widest accepted request, keeping every phrase", () => {
    // The widest shape the handler accepts: a primary plus SUPPORTING_KEYWORDS_MAX
    // supporting keywords, each at KEYWORD_MAX_CHARS. In an unsegmented script that
    // is one bigram per adjacent pair, about 2200 terms, and every one of them is
    // then tested against every observed excerpt twice per stage.
    const KEYWORD_MAX_CHARS = 200;
    const phrases = Array.from({ length: 11 }, (_, keyword) =>
      String.fromCodePoint(...Array.from({ length: KEYWORD_MAX_CHARS },
        (_unused, index) => 0x4e00 + keyword * KEYWORD_MAX_CHARS + index)));

    const terms = relevanceTerms(phrases);

    // A single unsegmented run is the phrase again, never a word, so this input
    // is eleven phrases and nothing but bigrams behind them.
    expect(terms.filter((term) => term.weight === 0.5)).toHaveLength(RELEVANCE_BIGRAM_TERMS_MAX);
    expect(terms.filter((term) => term.weight !== 0.5).map((term) => term.value)).toEqual([...phrases].sort());
  });

  it("never drops a whole word to make room, however many the request carries", () => {
    // Eleven 199-character keywords of fifty short words each: 561 terms and not
    // one bigram. A cap on the whole sorted list looks equivalent to a cap on the
    // bigrams and is not — it took 161 of these words, and a word missing from the
    // vocabulary scores zero on every excerpt that contains it.
    const words = Array.from({ length: 550 }, (_, index) =>
      `q${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`);
    const phrases = Array.from({ length: 11 }, (_, index) => words.slice(index * 50, index * 50 + 50).join(" "));

    const terms = relevanceTerms(phrases);

    expect(terms.filter((term) => term.weight === 1).map((term) => term.value).sort()).toEqual([...words].sort());
    expect(relevanceScore("qvd", null, terms)).toBeGreaterThan(0);
  });

  it("leaves an ordinary request uncut, term for term", () => {
    const terms = relevanceTerms(["mercury retrograde meaning", "retrograde dates 2026"]);

    // The exact vocabulary, so a cap that started taking from ordinary requests
    // would show up here rather than as a smaller number that still passes.
    expect(terms).toEqual([
      { value: "mercury retrograde meaning", weight: 3, word: false },
      { value: "retrograde dates 2026", weight: 3, word: false },
      { value: "2026", weight: 1, word: true },
      { value: "dates", weight: 1, word: true },
      { value: "meaning", weight: 1, word: true },
      { value: "mercury", weight: 1, word: true },
      { value: "retrograde", weight: 1, word: true },
    ]);
  });

  it("orders terms by descending weight so a bounded consumer keeps the strongest", () => {
    const terms = relevanceTerms(["mercury retrograde", "\u6c34\u9006\u662f\u4ec0\u4e48\u610f\u601d"]);
    const weights = terms.map((term) => term.weight);

    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    // Equal weights fall back to code-unit order, so the set is deterministic.
    expect(terms.slice(0, 2).map((term) => term.value)).toEqual(["mercury retrograde", "\u6c34\u9006\u662f\u4ec0\u4e48\u610f\u601d"]);
    expect(terms.at(-1)?.weight).toBe(0.5);
  });
});

describe("relevanceScore", () => {
  const terms = relevanceTerms(["mercury retrograde meaning"]);

  it("scores a heading match higher than the same match in body text", () => {
    const heading = relevanceScore("unrelated words here", "mercury retrograde meaning", terms);
    const body = relevanceScore("mercury retrograde meaning", null, terms);

    expect(heading).toBeGreaterThan(body);
  });

  it("does not let one repeated keyword outscore broader coverage", () => {
    const repeated = relevanceScore("mercury mercury mercury mercury mercury", null, terms);
    const broad = relevanceScore("retrograde motion changes what meaning we give mercury", null, terms);

    expect(broad).toBeGreaterThan(repeated);
  });

  it("scores an excerpt with none of the terms at zero", () => {
    expect(relevanceScore("Sign up for the newsletter.", "Share this article", terms)).toBe(0);
  });

  it("matches Chinese source text through bigrams", () => {
    const chinese = relevanceTerms(["水逆是什么意思"]);

    expect(relevanceScore("水逆期间容易出现沟通问题", null, chinese)).toBeGreaterThan(0);
    expect(relevanceScore("完全无关的内容", null, chinese)).toBe(0);
  });

  it("does not read a one-word keyword out of a longer unrelated word", () => {
    // "cat" is inside "education": substring matching let a page of education
    // prose outscore the one paragraph that is actually about cats. Only a
    // single Latin word carries the whole-word flag that stops it.
    const cat = relevanceTerms(["cat"]);
    const mixed = relevanceTerms(["mercury retrograde", "\u6c34\u9006"]);

    expect(cat.find((term) => term.value === "cat")?.word).toBe(true);
    expect(mixed.find((term) => term.value === "mercury retrograde")?.word).toBe(false);
    expect(mixed.find((term) => term.value === "\u6c34\u9006")?.word).toBe(false);
    expect(relevanceScore("Education policy sets classroom funding.", null, cat)).toBe(0);
    expect(relevanceScore("A cat needs taurine.", null, cat)).toBeGreaterThan(0);
    // A phrase carries its own boundaries, so it still matches inside prose.
    expect(relevanceScore("read the mercury retrograde meaning section", null, terms)).toBeGreaterThan(0);
  });

  it("folds full-width source text before matching", () => {
    expect(relevanceScore("\uff2d\uff25\uff32\uff23\uff35\uff32\uff39 \uff52\uff45\uff54\uff52\uff4f\uff47\uff52\uff41\uff44\uff45 \uff4d\uff45\uff41\uff4e\uff49\uff4e\uff47", null, terms))
      .toBe(relevanceScore("mercury retrograde meaning", null, terms));
  });

  it("is case and width insensitive", () => {
    expect(relevanceScore("MERCURY RETROGRADE MEANING", null, terms))
      .toBe(relevanceScore("mercury retrograde meaning", null, terms));
  });
});
