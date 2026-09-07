import { describe, expect, it } from "vitest";

import { relevanceScore, relevanceTerms } from "./terms.ts";

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
    // The unsegmented run must not also be registered as a "word" token,
    // because that would let one phrase vote twice at two weights.
    expect(terms.filter((term) => term.value === "水逆是什么意思")).toHaveLength(1);
    expect(terms.find((term) => term.value === "水逆")?.weight).toBe(0.5);
  });

  it("keeps a single-character run whole rather than producing no term", () => {
    expect(relevanceTerms(["猫"]).map((term) => term.value)).toContain("猫");
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

  it("is case and width insensitive", () => {
    expect(relevanceScore("MERCURY RETROGRADE MEANING", null, terms))
      .toBe(relevanceScore("mercury retrograde meaning", null, terms));
  });
});
