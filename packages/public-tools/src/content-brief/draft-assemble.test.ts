// @input  -- a brief fixture and sections built through the section validator
// @output -- proof every derived DraftResult field follows the contract's truth table and the assembled result passes its own parser
// @pos    -- draft-assemble's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { draftFingerprint } from "./canonical.ts";
import { DRAFT_TOTAL_BUDGET_MS, MODEL_TEXT_MAX_CHARS } from "./constants.ts";
import type { ContentBrief, DraftResult, DraftSection, LlmReadMeta, ModelSectionOutput } from "./contract.ts";
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
  sectionEvidenceScope,
  validateCoverageOutput,
  type SectionCallMeta,
} from "./draft-assemble.ts";
import { contentBriefFixture, withFingerprint } from "./fixtures.ts";
import { parseDraftResult } from "./parse-draft.ts";
import { validateSectionOutput } from "./validate-section.ts";

const LLM_OK: LlmReadMeta = {
  status: "complete",
  calls: 1,
  model_id: "gpt-test",
  temperature_requested: 0,
  temperature_effective: null,
  input_tokens: 10,
  output_tokens: 5,
};

const SETTINGS: DraftResult["settings"] = { tone: "explanatory", person: "second", product_mention: "gap_only" };

function okCall(): SectionCallMeta {
  return { status: "ok", attempts: 1, fail_reason: null, model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: 10, output_tokens: 5 };
}

async function brief(): Promise<ContentBrief> {
  return withFingerprint(contentBriefFixture({ connected: true }));
}

/** Builds an ok section the way the handler does: model output → validator → body. */
function okSection(value: ContentBrief, id: string, settings = SETTINGS): DraftSection {
  const outline = value.outline.status === "available" ? value.outline.items.find((item) => item.id === id) : undefined;
  if (outline === undefined) throw new Error(`fixture has no ${id}`);
  const scope = sectionEvidenceScope(value, id, settings);
  const citable = [...scope.citableCrawlIds][0];
  const fact = [...scope.profileFactIds][0];
  const output: ModelSectionOutput = {
    paragraphs: [
      {
        sentences: [
          ...(citable === undefined ? [] : [{ text: `Page ${citable} says so.`, claim: "bound" as const, evidence_refs: [citable] }]),
          ...(fact === undefined ? [] : [{ text: "Our pool warms from real mailboxes.", claim: "bound" as const, evidence_refs: [fact] }]),
          { text: "Nobody covers pooled warmup.", claim: "gap" as const, evidence_refs: [] },
        ],
      },
    ],
  };
  const facts = new Map((value.evidence.profile?.facts ?? []).filter((item) => scope.profileFactIds.has(item.id)).map((item) => [item.id, item]));
  const validated = validateSectionOutput(output, { citableCrawlIds: scope.citableCrawlIds, profileFacts: facts, stanceAllowed: scope.stanceAllowed });
  if (!validated.ok) throw new Error(`fixture section ${id} failed ${validated.rule}`);
  return {
    id,
    h2: outline.h2,
    answers: outline.answers,
    status: "ok",
    body: { word_count: validated.word_count, paragraphs: validated.paragraphs },
    llm: { attempts: 1, input_tokens: 10, output_tokens: 5 },
  };
}

function failedSection(value: ContentBrief, id: string): DraftSection {
  const outline = value.outline.status === "available" ? value.outline.items.find((item) => item.id === id) : undefined;
  if (outline === undefined) throw new Error(`fixture has no ${id}`);
  return { id, h2: outline.h2, answers: outline.answers, status: "failed", fail_reason: "timeout", llm: { attempts: 1, input_tokens: null, output_tokens: null } };
}

function skippedSection(value: ContentBrief, id: string): DraftSection {
  const outline = value.outline.status === "available" ? value.outline.items.find((item) => item.id === id) : undefined;
  if (outline === undefined) throw new Error(`fixture has no ${id}`);
  return { id, h2: outline.h2, answers: outline.answers, status: "skipped" };
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

describe("sectionEvidenceScope", () => {
  it("limits citable pages to the section's own questions and releases facts by product_mention", async () => {
    const value = await brief();
    if (value.must_answer.status !== "available") throw new Error("fixture has questions");
    const o1 = sectionEvidenceScope(value, "O1", SETTINGS);
    const o3 = sectionEvidenceScope(value, "O3", SETTINGS);
    const q1Members = new Set(value.must_answer.items.find((item) => item.id === "Q1")?.cluster.members.map((member) => member.observation_id));
    expect([...o1.citableCrawlIds].every((id) => q1Members.has(id))).toBe(true);
    expect(o1.citableCrawlIds.size).toBeGreaterThan(0);
    expect([...o1.citableCrawlIds].some((id) => !o3.citableCrawlIds.has(id)) || [...o3.citableCrawlIds].some((id) => !o1.citableCrawlIds.has(id))).toBe(true);
    // gap_only: only the gap-angle home sees facts, and only the ones the angle names.
    expect([...o1.profileFactIds]).toEqual([]);
    expect([...o3.profileFactIds]).toEqual(["P1"]);
    expect([...sectionEvidenceScope(value, "O1", { ...SETTINGS, product_mention: "none" }).profileFactIds]).toEqual([]);
    expect([...sectionEvidenceScope(value, "O3", { ...SETTINGS, product_mention: "none" }).profileFactIds]).toEqual([]);
    expect([...sectionEvidenceScope(value, "O1", { ...SETTINGS, product_mention: "throughout" }).profileFactIds]).toEqual(["P1", "P2"]);
    expect(sectionEvidenceScope(value, "O99", SETTINGS)).toEqual({ citableCrawlIds: new Set(), profileFactIds: new Set(), stanceAllowed: false });
    expect(o1.stanceAllowed).toBe(false);
    expect(o3.stanceAllowed).toBe(true);
  });
});

describe("derived fields", () => {
  it("derives the verify list, reads and mode", async () => {
    const value = await brief();
    const sections = [okSection(value, "O1"), failedSection(value, "O2"), skippedSection(value, "O3")];
    expect(deriveVerifyList(sections).map((item) => item.kind)).toEqual(["single_source", "gap"]);
    const reads = deriveSectionReads(sections);
    expect(reads).toEqual({ requested: 2, ok: 1, failed: 1, skipped: 1 });
    const coverage = { status: "unavailable" as const, reason: "timeout" as const, attempted: 1 };
    expect(deriveDraftRunMode({ sections: reads, coverage })).toBe("degraded");
    expect(deriveDraftRunMode({ sections: { requested: 2, ok: 2, failed: 0, skipped: 1 }, coverage: { ...coverage, status: "available", items: [], total: 0, covered: 0, partial: 0, none: 0, provenance: { method: "model", derived_from: [] } } as never })).toBe("partial");
    expect(deriveDraftRunMode({ sections: { requested: 2, ok: 0, failed: 2, skipped: 0 }, coverage })).toBe("unavailable");
  });

  it("aggregates section calls into one llm read", () => {
    const failed: SectionCallMeta = { status: "failed", attempts: 2, fail_reason: "timeout", model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null };
    const aggregate = aggregateSectionLlm([{ ...okCall(), temperature_effective: 1 }, failed], 0.4);
    expect(aggregate).toMatchObject({ status: "partial", calls: 3, model_id: "m", failed_reasons: ["timeout"] });
    expect(aggregateSectionLlm([], 0.4)).toMatchObject({ status: "unavailable", reason: "insufficient_evidence", calls: 0, input_tokens: null });
  });

  it("reports token totals as unknown when any real attempt has unknown usage", () => {
    const unknownUsage: SectionCallMeta = { ...okCall(), input_tokens: null, output_tokens: null };
    expect(aggregateSectionLlm([okCall(), unknownUsage], 0.4)).toMatchObject({ input_tokens: null, output_tokens: null });
    const neverSent: SectionCallMeta = { status: "failed", attempts: 0, fail_reason: "not_configured", model_id: null, temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null };
    expect(aggregateSectionLlm([okCall(), neverSent], 0.4)).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    expect(aggregateSectionLlm([okCall(), okCall()], 0.4)).toMatchObject({ input_tokens: 20, output_tokens: 10 });
  });
});

describe("coverage", () => {
  it("decides failed and skipped questions itself and asks the model about the rest", async () => {
    const value = await brief();
    const sections = [failedSection(value, "O1"), okSection(value, "O2"), okSection(value, "O3")];
    const decision = decideCoverage(value, sections);
    expect(decision.heuristic.every((item) => item.cause === "section_failed" && item.method === "heuristic")).toBe(true);
    expect(decision.heuristic.map((item) => item.question_id)).toEqual([...sections[0]!.answers]);
    expect(decision.askable.length + decision.heuristic.length).toBe(value.must_answer.status === "available" ? value.must_answer.items.length : 0);

    const okIds = new Set(["O2", "O3"]);
    const good = validateCoverageOutput(
      { items: decision.askable.map((id) => ({ question_id: id, status: "covered", covered_in: "O2", gap: null })) },
      decision.askable,
      okIds,
    );
    expect(good.ok).toBe(true);
    expect(validateCoverageOutput({ items: [] }, decision.askable, okIds)).toMatchObject({ ok: false, path: "items" });
    expect(validateCoverageOutput({ items: decision.askable.map((id) => ({ question_id: id, status: "covered", covered_in: "O1", gap: null })) }, decision.askable, okIds)).toMatchObject({ ok: false });

    const coverage = buildCoverage(value, decision.heuristic, good.ok ? good.items : [], LLM_OK);
    expect(coverage).toMatchObject({ status: "available", none: decision.heuristic.length, covered: decision.askable.length });
    expect(buildCoverage(value, decision.heuristic, null, { ...LLM_OK, status: "unavailable", reason: "timeout", attempted: 1 } as never)).toMatchObject({ status: "unavailable", reason: "timeout" });
  });

  it("refuses contradictory verdicts instead of editing them into shape", async () => {
    const value = await brief();
    const sections = [okSection(value, "O1"), okSection(value, "O2"), okSection(value, "O3")];
    const { askable } = decideCoverage(value, sections);
    const okIds = new Set(["O1", "O2", "O3"]);
    const rest = askable.slice(1).map((id) => ({ question_id: id, status: "covered" as const, covered_in: "O1", gap: null }));
    const first = askable[0] as string;
    expect(validateCoverageOutput({ items: [{ question_id: first, status: "covered", covered_in: "O1", gap: "still missing the numbers" }, ...rest] }, askable, okIds)).toMatchObject({ ok: false, path: "items[0].gap" });
    expect(validateCoverageOutput({ items: [{ question_id: first, status: "none", covered_in: "O1", gap: "not answered" }, ...rest] }, askable, okIds)).toMatchObject({ ok: false, path: "items[0].covered_in" });
    expect(validateCoverageOutput({ items: [{ question_id: first, status: "partial", covered_in: "O1", gap: null }, ...rest] }, askable, okIds)).toMatchObject({ ok: false, path: "items[0].gap" });
    expect(validateCoverageOutput({ items: [{ question_id: first, status: "partial", covered_in: "O1", gap: "x".repeat(MODEL_TEXT_MAX_CHARS + 1) }, ...rest] }, askable, okIds)).toMatchObject({ ok: false, path: "items[0].gap" });
    const cleaned = validateCoverageOutput({ items: [{ question_id: first, status: "none", covered_in: null, gap: "  two  spaces  " }, ...rest] }, askable, okIds);
    expect(cleaned.ok && cleaned.items[0]?.gap).toBe("two spaces");
  });
});

describe("assembleDraftResult", () => {
  it("produces a result its own parser accepts, with a fingerprint that recomputes", async () => {
    const value = await brief();
    const sections = [okSection(value, "O1"), okSection(value, "O2"), okSection(value, "O3")];
    const decision = decideCoverage(value, sections);
    const coverage = buildCoverage(
      value,
      decision.heuristic,
      decision.askable.map((id) => ({ question_id: id, status: "covered" as const, covered_in: "O1", gap: null, method: "model" as const, cause: null })),
      LLM_OK,
    );
    const result = await assembleDraftResult({
      run: { run_id: "draft-1", reran_from: null, collected_at: "2026-08-29T00:00:00.000Z", elapsed_ms: 100, budget_ms: DRAFT_TOTAL_BUDGET_MS },
      brief: value,
      settings: SETTINGS,
      sections,
      coverage,
      llmSections: aggregateSectionLlm(sections.map(() => okCall()), 0.4),
      llmCoverage: LLM_OK,
    });
    expect(result.schema).toBe("gengrowth.content_draft/v1");
    expect(result.brief_ref.fingerprint).toBe(value.run.fingerprint);
    expect(result.run.mode).toBe("complete");
    await expect(parseDraftResult(result, value)).resolves.toMatchObject({ ok: true });
    await expect(draftFingerprint(result)).resolves.toBe(result.run.fingerprint);
  });
});
