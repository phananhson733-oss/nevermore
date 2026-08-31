import type { CitabilityCheck, CitabilityRenderEvidence } from "./citability-contract.ts";

/** A summary of observed checks, not an AI-citation probability or a fact check. */
export interface CitabilityConclusion {
  readonly schemaVersion: "marketing-citability-conclusion.v1";
  readonly verdict: "needs_attention" | "needs_review" | "no_issues_observed" | "incomplete";
  /** Completeness of applicable measured inputs, not universal crawler coverage. */
  readonly coverage: "complete" | "partial";
  readonly observedIssueCheckIds: readonly string[];
  readonly reviewCheckIds: readonly string[];
  readonly unknownCheckIds: readonly string[];
  readonly notApplicableCheckIds: readonly string[];
  /** All advisory rows remain discoverable without determining the verdict. */
  readonly advisoryCheckIds: readonly string[];
  readonly priorityCheckIds: readonly string[];
  readonly limitations: readonly CitabilityConclusionLimitation[];
}

export type CitabilityConclusionLimitation =
  | "not_citation_observation"
  | "not_fact_verification"
  | "limited_crawler_scope"
  | "target_question_not_provided"
  | "render_incomplete"
  | "checks_incomplete"
  | "no_applicable_checks";

const PRIORITY_ORDER = [
  "robots.oai-searchbot", "robots.chatgpt-user", "robots.perplexitybot",
  "ssr", "canonical", "extractableStructure", "faqSchema",
  "leadAnswer", "qualifiers", "citedData",
] as const;

/** Check states and kinds remain the authority; this projection never rewrites them. */
export function buildCitabilityConclusion(input: {
  readonly checks: readonly CitabilityCheck[];
  readonly render: CitabilityRenderEvidence;
  readonly targetQuestion: string | null;
}): CitabilityConclusion {
  const counted = input.checks.filter((check) => check.weight === "counted");
  const ids = (checks: readonly CitabilityCheck[]) => [...new Set(checks.map((check) => check.ruleId))];
  const observedIssueCheckIds = ids(counted.filter((check) => check.state === "fail" && check.kind === "deterministic"));
  const reviewCheckIds = ids(counted.filter((check) => check.state === "fail" && check.kind === "heuristic"));
  const unknownCheckIds = ids(counted.filter((check) => check.state === "fetchError"));
  const notApplicableCheckIds = ids(counted.filter((check) => check.state === "notApplicable"));
  const advisoryCheckIds = ids(input.checks.filter((check) => check.weight === "advisory"));
  const hasApplicableChecks = counted.some((check) => check.state !== "notApplicable");
  const renderComplete = input.render.status === "measured" && input.render.raw.complete && input.render.rendered?.complete === true;
  const coverage = renderComplete && unknownCheckIds.length === 0 && hasApplicableChecks ? "complete" : "partial";
  const verdict = observedIssueCheckIds.length > 0 ? "needs_attention"
    : reviewCheckIds.length > 0 ? "needs_review"
    : coverage === "partial" ? "incomplete" : "no_issues_observed";
  const actionableIds = new Set([...observedIssueCheckIds, ...reviewCheckIds, ...unknownCheckIds]);
  const limitations: CitabilityConclusionLimitation[] = ["not_citation_observation", "not_fact_verification", "limited_crawler_scope"];
  if (!input.targetQuestion?.trim()) limitations.push("target_question_not_provided");
  if (!renderComplete) limitations.push("render_incomplete");
  // The render limitation already explains an unknown SSR row. Other missing
  // inputs need a separate reminder rather than being hidden by that one gap.
  if (unknownCheckIds.some((id) => id !== "ssr" || renderComplete)) limitations.push("checks_incomplete");
  if (!hasApplicableChecks) limitations.push("no_applicable_checks");

  return {
    schemaVersion: "marketing-citability-conclusion.v1",
    verdict,
    coverage,
    observedIssueCheckIds,
    reviewCheckIds,
    unknownCheckIds,
    notApplicableCheckIds,
    advisoryCheckIds,
    priorityCheckIds: PRIORITY_ORDER.filter((id) => actionableIds.has(id)).slice(0, 5),
    limitations,
  };
}
