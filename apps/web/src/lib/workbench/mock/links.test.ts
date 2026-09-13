import { describe, expect, it } from "vitest";
import { LEVELS, LINK_TYPES } from "../enums.ts";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { LinkType } from "../types.ts";
import {
  DEFAULT_LINK_TYPES,
  LINK_POOL,
  levelForDr,
  mockLinks,
} from "./links.ts";
import { domainOf } from "./text.ts";

/** Link targets: pool shape, DR levels, order, determinism, copy, schema round trip. */

const BRAND = { brand: "Acme" };
const GENERIC_CHANNELS = [
  "Growth newsletter（垂直）",
  "行业播客",
  "同规模 SaaS 联名文章",
  "工具互推目录",
];

describe("LINK_POOL", () => {
  it("has exactly one non-empty list per link type id", () => {
    expect(Object.keys(LINK_POOL).toSorted()).toEqual(
      [...LINK_TYPES].toSorted(),
    );
    for (const type of LINK_TYPES)
      expect(LINK_POOL[type].length).toBeGreaterThan(0);
  });

  it("keeps the prototype's 20 targets", () => {
    const sites = LINK_TYPES.flatMap((type) =>
      LINK_POOL[type].map(([site]) => site),
    );
    expect(sites).toHaveLength(20);
    expect(new Set(sites).size).toBe(20);
    expect(LINK_POOL.dir.map(([site]) => site)).toEqual([
      "Product Hunt",
      "AlternativeTo",
      "SaaSHub",
      "There's An AI For That",
    ]);
  });

  it("uses an empty domain and a null DR for a channel without one site, never a dash or a number", () => {
    const entries = LINK_TYPES.flatMap((type) => LINK_POOL[type]);
    expect(JSON.stringify(entries)).not.toContain("—");
    const withoutDomain = entries
      .filter(([, domain]) => domain === "")
      .map(([site]) => site);
    expect(withoutDomain).toEqual(GENERIC_CHANNELS);
    for (const [, domain, dr] of entries) {
      expect(dr === null).toBe(domain === "");
      if (domain !== "") expect(domainOf(domain)).toBe(domain);
      if (dr !== null)
        expect(Number.isInteger(dr) && dr >= 0 && dr <= 100).toBe(true);
    }
  });
});

describe("DEFAULT_LINK_TYPES", () => {
  it("is directories, aggregators and communities", () => {
    expect(DEFAULT_LINK_TYPES).toEqual(["dir", "agg", "comm"]);
  });
});

describe("levelForDr", () => {
  it("is high above 88, mid above 75, low otherwise", () => {
    expect(levelForDr(89)).toBe("high");
    expect(levelForDr(88)).toBe("mid");
    expect(levelForDr(76)).toBe("mid");
    expect(levelForDr(75)).toBe("low");
    expect(levelForDr(100)).toBe("high");
    expect(levelForDr(0)).toBe("low");
  });
});

describe("mockLinks", () => {
  it("emits every pool entry of each requested type, in the requested order", () => {
    const types: readonly LinkType[] = ["comm", "dir"];
    const links = mockLinks(BRAND, types);
    expect(links.map((link) => link.type)).toEqual([
      ...LINK_POOL.comm.map(() => "comm"),
      ...LINK_POOL.dir.map(() => "dir"),
    ]);
    expect(links.map((link) => [link.site, link.domain, link.dr])).toEqual([
      ...LINK_POOL.comm,
      ...LINK_POOL.dir,
    ]);
  });

  it("maps difficulty from DR, null when DR is null, and draws relevance as a Level id", () => {
    const links = mockLinks(BRAND, LINK_TYPES);
    for (const link of links) {
      expect(link.difficulty).toBe(
        link.dr === null ? null : levelForDr(link.dr),
      );
      expect(LEVELS).toContain(link.relevance);
      expect(["high", "mid"]).toContain(link.relevance);
    }
    const difficulty = (site: string) =>
      links.find((link) => link.site === site)?.difficulty;
    expect(difficulty("Product Hunt")).toBe("high");
    expect(difficulty("AlternativeTo")).toBe("mid");
    expect(difficulty("SaaSHub")).toBe("low");
  });

  it("does not invent a DR or a difficulty for a channel with no domain", () => {
    const links = mockLinks(BRAND, ["media", "swap"]);
    const domainless = links.filter((link) => link.domain === "");
    expect(domainless.map((link) => link.site)).toEqual(GENERIC_CHANNELS);
    for (const link of domainless) {
      expect(link.dr).toBeNull();
      expect(link.difficulty).toBeNull();
    }
    const substack = links.find((link) => link.site === "Substack 专栏");
    expect([substack?.dr, substack?.difficulty]).toEqual([90, "high"]);
  });

  it("keeps an unknown domain as an empty string", () => {
    const podcast = mockLinks(BRAND, ["media"]).find(
      (link) => link.site === "行业播客",
    );
    expect(podcast?.domain).toBe("");
  });

  it("is the same for the same brand, ignoring case and spacing", () => {
    const types = Object.freeze([...LINK_TYPES]);
    expect(mockLinks(BRAND, types)).toEqual(mockLinks(BRAND, types));
    expect(mockLinks({ brand: "  ACME " }, types)).toEqual(
      mockLinks(BRAND, types),
    );
  });

  it("varies relevance with the brand", () => {
    const brands = Array.from({ length: 12 }, (_, i) => `Brand ${i}`);
    const bySite = new Map<string, Set<string>>();
    for (const brand of brands) {
      for (const link of mockLinks({ brand }, ["dir"])) {
        bySite.set(
          link.site,
          new Set([...(bySite.get(link.site) ?? []), link.relevance]),
        );
      }
    }
    expect([...bySite.values()].some((levels) => levels.size === 2)).toBe(true);
  });

  it("ignores a repeated type and returns nothing for no types", () => {
    expect(mockLinks(BRAND, ["dir", "dir"])).toEqual(mockLinks(BRAND, ["dir"]));
    expect(mockLinks(BRAND, [])).toEqual([]);
  });

  it("gives plain instructions without outcome claims or invented quotas", () => {
    const links = mockLinks(BRAND, LINK_TYPES);
    for (const link of links) {
      expect(link.action.trim()).not.toBe("");
      expect(link.asset.trim()).not.toBe("");
    }
    const copy = JSON.stringify(links.map((link) => [link.action, link.asset]));
    expect(copy).not.toMatch(
      /流量|引用率|效果最好|转化|见效|收录|免费工具|\d+ ?个/,
    );
  });
});

describe("mockLinks schema round trip", () => {
  it("persists every link type, null DR and null difficulty included, through the strict schema", () => {
    const targets = mockLinks(BRAND, LINK_TYPES);
    expect(new Set(targets.map((link) => link.type))).toEqual(
      new Set(LINK_TYPES),
    );
    expect(
      targets.some((link) => link.dr === null && link.difficulty === null),
    ).toBe(true);
    const state = {
      ...populatedProjectState({
        url: "https://acme.io",
        brand: BRAND.brand,
        market: "US",
      }),
      targets,
    };
    const parsed = parsePersistedState({ v: PERSISTED_VERSION, state });
    expect(parsed).not.toBeNull();
    expect(parsed?.targets).toEqual(targets);
  });
});
