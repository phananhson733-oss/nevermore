import { describe, expect, it } from "vitest";
import { initialProjectState, reduce } from "./reducer.ts";
import { savedQueries, seedList, selectCounts } from "./selectors.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };
const base = initialProjectState(seed);

describe("seedList", () => {
  it("splits on newlines and commas, trims, drops blanks", () => {
    expect(seedList({ ...base, seeds: " a ,b\n\nc,\n" })).toEqual(["a", "b", "c"]);
    expect(seedList(base)).toEqual([]);
  });
});

describe("savedQueries", () => {
  it("returns the saved words in order", () => {
    const s = reduce(base, { type: "setSaved", saved: [{ q: "b", addedAt: "t", source: "manual" }, { q: "a", addedAt: "t", source: "gap" }] });
    expect(savedQueries(s)).toEqual(["b", "a"]);
  });
});

describe("selectCounts", () => {
  it("is all null on a fresh project (never zero)", () => {
    expect(selectCounts(base, null)).toEqual({
      audit: null, visibility: null, keywords: null, keywordLibrary: null,
      competitors: null, links: null, kb: null, artifacts: null, dataSources: null,
    });
  });

  it("reads the opengengrowth badge semantics", () => {
    let s = reduce(base, {
      type: "auditComplete",
      report: { at: "t", score: 56, findings: [], crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1", schema: 1, llmReadable: 1 }, pageRows: [] },
    });
    s = reduce(s, {
      type: "visComplete", at: "t",
      results: [
        { p: "a", platform: "x", hit: true, rank: 1, brands: [], domains: [], real: false },
        { p: "b", platform: "x", hit: false, rank: null, brands: [], domains: [], real: false },
        { p: "c", platform: "x", hit: false, rank: null, brands: [], domains: [], real: false },
      ],
    });
    s = reduce(s, { type: "addArtifact", artifact: { id: "1", at: "t", module: "audit", type: "md", engine: "seo", title: "t", content: "" } });
    s = reduce(s, { type: "setSaved", saved: [{ q: "k", addedAt: "t", source: "manual" }] });
    s = reduce(s, { type: "setGscRows", rows: [{ query: "q", clicks: 1, impressions: 1, ctr: 1, position: 1 }] });
    s = reduce(s, { type: "setKb", kb: { at: "t", entries: [
      { id: "1", cat: "pricing", statement: "", evidence: "", source: "", from: "gap" },
      { id: "2", cat: "capability", statement: "has", evidence: "", source: "", from: "crawl" },
    ] } });
    const counts = selectCounts(s, 12);
    expect(counts.audit).toBe("56");
    expect(counts.visibility).toBe("33%");
    expect(counts.keywords).toBe("12");
    expect(counts.artifacts).toBe("1");
    expect(counts.keywordLibrary).toBe("1");
    expect(counts.dataSources).toBe("1");
    expect(counts.kb).toBe("1");
    expect(counts.competitors).toBeNull();
    expect(counts.links).toBeNull();
  });

  it("counts competitor gap rows, not competitor domains", () => {
    let s = reduce(base, {
      type: "setCompData",
      data: {
        domains: [],
        gap: {
          comps: ["a.test", "b.test", "c.test"],
          rows: [
            { q: "one", volume: 10, kd: 5, cpc: "1.00", aio: false, ranks: [1, null, 3], ours: null, page: "blog" },
            { q: "two", volume: 20, kd: 6, cpc: "2.00", aio: true, ranks: [2, 4, null], ours: 9, page: "comparison" },
          ],
        },
        at: "t",
      },
    });
    s = reduce(s, {
      type: "setTargets",
      targets: [{ type: "dir", site: "Dir", domain: "dir.test", dr: 40, relevance: "high", difficulty: "low", action: "submit", asset: "listing" }],
    });
    const counts = selectCounts(s, null);
    expect(counts.competitors).toBe("2");
    expect(counts.links).toBe("1");
  });

  it("shows no badge for a module that ran but produced nothing", () => {
    let s = reduce(base, { type: "setTargets", targets: [] });
    s = reduce(s, {
      type: "setCompData",
      data: { domains: [], gap: { comps: ["a.test"], rows: [] }, at: "t" },
    });
    s = reduce(s, {
      type: "setKb",
      kb: { at: "t", entries: [{ id: "1", cat: "faq", statement: "filled", evidence: "", source: "", from: "crawl" }] },
    });
    const counts = selectCounts(s, 0);
    expect(counts.links).toBeNull();
    expect(counts.competitors).toBeNull();
    expect(counts.kb).toBeNull();
    expect(counts.keywords).toBeNull();
  });

  it("rounds the hit rate to the nearest percent", () => {
    const s = reduce(base, {
      type: "visComplete", at: "t",
      results: [
        { p: "a", platform: "x", hit: true, rank: 1, brands: [], domains: [], real: false },
        { p: "b", platform: "x", hit: true, rank: 2, brands: [], domains: [], real: false },
        { p: "c", platform: "x", hit: false, rank: null, brands: [], domains: [], real: false },
      ],
    });
    expect(selectCounts(s, null).visibility).toBe("67%");
  });

  it("hides the audit badge while a run is in flight", () => {
    let s = reduce(base, {
      type: "auditComplete",
      report: { at: "t", score: 56, findings: [], crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1", schema: 1, llmReadable: 1 }, pageRows: [] },
    });
    s = reduce(s, { type: "auditStart" });
    expect(selectCounts(s, null).audit).toBeNull();
  });
});
