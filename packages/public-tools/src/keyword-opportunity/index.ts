// @input  -- none
// @output -- the Keyword Opportunity Map surface, exported under a controlled subpath
// @pos    -- deliberately not re-exported from the package barrel: keeps provider code out of client bundles
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export * from "./types.ts";
export {
  keywordVolumeKey,
  resolveKeywordValidations,
  keywordValidationFor,
  hasMeasuredKeywordDemand,
} from "./validation.ts";
export type { KeywordOpportunityProviderRow } from "./validation.ts";
export {
  KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK,
  KEYWORD_OPPORTUNITY_UNSAMPLED,
  judgeKeywordWinnability,
  isKeywordWinnable,
} from "./winnability.ts";
export type { KeywordOpportunitySerpSample } from "./winnability.ts";
export {
  KEYWORD_COVERAGE_MIN_IMPRESSIONS,
  KEYWORD_COVERAGE_STRONG_POSITION,
  KEYWORD_COVERAGE_TOKEN_OVERLAP,
  keywordTokens,
  buildKeywordCoverageIndex,
  observeKeywordCoverage,
  isKeywordAlreadyCovered,
} from "./coverage.ts";
export { keywordCoverageProperty } from "./property.ts";
export type {
  KeywordCoverageObservation,
  KeywordCoveragePage,
  KeywordCoverageQueryRow,
} from "./coverage.ts";
export {
  KEYWORD_OPPORTUNITY_CHECKS,
  keywordNextChecks,
} from "./next-checks.ts";
export type { KeywordOpportunityCheckInput } from "./next-checks.ts";
export {
  KEYWORD_CLUSTER_JACCARD,
  clusterKeywords,
  keywordClusterIndex,
} from "./cluster.ts";
export {
  KEYWORD_OPPORTUNITY_MIN_ROWS,
  buildKeywordOpportunityResult,
  buildKeywordOpportunityPayload,
} from "./report.ts";
export type {
  KeywordOpportunityObservation,
  KeywordOpportunityReportInput,
} from "./report.ts";
