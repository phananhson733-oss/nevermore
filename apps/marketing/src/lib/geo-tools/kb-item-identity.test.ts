import { describe, expect, it } from "vitest";
import {
  GEO_ITEM_SIMILARITY_PROMPT,
  geoItemKeyBasis,
  geoItemSimilarity,
  geoItemTokens,
  normalizeGeoIdentityText,
  normalizeGeoSimilarityText,
} from "./kb-item-identity.ts";
import { geoItemKey } from "./kb-item-key.ts";

describe("normalising identity text", () => {
  it("folds case and width but keeps punctuation and every word", () => {
    expect(normalizeGeoIdentityText("The Pro plan costs $9/month!")).toBe("the pro plan costs $9/month!");
    expect(normalizeGeoIdentityText("\uff30\uff32\uff2f\u3000plan")).toBe("pro plan");
  });

  it("folds away zero-width and other invisible code points", () => {
    // A zero-width space between two words is invisible in review yet would
    // otherwise mint a second identity for the same claim.
    expect(normalizeGeoIdentityText("Pro\u200bplan")).toBe(normalizeGeoIdentityText("Pro plan"));
    expect(normalizeGeoIdentityText("\ufeff\u00adplan")).toBe("plan");
  });

  it("keeps non-Latin scripts intact", () => {
    expect(normalizeGeoIdentityText("\u514d\u8d39\u672c\u547d\u661f\u76d8\uff0c\u65e0\u9700\u6ce8\u518c"))
      .toBe("\u514d\u8d39\u672c\u547d\u661f\u76d8,\u65e0\u9700\u6ce8\u518c");
  });
});

describe("normalising for similarity only", () => {
  it("is lossy on purpose, which is why it never reaches a key", () => {
    expect(normalizeGeoSimilarityText("The Pro plan costs $9/month!")).toBe("pro plan costs 9 month");
    // Two genuinely different statements collapse to one string here. If this
    // fed the item key, one plan's correction would rewrite the other's price.
    expect(normalizeGeoSimilarityText("Requires macOS and Linux"))
      .toBe(normalizeGeoSimilarityText("Requires macOS or Linux"));
    expect(normalizeGeoSimilarityText("Pro+")).toBe(normalizeGeoSimilarityText("Pro"));
  });

  it("returns unique tokens", () => {
    expect(geoItemTokens("free free chart")).toEqual(["free", "chart"]);
    expect(geoItemTokens("   ")).toEqual([]);
  });
});

describe("wording similarity", () => {
  it("scores drift without ever deciding anything", () => {
    expect(geoItemSimilarity("supports synastry charts", "supports synastry charts")).toBe(1);
    expect(geoItemSimilarity("supports synastry charts", "supports composite charts")).toBeGreaterThan(0.4);
    expect(geoItemSimilarity("supports synastry charts", "pricing starts at nine dollars")).toBe(0);
  });

  it("treats an empty side as no evidence of sameness", () => {
    expect(geoItemSimilarity("", "supports synastry")).toBe(0);
  });

  it("can put a one-word scope difference above the prompt threshold", () => {
    // This is exactly why the threshold only prompts: these two statements are
    // about different platforms, they must not inherit one another's decision,
    // and a long shared prefix is enough to carry them over the line.
    const score = geoItemSimilarity(
      "the desktop application does not currently support offline chart rendering on Android",
      "the desktop application does not currently support offline chart rendering on iOS",
    );
    expect(score).toBeGreaterThanOrEqual(GEO_ITEM_SIMILARITY_PROMPT);
  });

  it("leaves short statements below the threshold even when they differ by one word", () => {
    // The score is a wording heuristic, not a meaning test: it under-reports on
    // short text just as it over-reports on long text. Neither may decide.
    expect(geoItemSimilarity("does not run on Android", "does not run on iOS"))
      .toBeLessThan(GEO_ITEM_SIMILARITY_PROMPT);
  });
});

describe("item keys", () => {
  const fact = (qualifiers: readonly string[] = ["usd", "monthly"]) =>
    geoItemKey({ module: "facts", type: "price", subject: "Pro plan", attribute: "monthly price", qualifiers });

  it("ignores qualifier order but not qualifier membership", () => {
    expect(fact(["monthly", "usd"])).toBe(fact());
    expect(fact(["usd", "yearly"])).not.toBe(fact());
  });

  it("does not let qualifier concatenation collide", () => {
    expect(fact(["ab", "c"])).not.toBe(fact(["a", "bc"]));
  });

  it("keeps a symbol that distinguishes two plans", () => {
    // Regression: a normaliser that folded symbols away made Pro and Pro+ one
    // item, so accepting one plan's price accepted the other's.
    expect(fact(["Pro"])).not.toBe(fact(["Pro+"]));
  });

  it("ignores a repeated qualifier that differs only by case", () => {
    // The extractor emitting ["Pro"] once and ["Pro","pro"] the next time is a
    // wording variation, not a different plan; a new key would orphan the
    // owner's decision.
    expect(fact(["Pro", "pro"])).toBe(fact(["Pro"]));
  });

  it("keeps a logical operator that changes what a statement claims", () => {
    const and = geoItemKey({ module: "scope", kind: "requires", statement: "Requires macOS and Linux" });
    const or = geoItemKey({ module: "scope", kind: "requires", statement: "Requires macOS or Linux" });
    expect(and).not.toBe(or);
  });

  it("is insensitive to evidence: the basis carries content only", () => {
    // The basis is the whole hash input, so if no evidence field appears here,
    // no evidence change can move an owner's decision to a new key.
    const basis = geoItemKeyBasis({ module: "facts", type: "price", subject: "Pro plan", attribute: "monthly price", qualifiers: ["usd"] });
    expect(basis.join(" ")).not.toMatch(/http|receipt|generation|observed/iu);
    expect(basis[0]).toBe("facts");
  });

  it("separates modules that share wording", () => {
    const scope = geoItemKey({ module: "scope", kind: "does_not", statement: "monthly price" });
    const qa = geoItemKey({ module: "qa", intent: "price", canonicalQuestion: "monthly price" });
    expect(scope).not.toBe(qa);
  });

  it("addresses entity fields by name, not by value", () => {
    expect(geoItemKey({ module: "entity", field: "name" }))
      .toBe(geoItemKey({ module: "entity", field: "name" }));
    expect(geoItemKey({ module: "entity", field: "name" }))
      .not.toBe(geoItemKey({ module: "entity", field: "aliases" }));
  });

  it("is a sha256 hex digest", () => {
    expect(fact()).toMatch(/^[a-f0-9]{64}$/u);
  });
});
