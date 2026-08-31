import { describe, expect, it } from "vitest";
import { geoBriefFixture } from "./geo-fixtures.ts";
import { fingerprintCanonical } from "./canonical.ts";
import { parseContentBrief } from "./parse-brief.ts";
import { deriveGeoMustAnswer, geoFingerprint, parseGeoContentBrief } from "./parse-geo-brief.ts";

describe("GEO ContentBrief v1.1", () => {
  it("clusters case/whitespace-equivalent topics without erasing the original member heading", async () => {
    const brief = await geoBriefFixture(); brief.evidence.samples[1]!.topics = ["TEAM  SIZE"];
    Object.assign(brief, deriveGeoMustAnswer(brief.lead_answer, brief.evidence.samples));
    expect(brief.must_answer.items[1]).toMatchObject({ q: "Team size", covered_by: 2, cluster: { members: [{ heading: "Team size" }, { heading: "TEAM  SIZE" }] } });
    brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  });
  it("allows extra immutable KB requirements and repeated question ownership", async () => {
    const brief = await geoBriefFixture();
    brief.evidence.kb_requirements = [{ id: "fixture-scope", text: "Explain the supported scope." }];
    Object.assign(brief, deriveGeoMustAnswer(brief.lead_answer, brief.evidence.samples, brief.evidence.kb_requirements));
    if (brief.outline.status !== "available") throw new Error("fixture");
    brief.outline.items[1]!.answers = ["Q1", "Q2", "Q3"];
    brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  });
  it("keeps a typed manual question user_input rather than impersonating a frozen KB anchor", async () => {
    const brief = await geoBriefFixture();
    Object.assign(brief.geo_origin, { kind: "manual", run_ref: null, sample_refs: [], gap: null, question: { id: null, text: brief.keyword.primary } });
    brief.evidence.samples = [];
    brief.lead_answer.source = "user_input";
    brief.lead_answer.required_entities = [];
    Object.assign(brief, deriveGeoMustAnswer(brief.lead_answer, []));
    if (brief.outline.status !== "available") throw new Error("fixture");
    brief.outline.items = [brief.outline.items[0]];
    brief.outline.items[0].provenance.derived_from = ["kb", "user_input"];
    brief.format = { status: "available", value: "comparison", reason: "intent_derived", provenance: { method: "heuristic", origin: "kb" } };
    brief.draft_readiness.writable = ["O1"];
    brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  });
  it("accepts a complete GEO branch without manufacturing SEO evidence", async () => {
    const brief = await geoBriefFixture();
    expect(await parseGeoContentBrief(brief)).toEqual({ ok: true, value: brief });
    expect((await parseContentBrief(brief)).ok).toBe(false);
  });
  it("keeps the direct-answer requirement in the opening section", async () => {
    const brief = await geoBriefFixture(); if (brief.outline.status !== "available") throw new Error("fixture");
    brief.outline.items[0].answers = ["Q2"]; brief.outline.items[1]!.answers = ["Q1"];
    brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
  });
  it.each(["origin", "sample", "fact", "outline"])("fingerprint rejects changed %s bytes", async (field) => {
    const brief = await geoBriefFixture();
    if (field === "origin") brief.geo_origin.role = "different";
    if (field === "sample") brief.evidence.samples[0]!.excerpt = "changed";
    if (field === "fact") brief.evidence.facts[0]!.observed_at = "2026-08-29T00:00:00.000Z";
    if (field === "outline" && brief.outline.status === "available") brief.outline.items[0].h2 = "changed";
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false });
  });
  it.each(["missing_q1", "q1_rewritten", "uncovered", "unknown_sample", "inflated_coverage", "fact_laundering", "manual_run", "wrong_format", "unknown_key"])("rejects %s even after rehashing", async (problem) => {
    const brief = await geoBriefFixture();
    if (problem === "missing_q1") brief.must_answer.items.shift();
    if (problem === "q1_rewritten") brief.must_answer.items[0]!.q = "Model invention";
    if (problem === "uncovered" && brief.outline.status === "available") brief.outline.items.pop();
    if (problem === "unknown_sample") brief.must_answer.items[1]!.cluster.members[0]!.sample_id = "S99";
    if (problem === "inflated_coverage") brief.must_answer.items[1]!.covered_by = 99;
    if (problem === "fact_laundering") brief.fact_table[0]!.evidence_refs = ["S1"];
    if (problem === "manual_run") brief.geo_origin.kind = "manual";
    if (problem === "wrong_format" && brief.format.status === "available") brief.format.value = "guide";
    if (problem === "unknown_key") Object.assign(brief, { fabricated_serp: [] });
    const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
    brief.run.fingerprint = await fingerprintCanonical({ ...brief, run });
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
  });
  it("does not omit a successful member to understate observed topic coverage", async () => {
    const brief = await geoBriefFixture();
    brief.must_answer.items[1]!.cluster.members.pop();
    brief.must_answer.items[1]!.covered_by = 1;
    const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
    brief.run.fingerprint = await fingerprintCanonical({ ...brief, run });
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
  });
  it("excludes failures from coverage denominators while preserving planned samples", async () => {
    const brief = await geoBriefFixture();
    brief.evidence.samples.push({ ...brief.evidence.samples[0]!, id: "S3", status: "failed", excerpt: "", topics: [] });
    brief.geo_origin.sample_refs.push("S3");
    const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
    brief.run.fingerprint = await fingerprintCanonical({ ...brief, run });
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    brief.must_answer.items[1]!.sample_total = 3;
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
  });
  it("does not hide eligible topics when the eight-item display cap has not been reached", async () => {
    const brief = await geoBriefFixture();
    brief.evidence.samples[0]!.topics.push("Price");
    brief.budget.must_answer_candidates = 3;
    brief.budget.must_answer_hidden = 1;
    const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
    brief.run.fingerprint = await fingerprintCanonical({ ...brief, run });
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
  });
});
