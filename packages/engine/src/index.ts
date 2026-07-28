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

export { findingTarget } from "./target.ts";
export type {
  FindingTargetRelation,
  FindingTargetKind,
  FindingTargetDefinition,
  FindingTargetDraftV1,
  FindingTargetDraft,
  FindingTargetConstructionMode,
  FindingTargetMember,
  ResolvedFindingTargetMember,
  UnresolvedFindingTargetMember,
} from "./target.ts";

export { DiagnosticContext } from "./context.ts";
export type {
  DiagnosticContextInput,
  ObservationView,
  ObservationLineageView,
  UrlObservationProjection,
  CoverageInput,
  DatasetAvailability,
} from "./context.ts";

export {
  GOVERNANCE_PROJECTION_VERSION,
  parseGovernanceProjectionV1,
} from "./governance.ts";
export type {
  GovernanceProjectionV1,
  GovernanceKeywordClusterV1,
  GovernanceKeywordFactV1,
  GovernanceKeywordOccurrenceRefV1,
  GovernanceKeywordMetricRefV1,
  GovernanceKeywordStatus,
  GovernanceKeywordQueryKind,
  GovernanceKeywordMappingDecision,
  GovernanceKeywordMappingReviewState,
  GovernanceCompetitorFactV1,
  GovernanceCompetitorOriginRefV1,
  GovernanceCompetitorReviewStatus,
  GovernanceCompetitorRelationship,
  GovernanceCompetitorAnalysisScope,
  GovernanceCompetitorOriginKind,
} from "./governance.ts";

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

export {
  mergeRunCandidates,
  findingKey,
  DivergentFindingTargetError,
} from "./merge.ts";
export type { MergedCandidate } from "./merge.ts";

export { derivePriority, LANE_WINDOW } from "./priority.ts";
export type {
  PriorityBand,
  RoadmapLane,
  ActionStatus,
  PriorityInput,
  PriorityResult,
} from "./priority.ts";

export { buildSummary, SUMMARY_ARG_KEYS } from "./summaries.ts";
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
export {
  competitorEntityIdFromSubjectRef,
  competitorEntitySubjectRef,
} from "./subject-ref.ts";

export {
  buildContentDecayMonitor,
  compareContentDecayAlerts,
  CONTENT_DECAY_MONITOR_VERSION,
  CONTENT_DECAY_RANK_THRESHOLD,
  CONTENT_DECAY_TRAFFIC_THRESHOLD,
  resolveContentDecayTimeZone,
} from "./content-decay-monitor.ts";
export type {
  ContentDecayAlert,
  ContentDecayAvailability,
  ContentDecayMonitor,
  ContentDecayObservationCandidate,
  ContentDecayPage,
  ContentDecayRankTrend,
  ContentDecaySnapshotCandidate,
  ContentDecayTimeZoneResolution,
  ContentDecayTrafficTrend,
  ContentDecayTrigger,
} from "./content-decay-monitor.ts";

// The 11-rule registry (`ALL_RULES`) is assembled in ./rules/index.ts once the
// rule modules land; re-exported here.
export {
  ALL_RULES,
  LEGACY_ALL_RULES,
  LEGACY_RULE_SET_VERSION,
  rulesForRuleSetVersion,
} from "./rules/index.ts";
