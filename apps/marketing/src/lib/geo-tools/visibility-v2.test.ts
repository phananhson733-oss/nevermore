import { describe, expect, it } from "vitest";
import type { GeoQuestion } from "./kb-questions.ts";
import type { GeoProviderClient } from "../agents/geo-provider.ts";
import { aggregateVisibilityV2, buildVisibilityPlan, createVisibilityReportV2, readVisibilityListPosition } from "./visibility-v2.ts";
import { observeVisibilityV2 } from "./visibility-sampling-v2.ts";
import { GeoProviderError } from "../agents/geo-provider.ts";
import type { VisibilitySampleV2 } from "./visibility-v2-contract.ts";

const question = (id: string, text = "Which analytics tools are best?"): GeoQuestion => ({ id, text, mode: "retrieval", layer: "discovery", roleId: null, requiredEntities: [], templateId: null, calibrated: false });
const context = { officialName: "Acme", aliases: [], targetHost: "acme.test", marketCode: "US", language: "en", competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }, { domain: "guess.test", brandName: "Guess", confirmed: false }] };
function sample(engine: "chatgpt" | "perplexity", questionId = "q1", sampleIndex = 1, extra: Partial<VisibilitySampleV2> = {}): VisibilitySampleV2 {
  const answered = extra.status === undefined || extra.status === "ok";
  return { engine, slotId: `${engine}:${questionId}:${sampleIndex}`, questionId, sampleIndex, modelRequested: engine === "chatgpt" ? "gpt-5-2025-08-07" : "sonar", modelObserved: null, providerTaskId: null, listPosition: null, status: "ok", mentioned: false, cited: false, webSearchPerformed: true, citedUrls: [], citedDomains: [], competitorsMentioned: [], excerpt: null, observedAt: "2026-08-31T00:00:00.000Z", costUsd: 0.05,
    answerExcerpt: answered ? "Offline observed answer." : null, answerExcerptTruncated: answered ? false : null, subtopics: answered ? [] : null, subtopicsOmitted: answered ? 0 : null, competitorPositions: answered ? [] : null,
    citedDomainsOmitted: !answered || extra.cited === null ? null : 0, citedUrlsOmitted: !answered || extra.cited === null ? null : 0, excerptOmitted: false, ...extra };
}

describe("multi-engine visibility v2", () => {
  it("uses the Artifact's conditional answer SOV, not a sum of brand mentions", () => {
    const result = aggregateVisibilityV2([question("q1")], Array.from({ length: 3 }, (_, i) => sample("chatgpt", "q1", i + 1, { mentioned: true, competitorsMentioned: ["Rival", "Other"] })), { ...context, competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }, { domain: "other.test", brandName: "Other", confirmed: true }], engines: ["chatgpt"], samplesPerQuestion: 3 });
    expect(result.aggregate.metrics.shareOfVoice.point).toBe(1);
  });
  it("reports prompt coverage as valid-answer questions over all frozen questions, even if the brand never appeared", () => {
    const result = aggregateVisibilityV2([question("q1"), question("q2")], [sample("chatgpt", "q1"), sample("chatgpt", "q2", 1, { status: "timeout", observedAt: null, cited: null, webSearchPerformed: null })], { ...context, engines: ["chatgpt"], samplesPerQuestion: 1 });
    expect(result.aggregate.metrics.promptCoverage).toMatchObject({ successes: 1, trials: 2, point: 0.5 });
    expect(result.aggregate.metrics.questionsMentioned.successes).toBe(0);
  });
  it("keeps actual planned/answered sample counts and genuine rank evidence per layer", () => {
    const result = aggregateVisibilityV2([question("q1"), { ...question("q2"), layer: "comparison" }], [sample("chatgpt", "q1", 1, { mentioned: true, listPosition: 2 }), sample("chatgpt", "q2", 1)], { ...context, engines: ["chatgpt"], samplesPerQuestion: 3 });
    expect(result.aggregate.metrics.byLayer[0]).toMatchObject({ layer: "discovery", plannedSamples: 3, answeredSamples: 1, meanPosition: { value: 2, observations: 1 } });
    expect(result.aggregate.metrics.byLayer[1]).toMatchObject({ layer: "comparison", meanPosition: { value: null, observations: 0 } });
  });
  it("freezes every engine/question/sample slot once and rejects duplicate engines/questions", () => {
    const plan = buildVisibilityPlan([question("q1"), question("q2")], ["chatgpt", "perplexity"], 3);
    expect(plan).toHaveLength(12);
    expect(new Set(plan.map((x) => x.slotId)).size).toBe(12);
    expect(plan[0]).toMatchObject({ engine: "chatgpt", question: { id: "q1" }, sampleIndex: 1, slotId: "chatgpt:q1:1" });
    expect(() => buildVisibilityPlan([question("q1")], ["chatgpt", "chatgpt"], 3)).toThrow();
    expect(() => buildVisibilityPlan([question("q1"), question("q1")], ["chatgpt"], 3)).toThrow();
    expect(() => buildVisibilityPlan(Array.from({ length: 200 }, (_, i) => question(`q${i}`)), ["chatgpt", "perplexity"], 3)).toThrow();
  });

  it("counts distinct engine slots without inventing searched/citation observations", () => {
    const result = aggregateVisibilityV2([question("q1")], [sample("chatgpt", "q1", 1, { mentioned: true, cited: true }), sample("perplexity", "q1", 1, { webSearchPerformed: null, cited: null })], { ...context, samplesPerQuestion: 1, engines: ["chatgpt", "perplexity"] });
    expect(result.calls).toBe(2);
    expect(result.answered).toBe(2);
    expect(result.status).toBe("ok");
    expect(result.aggregate.metrics.unpromptedMention).toMatchObject({ successes: 1, trials: 2 });
    expect(result.aggregate.metrics.citation).toMatchObject({ successes: 1, trials: 1 });
    expect(result.byEngine[1]?.metrics.citation.point).toBeNull();
    expect(result.aggregate.metrics.promptCoverage).toMatchObject({ successes: 1, trials: 1 });
    expect(result.aggregate.metrics.meanPosition).toEqual({ value: null, observations: 0 });
  });

  it("SOV is only the confirmed-brand subset and excludes prompts naming any tracked brand", () => {
    const questions = [question("q1"), question("q2", "Compare Rival with others"), { ...question("q3"), layer: "branded" as const }];
    const result = aggregateVisibilityV2(questions, [sample("chatgpt", "q1", 1, { mentioned: true, competitorsMentioned: ["Rival", "Rival", "Guess"], listPosition: 2 }), sample("chatgpt", "q2", 1, { mentioned: true }), sample("chatgpt", "q3", 1, { mentioned: true })], { ...context, samplesPerQuestion: 1, engines: ["chatgpt"] });
    expect(result.aggregate.metrics.shareOfVoice).toMatchObject({ ownAnswers: 1, anyBrandAnswers: 1, point: 1, confirmedCompetitorCount: 1, answered: 1, brandScope: "confirmed_brand_subset", scope: "observed_answers", clusters: 1, lo: null, hi: null, intervalReason: "fewer_than_10_question_clusters" });
    expect(result.aggregate.metrics.meanPosition).toEqual({ value: 2, observations: 1 });
  });

  it("never double counts duplicated or out-of-plan slots", () => {
    const input = [sample("chatgpt", "q1", 1, { mentioned: true }), sample("chatgpt", "q1", 1, { mentioned: true }), sample("perplexity")];
    const result = aggregateVisibilityV2([question("q1")], input, { ...context, engines: ["chatgpt"], samplesPerQuestion: 1 });
    expect(result.answered).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.status).toBe("partial");
    expect(result.aggregate.metrics.unpromptedMention.trials).toBe(1);
    expect(result.discardedSlots).toBe(2);
  });

  it("recognizes real numbered product entries, not incidental prose numbers", () => {
    expect(readVisibilityListPosition("1. **Rival** — reporting\n2. **Acme** — analytics", ["Acme"])).toBe(2);
    expect(readVisibilityListPosition("Acme has 2 integrations. It is useful.", ["Acme"])).toBeNull();
    expect(readVisibilityListPosition("1. **Rival** — unlike Acme\n2. **Other** — tools", ["Acme"])).toBeNull();
    expect(readVisibilityListPosition("7. **Acme** — tools", ["Acme"])).toBeNull();
    expect(readVisibilityListPosition("1. Read about Acme before making a decision\n2. Ask a qualified expert", ["Acme"])).toBeNull();
    expect(readVisibilityListPosition("1. **Evaluate Acme against your needs**\n2. **Read cancellation terms**", ["Acme"])).toBeNull();
  });
  it("does not count own aliases or own domain twice in the confirmed-brand subset", () => {
    const result = aggregateVisibilityV2([question("q1")], [sample("chatgpt", "q1", 1, { mentioned: true, competitorsMentioned: ["Acme App", "Our Other Name"] })], { ...context, aliases: ["Acme App"], competitors: [{ brandName: "Acme App", domain: "other.test", confirmed: true }, { brandName: "Our Other Name", domain: "acme.test", confirmed: true }], engines: ["chatgpt"], samplesPerQuestion: 1 });
    expect(result.aggregate.metrics.shareOfVoice).toMatchObject({ ownAnswers: 1, anyBrandAnswers: 1, confirmedCompetitorCount: 0 });
  });
  it("matches the sampler's normalized rival identity despite case-duplicate profile names", () => {
    const result = aggregateVisibilityV2([question("q1")], [sample("chatgpt", "q1", 1, { mentioned: false, competitorsMentioned: ["Rival"] })], { ...context, competitors: [{ brandName: "Rival", domain: "rival.test", confirmed: true }, { brandName: "RIVAL", domain: "rival2.test", confirmed: true }], engines: ["chatgpt"], samplesPerQuestion: 1 });
    expect(result.aggregate.metrics.shareOfVoice).toMatchObject({ ownAnswers: 0, anyBrandAnswers: 1, confirmedCompetitorCount: 1, point: 0 });
  });

  it("records alias-only competitor mentions under one confirmed brand identity", async () => {
    const enriched = { ...context, competitors: [
      { domain: "rival.test", brandName: "Rival", aliases: ["Beta Analytics", "Beta Cloud"], confirmed: true },
      { domain: "guess.test", brandName: "Guess", aliases: ["Ghost"], confirmed: false },
    ] };
    let calls = 0;
    const result = await observeVisibilityV2(enriched, buildVisibilityPlan([question("q1")], ["chatgpt"], 1)[0]!, { provider: { observe: async () => {
      calls++;
      return { answerText: "Beta Analytics and Beta Cloud are the same offering. Ghost is unconfirmed.", model: "gpt-5", webSearchPerformed: true, citations: [], citationsComplete: true, costUsd: 0.05, observedAt: "2026-08-31T00:00:00.000Z" };
    } } });
    expect(calls).toBe(1);
    expect(result.mentioned).toBe(false);
    expect(result.competitorsMentioned).toEqual(["Rival"]);
    expect(aggregateVisibilityV2([question("q1")], [result], { ...enriched, engines: ["chatgpt"], samplesPerQuestion: 1 }).aggregate.metrics.shareOfVoice).toMatchObject({ ownAnswers: 0, anyBrandAnswers: 1, confirmedCompetitorCount: 1 });
  });

  it("excludes prompts naming a confirmed competitor alias from SOV eligibility", () => {
    const enriched = { ...context, competitors: [{ domain: "rival.test", brandName: "Rival", aliases: ["Beta Cloud"], confirmed: true }] };
    const result = aggregateVisibilityV2([question("q1", "Compare Beta Cloud with other tools")], [sample("chatgpt", "q1", 1, { mentioned: true, competitorsMentioned: ["Rival"] })], { ...enriched, engines: ["chatgpt"], samplesPerQuestion: 1 });
    expect(result.aggregate.metrics.shareOfVoice).toMatchObject({ ownAnswers: 0, anyBrandAnswers: 0, answered: 0, point: null });
  });

  it("does not turn own aliases into rival mentions or count unconfirmed aliases", async () => {
    const enriched = { ...context, aliases: ["Acme Cloud"], competitors: [
      { domain: "rival.test", brandName: "Rival", aliases: ["Acme Cloud"], confirmed: true },
      { domain: "other.test", brandName: "Guess", aliases: ["Ghost"], confirmed: false },
    ] };
    const result = await observeVisibilityV2(enriched, buildVisibilityPlan([question("q1")], ["chatgpt"], 1)[0]!, { provider: { observe: async () => ({ answerText: "Acme Cloud and Ghost are mentioned.", model: "gpt-5", webSearchPerformed: true, citations: [], citationsComplete: true, costUsd: 0.05, observedAt: "2026-08-31T00:00:00.000Z" }) } });
    expect(result.competitorsMentioned).toEqual([]);
  });
  it("withholds an individually insufficient engine even when the mixed run is usable", () => {
    const rows = Array.from({ length: 5 }, (_, index) => sample("chatgpt", "q1", index + 1));
    const others = Array.from({ length: 5 }, (_, index) => sample("perplexity", "q1", index + 1, index < 2 ? {} : { status: "timeout", cited: null, webSearchPerformed: null, observedAt: null }));
    const result = aggregateVisibilityV2([question("q1")], [...rows, ...others], { ...context, engines: ["chatgpt", "perplexity"], samplesPerQuestion: 5 });
    expect(result.status).toBe("partial");
    expect(result.byEngine[1]).toMatchObject({ status: "insufficient", calls: 5, answered: 2, successRatio: 0.4 });
  });

  it("runs the real judging pipeline with engine identity and provider evidence, once per call", async () => {
    const calls: unknown[] = [];
    const provider: GeoProviderClient = { observe: async (input) => {
      calls.push(input);
      return { answerText: "1. **Rival** — reporting\n2. **Acme** — analytics", model: "sonar-observed", modelObserved: "sonar-observed", providerTaskId: "task-1", webSearchPerformed: null, citations: [], citationsComplete: true, costUsd: 0.07, observedAt: "2026-08-31T00:00:00.000Z" };
    } };
    const item = buildVisibilityPlan([question("q1")], ["perplexity"], 1)[0]!;
    const result = await observeVisibilityV2(context, item, { provider });
    expect(calls).toEqual([{ engine: "perplexity", prompt: "Which analytics tools are best?", model: "sonar", marketCode: "US" }]);
    expect(result).toMatchObject({ engine: "perplexity", slotId: "perplexity:q1:1", mentioned: true, listPosition: 2, webSearchPerformed: null, modelRequested: "sonar", modelObserved: "sonar-observed", providerTaskId: "task-1", costUsd: 0.07 });
    expect(result.competitorPositions).toEqual([{ brandName: "Rival", position: 1 }]);
  });

  it("retains answer context and all structural topics even without a brand mention", async () => {
    const answer = `${"Introductory context without the target name. ".repeat(12)}\n## Pricing\n## Data coverage\n## Integration requirements`;
    const result = await observeVisibilityV2(context, buildVisibilityPlan([question("q1")], ["chatgpt"], 1)[0]!, { provider: { observe: async () => ({ answerText: answer, model: "gpt-5", webSearchPerformed: true, citations: [], citationsComplete: true, costUsd: 0.05, observedAt: "2026-08-31T00:00:00.000Z" }) } });
    expect(result.mentioned).toBe(false);
    expect(result.excerpt).toBeNull();
    expect(result.answerExcerpt).toHaveLength(300);
    expect(result.answerExcerptTruncated).toBe(true);
    expect(result.subtopics).toEqual(["Pricing", "Data coverage", "Integration requirements"]);
    expect(result.subtopicsOmitted).toBe(0);
    expect(result.competitorPositions).toEqual([]);
  });
  it("books one failed bill without retry and reports missing total cost as unavailable", async () => {
    let calls = 0;
    const item = buildVisibilityPlan([question("q1")], ["perplexity"], 1)[0]!;
    const failed = await observeVisibilityV2(context, item, { provider: { observe: async () => { calls++; throw new GeoProviderError("network_error", "lost response", 0.06); } } });
    expect(calls).toBe(1);
    expect(failed).toMatchObject({ status: "error", costUsd: 0.06, modelObserved: null, providerTaskId: null, listPosition: null, webSearchPerformed: null, cited: null });
    expect(failed).toMatchObject({ answerExcerpt: null, answerExcerptTruncated: null, subtopics: null, subtopicsOmitted: null, competitorPositions: null, citedDomainsOmitted: null, citedUrlsOmitted: null });
    const report = createVisibilityReportV2({ runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3300", kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", snapshotRevision: 1, questionSetHash: "a".repeat(64), startedAt: "2026-08-31T00:00:00.000Z", finishedAt: "2026-08-31T00:02:00.000Z", context, questions: [question("q1")], samples: [sample("chatgpt", "q1", 1, { costUsd: null }), failed], engines: ["chatgpt", "perplexity"], samplesPerQuestion: 1 });
    expect(report.manifest.costUsd).toBeNull();
    expect(report.manifest.costKnownCalls).toBe(1);
    expect(report.manifest).not.toHaveProperty("model");
    expect(report.manifest.engines).toHaveLength(2);
    expect(report.byEngine[1]?.questions[0]?.calibrated).toBe(false);
  });
});
