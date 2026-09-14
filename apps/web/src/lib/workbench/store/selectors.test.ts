import { describe, expect, it } from "vitest";
import { buildRows } from "../mock/keywords.ts";
import type { DemoPayload, VisResult, WorkbenchProjectState } from "../types.ts";
import { demoFields } from "./demo-fields.ts";
import { initialProjectState, reduce } from "./reducer.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";
import { formatShare, gatedRows, hasDemoOverwrite, keywordRows, savedQueries, seedList, selectCounts, splitSeeds } from "./selectors.ts";
import { populatedProjectState } from "./test-fixtures.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };
const base = initialProjectState(seed);

describe("seedList", () => {
  it("splits on newlines and commas, trims, drops blanks", () => {
    expect(seedList({ ...base, seeds: " a ,b\n\nc,\n" })).toEqual(["a", "b", "c"]);
    expect(seedList(base)).toEqual([]);
  });

  it("is splitSeeds over state.seeds, and reads nothing else", () => {
    for (const seeds of ["", " a ,b\n\nc,\n", "seo audit\r\ngeo", " , \n "]) {
      expect(seedList({ ...base, seeds })).toEqual(splitSeeds(seeds));
    }
  });
});

describe("splitSeeds", () => {
  it("splits on commas and newlines, trims each entry, drops blank entries", () => {
    expect(splitSeeds("seo audit,geo")).toEqual(["seo audit", "geo"]);
    expect(splitSeeds("seo audit\ngeo")).toEqual(["seo audit", "geo"]);
    expect(splitSeeds(" a ,b\n\nc,\n")).toEqual(["a", "b", "c"]);
    // The \r left behind by a CRLF split is trimmed away.
    expect(splitSeeds("a\r\nb")).toEqual(["a", "b"]);
  });

  it("returns no entries for empty or separator-only text", () => {
    expect(splitSeeds("")).toEqual([]);
    expect(splitSeeds(" , \n ,, ")).toEqual([]);
  });
});

const ROWS_STATE: WorkbenchProjectState = {
  ...base,
  seeds: "seo audit, geo\n",
  profile: { ...base.profile, competitors: "Rival" },
  gscRows: [{ query: "example pricing plans", clicks: 4, impressions: 120, ctr: 3.3, position: 6.1 }],
};

describe("keywordRows / gatedRows", () => {
  it("builds rows from the seeds, the brand and competitors, and the GSC rows", () => {
    const rows = keywordRows(ROWS_STATE);
    expect(rows).toEqual(buildRows(seedList(ROWS_STATE), ROWS_STATE.profile, ROWS_STATE.gscRows));
    // Each input visibly reaches the output, so the equality above is not two empty lists.
    expect(rows.some((row) => row.q === "example pricing plans")).toBe(true);
    expect(rows.some((row) => row.q === "Example vs Rival")).toBe(true);
    expect(new Set(rows.map((row) => row.seed).filter((s) => s !== ""))).toEqual(new Set(["seo audit", "geo"]));
  });

  it("gates on built: empty before the matrix is built, the ungated rows after", () => {
    expect(gatedRows({ ...ROWS_STATE, built: false })).toEqual([]);
    const built = { ...ROWS_STATE, built: true };
    expect(gatedRows(built).length).toBeGreaterThan(0);
    expect(gatedRows(built)).toEqual(keywordRows(built));
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
    s = reduce(s, { type: "setGscRows", rows: [{ query: "q", clicks: 1, impressions: 1, ctr: 1, position: 1 }], source: "user" });
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

/** `hits` hits among `total` real VisResult probes. */
function probes(hits: number, total: number): readonly VisResult[] {
  return Array.from({ length: total }, (_, i): VisResult => ({
    p: `prompt ${i}`, platform: "ChatGPT", hit: i < hits, rank: i < hits ? 1 : null,
    brands: [], domains: [], real: false,
  }));
}

function visibilityBadge(hits: number, total: number): string | null {
  const s = reduce(base, { type: "visComplete", at: "t", results: probes(hits, total) });
  return selectCounts(s, null).visibility;
}

describe("selectCounts visibility badge (R15)", () => {
  it("shows 0% for a run with zero hits: that is a real result, not a missing one", () => {
    expect(visibilityBadge(0, 3)).toBe("0%");
  });

  it("never rounds a non-zero share down to 0%", () => {
    expect(visibilityBadge(1, 300)).toBe("<1%");
    expect(visibilityBadge(1, 100)).toBe("1%");
  });

  it("never rounds a share with misses up to 100%", () => {
    expect(visibilityBadge(299, 300)).toBe(">99%");
    expect(visibilityBadge(99, 100)).toBe("99%");
    expect(visibilityBadge(3, 3)).toBe("100%");
  });

  it("rounds everything else to the nearest percent, halves up, from the exact share", () => {
    expect(visibilityBadge(1, 3)).toBe("33%");
    // 23/40 is exactly 57.5%; (23 / 40) * 100 is 57.49999999999999 in floating point.
    expect(visibilityBadge(23, 40)).toBe("58%");
  });

  it("shows no badge when nothing was probed", () => {
    expect(visibilityBadge(0, 0)).toBeNull();
    expect(selectCounts(base, null).visibility).toBeNull();
  });
});

describe("selectCounts kb badge", () => {
  it("counts generated placeholders as gaps, alongside blank statements, but not text that merely says 待补 / 需补", () => {
    const s = reduce(base, {
      type: "setKb",
      kb: { at: "t", entries: [
        { id: "1", cat: "pricing", statement: "[示例] Acme 的定价方式与各档分别包含什么（待补定价页原句）", evidence: "示例，未核对", source: "", from: "aiDraft" },
        { id: "2", cat: "data", statement: "[示例事实：Acme 的核心能力待补]", evidence: "示例，未核对", source: "", from: "aiDraft" },
        { id: "3", cat: "capability", statement: "   ", evidence: "", source: "", from: "gap" },
        { id: "4", cat: "capability", statement: "Exports CSV.", evidence: "", source: "", from: "crawl" },
        { id: "5", cat: "faq", statement: "常见问题需补充", evidence: "", source: "", from: "aiDraft" },
      ] },
    });
    expect(selectCounts(s, null).kb).toBe("3");
  });

  it("shows no badge without a knowledge base", () => {
    expect(selectCounts(reduce(base, { type: "setKb", kb: null }), null).kb).toBeNull();
  });
});

describe("formatShare (Q9: one share for the badge, the overview card and the week tile)", () => {
  it("is exported, keeps a measured zero and never rounds away a miss", () => {
    expect(formatShare(0, 3)).toBe("0%");
    expect(formatShare(1, 300)).toBe("<1%");
    expect(formatShare(1, 100)).toBe("1%");
    expect(formatShare(299, 300)).toBe(">99%");
    expect(formatShare(99, 100)).toBe("99%");
    expect(formatShare(3, 3)).toBe("100%");
    // 23/40 is exactly 57.5%; (23 / 40) * 100 is 57.49999999999999 in floating point.
    expect(formatShare(23, 40)).toBe("58%");
  });

  it("is the same function behind the sidebar badge, so the two surfaces cannot drift", () => {
    for (const [hits, total] of [[0, 3], [1, 3], [1, 300], [23, 40], [299, 300], [3, 3]] as const) {
      expect(visibilityBadge(hits, total)).toBe(formatShare(hits, total));
    }
  });
});

/**
 * Q11. One case per field `loadDemo` writes, sourced from the populated
 * fixture. A `Record` keyed by `keyof DemoPayload` makes a field missing from
 * this table a compile error, so the table cannot silently shrink while the
 * predicate grows. `conns` is split further in its own case below.
 */
const FILLED = populatedProjectState(seed);
const ONE_FIELD_STATES = {
  conns: { ...base, conns: FILLED.conns },
  gscRows: { ...base, gscRows: FILLED.gscRows, gscRowsSource: "user" },
  seeds: { ...base, seeds: FILLED.seeds },
  built: { ...base, built: true },
  saved: { ...base, saved: FILLED.saved },
  audit: { ...base, audit: FILLED.audit },
  auditHistory: { ...base, auditHistory: FILLED.auditHistory },
  lastAudit: { ...base, lastAudit: FILLED.lastAudit },
  visResults: { ...base, visResults: FILLED.visResults },
  visHistory: { ...base, visHistory: FILLED.visHistory },
  lastVis: { ...base, lastVis: FILLED.lastVis },
  compData: { ...base, compData: FILLED.compData },
  plans: { ...base, plans: FILLED.plans },
  targets: { ...base, targets: FILLED.targets },
  kb: { ...base, kb: FILLED.kb },
  artifacts: { ...base, artifacts: FILLED.artifacts },
  profileDoc: { ...base, profileDoc: FILLED.profileDoc },
} as const satisfies Readonly<Record<keyof DemoPayload, WorkbenchProjectState>>;

describe("hasDemoOverwrite (Q11: by value, never by reference)", () => {
  it("is false for a fresh project", () => {
    expect(hasDemoOverwrite(base)).toBe(false);
  });

  it("is false for a second initial state: a reference comparison would call every project non-empty", () => {
    const other = initialProjectState(seed);
    // `initialProjectState` builds a new [] / {} on every call, so these are the
    // references a `state.gscRows !== blank.gscRows` implementation would compare.
    expect(other).not.toBe(base);
    expect(other.gscRows).not.toBe(base.gscRows);
    expect(other.saved).not.toBe(base.saved);
    expect(other.plans).not.toBe(base.plans);
    expect(other.conns).not.toBe(base.conns);
    expect(hasDemoOverwrite(other)).toBe(false);
  });

  it("is false for an empty project that came back through storage (hydration replaces every object)", () => {
    const envelope: unknown = JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state: base }));
    const hydrated = parsePersistedState(envelope);
    if (hydrated === null) throw new Error("the empty state must round-trip through the schema");
    expect(hydrated).not.toBe(base);
    expect(hydrated.gscRows).not.toBe(base.gscRows);
    expect(hydrated.conns).not.toBe(base.conns);
    expect(hasDemoOverwrite(hydrated)).toBe(false);
  });

  it("reads whitespace-only seeds as empty, and separator-only seeds as typing", () => {
    expect(hasDemoOverwrite({ ...base, seeds: "  \n \t " })).toBe(false);
    expect(hasDemoOverwrite({ ...base, seeds: " a " })).toBe(true);
    // `seeds.trim() === ""` (Q11), not `splitSeeds(seeds).length === 0`: a box
    // holding only a comma yields no seed word, but the user did type into it,
    // and the cheap error here is one extra confirm rather than a silent
    // overwrite.
    expect(splitSeeds(" , ")).toEqual([]);
    expect(hasDemoOverwrite({ ...base, seeds: " , " })).toBe(true);
  });

  it("ignores everything outside the fields loadDemo writes", () => {
    // `profile` and `notify` are never part of the payload (types.ts DemoPayload),
    // `visPartial` and `demo` are set by the reducer itself, and a row provenance
    // without rows is unreachable (they move together, Q6) — none of them is
    // content a confirm dialog should ask about.
    expect(hasDemoOverwrite({ ...base, profile: { ...base.profile, positioning: "mine" } })).toBe(false);
    expect(hasDemoOverwrite({ ...base, notify: { weekly: false, drop: false, mention: true, gsc: false } })).toBe(false);
    expect(hasDemoOverwrite({ ...base, visPartial: true })).toBe(false);
    expect(hasDemoOverwrite({ ...base, demo: true })).toBe(false);
    expect(hasDemoOverwrite({ ...base, gscRowsSource: "sample" })).toBe(false);
  });

  it.each(Object.entries(ONE_FIELD_STATES))("is true when only %s carries content", (_field, state) => {
    expect(hasDemoOverwrite(state)).toBe(true);
  });

  it("is true for either half of conns on its own", () => {
    expect(hasDemoOverwrite({ ...base, conns: { GSC: true, GA4: false } })).toBe(true);
    expect(hasDemoOverwrite({ ...base, conns: { GSC: false, GA4: true } })).toBe(true);
  });

  it("is true for a fully populated project and for one carrying the sample site", () => {
    expect(hasDemoOverwrite(FILLED)).toBe(true);
    const demo = reduce(base, {
      type: "loadDemo",
      expected: demoFields(base),
      payload: {
        conns: FILLED.conns, gscRows: FILLED.gscRows, seeds: FILLED.seeds, built: FILLED.built,
        saved: FILLED.saved, audit: FILLED.audit, auditHistory: FILLED.auditHistory, lastAudit: FILLED.lastAudit,
        visResults: FILLED.visResults, visHistory: FILLED.visHistory, lastVis: FILLED.lastVis,
        compData: FILLED.compData, plans: FILLED.plans, targets: FILLED.targets, kb: FILLED.kb,
        artifacts: FILLED.artifacts, profileDoc: FILLED.profileDoc,
      },
    });
    expect(hasDemoOverwrite(demo)).toBe(true);
  });
});
