import { describe, expect, it } from "vitest";
import { LINK_TYPES } from "../enums.ts";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { CompData, DomainStats, Profile } from "../types.ts";
import { buildCompData, domainStats, isRealCompetitor } from "./competitors.ts";
import { mockLinks } from "./links.ts";
import { COMPETITOR_PLACEHOLDERS } from "./text.ts";

/** Domain overview and the assembled CompData; the gap rows themselves are in competitors-gap.test.ts. */

const AT = "2026-09-13 10:30";
const SEEDS = ["seo audit", "crm"] as const;
const OTHER_PATHS = ["/blog", "/pricing", "/compare"];

const profileWith = (overrides: Partial<Profile> = {}): Profile => ({
  url: "https://www.Acme.io/pricing",
  brand: "Acme",
  positioning: "",
  features: "Rank Tracking, alerts",
  competitors: "Rival Corp, other.io",
  market: "US",
  ...overrides,
});

const paths = (stats: DomainStats): readonly string[] =>
  stats.topPages.map((page) => page.path);

const subjects = (data: CompData): readonly string[] =>
  data.domains.map((stats) => stats.domain);

/** Competitor entries of a CompData built from a profile with a non-empty url. */
const compNames = (data: CompData): readonly string[] => subjects(data).slice(1);

const build = (overrides: Partial<Profile>): CompData =>
  buildCompData(profileWith(overrides), SEEDS, [], AT);

describe("domainStats", () => {
  it("uses the first feature for the project's own blog page", () => {
    const stats = domainStats("acme.io", profileWith());
    expect(stats.domain).toBe("acme.io");
    expect(paths(stats)).toEqual([
      "/blog/rank-tracking-guide",
      "/pricing",
      "/compare",
    ]);
  });

  it("falls back to /blog/guide for the own domain when features are empty", () => {
    for (const features of ["", " , "]) {
      expect(paths(domainStats("acme.io", profileWith({ features })))).toEqual([
        "/blog/guide",
        "/pricing",
        "/compare",
      ]);
    }
  });

  it("gives any other subject fixed paths that do not borrow the project's features", () => {
    for (const subject of ["Rival Corp", "other.io", "[竞品 A]", "ACME.io"]) {
      const stats = domainStats(subject, profileWith());
      expect(stats.domain).toBe(subject);
      expect(paths(stats)).toEqual(OTHER_PATHS);
    }
  });

  it("produces finite integers with dr in [0, 92] for own and other subjects", () => {
    const names = Array.from({ length: 300 }, (_, i) => `site-${i}.io`);
    const profile = profileWith({ url: "site-7.io", features: "" });
    for (const subject of names) {
      const stats = domainStats(subject, profile);
      const numbers = [
        stats.traffic,
        stats.kws,
        stats.dr,
        stats.refdomains,
        ...stats.topPages.map((page) => page.share),
      ];
      for (const value of numbers) expect(Number.isInteger(value)).toBe(true);
      expect(stats.traffic % 10).toBe(0);
      expect(stats.dr).toBeGreaterThanOrEqual(0);
      expect(stats.dr).toBeLessThanOrEqual(92);
      for (const page of stats.topPages) expect(page.share).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    expect(domainStats("Rival Corp", profileWith())).toEqual(
      domainStats("Rival Corp", profileWith()),
    );
  });
});

describe("isRealCompetitor", () => {
  const own = { url: "https://www.Acme.io/pricing", brand: "Acme" };

  it("rejects the brand, the own domain in any spelling and a typed R9 placeholder", () => {
    const names = [
      "Acme",
      " acme ",
      "ＡＣＭＥ",
      "acme.io",
      "www.ACME.io",
      "https://acme.io/blog",
      ...COMPETITOR_PLACEHOLDERS,
      " [竞品 b] ",
    ];
    for (const name of names) expect(isRealCompetitor(own, name), name).toBe(false);
  });

  it("accepts anyone else, including look-alike domains and near-placeholders", () => {
    for (const name of ["Rival", "acme.io.example", "notacme.io", "Acme Corp", "[竞品 D]", "竞品 A"]) {
      expect(isRealCompetitor(own, name), name).toBe(true);
    }
  });

  it("keeps any domain when the project has no url, and any name when it has no brand", () => {
    expect(isRealCompetitor({ url: "", brand: "Acme" }, "acme.io")).toBe(true);
    expect(isRealCompetitor({ url: "", brand: "" }, "Acme")).toBe(true);
  });
});

describe("buildCompData", () => {
  it("starts with the project's own domain, then the raw competitor names", () => {
    const data = build({});
    expect(subjects(data)).toEqual(["acme.io", "Rival Corp", "other.io"]);
    expect(data.gap.comps).toEqual(["Rival Corp", "other.io"]);
    expect(data.at).toBe(AT);
  });

  it("never turns a competitor name into an invented .com domain (R9)", () => {
    const data = build({ competitors: "Rival Corp, Beta, 竞品丙" });
    expect(compNames(data)).toEqual(["Rival Corp", "Beta", "竞品丙"]);
    expect(JSON.stringify(data.domains)).not.toMatch(/\.com/);
    expect(JSON.stringify(data.gap.comps)).not.toMatch(/\.com/);
  });

  it("keeps a domain the user typed exactly as typed", () => {
    expect(compNames(build({ competitors: "rival.com" }))).toEqual(["rival.com"]);
  });

  it("uses the placeholder names when no competitor is filled in", () => {
    for (const competitors of ["", " , "]) {
      const data = build({ competitors });
      expect(compNames(data)).toEqual([...COMPETITOR_PLACEHOLDERS]);
      expect(data.gap.comps).toEqual([...COMPETITOR_PLACEHOLDERS]);
    }
  });

  it("compares one competitor when one is filled in", () => {
    const data = build({ competitors: "Rival" });
    expect(compNames(data)).toEqual(["Rival"]);
    expect(data.gap.rows.length).toBeGreaterThan(0);
    for (const row of data.gap.rows) expect(row.ranks).toHaveLength(1);
  });

  it("compares only the first three of four or more competitors", () => {
    const data = build({ competitors: "A1, B2, C3, D4, E5" });
    expect(compNames(data)).toEqual(["A1", "B2", "C3"]);
    expect(data.gap.comps).toEqual(["A1", "B2", "C3"]);
    expect(data.gap.rows.length).toBeGreaterThan(0);
    for (const row of data.gap.rows) expect(row.ranks).toHaveLength(3);
  });

  it("drops a competitor that is the brand itself or the project's own domain", () => {
    const data = build({ competitors: "ACME, Rival, www.acme.io, Other, Third" });
    expect(compNames(data)).toEqual(["Rival", "Other", "Third"]);
    expect(data.gap.comps).toEqual(["Rival", "Other", "Third"]);
  });

  it("compares nobody when every competitor is the brand itself", () => {
    const data = build({ competitors: "acme, Acme" });
    expect(subjects(data)).toEqual(["acme.io"]);
    expect(data.gap).toEqual({ comps: [], rows: [] });
  });

  it("compares nobody for a placeholder typed as a competitor, and skips it before a real one", () => {
    const data = build({ competitors: "[竞品 A], [竞品 b]" });
    expect(subjects(data)).toEqual(["acme.io"]);
    expect(data.gap).toEqual({ comps: [], rows: [] });
    expect(compNames(build({ competitors: "[竞品 C], Rival" }))).toEqual(["Rival"]);
  });

  it("has no own entry when the url is empty, so no stats are made up for a site that does not exist", () => {
    for (const url of ["", "   "]) {
      const data = build({ url });
      expect(subjects(data)).toEqual(["Rival Corp", "other.io"]);
      expect(data.gap.comps).toEqual(subjects(data));
    }
    const nobody = build({ url: "", competitors: "Acme" });
    expect(nobody.domains).toEqual([]);
    expect(nobody.gap.comps).toEqual([]);
  });

  it("lists exactly gap.comps after the own domain when the url is non-empty", () => {
    for (const competitors of ["Rival Corp, other.io", "", "A1, B2, C3, D4"]) {
      const data = build({ competitors });
      expect(subjects(data)[0]).toBe("acme.io");
      expect(data.gap.comps).toEqual(compNames(data));
    }
  });

  it("is deterministic and does not modify its inputs", () => {
    const seeds = Object.freeze([...SEEDS]);
    const gscRows = Object.freeze([
      Object.freeze({ query: "crm", clicks: 1, impressions: 10, ctr: 10, position: 30 }),
    ]);
    const profile = Object.freeze(profileWith());
    expect(buildCompData(profile, seeds, gscRows, AT)).toEqual(
      buildCompData(profile, seeds, gscRows, AT),
    );
  });
});

describe("schema round trip", () => {
  it("persists buildCompData and mockLinks output through the strict schema", () => {
    const profiles = [
      profileWith(),
      profileWith({ competitors: "", features: "" }),
      profileWith({ competitors: "acme" }),
      profileWith({ url: "" }),
    ];
    for (const profile of profiles) {
      const compData = buildCompData(profile, SEEDS, [], AT);
      const targets = mockLinks(profile, LINK_TYPES);
      const state = {
        ...populatedProjectState({ url: profile.url, brand: profile.brand, market: profile.market }),
        compData,
        targets,
      };
      const parsed = parsePersistedState({ v: PERSISTED_VERSION, state });
      expect(parsed).not.toBeNull();
      expect(parsed?.compData).toEqual(compData);
      expect(parsed?.targets).toEqual(targets);
    }
  });
});
