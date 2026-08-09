/**
 * Frozen, JSON-friendly governance facts supplied by the caller of the pure
 * diagnostic engine. This module deliberately has no DB, network, clock, or
 * contract-package dependency: a run freezes the facts once and replay parses
 * the exact same bytes.
 */

export const GOVERNANCE_PROJECTION_VERSION = "growth-governance.1.0.0";

export type GovernanceKeywordStatus =
  | "candidate"
  | "approved"
  | "excluded"
  | "parked";
export type GovernanceKeywordQueryKind =
  | "search_query"
  | "generative_query";
export type GovernanceKeywordMappingDecision =
  | "unassigned"
  | "existing_page"
  | "new_asset";
export type GovernanceKeywordMappingReviewState =
  | "unreviewed"
  | "confirmed";

export interface GovernanceKeywordOccurrenceRefV1 {
  readonly occurrenceId: string;
  readonly snapshotId: string | null;
  readonly observationId: string | null;
}

export interface GovernanceKeywordMetricRefV1 {
  readonly snapshotId: string;
  readonly observationId: string;
  readonly valuePointer: string;
}

export interface GovernanceKeywordFactV1 {
  readonly keywordEntityId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly revision: number;
  readonly status: GovernanceKeywordStatus;
  readonly queryKind: GovernanceKeywordQueryKind;
  readonly intent: string | null;
  readonly buyerStage: string | null;
  /** Exact current entity fact; it may be null or differ from its outer group. */
  readonly clusterKey: string | null;
  readonly mappingDecision: GovernanceKeywordMappingDecision;
  readonly mappedSitePageId: string | null;
  readonly mappingReviewState: GovernanceKeywordMappingReviewState;
  readonly lastSeenAt: string;
  readonly occurrenceRefs: readonly GovernanceKeywordOccurrenceRefV1[];
  /**
   * Exact metric lineage only. An empty array is correct when the freezer has
   * occurrence lineage but no separately projected metric lineage.
   */
  readonly metricRefs: readonly GovernanceKeywordMetricRefV1[];
}

export interface GovernanceKeywordClusterV1 {
  readonly clusterKey: string;
  /** Stable Topic identity is optional until the Topic authority is migrated. */
  readonly topicNodeId?: string;
  readonly topicModelRevision?: number;
  readonly keywords: readonly GovernanceKeywordFactV1[];
}

export type GovernanceCompetitorReviewStatus =
  | "candidate"
  | "approved"
  | "excluded";
export type GovernanceCompetitorRelationship =
  | "direct"
  | "indirect"
  | "status_quo"
  | "benchmark"
  | "publisher";
export type GovernanceCompetitorAnalysisScope =
  | "positioning"
  | "product_capability"
  | "keyword_gap"
  | "content"
  | "serp_visibility";
export type GovernanceCompetitorOriginKind =
  | "product_profile"
  | "csv_keyword_gap"
  | "manual"
  | "serp_overlap"
  | "ai_citation";

export interface GovernanceCompetitorOriginRefV1 {
  readonly occurrenceId: string;
  readonly originKind: GovernanceCompetitorOriginKind;
  readonly snapshotId: string | null;
  readonly observationId: string | null;
}

export interface GovernanceCompetitorFactV1 {
  readonly competitorEntityId: string;
  readonly domain: string;
  readonly reviewStatus: GovernanceCompetitorReviewStatus;
  readonly revision: number;
  readonly relationship: GovernanceCompetitorRelationship | null;
  readonly analysisScopes: readonly GovernanceCompetitorAnalysisScope[];
  readonly originRefs: readonly GovernanceCompetitorOriginRefV1[];
}

export interface GovernanceProjectionV1 {
  readonly projectionVersion: typeof GOVERNANCE_PROJECTION_VERSION;
  readonly keywordClusters: readonly GovernanceKeywordClusterV1[];
  readonly competitors: readonly GovernanceCompetitorFactV1[];
}

const KEYWORD_STATUSES = [
  "candidate",
  "approved",
  "excluded",
  "parked",
] as const satisfies readonly GovernanceKeywordStatus[];
const QUERY_KINDS = [
  "search_query",
  "generative_query",
] as const satisfies readonly GovernanceKeywordQueryKind[];
const MAPPING_DECISIONS = [
  "unassigned",
  "existing_page",
  "new_asset",
] as const satisfies readonly GovernanceKeywordMappingDecision[];
const MAPPING_REVIEW_STATES = [
  "unreviewed",
  "confirmed",
] as const satisfies readonly GovernanceKeywordMappingReviewState[];
const COMPETITOR_REVIEW_STATUSES = [
  "candidate",
  "approved",
  "excluded",
] as const satisfies readonly GovernanceCompetitorReviewStatus[];
const COMPETITOR_RELATIONSHIPS = [
  "direct",
  "indirect",
  "status_quo",
  "benchmark",
  "publisher",
] as const satisfies readonly GovernanceCompetitorRelationship[];
const COMPETITOR_ANALYSIS_SCOPES = [
  "positioning",
  "product_capability",
  "keyword_gap",
  "content",
  "serp_visibility",
] as const satisfies readonly GovernanceCompetitorAnalysisScope[];
const COMPETITOR_ORIGIN_KINDS = [
  "product_profile",
  "csv_keyword_gap",
  "manual",
  "serp_overlap",
  "ai_citation",
] as const satisfies readonly GovernanceCompetitorOriginKind[];

const MARKET_CODE = /^[A-Z]{2}$/u;
const NORMALIZED_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RFC3339_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const OBSERVATION_VALUE_POINTER = /^\/valueJson(?:\/(?:[^~/]|~0|~1)+)+$/u;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Strictly validate and canonically order an untrusted frozen projection.
 *
 * The return value is a fresh deep-frozen graph of plain objects and arrays.
 * Unknown fields and contradictory facts throw instead of being stripped or
 * silently repaired, so persisted manifests cannot hide producer drift.
 */
export function parseGovernanceProjectionV1(
  value: unknown,
): GovernanceProjectionV1 {
  const root = record(value, "governance");
  exactKeys(
    root,
    ["projectionVersion", "keywordClusters", "competitors"],
    [],
    "governance",
  );
  if (root["projectionVersion"] !== GOVERNANCE_PROJECTION_VERSION) {
    throw invalid(
      `governance.projectionVersion must equal "${GOVERNANCE_PROJECTION_VERSION}"`,
    );
  }

  const keywordEntityIds = new Set<string>();
  const keywordIdentities = new Set<string>();
  const keywordOccurrenceIds = new Set<string>();
  const clusterKeys = new Set<string>();
  const keywordClusters = array(root["keywordClusters"], "governance.keywordClusters")
    .map((item, index) =>
      parseKeywordCluster(
        item,
        `governance.keywordClusters[${index}]`,
        keywordEntityIds,
        keywordIdentities,
        keywordOccurrenceIds,
      ),
    )
    .sort((left, right) => compareAscii(left.clusterKey, right.clusterKey));
  for (const cluster of keywordClusters) {
    assertUnique(
      clusterKeys,
      cluster.clusterKey,
      "governance keyword clusterKey values must be unique",
    );
  }

  const competitorEntityIds = new Set<string>();
  const competitorDomains = new Set<string>();
  const competitorOriginIds = new Set<string>();
  const competitors = array(root["competitors"], "governance.competitors")
    .map((item, index) =>
      parseCompetitor(
        item,
        `governance.competitors[${index}]`,
        competitorEntityIds,
        competitorDomains,
        competitorOriginIds,
      ),
    )
    .sort(
      (left, right) =>
        compareAscii(left.domain, right.domain) ||
        compareAscii(left.competitorEntityId, right.competitorEntityId),
    );

  return deepFreeze({
    projectionVersion: GOVERNANCE_PROJECTION_VERSION,
    keywordClusters,
    competitors,
  });
}

function parseKeywordCluster(
  value: unknown,
  path: string,
  keywordEntityIds: Set<string>,
  keywordIdentities: Set<string>,
  keywordOccurrenceIds: Set<string>,
): GovernanceKeywordClusterV1 {
  const input = record(value, path);
  exactKeys(
    input,
    ["clusterKey", "keywords"],
    ["topicNodeId", "topicModelRevision"],
    path,
  );
  const clusterKey = boundedString(input["clusterKey"], `${path}.clusterKey`, 200);
  const hasTopicNodeId = Object.hasOwn(input, "topicNodeId");
  const hasTopicRevision = Object.hasOwn(input, "topicModelRevision");
  if (hasTopicNodeId !== hasTopicRevision) {
    throw invalid(
      `${path}.topicNodeId and ${path}.topicModelRevision must be supplied together`,
    );
  }
  const topicNodeId = hasTopicNodeId
    ? uuid(input["topicNodeId"], `${path}.topicNodeId`)
    : undefined;
  const topicModelRevision = hasTopicRevision
    ? positiveInteger(
        input["topicModelRevision"],
        `${path}.topicModelRevision`,
      )
    : undefined;
  const keywords = array(input["keywords"], `${path}.keywords`)
    .map((item, index) =>
      parseKeywordFact(
        item,
        `${path}.keywords[${index}]`,
        keywordEntityIds,
        keywordIdentities,
        keywordOccurrenceIds,
      ),
    )
    .sort(compareKeywordFacts);

  return {
    clusterKey,
    ...(topicNodeId === undefined
      ? {}
      : { topicNodeId, topicModelRevision: topicModelRevision! }),
    keywords,
  };
}

function parseKeywordFact(
  value: unknown,
  path: string,
  keywordEntityIds: Set<string>,
  keywordIdentities: Set<string>,
  keywordOccurrenceIds: Set<string>,
): GovernanceKeywordFactV1 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "keywordEntityId",
      "displayKeyword",
      "normalizedKeyword",
      "marketCode",
      "languageTag",
      "revision",
      "status",
      "queryKind",
      "intent",
      "buyerStage",
      "clusterKey",
      "mappingDecision",
      "mappedSitePageId",
      "mappingReviewState",
      "lastSeenAt",
      "occurrenceRefs",
      "metricRefs",
    ],
    [],
    path,
  );

  const keywordEntityId = uuid(
    input["keywordEntityId"],
    `${path}.keywordEntityId`,
  );
  assertUnique(
    keywordEntityIds,
    keywordEntityId,
    "governance keywordEntityId values must be unique",
  );
  const displayKeyword = boundedString(
    input["displayKeyword"],
    `${path}.displayKeyword`,
    500,
  );
  const normalizedKeyword = boundedString(
    input["normalizedKeyword"],
    `${path}.normalizedKeyword`,
    500,
  );
  if (normalizedKeyword !== normalizeKeywordIdentity(displayKeyword)) {
    throw invalid(
      `${path}.normalizedKeyword must equal the canonical displayKeyword identity`,
    );
  }
  const marketCode = boundedString(
    input["marketCode"],
    `${path}.marketCode`,
    2,
  );
  if (!MARKET_CODE.test(marketCode)) {
    throw invalid(`${path}.marketCode must be an uppercase ISO alpha-2 code`);
  }
  const languageTag = canonicalLanguageTag(
    input["languageTag"],
    `${path}.languageTag`,
  );
  const revision = nonnegativeInteger(input["revision"], `${path}.revision`);
  const status = enumValue(
    input["status"],
    KEYWORD_STATUSES,
    `${path}.status`,
  );
  const queryKind = enumValue(
    input["queryKind"],
    QUERY_KINDS,
    `${path}.queryKind`,
  );
  const intent = nullableBoundedString(input["intent"], `${path}.intent`, 100);
  const buyerStage = nullableBoundedString(
    input["buyerStage"],
    `${path}.buyerStage`,
    100,
  );
  const clusterKey = nullableBoundedString(
    input["clusterKey"],
    `${path}.clusterKey`,
    200,
  );
  const mappingDecision = enumValue(
    input["mappingDecision"],
    MAPPING_DECISIONS,
    `${path}.mappingDecision`,
  );
  const mappedSitePageId = nullableUuid(
    input["mappedSitePageId"],
    `${path}.mappedSitePageId`,
  );
  if (mappingDecision === "existing_page" && mappedSitePageId === null) {
    throw invalid(
      `${path}.mappedSitePageId is required for mappingDecision existing_page`,
    );
  }
  if (mappingDecision !== "existing_page" && mappedSitePageId !== null) {
    throw invalid(
      `${path}.mappedSitePageId must be null unless mappingDecision is existing_page`,
    );
  }
  const mappingReviewState = enumValue(
    input["mappingReviewState"],
    MAPPING_REVIEW_STATES,
    `${path}.mappingReviewState`,
  );
  const lastSeenAt = instant(input["lastSeenAt"], `${path}.lastSeenAt`);

  const occurrenceRefIds = new Set<string>();
  const occurrenceRefs = array(
    input["occurrenceRefs"],
    `${path}.occurrenceRefs`,
  )
    .map((item, index) =>
      parseKeywordOccurrenceRef(
        item,
        `${path}.occurrenceRefs[${index}]`,
        occurrenceRefIds,
        keywordOccurrenceIds,
      ),
    )
    .sort(compareKeywordOccurrenceRefs);
  if (occurrenceRefs.length === 0) {
    throw invalid(`${path}.occurrenceRefs must contain at least one exact ref`);
  }

  const metricRefIdentities = new Set<string>();
  const metricRefs = array(input["metricRefs"], `${path}.metricRefs`)
    .map((item, index) =>
      parseKeywordMetricRef(
        item,
        `${path}.metricRefs[${index}]`,
        metricRefIdentities,
      ),
    )
    .sort(compareKeywordMetricRefs);

  const identity = JSON.stringify([
    normalizedKeyword,
    marketCode,
    languageTag,
    queryKind,
  ]);
  assertUnique(
    keywordIdentities,
    identity,
    "governance canonical keyword identities must be unique",
  );

  return {
    keywordEntityId,
    displayKeyword,
    normalizedKeyword,
    marketCode,
    languageTag,
    revision,
    status,
    queryKind,
    intent,
    buyerStage,
    clusterKey,
    mappingDecision,
    mappedSitePageId,
    mappingReviewState,
    lastSeenAt,
    occurrenceRefs,
    metricRefs,
  };
}

function parseKeywordOccurrenceRef(
  value: unknown,
  path: string,
  localIds: Set<string>,
  globalIds: Set<string>,
): GovernanceKeywordOccurrenceRefV1 {
  const input = record(value, path);
  exactKeys(
    input,
    ["occurrenceId", "snapshotId", "observationId"],
    [],
    path,
  );
  const occurrenceId = uuid(
    input["occurrenceId"],
    `${path}.occurrenceId`,
  );
  assertUnique(
    localIds,
    occurrenceId,
    `${path}.occurrenceId values must be unique within one keyword`,
  );
  assertUnique(
    globalIds,
    occurrenceId,
    "governance keyword occurrenceId values must be unique",
  );
  const snapshotId = nullableUuid(
    input["snapshotId"],
    `${path}.snapshotId`,
  );
  const observationId = nullableUuid(
    input["observationId"],
    `${path}.observationId`,
  );
  if ((snapshotId === null) !== (observationId === null)) {
    throw invalid(
      `${path}.snapshotId and ${path}.observationId must be supplied together`,
    );
  }
  return { occurrenceId, snapshotId, observationId };
}

function parseKeywordMetricRef(
  value: unknown,
  path: string,
  identities: Set<string>,
): GovernanceKeywordMetricRefV1 {
  const input = record(value, path);
  exactKeys(
    input,
    ["snapshotId", "observationId", "valuePointer"],
    [],
    path,
  );
  const snapshotId = uuid(input["snapshotId"], `${path}.snapshotId`);
  const observationId = uuid(
    input["observationId"],
    `${path}.observationId`,
  );
  const valuePointer = boundedString(
    input["valuePointer"],
    `${path}.valuePointer`,
    500,
  );
  if (!OBSERVATION_VALUE_POINTER.test(valuePointer)) {
    throw invalid(
      `${path}.valuePointer must be a canonical /valueJson JSON pointer`,
    );
  }
  assertUnique(
    identities,
    JSON.stringify([snapshotId, observationId, valuePointer]),
    `${path} metric refs must be unique`,
  );
  return { snapshotId, observationId, valuePointer };
}

function parseCompetitor(
  value: unknown,
  path: string,
  competitorEntityIds: Set<string>,
  competitorDomains: Set<string>,
  competitorOriginIds: Set<string>,
): GovernanceCompetitorFactV1 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "competitorEntityId",
      "domain",
      "reviewStatus",
      "revision",
      "relationship",
      "analysisScopes",
      "originRefs",
    ],
    [],
    path,
  );
  const competitorEntityId = uuid(
    input["competitorEntityId"],
    `${path}.competitorEntityId`,
  );
  assertUnique(
    competitorEntityIds,
    competitorEntityId,
    "governance competitorEntityId values must be unique",
  );
  const domain = boundedString(input["domain"], `${path}.domain`, 253);
  if (domain !== domain.toLowerCase() || !NORMALIZED_DOMAIN.test(domain)) {
    throw invalid(`${path}.domain must be a normalized lowercase hostname`);
  }
  assertUnique(
    competitorDomains,
    domain,
    "governance competitor domains must be unique",
  );
  const reviewStatus = enumValue(
    input["reviewStatus"],
    COMPETITOR_REVIEW_STATUSES,
    `${path}.reviewStatus`,
  );
  const revision = nonnegativeInteger(input["revision"], `${path}.revision`);
  const relationship =
    input["relationship"] === null
      ? null
      : enumValue(
          input["relationship"],
          COMPETITOR_RELATIONSHIPS,
          `${path}.relationship`,
        );
  const analysisScopeSet = new Set<string>();
  const analysisScopes = array(
    input["analysisScopes"],
    `${path}.analysisScopes`,
  )
    .map((scope, index) => {
      const parsed = enumValue(
        scope,
        COMPETITOR_ANALYSIS_SCOPES,
        `${path}.analysisScopes[${index}]`,
      );
      assertUnique(
        analysisScopeSet,
        parsed,
        `${path}.analysisScopes values must be unique`,
      );
      return parsed;
    })
    .sort(compareAscii);
  if (
    reviewStatus === "approved" &&
    (relationship === null || analysisScopes.length === 0)
  ) {
    throw invalid(
      `${path} approved competitor requires a relationship and analysisScopes`,
    );
  }
  if (
    reviewStatus !== "approved" &&
    (relationship !== null || analysisScopes.length !== 0)
  ) {
    throw invalid(
      `${path} ${reviewStatus} competitor cannot carry an approved relationship or analysisScopes`,
    );
  }

  const localOriginIds = new Set<string>();
  const originRefs = array(input["originRefs"], `${path}.originRefs`)
    .map((item, index) =>
      parseCompetitorOriginRef(
        item,
        `${path}.originRefs[${index}]`,
        localOriginIds,
        competitorOriginIds,
      ),
    )
    .sort(compareCompetitorOriginRefs);
  if (originRefs.length === 0) {
    throw invalid(`${path}.originRefs must contain at least one exact ref`);
  }

  return {
    competitorEntityId,
    domain,
    reviewStatus,
    revision,
    relationship,
    analysisScopes,
    originRefs,
  };
}

function parseCompetitorOriginRef(
  value: unknown,
  path: string,
  localIds: Set<string>,
  globalIds: Set<string>,
): GovernanceCompetitorOriginRefV1 {
  const input = record(value, path);
  exactKeys(
    input,
    ["occurrenceId", "originKind", "snapshotId", "observationId"],
    [],
    path,
  );
  const occurrenceId = uuid(
    input["occurrenceId"],
    `${path}.occurrenceId`,
  );
  assertUnique(
    localIds,
    occurrenceId,
    `${path}.occurrenceId values must be unique within one competitor`,
  );
  assertUnique(
    globalIds,
    occurrenceId,
    "governance competitor origin occurrenceId values must be unique",
  );
  const originKind = enumValue(
    input["originKind"],
    COMPETITOR_ORIGIN_KINDS,
    `${path}.originKind`,
  );
  const snapshotId = nullableUuid(
    input["snapshotId"],
    `${path}.snapshotId`,
  );
  const observationId = nullableUuid(
    input["observationId"],
    `${path}.observationId`,
  );
  const hasCanonicalObservation =
    snapshotId !== null && observationId !== null;
  const requiresCanonicalObservation =
    originKind === "csv_keyword_gap" ||
    originKind === "serp_overlap" ||
    originKind === "ai_citation";
  if ((snapshotId === null) !== (observationId === null)) {
    throw invalid(
      `${path}.snapshotId and ${path}.observationId must be supplied together`,
    );
  }
  if (requiresCanonicalObservation && !hasCanonicalObservation) {
    throw invalid(
      `${path} ${originKind} origin requires snapshotId and observationId`,
    );
  }
  if (!requiresCanonicalObservation && hasCanonicalObservation) {
    throw invalid(
      `${path} ${originKind} origin cannot claim snapshotId or observationId`,
    );
  }
  return { occurrenceId, originKind, snapshotId, observationId };
}

function compareKeywordFacts(
  left: GovernanceKeywordFactV1,
  right: GovernanceKeywordFactV1,
): number {
  return (
    compareAscii(left.normalizedKeyword, right.normalizedKeyword) ||
    compareAscii(left.marketCode, right.marketCode) ||
    compareAscii(left.languageTag, right.languageTag) ||
    compareAscii(left.queryKind, right.queryKind) ||
    compareAscii(left.keywordEntityId, right.keywordEntityId)
  );
}

function compareKeywordOccurrenceRefs(
  left: GovernanceKeywordOccurrenceRefV1,
  right: GovernanceKeywordOccurrenceRefV1,
): number {
  return (
    compareAscii(left.snapshotId ?? "", right.snapshotId ?? "") ||
    compareAscii(left.observationId ?? "", right.observationId ?? "") ||
    compareAscii(left.occurrenceId, right.occurrenceId)
  );
}

function compareKeywordMetricRefs(
  left: GovernanceKeywordMetricRefV1,
  right: GovernanceKeywordMetricRefV1,
): number {
  return (
    compareAscii(left.snapshotId, right.snapshotId) ||
    compareAscii(left.observationId, right.observationId) ||
    compareAscii(left.valuePointer, right.valuePointer)
  );
}

function compareCompetitorOriginRefs(
  left: GovernanceCompetitorOriginRefV1,
  right: GovernanceCompetitorOriginRefV1,
): number {
  return (
    compareAscii(left.originKind, right.originKind) ||
    compareAscii(left.snapshotId ?? "", right.snapshotId ?? "") ||
    compareAscii(left.observationId ?? "", right.observationId ?? "") ||
    compareAscii(left.occurrenceId, right.occurrenceId)
  );
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeKeywordIdentity(keyword: string): string {
  return keyword
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalid(`${path} must be a plain JSON object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalid(`${path} must be an array`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw invalid(`${path} has unknown field "${key}"`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw invalid(`${path} is missing required field "${key}"`);
    }
  }
}

function boundedString(value: unknown, path: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.trim() !== value
  ) {
    throw invalid(`${path} must contain 1 to ${max} trimmed characters`);
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  path: string,
  max: number,
): string | null {
  return value === null ? null : boundedString(value, path, max);
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    throw invalid(`${path} must be a canonical lowercase UUID`);
  }
  return value;
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalid(`${path} must be a positive safe integer`);
  }
  return value as number;
}

function enumValue<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function canonicalLanguageTag(value: unknown, path: string): string {
  const languageTag = boundedString(value, path, 255);
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(languageTag)[0];
  } catch {
    throw invalid(`${path} must be a canonical BCP-47 language tag`);
  }
  if (canonical !== languageTag) {
    throw invalid(`${path} must be a canonical BCP-47 language tag`);
  }
  return languageTag;
}

function instant(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !RFC3339_INSTANT.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw invalid(`${path} must be an ISO 8601 date-time`);
  }
  return new Date(value).toISOString();
}

function assertUnique(
  set: Set<string>,
  identity: string,
  message: string,
): void {
  if (set.has(identity)) throw invalid(message);
  set.add(identity);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function invalid(message: string): TypeError {
  return new TypeError(`Invalid GovernanceProjectionV1: ${message}`);
}
