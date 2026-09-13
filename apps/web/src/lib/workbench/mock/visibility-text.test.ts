import { describe, expect, it } from "vitest";
import type { Profile } from "../types.ts";
import { localPromptSet } from "./visibility.ts";

/** localPromptSet over messy profile text: sentences, punctuation, hyphens and runs of whitespace. */

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

const helpQuestions = (profile: PromptProfile) =>
  questions(localPromptSet(profile, [])).filter((q) =>
    q.startsWith("what tools help with"),
  );

const SCENARIO_PREFIX =
  "I have a small team and no SEO budget, how do I get started with";

describe("localPromptSet: positioning as the help topic", () => {
  it("does not ask what tools help with a positioning that is a sentence about the brand", () => {
    const profile = profileOf({
      brand: "Acme",
      positioning: "Acme helps SaaS teams get cited by AI.",
    });
    expect(localPromptSet(profile, [])).toEqual([
      { q: "best tools like Acme", kind: "alternative" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Acme alternatives", kind: "alternative" },
    ]);
  });

  it.each(["ACME.", "  acme   helps teams", "Ａｃｍｅ for teams"])(
    "treats %j as naming the brand",
    (positioning) => {
      const profile = profileOf({ brand: "Acme", positioning, features: "seo" });
      expect(helpQuestions(profile)).toEqual(["what tools help with seo"]);
    },
  );

  it("keeps a positioning that only starts with the brand's letters", () => {
    const profile = profileOf({ brand: "Acme", positioning: "Acmeology for teams" });
    expect(helpQuestions(profile)).toEqual([
      "what tools help with Acmeology for teams",
    ]);
  });

  it("strips trailing sentence punctuation and collapses whitespace", () => {
    expect(
      localPromptSet(profileOf({ positioning: "  rank   in AI.  " }), []),
    ).toEqual([{ q: "what tools help with rank in AI", kind: "discover" }]);
    expect(helpQuestions(profileOf({ positioning: "rank in AI！？" }))).toEqual([
      "what tools help with rank in AI",
    ]);
  });

  it("falls back to the first feature for a multi-sentence positioning", () => {
    const profile = profileOf({ positioning: "Fast. Cheap.", features: "seo audit" });
    expect(localPromptSet(profile, [])).toEqual([
      { q: "best seo audit tools for startups", kind: "discover" },
      { q: "what tools help with seo audit", kind: "discover" },
      { q: "seo audit tools compared", kind: "compare" },
      { q: "which seo audit tool should I pick?", kind: "compare" },
      { q: `${SCENARIO_PREFIX} seo audit?`, kind: "scenario" },
    ]);
  });

  it.each(["Fast; cheap", "快。便宜", "Really? Yes", "fast！cheap", "a；b"])(
    "falls back to the first feature for %j, which holds sentence punctuation",
    (positioning) => {
      const profile = profileOf({ positioning, features: "seo audit" });
      expect(helpQuestions(profile)).toEqual(["what tools help with seo audit"]);
    },
  );
});

describe("localPromptSet: whitespace inside user fields", () => {
  const SPACED = {
    features: "keyword  research",
    positioning: "rank   in AI",
    competitors: "Ri  val",
  } as const;

  it.each(["Acme", "   "])(
    "never leaves a double, leading or trailing space (brand %j)",
    (brand) => {
      const qs = questions(localPromptSet(profileOf({ ...SPACED, brand }), []));
      expect(qs.length).toBeGreaterThan(4);
      expect(qs.filter((q) => /\s{2}|^\s|\s$/.test(q))).toEqual([]);
    },
  );

  it("pins the collapsed spelling", () => {
    expect(localPromptSet(profileOf({ ...SPACED, brand: "   " }), [])).toEqual([
      { q: "best keyword research tools for startups", kind: "discover" },
      { q: "what tools help with rank in AI", kind: "discover" },
      { q: "keyword research tools compared", kind: "compare" },
      { q: "which keyword research tool should I pick?", kind: "compare" },
      { q: "Ri val alternatives", kind: "alternative" },
      { q: `${SCENARIO_PREFIX} keyword research?`, kind: "scenario" },
    ]);
  });
});

describe("localPromptSet: tool words and punctuation in features", () => {
  it("does not double tools after a hyphen or leak a feature's full stop", () => {
    const seeds = localPromptSet(
      profileOf({
        brand: "Acme",
        features: "dev-tools, SEO Tools.",
        competitors: "Rival, Other",
      }),
      [],
    );
    expect(seeds).toEqual([
      { q: "best dev-tools for startups", kind: "discover" },
      { q: "what tools help with dev-tools", kind: "discover" },
      { q: "Acme vs Rival", kind: "compare" },
      { q: "is Other the best option for SEO Tools?", kind: "compare" },
      { q: "is Acme worth using?", kind: "verify" },
      { q: "Rival alternatives", kind: "alternative" },
      { q: `${SCENARIO_PREFIX} dev-tools?`, kind: "scenario" },
    ]);
    const text = questions(seeds).join("\n");
    expect(text).not.toMatch(/tools tools/i);
    expect(text).not.toContain(".?");
  });

  it("drops a feature that is nothing but punctuation", () => {
    const qs = questions(
      localPromptSet(profileOf({ features: "., seo audit" }), []),
    );
    expect(qs).toContain("best seo audit tools for startups");
    expect(qs).toContain("which seo audit tool should I pick?");
    expect(qs.filter((q) => /\s[.。!?！？]|\s{2}/.test(q))).toEqual([]);
  });
});
