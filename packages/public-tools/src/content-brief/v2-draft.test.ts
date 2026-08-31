import { describe, expect, it } from "vitest";
import { DRAFT_TOTAL_BUDGET_MS, SECTION_ENDPOINT_BUDGET_MS } from "./constants.ts";
import type { LlmReadMeta, ModelCoverageOutput } from "./contract.ts";
import { confirmedDraftV2Fixture } from "./v2-draft-fixtures.ts";
import { DRAFT_V2_MAX_BYTES, type DraftResultV2, type DraftV2Call, type DraftV2Section, type DraftV2Settings } from "./v2-draft-contract.ts";
import { validateDraftV2Section } from "./v2-draft-section.ts";
import { buildDraftV2SectionScope } from "./v2-draft-scope.ts";
import { assembleDraftV2, fingerprintDraftV2, parseDraftResultV2 } from "./v2-draft.ts";
import type { ConfirmedBriefV2 } from "./v2-generation-contract.ts";

const settings: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "none" };
const llm: DraftV2Call = { attempts: 1, model_id: "offline-draft-model", temperature_requested: 0.4, temperature_effective: null, input_tokens: 50, output_tokens: 20 };
const coverageRead: LlmReadMeta = { status: "complete", calls: 1, model_id: "offline-coverage-model", temperature_requested: 0, temperature_effective: null, input_tokens: 80, output_tokens: 20 };
const noCoverage: LlmReadMeta = { status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null };
const initialRun = { run_id: "draft-fixture", collected_at: "2026-08-31T02:00:00.000Z", elapsed_ms: 100, budget_ms: DRAFT_TOTAL_BUDGET_MS, rerun: null };

function sectionsFor(confirmed: ConfirmedBriefV2): DraftV2Section[] {
  return confirmed.outline.map((heading, index) => {
    const scope = buildDraftV2SectionScope(confirmed, heading.id, settings);
    if (!scope.ok) throw new Error(scope.path);
    const body = validateDraftV2Section({ paragraphs: [{ heading: heading.h3[0] ?? null, sentences: [{ text: index === 0 ? "Review the reporting timeline." : "Compare the complete periods.", claim: "no_claim", evidence_refs: [] }] }] }, scope.value, confirmed.brief.context.input.language);
    if (!body.ok) throw new Error(body.path);
    return { ...heading, status: "ok", body: body.value, llm };
  });
}
function coverageFor(confirmed: ConfirmedBriefV2): ModelCoverageOutput["items"] {
  return confirmed.brief.generated!.research.questions.map((question) => ({ question_id: question.id, status: "covered", covered_in: confirmed.outline.find((heading) => heading.answers.includes(question.id))!.id, gap: null }));
}
async function fixture(options: Parameters<typeof confirmedDraftV2Fixture>[0] = {}) {
  const confirmed = await confirmedDraftV2Fixture(options);
  const input = { confirmed, settings, sections: sectionsFor(confirmed), coverage: { items: coverageFor(confirmed), reads: coverageRead }, run: initialRun };
  const result = await assembleDraftV2(input);
  expect(result.ok, !result.ok ? result.path : "").toBe(true);
  if (!result.ok) throw new Error(result.path);
  return { confirmed, input, result: result.value };
}
async function seal(value: DraftResultV2): Promise<DraftResultV2> {
  return { ...value, run: { ...value.run, fingerprint: await fingerprintDraftV2(value) } };
}

describe("strict Draft v2 result assembly", () => {
  it.each([{ action: "create" as const }, { action: "update" as const }, { paaOnly: true, language: "zh-CN", reverse: true }])("round-trips real confirmed input %#", async (options) => {
    const { confirmed, result } = await fixture(options);
    expect(await parseDraftResultV2(result, confirmed)).toEqual({ ok: true, value: result });
    expect(result.sections.map(({ id, h2, h3, answers }) => ({ id, h2, h3, answers }))).toEqual(confirmed.outline);
    expect(result.confirmed_ref).toEqual({ schema: confirmed.schema, fingerprint: confirmed.fingerprint, revision: confirmed.revision, brief_run_id: confirmed.brief.run.run_id, keyword: confirmed.brief.context.input.primary });
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 2, input_tokens: 100, output_tokens: 40 });
  });

  it("covers every frozen question in any OK section even when its planned owner failed", async () => {
    const { confirmed, input } = await fixture();
    const sections: DraftV2Section[] = [{ ...confirmed.outline[0]!, status: "failed", fail_reason: "timeout", llm }, input.sections[1]!];
    const items: ModelCoverageOutput["items"] = coverageFor(confirmed).map((item) => ({ ...item, covered_in: "O2" }));
    const result = await assembleDraftV2({ ...input, sections, coverage: { items, reads: coverageRead } });
    expect(result).toMatchObject({ ok: true, value: { coverage: { status: "available", method: "model", covered: 2 }, run: { mode: "degraded" } } });
  });

  it.each([0, 1, 2])("preserves successful text after a validation failure with %i actual calls", async (attempts) => {
    const { confirmed, input } = await fixture();
    // Producer receipts: prompt overflow before the first call, overflow/deadline
    // before a retry, or two invalid replies. No unsent attempt acquires usage.
    const receipt: DraftV2Call = {
      ...llm, attempts, model_id: attempts === 0 ? null : llm.model_id,
      input_tokens: attempts === 0 ? null : 50 * attempts,
      output_tokens: attempts === 0 ? null : 20 * attempts,
    };
    const sections: DraftV2Section[] = [{ ...confirmed.outline[0]!, status: "failed", fail_reason: "validation_failed", llm: receipt }, input.sections[1]!];
    const items = coverageFor(confirmed).map((item) => ({ ...item, covered_in: "O2" }));
    const result = await assembleDraftV2({ ...input, sections, coverage: { items, reads: coverageRead } });
    expect(result).toMatchObject({ ok: true, value: {
      sections: [{ status: "failed", fail_reason: "validation_failed", llm: receipt }, { status: "ok" }],
      run: { mode: "degraded", reads: {
        sections: { requested: 2, ok: 1, failed: 1, skipped: 0 },
        llm_sections: { status: "partial", calls: attempts + 1, input_tokens: 50 * (attempts + 1), output_tokens: 20 * (attempts + 1), failed_reasons: ["validation_failed"] },
      } },
    } });
    if (!result.ok) throw new Error(result.path);
    expect(result.value.sections[1]).toEqual(input.sections[1]);
    expect(await parseDraftResultV2(result.value, confirmed)).toEqual(result);
  });

  it("rejects any fabricated model or usage on a zero-call validation failure", async () => {
    const { confirmed, input } = await fixture();
    const noCall: DraftV2Call = { ...llm, attempts: 0, model_id: null, temperature_effective: null, input_tokens: null, output_tokens: null };
    for (const receipt of [
      { ...noCall, model_id: "invented-model" }, { ...noCall, input_tokens: 0 }, { ...noCall, output_tokens: 0 },
      { ...noCall, temperature_effective: 0 }, { ...noCall, temperature_requested: 0 },
    ]) {
      const sections: DraftV2Section[] = [{ ...confirmed.outline[0]!, status: "failed", fail_reason: "validation_failed", llm: receipt }, input.sections[1]!];
      expect(await assembleDraftV2({ ...input, sections })).toMatchObject({ ok: false });
    }
  });

  it("marks empty drafts deterministically without claiming a model judgement or call", async () => {
    const { confirmed, input } = await fixture({ paaOnly: true });
    const sections: DraftV2Section[] = [{ ...confirmed.outline[0]!, status: "failed", fail_reason: "not_configured", llm: { ...llm, attempts: 0, model_id: null, input_tokens: null, output_tokens: null } }, { ...confirmed.outline[1]!, status: "skipped" }];
    expect(await assembleDraftV2({ ...input, sections, coverage: { items: null, reads: noCoverage } })).toMatchObject({ ok: true, value: {
      coverage: { status: "available", method: "empty_draft", total: 2, none: 2, items: [{ cause: "section_failed" }, { cause: "section_skipped" }] }, run: { mode: "unavailable", reads: { llm_coverage: noCoverage } },
    } });
    expect(await assembleDraftV2({ ...input, sections })).toMatchObject({ ok: false });
  });

  it("downgrades invalid coverage to unavailable while retaining returned usage", async () => {
    const { input } = await fixture();
    expect(await assembleDraftV2({ ...input, coverage: { items: [], reads: coverageRead } })).toMatchObject({ ok: true, value: {
      coverage: { status: "unavailable", reason: "validation_failed", attempted: 1 },
      run: { reads: { llm_coverage: { status: "unavailable", reason: "validation_failed", attempted: 1, calls: 1, model_id: coverageRead.model_id, input_tokens: 80, output_tokens: 20 } } },
    } });
  });

  it("uses the whole text for mixed-script totals instead of adding unlike units", async () => {
    const { input, confirmed } = await fixture();
    const scope = buildDraftV2SectionScope(confirmed, "O2", settings);
    if (!scope.ok) throw new Error(scope.path);
    const body = validateDraftV2Section({ paragraphs: [{ heading: confirmed.outline[1]!.h3[0], sentences: [{ text: "中文", claim: "no_claim", evidence_refs: [] }] }] }, scope.value, "en");
    if (!body.ok) throw new Error(body.path);
    const result = await assembleDraftV2({ ...input, sections: [input.sections[0]!, { ...confirmed.outline[1]!, status: "ok", body: body.value, llm }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { value: 29, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" } } });
  });

  it("rejects stale headings and bindings even when the result is re-fingerprinted", async () => {
    const { confirmed, result } = await fixture();
    const variants: DraftResultV2[] = [
      { ...result, sections: [{ ...result.sections[0]!, h2: "Changed heading" }, result.sections[1]!] },
      { ...result, sections: [{ ...result.sections[0]!, h3: ["Changed subheading"] }, result.sections[1]!] },
      { ...result, sections: [...result.sections].reverse() },
      { ...result, confirmed_ref: { ...result.confirmed_ref, revision: 1 } },
      { ...result, confirmed_ref: { ...result.confirmed_ref, keyword: "another keyword" } },
      { ...result, run: { ...result.run, reads: { ...result.run.reads, sections: { requested: 2, ok: 1, failed: 1, skipped: 0 } } } },
      { ...result, totals: { ...result.totals, value: 999 } },
      { ...result, coverage: { status: "available", method: "model", items: [], total: 0, covered: 0, partial: 0, none: 0 } },
      { ...result, settings: { ...settings, tone: "technical" } },
    ];
    for (const changed of variants.slice(0, -1)) expect(await parseDraftResultV2(await seal(changed), confirmed)).toMatchObject({ ok: false });
    expect(await parseDraftResultV2(variants.at(-1), confirmed)).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch" });
    expect(await parseDraftResultV2(result, { ...confirmed, revision: 3 })).toMatchObject({ ok: false });
    expect(await parseDraftResultV2({ ...result, extra: true }, confirmed)).toMatchObject({ ok: false });
    expect(await parseDraftResultV2({ schema: result.schema, payload: "x".repeat(DRAFT_V2_MAX_BYTES) }, confirmed)).toMatchObject({ ok: false });
  });

  it("binds reruns to the exact previous result and preserves every other section", async () => {
    const { confirmed, input, result: previous } = await fixture();
    const rerun = { previous_run_id: previous.run.run_id, previous_fingerprint: previous.run.fingerprint, section_id: "O1" };
    const result = await assembleDraftV2({ ...input, run: { ...initialRun, run_id: "rerun-fixture", budget_ms: SECTION_ENDPOINT_BUDGET_MS, rerun }, sections: input.sections.map((section) => section.id === "O1" && section.status === "ok" ? { ...section, llm: { ...llm, attempts: 2, input_tokens: 120, output_tokens: 40 } } : section) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.run.reads.llm_sections).toMatchObject({ calls: 2, input_tokens: 120, output_tokens: 40 });
    expect(await parseDraftResultV2(result.value, confirmed, previous)).toMatchObject({ ok: true });
    expect(await parseDraftResultV2(result.value, confirmed)).toMatchObject({ ok: true });
    expect(await parseDraftResultV2(previous, confirmed, previous)).toMatchObject({ ok: false });
    expect(await parseDraftResultV2(await seal({ ...result.value, settings: { ...settings, tone: "technical" } }), confirmed, previous)).toMatchObject({ ok: false });
    const unrelated = result.value.sections.map((section) => section.id === "O2" && section.status === "ok" ? { ...section, llm: { ...section.llm, output_tokens: 22 } } : section);
    expect(await parseDraftResultV2(await seal({ ...result.value, sections: unrelated }), confirmed, previous)).toMatchObject({ ok: false });
    expect(await parseDraftResultV2(result.value, confirmed, await seal({ ...previous, run: { ...previous.run, run_id: "other-previous" } }))).toMatchObject({ ok: false });
  });

  it("recomputes page, profile, gap and stance verification rather than trusting counts", async () => {
    const { input, confirmed } = await fixture();
    const withProfile: DraftV2Settings = { ...settings, product_mention: "throughout" };
    const first = buildDraftV2SectionScope(confirmed, "O1", withProfile);
    const last = buildDraftV2SectionScope(confirmed, "O2", withProfile);
    if (!first.ok || !last.ok) throw new Error("fixture scopes");
    const body1 = validateDraftV2Section({ paragraphs: [{ heading: first.value.allowed_h3[0], sentences: [
      { text: "Reporting can lag behind collection.", claim: "bound", evidence_refs: [...first.value.page_units.keys()] },
      { text: "The product compares finalized periods.", claim: "bound", evidence_refs: ["P1"] },
    ] }] }, first.value, "en");
    const body2 = validateDraftV2Section({ paragraphs: [{ heading: last.value.allowed_h3[0], sentences: [
      { text: "Confirm the exact reporting interval.", claim: "gap", evidence_refs: [] },
      { text: "Prefer finalized period comparisons.", claim: "stance", evidence_refs: ["P1"] },
    ] }] }, last.value, "en");
    if (!body1.ok || !body2.ok) throw new Error("fixture bodies");
    const assembled = await assembleDraftV2({ ...input, settings: withProfile, sections: [
      { ...confirmed.outline[0]!, status: "ok", body: body1.value, llm }, { ...confirmed.outline[1]!, status: "ok", body: body2.value, llm },
    ] });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) throw new Error(assembled.path);
    const result = assembled.value;
    expect(result.verify_before_publish.map(({ kind }) => kind)).toEqual(["single_source", "profile_only", "gap", "stance"]);
    expect(await parseDraftResultV2(await seal({ ...result, verify_before_publish: [] }), confirmed)).toMatchObject({ ok: false });
    expect(await parseDraftResultV2(await seal({ ...result, settings }), confirmed)).toMatchObject({ ok: false });
    for (const ref of ["P2", "U999", confirmed.brief.context.research.units.find((unit) => unit.kind === "paa")!.id]) {
      const corrupted: DraftV2Section = { ...confirmed.outline[0]!, status: "ok", llm, body: { ...body1.value, paragraphs: body1.value.paragraphs.map((paragraph) => ({ ...paragraph, sentences: paragraph.sentences.map((sentence, index) => index === 0 ? { ...sentence, evidence_refs: [ref] } : sentence) })) } };
      expect(await parseDraftResultV2(await seal({ ...result, sections: [corrupted, result.sections[1]!] }), confirmed)).toMatchObject({ ok: false });
    }
    const inflated: DraftV2Section = { ...confirmed.outline[0]!, status: "ok", llm, body: { ...body1.value, paragraphs: body1.value.paragraphs.map((paragraph) => ({ ...paragraph, sentences: paragraph.sentences.map((sentence) => ({ ...sentence, support_count: 99 })) })) } };
    expect(await parseDraftResultV2(await seal({ ...result, sections: [inflated, result.sections[1]!] }), confirmed)).toMatchObject({ ok: false });
  });

  it("rejects impossible section receipts and protects every nested exact-key branch", async () => {
    const { result, confirmed } = await fixture();
    const first = result.sections[0]!;
    if (first.status !== "ok") throw new Error("fixture section");
    for (const receipt of [
      { ...llm, attempts: 0 }, { ...llm, attempts: 3 }, { ...llm, attempts: 1.5 }, { ...llm, model_id: null },
      { ...llm, model_id: " " }, { ...llm, input_tokens: 1e20 }, { ...llm, temperature_requested: 1 },
      { ...llm, temperature_effective: 3 }, { ...llm, extra: true },
    ]) {
      expect(await parseDraftResultV2(await seal({ ...result, sections: [{ ...first, llm: receipt }, result.sections[1]!] }), confirmed)).toMatchObject({ ok: false });
    }
    const failed: DraftV2Section[] = [
      { ...confirmed.outline[0]!, status: "failed", fail_reason: "not_configured", llm },
      { ...confirmed.outline[0]!, status: "failed", fail_reason: "provider_error", llm: { ...llm, attempts: 0, model_id: null, input_tokens: null, output_tokens: null } },
      { ...confirmed.outline[0]!, status: "failed", fail_reason: "timeout", llm: { ...llm, attempts: 0 } },
    ];
    for (const section of failed) expect(await parseDraftResultV2(await seal({ ...result, sections: [section, result.sections[1]!] }), confirmed)).toMatchObject({ ok: false });
    for (const value of [null, [], true, { ...result, run: { ...result.run, extra: true } }, { ...result, settings: { ...settings, extra: true } }, { ...result, confirmed_ref: { ...result.confirmed_ref, extra: true } }, { ...result, coverage: { ...result.coverage, extra: true } }]) {
      expect(await parseDraftResultV2(value, confirmed)).toMatchObject({ ok: false });
    }
  });

  it("preserves unknown coverage and rejects forged counts, causes or impossible model ledgers", async () => {
    const { input, confirmed, result } = await fixture();
    const unavailable: LlmReadMeta = { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null };
    expect(await assembleDraftV2({ ...input, coverage: { items: null, reads: unavailable } })).toMatchObject({ ok: true, value: { coverage: { status: "unavailable", reason: "timeout", attempted: 1 } } });
    for (const read of [
      { ...coverageRead, calls: 0 }, { ...coverageRead, calls: 2 }, { ...coverageRead, temperature_requested: 0.4 },
      { ...coverageRead, model_id: " " }, { ...coverageRead, output_tokens: 1e20 }, noCoverage,
      { ...unavailable, attempted: 0 }, { ...unavailable, calls: 0 },
    ]) expect(await assembleDraftV2({ ...input, coverage: { items: null, reads: read } })).toMatchObject({ ok: false });
    if (result.coverage.status !== "available") throw new Error("fixture coverage");
    for (const coverage of [
      { ...result.coverage, covered: 1 }, { ...result.coverage, method: "empty_draft" as const },
      { ...result.coverage, items: [...result.coverage.items].reverse() },
      { ...result.coverage, items: [result.coverage.items[0]!, result.coverage.items[0]!] },
    ]) expect(await parseDraftResultV2(await seal({ ...result, coverage }), confirmed)).toMatchObject({ ok: false });
  });

  it("does not hash elapsed time and includes settings, H3 and rerun metadata in the fingerprint", async () => {
    const { result, confirmed } = await fixture();
    expect(await fingerprintDraftV2({ ...result, run: { ...result.run, elapsed_ms: 123, fingerprint: "a".repeat(64) } })).toBe(result.run.fingerprint);
    expect(await parseDraftResultV2({ ...result, run: { ...result.run, elapsed_ms: 123 } }, confirmed)).toMatchObject({ ok: true });
    expect(await fingerprintDraftV2({ ...result, settings: { ...settings, tone: "technical" } })).not.toBe(result.run.fingerprint);
    expect(await fingerprintDraftV2({ ...result, sections: [{ ...result.sections[0]!, h3: ["Edited"] }, result.sections[1]!] })).not.toBe(result.run.fingerprint);
  });

  it("validates later reruns without requiring a recursive previous chain", async () => {
    const { input, confirmed, result: previous } = await fixture();
    const first = await assembleDraftV2({ ...input, run: { ...initialRun, run_id: "rerun-first", budget_ms: SECTION_ENDPOINT_BUDGET_MS, rerun: { previous_run_id: previous.run.run_id, previous_fingerprint: previous.run.fingerprint, section_id: "O1" } } });
    if (!first.ok) throw new Error(first.path);
    const second = await assembleDraftV2({ ...input, run: { ...initialRun, run_id: "rerun-second", budget_ms: SECTION_ENDPOINT_BUDGET_MS, rerun: { previous_run_id: first.value.run.run_id, previous_fingerprint: first.value.run.fingerprint, section_id: "O2" } } });
    if (!second.ok) throw new Error(second.path);
    expect(await parseDraftResultV2(second.value, confirmed, first.value)).toMatchObject({ ok: true });
    for (const rerun of [
      { ...second.value.run.rerun!, section_id: "O99" }, { ...second.value.run.rerun!, previous_run_id: "rerun-second" },
    ]) expect(await parseDraftResultV2(await seal({ ...second.value, run: { ...second.value.run, rerun } }), confirmed)).toMatchObject({ ok: false });
  });

  it("rejects extra assembly inputs instead of silently removing fields before stamping", async () => {
    const { input } = await fixture();
    const extraInput = { ...input, extra: true };
    const extraCoverage = { ...input, coverage: { ...input.coverage, extra: true } };
    expect(await assembleDraftV2(extraInput)).toMatchObject({ ok: false });
    expect(await assembleDraftV2(extraCoverage)).toMatchObject({ ok: false });
  });
});
