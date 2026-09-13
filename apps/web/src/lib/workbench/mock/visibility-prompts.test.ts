import { describe, expect, it } from "vitest";
import { PROMPT_KINDS } from "../enums.ts";
import type { Profile, VisResult } from "../types.ts";
import { buildRows } from "./keywords.ts";
import {
  PLATFORMS,
  VIS_PROMPT_LIMIT,
  localPromptSet,
  mentionRate,
  missedPrompts,
  mockVisibility,
  parsePromptList,
  visibilityGaps,
} from "./visibility.ts";

/** Prompt seeds, prompt-list parsing and the derivations over results. Geo row kinds: visibility-kinds.test.ts; messy profile text: visibility-text.test.ts. */

type PromptProfile = Pick<
  Profile,
  "url" | "brand" | "positioning" | "features" | "competitors"
>;

const profileOf = (fields: Partial<PromptProfile>): PromptProfile =>
  Object.freeze({
    url: "",
    brand: "",
    positioning: "",
    features: "",
    competitors: "",
    ...fields,
  });

const questions = (seeds: readonly { readonly q: string }[]) =>
  seeds.map((s) => s.q);

describe("localPromptSet: templates", () => {
  it("asks only brand questions for a brand-only profile, with no filler words", () => {
    const seeds = localPromptSet(profileOf({ brand: "Acme" }), []);
    expect(seeds).toEqual([
      { q: "best tools like Acme", kind: "alternative" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Acme alternatives", kind: "alternative" },
    ]);
    expect(questions(seeds).join("\n")).not.toMatch(
      /tools tools|solo founder|\[核心功能\]|\[竞品/,
    );
  });

  it("fills every template from a complete profile", () => {
    const profile = profileOf({
      brand: "Acme",
      positioning: "rank in AI answers",
      features: "keyword research, site audit",
      competitors: "Rival, Other",
    });
    expect(localPromptSet(profile, [])).toEqual([
      { q: "best keyword research tools for startups", kind: "discover" },
      { q: "what tools help with rank in AI answers", kind: "discover" },
      { q: "Acme vs Rival", kind: "compare" },
      { q: "is Other the best option for site audit?", kind: "compare" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Rival alternatives", kind: "alternative" },
      {
        q: "I have a small team and no SEO budget, how do I get started with keyword research?",
        kind: "scenario",
      },
    ]);
  });

  it("asks the feature comparison and which-tool questions from a single feature", () => {
    expect(
      localPromptSet(profileOf({ brand: "Acme", features: "seo audit" }), []),
    ).toEqual([
      { q: "best seo audit tools for startups", kind: "discover" },
      { q: "what tools help with seo audit", kind: "discover" },
      { q: "seo audit tools compared", kind: "compare" },
      { q: "which seo audit tool should I pick?", kind: "compare" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Acme alternatives", kind: "alternative" },
      {
        q: "I have a small team and no SEO budget, how do I get started with seo audit?",
        kind: "scenario",
      },
    ]);
  });

  it("compares with the one named competitor and still asks which tool to pick", () => {
    const profile = profileOf({
      brand: "Acme",
      features: "seo audit",
      competitors: "Rival",
    });
    expect(localPromptSet(profile, [])).toEqual([
      { q: "best seo audit tools for startups", kind: "discover" },
      { q: "what tools help with seo audit", kind: "discover" },
      { q: "Acme vs Rival", kind: "compare" },
      { q: "which seo audit tool should I pick?", kind: "compare" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Rival alternatives", kind: "alternative" },
      {
        q: "I have a small team and no SEO budget, how do I get started with seo audit?",
        kind: "scenario",
      },
    ]);
  });

  it("never leaves a hole where a blank brand would go", () => {
    for (const features of ["", "seo", "seo, audit"]) {
      for (const competitors of ["", "Rival", "Rival, Other"]) {
        for (const positioning of ["", "rank in AI answers"]) {
          const rows = buildRows(["seo"], { brand: "", competitors }, []);
          const seeds = localPromptSet(
            profileOf({ features, competitors, positioning }),
            rows,
          );
          for (const q of questions(seeds)) {
            expect(q).not.toMatch(/ {2}|^ vs |^\s|\s$/);
          }
        }
      }
    }
  });

  it("does not double the word tools when a feature already ends with it", () => {
    const seeds = localPromptSet(
      profileOf({ brand: "Acme", features: "SEO tools, rank tool" }),
      [],
    );
    expect(questions(seeds).join("\n")).not.toMatch(/tools? tools?/i);
  });

  it("does not reuse the brand as a competitor", () => {
    const seeds = localPromptSet(
      profileOf({ brand: "Acme", competitors: "acme, Rival" }),
      [],
    );
    expect(questions(seeds)).toContain("Acme vs Rival");
    expect(questions(seeds).join("\n")).not.toMatch(/acme vs acme/i);
  });

  it("never compares the brand with its own site or a placeholder typed as a competitor", () => {
    const own = { brand: "Acme", url: "https://acme.example" };
    const brandOnly = [
      "best tools like Acme",
      "is Acme worth using?",
      "Acme alternatives",
    ];
    for (const competitors of [
      "acme.example",
      "www.ACME.example",
      " Acme ",
      "[竞品 A]",
      "acme.example, www.ACME.example,  Acme , [竞品 b]",
    ]) {
      const seeds = localPromptSet(profileOf({ ...own, competitors }), []);
      expect(questions(seeds), competitors).toEqual(brandOnly);
    }
    const mixed = questions(
      localPromptSet(
        profileOf({
          ...own,
          features: "seo audit",
          competitors: "www.ACME.example, [竞品 B], Rival, acme.example, Other",
        }),
        [],
      ),
    );
    expect(mixed).toEqual(
      expect.arrayContaining([
        "Acme vs Rival",
        "is Other the best option for seo audit?",
        "Rival alternatives",
      ]),
    );
    expect(mixed.join("\n")).not.toMatch(/acme\.example|\[竞品/i);
  });

  it("keeps every prompt on one line, so the list survives a textarea round trip", () => {
    const seeds = localPromptSet(
      profileOf({
        brand: "Ac\nme",
        positioning: "rank\nin AI",
        features: "seo\r\naudit, x",
        competitors: "Ri\nval",
      }),
      [],
    );
    expect(seeds.length).toBeGreaterThan(0);
    expect(parsePromptList(questions(seeds).join("\n"))).toEqual(
      questions(seeds),
    );
  });

  it("uses kind ids only", () => {
    const profile = profileOf({
      brand: "Acme",
      features: "seo",
      competitors: "Rival",
    });
    const rows = buildRows(["seo"], profile, []);
    const kinds: readonly string[] = PROMPT_KINDS;
    for (const seed of localPromptSet(profile, rows)) {
      expect(kinds).toContain(seed.kind);
    }
  });

  it("caps the prompt run at six", () => {
    expect(VIS_PROMPT_LIMIT).toBe(6);
  });
});

describe("parsePromptList", () => {
  it("splits on any line break, trims, and drops blank lines", () => {
    expect(parsePromptList("a\n\n b \r\nc")).toEqual(["a", "b", "c"]);
    expect(parsePromptList("a\rb")).toEqual(["a", "b"]);
    expect(parsePromptList(" \n\r\n ")).toEqual([]);
  });
});

const hit = (
  p: string,
  platform: string,
  brands: readonly string[],
): VisResult => ({
  p,
  platform,
  hit: true,
  rank: brands.indexOf("Acme") + 1,
  brands,
  domains: [],
  real: false,
});
const miss = (
  p: string,
  platform: string,
  brands: readonly string[] = [],
): VisResult => ({
  p,
  platform,
  hit: false,
  rank: null,
  brands,
  domains: [],
  real: false,
});
const allHit = (p: string): readonly VisResult[] =>
  PLATFORMS.map((platform) => hit(p, platform, ["Rival", "Acme"]));

describe("mentionRate", () => {
  it("is null with no results and a real zero with no hits", () => {
    expect(mentionRate([])).toBeNull();
    expect(mentionRate([miss("a", "ChatGPT"), miss("b", "ChatGPT")])).toBe(0);
  });

  it("is hits over total", () => {
    const results = [
      hit("a", "ChatGPT", ["Acme"]),
      hit("a", "Claude", ["Acme"]),
      miss("a", "Gemini"),
    ];
    expect(mentionRate(results)).toBeCloseTo(2 / 3, 10);
  });
});

describe("missedPrompts", () => {
  it("lists prompts with at least one miss once, in first-appearance order", () => {
    const results = Object.freeze([
      hit("p1", "ChatGPT", ["Acme"]),
      miss("p2", "ChatGPT"),
      miss("p1", "Perplexity"),
      miss("p2", "Claude"),
      ...allHit("p3"),
    ]);
    expect(missedPrompts(results)).toEqual(["p1", "p2"]);
  });

  it("is [] when every answer names the brand", () => {
    expect(missedPrompts(allHit("p"))).toEqual([]);
  });
});

describe("visibilityGaps", () => {
  it("is [] when every answer names the brand (the prototype crashed here)", () => {
    expect(visibilityGaps([...allHit("a"), ...allHit("b")], "Acme")).toEqual(
      [],
    );
    expect(visibilityGaps([], "Acme")).toEqual([]);
  });

  it("orders missed platforms by PLATFORMS and takes rivals from missed answers only", () => {
    const results = Object.freeze([
      miss("q", "Claude", ["Rival", "Other"]),
      hit("q", "Perplexity", ["OnlyWhenHit", "Acme"]),
      miss("q", "ChatGPT", ["rival", "acme", "Third"]),
      miss("q", "Claude", ["Other"]),
    ]);
    expect(visibilityGaps(results, "Acme")).toEqual([
      {
        p: "q",
        missedPlatforms: ["ChatGPT", "Claude"],
        rivals: ["Rival", "Other", "Third"],
      },
    ]);
  });

  it("never lists a blank name as a rival", () => {
    const results = [miss("q", "ChatGPT", ["", "Rival", "  "])];
    expect(visibilityGaps(results, "Acme")).toEqual([
      { p: "q", missedPlatforms: ["ChatGPT"], rivals: ["Rival"] },
    ]);
  });

  it("keeps a platform outside PLATFORMS, after the known ones", () => {
    const results = [miss("q", "Claude（联网）"), miss("q", "Gemini")];
    expect(visibilityGaps(results, "Acme")).toEqual([
      { p: "q", missedPlatforms: ["Gemini", "Claude（联网）"], rivals: [] },
    ]);
  });

  it("handles prompts that are object-prototype names", () => {
    const results = [
      miss("__proto__", "ChatGPT", ["Rival"]),
      miss("constructor", "Gemini"),
      ...allHit("toString"),
    ];
    expect(visibilityGaps(results, "Acme")).toEqual([
      { p: "__proto__", missedPlatforms: ["ChatGPT"], rivals: ["Rival"] },
      { p: "constructor", missedPlatforms: ["Gemini"], rivals: [] },
    ]);
    expect(missedPrompts(results)).toEqual(["__proto__", "constructor"]);
  });

  it("agrees with missedPrompts and accounts for every miss of a real mock run", () => {
    const profile = { url: "", brand: "Acme", competitors: "Rival, Other" };
    const prompts = ["a", "b", "c", "d", "e", "f"];
    for (const salt of ["demo-cur", "demo-prev", "demo-prev2"]) {
      const results = mockVisibility(profile, prompts, salt);
      const gaps = visibilityGaps(results, "Acme");
      expect(gaps.map((g) => g.p)).toEqual(missedPrompts(results));
      const missedCells = gaps.reduce(
        (n, g) => n + g.missedPlatforms.length,
        0,
      );
      expect(missedCells).toBe(results.filter((r) => !r.hit).length);
      expect(gaps.flatMap((g) => g.rivals)).not.toContain("Acme");
    }
  });
});
