// @input  -- a brief fixture and hand-built sections
// @output -- proof every derived DraftResult field follows the contract's truth table
// @pos    -- draft-assemble's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { draftFingerprint } from "./canonical.ts";
import { DRAFT_TOTAL_BUDGET_MS } from "./constants.ts";
import type { ContentBrief, DraftSection, LlmReadMeta } from "./contract.ts";
import {
  aggregateSectionLlm,
  assembleDraftResult,
  buildCoverage,
  decideCoverage,
  deriveDraftRunMode,
  deriveSectionReads,
  deriveVerifyList,
  gapAngleSectionId,
  planSections,
  validateCoverageOutput,
} from "./draft-assemble.ts";
import { contentBriefFixture, withFingerprint } from "./fixtures.ts";

const LLM_OK: LlmReadMeta = {
  status: "complete",
  calls: 1,
  model_id: "gpt-test",
  temperature_requested: 0,
  temperature_effective: null,
  input_tokens: 10,
  output_tokens: 5,
};

function okSection(id: string, h2: string, answers: [string, ...string[]], sentences: DraftSection extends { status: "ok" } ? never : never[] = []): DraftSection {
  void sentences;
  return {
    id,
    h2,
    answers,
    status: "ok",
    body: {
      word_count: 6,
      paragraphs: [
        {
          sentences: [
            { text: "Grind fresh.", claim: "bound", evidence_refs: ["C1"], support_count: 1 },
            { text: "Brewly grinders help.", claim: "bound", evidence_refs: ["P1"], support_count: 0 },
            { text: "Nobody covers hardness.", claim: "gap", evidence_refs: [], support_count: 0 },
          ],
        },
      ],
    },
    llm: { attempts: 1, input_tokens: 10, output_tokens: 20 },
  };
}

async function brief(): Promise<ContentBrief> {
  return withFingerprint(contentBriefFixture({ connected: true }));
}

describe("planSections", () => {
  it("keeps outline order, marks unchecked writable sections skipped, refuses unknown ids", async () => {
    const value = await brief();
    const writable = value.draft_readiness.writable;
    expect(writable.length).toBeGreaterThan(1);
    const [first, ...rest] = writable;
    const plan = planSections(value, [first as string]);
    expect("requested" in plan && plan.requested.map((s) => s.id)).toEqual([first]);
    expect("skipped" in plan && plan.skipped.map((s) => s.id)).toEqual(rest);
    expect(planSections(value, ["O99"])).toEqual({ ok: false, code: "section_not_writable" });
    expect(planSections(value, [])).toEqual({ ok: false, code: "section_not_writable" });
  });

  it("names the last outline section as the gap-angle home only when there is a gap angle", async () => {
    const value = await brief();
    if (value.outline.status !== "available") throw new Error("fixture has an outline");
    const last = value.outline.items[value.outline.items.length - 1]?.id ?? null;
    expect(gapAngleSectionId(value)).toBe(value.gap_angle.status === "available" ? last : null);
  });
});

describe("derived fields", () => {
  const sections: DraftSection[] = [
    okSection("O1", "Getting started", ["Q1"]),
    { id: "O2", h2: "Dialling in", answers: ["Q2"], status: "failed", fail_reason: "timeout", llm: { attempts: 2, input_tokens: null, output_tokens: null } },
    { id: "O3", h2: "Water", answers: ["Q3"], status: "skipped" },
  ];

  it("derives the verify list from claims and support counts", () => {
    expect(deriveVerifyList(sections).map((item) => item.kind)).toEqual(["single_source", "profile_only", "gap"]);
  });

  it("counts sections by status and derives the run mode", () => {
    const reads = deriveSectionReads(sections);
    expect(reads).toEqual({ requested: 2, ok: 1, failed: 1, skipped: 1 });
    const coverage = { status: "unavailable" as const, reason: "timeout" as const, attempted: 1 };
    expect(deriveDraftRunMode({ sections: reads, coverage })).toBe("degraded");
    expect(deriveDraftRunMode({ sections: { requested: 2, ok: 2, failed: 0, skipped: 1 }, coverage: { ...coverage, status: "available", items: [], total: 0, covered: 0, partial: 0, none: 0, provenance: { method: "model", derived_from: [] } } as never })).toBe("partial");
    expect(deriveDraftRunMode({ sections: { requested: 2, ok: 0, failed: 2, skipped: 0 }, coverage })).toBe("unavailable");
  });

  it("aggregates section calls into one llm read", () => {
    const aggregate = aggregateSectionLlm(
      [
        { status: "ok", attempts: 1, fail_reason: null, model_id: "m", temperature_requested: 0.4, temperature_effective: 1, input_tokens: 10, output_tokens: 5 },
        { status: "failed", attempts: 2, fail_reason: "timeout", model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null },
      ],
      0.4,
    );
    expect(aggregate).toMatchObject({ status: "partial", calls: 3, model_id: "m", failed_reasons: ["timeout"], input_tokens: 10 });
    expect(aggregateSectionLlm([], 0.4)).toMatchObject({ status: "unavailable", reason: "insufficient_evidence", calls: 0 });
  });
});

describe("coverage", () => {
  it("decides failed and skipped questions itself and asks the model about the rest", async () => {
    const value = await brief();
    const outline = value.outline.status === "available" ? value.outline.items : [];
    const sections: DraftSection[] = outline.map((item, index) =>
      index === 0
        ? { id: item.id, h2: item.h2, answers: item.answers, status: "failed", fail_reason: "timeout", llm: { attempts: 1, input_tokens: null, output_tokens: null } }
        : okSection(item.id, item.h2, item.answers),
    );
    const decision = decideCoverage(value, sections);
    expect(decision.heuristic.every((item) => item.cause === "section_failed" && item.method === "heuristic")).toBe(true);
    expect(decision.heuristic.map((item) => item.question_id)).toEqual([...outline[0]!.answers]);
    expect(decision.askable.length + decision.heuristic.length).toBe(
      value.must_answer.status === "available" ? value.must_answer.items.length : 0,
    );

    const okIds = new Set(sections.filter((section) => section.status === "ok").map((section) => section.id));
    const good = validateCoverageOutput(
      { items: decision.askable.map((id) => ({ question_id: id, status: "covered", covered_in: sections[1]!.id, gap: null })) },
      decision.askable,
      okIds,
    );
    expect(good.ok).toBe(true);
    expect(validateCoverageOutput({ items: [] }, decision.askable, okIds)).toMatchObject({ ok: false, path: "items" });
    expect(
      validateCoverageOutput(
        { items: decision.askable.map((id) => ({ question_id: id, status: "covered", covered_in: outline[0]!.id, gap: null })) },
        decision.askable,
        okIds,
      ),
    ).toMatchObject({ ok: false });

    const coverage = buildCoverage(value, decision.heuristic, good.ok ? good.items : [], LLM_OK);
    expect(coverage).toMatchObject({ status: "available", none: decision.heuristic.length, covered: decision.askable.length });
    expect(buildCoverage(value, decision.heuristic, null, { ...LLM_OK, status: "unavailable", reason: "timeout", attempted: 1 } as never)).toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
  });
});

describe("assembleDraftResult", () => {
  it("produces a result whose fingerprint recomputes and whose fields are derived", async () => {
    const value = await brief();
    const outline = value.outline.status === "available" ? value.outline.items : [];
    const sections = outline.map((item) => okSection(item.id, item.h2, item.answers));
    const decision = decideCoverage(value, sections);
    const coverage = buildCoverage(
      value,
      decision.heuristic,
      decision.askable.map((id) => ({ question_id: id, status: "covered" as const, covered_in: sections[0]!.id, gap: null, method: "model" as const, cause: null })),
      LLM_OK,
    );
    const result = await assembleDraftResult({
      run: { run_id: "draft-1", reran_from: null, collected_at: "2026-08-29T00:00:00.000Z", elapsed_ms: 100, budget_ms: DRAFT_TOTAL_BUDGET_MS },
      brief: value,
      settings: { tone: "explanatory", person: "second", product_mention: "gap_only" },
      sections,
      coverage,
      llmSections: aggregateSectionLlm(sections.map(() => ({ status: "ok", attempts: 1, fail_reason: null, model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: 1, output_tokens: 1 })), 0.4),
      llmCoverage: LLM_OK,
    });
    expect(result.schema).toBe("gengrowth.content_draft/v1");
    expect(result.brief_ref.fingerprint).toBe(value.run.fingerprint);
    expect(result.run.mode).toBe("complete");
    expect(result.verify_before_publish.length).toBe(sections.length * 3);
    await expect(draftFingerprint(result)).resolves.toBe(result.run.fingerprint);
  });
});
