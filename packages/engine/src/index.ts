// @sf/engine public surface (spec §8, §9). Pure, replayable diagnostic logic.

export type {
  DiagnosticRule,
  RuleResult,
  RuleId,
  DiagnosticDomain,
  Dataset,
  DatasetRequirement,
  Severity,
  FindingCandidate,
  EvidenceDraft,
} from "./rule.ts";

export { DiagnosticContext } from "./context.ts";
export type {
  DiagnosticContextInput,
  ObservationView,
  CoverageInput,
  DatasetAvailability,
} from "./context.ts";

export { parseIcp, isEnglishProject } from "./icp.ts";
export type { EngineIcp, EngineConversion, CustomerModel } from "./icp.ts";

export {
  RULE_SET_VERSION,
  PROMPT_SET_VERSION,
  FINDING_REGISTRY,
} from "./registry.ts";
export type { FindingMeta } from "./registry.ts";

export { ACTION_TEMPLATES, resolveActionCopy } from "./action-templates.ts";
export type {
  ActionTemplate,
  ActionCopy,
  ArtifactType,
  Effort,
  Risk,
  ContentLocale,
} from "./action-templates.ts";

export { deriveConfidence, autoReviewState } from "./confidence.ts";
export type { Confidence, ConfidenceOptions } from "./confidence.ts";

export { mergeRunCandidates, findingKey } from "./merge.ts";
export type { MergedCandidate } from "./merge.ts";

export { derivePriority, LANE_WINDOW } from "./priority.ts";
export type {
  PriorityBand,
  RoadmapLane,
  ActionStatus,
  PriorityInput,
  PriorityResult,
} from "./priority.ts";

export { buildSummary } from "./summaries.ts";
export type { SummaryLocale } from "./summaries.ts";

export { runPipeline } from "./pipeline.ts";
export type {
  PipelineResult,
  RunFinding,
  RuleResultRecord,
  DiagnosticCoverage,
  FindingSummaryGenerationInput,
  GeneratedFindingSummary,
  FindingSummaryGenerator,
} from "./pipeline.ts";

export { ctrBenchmark, ctrThreshold } from "./util/ctr-benchmark.ts";
export { matchIntent, pageFieldBag, intentTokens } from "./util/intent-match.ts";
export { hasProofBlock, isProofBlock } from "./util/proof-block.ts";
export { isCommercialUrl, isPriorityUrl, priorityUrlSet } from "./util/page-role.ts";

// The 11-rule registry (`ALL_RULES`) is assembled in ./rules/index.ts once the
// rule modules land; re-exported here.
export { ALL_RULES } from "./rules/index.ts";
