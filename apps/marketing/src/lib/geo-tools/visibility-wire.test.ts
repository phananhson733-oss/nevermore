// @input -- maximum admitted offline runs and bounded structural evidence
// @output -- proof compact wire fits, retains every observation, and inflates exactly
// @pos -- pure portable/store size budget tests; no provider transport
import { describe, expect, it } from "vitest";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { createVisibilityReportV2, buildVisibilityPlan } from "./visibility-v2.ts";
import { VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";
import { budgetVisibilityReportV2, decodeVisibilityWire, encodeVisibilityWire, visibilityPlanFitsWireBudget, VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES } from "./visibility-wire.ts";
import type { VisibilitySampleV2 } from "./visibility-v2-contract.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
describe("normalized Visibility V2 wire", () => {
  it("stores each sample once and inflates the original full report", () => {
    const report = visibilityReportFixtureV2();
    const wire = encodeVisibilityWire(report);
    expect(wire).toMatchObject({ wireSchema: "marketing-geo-visibility-file.v2", manifest: report.manifest });
    expect(wire).not.toHaveProperty("aggregate");
    expect(wire).not.toHaveProperty("byEngine");
    expect(decodeVisibilityWire(wire)).toEqual(report);
  });

  it("rejects unknown wire fields and out-of-range references", () => {
    const wire = encodeVisibilityWire(visibilityReportFixtureV2());
    expect(decodeVisibilityWire({ ...wire, extra: true })).toBeNull();
    expect(decodeVisibilityWire({ ...wire, samples: [[999]] })).toBeNull();
  });

  it.each([42, 50])("keeps every slot and scalar metric for %i questions while fitting wire plus reserved site evidence", (questionCount) => {
    const seed = visibilityReportFixtureV2();
    const questions = Array.from({ length: questionCount }, (_, i) => ({ ...seed.questions[0]!.definition, id: `q${i}`, text: `Which analytics tools solve problem ${i}?` }));
    const engines = ["chatgpt", "perplexity"] as const;
    const input = { context: seed.context, questions, engines, samplesPerQuestion: 10 };
    expect(visibilityPlanFitsWireBudget(input)).toBe(true);
    const topics = Array.from({ length: 50 }, (_, i) => `${i} ${"界".repeat(118)}`.slice(0, 120));
    const hosts = Array.from({ length: 39 }, (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(45)}.test`);
    const ownUrl = `https://acme.test/${"x".repeat(2030)}`;
    const urls = [ownUrl, ...hosts.slice(0, 9).map((host) => `https://${host}/${"x".repeat(1900)}`)];
    const samples = buildVisibilityPlan(questions, engines, 10).map((slot): VisibilitySampleV2 => ({
      ...seed.questions[0]!.samples[0]!, engine: slot.engine, questionId: slot.question.id, sampleIndex: slot.sampleIndex, slotId: slot.slotId,
      modelRequested: VISIBILITY_ENGINE_CONFIG[slot.engine].modelRequested, providerTaskId: `task-${slot.slotId}`,
      mentioned: true, cited: true, citedDomains: ["acme.test", ...hosts], citedUrls: urls,
      excerpt: "界".repeat(240), answerExcerpt: "界".repeat(300), answerExcerptTruncated: true, subtopics: topics, subtopicsOmitted: 0,
    }));
    const original = createVisibilityReportV2({ ...seed.manifest, ...input, samples });
    expect(bytes(encodeVisibilityWire(original))).toBeGreaterThan(4 * 1024 * 1024);
    const bounded = budgetVisibilityReportV2(original);
    const wire = encodeVisibilityWire(bounded);
    expect(bytes(wire) + VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(bounded.questions.flatMap((q) => q.samples)).toHaveLength(questionCount * 20);
    expect(bounded.metrics).toEqual(original.metrics);
    expect(bounded.manifest).toEqual(original.manifest);
    for (const sample of bounded.questions.flatMap((q) => q.samples)) {
      expect(sample.citedUrls).toContain(ownUrl);
      expect(sample.citedDomains.length + sample.citedDomainsOmitted!).toBe(40);
      expect(sample.citedUrls.length + sample.citedUrlsOmitted!).toBe(10);
      expect(sample.subtopics!.length + sample.subtopicsOmitted!).toBe(50);
    }
    expect(parseVisibilityReportV2(bounded) !== null).toBe(true);
    expect(decodeVisibilityWire(wire) !== null).toBe(true);
    expect(budgetVisibilityReportV2(bounded)).toEqual(bounded);
  });

  it("refuses more than 1000 slots and metadata that cannot fit before provider work", () => {
    const seed = visibilityReportFixtureV2();
    const questions = Array.from({ length: 200 }, (_, i) => ({ ...seed.questions[0]!.definition, id: `q${i}`, text: "界".repeat(500), requiredEntities: Array.from({ length: 8 }, () => "界".repeat(200)) }));
    expect(visibilityPlanFitsWireBudget({ context: seed.context, questions, engines: ["chatgpt", "perplexity"], samplesPerQuestion: 10 })).toBe(false);
    expect(visibilityPlanFitsWireBudget({ context: seed.context, questions, engines: ["chatgpt"], samplesPerQuestion: 5 })).toBe(false);
  });
});
