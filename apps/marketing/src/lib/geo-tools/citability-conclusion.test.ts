import { describe, expect, it } from "vitest";
import {
  citabilityCheck,
  type CitabilityCheck,
  type CitabilityInput,
} from "./citability-contract.ts";
import { buildCitabilityConclusion } from "./citability-conclusion.ts";
import { measureCitabilityRender } from "./citability-render.ts";
import { runCitabilityChecks } from "./citability-rules.ts";

const URL = "https://example.com/guide";
const QUESTION = "What is Saturn return?";
const CONTENT = `<p>Saturn return is a cycle for at least 27 years, according to the source.</p>
  <ul><li>Check the birth time.</li><li>Read the calculation method.</li><li>Review the limits.</li></ul>
  <p>${"The guide explains the assumptions and the calculation method. ".repeat(12)}</p>`;
const HTML = `<html><head><link rel="canonical" href="${URL}"></head><body><main>${CONTENT}</main></body></html>`;

function fixture(overrides: Partial<CitabilityInput> = {}) {
  const input: CitabilityInput = {
    url: URL,
    finalUrl: URL,
    rawHtml: HTML,
    bodyComplete: true,
    robots: { status: "ok", text: "User-agent: *\nAllow: /\n" },
    llmsTxt: { status: "ok", bytes: 120 },
    targetQuestion: QUESTION,
    ...overrides,
  };
  const render = input.render ?? measureCitabilityRender({
    url: input.finalUrl,
    rawHtml: input.rawHtml,
    bodyComplete: input.bodyComplete,
  }, input.rawHtml);
  return {
    checks: runCitabilityChecks({ ...input, render }),
    render,
    targetQuestion: input.targetQuestion,
  };
}

function check(
  ruleId: string,
  state: CitabilityCheck["state"],
  kind: CitabilityCheck["kind"] = "deterministic",
  weight: CitabilityCheck["weight"] = "counted",
) {
  return citabilityCheck(ruleId, "readable", kind, weight, state,
    { key: "observed" }, state === "fail" ? { key: "review" } : undefined);
}

describe("citability conclusion", () => {
  it("reports no observed issues only within the completed applicable checks", () => {
    const input = fixture();
    expect(input.checks.filter((row) => row.weight === "counted" && row.state === "fail")).toEqual([]);

    expect(buildCitabilityConclusion(input)).toEqual({
      schemaVersion: "marketing-citability-conclusion.v1",
      verdict: "no_issues_observed",
      coverage: "complete",
      observedIssueCheckIds: [],
      reviewCheckIds: [],
      unknownCheckIds: [],
      notApplicableCheckIds: ["faqSchema"],
      advisoryCheckIds: ["robots.claudebot", "robots.gptbot", "robots.google-extended", "llmsTxt"],
      priorityCheckIds: [],
      limitations: ["not_citation_observation", "not_fact_verification", "limited_crawler_scope"],
    });
  });

  it("requires attention for measured retrieval-policy disallow without claiming citation absence", () => {
    const input = fixture({ robots: { status: "ok", text: "User-agent: OAI-SearchBot\nDisallow: /guide\n" } });
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "needs_attention", coverage: "complete",
      observedIssueCheckIds: ["robots.oai-searchbot"],
      reviewCheckIds: [], unknownCheckIds: [], priorityCheckIds: ["robots.oai-searchbot"],
    });
  });

  it("keeps a non-self canonical observation separate from claims about page intent", () => {
    const input = fixture({ rawHtml: HTML.replace(`href="${URL}"`, 'href="https://example.com/other"') });
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "needs_attention", observedIssueCheckIds: ["canonical"], priorityCheckIds: ["canonical"],
    });
    expect(input.checks.find((row) => row.ruleId === "canonical")?.measured).toMatchObject({
      key: "canonical.other", values: { href: "https://example.com/other" },
    });
  });

  it("asks for review when only an answer-pattern check fails", () => {
    const input = fixture({ targetQuestion: "What is the Jupiter orbit?" });
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "needs_review", coverage: "complete",
      observedIssueCheckIds: [], reviewCheckIds: ["leadAnswer"],
      unknownCheckIds: [], priorityCheckIds: ["leadAnswer"],
    });
  });

  it.each(["deterministic", "heuristic"] as const)("uses the declared %s rule kind rather than assuming cited-data authority", (kind) => {
    const result = buildCitabilityConclusion({ ...fixture(), checks: [check("citedData", "fail", kind)] });
    expect(result.verdict).toBe(kind === "deterministic" ? "needs_attention" : "needs_review");
    expect(result.observedIssueCheckIds).toEqual(kind === "deterministic" ? ["citedData"] : []);
    expect(result.reviewCheckIds).toEqual(kind === "heuristic" ? ["citedData"] : []);
  });

  it("does not let advisory failures change an otherwise completed conclusion", () => {
    const input = fixture({
      robots: { status: "ok", text: "User-agent: ClaudeBot\nDisallow: /\n" },
      llmsTxt: { status: "absent", httpStatus: 404 },
    });
    expect(input.checks.filter((row) => row.weight === "advisory" && row.state === "fail")).toHaveLength(2);
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "no_issues_observed", coverage: "complete",
      observedIssueCheckIds: [], reviewCheckIds: [], unknownCheckIds: [], priorityCheckIds: [],
    });
  });

  it("does not turn a missing optional target question into failed or incomplete collection", () => {
    const input = fixture({ targetQuestion: null });
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "no_issues_observed", coverage: "complete",
      notApplicableCheckIds: ["leadAnswer", "faqSchema"],
      limitations: ["not_citation_observation", "not_fact_verification", "limited_crawler_scope", "target_question_not_provided"],
    });
  });

  it("requires completion when robots policy could not be fetched", () => {
    const result = buildCitabilityConclusion(fixture({ robots: { status: "unreachable", httpStatus: 503 } }));
    expect(result).toMatchObject({
      verdict: "incomplete", coverage: "partial",
      observedIssueCheckIds: [], reviewCheckIds: [],
      unknownCheckIds: ["robots.oai-searchbot", "robots.chatgpt-user", "robots.perplexitybot"],
      priorityCheckIds: ["robots.oai-searchbot", "robots.chatgpt-user", "robots.perplexitybot"],
    });
    expect(result.limitations).toContain("checks_incomplete");
  });

  it.each(["unavailable", "partial"] as const)("keeps %s render evidence incomplete without synthesizing a ratio", (status) => {
    const render = measureCitabilityRender({ url: URL, rawHtml: HTML, bodyComplete: true },
      status === "unavailable" ? null : HTML,
      status === "unavailable" ? { reason: "not_configured" } : { renderedComplete: false });
    expect(render.status).toBe(status);
    expect(render.rawToRenderedRatio).toBeNull();
    const result = buildCitabilityConclusion(fixture({ render }));
    expect(result).toMatchObject({
      verdict: "incomplete", coverage: "partial", unknownCheckIds: ["ssr"], priorityCheckIds: ["ssr"],
    });
    expect(result.limitations).toContain("render_incomplete");
  });

  it("preserves a known deterministic failure alongside incomplete render evidence", () => {
    const rawHtml = HTML.replace(`href="${URL}"`, 'href="https://example.com/other"');
    const render = measureCitabilityRender({ url: URL, rawHtml, bodyComplete: true }, null);
    const result = buildCitabilityConclusion(fixture({ rawHtml, render }));
    expect(result).toMatchObject({
      verdict: "needs_attention", coverage: "partial",
      observedIssueCheckIds: ["canonical"], unknownCheckIds: ["ssr"], priorityCheckIds: ["ssr", "canonical"],
    });
  });

  it("preserves a known heuristic failure alongside incomplete collection", () => {
    const input = fixture({
      targetQuestion: "What is the Jupiter orbit?",
      render: measureCitabilityRender({ url: URL, rawHtml: HTML, bodyComplete: true }, null),
    });
    expect(buildCitabilityConclusion(input)).toMatchObject({
      verdict: "needs_review", coverage: "partial", reviewCheckIds: ["leadAnswer"], unknownCheckIds: ["ssr"],
    });
  });

  it("treats a measured empty rendered page as observed delivery failure, not unavailable", () => {
    const render = measureCitabilityRender({ url: URL, rawHtml: HTML, bodyComplete: true }, "<body></body>");
    expect(render.status).toBe("measured");
    expect(render.rawToRenderedRatio).toBeNull();
    expect(buildCitabilityConclusion(fixture({ render }))).toMatchObject({
      verdict: "needs_attention", coverage: "complete", observedIssueCheckIds: ["ssr"], unknownCheckIds: [],
    });
  });

  it.each([
    ["empty", []],
    ["all not applicable", [check("leadAnswer", "notApplicable"), check("faqSchema", "notApplicable")]],
    ["advisory only", [check("llmsTxt", "fail", "deterministic", "advisory")]],
  ] as const)("does not call an %s inventory issue-free", (_label, checks) => {
    const result = buildCitabilityConclusion({ ...fixture(), checks });
    expect(result).toMatchObject({ verdict: "incomplete", coverage: "partial", priorityCheckIds: [] });
    expect(result.limitations).toContain("no_applicable_checks");
  });

  it("orders and bounds priority links independently of input ordering, without duplicates", () => {
    const rows = [
      check("citedData", "fail", "heuristic"),
      check("leadAnswer", "fail", "heuristic"),
      check("faqSchema", "fail"),
      check("extractableStructure", "fail"),
      check("canonical", "fail"),
      check("ssr", "fetchError"),
      check("robots.oai-searchbot", "fail"),
      check("robots.oai-searchbot", "fail"),
      check("llmsTxt", "fail", "deterministic", "advisory"),
    ];
    const result = buildCitabilityConclusion({ ...fixture(), checks: rows });
    expect(result.priorityCheckIds).toEqual(["robots.oai-searchbot", "ssr", "canonical", "extractableStructure", "faqSchema"]);
    expect(result.observedIssueCheckIds.filter((id) => id === "robots.oai-searchbot")).toHaveLength(1);
  });

  it("does not mutate the checks or source render evidence", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    Object.freeze(input.checks);
    Object.freeze(input.render);
    buildCitabilityConclusion(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
