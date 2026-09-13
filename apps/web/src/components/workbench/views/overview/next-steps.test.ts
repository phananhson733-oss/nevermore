/**
 * The overview's "what next" list and its empty test, as pure functions.
 *
 * Every branch of jsx:1104-1110 is pinned with the smallest input that reaches
 * it, and the two changes the plan makes to that list are pinned on their own:
 * the borderline step goes to the keyword page (Q21), and the "keep producing
 * content" fallback only appears once both diagnostics have a completed result
 * — it says the diagnostics are done, so it must never show on a project where
 * one of them has not run.
 */
import { describe, expect, it } from "vitest";
import type {
  AuditReport,
  Finding,
  KeywordRow,
  Severity,
  VisResult,
  VisSnapshot,
} from "@/lib/workbench/types";
import { isOverviewEmpty, overviewNextSteps, type NextStepsInput } from "./next-steps.ts";

function finding(id: string, sev: Severity): Finding {
  return {
    id, cat: "tech", t: id, sev, eng: "seo", found: "", expect: "", fix: "", w: 1, page: "/",
  };
}

function audit(sevs: readonly Severity[]): AuditReport {
  return {
    at: "2026-09-13 10:00",
    score: 61,
    findings: sevs.map((sev, index) => finding(`f${index}`, sev)),
    crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1.0", schema: 0, llmReadable: 0 },
    pageRows: [],
  };
}

function result(p: string, platform: string, hit: boolean): VisResult {
  return { p, platform, hit, rank: hit ? 1 : null, brands: [], domains: [], real: false };
}

function vis(results: readonly VisResult[]): VisSnapshot {
  return { at: "2026-09-13 11:00", results };
}

function row(q: string, position: number | null, gscStatus: KeywordRow["gscStatus"]): KeywordRow {
  const base: KeywordRow = {
    q, seed: q, intent: "informational", stage: "TOFU", page: "blog", engine: "seo",
    source: position === null ? "generated" : "gsc", volume: 10, kd: 10, cpc: "1.00",
    aio: false, score: 10, slug: q,
  };
  return gscStatus === undefined ? base : { ...base, position, gscStatus };
}

const ALL_CLEAR: NextStepsInput = {
  audit: audit(["mid", "low"]),
  lastVis: vis([result("a", "ChatGPT", true)]),
  rows: [row("ranked one", 4, "ranked")],
};

describe("overviewNextSteps", () => {
  it("asks for an audit when there is none, and for a visibility run and a matrix likewise", () => {
    expect(overviewNextSteps({ audit: null, lastVis: null, rows: [] })).toEqual([
      { id: "audit", target: "audit" },
      { id: "visibility", target: "visibility" },
      { id: "matrix", target: "keywords" },
    ]);
  });

  it("counts only high-severity findings for the fix step", () => {
    const steps = overviewNextSteps({ ...ALL_CLEAR, audit: audit(["high", "mid", "high", "low"]) });
    expect(steps).toEqual([{ id: "fixHigh", count: 2, target: "audit" }]);
  });

  it("drops the audit step entirely when the audit has no high-severity finding", () => {
    const steps = overviewNextSteps({ ...ALL_CLEAR, lastVis: null });
    expect(steps.map((step) => step.id)).toEqual(["visibility"]);
  });

  it("counts answer gaps as distinct prompts with at least one miss, across platforms", () => {
    const steps = overviewNextSteps({
      ...ALL_CLEAR,
      lastVis: vis([
        result("what is geo", "ChatGPT", false),
        result("what is geo", "Perplexity", false),
        result("geo vs seo", "ChatGPT", true),
        result("geo vs seo", "Perplexity", false),
        result("best geo tool", "ChatGPT", true),
      ]),
    });
    expect(steps).toEqual([{ id: "answerGaps", count: 2, target: "answers" }]);
  });

  it("treats a completed visibility run with zero results as no run", () => {
    const steps = overviewNextSteps({ ...ALL_CLEAR, lastVis: vis([]) });
    expect(steps).toEqual([{ id: "visibility", target: "visibility" }]);
  });

  it("sends borderline queries (positions 11-30) to the keyword page, not to content (Q21)", () => {
    const steps = overviewNextSteps({
      ...ALL_CLEAR,
      rows: [row("near a", 14, "borderline"), row("near b", 22, "borderline"), row("far", 48, "gap"), row("est", null, undefined)],
    });
    expect(steps).toEqual([{ id: "borderline", count: 2, target: "keywords" }]);
  });

  it("asks for the matrix only when there are no rows at all", () => {
    expect(overviewNextSteps({ ...ALL_CLEAR, rows: [] })).toEqual([{ id: "matrix", target: "keywords" }]);
    expect(overviewNextSteps({ ...ALL_CLEAR, rows: [row("est", null, undefined)] })).toEqual([
      { id: "content", target: "content" },
    ]);
  });

  it("falls back to content only when nothing else is left to do", () => {
    expect(overviewNextSteps(ALL_CLEAR)).toEqual([{ id: "content", target: "content" }]);
  });

  it("never offers the content fallback while either diagnostic has no completed result", () => {
    const noAudit = overviewNextSteps({ ...ALL_CLEAR, audit: null });
    const noVis = overviewNextSteps({ ...ALL_CLEAR, lastVis: null });
    expect(noAudit.map((step) => step.id)).toEqual(["audit"]);
    expect(noVis.map((step) => step.id)).toEqual(["visibility"]);
  });

  it("keeps the order audit, visibility, borderline, matrix", () => {
    const steps = overviewNextSteps({
      audit: audit(["high"]),
      lastVis: vis([result("q", "ChatGPT", false)]),
      rows: [row("near", 12, "borderline")],
    });
    expect(steps.map((step) => step.id)).toEqual(["fixHigh", "answerGaps", "borderline"]);
  });
});

describe("isOverviewEmpty", () => {
  const blank = { audit: null, lastVis: null, built: false, artifacts: [] } as const;

  it("is empty only when there is no audit, no completed visibility run, no built matrix and no artifact", () => {
    expect(isOverviewEmpty(blank)).toBe(true);
    expect(isOverviewEmpty({ ...blank, audit: audit([]) })).toBe(false);
    expect(isOverviewEmpty({ ...blank, lastVis: vis([]) })).toBe(false);
    expect(isOverviewEmpty({ ...blank, built: true })).toBe(false);
    expect(
      isOverviewEmpty({
        ...blank,
        artifacts: [{ id: "a", at: "2026-09-13 10:00", module: "audit", type: "md", engine: "seo", title: "t", content: "c" }],
      }),
    ).toBe(false);
  });
});
