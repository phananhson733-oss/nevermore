import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULE_IDS } from "../enums.ts";
import { initialProjectState } from "../store/reducer.ts";
import { ARTIFACT_FILENAME_PATTERN, type Artifact, type DemoPayload, type GapRow, type Profile } from "../types.ts";
import { plansFor } from "./answers.ts";
import { runAudit } from "./audit.ts";
import { fixTaskPrompt } from "./builders/audit.ts";
import { llmsTxt } from "./builders/kb.ts";
import { contentBriefPrompt, keywordCsv } from "./builders/keywords.ts";
import { visibilityCsv } from "./builders/visibility.ts";
import { buildCompData, keywordGap } from "./competitors.ts";
import { DEMO_LEVEL, DEMO_SEEDS, firstUnsavedGapRow, gapSavedEntry, makeDemoSite, type DemoLevel } from "./demo.ts";
import {
  DEMO_PAYLOAD_KEYS,
  EMPTY_PROFILE,
  FULL_PROFILE,
  LOCAL_STAMP,
  PROFILES,
  TRICKY_PROFILE,
  artifactById,
  payloadStamps,
  provenanceLine,
  required,
  sampleFills,
  testDeps,
} from "./demo-test-fixtures.ts";
import { demoGscRows } from "./gsc.ts";
import { PATTERNS, buildRows, findRow } from "./keywords.ts";
import { DEFAULT_LINK_TYPES, mockLinks } from "./links.ts";
import { crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";
import { stampArtifact } from "./provenance.ts";
import { normQ } from "./text.ts";
import { daysAgo, parseLocalStamp, withinDays } from "./time.ts";
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
  "auditHistory", "visResults", "visHistory", "lastVis", "compData", "plans", "targets", "kb", "artifacts", "profileDoc",
] as const satisfies readonly (keyof DemoPayload)[];
const SHARED_KEYS = ["conns", "gscRows", "seeds", "built", "saved", "audit", "lastAudit"] as const satisfies readonly (keyof DemoPayload)[];
const AT = "2026-09-12 10:12";

function demo(profile: Profile, level: DemoLevel = DEMO_LEVEL, seeds: readonly string[] = DEMO_SEEDS, now?: Date): DemoPayload {
  return makeDemoSite(profile, level, seeds, testDeps(now));
}

function gapRow(q: string, ranks: readonly (number | null)[]): GapRow {
  return { q, volume: 100, kd: 10, cpc: "1.00", aio: false, ranks, ours: null, page: "blog" };
}

function expectStamped(artifact: Artifact, expected: Omit<Artifact, "content">, body: string): void {
  expect(artifact).toStrictEqual({ ...expected, content: stampArtifact(expected.type, body, provenanceLine(expected.at)) });
}

function expectNotAfter(payload: DemoPayload, now: Date): void {
  for (const [label, at] of payloadStamps(payload)) {
    expect(required(parseLocalStamp(at), label).getTime(), `${label} ${at}`).toBeLessThanOrEqual(now.getTime());
  }
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
    expect(demo(FULL_PROFILE, "basic", seeds).seeds).toBe(seeds.join("\n"));
  });
});

describe("determinism", () => {
  it("returns deep-equal output for the same inputs", () => {
    for (const [, profile] of PROFILES) expect(demo(profile)).toStrictEqual(demo(profile));
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
    expect(makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, deps)).toStrictEqual(first);
    expect(random).not.toHaveBeenCalled();
  });
});

describe("stamps", () => {
  it("every stamp field is a local YYYY-MM-DD HH:mm, never after now", () => {
    for (const [, profile] of PROFILES) {
      const payload = demo(profile);
      expect(payloadStamps(payload).length).toBeGreaterThan(10);
      for (const [label, at] of payloadStamps(payload)) expect(at, label).toMatch(LOCAL_STAMP);
      expectNotAfter(payload, testDeps().now);
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
    expect(Object.fromEntries(payload.artifacts.map((artifact) => [artifact.id, artifact.at]))).toEqual({
      "demo-audit": at(0, 9), "demo-keywords": at(1, 14), "demo-kb": at(2, 16), "demo-visibility": at(0, 11), "demo-content": at(4, 10),
    });
  });

  it("clamps today's sample hours to now before the first of them has passed", () => {
    const now = new Date(2026, 8, 13, 0, 30);
    for (const [, profile] of PROFILES) {
      for (const level of LEVELS) {
        const payload = demo(profile, level, DEMO_SEEDS, now);
        expectNotAfter(payload, now);
        expect(withinDays(required(payload.audit, "audit").at, 7, now)).toBe(true);
      }
    }
    const full = demo(FULL_PROFILE, "full", DEMO_SEEDS, now);
    expect([full.audit?.at, full.lastVis?.at]).toEqual(["2026-09-13 00:30", "2026-09-13 00:30"]);
    expect(full.auditHistory.map((report) => report.at)).toEqual([daysAgo(now, 14, 10), daysAgo(now, 7, 10)]);
  });

  const CASES = [
    ["Asia/Shanghai", "2026-09-14 04:30"],
    ["America/Los_Angeles", "2026-09-13 09:05"],
  ] as const;
  for (const [tz, auditAt] of CASES) {
    it(`uses the local calendar day in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(Date.UTC(2026, 8, 13, 20, 30));
      const payload = makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, testDeps(now));
      expect(payload.audit?.at).toBe(auditAt);
      expectNotAfter(payload, now);
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
      expect(keys).toContain(`${normQ(profile.brand)} login`);
      expect(keys).toContain(`${normQ(profile.brand)} pricing`);
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
      const matrix = buildRows(DEMO_SEEDS, profile, payload.gscRows).filter((row) => row.gscStatus === "borderline").slice(0, 4);
      expect(matrix).toHaveLength(4);
      expect(payload.saved.slice(0, 4)).toStrictEqual(
        matrix.map((row, i) => ({ q: row.q, addedAt: daysAgo(deps.now, 3 + i, 15), source: "matrix" })),
      );
      const matrixKeys = new Set(matrix.map((row) => normQ(row.q)));
      const gap = required(keywordGap(profile, DEMO_SEEDS, payload.gscRows).rows.find((row) => !matrixKeys.has(normQ(row.q))), "gap row");
      const inTopTen = gap.ranks.filter((rank) => rank !== null && rank <= 10).length;
      expect(inTopTen).toBeGreaterThan(0);
      const base = { q: gap.q, addedAt: daysAgo(deps.now, 1, 10), source: "gap" };
      // EMPTY compares placeholders: their sample ranks are no claim about real competitors.
      expect(payload.saved.slice(4)).toStrictEqual([name === "FULL" ? { ...base, note: `竞品 ${inTopTen} 家在前 10` } : base]);
      const keys = payload.saved.map((entry) => normQ(entry.q));
      expect(new Set(keys).size).toBe(keys.length);
    });
  }

  it("skips a gap row already saved under another spelling", () => {
    const saved = [{ q: "Best  SEO tools", addedAt: AT, source: "matrix" as const }];
    expect(firstUnsavedGapRow([gapRow("best seo tools", [1]), gapRow("seo checklist", [2])], saved)?.q).toBe("seo checklist");
    expect(firstUnsavedGapRow([gapRow("BEST SEO TOOLS", [1])], saved)).toBeUndefined();
  });

  it("omits the note without a competitor in the top ten, or without real competitors", () => {
    const outside = gapSavedEntry(gapRow("q", [11, null, 12]), AT, true);
    expect(Object.hasOwn(outside, "note")).toBe(false);
    expect(outside).toStrictEqual({ q: "q", addedAt: AT, source: "gap" });
    expect(gapSavedEntry(gapRow("q", [3, null, 10, 11]), AT, true).note).toBe("竞品 2 家在前 10");
    expect(Object.hasOwn(gapSavedEntry(gapRow("q", [3, 1]), AT, false), "note")).toBe(false);
  });
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
      const keywordsAt = daysAgo(deps.now, 1, 14);
      const briefAt = daysAgo(deps.now, 4, 10);
      expect(payload.artifacts).toHaveLength(5);
      expectStamped(
        artifactById(payload, "demo-audit"),
        { id: "demo-audit", module: "audit", type: "prompt", engine: "seo", title: "修复任务（给 Code Agent）", at: audit.at },
        fixTaskPrompt({ report: audit, profile, stack: "[未知：先识别仓库框架]" }),
      );
      expectStamped(
        artifactById(payload, "demo-keywords"),
        { id: "demo-keywords", module: "keywords", type: "csv", engine: "seo", title: `关键词矩阵 ${Math.min(rows.length, 40)} 条`, filename: "keyword-matrix.csv", at: keywordsAt },
        keywordCsv(rows.slice(0, 40)),
      );
      expectStamped(
        artifactById(payload, "demo-kb"),
        { id: "demo-kb", module: "kb", type: "md", engine: "geo", title: "llms.txt", filename: "llms.txt", at: kb.at },
        llmsTxt({ profile, entries: kb.entries }),
      );
      expectStamped(
        artifactById(payload, "demo-visibility"),
        { id: "demo-visibility", module: "visibility", type: "csv", engine: "geo", title: `可见度矩阵 ${hits}/${payload.visResults.length}`, filename: "ai-visibility.csv", at: lastVis.at },
        visibilityCsv({ results: payload.visResults, checkedAt: lastVis.at }),
      );
      expectStamped(
        artifactById(payload, "demo-content"),
        { id: "demo-content", module: "content", type: "prompt", engine: "seo", title: `博客文章 brief：${target}`, at: briefAt },
        contentBriefPrompt({ asset: "blog", target, profile, hit: findRow(rows, target), outline: "", extra: "" }),
      );
      for (const artifact of payload.artifacts) {
        expect(MODULE_IDS).toContain(artifact.module);
        if (artifact.filename !== undefined) expect(artifact.filename).toMatch(ARTIFACT_FILENAME_PATTERN);
      }
    });
  }

  it("lists the artifacts newest first, keeping build order on equal stamps", () => {
    const ids = (now: Date): readonly string[] => demo(FULL_PROFILE, "full", DEMO_SEEDS, now).artifacts.map((artifact) => artifact.id);
    expect(ids(new Date(2026, 8, 13, 12, 0))).toEqual(["demo-visibility", "demo-audit", "demo-keywords", "demo-kb", "demo-content"]);
    expect(ids(new Date(2026, 8, 13, 0, 30))).toEqual(["demo-audit", "demo-visibility", "demo-keywords", "demo-kb", "demo-content"]);
    for (const [, profile] of PROFILES) {
      const stamps = demo(profile).artifacts.map((artifact) => artifact.at);
      expect(stamps).toEqual(stamps.toSorted().toReversed());
    }
  });
});

describe("brief target", () => {
  const briefTitle = (seeds: readonly string[]): string => artifactById(demo(FULL_PROFILE, "full", seeds), "demo-content").title;

  it("prefers the sample checklist query when the seeds make it", () => {
    expect(briefTitle(DEMO_SEEDS)).toBe("博客文章 brief：llm seo checklist");
  });

  it("otherwise takes the first matrix row made from the seeds, never a query only the sample paste has", () => {
    const seeds = ["barcode scanning"];
    const madeFromSeeds = new Set(buildRows(seeds, FULL_PROFILE, []).filter((row) => row.seed === seeds[0]).map((row) => normQ(row.q)));
    const first = required(buildRows(seeds, FULL_PROFILE, demo(FULL_PROFILE, "full", seeds).gscRows).find((row) => madeFromSeeds.has(normQ(row.q))), "row");
    expect(briefTitle(seeds)).toBe(`博客文章 brief：${first.q}`);
    expect(briefTitle(seeds)).not.toContain("llm seo checklist");
  });

  it("falls back to the first demo seed without seeds", () => {
    expect(briefTitle([])).toBe(`博客文章 brief：${DEMO_SEEDS[0]}`);
    expect(briefTitle(["  "])).toBe(`博客文章 brief：${DEMO_SEEDS[0]}`);
  });
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
    const fills = sampleFills(required(demo({ ...FULL_PROFILE, brand: "   ", competitors: "Rival" }).kb, "kb").entries);
    expect(fills.map((entry) => entry.cat)).toEqual(["boundary", "pricing", "comparison"]);
    for (const entry of fills) {
      expect(entry.statement).toContain("[示例] ");
      expect(entry.statement).toContain("[品牌]");
      expect(entry.statement).not.toMatch(/\s{2}/);
      expect([entry.source, entry.from]).toEqual(["", "aiDraft"]);
      expect(entry.id).toMatch(/^kb-\d{2}$/);
    }
    expect(fills.find((entry) => entry.cat === "comparison")?.statement).toContain("Rival");
  });

  it("asks about pricing without presupposing a free tier", () => {
    const pricing = sampleFills(required(demo(EMPTY_PROFILE).kb, "kb").entries).filter((entry) => entry.cat === "pricing");
    expect(pricing.map((entry) => entry.statement)).toEqual(["[示例] Acme 的定价方式与各档分别包含什么（待补定价页原句）"]);
  });

  it("names the first compared competitor, never the brand or the own site", () => {
    const widgets = required(demo({ ...FULL_PROFILE, competitors: "widgets, Sortly" }).kb, "kb");
    expect(sampleFills(widgets.entries).filter((entry) => entry.cat === "comparison").map((entry) => entry.statement)).toEqual([
      "[示例] 与 Sortly 相比，Widgets 的差别（待补对比页原句）",
    ]);
    const tricky = required(demo(TRICKY_PROFILE).kb, "kb");
    expect(tricky.entries.filter((entry) => entry.cat === "comparison").map((entry) => entry.statement)).toEqual([
      "[示例] 与 Rival 相比，Acme 的差别（待补对比页原句）",
    ]);
  });

  for (const competitors of ["", " , ", "Acme", "ACME, acme.io"]) {
    it(`opens no comparison entry without a real competitor (${JSON.stringify(competitors)})`, () => {
      const kb = required(demo({ ...EMPTY_PROFILE, competitors }).kb, "kb");
      expect(sampleFills(kb.entries).map((entry) => entry.cat)).toEqual(["boundary", "pricing"]);
      expect(kb.entries.filter((entry) => entry.cat === "comparison")).toEqual([]);
      expect(JSON.stringify(kb)).not.toContain("[竞品");
    });
  }
});
