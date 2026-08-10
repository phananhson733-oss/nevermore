import { randomUUID } from "node:crypto";
import type {
  ApproveKeywordReviewSuggestionRequest,
  KeywordGovernanceCurrentProjection,
  KeywordReviewDecision,
  ReviewKeywordRequest,
} from "@sf/contracts";
import {
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
  MAX_POSTGRES_INTEGER_REVISION,
} from "@sf/contracts";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { DbTx } from "../client.ts";
import {
  canonicalUtcTimestamptz,
  isTimestamptzInstant,
} from "../instant.ts";
import {
  clientProjects,
  keywordEntities,
  keywordReviewDecisions,
  keywordReviewSuggestions,
  sitePages,
  topicModelRevisions,
  topicNodeRevisions,
} from "../schema.ts";
import {
  projectPredicate,
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";
import { MAX_KEYWORD_ENTITY_PAGE_SIZE } from "./keywords.ts";
import { acquireTopicGovernanceProjectWriterLock } from "./topic-models.ts";

/**
 * Automated keyword governance spans two repositories: the candidate read with
 * its immutable provider evidence lives next to the other keyword reads, while
 * the writer below consumes it. Re-exported here so one `@sf/db` import gives a
 * caller the complete automated-governance contract.
 */
export {
  MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
} from "./keywords.ts";
export type {
  AutoGovernanceCandidateReadOptions,
  AutoGovernanceCandidateRow,
  DiagnosticGovernanceLoad,
} from "./keywords.ts";

export type ReviewKeywordInput = ReviewKeywordRequest;
export type ApproveKeywordReviewSuggestionInput =
  ApproveKeywordReviewSuggestionRequest;

export interface KeywordGovernanceReviewedProjection {
  readonly projectId: string;
  readonly keywordId: string;
  readonly governanceRevision: number;
  readonly status: KeywordReviewDecision["status"];
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly clusterKey: string | null;
  readonly mappingDecision: KeywordReviewDecision["mappingDecision"];
  readonly mappedSitePageId: string | null;
  readonly mappingReviewState:
    KeywordReviewDecision["mappingReviewState"];
  readonly assignmentInvalidatedBy:
    KeywordReviewDecision["assignmentInvalidatedBy"];
  readonly earlierHistoryAvailable: boolean;
}

export interface CurrentKeywordGovernance {
  readonly decision: KeywordReviewDecision;
  readonly projection: KeywordGovernanceCurrentProjection;
  /**
   * Server-owned compatibility label. It is deliberately outside the strict
   * public decision/projection contracts, which identify a Topic by stable id
   * plus exact model revision.
   */
  readonly clusterKey: string | null;
  /** Exact JSON copy persisted under the database projection guard. */
  readonly reviewedProjection: KeywordGovernanceReviewedProjection;
}

export interface ReviewKeywordResult extends CurrentKeywordGovernance {
  readonly replayed: boolean;
}

/**
 * One Keyword Library cursor page. A caller asking for more than one page of
 * decision origins has lost its own page bound, which is exactly the mistake
 * this ceiling should surface instead of silently issuing a huge `IN` list.
 */
export const MAX_KEYWORD_DECISION_ORIGIN_BATCH = MAX_KEYWORD_ENTITY_PAGE_SIZE;

export type KeywordDecisionOrigin = KeywordReviewDecision["decisionOrigin"];

export interface KeywordDecisionOriginRef {
  readonly keywordId: string;
  /** The exact revision the caller is projecting, never "the latest". */
  readonly governanceRevision: number;
}

export interface KeywordDecisionOriginRow {
  readonly keywordId: string;
  readonly governanceRevision: number;
  readonly decisionOrigin: KeywordDecisionOrigin;
  /** Non-null only for a generated fallback proven by the DB lineage guard. */
  readonly analysisInvocationId: string | null;
}

/**
 * Automated governance is bounded per Analysis Refresh run because it executes
 * inside the already-open Growth Audit transaction. A project with more
 * untouched candidates converges over consecutive runs instead of holding one
 * long write lock.
 */
export const MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH = 500;

/**
 * `auto_keyword_governance.v1` — the persisted identity of the automated
 * governance behaviour. Any change to what an automated decision is allowed to
 * write MUST bump this literal (spec §"版本化字面量").
 */
export const AUTO_KEYWORD_GOVERNANCE_VERSION = "auto_keyword_governance.v1";

/** One bounded internal Topic-generation materialization batch. */
export const MAX_GENERATED_TOPIC_ASSIGNMENT_BATCH = 500;
const MAX_GENERATED_TOPIC_GROUPS = 100;
const GENERATED_TOPIC_ASSIGNMENT_REASON =
  "topic-model-generation.v1 assigned this keyword to the first system-confirmed Topic Model.";
const GENERATED_SEARCH_INTENTS = new Set([
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const);
const GENERATED_AUTHORITY_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GENERATED_ASSIGNMENT_INPUT_KEYS = ["groups", "assignments"] as const;
const GENERATED_GROUP_KEYS = [
  "groupKey",
  "topicNodeId",
  "topicModelRevision",
] as const;
const GENERATED_KEYWORD_ASSIGNMENT_KEYS = [
  "groupKey",
  "keywordId",
  "expectedGovernanceRevision",
  "resolvedIntent",
] as const;
const GENERATED_RESOLVED_INTENT_KEYS = [
  "authority",
  "value",
  "analysisInvocationId",
] as const;

export type GeneratedSearchIntent =
  | "informational"
  | "navigational"
  | "commercial"
  | "transactional";

export type GeneratedTopicResolvedIntent =
  | {
      readonly authority: "provider_observed";
      readonly value: GeneratedSearchIntent;
      readonly analysisInvocationId: null;
    }
  | {
      readonly authority: "llm_generated";
      readonly value: GeneratedSearchIntent;
      readonly analysisInvocationId: string;
    };

export interface GeneratedTopicAssignmentGroupInput {
  readonly groupKey: string;
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
}

export interface GeneratedTopicKeywordAssignmentInput {
  readonly groupKey: string;
  readonly keywordId: string;
  readonly expectedGovernanceRevision: number;
  /** Null means no provider fact or valid generated fallback was available. */
  readonly resolvedIntent: GeneratedTopicResolvedIntent | null;
}

export interface ApplyGeneratedTopicAssignmentsInput {
  readonly groups: readonly GeneratedTopicAssignmentGroupInput[];
  readonly assignments: readonly GeneratedTopicKeywordAssignmentInput[];
}

export type GeneratedTopicAssignmentSkip =
  | "unknown_group"
  | "topic_revision_moved"
  | "topic_node_absent"
  | "intent_unavailable"
  | "keyword_absent"
  | "human_decision_exists"
  | "revision_moved"
  | "revision_exhausted"
  | "ledger_unreadable"
  | "conflict";

export interface GeneratedTopicAssignmentOutcome {
  readonly groupKey: string;
  readonly keywordId: string;
  readonly applied: boolean;
  readonly skipped: GeneratedTopicAssignmentSkip | null;
  readonly governanceRevision: number | null;
}

export interface GeneratedTopicAssignmentReport {
  readonly assignedCount: number;
  readonly skippedCount: number;
  readonly skipped: Readonly<
    Record<GeneratedTopicAssignmentSkip, number>
  >;
  readonly outcomes: readonly GeneratedTopicAssignmentOutcome[];
}

/**
 * One automated approval the caller has already justified from immutable
 * provider evidence. The repository never invents evidence: it only enforces
 * that the resulting write stays truthful — recorded as an actorless
 * `system_suggestion`, never overwriting a human decision, and advancing
 * exactly one governance revision under a row lock.
 *
 * A Topic Node is deliberately absent. Topic Models are a manual authority and
 * the system must not fabricate one, so an automated decision carries only the
 * deterministic `cluster_key` compatibility label.
 */
export interface SystemKeywordApprovalInput {
  readonly keywordId: string;
  readonly expectedGovernanceRevision: number;
  /** Deterministic cluster label; 1 to 200 trimmed characters. */
  readonly clusterKey: string;
  /**
   * `new_asset` is intentionally unreachable: proposing a new asset is an
   * editorial judgement no provider Observation can support.
   */
  readonly mappingDecision: "unassigned" | "existing_page";
  readonly mappedSitePageId: string | null;
  readonly reason: string;
}

/**
 * Why one candidate was left completely untouched. Every value is a fact the
 * repository observed under the lock, never a swallowed failure: the caller
 * reports the counts and the keyword keeps its previous governance.
 */
export type SystemKeywordApprovalSkip =
  | "keyword_absent"
  | "human_decision_exists"
  | "already_reviewed"
  | "revision_moved"
  | "revision_exhausted"
  | "site_page_absent"
  | "ledger_unreadable";

export interface SystemKeywordApprovalOutcome {
  readonly keywordId: string;
  readonly applied: boolean;
  readonly skipped: SystemKeywordApprovalSkip | null;
  readonly governanceRevision: number | null;
}

export type KeywordGovernanceConflictCode =
  | "KEYWORD_NOT_FOUND"
  | "SUGGESTION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "TOPIC_ASSIGNMENT_INVALID"
  | "SITE_PAGE_NOT_FOUND";

export class KeywordGovernanceConflictError extends Error {
  override readonly name = "KeywordGovernanceConflictError";

  constructor(
    readonly code: KeywordGovernanceConflictCode,
    readonly expectedRevision: number | null = null,
    readonly currentRevision: number | null = null,
  ) {
    super(
      {
        KEYWORD_NOT_FOUND:
          "The keyword does not belong to the active project",
        SUGGESTION_NOT_FOUND:
          "The keyword review suggestion does not belong to the active project",
        REVISION_CONFLICT:
          "The keyword governance revision is stale",
        TOPIC_ASSIGNMENT_INVALID:
          "The Topic assignment is not active in the exact confirmed model revision",
        SITE_PAGE_NOT_FOUND:
          "The mapped Site Page does not belong to the project",
      }[code],
    );
  }
}

export type KeywordGovernanceIntegrityCode =
  | "CURRENT_DECISION_MISSING"
  | "CURRENT_DECISION_DIVERGED"
  | "LEGACY_PROJECTION_DIVERGED"
  | "CAS_UPDATE_FAILED"
  | "SERVER_FACT_INVALID";

export class KeywordGovernanceIntegrityError extends Error {
  override readonly name = "KeywordGovernanceIntegrityError";

  constructor(readonly code: KeywordGovernanceIntegrityCode) {
    super(
      {
        CURRENT_DECISION_MISSING:
          "The current keyword governance decision is missing",
        CURRENT_DECISION_DIVERGED:
          "The current keyword governance decision failed integrity validation",
        LEGACY_PROJECTION_DIVERGED:
          "The legacy keyword projection diverges from the decision ledger",
        CAS_UPDATE_FAILED:
          "The locked keyword projection could not be advanced atomically",
        SERVER_FACT_INVALID:
          "The server could not produce valid immutable decision facts",
      }[code],
    );
  }
}

export interface KeywordGovernanceClock {
  readonly newId: () => string;
  /**
   * Retained for constructor compatibility. Review instants are chosen by
   * PostgreSQL so an application-host clock can never move governance
   * authority backwards.
   */
  readonly now: () => string;
}

const DEFAULT_CLOCK: KeywordGovernanceClock = {
  newId: randomUUID,
  now: () => new Date().toISOString(),
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEYWORD_STATUSES = new Set([
  "candidate",
  "approved",
  "excluded",
  "parked",
] as const);
const MAPPING_DECISIONS = new Set([
  "unassigned",
  "existing_page",
  "new_asset",
] as const);
const REVIEW_STATES = new Set(["unreviewed", "confirmed"] as const);
const DECISION_ORIGINS = new Set([
  "migration_baseline",
  "user",
  "system_suggestion",
] as const);
const ASSIGNMENT_INVALIDATIONS = new Set([
  "topic_split",
  "topic_merge",
  "topic_retire",
] as const);
const REVIEWED_PROJECTION_KEYS = [
  "projectId",
  "keywordId",
  "governanceRevision",
  "status",
  "intent",
  "buyerStage",
  "topicNodeId",
  "topicModelRevision",
  "clusterKey",
  "mappingDecision",
  "mappedSitePageId",
  "mappingReviewState",
  "assignmentInvalidatedBy",
  "earlierHistoryAvailable",
] as const;

interface KeywordAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly status: string;
  readonly intent: string | null;
  readonly buyer_stage: string | null;
  readonly cluster_key: string | null;
  readonly mapping_decision: string;
  readonly mapped_site_page_id: string | null;
  readonly mapping_review_state: string;
  readonly mapping_revision: number;
  readonly updated_at: string;
}

interface KeywordDecisionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly keyword_entity_id: string;
  readonly governance_revision: number;
  readonly decision_origin: string;
  readonly status: string;
  readonly intent: string | null;
  readonly buyer_stage: string | null;
  readonly topic_node_id: string | null;
  readonly topic_model_revision: number | null;
  readonly cluster_key_at_decision: string | null;
  readonly mapping_decision: string;
  readonly mapped_site_page_id: string | null;
  readonly review_state: string;
  readonly assignment_invalidated_by: string | null;
  readonly decided_by: string | null;
  readonly reason: string;
  readonly decided_at: string;
  readonly reviewed_projection: unknown;
  readonly created_at: string;
}

interface CanonicalReview {
  readonly expectedGovernanceRevision: number;
  readonly status: KeywordReviewDecision["status"];
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappingDecision: KeywordReviewDecision["mappingDecision"];
  readonly mappedSitePageId: string | null;
  readonly reason: string;
}

interface LockedKeywordReviewSuggestion {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly keyword_entity_id: string;
  readonly expected_governance_revision: number;
  readonly suggestion_version: string;
  readonly status: string;
  readonly suggested_status: string;
  readonly suggested_intent: string | null;
  readonly suggested_buyer_stage: string | null;
  readonly suggested_topic_node_id: string | null;
  readonly suggested_topic_model_revision: number | null;
  readonly suggested_mapping_decision: string;
  readonly suggested_mapped_site_page_id: string | null;
  readonly suggested_reason: string;
  readonly intent_authority:
    | "provider_observed"
    | "llm_generated"
    | "unavailable";
  readonly resolution_mode: string | null;
  readonly keyword_review_decision_id: string | null;
}

type ReviewSuggestionResolution =
  | { readonly mode: "edited" }
  | {
      readonly mode: "accepted";
      readonly suggestion: LockedKeywordReviewSuggestion;
    };

const keywordSelection = {
  id: keywordEntities.id,
  workspace_id: keywordEntities.workspace_id,
  project_id: keywordEntities.project_id,
  status: keywordEntities.status,
  intent: keywordEntities.intent,
  buyer_stage: keywordEntities.buyer_stage,
  cluster_key: keywordEntities.cluster_key,
  mapping_decision: keywordEntities.mapping_decision,
  mapped_site_page_id: keywordEntities.mapped_site_page_id,
  mapping_review_state: keywordEntities.mapping_review_state,
  mapping_revision: keywordEntities.mapping_revision,
  updated_at: keywordEntities.updated_at,
} as const;

const decisionSelection = {
  id: keywordReviewDecisions.id,
  workspace_id: keywordReviewDecisions.workspace_id,
  project_id: keywordReviewDecisions.project_id,
  keyword_entity_id: keywordReviewDecisions.keyword_entity_id,
  governance_revision: keywordReviewDecisions.governance_revision,
  decision_origin: keywordReviewDecisions.decision_origin,
  status: keywordReviewDecisions.status,
  intent: keywordReviewDecisions.intent,
  buyer_stage: keywordReviewDecisions.buyer_stage,
  topic_node_id: keywordReviewDecisions.topic_node_id,
  topic_model_revision: keywordReviewDecisions.topic_model_revision,
  cluster_key_at_decision:
    keywordReviewDecisions.cluster_key_at_decision,
  mapping_decision: keywordReviewDecisions.mapping_decision,
  mapped_site_page_id: keywordReviewDecisions.mapped_site_page_id,
  review_state: keywordReviewDecisions.review_state,
  assignment_invalidated_by:
    keywordReviewDecisions.assignment_invalidated_by,
  decided_by: keywordReviewDecisions.decided_by,
  reason: keywordReviewDecisions.reason,
  decided_at: keywordReviewDecisions.decided_at,
  reviewed_projection: keywordReviewDecisions.reviewed_projection,
  created_at: keywordReviewDecisions.created_at,
} as const;

const suggestionSelection = {
  id: keywordReviewSuggestions.id,
  workspace_id: keywordReviewSuggestions.workspace_id,
  project_id: keywordReviewSuggestions.project_id,
  keyword_entity_id: keywordReviewSuggestions.keyword_entity_id,
  expected_governance_revision:
    keywordReviewSuggestions.expected_governance_revision,
  suggestion_version: keywordReviewSuggestions.suggestion_version,
  status: keywordReviewSuggestions.status,
  suggested_status: keywordReviewSuggestions.suggested_status,
  suggested_intent: keywordReviewSuggestions.suggested_intent,
  suggested_buyer_stage: keywordReviewSuggestions.suggested_buyer_stage,
  suggested_topic_node_id:
    keywordReviewSuggestions.suggested_topic_node_id,
  suggested_topic_model_revision:
    keywordReviewSuggestions.suggested_topic_model_revision,
  suggested_mapping_decision:
    keywordReviewSuggestions.suggested_mapping_decision,
  suggested_mapped_site_page_id:
    keywordReviewSuggestions.suggested_mapped_site_page_id,
  suggested_reason: keywordReviewSuggestions.suggested_reason,
  intent_authority: keywordReviewSuggestions.intent_authority,
  resolution_mode: keywordReviewSuggestions.resolution_mode,
  keyword_review_decision_id:
    keywordReviewSuggestions.keyword_review_decision_id,
} as const;

function assertUuid(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RangeError(`${label} must be a canonical UUID`);
  }
}

function assertOptionalBounded(
  value: string | null,
  label: string,
  max: number,
): void {
  if (
    value !== null &&
    (value.length < 1 || value.length > max || value.trim() !== value)
  ) {
    throw new RangeError(
      `${label} must be null or 1 to ${max} trimmed characters`,
    );
  }
}

function assertScope(
  scope: ProjectScope,
  keywordId: string,
  actorId?: string,
): void {
  assertUuid(scope.workspaceId, "workspaceId");
  assertUuid(scope.projectId, "projectId");
  assertUuid(keywordId, "keywordId");
  if (actorId !== undefined) assertUuid(actorId, "actorId");
}

function canonicalReview(input: ReviewKeywordInput): CanonicalReview {
  if (
    !Number.isSafeInteger(input.expectedGovernanceRevision) ||
    input.expectedGovernanceRevision < 0 ||
    input.expectedGovernanceRevision >
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
  ) {
    throw new RangeError(
      `expectedGovernanceRevision must be a non-negative integer at most ${MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION}`,
    );
  }
  if (!KEYWORD_STATUSES.has(input.status)) {
    throw new RangeError("status is not a supported keyword status");
  }
  if (!MAPPING_DECISIONS.has(input.mappingDecision)) {
    throw new RangeError(
      "mappingDecision is not a supported mapping decision",
    );
  }
  assertOptionalBounded(input.intent, "intent", 100);
  assertOptionalBounded(input.buyerStage, "buyerStage", 100);
  if (
    input.reason.length < 3 ||
    input.reason.length > 2_000 ||
    input.reason.trim() !== input.reason
  ) {
    throw new RangeError(
      "reason must contain 3 to 2000 trimmed characters",
    );
  }

  const hasTopicId = input.topicNodeId !== null;
  const hasTopicRevision = input.topicModelRevision !== null;
  if (hasTopicId !== hasTopicRevision) {
    throw new RangeError(
      "Topic assignment requires both topicNodeId and topicModelRevision",
    );
  }
  if (input.topicNodeId !== null) {
    assertUuid(input.topicNodeId, "topicNodeId");
  }
  if (
    input.topicModelRevision !== null &&
    (!Number.isSafeInteger(input.topicModelRevision) ||
      input.topicModelRevision < 1)
  ) {
    throw new RangeError(
      "topicModelRevision must be a positive safe integer",
    );
  }
  if (
    input.mappingDecision === "existing_page" &&
    input.mappedSitePageId === null
  ) {
    throw new RangeError(
      "mappedSitePageId is required for existing_page",
    );
  }
  if (
    input.mappingDecision !== "existing_page" &&
    input.mappedSitePageId !== null
  ) {
    throw new RangeError(
      "mappedSitePageId must be null unless mappingDecision is existing_page",
    );
  }
  if (input.mappedSitePageId !== null) {
    assertUuid(input.mappedSitePageId, "mappedSitePageId");
  }
  if (
    input.mappingDecision !== "unassigned" &&
    input.topicNodeId === null
  ) {
    throw new RangeError(
      "A mapped keyword requires an exact Topic assignment",
    );
  }

  if (input.status === "excluded") {
    return {
      expectedGovernanceRevision: input.expectedGovernanceRevision,
      status: input.status,
      intent: input.intent,
      buyerStage: input.buyerStage,
      topicNodeId: null,
      topicModelRevision: null,
      mappingDecision: "unassigned",
      mappedSitePageId: null,
      reason: input.reason,
    };
  }

  return { ...input };
}

/**
 * Validate one automated approval before any SQL runs. The bounds mirror the
 * database CHECK constraints so a malformed automated write is rejected by the
 * application rather than aborting the caller's whole transaction.
 */
function canonicalSystemApproval(
  input: SystemKeywordApprovalInput,
): SystemKeywordApprovalInput {
  assertUuid(input.keywordId, "keywordId");
  if (
    !Number.isSafeInteger(input.expectedGovernanceRevision) ||
    input.expectedGovernanceRevision < 0 ||
    input.expectedGovernanceRevision >
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
  ) {
    throw new RangeError(
      `expectedGovernanceRevision must be a non-negative integer at most ${MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION}`,
    );
  }
  if (
    input.clusterKey.length < 1 ||
    input.clusterKey.length > 200 ||
    input.clusterKey.trim() !== input.clusterKey
  ) {
    throw new RangeError(
      "clusterKey must contain 1 to 200 trimmed characters",
    );
  }
  if (
    input.mappingDecision !== "unassigned" &&
    input.mappingDecision !== "existing_page"
  ) {
    throw new RangeError(
      "an automated decision may only leave a keyword unassigned or map it to an existing page",
    );
  }
  if (
    (input.mappingDecision === "existing_page") !==
    (input.mappedSitePageId !== null)
  ) {
    throw new RangeError(
      "mappedSitePageId is required for existing_page and forbidden otherwise",
    );
  }
  if (input.mappedSitePageId !== null) {
    assertUuid(input.mappedSitePageId, "mappedSitePageId");
  }
  if (
    input.reason.length < 3 ||
    input.reason.length > 2_000 ||
    input.reason.trim() !== input.reason
  ) {
    throw new RangeError("reason must contain 3 to 2000 trimmed characters");
  }
  return { ...input };
}

function assertExactPlainRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new RangeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    !keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  ) {
    throw new RangeError(`${label} only accepts its documented fields`);
  }
}

function assertGeneratedGroupKey(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    value.trim() !== value ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    throw new RangeError(`${label} must be a canonical bounded group key`);
  }
}

function canonicalGeneratedResolvedIntent(
  value: unknown,
  label: string,
): GeneratedTopicResolvedIntent | null {
  if (value === null) return null;
  assertExactPlainRecord(value, GENERATED_RESOLVED_INTENT_KEYS, label);
  const authority = value["authority"];
  const intent = value["value"];
  const invocationId = value["analysisInvocationId"];
  if (
    typeof intent !== "string" ||
    !GENERATED_SEARCH_INTENTS.has(intent as GeneratedSearchIntent)
  ) {
    throw new RangeError(`${label}.value is not a canonical search intent`);
  }
  if (authority === "provider_observed") {
    if (invocationId !== null) {
      throw new RangeError(
        `${label} provider authority cannot carry an invocation`,
      );
    }
    return {
      authority,
      value: intent as GeneratedSearchIntent,
      analysisInvocationId: null,
    };
  }
  if (authority === "llm_generated") {
    if (
      typeof invocationId !== "string" ||
      !GENERATED_AUTHORITY_UUID.test(invocationId)
    ) {
      throw new RangeError(
        `${label} LLM authority requires a successful invocation UUID`,
      );
    }
    return {
      authority,
      value: intent as GeneratedSearchIntent,
      analysisInvocationId: invocationId,
    };
  }
  throw new RangeError(`${label}.authority is not writable here`);
}

function canonicalGeneratedTopicAssignmentInput(
  input: ApplyGeneratedTopicAssignmentsInput,
): ApplyGeneratedTopicAssignmentsInput {
  assertExactPlainRecord(
    input,
    GENERATED_ASSIGNMENT_INPUT_KEYS,
    "generated assignment input",
  );
  if (
    !Array.isArray(input.groups) ||
    input.groups.length > MAX_GENERATED_TOPIC_GROUPS
  ) {
    throw new RangeError(
      `groups must contain at most ${MAX_GENERATED_TOPIC_GROUPS} entries`,
    );
  }
  if (
    !Array.isArray(input.assignments) ||
    input.assignments.length > MAX_GENERATED_TOPIC_ASSIGNMENT_BATCH
  ) {
    throw new RangeError(
      `assignments must contain at most ${MAX_GENERATED_TOPIC_ASSIGNMENT_BATCH} keywords`,
    );
  }
  const groups = input.groups.map((group, index) => {
    assertExactPlainRecord(
      group,
      GENERATED_GROUP_KEYS,
      `groups[${index}]`,
    );
    assertGeneratedGroupKey(group.groupKey, `groups[${index}].groupKey`);
    if (
      typeof group.topicNodeId !== "string" ||
      !GENERATED_AUTHORITY_UUID.test(group.topicNodeId)
    ) {
      throw new RangeError(`groups[${index}].topicNodeId must be a UUID`);
    }
    const revision = group.topicModelRevision;
    if (
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > MAX_POSTGRES_INTEGER_REVISION
    ) {
      throw new RangeError(
        `groups[${index}].topicModelRevision must be a positive PostgreSQL integer`,
      );
    }
    return {
      groupKey: group.groupKey,
      topicNodeId: group.topicNodeId,
      topicModelRevision: revision,
    };
  });
  if (new Set(groups.map((group) => group.groupKey)).size !== groups.length) {
    throw new RangeError("groups must not repeat a groupKey");
  }
  if (
    new Set(groups.map((group) => group.topicModelRevision)).size > 1
  ) {
    throw new RangeError("groups must target one exact Topic Model revision");
  }

  const assignments = input.assignments.map((assignment, index) => {
    assertExactPlainRecord(
      assignment,
      GENERATED_KEYWORD_ASSIGNMENT_KEYS,
      `assignments[${index}]`,
    );
    assertGeneratedGroupKey(
      assignment.groupKey,
      `assignments[${index}].groupKey`,
    );
    assertUuid(assignment.keywordId, `assignments[${index}].keywordId`);
    const revision = assignment.expectedGovernanceRevision;
    if (
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision > MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
    ) {
      throw new RangeError(
        `assignments[${index}].expectedGovernanceRevision is outside the incrementable range`,
      );
    }
    return {
      groupKey: assignment.groupKey,
      keywordId: assignment.keywordId,
      expectedGovernanceRevision: revision,
      resolvedIntent: canonicalGeneratedResolvedIntent(
        assignment.resolvedIntent,
        `assignments[${index}].resolvedIntent`,
      ),
    };
  });
  if (
    new Set(assignments.map((assignment) => assignment.keywordId)).size !==
    assignments.length
  ) {
    throw new RangeError("assignments must not repeat a keywordId");
  }
  return { groups, assignments };
}

function activeProjectPredicate(scope: ProjectScope) {
  return and(
    eq(clientProjects.id, scope.projectId),
    eq(clientProjects.workspace_id, scope.workspaceId),
    isNull(clientProjects.archived_at),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isAcceptedSuggestionAuthorityConflict(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isRecord(candidate)) return false;
    if (
      candidate["code"] === "23514" &&
      candidate["constraint"] ===
        "keyword_review_suggestion_accepted_authority_current"
    ) {
      return true;
    }
    candidate = candidate["cause"];
  }
  return false;
}

function isNullableBoundedString(
  value: unknown,
  max: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= max &&
      value.trim() === value)
  );
}

function assertDecisionRowShape(row: KeywordDecisionRow): void {
  if (
    !UUID.test(row.id) ||
    !UUID.test(row.workspace_id) ||
    !UUID.test(row.project_id) ||
    !UUID.test(row.keyword_entity_id) ||
    !Number.isSafeInteger(row.governance_revision) ||
    row.governance_revision < 0 ||
    row.governance_revision > MAX_POSTGRES_INTEGER_REVISION ||
    !DECISION_ORIGINS.has(
      row.decision_origin as
        | "migration_baseline"
        | "user"
        | "system_suggestion",
    ) ||
    !KEYWORD_STATUSES.has(
      row.status as
        | "candidate"
        | "approved"
        | "excluded"
        | "parked",
    ) ||
    !isNullableBoundedString(row.intent, 100) ||
    !isNullableBoundedString(row.buyer_stage, 100) ||
    !isNullableBoundedString(row.cluster_key_at_decision, 200) ||
    !MAPPING_DECISIONS.has(
      row.mapping_decision as
        | "unassigned"
        | "existing_page"
        | "new_asset",
    ) ||
    !REVIEW_STATES.has(
      row.review_state as "unreviewed" | "confirmed",
    ) ||
    (row.assignment_invalidated_by !== null &&
      !ASSIGNMENT_INVALIDATIONS.has(
        row.assignment_invalidated_by as
          | "topic_split"
          | "topic_merge"
          | "topic_retire",
      )) ||
    row.reason.length < 3 ||
    row.reason.length > 2_000 ||
    row.reason.trim() !== row.reason ||
    !isTimestamptzInstant(row.decided_at)
  ) {
    throw new KeywordGovernanceIntegrityError(
      "CURRENT_DECISION_DIVERGED",
    );
  }

  const hasTopicId = row.topic_node_id !== null;
  const hasTopicRevision = row.topic_model_revision !== null;
  if (
    hasTopicId !== hasTopicRevision ||
    (row.topic_node_id !== null && !UUID.test(row.topic_node_id)) ||
    (row.topic_model_revision !== null &&
      (!Number.isSafeInteger(row.topic_model_revision) ||
        row.topic_model_revision < 1 ||
        row.topic_model_revision > MAX_POSTGRES_INTEGER_REVISION)) ||
    (row.topic_node_id !== null &&
      row.cluster_key_at_decision === null) ||
    (row.mapping_decision === "existing_page") !==
      (row.mapped_site_page_id !== null) ||
    (row.mapped_site_page_id !== null &&
      !UUID.test(row.mapped_site_page_id)) ||
    (row.assignment_invalidated_by !== null &&
      row.review_state !== "unreviewed") ||
    (row.decision_origin === "migration_baseline" &&
      row.decided_by !== null) ||
    (row.decision_origin === "user" &&
      row.decided_by === null) ||
    (row.decided_by !== null && !UUID.test(row.decided_by)) ||
    (row.decision_origin === "user" &&
      (row.review_state !== "confirmed" ||
        row.assignment_invalidated_by !== null ||
        (row.mapping_decision !== "unassigned" &&
          row.topic_node_id === null) ||
        (row.status === "excluded" &&
          (row.topic_node_id !== null ||
            row.mapping_decision !== "unassigned" ||
            row.mapped_site_page_id !== null)))) ||
    (row.assignment_invalidated_by !== null &&
      row.decision_origin !== "system_suggestion")
  ) {
    throw new KeywordGovernanceIntegrityError(
      "CURRENT_DECISION_DIVERGED",
    );
  }
}

function exactProjection(
  row: KeywordDecisionRow,
): KeywordGovernanceReviewedProjection {
  const value = row.reviewed_projection;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== REVIEWED_PROJECTION_KEYS.length ||
    !REVIEWED_PROJECTION_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    typeof value.earlierHistoryAvailable !== "boolean"
  ) {
    throw new KeywordGovernanceIntegrityError(
      "CURRENT_DECISION_DIVERGED",
    );
  }

  const expected = {
    projectId: row.project_id,
    keywordId: row.keyword_entity_id,
    governanceRevision: row.governance_revision,
    status: row.status,
    intent: row.intent,
    buyerStage: row.buyer_stage,
    topicNodeId: row.topic_node_id,
    topicModelRevision: row.topic_model_revision,
    clusterKey: row.cluster_key_at_decision,
    mappingDecision: row.mapping_decision,
    mappedSitePageId: row.mapped_site_page_id,
    mappingReviewState: row.review_state,
    assignmentInvalidatedBy: row.assignment_invalidated_by,
  } as const;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new KeywordGovernanceIntegrityError(
        "CURRENT_DECISION_DIVERGED",
      );
    }
  }
  if (
    row.decision_origin === "migration_baseline" &&
    value.earlierHistoryAvailable !== false
  ) {
    throw new KeywordGovernanceIntegrityError(
      "CURRENT_DECISION_DIVERGED",
    );
  }
  return value as unknown as KeywordGovernanceReviewedProjection;
}

function assertLegacyMirror(
  keyword: KeywordAuthorityRow,
  decision: KeywordDecisionRow,
): void {
  if (
    keyword.id !== decision.keyword_entity_id ||
    keyword.workspace_id !== decision.workspace_id ||
    keyword.project_id !== decision.project_id ||
    keyword.mapping_revision !== decision.governance_revision ||
    keyword.status !== decision.status ||
    keyword.intent !== decision.intent ||
    keyword.buyer_stage !== decision.buyer_stage ||
    keyword.cluster_key !== decision.cluster_key_at_decision ||
    keyword.mapping_decision !== decision.mapping_decision ||
    keyword.mapped_site_page_id !== decision.mapped_site_page_id ||
    keyword.mapping_review_state !== decision.review_state
  ) {
    throw new KeywordGovernanceIntegrityError(
      "LEGACY_PROJECTION_DIVERGED",
    );
  }
}

function stateFromRows(
  keyword: KeywordAuthorityRow,
  row: KeywordDecisionRow,
): CurrentKeywordGovernance {
  assertDecisionRowShape(row);
  const reviewedProjection = exactProjection(row);
  assertLegacyMirror(keyword, row);

  const status =
    row.status as KeywordReviewDecision["status"];
  const mappingDecision =
    row.mapping_decision as KeywordReviewDecision["mappingDecision"];
  const mappingReviewState =
    row.review_state as KeywordReviewDecision["mappingReviewState"];
  const assignmentInvalidatedBy =
    row.assignment_invalidated_by as
      KeywordReviewDecision["assignmentInvalidatedBy"];
  const decisionOrigin =
    row.decision_origin as KeywordReviewDecision["decisionOrigin"];
  const decision: KeywordReviewDecision = {
    decisionId: row.id,
    projectId: row.project_id,
    keywordId: row.keyword_entity_id,
    governanceRevision: row.governance_revision,
    status,
    intent: row.intent,
    buyerStage: row.buyer_stage,
    topicNodeId: row.topic_node_id,
    topicModelRevision: row.topic_model_revision,
    mappingDecision,
    mappedSitePageId: row.mapped_site_page_id,
    mappingReviewState,
    assignmentInvalidatedBy,
    reason: row.reason,
    decisionOrigin,
    decidedBy: row.decided_by,
    decidedAt: canonicalUtcTimestamptz(row.decided_at),
  };
  const executionState =
    status === "approved" &&
    mappingReviewState === "confirmed" &&
    assignmentInvalidatedBy === null &&
    row.topic_node_id !== null &&
    row.topic_model_revision !== null &&
    mappingDecision !== "unassigned"
      ? "ready"
      : "blocked";
  const projection: KeywordGovernanceCurrentProjection = {
    currentDecisionId: row.id,
    projectId: row.project_id,
    keywordId: row.keyword_entity_id,
    governanceRevision: row.governance_revision,
    status,
    intent: row.intent,
    buyerStage: row.buyer_stage,
    topicNodeId: row.topic_node_id,
    topicModelRevision: row.topic_model_revision,
    mappingDecision,
    mappedSitePageId: row.mapped_site_page_id,
    mappingReviewState,
    assignmentInvalidatedBy,
    mappingRevision: keyword.mapping_revision,
    executionState,
    reason: row.reason,
    updatedAt: canonicalUtcTimestamptz(keyword.updated_at),
  };
  return {
    decision,
    projection,
    clusterKey: row.cluster_key_at_decision,
    reviewedProjection,
  };
}

function exactReplay(
  row: KeywordDecisionRow,
  actorId: string,
  input: CanonicalReview,
): boolean {
  return (
    row.decision_origin === "user" &&
    row.decided_by === actorId &&
    row.review_state === "confirmed" &&
    row.assignment_invalidated_by === null &&
    row.governance_revision ===
      input.expectedGovernanceRevision + 1 &&
    row.status === input.status &&
    row.intent === input.intent &&
    row.buyer_stage === input.buyerStage &&
    row.topic_node_id === input.topicNodeId &&
    row.topic_model_revision === input.topicModelRevision &&
    row.mapping_decision === input.mappingDecision &&
    row.mapped_site_page_id === input.mappedSitePageId &&
    row.reason === input.reason
  );
}

const GENERATED_TOPIC_ASSIGNMENT_SKIPS = [
  "unknown_group",
  "topic_revision_moved",
  "topic_node_absent",
  "intent_unavailable",
  "keyword_absent",
  "human_decision_exists",
  "revision_moved",
  "revision_exhausted",
  "ledger_unreadable",
  "conflict",
] as const satisfies readonly GeneratedTopicAssignmentSkip[];

function skippedGeneratedAssignment(
  input: GeneratedTopicKeywordAssignmentInput,
  reason: GeneratedTopicAssignmentSkip,
): GeneratedTopicAssignmentOutcome {
  return {
    groupKey: input.groupKey,
    keywordId: input.keywordId,
    applied: false,
    skipped: reason,
    governanceRevision: null,
  };
}

function generatedAssignmentReport(
  outcomes: readonly (GeneratedTopicAssignmentOutcome | undefined)[],
): GeneratedTopicAssignmentReport {
  if (outcomes.some((outcome) => outcome === undefined)) {
    throw new KeywordGovernanceIntegrityError("SERVER_FACT_INVALID");
  }
  const complete = outcomes as readonly GeneratedTopicAssignmentOutcome[];
  const skipped = Object.fromEntries(
    GENERATED_TOPIC_ASSIGNMENT_SKIPS.map((reason) => [reason, 0]),
  ) as Record<GeneratedTopicAssignmentSkip, number>;
  let assignedCount = 0;
  for (const outcome of complete) {
    if (outcome.applied) {
      assignedCount += 1;
    } else if (outcome.skipped !== null) {
      skipped[outcome.skipped] += 1;
    }
  }
  return {
    assignedCount,
    skippedCount: complete.length - assignedCount,
    skipped,
    outcomes: complete,
  };
}

interface ConfirmedGeneratedTopicRow {
  readonly topic_node_id: string;
  readonly topic_model_revision: number;
  readonly label: string;
}

type TransactionalExecutor = Executor & {
  transaction?: <T>(
    run: (tx: DbTx) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Topic-aware keyword review authority.
 *
 * A pooled DB executor is wrapped in a transaction. When the repository is
 * already constructed with a transaction executor, the same method remains
 * usable and all statements stay inside the caller's transaction/savepoint.
 */
export class KeywordGovernanceRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: KeywordGovernanceClock = DEFAULT_CLOCK,
  ) {
    super(exec);
  }

  async findCurrent(
    scope: ProjectScope,
    keywordId: string,
  ): Promise<CurrentKeywordGovernance | null> {
    assertScope(scope, keywordId);
    const keyword = await this.findKeyword(
      this.exec,
      scope,
      keywordId,
      false,
    );
    if (!keyword) return null;
    const current = await this.findLatestDecision(
      this.exec,
      scope,
      keywordId,
    );
    if (!current) {
      throw new KeywordGovernanceIntegrityError(
        "CURRENT_DECISION_MISSING",
      );
    }
    return stateFromRows(keyword, current);
  }

  /**
   * Read WHICH authority decided each keyword at the exact governance revision
   * the caller is projecting — one project-scoped statement for a whole page,
   * never one query per keyword.
   *
   * The exact revision is the point. A published generation reports frozen
   * facts at the revision it froze and the live library reports the current
   * revision; resolving "the latest decision" instead would attribute a later
   * review to an earlier projection. Decisions are append-only and unique per
   * (keyword, revision), so this read is immutable and repeatable.
   *
   * A keyword with no decision at that revision is simply absent from the
   * result. The caller MUST render that absence as "no recorded decision",
   * never as a human review.
   */
  async listDecisionOriginsAt(
    scope: ProjectScope,
    refs: readonly KeywordDecisionOriginRef[],
  ): Promise<readonly KeywordDecisionOriginRow[]> {
    assertUuid(scope.workspaceId, "workspaceId");
    assertUuid(scope.projectId, "projectId");
    if (refs.length === 0) return [];
    if (refs.length > MAX_KEYWORD_DECISION_ORIGIN_BATCH) {
      throw new RangeError(
        `refs must contain at most ${MAX_KEYWORD_DECISION_ORIGIN_BATCH} keywords`,
      );
    }
    const requestedRevisionByKeywordId = new Map<string, number>();
    for (const ref of refs) {
      assertUuid(ref.keywordId, "keywordId");
      if (requestedRevisionByKeywordId.has(ref.keywordId)) {
        throw new RangeError("refs must not repeat a keywordId");
      }
      if (
        !Number.isSafeInteger(ref.governanceRevision) ||
        ref.governanceRevision < 0 ||
        ref.governanceRevision > MAX_POSTGRES_INTEGER_REVISION
      ) {
        throw new RangeError(
          `governanceRevision must be between 0 and ${MAX_POSTGRES_INTEGER_REVISION}`,
        );
      }
      requestedRevisionByKeywordId.set(
        ref.keywordId,
        ref.governanceRevision,
      );
    }

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        ${keywordReviewDecisions.keyword_entity_id} as keyword_entity_id,
        ${keywordReviewDecisions.governance_revision} as governance_revision,
        ${keywordReviewDecisions.decision_origin} as decision_origin,
        ${keywordReviewDecisions.analysis_invocation_id} as analysis_invocation_id
      from ${keywordReviewDecisions}
      where ${keywordReviewDecisions.workspace_id} = ${scope.workspaceId}::uuid
        and ${keywordReviewDecisions.project_id} = ${scope.projectId}::uuid
        and (
          ${keywordReviewDecisions.keyword_entity_id},
          ${keywordReviewDecisions.governance_revision}
        ) in (
          ${sql.join(
            refs.map(
              (ref) =>
                sql`(${ref.keywordId}::uuid, ${ref.governanceRevision}::int)`,
            ),
            sql`, `,
          )}
        )
    `);

    const rows: KeywordDecisionOriginRow[] = [];
    const returned = new Set<string>();
    for (const raw of result.rows) {
      const keywordId = raw["keyword_entity_id"];
      const governanceRevision = raw["governance_revision"];
      const decisionOrigin = raw["decision_origin"];
      const analysisInvocationId = raw["analysis_invocation_id"];
      if (
        typeof keywordId !== "string" ||
        governanceRevision !==
          requestedRevisionByKeywordId.get(keywordId) ||
        returned.has(keywordId) ||
        typeof governanceRevision !== "number" ||
        typeof decisionOrigin !== "string" ||
        !DECISION_ORIGINS.has(decisionOrigin as never) ||
        (analysisInvocationId !== null &&
          (decisionOrigin !== "system_suggestion" ||
            typeof analysisInvocationId !== "string" ||
            analysisInvocationId.toLowerCase() !== analysisInvocationId ||
            !UUID.test(analysisInvocationId)))
      ) {
        throw new KeywordGovernanceIntegrityError(
          "CURRENT_DECISION_DIVERGED",
        );
      }
      returned.add(keywordId);
      rows.push({
        keywordId,
        governanceRevision,
        decisionOrigin: decisionOrigin as KeywordDecisionOrigin,
        analysisInvocationId: analysisInvocationId as string | null,
      });
    }
    return rows;
  }

  async reviewKeyword(
    scope: ProjectScope,
    keywordId: string,
    actorId: string,
    input: ReviewKeywordInput,
  ): Promise<ReviewKeywordResult> {
    assertScope(scope, keywordId, actorId);
    const canonical = canonicalReview(input);
    const transactional = this.exec as TransactionalExecutor;
    if (typeof transactional.transaction === "function") {
      return transactional.transaction((tx) =>
        this.reviewWithExecutor(
          tx,
          scope,
          keywordId,
          actorId,
          canonical,
          { mode: "edited" },
        ),
      );
    }
    return this.reviewWithExecutor(
      this.exec,
      scope,
      keywordId,
      actorId,
      canonical,
      { mode: "edited" },
    );
  }

  /**
   * Accept one immutable pending suggestion as an exact human decision. The
   * suggestion row supplies every governance field; the public command owns
   * only the expected revision and version, and the authenticated actor is
   * supplied separately by the caller.
   */
  async approveSuggestion(
    scope: ProjectScope,
    keywordId: string,
    suggestionId: string,
    actorId: string,
    input: ApproveKeywordReviewSuggestionInput,
  ): Promise<ReviewKeywordResult> {
    assertScope(scope, keywordId, actorId);
    assertUuid(suggestionId, "suggestionId");
    if (
      !Number.isSafeInteger(input.expectedGovernanceRevision) ||
      input.expectedGovernanceRevision < 0 ||
      input.expectedGovernanceRevision >
        MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
    ) {
      throw new RangeError(
        `expectedGovernanceRevision must be a non-negative integer at most ${MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION}`,
      );
    }
    if (input.suggestionVersion !== "keyword-governance-suggestion.v1") {
      throw new RangeError("suggestionVersion is not supported");
    }

    const run = async (exec: Executor): Promise<ReviewKeywordResult> => {
      await acquireTopicGovernanceProjectWriterLock(exec, scope);
      const rows = (await exec
        .select(suggestionSelection)
        .from(keywordReviewSuggestions)
        .where(
          and(
            projectPredicate(keywordReviewSuggestions, scope),
            eq(keywordReviewSuggestions.id, suggestionId),
            eq(keywordReviewSuggestions.keyword_entity_id, keywordId),
          ),
        )
        .limit(1)
        .for("update")) as LockedKeywordReviewSuggestion[];
      const suggestion = rows[0];
      if (!suggestion) {
        throw new KeywordGovernanceConflictError(
          "SUGGESTION_NOT_FOUND",
          input.expectedGovernanceRevision,
        );
      }
      if (
        suggestion.expected_governance_revision !==
          input.expectedGovernanceRevision ||
        suggestion.suggestion_version !== input.suggestionVersion ||
        (suggestion.status !== "pending" &&
          !(
            suggestion.status === "approved" &&
            suggestion.resolution_mode === "accepted" &&
            suggestion.keyword_review_decision_id !== null
          ))
      ) {
        throw new KeywordGovernanceConflictError(
          "REVISION_CONFLICT",
          input.expectedGovernanceRevision,
        );
      }
      if (
        suggestion.intent_authority !== "provider_observed" &&
        suggestion.intent_authority !== "llm_generated"
      ) {
        throw new KeywordGovernanceConflictError(
          "REVISION_CONFLICT",
          input.expectedGovernanceRevision,
        );
      }
      const canonical = canonicalReview({
        expectedGovernanceRevision: input.expectedGovernanceRevision,
        status:
          suggestion.suggested_status as KeywordReviewDecision["status"],
        intent: suggestion.suggested_intent,
        buyerStage: suggestion.suggested_buyer_stage,
        topicNodeId: suggestion.suggested_topic_node_id,
        topicModelRevision: suggestion.suggested_topic_model_revision,
        mappingDecision:
          suggestion.suggested_mapping_decision as KeywordReviewDecision["mappingDecision"],
        mappedSitePageId: suggestion.suggested_mapped_site_page_id,
        reason: suggestion.suggested_reason,
      });
      return this.reviewWithExecutor(
        exec,
        scope,
        keywordId,
        actorId,
        canonical,
        { mode: "accepted", suggestion },
      );
    };

    const transactional = this.exec as TransactionalExecutor;
    try {
      if (typeof transactional.transaction === "function") {
        return await transactional.transaction((tx) => run(tx));
      }
      return await run(this.exec);
    } catch (error) {
      if (isAcceptedSuggestionAuthorityConflict(error)) {
        throw new KeywordGovernanceConflictError(
          "REVISION_CONFLICT",
          input.expectedGovernanceRevision,
        );
      }
      throw error;
    }
  }

  private async findKeyword(
    exec: Executor,
    scope: ProjectScope,
    keywordId: string,
    lock: boolean,
  ): Promise<KeywordAuthorityRow | null> {
    const query = exec
      .select(keywordSelection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(
            clientProjects.workspace_id,
            keywordEntities.workspace_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, keywordId),
          activeProjectPredicate(scope),
        ),
      )
      .limit(1);
    const rows = (await (lock ? query.for("update") : query)) as
      KeywordAuthorityRow[];
    return rows[0] ?? null;
  }

  private async findLatestDecision(
    exec: Executor,
    scope: ProjectScope,
    keywordId: string,
  ): Promise<KeywordDecisionRow | null> {
    const rows = (await exec
      .select(decisionSelection)
      .from(keywordReviewDecisions)
      .where(
        and(
          projectPredicate(keywordReviewDecisions, scope),
          eq(keywordReviewDecisions.keyword_entity_id, keywordId),
        ),
      )
      .orderBy(
        desc(keywordReviewDecisions.governance_revision),
        desc(keywordReviewDecisions.id),
      )
      .limit(1)) as KeywordDecisionRow[];
    return rows[0] ?? null;
  }

  private async reviewWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    keywordId: string,
    actorId: string,
    input: CanonicalReview,
    resolution: ReviewSuggestionResolution,
  ): Promise<ReviewKeywordResult> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    const keyword = await this.findKeyword(
      exec,
      scope,
      keywordId,
      true,
    );
    if (!keyword) {
      throw new KeywordGovernanceConflictError(
        "KEYWORD_NOT_FOUND",
        input.expectedGovernanceRevision,
      );
    }

    const current = await this.findLatestDecision(
      exec,
      scope,
      keywordId,
    );
    if (!current) {
      throw new KeywordGovernanceIntegrityError(
        "CURRENT_DECISION_MISSING",
      );
    }
    const currentState = stateFromRows(keyword, current);
    const currentRevision = current.governance_revision;

    if (currentRevision !== input.expectedGovernanceRevision) {
      if (
        currentRevision === input.expectedGovernanceRevision + 1 &&
        exactReplay(current, actorId, input) &&
        (resolution.mode === "edited" ||
          (resolution.suggestion.status === "approved" &&
            resolution.suggestion.resolution_mode === "accepted" &&
            resolution.suggestion.keyword_review_decision_id === current.id))
      ) {
        return { ...currentState, replayed: true };
      }
      throw new KeywordGovernanceConflictError(
        "REVISION_CONFLICT",
        input.expectedGovernanceRevision,
        currentRevision,
      );
    }

    let clusterKey: string | null = null;
    if (
      input.topicNodeId !== null &&
      input.topicModelRevision !== null
    ) {
      const topicRows = await exec
        .select({ label: topicNodeRevisions.label })
        .from(topicNodeRevisions)
        .innerJoin(
          topicModelRevisions,
          and(
            eq(
              topicModelRevisions.workspace_id,
              topicNodeRevisions.workspace_id,
            ),
            eq(
              topicModelRevisions.project_id,
              topicNodeRevisions.project_id,
            ),
            eq(
              topicModelRevisions.revision,
              topicNodeRevisions.topic_model_revision,
            ),
          ),
        )
        .where(
          and(
            projectPredicate(topicNodeRevisions, scope),
            eq(topicNodeRevisions.topic_node_id, input.topicNodeId),
            eq(
              topicNodeRevisions.topic_model_revision,
              input.topicModelRevision,
            ),
            eq(topicNodeRevisions.lifecycle_state, "active"),
            projectPredicate(topicModelRevisions, scope),
            eq(
              topicModelRevisions.revision,
              input.topicModelRevision,
            ),
            eq(topicModelRevisions.status, "confirmed"),
          ),
        )
        .limit(1);
      const topic = topicRows[0];
      if (
        !topic ||
        typeof topic.label !== "string" ||
        topic.label.length < 1 ||
        topic.label.length > 200 ||
        topic.label.trim() !== topic.label
      ) {
        throw new KeywordGovernanceConflictError(
          "TOPIC_ASSIGNMENT_INVALID",
          input.expectedGovernanceRevision,
          currentRevision,
        );
      }
      clusterKey = topic.label;
    }

    if (
      input.mappingDecision === "existing_page" &&
      input.mappedSitePageId !== null
    ) {
      const pageRows = await exec
        .select({ id: sitePages.id })
        .from(sitePages)
        .where(
          and(
            projectPredicate(sitePages, scope),
            eq(sitePages.id, input.mappedSitePageId),
          ),
        )
        .limit(1);
      if (!pageRows[0]) {
        throw new KeywordGovernanceConflictError(
          "SITE_PAGE_NOT_FOUND",
          input.expectedGovernanceRevision,
          currentRevision,
        );
      }
    }

    const decisionId = this.clock.newId();
    if (!UUID.test(decisionId)) {
      throw new KeywordGovernanceIntegrityError(
        "SERVER_FACT_INVALID",
      );
    }
    const governanceRevision = input.expectedGovernanceRevision + 1;
    const reviewedProjection: KeywordGovernanceReviewedProjection = {
      projectId: scope.projectId,
      keywordId,
      governanceRevision,
      status: input.status,
      intent: input.intent,
      buyerStage: input.buyerStage,
      topicNodeId: input.topicNodeId,
      topicModelRevision: input.topicModelRevision,
      clusterKey,
      mappingDecision: input.mappingDecision,
      mappedSitePageId: input.mappedSitePageId,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable:
        currentState.reviewedProjection.earlierHistoryAvailable,
    };

    const updatedRows = await exec
      .update(keywordEntities)
      .set({
        status: input.status,
        intent: input.intent,
        buyer_stage: input.buyerStage,
        cluster_key: clusterKey,
        mapping_decision: input.mappingDecision,
        mapped_site_page_id: input.mappedSitePageId,
        mapping_review_state: "confirmed",
        mapping_revision: governanceRevision,
        updated_at: sql`greatest(
          clock_timestamp(),
          ${keywordEntities.updated_at} + interval '1 microsecond'
        )`,
      })
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, keywordId),
          eq(
            keywordEntities.mapping_revision,
            input.expectedGovernanceRevision,
          ),
          sql`exists (
            select 1
            from ${clientProjects}
            where ${clientProjects.id} = ${scope.projectId}
              and ${clientProjects.workspace_id} = ${scope.workspaceId}
              and ${clientProjects.archived_at} is null
          )`,
        ),
      )
      .returning({
        mapping_revision: keywordEntities.mapping_revision,
        updated_at: keywordEntities.updated_at,
      });
    const updated = updatedRows[0];
    if (
      !updated ||
      updated.mapping_revision !== governanceRevision ||
      !isTimestamptzInstant(updated.updated_at)
    ) {
      throw new KeywordGovernanceIntegrityError(
        "CAS_UPDATE_FAILED",
      );
    }
    const decidedAt = canonicalUtcTimestamptz(updated.updated_at);

    await exec.insert(keywordReviewDecisions).values({
      id: decisionId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      keyword_entity_id: keywordId,
      governance_revision: governanceRevision,
      decision_origin: "user",
      status: input.status,
      intent: input.intent,
      buyer_stage: input.buyerStage,
      topic_node_id: input.topicNodeId,
      topic_model_revision: input.topicModelRevision,
      cluster_key_at_decision: clusterKey,
      mapping_decision: input.mappingDecision,
      mapped_site_page_id: input.mappedSitePageId,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      analysis_invocation_id: null,
      decided_by: actorId,
      reason: input.reason,
      decided_at: decidedAt,
      reviewed_projection: { ...reviewedProjection },
    });

    const resolvedSuggestions = await exec
      .update(keywordReviewSuggestions)
      .set({
        status: "approved",
        resolution_mode:
          resolution.mode === "accepted" ? "accepted" : "edited",
        keyword_review_decision_id: decisionId,
        resolved_at: sql`clock_timestamp()`,
      })
      .where(
        and(
          projectPredicate(keywordReviewSuggestions, scope),
          eq(keywordReviewSuggestions.keyword_entity_id, keywordId),
          eq(
            keywordReviewSuggestions.expected_governance_revision,
            input.expectedGovernanceRevision,
          ),
          eq(keywordReviewSuggestions.status, "pending"),
          ...(resolution.mode === "accepted"
            ? [
                eq(
                  keywordReviewSuggestions.id,
                  resolution.suggestion.id,
                ),
                eq(
                  keywordReviewSuggestions.suggestion_version,
                  resolution.suggestion.suggestion_version,
                ),
              ]
            : []),
        ),
      )
      .returning({ id: keywordReviewSuggestions.id });
    if (
      resolvedSuggestions.length > 1 ||
      (resolution.mode === "accepted" && resolvedSuggestions.length !== 1)
    ) {
      throw new KeywordGovernanceIntegrityError("CAS_UPDATE_FAILED");
    }

    const updatedKeyword: KeywordAuthorityRow = {
      ...keyword,
      status: input.status,
      intent: input.intent,
      buyer_stage: input.buyerStage,
      cluster_key: clusterKey,
      mapping_decision: input.mappingDecision,
      mapped_site_page_id: input.mappedSitePageId,
      mapping_review_state: "confirmed",
      mapping_revision: governanceRevision,
      updated_at: decidedAt,
    };
    const insertedDecision: KeywordDecisionRow = {
      id: decisionId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      keyword_entity_id: keywordId,
      governance_revision: governanceRevision,
      decision_origin: "user",
      status: input.status,
      intent: input.intent,
      buyer_stage: input.buyerStage,
      topic_node_id: input.topicNodeId,
      topic_model_revision: input.topicModelRevision,
      cluster_key_at_decision: clusterKey,
      mapping_decision: input.mappingDecision,
      mapped_site_page_id: input.mappedSitePageId,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      decided_by: actorId,
      reason: input.reason,
      decided_at: decidedAt,
      reviewed_projection: reviewedProjection,
      created_at: decidedAt,
    };
    return {
      ...stateFromRows(updatedKeyword, insertedDecision),
      replayed: false,
    };
  }

  /**
   * Internal sibling of `applySystemApprovals` for the first generated Topic
   * Model. Prompt-local group keys resolve to exact repository-owned Topic
   * identities, while every keyword keeps its own expected governance CAS.
   * Human authority always wins and is never overwritten.
   */
  async applyGeneratedTopicAssignments(
    scope: ProjectScope,
    input: ApplyGeneratedTopicAssignmentsInput,
  ): Promise<GeneratedTopicAssignmentReport> {
    assertUuid(scope.workspaceId, "workspaceId");
    assertUuid(scope.projectId, "projectId");
    const canonical = canonicalGeneratedTopicAssignmentInput(input);
    if (canonical.assignments.length === 0) {
      return generatedAssignmentReport([]);
    }

    const groups = new Map(
      canonical.groups.map((group) => [group.groupKey, group]),
    );
    const outcomes: Array<GeneratedTopicAssignmentOutcome | undefined> =
      canonical.assignments.map((assignment) =>
        groups.has(assignment.groupKey)
          ? assignment.resolvedIntent === null
            ? skippedGeneratedAssignment(
                assignment,
                "intent_unavailable",
              )
            : undefined
          : skippedGeneratedAssignment(assignment, "unknown_group"),
      );
    if (outcomes.every((outcome) => outcome !== undefined)) {
      return generatedAssignmentReport(outcomes);
    }

    const transactional = this.exec as TransactionalExecutor;
    const run = (exec: Executor) =>
      this.applyGeneratedTopicAssignmentsWithExecutor(
        exec,
        scope,
        canonical,
        outcomes,
      );
    if (typeof transactional.transaction === "function") {
      return transactional.transaction((tx) => run(tx));
    }
    return run(this.exec);
  }

  private async applyGeneratedTopicAssignmentsWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    input: ApplyGeneratedTopicAssignmentsInput,
    outcomes: Array<GeneratedTopicAssignmentOutcome | undefined>,
  ): Promise<GeneratedTopicAssignmentReport> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    const expectedTopicRevision = input.groups[0]?.topicModelRevision ?? null;
    const latestRows = await exec
      .select({ revision: topicModelRevisions.revision })
      .from(topicModelRevisions)
      .where(
        and(
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.status, "confirmed"),
        ),
      )
      .orderBy(desc(topicModelRevisions.revision))
      .limit(1)
      .for("update");
    const latestRevision = latestRows[0]?.revision ?? null;
    if (
      expectedTopicRevision === null ||
      latestRevision !== expectedTopicRevision
    ) {
      input.assignments.forEach((assignment, index) => {
        if (outcomes[index] === undefined) {
          outcomes[index] = skippedGeneratedAssignment(
            assignment,
            "topic_revision_moved",
          );
        }
      });
      return generatedAssignmentReport(outcomes);
    }

    const candidateGroupKeys = new Set(
      input.assignments.flatMap((assignment, index) =>
        outcomes[index] === undefined ? [assignment.groupKey] : [],
      ),
    );
    const candidateGroups = input.groups.filter((group) =>
      candidateGroupKeys.has(group.groupKey),
    );
    const topicRows = (await exec
      .select({
        topic_node_id: topicNodeRevisions.topic_node_id,
        topic_model_revision: topicNodeRevisions.topic_model_revision,
        label: topicNodeRevisions.label,
      })
      .from(topicNodeRevisions)
      .innerJoin(
        topicModelRevisions,
        and(
          eq(
            topicModelRevisions.workspace_id,
            topicNodeRevisions.workspace_id,
          ),
          eq(
            topicModelRevisions.project_id,
            topicNodeRevisions.project_id,
          ),
          eq(
            topicModelRevisions.revision,
            topicNodeRevisions.topic_model_revision,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(topicNodeRevisions, scope),
          inArray(
            topicNodeRevisions.topic_node_id,
            candidateGroups.map((group) => group.topicNodeId),
          ),
          eq(
            topicNodeRevisions.topic_model_revision,
            expectedTopicRevision,
          ),
          eq(topicNodeRevisions.lifecycle_state, "active"),
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.revision, expectedTopicRevision),
          eq(topicModelRevisions.status, "confirmed"),
        ),
      )) as ConfirmedGeneratedTopicRow[];
    const topicById = new Map(
      topicRows.map((row) => [row.topic_node_id, row]),
    );
    const topicByGroup = new Map<string, ConfirmedGeneratedTopicRow>();
    for (const group of candidateGroups) {
      const topic = topicById.get(group.topicNodeId);
      if (topic?.topic_model_revision === group.topicModelRevision) {
        topicByGroup.set(group.groupKey, topic);
      }
    }
    input.assignments.forEach((assignment, index) => {
      if (
        outcomes[index] === undefined &&
        !topicByGroup.has(assignment.groupKey)
      ) {
        outcomes[index] = skippedGeneratedAssignment(
          assignment,
          "topic_node_absent",
        );
      }
    });

    const writableAssignments = input.assignments.filter(
      (_assignment, index) => outcomes[index] === undefined,
    );
    if (writableAssignments.length === 0) {
      return generatedAssignmentReport(outcomes);
    }
    const humanRows = (await exec
      .select({
        keyword_entity_id: keywordReviewDecisions.keyword_entity_id,
      })
      .from(keywordReviewDecisions)
      .where(
        and(
          projectPredicate(keywordReviewDecisions, scope),
          eq(keywordReviewDecisions.decision_origin, "user"),
          inArray(
            keywordReviewDecisions.keyword_entity_id,
            writableAssignments.map((assignment) => assignment.keywordId),
          ),
        ),
      )) as { readonly keyword_entity_id: string }[];
    const humanDecided = new Set(
      humanRows.map((row) => row.keyword_entity_id),
    );

    for (const [index, assignment] of input.assignments.entries()) {
      if (outcomes[index] !== undefined) continue;
      outcomes[index] = await this.applyOneGeneratedTopicAssignment(
        exec,
        scope,
        assignment,
        assignment.resolvedIntent as GeneratedTopicResolvedIntent,
        topicByGroup.get(assignment.groupKey)!,
        humanDecided,
      );
    }
    return generatedAssignmentReport(outcomes);
  }

  private async applyOneGeneratedTopicAssignment(
    exec: Executor,
    scope: ProjectScope,
    input: GeneratedTopicKeywordAssignmentInput,
    intent: GeneratedTopicResolvedIntent,
    topic: ConfirmedGeneratedTopicRow,
    humanDecided: ReadonlySet<string>,
  ): Promise<GeneratedTopicAssignmentOutcome> {
    if (humanDecided.has(input.keywordId)) {
      return skippedGeneratedAssignment(
        input,
        "human_decision_exists",
      );
    }
    const keyword = await this.findKeyword(
      exec,
      scope,
      input.keywordId,
      true,
    );
    if (!keyword) {
      return skippedGeneratedAssignment(input, "keyword_absent");
    }
    if (keyword.mapping_revision !== input.expectedGovernanceRevision) {
      return skippedGeneratedAssignment(input, "revision_moved");
    }
    if (
      keyword.mapping_revision >=
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
    ) {
      return skippedGeneratedAssignment(input, "revision_exhausted");
    }
    const current = await this.findLatestDecision(
      exec,
      scope,
      input.keywordId,
    );
    if (!current) {
      return skippedGeneratedAssignment(input, "ledger_unreadable");
    }
    if (current.decision_origin === "user") {
      return skippedGeneratedAssignment(
        input,
        "human_decision_exists",
      );
    }
    if (current.governance_revision !== input.expectedGovernanceRevision) {
      return skippedGeneratedAssignment(input, "revision_moved");
    }
    if (
      current.decision_origin === "migration_baseline" &&
      current.review_state === "confirmed"
    ) {
      return skippedGeneratedAssignment(
        input,
        "human_decision_exists",
      );
    }
    let currentState: CurrentKeywordGovernance;
    try {
      currentState = stateFromRows(keyword, current);
    } catch (error) {
      if (error instanceof KeywordGovernanceIntegrityError) {
        return skippedGeneratedAssignment(input, "ledger_unreadable");
      }
      throw error;
    }
    const decisionId = this.clock.newId();
    if (!UUID.test(decisionId)) {
      throw new KeywordGovernanceIntegrityError("SERVER_FACT_INVALID");
    }
    const governanceRevision = input.expectedGovernanceRevision + 1;
    const reviewedProjection: KeywordGovernanceReviewedProjection = {
      projectId: scope.projectId,
      keywordId: input.keywordId,
      governanceRevision,
      status: "approved",
      intent: intent.value,
      buyerStage: keyword.buyer_stage,
      topicNodeId: topic.topic_node_id,
      topicModelRevision: topic.topic_model_revision,
      clusterKey: topic.label,
      mappingDecision:
        keyword.mapping_decision as KeywordReviewDecision["mappingDecision"],
      mappedSitePageId: keyword.mapped_site_page_id,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable:
        currentState.reviewedProjection.earlierHistoryAvailable,
    };
    const updatedRows = await exec
      .update(keywordEntities)
      .set({
        status: "approved",
        intent: intent.value,
        cluster_key: topic.label,
        mapping_review_state: "confirmed",
        mapping_revision: governanceRevision,
        updated_at: sql`greatest(
          clock_timestamp(),
          ${keywordEntities.updated_at} + interval '1 microsecond'
        )`,
      })
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, input.keywordId),
          eq(
            keywordEntities.mapping_revision,
            input.expectedGovernanceRevision,
          ),
          sql`exists (
            select 1
            from ${clientProjects}
            where ${clientProjects.id} = ${scope.projectId}
              and ${clientProjects.workspace_id} = ${scope.workspaceId}
              and ${clientProjects.archived_at} is null
          )`,
        ),
      )
      .returning({
        mapping_revision: keywordEntities.mapping_revision,
        updated_at: keywordEntities.updated_at,
      });
    const updated = updatedRows[0];
    if (!updated) {
      return skippedGeneratedAssignment(input, "conflict");
    }
    if (
      updated.mapping_revision !== governanceRevision ||
      !isTimestamptzInstant(updated.updated_at)
    ) {
      throw new KeywordGovernanceIntegrityError("CAS_UPDATE_FAILED");
    }
    const decidedAt = canonicalUtcTimestamptz(updated.updated_at);
    await exec.insert(keywordReviewDecisions).values({
      id: decisionId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      keyword_entity_id: input.keywordId,
      governance_revision: governanceRevision,
      decision_origin: "system_suggestion",
      status: "approved",
      intent: intent.value,
      buyer_stage: keyword.buyer_stage,
      topic_node_id: topic.topic_node_id,
      topic_model_revision: topic.topic_model_revision,
      cluster_key_at_decision: topic.label,
      mapping_decision: keyword.mapping_decision,
      mapped_site_page_id: keyword.mapped_site_page_id,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      analysis_invocation_id: intent.analysisInvocationId,
      decided_by: null,
      reason: GENERATED_TOPIC_ASSIGNMENT_REASON,
      decided_at: decidedAt,
      reviewed_projection: { ...reviewedProjection },
    });
    return {
      groupKey: input.groupKey,
      keywordId: input.keywordId,
      applied: true,
      skipped: null,
      governanceRevision,
    };
  }

  /**
   * Append actorless `system_suggestion` approvals for candidate keywords whose
   * evidence the caller has already proven, so an ingested library becomes
   * visible to the diagnostic freeze without a human ever pretending to have
   * reviewed it.
   *
   * Truthfulness rules enforced here, not by the caller:
   *   - `decision_origin` is always `system_suggestion` and `decided_by` is
   *     always NULL, so the ledger can never present this as a user decision;
   *   - a keyword with ANY `user` decision in its append-only ledger is skipped
   *     forever — a human decision outranks every automated one;
   *   - a keyword that is no longer `candidate` + `unreviewed` under the row
   *     lock is skipped, which is also what makes repeated runs idempotent;
   *   - `intent` and `buyer_stage` are carried over unchanged, because no
   *     provider Observation can support a classification judgement.
   *
   * The caller owns the transaction whenever it already has one (Analysis
   * Refresh runs this inside the open Growth Audit transaction); a pooled
   * executor is wrapped so the batch stays atomic either way.
   */
  async applySystemApprovals(
    scope: ProjectScope,
    inputs: readonly SystemKeywordApprovalInput[],
  ): Promise<readonly SystemKeywordApprovalOutcome[]> {
    assertUuid(scope.workspaceId, "workspaceId");
    assertUuid(scope.projectId, "projectId");
    const canonical = inputs.map(canonicalSystemApproval);
    if (canonical.length > MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH) {
      throw new RangeError(
        `inputs must contain at most ${MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH} keywords`,
      );
    }
    if (new Set(canonical.map((input) => input.keywordId)).size !==
      canonical.length) {
      throw new RangeError("inputs must not repeat a keywordId");
    }
    if (canonical.length === 0) return [];

    const transactional = this.exec as TransactionalExecutor;
    if (typeof transactional.transaction === "function") {
      return transactional.transaction((tx) =>
        this.applySystemApprovalsWithExecutor(tx, scope, canonical),
      );
    }
    return this.applySystemApprovalsWithExecutor(
      this.exec,
      scope,
      canonical,
    );
  }

  private async applySystemApprovalsWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    inputs: readonly SystemKeywordApprovalInput[],
  ): Promise<readonly SystemKeywordApprovalOutcome[]> {
    // The same writer lock a human review takes, so an operator review can
    // never interleave between the membership read and the automated write.
    await acquireTopicGovernanceProjectWriterLock(exec, scope);

    const keywordIds = inputs.map((input) => input.keywordId);
    const humanDecided = new Set(
      (
        (await exec
          .select({
            keyword_entity_id:
              keywordReviewDecisions.keyword_entity_id,
          })
          .from(keywordReviewDecisions)
          .where(
            and(
              projectPredicate(keywordReviewDecisions, scope),
              eq(keywordReviewDecisions.decision_origin, "user"),
              inArray(
                keywordReviewDecisions.keyword_entity_id,
                keywordIds,
              ),
            ),
          )) as { readonly keyword_entity_id: string }[]
      ).map((row) => row.keyword_entity_id),
    );

    const requestedPageIds = [
      ...new Set(
        inputs.flatMap((input) =>
          input.mappedSitePageId === null ? [] : [input.mappedSitePageId],
        ),
      ),
    ];
    const knownPageIds = new Set(
      requestedPageIds.length === 0
        ? []
        : (
            (await exec
              .select({ id: sitePages.id })
              .from(sitePages)
              .where(
                and(
                  projectPredicate(sitePages, scope),
                  inArray(sitePages.id, requestedPageIds),
                ),
              )) as { readonly id: string }[]
          ).map((row) => row.id),
    );

    const outcomes: SystemKeywordApprovalOutcome[] = [];
    for (const input of inputs) {
      outcomes.push(
        await this.applyOneSystemApproval(
          exec,
          scope,
          input,
          humanDecided,
          knownPageIds,
        ),
      );
    }
    return outcomes;
  }

  private async applyOneSystemApproval(
    exec: Executor,
    scope: ProjectScope,
    input: SystemKeywordApprovalInput,
    humanDecided: ReadonlySet<string>,
    knownPageIds: ReadonlySet<string>,
  ): Promise<SystemKeywordApprovalOutcome> {
    const skip = (
      reason: SystemKeywordApprovalSkip,
    ): SystemKeywordApprovalOutcome => ({
      keywordId: input.keywordId,
      applied: false,
      skipped: reason,
      governanceRevision: null,
    });

    if (humanDecided.has(input.keywordId)) {
      return skip("human_decision_exists");
    }
    if (
      input.mappedSitePageId !== null &&
      !knownPageIds.has(input.mappedSitePageId)
    ) {
      return skip("site_page_absent");
    }

    const keyword = await this.findKeyword(
      exec,
      scope,
      input.keywordId,
      true,
    );
    if (!keyword) return skip("keyword_absent");
    // Re-proved under the row lock: this is the idempotency guard. A second
    // Analysis Refresh sees `approved` + `confirmed` and writes nothing.
    if (
      keyword.status !== "candidate" ||
      keyword.mapping_review_state !== "unreviewed"
    ) {
      return skip("already_reviewed");
    }
    if (
      keyword.mapping_revision !== input.expectedGovernanceRevision ||
      keyword.mapping_revision >=
        MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
    ) {
      return skip(
        keyword.mapping_revision !== input.expectedGovernanceRevision
          ? "revision_moved"
          : "revision_exhausted",
      );
    }

    const current = await this.findLatestDecision(
      exec,
      scope,
      input.keywordId,
    );
    if (!current) return skip("ledger_unreadable");
    if (current.decision_origin === "user") {
      return skip("human_decision_exists");
    }
    if (current.governance_revision !== input.expectedGovernanceRevision) {
      return skip("revision_moved");
    }
    let currentState: CurrentKeywordGovernance;
    try {
      currentState = stateFromRows(keyword, current);
    } catch (error) {
      // An unreadable ledger is reported, never repaired: the keyword keeps
      // its previous governance and the strict readers keep failing closed.
      if (error instanceof KeywordGovernanceIntegrityError) {
        return skip("ledger_unreadable");
      }
      throw error;
    }

    const decisionId = this.clock.newId();
    if (!UUID.test(decisionId)) {
      throw new KeywordGovernanceIntegrityError("SERVER_FACT_INVALID");
    }
    const governanceRevision = input.expectedGovernanceRevision + 1;
    const reviewedProjection: KeywordGovernanceReviewedProjection = {
      projectId: scope.projectId,
      keywordId: input.keywordId,
      governanceRevision,
      status: "approved",
      intent: keyword.intent,
      buyerStage: keyword.buyer_stage,
      topicNodeId: null,
      topicModelRevision: null,
      clusterKey: input.clusterKey,
      mappingDecision: input.mappingDecision,
      mappedSitePageId: input.mappedSitePageId,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable:
        currentState.reviewedProjection.earlierHistoryAvailable,
    };

    const updatedRows = await exec
      .update(keywordEntities)
      .set({
        status: "approved",
        cluster_key: input.clusterKey,
        mapping_decision: input.mappingDecision,
        mapped_site_page_id: input.mappedSitePageId,
        mapping_review_state: "confirmed",
        mapping_revision: governanceRevision,
        updated_at: sql`greatest(
          clock_timestamp(),
          ${keywordEntities.updated_at} + interval '1 microsecond'
        )`,
      })
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, input.keywordId),
          eq(
            keywordEntities.mapping_revision,
            input.expectedGovernanceRevision,
          ),
          sql`exists (
            select 1
            from ${clientProjects}
            where ${clientProjects.id} = ${scope.projectId}
              and ${clientProjects.workspace_id} = ${scope.workspaceId}
              and ${clientProjects.archived_at} is null
          )`,
        ),
      )
      .returning({
        mapping_revision: keywordEntities.mapping_revision,
        updated_at: keywordEntities.updated_at,
      });
    const updated = updatedRows[0];
    if (
      !updated ||
      updated.mapping_revision !== governanceRevision ||
      !isTimestamptzInstant(updated.updated_at)
    ) {
      throw new KeywordGovernanceIntegrityError("CAS_UPDATE_FAILED");
    }
    const decidedAt = canonicalUtcTimestamptz(updated.updated_at);

    await exec.insert(keywordReviewDecisions).values({
      id: decisionId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      keyword_entity_id: input.keywordId,
      governance_revision: governanceRevision,
      decision_origin: "system_suggestion",
      status: "approved",
      intent: keyword.intent,
      buyer_stage: keyword.buyer_stage,
      topic_node_id: null,
      topic_model_revision: null,
      cluster_key_at_decision: input.clusterKey,
      mapping_decision: input.mappingDecision,
      mapped_site_page_id: input.mappedSitePageId,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      analysis_invocation_id: null,
      // An automated decision has no human decision maker. Migration 0032
      // relaxed the actor CHECK exactly so this can stay honestly NULL.
      decided_by: null,
      reason: input.reason,
      decided_at: decidedAt,
      reviewed_projection: { ...reviewedProjection },
    });

    return {
      keywordId: input.keywordId,
      applied: true,
      skipped: null,
      governanceRevision,
    };
  }
}
