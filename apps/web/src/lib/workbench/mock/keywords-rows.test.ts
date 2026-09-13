import { describe, expect, it } from "vitest";
import type { GscRow, KeywordRow, Profile } from "../types.ts";
import {
  AI_PATTERNS,
  PATTERNS,
  buildRows,
  findRow,
  kwMetrics,
  opportunity,
} from "./keywords.ts";
import { normQ } from "./text.ts";

/** Row assembly: GSC first, normQ dedupe, vs template, keys, sort, slugs. */

type RowProfile = Pick<Profile, "brand" | "competitors">;

const PROFILE: RowProfile = { brand: "Acme", competitors: " Rival , Other" };
const GSC_KEYS = ["clicks", "impressions", "position", "gscStatus"] as const;
/** Every pattern except vs, plus every AI template. */
const ROWS_PER_SEED_WITHOUT_VS = PATTERNS.length - 1 + AI_PATTERNS.length;

const gsc = (query: string, overrides: Partial<GscRow> = {}): GscRow => ({
  query,
  clicks: null,
  impressions: null,
  ctr: null,
  position: null,
  ...overrides,
});

const byQuery = (rows: readonly KeywordRow[], query: string): readonly KeywordRow[] =>
  rows.filter((row) => normQ(row.q) === normQ(query));

describe("buildRows: sources and keys", () => {
  it("returns nothing for no seeds and no GSC rows", () => {
    expect(buildRows([], PROFILE, [])).toEqual([]);
    expect(buildRows(["", "   "], PROFILE, [])).toEqual([]);
  });

  it("turns a GSC row into a gsc-sourced row with its four GSC keys", () => {
    const [row] = buildRows([], PROFILE, [
      gsc("acme pricing", { clicks: 5, impressions: 12_345, ctr: 0.04, position: 12 }),
    ]);
    expect(row).toMatchObject({
      q: "acme pricing",
      seed: "",
      intent: "navigational",
      stage: "BOFU",
      page: "landing",
      engine: "seo",
      source: "gsc",
      clicks: 5,
      impressions: 12_345,
      position: 12,
      gscStatus: "borderline",
      volume: 12_350,
    });
    for (const key of GSC_KEYS) expect(Object.hasOwn(row ?? {}, key)).toBe(true);
  });

  it("keeps null GSC values as own keys and falls back to the estimate for volume", () => {
    const [row] = buildRows([], PROFILE, [gsc("llm seo checklist")]);
    expect(row).toMatchObject({ clicks: null, impressions: null, position: null, gscStatus: "unknown" });
    for (const key of GSC_KEYS) expect(Object.hasOwn(row ?? {}, key)).toBe(true);
    expect(row?.volume).toBe(kwMetrics("llm seo checklist").volume);
  });

  it("nulls a position that is not a real rank, so 0 cannot sort ahead of rank 1", () => {
    for (const position of [0, -3, Number.NaN]) {
      const [row] = buildRows([], PROFILE, [gsc("llm seo checklist", { position })]);
      expect(row?.position).toBeNull();
      expect(row?.gscStatus).toBe("unknown");
    }
    expect(buildRows([], PROFILE, [gsc("llm seo checklist", { position: 1 })])[0]?.position).toBe(1);
  });

  it("uses the larger of the estimate and impressions rounded up to tens", () => {
    const query = "content brief generator";
    const estimate = kwMetrics(query).volume;
    const volumeFor = (impressions: number | null): number | undefined =>
      buildRows([], PROFILE, [gsc(query, { impressions })])[0]?.volume;
    expect(volumeFor(3)).toBe(estimate);
    expect(volumeFor(Number.NaN)).toBe(estimate);
    expect(volumeFor(-50_000)).toBe(estimate);
    expect(volumeFor(50_001)).toBe(50_010);
    expect(volumeFor(estimate + 1)).toBe(estimate + 10);
  });

  it("gives seed rows no GSC keys at all", () => {
    const rows = buildRows(["seo"], PROFILE, []);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe("generated");
      for (const key of GSC_KEYS) expect(Object.hasOwn(row, key)).toBe(false);
    }
  });

  it("skips GSC rows whose query is blank", () => {
    expect(buildRows([], PROFILE, [gsc(""), gsc("   ")])).toEqual([]);
  });

  it("scores each row with opportunity and carries the estimated metrics", () => {
    const rows = buildRows(["seo"], PROFILE, [gsc("geo optimization tool", { impressions: 1580, position: 22.8 })]);
    for (const row of rows) {
      expect(row.score).toBe(opportunity(row));
      const { volume: _volume, ...metrics } = kwMetrics(row.q);
      expect(row).toMatchObject(metrics);
    }
  });

  it("classifies GSC rows and gives them a status from their position", () => {
    const rows = buildRows([], PROFILE, [
      gsc("how to rank in chatgpt", { position: 31.5 }),
      gsc("best geo tools 2026", { position: 8 }),
    ]);
    expect(byQuery(rows, "how to rank in chatgpt")[0]).toMatchObject({ intent: "informational", stage: "TOFU", gscStatus: "gap" });
    expect(byQuery(rows, "best geo tools 2026")[0]).toMatchObject({ intent: "commercial", page: "comparison", gscStatus: "ranked" });
  });
});

describe("buildRows: templates", () => {
  it("emits every pattern and AI template per seed with their own fields", () => {
    const rows = buildRows(["crm"], PROFILE, []);
    expect(rows).toHaveLength(ROWS_PER_SEED_WITHOUT_VS + 1);
    expect(byQuery(rows, "best crm tools")[0]).toMatchObject({ seed: "crm", intent: "commercial", stage: "MOFU", page: "listicle", engine: "both" });
    expect(byQuery(rows, "is Acme good for crm?")[0]).toMatchObject({ seed: "crm", intent: "commercial", stage: "MOFU", page: "answer-page", engine: "geo" });
  });

  it("trims padded seeds before building queries", () => {
    // No competitors, so no vs row: every row comes from the seed.
    const rows = buildRows([" seo "], { brand: "Acme", competitors: "" }, []);
    expect(rows.map((row) => row.q)).toContain("best seo tools");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.seed).toBe("seo");
  });

  it("builds the vs row from the brand and the first real competitor, once, with no seed", () => {
    const rows = buildRows(["seo", "crm"], PROFILE, []);
    const vsRows = rows.filter((row) => row.q.includes(" vs "));
    expect(vsRows).toHaveLength(1);
    expect(vsRows[0]).toMatchObject({ q: "Acme vs Rival", seed: "", intent: "commercial", stage: "BOFU", page: "comparison", engine: "both", source: "generated" });
    expect(rows).toHaveLength(2 * ROWS_PER_SEED_WITHOUT_VS + 1);
    expect(rows.some((row) => row.q.endsWith(" vs"))).toBe(false);
  });

  it("skips the vs row without real competitors or without a brand, never using placeholders", () => {
    for (const profile of [
      { brand: "Acme", competitors: "" },
      { brand: "Acme", competitors: " , " },
      { brand: "", competitors: "Rival" },
      { brand: "  ", competitors: "Rival" },
    ]) {
      const rows = buildRows(["seo"], profile, []);
      expect(rows.some((row) => / vs\b/.test(row.q))).toBe(false);
      expect(rows.some((row) => row.q.includes("[竞品"))).toBe(false);
    }
  });

  it("skips a competitor that is the brand itself", () => {
    const rows = buildRows(["seo"], { brand: "Acme", competitors: "acme, Rival" }, []);
    expect(rows.filter((row) => row.q.includes(" vs ")).map((row) => row.q)).toEqual(["Acme vs Rival"]);
  });

  it("drops the brand-naming AI template when there is no brand", () => {
    const rows = buildRows(["seo"], { brand: "", competitors: "Rival" }, []);
    expect(rows).toHaveLength(ROWS_PER_SEED_WITHOUT_VS - 1);
    expect(rows.some((row) => /\bis\s+good for\b/.test(row.q))).toBe(false);
  });

  it("builds slugs from the page type", () => {
    const rows = buildRows(["seo"], PROFILE, [gsc("llm seo checklist")]);
    const slugOf = (query: string): string | undefined => byQuery(rows, query)[0]?.slug;
    expect(slugOf("llm seo checklist")).toBe("/blog/llm-seo-checklist");
    expect(slugOf("how to seo")).toBe("/blog/how-to-seo");
    expect(slugOf("free seo tool")).toBe("/tools/free-seo-tool");
    expect(slugOf("seo template")).toBe("/tools/seo-template");
    expect(slugOf("best seo tools")).toBe("/best-seo-tools");
    expect(slugOf("what is seo")).toBe("/what-is-seo");
    expect(slugOf("seo pricing")).toBe("/seo-pricing");
    expect(slugOf("Acme vs Rival")).toBe("/acme-vs-rival");
    expect(slugOf("which seo tool works best for a small team?")).toBe("/which-seo-tool-works-best-for-a-small-team");
  });
});

describe("buildRows: dedupe and order", () => {
  it("dedupes by normQ with the first spelling winning, GSC before seeds", () => {
    const rows = buildRows(["seo"], PROFILE, [gsc("Best SEO  Tools", { position: 4 })]);
    const matches = byQuery(rows, "best seo tools");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ q: "Best SEO  Tools", source: "gsc", seed: "" });
    expect(rows).toHaveLength(ROWS_PER_SEED_WITHOUT_VS + 1);
  });

  it("produces one group for seeds that differ only in case", () => {
    const rows = buildRows(["SEO", "seo"], PROFILE, []);
    expect(rows).toHaveLength(ROWS_PER_SEED_WITHOUT_VS + 1);
    expect(rows.map((row) => row.q)).toContain("best SEO tools");
    expect(rows.map((row) => row.q)).not.toContain("best seo tools");
  });

  it("collapses whitespace and case in GSC queries", () => {
    const rows = buildRows([], PROFILE, [gsc("best  seo tools"), gsc("Best SEO Tools")]);
    expect(rows.map((row) => row.q)).toEqual(["best  seo tools"]);
  });

  it("sorts by score descending", () => {
    const rows = buildRows(["seo", "crm"], PROFILE, [gsc("geo optimization tool", { position: 22.8 })]);
    const scores = rows.map((row) => row.score);
    expect(scores).toEqual(scores.toSorted((a, b) => b - a));
  });

  it("keeps insertion order among equal scores, not alphabetical order", () => {
    // Reverse-alphabetical input: alphabetical tie-breaking would flip every tie group.
    const queries = Array.from({ length: 80 }, (_, index) => `tie probe ${String(79 - index).padStart(2, "0")}`);
    const rows = buildRows([], PROFILE, queries.map((query) => gsc(query)));
    const scores = [...new Set(rows.map((row) => row.score))];
    const tied = scores
      .map((score) => rows.filter((row) => row.score === score))
      .filter((group) => group.length >= 3);
    expect(tied.length).toBeGreaterThan(0);
    for (const group of tied) {
      const order = group.map((row) => row.q);
      expect(order).toEqual(order.toSorted().toReversed());
      expect(order).not.toEqual(order.toSorted());
      expect(order).not.toEqual(order.toSorted((a, b) => a.localeCompare(b)));
    }
  });
});

describe("buildRows: inputs", () => {
  it("reads only brand and competitors from the profile, directly or through a spread or `in`", () => {
    const ALLOWED: readonly PropertyKey[] = ["brand", "competitors"];
    const touched = new Set<PropertyKey>();
    const full: Profile = {
      url: "https://acme.io",
      brand: "Acme",
      positioning: "rank tracking",
      features: "Rank Tracker",
      competitors: "Rival",
      market: "US",
    };
    const refuse = (key: PropertyKey): never => {
      throw new Error(`read profile.${String(key)}`);
    };
    const profile = new Proxy(full, {
      get(target, key, receiver) {
        touched.add(key);
        return ALLOWED.includes(key) ? Reflect.get(target, key, receiver) : refuse(key);
      },
      has(target, key) {
        return ALLOWED.includes(key) ? Reflect.has(target, key) : refuse(key);
      },
      ownKeys() {
        return refuse("ownKeys");
      },
      getOwnPropertyDescriptor(_target, key) {
        return refuse(key);
      },
    });
    // The traps themselves work: an indirect read of any other field throws.
    expect(() => ({ ...profile }).features).toThrow();
    expect(() => "url" in profile).toThrow();
    expect(() => Object.keys(profile)).toThrow();
    touched.clear();
    expect(buildRows(["seo"], profile, [gsc("acme login")]).length).toBeGreaterThan(0);
    expect([...touched].toSorted()).toEqual(["brand", "competitors"]);
  });

  it("does not mutate its inputs and is deterministic", () => {
    const seeds = Object.freeze(["seo", "crm"]);
    const profile = Object.freeze({ ...PROFILE });
    const gscRows = Object.freeze([Object.freeze(gsc("llm seo checklist", { impressions: 3120, position: 8.4 }))]);
    const first = buildRows(seeds, profile, gscRows);
    expect(buildRows(seeds, profile, gscRows)).toEqual(first);
    expect(seeds).toEqual(["seo", "crm"]);
  });
});

describe("findRow", () => {
  const rows = buildRows([], PROFILE, [gsc("Best SEO Tools"), gsc("llm seo checklist")]);

  it("matches by normQ", () => {
    expect(findRow(rows, "BEST SEO TOOLS")?.q).toBe("Best SEO Tools");
    expect(findRow(rows, "  best   seo tools ")?.q).toBe("Best SEO Tools");
  });

  it("finds nothing for a blank or absent query", () => {
    expect(findRow(rows, "")).toBeUndefined();
    expect(findRow(rows, "   ")).toBeUndefined();
    expect(findRow(rows, "best seo")).toBeUndefined();
  });
});
