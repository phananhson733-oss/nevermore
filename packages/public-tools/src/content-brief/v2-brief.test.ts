import { describe, expect, it } from "vitest";
import * as brief from "./v2-brief.ts";
import { buildResearchBundle, validateResearchOutput } from "./v2-research.ts";
import type { ContentBriefV2 } from "./v2-generation-contract.ts";

function fixture(): { -readonly [K in keyof ContentBriefV2]: ContentBriefV2[K] } {
  const research = buildResearchBundle([], [{ id: "A1", question: "How do reporting delays work?", seed_question: null }]);
  if (!research.ok) throw new Error(research.path);
  const result = validateResearchOutput({ questions: [{ anchor: "U1", q: "How do reporting delays work?", sources: ["U1"] }], outline: [{ h2: "Reporting delays", h3: [], answers: ["U1"] }] }, research.value);
  if (!result.ok) throw new Error(result.path);
  return {
    schema: "gengrowth.content_brief/v2",
    context: {
      input: { primary: "reporting delays", supporting: [], market: "US", language: "en" },
      research: research.value, facts: [], profile_snapshot: null, candidates: [],
      gsc: { status: "unavailable", property: null, window: null, reason: "not_requested", matches: [], omitted_matches: 0 },
    },
    generated: {
      research: result.value,
      intent: { value: "informational", rationale: "The question asks about reporting." },
      format: { value: "guide", rationale: "Explain the reporting process." },
      page_plan: { action: "undecidable", rationale: "Existing site coverage has not been checked.", target_ref: null, steps: [] },
      gap_angle: null, internal_links: [], do_not_cover: [],
    },
    run: {
      run_id: "run-fixture", collected_at: "2026-08-31T01:00:00.000Z", elapsed_ms: 42, budget_ms: 45000,
      reads: [
        { source: "serp", status: "complete", attempted: 10, retained: 10, reason: null },
        { source: "paa", status: "complete", attempted: 1, retained: 1, reason: null },
        { source: "competitors", status: "unavailable", attempted: 0, retained: null, reason: "insufficient_evidence" },
        { source: "owned_pages", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
        { source: "gsc", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
        { source: "profile", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
      ],
      llm: { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0.2, temperature_effective: null, input_tokens: 200, output_tokens: 100 },
      serp_cost_usd: 0.004, prompt_bytes: 2048, fingerprint: "0".repeat(64),
    },
  };
}

async function sealed() {
  expect(brief.fingerprintBriefV2).toBeTypeOf("function");
  const value = fixture();
  value.run = { ...value.run, fingerprint: await brief.fingerprintBriefV2(value) };
  return value;
}

describe("whole v2 Brief and exact confirmed revision", () => {
  it("round-trips a PAA-only complete model result without claiming factual page coverage", async () => {
    const input = await sealed();
    expect(brief.parseContentBriefV2).toBeTypeOf("function");
    const result = await brief.parseContentBriefV2(input);
    expect(result).toEqual({ ok: true, value: input });
    if (!result.ok) throw new Error(result.path);
    expect(result.value).not.toBe(input);
    expect(result.value.generated?.research.questions[0]?.covered_by).toBe(0);
  });

  it("never confuses historical v1 or GEO JSON with v2", async () => {
    const input = await sealed();
    for (const schema of ["gengrowth.content_brief/v1", "marketing-geo-brief.v1"]) {
      expect(await brief.parseContentBriefV2({ ...input, schema })).toMatchObject({ ok: false, code: "brief_schema_mismatch" });
    }
  });

  it("fingerprints source reads, actual context, generated plan and PAA while excluding elapsed time", async () => {
    const input = await sealed();
    expect(await brief.parseContentBriefV2({ ...input, run: { ...input.run, elapsed_ms: 43 } })).toMatchObject({ ok: true });
    expect(await brief.parseContentBriefV2({ ...input, context: { ...input.context, input: { ...input.context.input, primary: "other topic" } } })).toMatchObject({ ok: false });
    expect(await brief.parseContentBriefV2({ ...input, generated: { ...input.generated!, format: { value: "guide", rationale: "A different editorial rationale." } } })).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch" });
  });

  it.each(["reads", "coverage", "calls", "prompt", "extra"])("rejects %s forgery even with a new fingerprint", async (kind) => {
    const original = fixture();
    const value = structuredClone(original);
    if (kind === "reads") value.run = { ...value.run, reads: value.run.reads.filter((read) => read.source !== "paa") };
    if (kind === "coverage") value.generated = { ...value.generated!, research: { ...value.generated!.research, questions: [{ ...value.generated!.research.questions[0]!, covered_by: 3 }] } };
    if (kind === "calls") value.run = { ...value.run, llm: { ...value.run.llm, calls: 2 } };
    if (kind === "prompt") value.run = { ...value.run, prompt_bytes: 49153 };
    const raw = kind === "extra" ? { ...value, unexpected: true } : value;
    value.run = { ...value.run, fingerprint: await brief.fingerprintBriefV2(raw) };
    expect(await brief.parseContentBriefV2(kind === "extra" ? { ...value, unexpected: true } : value)).toMatchObject({ ok: false });
  });

  it("preserves generation failure as unavailable, not an empty success", async () => {
    const input = fixture();
    input.generated = null;
    input.run = { ...input.run, llm: { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null } };
    input.run = { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) };
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: true, value: { generated: null } });
    expect(await brief.confirmBriefV2(input, { outline: [], revision: 1, confirmed_at: input.run.collected_at, resolution: "accept_recommendation" })).toMatchObject({ ok: false });
  });

  it("requires explicit new-page resolution when existing page ownership is unknown", async () => {
    const input = await sealed();
    const edits = { outline: input.generated!.research.outline, revision: 1, confirmed_at: input.run.collected_at, resolution: "accept_recommendation" as const };
    expect(await brief.confirmBriefV2(input, edits)).toMatchObject({ ok: false });
    expect(await brief.confirmBriefV2(input, { ...edits, resolution: "create_despite_uncertainty" })).toMatchObject({ ok: true });
  });

  it("keeps edited headings separate from the generated base and binds the exact revision", async () => {
    const input = await sealed();
    const outline = [{ ...input.generated!.research.outline[0]!, h2: "Check the reporting timeline" }];
    const confirmed = await brief.confirmBriefV2(input, { outline, revision: 2, confirmed_at: input.run.collected_at, resolution: "create_despite_uncertainty" });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.path);
    expect(confirmed.value.brief.generated?.research.outline[0]?.h2).toBe("Reporting delays");
    expect(confirmed.value.outline[0]?.h2).toBe("Check the reporting timeline");
    expect(await brief.parseConfirmedBriefV2(confirmed.value)).toEqual(confirmed);
    expect(await brief.parseConfirmedBriefV2({ ...confirmed.value, revision: 3 })).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch" });
    expect(await brief.parseConfirmedBriefV2({ ...confirmed.value, outline: input.generated!.research.outline })).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch" });
    expect(outline[0]?.h2).toBe("Check the reporting timeline");
  });

  it("refuses remapped questions, missing sections, duplicate IDs and blank/over-cap edited text", async () => {
    const input = await sealed();
    const section = input.generated!.research.outline[0]!;
    for (const outline of [[], [section, section], [{ ...section, id: "O99" }], [{ ...section, answers: ["Q2"] }], [{ ...section, h2: " " }], [{ ...section, h2: "𠀀".repeat(161) }]]) {
      expect(await brief.confirmBriefV2(input, { outline, revision: 1, confirmed_at: input.run.collected_at, resolution: "create_despite_uncertainty" })).toMatchObject({ ok: false });
    }
  });

  it("rejects oversized imports before recursive decoding", async () => {
    expect(await brief.parseContentBriefV2({ schema: "gengrowth.content_brief/v2", payload: "x".repeat(256 * 1024) })).toMatchObject({ ok: false });
    expect(await brief.parseConfirmedBriefV2({ schema: "gengrowth.confirmed_brief/v2", payload: "x".repeat(256 * 1024) })).toMatchObject({ ok: false });
  });

  it("keeps stable IDs and question mapping when the user changes section order", async () => {
    const input = fixture();
    const research = buildResearchBundle([], [{ id: "A1", question: "How do delays work?", seed_question: null }, { id: "A2", question: "How do I verify the date?", seed_question: null }]);
    if (!research.ok) throw new Error(research.path);
    const generated = validateResearchOutput({ questions: [
      { anchor: "U1", q: "How do delays work?", sources: ["U1"] }, { anchor: "U2", q: "How do I verify the date?", sources: ["U2"] },
    ], outline: [{ h2: "Delays", h3: [], answers: ["U1"] }, { h2: "Verify dates", h3: [], answers: ["U2"] }] }, research.value);
    if (!generated.ok) throw new Error(generated.path);
    input.context = { ...input.context, research: research.value };
    input.generated = { ...input.generated!, research: generated.value };
    input.run = { ...input.run, reads: input.run.reads.map((read) => read.source === "paa" ? { ...read, attempted: 2, retained: 2 } : read) };
    input.run = { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) };
    const confirmed = await brief.confirmBriefV2(input, { outline: [...generated.value.outline].reverse(), revision: 1, confirmed_at: input.run.collected_at, resolution: "create_despite_uncertainty" });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.path);
    expect(confirmed.value.outline.map(({ id, answers }) => ({ id, answers }))).toEqual([{ id: "O2", answers: ["Q2"] }, { id: "O1", answers: ["Q1"] }]);
  });

  it("does not permit complete PAA metadata to hide sampled omissions", async () => {
    const input = fixture();
    input.context = { ...input.context, research: { ...input.context.research, budget: { ...input.context.research.budget, paa_available: 2, paa_omitted: 1 } } };
    input.run = { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) };
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: false });
  });

  it("does not label truncated competitor research complete even when the model is unavailable", async () => {
    const input = fixture();
    const research = buildResearchBundle([{
      id: "C1", role: "competitor", url: "https://example.com/guide", final_url: "https://example.com/guide", fetched_at: input.run.collected_at,
      content_hash: "a".repeat(64), body_complete: false,
      research: { segments: [{ heading: null, text: "Some reporting evidence", truncated: true }], segments_total: 2, omitted_segments: 1, length: { value: 100, unit: "words", tokenizer: "whitespace" } },
    }], input.context.research.paa);
    if (!research.ok) throw new Error(research.path);
    input.context = { ...input.context, research: research.value };
    input.generated = null;
    input.run = { ...input.run, llm: { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null },
      reads: input.run.reads.map((read) => read.source === "competitors" ? { ...read, status: "complete", attempted: 1, retained: 1, reason: null } : read),
    };
    input.run = { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) };
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: false });
  });

  it.each([{ temperature_requested: 1 }, { temperature_effective: -1 }, { temperature_effective: 3 }, { input_tokens: 1e20 }])("rejects impossible fixed-run model metadata %#", async (fields) => {
    const input = fixture();
    input.run = { ...input.run, llm: { ...input.run.llm, ...fields } };
    input.run = { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) };
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: false });
  });
});
