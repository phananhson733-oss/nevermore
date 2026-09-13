import { describe, expect, it } from "vitest";
import type { GapRow, GscRow, Profile } from "../types.ts";
import { keywordGap } from "./competitors.ts";
import { PATTERNS, kwMetrics } from "./keywords.ts";
import { rngOf, seedKey } from "./rng.ts";
import { COMPETITOR_PLACEHOLDERS, normQ } from "./text.ts";

/** keywordGap: candidates, competitors, distinct ranks, GSC alignment. */

type GapProfile = Pick<Profile, "brand" | "url" | "competitors">;

const THREE: GapProfile = { brand: "Acme", url: "acme.io", competitors: "Rival, Other, Third" };
const RANK_MAX = 12;
const GAP_TEMPLATES = PATTERNS.slice(0, 8).filter((pattern) => pattern.vs !== true);
const SWEEP_SEEDS = Array.from({ length: 240 }, (_, i) => `topic ${i}`);

const gsc = (query: string, position: number | null): GscRow => ({
  query,
  clicks: null,
  impressions: null,
  ctr: null,
  position,
});

/** One call per seed stays under the 30-row cap, so every kept row of every seed is visible. */
const sweepRows = (profile: GapProfile): readonly GapRow[] =>
  SWEEP_SEEDS.flatMap((seed) => keywordGap(profile, [seed], []).rows);

const rowFor = (rows: readonly GapRow[], query: string): GapRow | undefined =>
  rows.find((row) => normQ(row.q) === normQ(query));

const ranked = (row: GapRow): readonly number[] =>
  row.ranks.filter((rank): rank is number => rank !== null);

describe("keywordGap: candidates", () => {
  it("draws each row from one of the first eight templates of a seed, with that template's page", () => {
    const rows = sweepRows(THREE);
    const hit = new Set<number>();
    for (const row of rows) {
      const index = SWEEP_SEEDS.flatMap((seed) =>
        GAP_TEMPLATES.map((pattern, i) => (pattern.make(seed) === row.q ? i : -1)),
      ).find((i) => i >= 0);
      expect(index).toBeDefined();
      if (index === undefined) continue;
      hit.add(index);
      expect(row.page).toBe(GAP_TEMPLATES[index]?.page);
    }
    expect(hit.size).toBe(GAP_TEMPLATES.length);
    expect(rows.some((row) => / pricing$| vs$/.test(row.q))).toBe(false);
  });

  it("copies the keyword metrics of the query", () => {
    for (const row of keywordGap(THREE, ["crm", "seo audit"], []).rows) {
      const { volume, kd, cpc, aio } = row;
      expect({ volume, kd, cpc, aio }).toEqual(kwMetrics(row.q));
    }
  });

  it("trims seeds, skips blank ones and dedupes by normQ", () => {
    const once = keywordGap(THREE, ["SEO"], []);
    expect(once.rows.length).toBeGreaterThan(0);
    expect(keywordGap(THREE, ["SEO", "seo", " seo "], [])).toEqual(once);
    expect(keywordGap(THREE, ["", "  "], []).rows).toEqual([]);
    expect(keywordGap(THREE, [], []).rows).toEqual([]);
  });

  it("keeps the 30 highest-volume rows, sorted by volume descending", () => {
    const all = sweepRows(THREE);
    const capped = keywordGap(THREE, SWEEP_SEEDS, []).rows;
    expect(capped).toHaveLength(30);
    const volumes = capped.map((row) => row.volume);
    expect(volumes).toEqual(volumes.toSorted((a, b) => b - a));
    const keptQueries = new Set(capped.map((row) => row.q));
    const lowestKept = Math.min(...volumes);
    for (const row of all) {
      if (!keptQueries.has(row.q)) expect(row.volume).toBeLessThanOrEqual(lowestKept);
    }
  });
});

describe("keywordGap: competitors", () => {
  it("compares up to three real competitors, one rank slot each", () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ["Rival, Other, Third", ["Rival", "Other", "Third"]],
      ["Rival", ["Rival"]],
      ["A1, B2, C3, D4, E5", ["A1", "B2", "C3"]],
      ["", COMPETITOR_PLACEHOLDERS],
      ["acme, Rival, ACME.io", ["Rival"]],
    ];
    for (const [competitors, expected] of cases) {
      const gap = keywordGap({ ...THREE, competitors }, ["crm", "seo audit"], []);
      expect(gap.comps).toEqual([...expected]);
      expect(gap.rows.length).toBeGreaterThan(0);
      for (const row of gap.rows) expect(row.ranks).toHaveLength(expected.length);
    }
  });

  it("has no rows when every competitor is the brand itself", () => {
    expect(keywordGap({ ...THREE, competitors: "ACME" }, ["crm"], [])).toEqual({
      comps: [],
      rows: [],
    });
  });

  it("keeps only rows where a competitor ranks and we are unranked or below 20", () => {
    const rows = sweepRows(THREE);
    expect(rows.length).toBeGreaterThan(300);
    for (const row of rows) {
      expect(ranked(row).length).toBeGreaterThan(0);
      if (row.ours !== null) expect(row.ours).toBeGreaterThan(20);
    }
  });
});

describe("keywordGap: ranks", () => {
  it("gives the competitors in one row distinct integer ranks in [1, 12]", () => {
    const rows = sweepRows(THREE);
    const seen = new Set<number>();
    for (const row of rows) {
      const ranks = ranked(row);
      expect(new Set(ranks).size).toBe(ranks.length);
      for (const rank of ranks) {
        expect(Number.isInteger(rank)).toBe(true);
        expect(rank).toBeGreaterThanOrEqual(1);
        expect(rank).toBeLessThanOrEqual(RANK_MAX);
        seen.add(rank);
      }
    }
    expect(seen).toEqual(new Set(Array.from({ length: RANK_MAX }, (_, i) => i + 1)));
  });

  it("sweeps enough multi-competitor rows that independent draws would have collided", () => {
    const multi = sweepRows(THREE).filter((row) => ranked(row).length >= 2);
    expect(multi.length).toBeGreaterThan(150);
    const collisions = multi.filter((row) => {
      const next = rngOf(seedKey("independent", row.q));
      const draws = ranked(row).map(() => 1 + Math.floor(next() * RANK_MAX));
      return new Set(draws).size < draws.length;
    });
    expect(collisions.length).toBeGreaterThan(0);
  });

  it("never reports our rank as 0", () => {
    for (const row of sweepRows(THREE)) {
      if (row.ours !== null) expect(Number.isInteger(row.ours) && row.ours >= 1).toBe(true);
    }
  });

  it("is deterministic and does not modify its inputs", () => {
    const seeds = Object.freeze(["crm", "seo audit"]);
    const gscRows = Object.freeze([Object.freeze(gsc("best crm tools", 30))]);
    const profile = Object.freeze({ ...THREE });
    expect(keywordGap(profile, seeds, gscRows)).toEqual(keywordGap(profile, seeds, gscRows));
  });
});

describe("keywordGap: GSC alignment", () => {
  const base = keywordGap(THREE, ["crm"], []);
  const target = base.rows[0];

  it("has a kept row to align against", () => {
    expect(target).toBeDefined();
  });

  it("keeps the row with ours = round(position) when a normQ-matching GSC position is above 20", () => {
    if (target === undefined) return;
    const spelled = `  ${target.q.toUpperCase().replace(/ /g, "  ")} `;
    for (const [position, ours] of [[25.4, 25], [20.5, 21], [88, 88]] as const) {
      const row = rowFor(keywordGap(THREE, ["crm"], [gsc(spelled, position)]).rows, target.q);
      expect(row?.ours).toBe(ours);
      expect(row?.ranks).toEqual(target.ranks);
    }
  });

  it("drops the row when the GSC position rounds to 20 or better", () => {
    if (target === undefined) return;
    for (const position of [20.4, 20, 3, 1, 0.4]) {
      const gap = keywordGap(THREE, ["crm"], [gsc(target.q, position)]);
      expect(rowFor(gap.rows, target.q)).toBeUndefined();
    }
  });

  it("ignores a GSC row whose position is null, zero, negative or not finite", () => {
    for (const position of [null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const gscRows = base.rows.map((row) => gsc(row.q, position));
      expect(keywordGap(THREE, ["crm"], gscRows)).toEqual(base);
    }
  });

  it("uses the first usable GSC position for a query", () => {
    if (target === undefined) return;
    const rows = [gsc(target.q, null), gsc(target.q, 30), gsc(target.q, 40)];
    expect(rowFor(keywordGap(THREE, ["crm"], rows).rows, target.q)?.ours).toBe(30);
  });

  it("brings back a row that the random rank had dropped", () => {
    const revived = SWEEP_SEEDS.slice(0, 80).flatMap((seed) => {
      const kept = new Set(keywordGap(THREE, [seed], []).rows.map((row) => row.q));
      return GAP_TEMPLATES.map((pattern) => pattern.make(seed))
        .filter((q) => !kept.has(q))
        .flatMap((q) => {
          const row = rowFor(keywordGap(THREE, [seed], [gsc(q, 50)]).rows, q);
          return row === undefined ? [] : [row];
        });
    });
    expect(revived.length).toBeGreaterThan(0);
    for (const row of revived) expect(row.ours).toBe(50);
  });
});
