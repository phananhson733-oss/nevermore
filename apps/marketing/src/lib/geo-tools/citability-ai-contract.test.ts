import { describe, expect, it } from "vitest";
import { isCitabilityAiContext, isCitabilityAiModel, isCitabilityAiReview, matchesCitabilityAiModel, parseCitabilityAiModelAssessment, parseCitabilityAiReview } from "./citability-ai-contract.ts";

const dimensions = ["answer_relevance", "answer_clarity", "attribution_clarity"].map((id) => ({
  id, verdict: "needs_work", reason: "A limitation is visible in E1.", suggestion: "Clarify it.", evidenceIds: ["E1"],
}));
const assessment = { summary: "Model assessment of provided excerpts only.", dimensions };
const review = {
  schemaVersion: "citability-ai-review.v1", inputFingerprint: "a".repeat(64), rawSha256: "b".repeat(64),
  finalUrl: "https://example.com/", targetQuestion: "Question?", capturedAt: "2026-08-31T12:00:00.000Z",
  totalBodyChars: 4, includedBodyChars: 4, coverage: "full", excerpts: [{ id: "E1", text: "Text" }],
  provider: "dataforseo", requestedModel: "gpt-4.1-mini", actualModel: "gpt-4.1-mini-2025-04-14",
  providerTaskId: "task-1", observedAt: "2026-08-31T12:01:00.000Z", costUsd: null,
  inputTokens: null, outputTokens: null, factVerification: "not_performed", scope: "provided_excerpts",
  webSearch: false, assessmentKind: "model_assessment", ...assessment,
};

describe("strict citability AI contracts", () => {
  it.each(["gpt-4.1-mini-2029-99-99", "gpt-4.1-mini-2029-01-01", "gpt-4.1-mini-2025-02-30"])("rejects unapproved actual model %s at both guards and receipt boundary", (actualModel) => {
    expect(isCitabilityAiModel(actualModel)).toBe(false);
    expect(matchesCitabilityAiModel("gpt-4.1-mini", actualModel)).toBe(false);
    expect(isCitabilityAiReview({ ...review, actualModel })).toBe(false);
  });

  it("accepts only approved aliases and exact snapshots, without cross-family matches", () => {
    for (const alias of ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"]) {
      expect(isCitabilityAiModel(alias)).toBe(true);
      expect(isCitabilityAiModel(`${alias}-2025-04-14`)).toBe(true);
      expect(matchesCitabilityAiModel(alias, alias)).toBe(true);
      expect(matchesCitabilityAiModel(alias, `${alias}-2025-04-14`)).toBe(true);
      expect(matchesCitabilityAiModel(`${alias}-2025-04-14`, alias)).toBe(false);
    }
    expect(matchesCitabilityAiModel("gpt-4.1-mini", "gpt-4.1-nano-2025-04-14")).toBe(false);
    expect(matchesCitabilityAiModel("unknown", "unknown")).toBe(false);
  });

  it("accepts exactly the three model dimensions with known evidence IDs", () => {
    expect(parseCitabilityAiModelAssessment(JSON.stringify(assessment), ["E1"])).toEqual(assessment);
    expect(parseCitabilityAiReview(review)).toEqual(review);
    expect(isCitabilityAiReview(review)).toBe(true);
  });

  it.each([
    "", "not JSON", `\`\`\`json\n${JSON.stringify(assessment)}\n\`\`\``, `${JSON.stringify(assessment)} trailing`,
    JSON.stringify({ ...assessment, dimensions: dimensions.slice(0, 2) }),
    JSON.stringify({ ...assessment, dimensions: [dimensions[0], dimensions[0], dimensions[2]] }),
    JSON.stringify({ ...assessment, dimensions: dimensions.map((item) => ({ ...item, evidenceIds: ["E9"] })) }),
    JSON.stringify({ ...assessment, dimensions: dimensions.map((item) => ({ ...item, evidenceIds: [] })) }),
    JSON.stringify({ ...assessment, factVerification: "complete" }),
    JSON.stringify({ ...assessment, summary: "x".repeat(601) }),
    JSON.stringify({ ...assessment, dimensions: dimensions.map((item) => ({ ...item, verdict: ["clear"] })) }),
  ])("rejects incomplete, unsupported or ungrounded model output %#", (body) => {
    expect(parseCitabilityAiModelAssessment(body, ["E1"])).toBeNull();
  });

  it("permits insufficient evidence without references, but never unknown references", () => {
    const body = { ...assessment, dimensions: dimensions.map((item) => ({ ...item, verdict: "insufficient_evidence", evidenceIds: [], suggestion: null })) };
    expect(parseCitabilityAiModelAssessment(JSON.stringify(body), ["E1"])).toEqual(body);
    expect(parseCitabilityAiModelAssessment(JSON.stringify(body), [])).toBeNull();
  });

  it.each([
    { costUsd: -1 }, { inputTokens: 1.2 }, { outputTokens: Number.NaN },
    { webSearch: true }, { factVerification: "complete" }, { assessmentKind: "observed_fact" },
    { rawSha256: "bad" }, { actualModel: "" }, { coverage: "full", totalBodyChars: 99 },
    { includedBodyChars: 0 }, { excerpts: [{ id: "E1", text: "" }] },
    { targetQuestion: null }, { observedAt: "not a date" }, { provider: "openai" },
    { requestedModel: "gpt-4.1", actualModel: "gpt-4.1-mini" }, { surpriseFact: "verified true" },
    { observedAt: "2026-08-31T11:59:00.000Z" },
  ])("rejects malformed public receipts %#", (patch) => {
    expect(isCitabilityAiReview({ ...review, ...patch })).toBe(false);
  });

  it("does not coerce non-string check values into a valid context", () => {
    const input = { ...review, schemaVersion: "citability-ai-context.v1", question: "Question?",
      checks: [{ ruleId: "leadAnswer", state: "pass", kind: "heuristic" }] };
    expect(isCitabilityAiContext(input)).toBe(true);
    expect(isCitabilityAiContext({ ...input, checks: [{ ruleId: "leadAnswer", state: ["pass"], kind: "heuristic" }] })).toBe(false);
    expect(isCitabilityAiContext({ ...input, checks: [{ ruleId: "leadAnswer", state: "pass", kind: ["heuristic"] }] })).toBe(false);
  });

  it("rebuilds receipt excerpts instead of returning aliased external nested objects", () => {
    const input = { ...review, excerpts: [{ id: "E1", text: "Text", inventedFact: "verified" }] };
    const parsed = parseCitabilityAiReview(input);
    expect(parsed?.excerpts).toEqual([{ id: "E1", text: "Text" }]);
    input.excerpts[0].text = "Changed";
    expect(parsed?.excerpts[0].text).toBe("Text");
  });
});
