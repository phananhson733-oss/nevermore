import { describe, expect, it } from "vitest";
import type { Profile, VisResult } from "../types.ts";
import { SERP_POOL } from "./keywords.ts";
import { COMPETITOR_PLACEHOLDERS, normQ } from "./text.ts";
import { PLATFORMS, mockVisibility } from "./visibility.ts";

/** mockVisibility: every result stays self-consistent across a salt sweep and names no invented third party. */

type VisProfile = Pick<Profile, "brand" | "competitors">;

const BRAND = "Acme";
const MAX_BRANDS = 5;
const DOMAIN_COUNT = 3;
const SWEEP_SALTS: readonly string[] = Array.from(
  { length: 150 },
  (_, i) => `sweep-${i}`,
);
const SWEEP_PROMPTS: readonly string[] = Object.freeze([
  "best seo tools",
  "how do I get cited by AI?",
]);
const RESULT_KEYS = [
  "brands",
  "domains",
  "hit",
  "p",
  "platform",
  "rank",
  "real",
] as const;
const ALL_CASES = [
  "hit",
  "miss",
  "rank-first",
  "rank-later",
  "rivals-none",
  "rivals-some",
  "rivals-all",
] as const;

const profileOf = (competitors: string, brand = BRAND): VisProfile =>
  Object.freeze({ brand, competitors });

const sweep = (profile: VisProfile): readonly VisResult[] =>
  SWEEP_SALTS.flatMap((salt) => mockVisibility(profile, SWEEP_PROMPTS, salt));

/** Every broken invariant of one result as a readable label; [] means consistent. */
function violations(result: VisResult, brand: string): readonly string[] {
  const keys = result.brands.map(normQ);
  const brandAt = keys.indexOf(normQ(brand));
  const { rank } = result;
  const checks: readonly (readonly [boolean, string])[] = [
    [result.hit === (brandAt !== -1), "hit ⇔ brands contains brand"],
    [(rank === null) === !result.hit, "rank null ⇔ miss"],
    [rank === null || rank <= result.brands.length, "rank within brands"],
    [rank === null || result.brands[rank - 1] === brand, "brands[rank-1] is the brand"],
    [new Set(keys).size === keys.length, "brands unique by normQ"],
    [result.brands.length <= MAX_BRANDS, "at most five brands"],
    [result.domains.length === DOMAIN_COUNT, "three domains"],
    [new Set(result.domains).size === result.domains.length, "domains distinct"],
    [result.domains.every((d) => SERP_POOL.includes(d)), "domains from SERP_POOL"],
    [result.real === false, "real is false"],
  ];
  return checks
    .filter(([ok]) => !ok)
    .map(([, label]) => `${result.p} / ${result.platform}: ${label}`);
}

function rankCase(rank: number | null): readonly string[] {
  if (rank === null) return [];
  return [rank === 1 ? "rank-first" : "rank-later"];
}

function rivalCase(result: VisResult, brand: string, poolSize: number): string {
  const rivals = result.brands.filter((b) => normQ(b) !== normQ(brand)).length;
  if (rivals === 0) return "rivals-none";
  return rivals === poolSize ? "rivals-all" : "rivals-some";
}

/** Which branches a set of results actually exercised. */
function casesOf(
  results: readonly VisResult[],
  brand: string,
  poolSize: number,
): ReadonlySet<string> {
  return new Set(
    results.flatMap((r) => [
      r.hit ? "hit" : "miss",
      ...rankCase(r.rank),
      rivalCase(r, brand, poolSize),
    ]),
  );
}

const SWEEP_CASES: readonly {
  readonly name: string;
  readonly profile: VisProfile;
  readonly pool: readonly string[];
}[] = [
  {
    name: "case-variant duplicates and the brand listed as a competitor",
    profile: profileOf("Rival, Other, acme, OTHER"),
    pool: ["Rival", "Other"],
  },
  {
    name: "eight competitors (only the first four can be named)",
    profile: profileOf("C1, C2, C3, C4, C5, C6, C7, C8"),
    pool: ["C1", "C2", "C3", "C4"],
  },
  {
    name: "no competitors (placeholders, never Ahrefs or Semrush)",
    profile: profileOf(""),
    pool: [...COMPETITOR_PLACEHOLDERS],
  },
];

describe.each(SWEEP_CASES)("mockVisibility sweep: $name", ({ profile, pool }) => {
  const results = sweep(profile);

  it("exercises every branch, so the invariants below are not vacuous", () => {
    expect(casesOf(results, BRAND, pool.length)).toEqual(new Set(ALL_CASES));
  });

  it("keeps hit, rank and brands consistent in every result", () => {
    expect(results.flatMap((r) => violations(r, BRAND))).toEqual([]);
  });

  it("names only the brand or the expected competitors", () => {
    const strangers = results
      .flatMap((r) => r.brands)
      .filter((b) => b !== BRAND && !pool.includes(b));
    expect(strangers).toEqual([]);
  });

  it("never names Ahrefs or Semrush", () => {
    expect(JSON.stringify(results)).not.toMatch(/ahrefs|semrush/i);
  });
});

describe("mockVisibility: rates", () => {
  const results = sweep(profileOf("Rival, Other"));

  it("hits at roughly the prototype's 38% and names each rival roughly 55% of the time", () => {
    const hitRate = results.filter((r) => r.hit).length / results.length;
    expect(hitRate).toBeGreaterThan(0.3);
    expect(hitRate).toBeLessThan(0.46);
    for (const rival of ["Rival", "Other"]) {
      const named = results.filter((r) => r.brands.includes(rival)).length;
      expect(named / results.length).toBeGreaterThan(0.45);
      expect(named / results.length).toBeLessThan(0.65);
    }
  });
});

describe("mockVisibility: the Rival,rival fixture", () => {
  const results = mockVisibility(
    profileOf("Rival,rival"),
    Object.freeze(["test"]),
    "demo-cur",
  );

  it("names Rival at most once per answer and never the lowercase duplicate", () => {
    for (const result of results) {
      expect(result.brands.filter((b) => normQ(b) === "rival")).toEqual(
        result.brands.includes("Rival") ? ["Rival"] : [],
      );
    }
    expect(results.flatMap((r) => r.brands)).not.toContain("rival");
  });

  it("does name Rival in some answer, so the check above is not vacuous", () => {
    expect(results.some((r) => r.brands.includes("Rival"))).toBe(true);
  });
});

describe("mockVisibility: shape", () => {
  const profile = profileOf("Rival, Other");

  it("returns one result per prompt per platform, in input and PLATFORMS order", () => {
    const results = mockVisibility(profile, ["b", "a"], "demo-cur");
    expect(results.map((r) => [r.p, r.platform])).toEqual(
      ["b", "a"].flatMap((p) => PLATFORMS.map((platform) => [p, platform])),
    );
  });

  it("returns [] for no prompts", () => {
    expect(mockVisibility(profile, [], "demo-cur")).toEqual([]);
  });

  it("emits exactly the persisted VisResult keys", () => {
    for (const result of mockVisibility(profile, SWEEP_PROMPTS, "demo-cur")) {
      expect(Object.keys(result).sort()).toEqual([...RESULT_KEYS]);
    }
  });

  it("never reports a hit for a blank brand", () => {
    const results = SWEEP_SALTS.slice(0, 40).flatMap((salt) =>
      mockVisibility(profileOf("Rival", "   "), SWEEP_PROMPTS, salt),
    );
    expect(results.filter((r) => r.hit || r.rank !== null)).toEqual([]);
    expect(results.flatMap((r) => r.brands)).not.toContain("");
    expect(results.flatMap((r) => violations(r, ""))).toEqual([]);
  });

  it("treats a padded brand as the trimmed brand", () => {
    expect(mockVisibility(profileOf("Rival", "  Acme "), ["q"], "s")).toEqual(
      mockVisibility(profileOf("Rival"), ["q"], "s"),
    );
  });
});

describe("mockVisibility: determinism", () => {
  const profile = profileOf("Rival, Other");

  it("replays the same salt exactly", () => {
    expect(mockVisibility(profile, SWEEP_PROMPTS, "demo-cur")).toEqual(
      mockVisibility(profile, SWEEP_PROMPTS, "demo-cur"),
    );
  });

  it("answers differently for each pinned salt (demo-cur, demo-prev, demo-prev2)", () => {
    const [cur, prev, prev2] = ["demo-cur", "demo-prev", "demo-prev2"].map(
      (salt) => mockVisibility(profile, SWEEP_PROMPTS, salt),
    );
    expect(cur).not.toEqual(prev);
    expect(cur).not.toEqual(prev2);
    expect(prev).not.toEqual(prev2);
  });

  it("does not mutate its inputs", () => {
    const prompts = Object.freeze(["a", "b"]);
    expect(() => mockVisibility(profile, prompts, "demo-cur")).not.toThrow();
    expect(profile).toEqual({ brand: BRAND, competitors: "Rival, Other" });
    expect(prompts).toEqual(["a", "b"]);
  });
});
