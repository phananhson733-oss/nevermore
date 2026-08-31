// @input -- complete V2 reports and deliberately edited portable documents
// @output -- evidence that imports are bounded, untrusted and recomputed
// @pos -- offline portable report contract and question-paired comparison tests
import { describe, expect, it, vi } from "vitest";
import { createVisibilityReportV2, type VisibilityReportInputV2 } from "./visibility-v2.ts";
import { VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import type { VisibilitySampleV2 } from "./visibility-v2-contract.ts";
import { compareVisibilityReportsV2, exportVisibilityJson, parseVisibilityImport, parseVisibilityReportV2 } from "./visibility-export.ts";
import { decodeVisibilityWire } from "./visibility-wire.ts";

const question = (id: string): GeoQuestion => ({ id, text: `Which analytics tools solve ${id}?`, layer: "discovery", mode: "retrieval", roleId: null, requiredEntities: ["analytics"], templateId: null, calibrated: false });
const CONTEXT = { officialName: "Acme", aliases: [], targetHost: "acme.test", marketCode: "US", language: "en", competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }] } as const;
function report(overrides: Partial<VisibilityReportInputV2> = {}) {
  const questions = [question("q1"), question("q2")];
  const engines = ["chatgpt", "perplexity"] as const;
  const samples = engines.flatMap((engine) => questions.flatMap((q) => Array.from({ length: 3 }, (_, index): VisibilitySampleV2 => ({
    engine, slotId: `${engine}:${q.id}:${index + 1}`, questionId: q.id, sampleIndex: index + 1,
    modelRequested: VISIBILITY_ENGINE_CONFIG[engine].modelRequested, modelObserved: null, providerTaskId: null, listPosition: null,
    status: "ok", mentioned: q.id === "q1", cited: q.id === "q1", webSearchPerformed: true,
    citedDomains: q.id === "q1" ? ["acme.test"] : [], citedUrls: q.id === "q1" ? ["https://www.acme.test/docs"] : [],
    competitorsMentioned: [], excerpt: null, costUsd: 0.05, observedAt: new Date(Date.parse(overrides.startedAt ?? "2026-08-31T00:00:00.000Z") + 60_000).toISOString(),
    answerExcerpt: "Offline observed answer.", answerExcerptTruncated: false, subtopics: [], subtopicsOmitted: 0, competitorPositions: [], citedDomainsOmitted: 0, citedUrlsOmitted: 0, excerptOmitted: false,
  }))));
  return createVisibilityReportV2({
    runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3300", kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", snapshotRevision: 1, questionSetHash: "a".repeat(64),
    startedAt: "2026-08-31T00:00:00.000Z", finishedAt: "2026-08-31T00:02:00.000Z", context: CONTEXT,
    questions, samples, engines, samplesPerQuestion: 3, ...overrides,
  });
}
const current = (overrides: Partial<VisibilityReportInputV2> = {}) => report({ runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", startedAt: "2026-08-31T01:00:00.000Z", finishedAt: "2026-08-31T01:02:00.000Z", ...overrides });
function edited(mutate: (value: ReturnType<typeof report>) => unknown) { return mutate(structuredClone(report())); }

describe("portable visibility V2", () => {
  it("preserves a completed sampling report when independent site evidence is unavailable", () => {
    const source = report();
    expect(parseVisibilityReportV2({ ...source, limits: [...source.limits, "siteEvidenceUnavailable"] })).not.toBeNull();
  });
  it("round-trips the complete report only as imported_untrusted, never a server run", () => {
    const source = report();
    expect(parseVisibilityReportV2(source)).toEqual(source);
    expect(decodeVisibilityWire(JSON.parse(exportVisibilityJson(source)))).toEqual(source);
    expect(parseVisibilityImport(exportVisibilityJson(source))).toEqual({ ok: true, report: source, provenance: "imported_untrusted" });
  });

  it("rejects tampered derived metrics in every redundant projection", () => {
    for (const change of [
      (value: ReturnType<typeof report>) => ({ ...value, metrics: { ...value.metrics, questionsAsked: 99 } }),
      (value: ReturnType<typeof report>) => ({ ...value, aggregate: { ...value.aggregate, metrics: { ...value.metrics, questionsAsked: 99 } } }),
      (value: ReturnType<typeof report>) => ({ ...value, byEngine: value.byEngine.map((entry) => ({ ...entry, metrics: { ...entry.metrics, meanPosition: { value: 1, observations: 1 } } })) }),
      (value: ReturnType<typeof report>) => ({ ...value, questions: value.questions.map((entry) => ({ ...entry, mentioned: 99 })) }),
      (value: ReturnType<typeof report>) => ({ ...value, manifest: { ...value.manifest, costUsd: 0 } }),
    ]) expect(parseVisibilityReportV2(edited(change))).toBeNull();
  });

  it("rejects duplicate and out-of-plan slots rather than silently deduplicating imports", () => {
    const source = report();
    const first = source.questions[0]!;
    const duplicate = { ...source, questions: [{ ...first, samples: [...first.samples, first.samples[0]!] }, ...source.questions.slice(1)] };
    const wrongEngine = { ...source, questions: [{ ...first, samples: first.samples.map((sample) => ({ ...sample, slotId: "chatgpt:q1:99", sampleIndex: 99 })) }, ...source.questions.slice(1)] };
    expect(parseVisibilityReportV2(duplicate)).toBeNull();
    expect(parseVisibilityReportV2(wrongEngine)).toBeNull();
  });

  it("checks the UTF-8 ceiling before JSON.parse", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(parseVisibilityImport("界".repeat(1_500_000))).toEqual({ ok: false, code: "too_large" });
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });

  it("distinguishes invalid JSON and unsupported legacy schema without upgrading history", () => {
    expect(parseVisibilityImport("{")).toEqual({ ok: false, code: "invalid_json" });
    expect(parseVisibilityImport(JSON.stringify({ manifest: { schemaVersion: "marketing-geo-visibility.v1" } }))).toEqual({ ok: false, code: "unsupported_version" });
  });

  it("refuses unknown keys, noncanonical URLs and hosts, malformed identity and duplicate engine config", () => {
    const source = report();
    const first = source.questions[0]!;
    for (const invalid of [
      { ...source, trusted: true },
      { ...source, context: { ...source.context, targetHost: "www.acme.test" } },
      { ...source, manifest: { ...source.manifest, runId: "not-a-uuid" } },
      { ...source, manifest: { ...source.manifest, questionSetHash: "not-a-hash" } },
      { ...source, manifest: { ...source.manifest, engines: [source.manifest.engines[0], source.manifest.engines[0]] } },
      { ...source, questions: [{ ...first, samples: first.samples.map((sample) => ({ ...sample, citedUrls: ["https://user:secret@acme.test/docs"] })) }, ...source.questions.slice(1)] },
      { ...source, questions: [{ ...first, definition: { ...first.definition, unexpected: true } }, ...source.questions.slice(1)] },
    ]) expect(parseVisibilityReportV2(invalid)).toBeNull();
  });

  it("does not export an invalid report", () => {
    expect(() => exportVisibilityJson({ ...report(), limits: ["invented"] })).toThrow();
  });

  it("enforces the real 240-code-point excerpt ceiling, not a permissive UTF-16 ceiling", () => {
    const source = report();
    const samples = source.questions.flatMap((q) => q.samples).map((sample) => ({ ...sample, excerpt: sample.mentioned ? "x".repeat(241) : null }));
    expect(parseVisibilityReportV2(report({ samples }))).toBeNull();
  });

  it("accepts registry-generated dotted question IDs without rewriting frozen identity", () => {
    const questions = [question("q01-retrieval.category_top"), question("q02-retrieval.alternatives")];
    const samples = report().questions.flatMap((q, index) => q.samples.map((sample) => ({ ...sample, questionId: questions[index]!.id, slotId: `${sample.engine}:${questions[index]!.id}:${sample.sampleIndex}` })));
    expect(parseVisibilityReportV2(report({ questions, samples }))).not.toBeNull();
  });

  it("allows unknown observations and missing slots while retaining honest partial state", () => {
    const source = report();
    const samples = source.questions.flatMap((q) => q.samples).slice(1).map((sample) => ({ ...sample, webSearchPerformed: null, cited: null, citedDomains: [], citedUrls: [], citedDomainsOmitted: null, citedUrlsOmitted: null }));
    const partial = report({ samples });
    expect(partial.manifest.status).toBe("partial");
    expect(parseVisibilityReportV2(partial)).not.toBeNull();
  });

  it("rejects nested unknown keys and mutually impossible sample fields even if derived counts agree", () => {
    const source = report();
    const raw = source.questions.flatMap((q) => q.samples);
    const corruptions = [
      { extra: "not part of the contract" },
      { cited: null, citedDomains: ["acme.test"], citedUrls: [] },
      { mentioned: false, excerpt: "Acme is named here" },
      { status: "error", observedAt: "2026-08-31T00:01:00.000Z" },
      { providerTaskId: "x".repeat(121) },
      { modelObserved: "x".repeat(201) },
      { competitorsMentioned: ["Unconfirmed rival"] },
      { listPosition: 31 },
    ];
    for (const corruption of corruptions) {
      const samples = raw.map((sample, index) => index === 0 ? { ...sample, ...corruption } as VisibilitySampleV2 : sample);
      expect(parseVisibilityReportV2(report({ samples }))).toBeNull();
    }
  });

  it.each(["layer", "mode"] as const)("rejects array-coerced question %s even when metrics were recomputed", (field) => {
    const questions = [question("q1"), question("q2")].map((q) => ({ ...q, [field]: [q[field]] }) as unknown as GeoQuestion);
    expect(parseVisibilityReportV2(report({ questions }))).toBeNull();
  });

  it("rejects array-coerced failure status even when all failure placeholders are valid", () => {
    const samples = report().questions.flatMap((q) => q.samples).map((sample) => ({
      ...sample, status: ["error"], observedAt: null, webSearchPerformed: null,
      mentioned: false, cited: null, citedDomains: [], citedUrls: [], competitorsMentioned: [],
      answerExcerpt: null, answerExcerptTruncated: null, subtopics: null, subtopicsOmitted: null, competitorPositions: null, citedDomainsOmitted: null, citedUrlsOmitted: null,
    }) as unknown as VisibilitySampleV2);
    expect(parseVisibilityReportV2(report({ samples }))).toBeNull();
  });

  it("preserves duplicate required entities in historical frozen question definitions", () => {
    // Captured from the pre-quality-policy generator at 977f0bc4. New freezes
    // no longer emit this duplication; the portable reader must retain it.
    const questions: GeoQuestion[] = [{
      id: "q09-natural.jtbd_best_for_buyer", text: "What are the best analytics tools for founders?",
      layer: "problem", mode: "demand", roleId: "r1", requiredEntities: ["analytics", "analytics", "analytics"],
      templateId: "geo.natural.jtbd_best_for_buyer", calibrated: true,
    }, {
      id: "q10-natural.pain_current_workflow", text: "How do founders currently handle analytics, and which tools do they use?",
      layer: "problem", mode: "demand", roleId: "r1", requiredEntities: ["analytics", "analytics", "analytics"],
      templateId: "geo.natural.pain_current_workflow", calibrated: true,
    }];
    const source = report({ questions, samples: [] });
    expect(parseVisibilityReportV2(source)).not.toBeNull();
    expect(parseVisibilityImport(exportVisibilityJson(source))).toMatchObject({ ok: true, report: source });
    expect(source.questions[0]?.definition.requiredEntities).toEqual(["analytics", "analytics", "analytics"]);
  });

  it("rejects reusing one provider task as two distinct observation slots", () => {
    const samples = report().questions.flatMap((q) => q.samples).map((sample) => ({ ...sample, providerTaskId: "08311200-1234-0616-0000-abcdef012345" }));
    expect(parseVisibilityReportV2(report({ samples }))).toBeNull();
  });

  it("accepts optional rival aliases without adding a field to historical context", () => {
    const legacy = report();
    expect(parseVisibilityReportV2(legacy)?.context.competitors[0]).not.toHaveProperty("aliases");
    for (const aliases of [[], ["Beta Analytics", "Beta Cloud"]]) {
      const source = report({ context: { ...CONTEXT, competitors: [{ ...CONTEXT.competitors[0], aliases }] } });
      expect(parseVisibilityReportV2(source)).not.toBeNull();
      expect(parseVisibilityImport(exportVisibilityJson(source))).toMatchObject({ ok: true, report: source });
    }
    const tooMany = report({ context: { ...CONTEXT, competitors: [{ ...CONTEXT.competitors[0], aliases: Array.from({ length: 11 }, (_, index) => `Alias ${index}`) }] } });
    expect(parseVisibilityReportV2(tooMany)).toBeNull();
  });
});

describe("paired visibility V2 comparison", () => {
  it("counts questions once even when two engines each sampled them three times", () => {
    const result = compareVisibilityReportsV2(report(), current());
    expect(result.compatible).toBe(true);
    if (!result.compatible) return;
    expect(result.comparison.aggregates[0]).toMatchObject({ pairs: 2, testable: false, changed: false });
    const attached = { ...current(), comparison: result.comparison };
    expect(parseVisibilityImport(exportVisibilityJson(attached))).toMatchObject({ ok: true, provenance: "imported_untrusted" });
  });

  it("rejects an incompatible set, engine, locale, target, KB, or repeat count", () => {
    const base = report();
    const next = current();
    for (const incompatible of [
      { ...next, manifest: { ...next.manifest, questionSetHash: "b".repeat(64) } },
      current({ context: { ...CONTEXT, language: "zh-CN" } }),
      current({ context: { ...CONTEXT, marketCode: "GB" } }),
      current({ context: { ...CONTEXT, targetHost: "other.test" } }),
      current({ kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399" }),
      current({ engines: ["chatgpt"] }),
      current({ samplesPerQuestion: 5 }),
    ]) expect(compareVisibilityReportsV2(base, incompatible).compatible).toBe(false);
  });

  it("refuses insufficient baseline evidence and the same run as its own baseline", () => {
    expect(compareVisibilityReportsV2(report({ samples: [] }), current()).compatible).toBe(false);
    expect(compareVisibilityReportsV2(report(), report()).compatible).toBe(false);
  });

  it("refuses a changed actual model even when the requested model alias stayed the same", () => {
    const samples = (version: string) => report().questions.flatMap((q) => q.samples).map((sample) => ({ ...sample, modelObserved: `${sample.engine}-${version}` }));
    const base = report({ samples: samples("v1") });
    const next = current({ samples: samples("v2") });
    expect(parseVisibilityReportV2(base)).not.toBeNull();
    expect(parseVisibilityReportV2(next)).not.toBeNull();
    expect(compareVisibilityReportsV2(base, next)).toEqual({ compatible: false, reason: "incompatible_configuration" });
  });

  it("rejects edited comparison statistics and arbitrary comparison fields", () => {
    const result = compareVisibilityReportsV2(report(), current());
    expect(result.compatible).toBe(true);
    if (!result.compatible) return;
    for (const comparison of [
      { ...result.comparison, extra: true },
      { ...result.comparison, aggregates: result.comparison.aggregates.map((a) => ({ ...a, pairs: 12 })) },
      { ...result.comparison, aggregates: result.comparison.aggregates.map((a) => ({ ...a, changed: true })) },
      { ...result.comparison, aggregates: result.comparison.aggregates.map((a) => ({ ...a, current: { ...a.current, trials: 4 } })) },
    ]) expect(parseVisibilityReportV2({ ...current(), comparison })).toBeNull();
  });

  it("round-trips a genuinely testable paired change with twelve questions, not seventy-two samples", () => {
    const questions = Array.from({ length: 12 }, (_, index) => question(`question-${index}`));
    const templates = report().questions[1]!.samples;
    const before = questions.flatMap((q) => templates.map((sample) => ({ ...sample, questionId: q.id, slotId: `${sample.engine}:${q.id}:${sample.sampleIndex}` })));
    const after = before.map((sample) => ({ ...sample, mentioned: true, cited: true, citedDomains: ["acme.test"], citedUrls: ["https://acme.test/docs"] }));
    const base = report({ questions, samples: before }), next = current({ questions, samples: after });
    const result = compareVisibilityReportsV2(base, next);
    expect(result.compatible).toBe(true);
    if (!result.compatible) throw new Error("incompatible fixture");
    expect(result.comparison.aggregates[0]).toMatchObject({ pairs: 12, gained: 12, lost: 0, changed: true, testable: true });
    expect(parseVisibilityReportV2({ ...next, comparison: result.comparison })).not.toBeNull();
  });
  it("adds a recomputable conditional-SOV comparison with question pairs rather than answer replicas", () => {
    const questions = Array.from({ length: 12 }, (_, index) => question(`sov-${index}`));
    const templates = report().questions[1]!.samples;
    const before = questions.flatMap((q) => templates.map((sample) => ({ ...sample, questionId: q.id, slotId: `${sample.engine}:${q.id}:${sample.sampleIndex}`, competitorsMentioned: ["Rival"] })));
    const after = before.map((sample) => ({ ...sample, mentioned: true }));
    const base = report({ questions, samples: before }), next = current({ questions, samples: after });
    const compared = compareVisibilityReportsV2(base, next);
    expect(compared.compatible).toBe(true);
    if (!compared.compatible) throw new Error("incompatible fixture");
    expect(compared.comparison.shareOfVoice.comparison).toMatchObject({ point: 1, beforePoint: 0, afterPoint: 1, pairs: 12, method: "paired_question_cluster_hoeffding_ratio_95.v1", scope: "paired_observed_answers" });
    expect(parseVisibilityReportV2({ ...next, comparison: compared.comparison })).not.toBeNull();
    const invalid = { ...compared.comparison, shareOfVoice: { ...compared.comparison.shareOfVoice, comparison: { ...compared.comparison.shareOfVoice.comparison, pairs: 72 } } };
    expect(parseVisibilityReportV2({ ...next, comparison: invalid })).toBeNull();
  });
});
