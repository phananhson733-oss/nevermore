import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULE_IDS } from "../enums.ts";
import { initialProjectState } from "../store/reducer.ts";
import { ARTIFACT_FILENAME_PATTERN, type DemoPayload, type KbEntry, type Profile } from "../types.ts";
import { plansFor } from "./answers.ts";
import { runAudit } from "./audit.ts";
import { fixTaskPrompt } from "./builders/audit.ts";
import { llmsTxt } from "./builders/kb.ts";
import { contentBriefPrompt, keywordCsv } from "./builders/keywords.ts";
import { visibilityCsv } from "./builders/visibility.ts";
import { buildCompData, keywordGap } from "./competitors.ts";
import { DEMO_LEVEL, DEMO_SEEDS, makeDemoSite, type DemoLevel } from "./demo.ts";
import {
  DEMO_PAYLOAD_KEYS,
  EMPTY_PROFILE,
  FULL_PROFILE,
  LOCAL_STAMP,
  PROFILES,
  SAMPLE_FILL_EVIDENCE,
  payloadStamps,
  provenanceLine,
  testDeps,
} from "./demo-test-fixtures.ts";
import { demoGscRows } from "./gsc.ts";
import { PATTERNS, buildRows, findRow } from "./keywords.ts";
import { DEFAULT_LINK_TYPES, mockLinks } from "./links.ts";
import { crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";
import { stampArtifact } from "./provenance.ts";
import { normQ } from "./text.ts";
import { daysAgo } from "./time.ts";
import { VIS_PROMPT_LIMIT, localPromptSet, missedPrompts, mockVisibility } from "./visibility.ts";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LEVELS: readonly DemoLevel[] = ["full", "basic"];
const MODULE_KEYS = [
  "auditHistory",
  "visResults",
  "visHistory",
  "lastVis",
  "compData",
  "plans",
  "targets",
  "kb",
  "artifacts",
  "profileDoc",
] as const satisfies readonly (keyof DemoPayload)[];
const SHARED_KEYS = ["conns", "gscRows", "seeds", "built", "saved", "audit", "lastAudit"] as const satisfies readonly (keyof DemoPayload)[];

function demo(profile: Profile, level: DemoLevel = DEMO_LEVEL): DemoPayload {
  return makeDemoSite(profile, level, DEMO_SEEDS, testDeps());
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`);
  return value;
}

function sampleFills(entries: readonly KbEntry[]): readonly KbEntry[] {
  return entries.filter((entry) => entry.evidence === SAMPLE_FILL_EVIDENCE);
}

describe("makeDemoSite shape", () => {
  for (const level of LEVELS) {
    for (const [name, profile] of PROFILES) {
      it(`${level} ${name} has exactly the 17 DemoPayload keys`, () => {
        expect(Object.keys(demo(profile, level)).sort()).toEqual([...DEMO_PAYLOAD_KEYS].sort());
      });
    }
  }

  it("pins the demo constants", () => {
    expect(DEMO_LEVEL).toBe("full");
    expect(DEMO_SEEDS).toEqual(["ai visibility", "geo optimization", "content brief", "llm seo"]);
  });

  it("stores the seeds joined verbatim", () => {
    const seeds = ["  spaced seed ", "second"];
    expect(makeDemoSite(FULL_PROFILE, "basic", seeds, testDeps()).seeds).toBe(seeds.join("\n"));
  });
});

describe("determinism", () => {
  it("returns deep-equal output for the same inputs", () => {
    for (const [, profile] of PROFILES) {
      expect(demo(profile)).toStrictEqual(demo(profile));
    }
  });

  it("reads neither the system clock nor Math.random", () => {
    const deps = testDeps(new Date(2026, 8, 13, 12, 0));
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random called");
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2001, 0, 1));
    const first = makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, deps);
    vi.setSystemTime(new Date(2039, 6, 1));
    const second = makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, deps);
    expect(second).toStrictEqual(first);
    expect(random).not.toHaveBeenCalled();
  });
});

describe("stamps", () => {
  it("every stamp field is a local YYYY-MM-DD HH:mm", () => {
    for (const [, profile] of PROFILES) {
      const stamps = payloadStamps(demo(profile));
      expect(stamps.length).toBeGreaterThan(10);
      for (const [label, at] of stamps) expect(at, label).toMatch(LOCAL_STAMP);
    }
  });

  it("puts each stamp where the plan says", () => {
    const deps = testDeps();
    const at = (n: number, hour: number): string => daysAgo(deps.now, n, hour);
    const payload = makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, deps);
    expect(payload.audit?.at).toBe(at(0, 9));
    expect(payload.auditHistory.map((report) => report.at)).toEqual([at(14, 10), at(7, 10)]);
    expect(payload.lastVis?.at).toBe(at(0, 11));
    expect(payload.visHistory.map((snapshot) => snapshot.at)).toEqual([at(7, 11)]);
    expect(payload.profileDoc?.at).toBe(at(3, 15));
    expect(payload.kb?.at).toBe(at(2, 16));
    expect(payload.compData?.at).toBe(at(2, 14));
    expect(payload.artifacts.map((artifact) => artifact.at)).toEqual([at(0, 9), at(1, 14), at(2, 16), at(0, 11), at(4, 10)]);
  });

  const CASES = [
    ["Asia/Shanghai", "2026-09-14 09:05"],
    ["America/Los_Angeles", "2026-09-13 09:05"],
  ] as const;
  for (const [tz, auditAt] of CASES) {
    it(`uses the local calendar day in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(Date.UTC(2026, 8, 13, 20, 30));
      const payload = makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, testDeps(now));
      expect(payload.audit?.at).toBe(auditAt);
      expect(payload.audit?.at).toBe(daysAgo(now, 0, 9));
      for (const [label, stamp] of payloadStamps(payload)) expect(stamp, label).toMatch(LOCAL_STAMP);
    });
  }
});

describe("demo GSC rows", () => {
  for (const [name, profile] of PROFILES) {
    it(`${name}: sample paste first, every seed template, brand rows, unique by normQ`, () => {
      const { gscRows } = demo(profile);
      const keys = gscRows.map((row) => normQ(row.query));
      expect(new Set(keys).size).toBe(keys.length);
      expect(gscRows.slice(0, demoGscRows(profile).length).map((row) => row.query)).toEqual(demoGscRows(profile).map((row) => row.query));
      const expected = DEMO_SEEDS.flatMap((seed) => PATTERNS.slice(0, 7).map((pattern) => normQ(pattern.make(seed))));
      for (const key of expected) expect(keys, key).toContain(key);
      const brand = normQ(profile.brand);
      expect(keys).toContain(`${brand} login`);
      expect(keys).toContain(`${brand} pricing`);
      for (const row of gscRows) expect(row.position === null || row.position > 0, row.query).toBe(true);
    });
  }

  it("adds no brand rows for a whitespace-only brand", () => {
    const { gscRows } = demo({ ...EMPTY_PROFILE, brand: "   " });
    expect(gscRows.filter((row) => /^\s*(login|pricing)$/.test(row.query))).toEqual([]);
  });

  it("recomputes ctr for every row, including the pasted sample", () => {
    const { gscRows } = demo(FULL_PROFILE);
    for (const row of gscRows) {
      const { clicks, impressions, ctr } = row;
      if (impressions === null || impressions <= 0 || clicks === null) {
        expect(ctr, row.query).toBeNull();
        continue;
      }
      const value = required(ctr, `${row.query} ctr`);
      expect(Math.abs(value - (clicks / impressions) * 100), row.query).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(value * 100 - Math.round(value * 100)), row.query).toBeLessThan(1e-6);
    }
    // Pasted as 0.7% and 1.3%: 18 / 2410 and 41 / 3120 say otherwise.
    expect(gscRows.find((row) => row.query === "ai visibility checker")?.ctr).toBe(0.75);
    expect(gscRows.find((row) => row.query === "llm seo checklist")?.ctr).toBe(1.31);
  });
});

describe("saved keywords", () => {
  for (const [name, profile] of PROFILES) {
    it(`${name}: four borderline matrix rows, then the first gap row not already saved`, () => {
      const deps = testDeps();
      const payload = makeDemoSite(profile, "full", DEMO_SEEDS, deps);
      const rows = buildRows(DEMO_SEEDS, profile, payload.gscRows);
      const matrix = rows.filter((row) => row.gscStatus === "borderline").slice(0, 4);
      expect(matrix).toHaveLength(4);
      expect(payload.saved.slice(0, 4)).toStrictEqual(
        matrix.map((row, i) => ({ q: row.q, addedAt: daysAgo(deps.now, 3 + i, 15), source: "matrix" })),
      );
      const matrixKeys = new Set(matrix.map((row) => normQ(row.q)));
      const gap = required(
        keywordGap(profile, DEMO_SEEDS, payload.gscRows).rows.find((row) => !matrixKeys.has(normQ(row.q))),
        "gap row",
      );
      const inTopTen = gap.ranks.filter((rank) => rank !== null && rank <= 10).length;
      const base = { q: gap.q, addedAt: daysAgo(deps.now, 1, 10), source: "gap" };
      expect(payload.saved.slice(4)).toStrictEqual([inTopTen > 0 ? { ...base, note: `竞品 ${inTopTen} 家在前 10` } : base]);
      const keys = payload.saved.map((entry) => normQ(entry.q));
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

describe("artifacts", () => {
  for (const [name, profile] of PROFILES) {
    it(`${name}: five stamped artifacts built from the payload's own data`, () => {
      const deps = testDeps();
      const payload = makeDemoSite(profile, "full", DEMO_SEEDS, deps);
      const rows = buildRows(DEMO_SEEDS, profile, payload.gscRows);
      const audit = required(payload.audit, "audit");
      const kb = required(payload.kb, "kb");
      const lastVis = required(payload.lastVis, "lastVis");
      const hits = payload.visResults.filter((result) => result.hit).length;
      const target = "llm seo checklist";
      const stamp = (type: "csv" | "md" | "prompt", body: string, at: string): string => stampArtifact(type, body, provenanceLine(at));
      const [auditArt, keywordsArt, kbArt, visArt, contentArt] = payload.artifacts;
      expect(payload.artifacts).toHaveLength(5);
      expect(auditArt).toStrictEqual({
        id: "demo-audit", module: "audit", type: "prompt", engine: "seo", title: "修复任务（给 Code Agent）", at: audit.at,
        content: stamp("prompt", fixTaskPrompt({ report: audit, profile, stack: "[未知：先识别仓库框架]" }), audit.at),
      });
      expect(keywordsArt).toStrictEqual({
        id: "demo-keywords", module: "keywords", type: "csv", engine: "seo", title: `关键词矩阵 ${Math.min(rows.length, 40)} 条`,
        filename: "keyword-matrix.csv", at: daysAgo(deps.now, 1, 14), content: stamp("csv", keywordCsv(rows.slice(0, 40)), daysAgo(deps.now, 1, 14)),
      });
      expect(kbArt).toStrictEqual({
        id: "demo-kb", module: "kb", type: "md", engine: "geo", title: "llms.txt", filename: "llms.txt", at: kb.at,
        content: stamp("md", llmsTxt({ profile, entries: kb.entries }), kb.at),
      });
      expect(visArt).toStrictEqual({
        id: "demo-visibility", module: "visibility", type: "csv", engine: "geo", title: `可见度矩阵 ${hits}/${payload.visResults.length}`,
        filename: "ai-visibility.csv", at: lastVis.at, content: stamp("csv", visibilityCsv({ results: payload.visResults, checkedAt: lastVis.at }), lastVis.at),
      });
      expect(contentArt).toStrictEqual({
        id: "demo-content", module: "content", type: "prompt", engine: "seo", title: `博客文章 brief：${target}`, at: daysAgo(deps.now, 4, 10),
        content: stamp("prompt", contentBriefPrompt({ asset: "blog", target, profile, hit: findRow(rows, target), outline: "", extra: "" }), daysAgo(deps.now, 4, 10)),
      });
      for (const artifact of payload.artifacts) {
        expect(MODULE_IDS).toContain(artifact.module);
        if (artifact.filename !== undefined) expect(artifact.filename).toMatch(ARTIFACT_FILENAME_PATTERN);
      }
      expect(Object.hasOwn(required(auditArt, "audit artifact"), "filename")).toBe(false);
      expect(Object.hasOwn(required(contentArt, "content artifact"), "filename")).toBe(false);
    });
  }
});

describe("levels", () => {
  for (const [name, profile] of PROFILES) {
    it(`${name} basic: only the shared init is filled, identical to full's`, () => {
      const deps = testDeps();
      const basic = makeDemoSite(profile, "basic", DEMO_SEEDS, deps);
      const full = makeDemoSite(profile, "full", DEMO_SEEDS, deps);
      const initial = initialProjectState({ url: profile.url, brand: profile.brand, market: profile.market });
      for (const key of MODULE_KEYS) expect(basic[key], key).toStrictEqual(initial[key]);
      for (const key of SHARED_KEYS) expect(basic[key], key).toStrictEqual(full[key]);
      expect(basic.conns).toStrictEqual({ GSC: true, GA4: false });
      expect(basic.built).toBe(true);
      expect(basic.audit).toStrictEqual(runAudit(profile, { at: daysAgo(deps.now, 0, 9), salt: "demo-cur" }));
      expect(basic.lastAudit).toStrictEqual(basic.audit);
    });

    it(`${name} full: modules come from the shared rows, GSC and audit`, () => {
      const deps = testDeps();
      const at = (n: number, hour: number): string => daysAgo(deps.now, n, hour);
      const payload = makeDemoSite(profile, "full", DEMO_SEEDS, deps);
      const rows = buildRows(DEMO_SEEDS, profile, payload.gscRows);
      const prompts = localPromptSet(profile, rows).map((seed) => seed.q).slice(0, VIS_PROMPT_LIMIT);
      expect(prompts.length).toBeGreaterThan(0);
      expect(payload.auditHistory).toStrictEqual([
        runAudit(profile, { at: at(14, 10), salt: "demo-prev2" }),
        runAudit(profile, { at: at(7, 10), salt: "demo-prev" }),
      ]);
      expect(payload.visResults).toStrictEqual(mockVisibility(profile, prompts, "demo-cur"));
      expect(payload.visHistory).toStrictEqual([{ at: at(7, 11), results: mockVisibility(profile, prompts, "demo-prev") }]);
      expect(payload.lastVis).toStrictEqual({ at: at(0, 11), results: payload.visResults });
      expect(payload.plans).toStrictEqual(plansFor(missedPrompts(payload.visResults).slice(0, 2), profile));
      expect(payload.targets).toStrictEqual(mockLinks(profile, DEFAULT_LINK_TYPES));
      expect(payload.compData).toStrictEqual(buildCompData(profile, DEMO_SEEDS, payload.gscRows, at(2, 14)));
      expect(payload.profileDoc).toStrictEqual({
        crawl: crawlSignals(profile, "crawl", required(payload.audit, "audit")),
        gsc: gscSignals(profile, payload.gscRows),
        third: crawlSignals(profile, "third"),
        ai: demoAiDoc(profile),
        at: at(3, 15),
      });
    });
  }
});

describe("sample KB fills", () => {
  it("fill pricing, boundary and comparison gaps in place with the brand placeholder for a blank brand", () => {
    const kb = required(demo({ ...FULL_PROFILE, brand: "   ", competitors: "Rival" }).kb, "kb");
    const fills = sampleFills(kb.entries);
    expect(fills.map((entry) => entry.cat)).toEqual(["boundary", "pricing", "comparison"]);
    for (const entry of fills) {
      expect(entry.statement).toContain("[示例]");
      expect(entry.statement).toContain("[品牌]");
      expect(entry.statement).not.toMatch(/\s{2}/);
      expect(entry.source).toBe("");
      expect(entry.from).toBe("aiDraft");
      expect(entry.id).toMatch(/^kb-\d{2}$/);
    }
    expect(fills.find((entry) => entry.cat === "comparison")?.statement).toContain("Rival");
  });

  it("names the first compared competitor, never the brand itself", () => {
    const kb = required(demo({ ...FULL_PROFILE, competitors: "widgets, Sortly" }).kb, "kb");
    const comparison = sampleFills(kb.entries).filter((entry) => entry.cat === "comparison");
    expect(comparison).toHaveLength(1);
    expect(comparison[0]?.statement).toContain("与 Sortly 相比，Widgets 的差别");
  });

  for (const competitors of ["", " , ", "Acme"]) {
    it(`opens no comparison fill without a real competitor (${JSON.stringify(competitors)})`, () => {
      const kb = required(demo({ ...EMPTY_PROFILE, competitors }).kb, "kb");
      expect(sampleFills(kb.entries).map((entry) => entry.cat)).toEqual(["boundary", "pricing"]);
      expect(JSON.stringify(kb)).not.toContain("[竞品");
    });
  }
});
