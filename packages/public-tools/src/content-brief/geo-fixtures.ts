// @input -- none; deterministic synthetic fixtures for offline contract tests only
// @output -- a complete GEO brief using reserved example domains and explicit fixture IDs
// @pos -- test helper, never provider or production evidence
import { fingerprintCanonical } from "./canonical.ts";
import { GEO_CONTENT_BRIEF_SCHEMA, type GeoContentBrief } from "./geo-contract.ts";
import type { DraftResult } from "./contract.ts";
import { assembleDraftResult, aggregateSectionLlm } from "./draft-assemble.ts";
import { sectionEvidenceFor } from "./parse-draft.ts";
import { validateSectionOutput } from "./validate-section.ts";
import { DRAFT_TOTAL_BUDGET_MS } from "./constants.ts";

export async function geoBriefFixture(): Promise<GeoContentBrief> {
  const ref = { kb_id: "fixture-kb", snapshot_id: "fixture-snapshot", revision: 1, content_hash: "a".repeat(64) };
  const brief: GeoContentBrief = {
    schema: GEO_CONTENT_BRIEF_SCHEMA, source: "geo",
    run: { run_id: "fixture-brief", collected_at: "2026-08-31T00:00:00.000Z", elapsed_ms: 0, budget_ms: 90000, fingerprint: "" },
    keyword: { primary: "Which fixture tool fits a small team?", supporting: [], market: "US", language: "en" },
    geo_origin: { kind: "visibility", question: { id: "fixture-question", text: "Which fixture tool fits a small team?" }, role: "buyer", layer: "comparison", gap: "D", run_ref: { id: "fixture-visibility", fingerprint: "b".repeat(64) }, sample_refs: ["S1", "S2"], kb_ref: ref, promptset_ref: { schema: "fixture-promptset/v1", registry_version: "fixture-1", hash: "c".repeat(64) }, profile_ref: null },
    evidence: {
      kb_requirements: [],
      samples: ["S1", "S2"].map(id => ({ id, run_id: "fixture-visibility", question_id: "fixture-question", engine: "chatgpt", collected_at: "2026-08-30T00:00:00.000Z", status: "answered", search_enabled: null, excerpt: "Synthetic fixture answer, not product evidence.", topics: ["Team size"] })),
      facts: [{ id: "K1", source: "kb", text: "The fixture tool supports three seats.", observed_at: "2026-08-30T00:00:00.000Z", url: null }],
      site_index: [{ id: "I1", url: "https://fixture.example/about", title: "About", observed_at: "2026-08-30T00:00:00.000Z" }],
    },
    lead_answer: { question_id: "Q1", requirement: "Answer the selected buyer question directly.", required_entities: ["fixture tool"], source: "kb", fact_refs: ["K1"] },
    must_answer: { status: "available", items: [
      { id: "Q1", q: "Answer the selected buyer question directly.", source: "kb", cluster: { canonical_heading: "Answer the selected buyer question directly.", members: [] }, covered_by: 0, sample_total: 2 },
      { id: "Q2", q: "Team size", source: "ai_sample", cluster: { canonical_heading: "Team size", members: ["S1", "S2"].map(sample_id => ({ sample_id, heading: "Team size" })) }, covered_by: 2, sample_total: 2 },
    ] },
    fact_table: [{ id: "F1", label: "Seats", value: "The fixture tool supports three seats.", reason: null, evidence_refs: ["K1"] }, { id: "F2", label: "Price", value: null, reason: "missing", evidence_refs: [] }],
    outline: { status: "available", items: [ { id: "O1", h2: "Direct answer", h3: [], answers: ["Q1"], provenance: { method: "model", derived_from: ["kb", "ai_sample"] } }, { id: "O2", h2: "Team-size comparison", h3: [], answers: ["Q2"], provenance: { method: "model", derived_from: ["kb", "ai_sample"] } } ] },
    intent: { status: "available", value: "commercial", provenance: { method: "heuristic", origin: "kb" } },
    format: { status: "available", value: "comparison", reason: "gap_d_comparison", provenance: { method: "heuristic", origin: "ai_sample" } },
    verdict: { action: "undecidable", reason: "geo_not_serp", provenance: null },
    length: { status: "unavailable", reason: "insufficient_evidence", attempted: 0 },
    gap_angle: { status: "unavailable", reason: "not_requested", attempted: 0 },
    internal_links: { status: "available", items: [{ page_ref: "I1", why: "Owner-site context", source: "site_index" }] },
    do_not_cover: { status: "unavailable", reason: "not_requested", attempted: 0 },
    budget: { outline_cap: 10, must_answer_cap: 8, must_answer_candidates: 2, must_answer_shown: 2, must_answer_hidden: 0 },
    draft_readiness: { writable: ["O1", "O2"], gaps: ["missing_facts"] },
  };
  const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
  brief.run.fingerprint = await fingerprintCanonical({ ...brief, run });
  return brief;
}

export async function geoDraftFixture(supplied?: GeoContentBrief): Promise<DraftResult> {
  const brief = supplied ?? await geoBriefFixture();
  const settings = { tone: "explanatory", person: "second", product_mention: "throughout" } as const;
  const sections: DraftResult["sections"] = [];
  if (brief.outline.status !== "available") throw new Error("fixture needs an outline");
  for (const outline of brief.outline.items) {
    const checked = validateSectionOutput({ paragraphs: [{ sentences: [{ text: "The fixture tool supports three seats.", claim: "bound", evidence_refs: ["K1"] }] }] }, sectionEvidenceFor(brief, outline.id, settings));
    if (!checked.ok) throw new Error(checked.rule);
    sections.push({ id: outline.id, h2: outline.h2, answers: outline.answers, status: "ok", body: { paragraphs: checked.paragraphs, word_count: checked.word_count }, llm: { attempts: 1, input_tokens: 10, output_tokens: 10 } });
  }
  const calls = sections.map(() => ({ status: "ok" as const, attempts: 1, fail_reason: null, model_id: "fixture-model", temperature_requested: 0.4, temperature_effective: null, input_tokens: 10, output_tokens: 10 }));
  return assembleDraftResult({ run: { run_id: "fixture-draft", reran_from: null, collected_at: "2026-08-31T00:00:01.000Z", elapsed_ms: 1000, budget_ms: DRAFT_TOTAL_BUDGET_MS }, brief, settings, sections, coverage: { status: "available", items: brief.must_answer.items.map(question => ({ question_id: question.id, status: "covered", covered_in: sections.find(section => section.answers.includes(question.id))!.id, gap: null, method: "model", cause: null })), total: brief.must_answer.items.length, covered: brief.must_answer.items.length, partial: 0, none: 0, provenance: { method: "model", derived_from: [] } }, llmSections: aggregateSectionLlm(calls, 0.4), llmCoverage: { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0, temperature_effective: null, input_tokens: 10, output_tokens: 10 } });
}
