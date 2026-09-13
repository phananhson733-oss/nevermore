import { describe, expect, it } from "vitest";
import { DEMO_SEEDS, makeDemoSite } from "@/lib/workbench/mock/demo";
import { FULL_PROFILE, testDeps } from "@/lib/workbench/mock/demo-test-fixtures";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type {
  Artifact,
  AuditReport,
  Finding,
  GscRow,
  KbEntry,
  VisResult,
  WorkbenchProjectState,
} from "@/lib/workbench/types";
import { weekFeed } from "./week-feed.ts";
import { weekNextSteps, weekRange, weekSummary, weeklyReportInput } from "./week-summary.ts";

/**
 * Every number the week page and its report print has one producer, this
 * module, and every one of them is either a measured value (zero included) or
 * `null` for "not known" — never a zero standing in for a run that did not
 * happen (Q10, repo CLAUDE.md "unavailable is not 0").
 */

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const POPULATED = populatedProjectState(SEED);

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("fixture is missing a value");
  return value;
}

function blank(overrides: Partial<WorkbenchProjectState> = {}): WorkbenchProjectState {
  return { ...initialProjectState(SEED), ...overrides };
}

const BASE_FINDING: Finding = must(POPULATED.lastAudit?.findings[0]);

function finding(t: string, sev: Finding["sev"]): Finding {
  return { ...BASE_FINDING, id: t, t, sev };
}

function report(at: string, score: number, findings: readonly Finding[]): AuditReport {
  return { ...must(POPULATED.lastAudit), at, score, findings };
}

function pages(...urls: readonly string[]): AuditReport["pageRows"] {
  const row = must(POPULATED.lastAudit?.pageRows[0]);
  return urls.map((url) => ({ ...row, url }));
}

function result(p: string, platform: string, hit: boolean): VisResult {
  return { ...must(POPULATED.lastVis?.results[0]), p, platform, hit };
}

function hits(count: number, total: number): readonly VisResult[] {
  return Array.from({ length: total }, (_, i) => result(`p${i}`, "ChatGPT", i < count));
}

function gsc(query: string, position: number | null): GscRow {
  return { query, clicks: 1, impressions: 10, ctr: 0.1, position };
}

function artifact(id: string, at: string, overrides: Partial<Artifact> = {}): Artifact {
  return { ...must(POPULATED.artifacts[0]), id, at, ...overrides };
}

function entry(id: string, statement: string): KbEntry {
  return { ...must(POPULATED.kb?.entries[0]), id, statement };
}

describe("weekRange", () => {
  it("spans the seven days before now, as local dates", () => {
    expect(weekRange(NOW)).toEqual({ from: "2026-09-06", to: "2026-09-13" });
  });

  it("crosses a month boundary", () => {
    expect(weekRange(new Date(2026, 9, 3, 0, 5))).toEqual({ from: "2026-09-26", to: "2026-10-03" });
  });
});

describe("weekSummary: technical health", () => {
  it("is unknown without a completed audit, even while one is running", () => {
    expect(weekSummary(blank({ audit: report("2026-09-12 10:00", 56, []) }), NOW).health).toBeNull();
  });

  it("has no comparison when there is no earlier report", () => {
    const state = blank({ lastAudit: report("2026-09-12 10:00", 56, []) });
    expect(weekSummary(state, NOW).health).toEqual({ at: "2026-09-12 10:00", score: 56, previous: null, incomparableAt: null });
  });

  it("compares with the last archived report, by finding title", () => {
    const state = blank({
      lastAudit: report("2026-09-12 10:00", 56, [finding("kept", "mid"), finding("new", "high")]),
      auditHistory: [
        report("2026-08-01 10:00", 30, [finding("ancient", "low")]),
        report("2026-09-05 10:00", 49, [finding("kept", "mid"), finding("gone-1", "low"), finding("gone-2", "high")]),
      ],
    });
    expect(weekSummary(state, NOW).health).toEqual({
      at: "2026-09-12 10:00",
      score: 56,
      previous: { at: "2026-09-05 10:00", scoreDelta: 7, noLonger: ["gone-1", "gone-2"], newly: ["new"] },
      incomparableAt: null,
    });
  });

  // codex S7a #2: the earlier check found a high-severity issue on /b and the
  // latest never looked at /b. That page is unchecked, not better.
  it("has no comparison when the two checks looked at different pages", () => {
    const state = blank({
      lastAudit: { ...report("2026-09-12 10:00", 100, []), pageRows: pages("/a") },
      auditHistory: [{ ...report("2026-09-05 10:00", 80, [finding("Missing title", "high")]), pageRows: pages("/a", "/b") }],
    });
    expect(weekSummary(state, NOW).health).toEqual({
      at: "2026-09-12 10:00",
      score: 100,
      previous: null,
      incomparableAt: "2026-09-05 10:00",
    });
  });

  it("has no comparison when neither check lists the pages it looked at", () => {
    const state = blank({
      lastAudit: { ...report("2026-09-12 10:00", 100, []), pageRows: [] },
      auditHistory: [{ ...report("2026-09-05 10:00", 80, []), pageRows: [] }],
    });
    expect(weekSummary(state, NOW).health?.previous).toBeNull();
    expect(weekSummary(state, NOW).health?.incomparableAt).toBe("2026-09-05 10:00");
  });

  it("compares two checks over the same pages listed in another order", () => {
    const state = blank({
      lastAudit: { ...report("2026-09-12 10:00", 90, []), pageRows: pages("/b", "/a") },
      auditHistory: [{ ...report("2026-09-05 10:00", 80, []), pageRows: pages("/a", "/b") }],
    });
    expect(weekSummary(state, NOW).health?.previous?.scoreDelta).toBe(10);
  });

  it("counts high-severity findings in the latest report, and knows zero", () => {
    const state = blank({ lastAudit: report("2026-09-12 10:00", 56, [finding("a", "high"), finding("b", "mid")]) });
    expect(weekSummary(state, NOW).highFindings).toBe(1);
    expect(weekSummary(blank({ lastAudit: report("2026-09-12 10:00", 90, []) }), NOW).highFindings).toBe(0);
    expect(weekSummary(blank(), NOW).highFindings).toBeNull();
  });
});

describe("weekSummary: AI mention rate", () => {
  it("is unknown without a completed run, and ignores streamed results (Q20)", () => {
    const state = blank({ visResults: hits(3, 4), visPartial: true });
    expect(weekSummary(state, NOW).mention).toBeNull();
    expect(weekSummary(state, NOW).answerGaps).toBeNull();
  });

  it("is unknown for a completed run that returned nothing", () => {
    expect(weekSummary(blank({ lastVis: { at: "2026-09-12 11:00", results: [] } }), NOW).mention).toBeNull();
  });

  it("reads lastVis, not the results currently on screen", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: hits(23, 40) },
      visResults: hits(1, 2),
    });
    expect(weekSummary(state, NOW).mention).toEqual({
      at: "2026-09-12 11:00",
      share: "58%",
      hits: 23,
      total: 40,
      previous: null,
    });
  });

  it("compares with the last archived run, in rounded points", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: hits(14, 40) },
      visHistory: [
        { at: "2026-08-01 11:00", results: hits(1, 40) },
        { at: "2026-09-05 11:00", results: hits(12, 40) },
      ],
    });
    expect(weekSummary(state, NOW).mention?.previous).toEqual({ at: "2026-09-05 11:00", share: "30%", deltaPt: 5 });
  });

  it("has no comparison when the archived run returned nothing", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: hits(14, 40) },
      visHistory: [{ at: "2026-09-05 11:00", results: [] }],
    });
    expect(weekSummary(state, NOW).mention?.previous).toBeNull();
  });

  // codex S7a #1: neither platform did better; the miss was simply not asked again.
  it("has no comparison when the earlier run asked another set of platforms", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: [result("p1", "ChatGPT", true)] },
      visHistory: [
        { at: "2026-09-05 11:00", results: [result("p1", "ChatGPT", true), result("p1", "Perplexity", false)] },
      ],
    });
    expect(weekSummary(state, NOW).mention).toEqual({
      at: "2026-09-12 11:00",
      share: "100%",
      hits: 1,
      total: 1,
      previous: null,
    });
  });

  it("has no comparison when the prompts changed, even at the same total", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: [result("p3", "ChatGPT", true), result("p4", "ChatGPT", true)] },
      visHistory: [
        { at: "2026-09-05 11:00", results: [result("p1", "ChatGPT", true), result("p2", "ChatGPT", false)] },
      ],
    });
    expect(weekSummary(state, NOW).mention?.previous).toBeNull();
  });

  it("compares the same prompts and platforms listed in another order", () => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: [result("p2", "ChatGPT", true), result("p1", "ChatGPT", true)] },
      visHistory: [
        { at: "2026-09-05 11:00", results: [result("p1", "ChatGPT", true), result("p2", "ChatGPT", false)] },
      ],
    });
    expect(weekSummary(state, NOW).mention?.previous).toEqual({ at: "2026-09-05 11:00", share: "50%", deltaPt: 50 });
  });

  // codex S7a #7: `<1%` and `>99%` are bands, so no whole-point difference exists between them.
  it.each<[string, number, number, string]>([
    ["both shares are below 1%", 2, 1, "<1%"],
    ["both shares are above 99%", 200, 199, ">99%"],
    ["only the earlier share is a band", 3, 1, "<1%"],
    ["only the latest share is a band", 1, 3, "1%"],
  ])("keeps the earlier run but gives no point delta when %s", (_label, latestHits, earlierHits, earlierShare) => {
    const state = blank({
      lastVis: { at: "2026-09-12 11:00", results: hits(latestHits, 201) },
      visHistory: [{ at: "2026-09-05 11:00", results: hits(earlierHits, 201) }],
    });
    expect(weekSummary(state, NOW).mention?.previous).toEqual({
      at: "2026-09-05 11:00",
      share: earlierShare,
      deltaPt: null,
    });
  });

  it("counts prompts that at least one platform missed, once each", () => {
    const state = blank({
      lastVis: {
        at: "2026-09-12 11:00",
        results: [
          result("p1", "ChatGPT", true),
          result("p1", "Perplexity", false),
          result("p2", "ChatGPT", true),
          result("p2", "Perplexity", true),
          result("p3", "ChatGPT", false),
          result("p3", "Perplexity", false),
        ],
      },
    });
    expect(weekSummary(state, NOW).answerGaps).toBe(2);
  });
});

describe("weekSummary: borderline queries", () => {
  it("is unknown without GSC rows", () => {
    expect(weekSummary(blank(), NOW).borderline).toBeNull();
  });

  it("is unknown when no row has a usable position", () => {
    const state = blank({ gscRows: [gsc("a", null), gsc("b", 0)], gscRowsSource: "user" });
    expect(weekSummary(state, NOW).borderline).toBeNull();
  });

  it("is a measured empty list when positions exist and none is at 11-30", () => {
    const state = blank({ gscRows: [gsc("a", 3), gsc("b", 45)], gscRowsSource: "user" });
    expect(weekSummary(state, NOW).borderline).toEqual([]);
  });

  it("lists the rows at 11-30 by position, and only those", () => {
    const state = blank({
      gscRows: [gsc("thirty", 30), gsc("ten", 10), gsc("eleven", 11), gsc("mid", 14.2), gsc("far", 31), gsc("none", null)],
      gscRowsSource: "sample",
    });
    expect(weekSummary(state, NOW).borderline).toEqual([
      { query: "eleven", position: 11 },
      { query: "mid", position: 14.2 },
      { query: "thirty", position: 30 },
    ]);
  });
});

describe("weekSummary: the rest", () => {
  it("counts this week's artifacts, and zero is a count", () => {
    const state = blank({
      artifacts: [artifact("in", "2026-09-10 10:00"), artifact("old", "2026-08-01 10:00")],
    });
    expect(weekSummary(state, NOW).artifactsThisWeek).toBe(1);
    expect(weekSummary(blank(), NOW).artifactsThisWeek).toBe(0);
  });

  it("uses kbGapCount: unknown without a knowledge base, a blank statement is a gap", () => {
    expect(weekSummary(blank(), NOW).kbGaps).toBeNull();
    const kb = { at: "2026-09-10 16:00", entries: [entry("k1", "Plans start at $49."), entry("k2", "  ")] };
    expect(weekSummary(blank({ kb }), NOW).kbGaps).toBe(1);
    expect(weekSummary(blank({ kb: { ...kb, entries: [] } }), NOW).kbGaps).toBe(0);
  });

  it("names the audit repair-task prompts in the basket, and nothing else", () => {
    const state = blank({
      artifacts: [
        artifact("t1", "2026-08-01 10:00", { module: "audit", type: "prompt", title: "修复任务 A" }),
        artifact("t2", "2026-08-01 10:00", { module: "audit", type: "csv", title: "问题清单" }),
        artifact("t3", "2026-08-01 10:00", { module: "kb", type: "prompt", title: "知识库补全" }),
      ],
    });
    expect(weekSummary(state, NOW).auditTaskTitles).toEqual(["修复任务 A"]);
  });

  it("carries the feed as weekFeed builds it", () => {
    expect(weekSummary(POPULATED, NOW).events).toEqual(weekFeed(POPULATED, NOW));
  });

  it("calls a project empty only when it has nothing at all", () => {
    expect(weekSummary(blank(), NOW).empty).toBe(true);
  });

  it.each<[string, Partial<WorkbenchProjectState>]>([
    ["a completed audit", { lastAudit: must(POPULATED.lastAudit) }],
    ["a completed visibility run", { lastVis: must(POPULATED.lastVis) }],
    ["a profile document", { profileDoc: must(POPULATED.profileDoc) }],
    ["a knowledge base", { kb: must(POPULATED.kb) }],
    ["an artifact, however old", { artifacts: [artifact("old", "2025-01-01 10:00")] }],
    ["GSC rows", { gscRows: [gsc("a", 50)], gscRowsSource: "user" }],
  ])("is not empty with %s", (_label, overrides) => {
    expect(weekSummary(blank(overrides), NOW).empty).toBe(false);
  });
});

describe("weekNextSteps", () => {
  const summary = weekSummary(blank(), NOW);

  it("lists what there is to do, in a fixed order, with where to do it", () => {
    const steps = weekNextSteps({
      ...summary,
      highFindings: 3,
      answerGaps: 2,
      borderline: [{ query: "a", position: 12 }],
      kbGaps: 4,
    });
    expect(steps).toEqual([
      { id: "fixHigh", count: 3, target: "audit" },
      { id: "answerGaps", count: 2, target: "answers" },
      { id: "borderline", count: 1, target: "keywords" },
      { id: "kbGaps", count: 4, target: "kb" },
    ]);
  });

  it("falls back to one step when nothing is known or everything is zero", () => {
    const keepGoing = [{ id: "keepGoing", count: null, target: "content" }];
    expect(weekNextSteps(summary)).toEqual(keepGoing);
    expect(weekNextSteps({ ...summary, highFindings: 0, answerGaps: 0, borderline: [], kbGaps: 0 })).toEqual(keepGoing);
  });

  it("does not pad the list with steps that have nothing behind them", () => {
    expect(weekNextSteps({ ...summary, kbGaps: 2 })).toEqual([{ id: "kbGaps", count: 2, target: "kb" }]);
  });
});

describe("weeklyReportInput", () => {
  it("hands the builder the same numbers the page shows", () => {
    const state = blank({
      lastAudit: report("2026-09-12 10:00", 56, [finding("a", "high")]),
      gscRows: [gsc("mid", 14.2)],
      gscRowsSource: "user",
      artifacts: [artifact("t1", "2026-09-12 12:00", { module: "audit", type: "prompt", title: "修复任务 A" })],
    });
    const summary = weekSummary(state, NOW);
    expect(weeklyReportInput(summary, "Example", NOW)).toEqual({
      brand: "Example",
      from: "2026-09-06",
      to: "2026-09-13",
      health: summary.health,
      mention: null,
      artifactsThisWeek: 1,
      borderline: 1,
      answerGaps: null,
      kbGaps: null,
      highFindings: 1,
      auditTaskTitles: ["修复任务 A"],
      events: summary.events,
    });
  });

  it("keeps an unknown borderline count unknown", () => {
    expect(weeklyReportInput(weekSummary(blank(), NOW), "Example", NOW).borderline).toBeNull();
  });
});

describe("weekSummary on the sample site", () => {
  // The comparability rules must not quietly drop the sample site's own
  // comparisons: its audits share one page list and its runs one prompt set.
  it("still compares its audits and its visibility runs", () => {
    const now = new Date(2026, 8, 13, 12, 0);
    const state: WorkbenchProjectState = {
      ...initialProjectState(SEED),
      ...makeDemoSite(FULL_PROFILE, "full", DEMO_SEEDS, testDeps(now)),
    };
    const summary = weekSummary(state, now);
    expect(summary.health?.previous).not.toBeNull();
    expect(summary.health?.incomparableAt).toBeNull();
    expect(summary.mention?.previous).not.toBeNull();
  });
});
