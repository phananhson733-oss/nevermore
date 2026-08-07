import { randomUUID } from "node:crypto";
import type {
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
} from "./keywords.ts";

export type ReviewKeywordInput = ReviewKeywordRequest;

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

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) {
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
        ),
      );
    }
    return this.reviewWithExecutor(
      this.exec,
      scope,
      keywordId,
      actorId,
      canonical,
    );
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
        exactReplay(current, actorId, input)
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
      decided_by: actorId,
      reason: input.reason,
      decided_at: decidedAt,
      reviewed_projection: { ...reviewedProjection },
    });

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
