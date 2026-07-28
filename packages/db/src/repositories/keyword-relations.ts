import { randomUUID } from "node:crypto";
import {
  DecideKeywordRelationRequest,
  GrowthMapKeywordRelation as GrowthMapKeywordRelationSchema,
  KeywordRelationCandidate as KeywordRelationCandidateSchema,
  KeywordRelationDecision as KeywordRelationDecisionSchema,
  KEYWORD_RELATION_RULE_VERSION,
  MAX_POSTGRES_INTEGER_REVISION,
  type DecideKeywordRelationRequest as DecideKeywordRelationInput,
  type GrowthMapKeywordRelation,
  type KeywordRelationCandidate,
  type KeywordRelationDecision,
  type KeywordRelationDecisionResult,
  type KeywordRelationStaleReason,
} from "@sf/contracts";
import { sql, type SQL } from "drizzle-orm";
import {
  canonicalUtcTimestamptz,
  isTimestamptzInstant,
} from "../instant.ts";
import {
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import { acquireTopicGovernanceProjectWriterLock } from "./topic-models.ts";

export const MAX_KEYWORD_RELATION_PAGE_SIZE = 100;
export const MAX_KEYWORD_RELATION_REFRESH_PAIRS = 10_000;
export const MAX_KEYWORD_RELATION_KEYWORD_LOOKUP = 50;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const STALE_REASONS = new Set<KeywordRelationStaleReason>([
  "candidate_superseded",
  "keyword_unavailable",
  "governance_revision_changed",
  "mapping_changed",
  "intent_changed",
  "market_changed",
  "language_changed",
]);

export interface KeywordRelationClock {
  readonly newId: () => string;
  readonly now: () => string;
}

const DEFAULT_CLOCK: KeywordRelationClock = {
  newId: randomUUID,
  now: () => new Date().toISOString(),
};

export interface KeywordRelationListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  /**
   * Optional bounded lookup for one visible Keyword Library page. A relation
   * matches when either canonical pair member is present.
   */
  readonly keywordIds?: readonly string[];
}

export interface KeywordRelationListPage {
  readonly rows: GrowthMapKeywordRelation[];
  readonly nextCursor: string | null;
}

export interface KeywordRelationRefreshResult {
  readonly eligiblePairCount: number;
  readonly createdRelationCount: number;
  readonly createdCandidateCount: number;
}

export type KeywordRelationConflictCode =
  | "PROJECT_NOT_FOUND"
  | "RELATION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "REVISION_EXHAUSTED"
  | "CANDIDATE_STALE"
  | "PAIR_MISMATCH"
  | "FOLD_GRAPH_CONFLICT";

export class KeywordRelationConflictError extends Error {
  override readonly name = "KeywordRelationConflictError";

  constructor(
    readonly code: KeywordRelationConflictCode,
    readonly expectedRevision: number | null = null,
    readonly currentRevision: number | null = null,
    readonly currentCandidateId: string | null = null,
  ) {
    super(
      {
        PROJECT_NOT_FOUND:
          "The active project does not belong to the workspace",
        RELATION_NOT_FOUND:
          "The Keyword Relation does not belong to the active project",
        REVISION_CONFLICT:
          "The Keyword Relation revision is stale",
        REVISION_EXHAUSTED:
          "The Keyword Relation revision cannot be incremented",
        CANDIDATE_STALE:
          "The decision must target the exact current duplicate candidate",
        PAIR_MISMATCH:
          "The fold decision must use the exact relation pair",
        FOLD_GRAPH_CONFLICT:
          "The fold would create a chain or cycle",
      }[code],
    );
  }
}

export type KeywordRelationIntegrityCode =
  | "PAIR_LIMIT_EXCEEDED"
  | "REFRESH_RESULT_INVALID"
  | "RELATION_PROJECTION_INVALID"
  | "RELATION_PROJECTION_DUPLICATE"
  | "DECISION_INSERT_FAILED"
  | "DECISION_RESULT_DIVERGED"
  | "SERVER_FACT_INVALID";

export class KeywordRelationIntegrityError extends Error {
  override readonly name = "KeywordRelationIntegrityError";

  constructor(readonly code: KeywordRelationIntegrityCode) {
    super(`Keyword Relation authority failed integrity validation: ${code}`);
  }
}

interface RefreshRow extends Record<string, unknown> {
  readonly project_exists: boolean;
  readonly eligible_pair_count: number | string;
  readonly created_relation_count: number | string;
  readonly created_candidate_count: number | string;
}

interface RelationProjectionRow extends Record<string, unknown> {
  readonly workspace_id: string;
  readonly project_id: string;
  readonly relation_id: string;
  readonly relation_keyword_a_id: string;
  readonly relation_keyword_b_id: string;
  readonly candidate_id: string;
  readonly candidate_revision: number;
  readonly rule_version: string;
  readonly keyword_a_id: string;
  readonly keyword_a_display_keyword: string;
  readonly keyword_a_normalized_keyword: string;
  readonly keyword_a_governance_revision: number;
  readonly keyword_a_topic_node_id: string | null;
  readonly keyword_a_topic_model_revision: number | null;
  readonly keyword_b_id: string;
  readonly keyword_b_display_keyword: string;
  readonly keyword_b_normalized_keyword: string;
  readonly keyword_b_governance_revision: number;
  readonly keyword_b_topic_node_id: string | null;
  readonly keyword_b_topic_model_revision: number | null;
  readonly mapped_site_page_id: string;
  readonly normalized_intent: string;
  readonly market: string;
  readonly language_tag: string;
  readonly same_confirmed_topic: boolean;
  readonly lexical_token_overlap: number | string;
  readonly serp_overlap_availability: string;
  readonly serp_overlap: number | string | null;
  readonly serp_overlap_limitation: string | null;
  readonly evidence_hash: string;
  readonly candidate_generated_at: string;
  readonly stale_reasons: unknown;
  readonly decision_id: string | null;
  readonly decision_candidate_id: string | null;
  readonly relation_revision: number | null;
  readonly decision_kind: string | null;
  readonly primary_keyword_id: string | null;
  readonly supporting_keyword_id: string | null;
  readonly reason: string | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
}

interface InsertDecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly relation_revision: number;
}

interface TransactionalExecutor {
  transaction<T>(run: (tx: Executor) => Promise<T>): Promise<T>;
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) {
    throw new RangeError(`${label} must be a canonical UUID`);
  }
}

function assertScope(
  scope: ProjectScope,
  relationId?: string,
  actorId?: string,
): void {
  assertUuid(scope.workspaceId, "workspaceId");
  assertUuid(scope.projectId, "projectId");
  if (relationId !== undefined) assertUuid(relationId, "relationId");
  if (actorId !== undefined) assertUuid(actorId, "actorId");
}

function checkedInteger(
  value: number | string,
  maximum: number,
  code: KeywordRelationIntegrityCode,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : /^[0-9]+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximum
  ) {
    throw new KeywordRelationIntegrityError(code);
  }
  return parsed;
}

function checkedRatio(
  value: number | string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : /^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  return parsed;
}

function checkedInstant(
  value: string,
): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
}

function checkedStaleReasons(
  value: unknown,
): KeywordRelationStaleReason[] {
  if (!Array.isArray(value)) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  const reasons: KeywordRelationStaleReason[] = [];
  for (const reason of value) {
    if (
      typeof reason !== "string" ||
      !STALE_REASONS.has(reason as KeywordRelationStaleReason) ||
      reasons.includes(reason as KeywordRelationStaleReason)
    ) {
      throw new KeywordRelationIntegrityError(
        "RELATION_PROJECTION_INVALID",
      );
    }
    reasons.push(reason as KeywordRelationStaleReason);
  }
  return reasons;
}

function projectCandidate(
  row: RelationProjectionRow,
): KeywordRelationCandidate {
  const serpAvailability = row.serp_overlap_availability;
  const serpOverlap =
    row.serp_overlap === null ? null : checkedRatio(row.serp_overlap);
  const candidate = {
    candidateId: row.candidate_id,
    relationId: row.relation_id,
    projectId: row.project_id,
    candidateRevision: row.candidate_revision,
    ruleVersion: row.rule_version,
    keywordA: {
      keywordId: row.keyword_a_id,
      displayKeyword: row.keyword_a_display_keyword,
      normalizedKeyword: row.keyword_a_normalized_keyword,
      governanceRevision: row.keyword_a_governance_revision,
      marketCode: row.market,
      languageTag: row.language_tag,
      intent: row.normalized_intent,
      topicNodeId: row.keyword_a_topic_node_id,
      topicModelRevision: row.keyword_a_topic_model_revision,
      mappedSitePageId: row.mapped_site_page_id,
    },
    keywordB: {
      keywordId: row.keyword_b_id,
      displayKeyword: row.keyword_b_display_keyword,
      normalizedKeyword: row.keyword_b_normalized_keyword,
      governanceRevision: row.keyword_b_governance_revision,
      marketCode: row.market,
      languageTag: row.language_tag,
      intent: row.normalized_intent,
      topicNodeId: row.keyword_b_topic_node_id,
      topicModelRevision: row.keyword_b_topic_model_revision,
      mappedSitePageId: row.mapped_site_page_id,
    },
    signals: {
      sameConfirmedMappedPage: true,
      sameReviewedIntent: true,
      sameMarket: true,
      sameLanguage: true,
      sameConfirmedTopic: row.same_confirmed_topic,
      lexicalTokenOverlap: checkedRatio(row.lexical_token_overlap),
      serpOverlap: {
        availability: serpAvailability,
        value: serpOverlap,
        limitation: row.serp_overlap_limitation,
      },
    },
    evidenceHash: row.evidence_hash,
    generatedAt: checkedInstant(row.candidate_generated_at),
  };
  const parsed = KeywordRelationCandidateSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  return parsed.data;
}

function projectDecision(
  row: RelationProjectionRow,
): KeywordRelationDecision | null {
  const identityFields = [
    row.decision_id,
    row.decision_candidate_id,
    row.relation_revision,
    row.decision_kind,
    row.reason,
    row.decided_by,
    row.decided_at,
  ];
  if (identityFields.every((value) => value === null)) {
    if (
      row.primary_keyword_id !== null ||
      row.supporting_keyword_id !== null
    ) {
      throw new KeywordRelationIntegrityError(
        "RELATION_PROJECTION_INVALID",
      );
    }
    return null;
  }
  if (identityFields.some((value) => value === null)) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  const decision = {
    decisionId: row.decision_id,
    relationId: row.relation_id,
    candidateId: row.decision_candidate_id,
    projectId: row.project_id,
    relationRevision: row.relation_revision,
    decisionKind: row.decision_kind,
    primaryKeywordId: row.primary_keyword_id,
    supportingKeywordId: row.supporting_keyword_id,
    reason: row.reason,
    decidedBy: row.decided_by,
    decidedAt: checkedInstant(row.decided_at!),
  };
  const parsed = KeywordRelationDecisionSchema.safeParse(decision);
  if (!parsed.success) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  return parsed.data;
}

function projectRelation(
  row: RelationProjectionRow,
  scope: ProjectScope,
): GrowthMapKeywordRelation {
  if (
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId ||
    row.relation_keyword_a_id !== row.keyword_a_id ||
    row.relation_keyword_b_id !== row.keyword_b_id ||
    !UUID.test(row.relation_id) ||
    !SHA256.test(row.evidence_hash)
  ) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  const candidate = projectCandidate(row);
  const staleReasons = checkedStaleReasons(row.stale_reasons);
  const candidateState =
    staleReasons.length === 0 ? "current" : "stale";
  const decision = projectDecision(row);
  const currentRelationRevision =
    decision?.relationRevision ?? 0;
  const decisionState =
    decision === null
      ? "none"
      : candidateState === "current" &&
          decision.candidateId === candidate.candidateId
        ? "active"
        : "stale";
  const isEffectivelyFolded =
    decisionState === "active" &&
    decision?.decisionKind === "primary_supporting";
  const displayState =
    candidateState === "stale" || decisionState === "stale"
      ? "stale"
      : decision === null
        ? "possible_duplicate"
        : ({
            primary_supporting: "folded",
            keep_separate: "kept_separate",
            park_secondary: "parked_secondary",
            needs_research: "needs_research",
          } as const)[decision.decisionKind];
  const relation = {
    projectId: scope.projectId,
    relationId: row.relation_id,
    candidate,
    candidateState,
    staleReasons,
    currentRelationRevision,
    decision,
    decisionState,
    displayState,
    isEffectivelyFolded,
    primaryKeywordId: isEffectivelyFolded
      ? decision!.primaryKeywordId
      : null,
    supportingKeywordId: isEffectivelyFolded
      ? decision!.supportingKeywordId
      : null,
  };
  const parsed = GrowthMapKeywordRelationSchema.safeParse(relation);
  if (!parsed.success) {
    throw new KeywordRelationIntegrityError(
      "RELATION_PROJECTION_INVALID",
    );
  }
  return parsed.data;
}

function exactReplay(
  decision: KeywordRelationDecision,
  actorId: string,
  input: DecideKeywordRelationInput,
): boolean {
  return (
    decision.candidateId === input.candidateId &&
    decision.decisionKind === input.decisionKind &&
    decision.primaryKeywordId === input.primaryKeywordId &&
    decision.supportingKeywordId === input.supportingKeywordId &&
    decision.reason === input.reason &&
    decision.decidedBy === actorId
  );
}

function safeDecisionFacts(clock: KeywordRelationClock): {
  readonly id: string;
  readonly now: string;
} {
  const id = clock.newId();
  const now = clock.now();
  if (!UUID.test(id) || !isTimestamptzInstant(now)) {
    throw new KeywordRelationIntegrityError("SERVER_FACT_INVALID");
  }
  return { id, now: canonicalUtcTimestamptz(now) };
}

function postgresCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function relationProjectionStatement(
  scope: ProjectScope,
  relationId: string | null,
  cursor: { readonly timestamp: string; readonly id: string } | null,
  keywordIds: readonly string[] | null,
  limit: number,
): SQL {
  const relationFilter =
    relationId === null
      ? sql``
      : sql`and relation.id = ${relationId}::uuid`;
  const cursorFilter =
    cursor === null
      ? sql``
      : sql`
          and (
            candidate.generated_at,
            relation.id
          ) < (
            ${cursor.timestamp}::timestamptz,
            ${cursor.id}::uuid
          )
        `;
  const keywordFilter =
    keywordIds === null
      ? sql``
      : sql`
          and (
            relation.keyword_a_id in (
              ${sql.join(
                keywordIds.map((keywordId) => sql`${keywordId}::uuid`),
                sql`, `,
              )}
            )
            or relation.keyword_b_id in (
              ${sql.join(
                keywordIds.map((keywordId) => sql`${keywordId}::uuid`),
                sql`, `,
              )}
            )
          )
        `;
  return sql`
    select
      relation.workspace_id,
      relation.project_id,
      relation.id as relation_id,
      relation.keyword_a_id as relation_keyword_a_id,
      relation.keyword_b_id as relation_keyword_b_id,
      candidate.id as candidate_id,
      candidate.candidate_revision,
      candidate.rule_version,
      candidate.keyword_a_id,
      candidate.keyword_a_display_keyword,
      candidate.keyword_a_normalized_keyword,
      candidate.keyword_a_governance_revision,
      candidate.keyword_a_topic_node_id,
      candidate.keyword_a_topic_model_revision,
      candidate.keyword_b_id,
      candidate.keyword_b_display_keyword,
      candidate.keyword_b_normalized_keyword,
      candidate.keyword_b_governance_revision,
      candidate.keyword_b_topic_node_id,
      candidate.keyword_b_topic_model_revision,
      candidate.mapped_site_page_id,
      candidate.normalized_intent,
      candidate.market,
      candidate.language_tag,
      candidate.same_confirmed_topic,
      candidate.lexical_token_overlap,
      candidate.serp_overlap_availability,
      candidate.serp_overlap,
      candidate.serp_overlap_limitation,
      candidate.evidence_hash,
      candidate.generated_at::text as candidate_generated_at,
      app.keyword_relation_candidate_stale_reasons(
        candidate.id
      ) as stale_reasons,
      decision.id as decision_id,
      decision.candidate_id as decision_candidate_id,
      decision.relation_revision,
      decision.decision_kind,
      decision.primary_keyword_id,
      decision.supporting_keyword_id,
      decision.reason,
      decision.decided_by,
      decision.decided_at::text as decided_at
    from app.keyword_relation_identities relation
    inner join app.client_projects project
      on project.workspace_id = relation.workspace_id
     and project.id = relation.project_id
     and project.archived_at is null
    inner join lateral (
      select latest.*
      from app.keyword_relation_candidates latest
      where latest.workspace_id = relation.workspace_id
        and latest.project_id = relation.project_id
        and latest.relation_id = relation.id
      order by
        latest.candidate_revision desc,
        latest.id desc
      limit 1
    ) candidate on true
    left join lateral (
      select latest.*
      from app.keyword_relation_decisions latest
      where latest.workspace_id = relation.workspace_id
        and latest.project_id = relation.project_id
        and latest.relation_id = relation.id
      order by
        latest.relation_revision desc,
        latest.id desc
      limit 1
    ) decision on true
    where relation.workspace_id = ${scope.workspaceId}::uuid
      and relation.project_id = ${scope.projectId}::uuid
      ${relationFilter}
      ${cursorFilter}
      ${keywordFilter}
    order by candidate.generated_at desc, relation.id desc
    limit ${limit}
  `;
}

export class KeywordRelationsRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: KeywordRelationClock = DEFAULT_CLOCK,
  ) {
    super(exec);
  }

  async refreshCandidates(
    scope: ProjectScope,
  ): Promise<KeywordRelationRefreshResult> {
    assertScope(scope);
    return this.inTransaction((exec) =>
      this.refreshCandidatesWithExecutor(exec, scope),
    );
  }

  async listByProject(
    scope: ProjectScope,
    options: KeywordRelationListOptions,
  ): Promise<KeywordRelationListPage> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_KEYWORD_RELATION_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_KEYWORD_RELATION_PAGE_SIZE}`,
      );
    }
    const cursor =
      options.cursor === null
        ? null
        : decodeTimestampUuidCursor(options.cursor);
    if (options.cursor !== null && cursor === null) {
      return { rows: [], nextCursor: null };
    }
    const keywordIds = options.keywordIds ?? null;
    if (
      keywordIds !== null &&
      (keywordIds.length < 1 ||
        keywordIds.length > MAX_KEYWORD_RELATION_KEYWORD_LOOKUP)
    ) {
      throw new RangeError(
        `keywordIds must contain 1 to ${MAX_KEYWORD_RELATION_KEYWORD_LOOKUP} UUIDs`,
      );
    }
    if (keywordIds !== null) {
      const unique = new Set(keywordIds);
      if (
        unique.size !== keywordIds.length ||
        keywordIds.some((keywordId) => !UUID.test(keywordId))
      ) {
        throw new RangeError(
          "keywordIds must contain unique canonical UUIDs",
        );
      }
    }
    const result = await this.exec.execute<RelationProjectionRow>(
      relationProjectionStatement(
        scope,
        null,
        cursor,
        keywordIds,
        options.limit + 1,
      ),
    );
    const relations = result.rows.map((row) =>
      projectRelation(row, scope),
    );
    const hasNext = relations.length > options.limit;
    const rows = hasNext
      ? relations.slice(0, options.limit)
      : relations;
    const lastRow = hasNext ? result.rows[options.limit - 1] : null;
    return {
      rows,
      nextCursor:
        lastRow === null || lastRow === undefined
          ? null
          : encodeTimestampUuidCursor(
              checkedInstant(lastRow.candidate_generated_at),
              lastRow.relation_id,
            ),
    };
  }

  async findById(
    scope: ProjectScope,
    relationId: string,
  ): Promise<GrowthMapKeywordRelation | null> {
    assertScope(scope, relationId);
    const result = await this.exec.execute<RelationProjectionRow>(
      relationProjectionStatement(scope, relationId, null, null, 2),
    );
    if (result.rows.length > 1) {
      throw new KeywordRelationIntegrityError(
        "RELATION_PROJECTION_DUPLICATE",
      );
    }
    const row = result.rows[0];
    return row ? projectRelation(row, scope) : null;
  }

  async decide(
    scope: ProjectScope,
    relationId: string,
    actorId: string,
    input: DecideKeywordRelationInput,
  ): Promise<KeywordRelationDecisionResult> {
    assertScope(scope, relationId, actorId);
    const parsed = DecideKeywordRelationRequest.parse(input);
    return this.inTransaction((exec) =>
      this.decideWithExecutor(
        exec,
        scope,
        relationId,
        actorId,
        parsed,
      ),
    );
  }

  private async inTransaction<T>(
    run: (exec: Executor) => Promise<T>,
  ): Promise<T> {
    const transactional = this.exec as TransactionalExecutor;
    if (typeof transactional.transaction === "function") {
      return transactional.transaction((tx) => run(tx));
    }
    return run(this.exec);
  }

  private async refreshCandidatesWithExecutor(
    exec: Executor,
    scope: ProjectScope,
  ): Promise<KeywordRelationRefreshResult> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    const result = await exec.execute<RefreshRow>(sql`
      with
      active_project as materialized (
        select project.id
        from app.client_projects project
        where project.workspace_id = ${scope.workspaceId}::uuid
          and project.id = ${scope.projectId}::uuid
          and project.archived_at is null
      ),
      eligible_keywords as materialized (
        select
          entity.id,
          entity.display_keyword,
          entity.normalized_keyword,
          entity.mapping_revision as governance_revision,
          entity.market,
          entity.language_tag,
          entity.intent,
          entity.mapped_site_page_id,
          review.topic_node_id,
          review.topic_model_revision
        from app.keyword_entities entity
        inner join active_project project
          on project.id = entity.project_id
        inner join app.keyword_review_decisions review
          on review.workspace_id = entity.workspace_id
         and review.project_id = entity.project_id
         and review.keyword_entity_id = entity.id
         and review.governance_revision = entity.mapping_revision
        where entity.workspace_id = ${scope.workspaceId}::uuid
          and entity.project_id = ${scope.projectId}::uuid
          and entity.status = 'approved'
          and review.status = 'approved'
          and entity.mapping_review_state = 'confirmed'
          and review.review_state = 'confirmed'
          and review.assignment_invalidated_by is null
          and entity.mapping_decision = 'existing_page'
          and review.mapping_decision = 'existing_page'
          and entity.mapped_site_page_id is not null
          and review.mapped_site_page_id =
            entity.mapped_site_page_id
          and entity.intent is not null
          and review.intent is not null
          and app.normalize_keyword_relation_semantic(
            review.intent
          ) = app.normalize_keyword_relation_semantic(
            entity.intent
          )
          and entity.normalized_keyword =
            app.normalize_keyword_relation_semantic(
              entity.display_keyword
            )
      ),
      candidate_pairs as materialized (
        select
          keyword_a.id as keyword_a_id,
          keyword_a.display_keyword as keyword_a_display_keyword,
          keyword_a.normalized_keyword as keyword_a_normalized_keyword,
          keyword_a.governance_revision
            as keyword_a_governance_revision,
          keyword_a.topic_node_id as keyword_a_topic_node_id,
          keyword_a.topic_model_revision
            as keyword_a_topic_model_revision,
          keyword_b.id as keyword_b_id,
          keyword_b.display_keyword as keyword_b_display_keyword,
          keyword_b.normalized_keyword as keyword_b_normalized_keyword,
          keyword_b.governance_revision
            as keyword_b_governance_revision,
          keyword_b.topic_node_id as keyword_b_topic_node_id,
          keyword_b.topic_model_revision
            as keyword_b_topic_model_revision,
          keyword_a.mapped_site_page_id,
          app.normalize_keyword_relation_semantic(
            keyword_a.intent
          ) as normalized_intent,
          keyword_a.market,
          keyword_a.language_tag,
          (
            keyword_a.topic_node_id is not null
            and keyword_b.topic_node_id is not null
            and keyword_a.topic_node_id = keyword_b.topic_node_id
          ) as same_confirmed_topic,
          app.keyword_relation_token_overlap(
            keyword_a.normalized_keyword,
            keyword_b.normalized_keyword
          ) as lexical_token_overlap
        from eligible_keywords keyword_a
        inner join eligible_keywords keyword_b
          on keyword_a.id < keyword_b.id
         and keyword_a.mapped_site_page_id =
           keyword_b.mapped_site_page_id
         and app.normalize_keyword_relation_semantic(
           keyword_a.intent
         ) = app.normalize_keyword_relation_semantic(
           keyword_b.intent
         )
         and keyword_a.market = keyword_b.market
         and keyword_a.language_tag = keyword_b.language_tag
        order by keyword_a.id, keyword_b.id
        limit ${MAX_KEYWORD_RELATION_REFRESH_PAIRS + 1}
      ),
      pair_guard as (
        select count(*)::integer as eligible_pair_count
        from candidate_pairs
      ),
      pairs as materialized (
        select candidate_pairs.*
        from candidate_pairs, pair_guard
        where pair_guard.eligible_pair_count <=
          ${MAX_KEYWORD_RELATION_REFRESH_PAIRS}
      ),
      inserted_relations as (
        insert into app.keyword_relation_identities (
          workspace_id,
          project_id,
          keyword_a_id,
          keyword_b_id
        )
        select
          ${scope.workspaceId}::uuid,
          ${scope.projectId}::uuid,
          pair.keyword_a_id,
          pair.keyword_b_id
        from pairs pair
        on conflict (
          workspace_id,
          project_id,
          keyword_a_id,
          keyword_b_id
        ) do nothing
        returning id, keyword_a_id, keyword_b_id
      ),
      relation_pairs as materialized (
        select relation.id as relation_id, pair.*
        from pairs pair
        inner join app.keyword_relation_identities relation
          on relation.workspace_id = ${scope.workspaceId}::uuid
         and relation.project_id = ${scope.projectId}::uuid
         and relation.keyword_a_id = pair.keyword_a_id
         and relation.keyword_b_id = pair.keyword_b_id
        union all
        select inserted.id as relation_id, pair.*
        from pairs pair
        inner join inserted_relations inserted
          on inserted.keyword_a_id = pair.keyword_a_id
         and inserted.keyword_b_id = pair.keyword_b_id
      ),
      inserted_candidates as (
        insert into app.keyword_relation_candidates (
          workspace_id,
          project_id,
          relation_id,
          rule_version,
          keyword_a_id,
          keyword_a_display_keyword,
          keyword_a_normalized_keyword,
          keyword_a_governance_revision,
          keyword_a_topic_node_id,
          keyword_a_topic_model_revision,
          keyword_b_id,
          keyword_b_display_keyword,
          keyword_b_normalized_keyword,
          keyword_b_governance_revision,
          keyword_b_topic_node_id,
          keyword_b_topic_model_revision,
          mapped_site_page_id,
          normalized_intent,
          market,
          language_tag,
          same_confirmed_topic,
          lexical_token_overlap,
          serp_overlap_availability,
          serp_overlap,
          serp_overlap_limitation
        )
        select
          ${scope.workspaceId}::uuid,
          ${scope.projectId}::uuid,
          pair.relation_id,
          ${KEYWORD_RELATION_RULE_VERSION},
          pair.keyword_a_id,
          pair.keyword_a_display_keyword,
          pair.keyword_a_normalized_keyword,
          pair.keyword_a_governance_revision,
          pair.keyword_a_topic_node_id,
          pair.keyword_a_topic_model_revision,
          pair.keyword_b_id,
          pair.keyword_b_display_keyword,
          pair.keyword_b_normalized_keyword,
          pair.keyword_b_governance_revision,
          pair.keyword_b_topic_node_id,
          pair.keyword_b_topic_model_revision,
          pair.mapped_site_page_id,
          pair.normalized_intent,
          pair.market,
          pair.language_tag,
          pair.same_confirmed_topic,
          pair.lexical_token_overlap,
          'unavailable',
          null,
          'Canonical SERP-overlap observations are not available yet.'
        from relation_pairs pair
        on conflict (
          workspace_id,
          project_id,
          relation_id,
          evidence_hash
        ) do nothing
        returning id
      )
      select
        exists(select 1 from active_project) as project_exists,
        pair_guard.eligible_pair_count,
        (
          select count(*)::integer
          from inserted_relations
        ) as created_relation_count,
        (
          select count(*)::integer
          from inserted_candidates
        ) as created_candidate_count
      from pair_guard
    `);
    if (result.rows.length !== 1) {
      throw new KeywordRelationIntegrityError(
        "REFRESH_RESULT_INVALID",
      );
    }
    const row = result.rows[0]!;
    if (row.project_exists !== true) {
      throw new KeywordRelationConflictError("PROJECT_NOT_FOUND");
    }
    const eligiblePairCount = checkedInteger(
      row.eligible_pair_count,
      MAX_KEYWORD_RELATION_REFRESH_PAIRS + 1,
      "REFRESH_RESULT_INVALID",
    );
    if (eligiblePairCount > MAX_KEYWORD_RELATION_REFRESH_PAIRS) {
      throw new KeywordRelationIntegrityError(
        "PAIR_LIMIT_EXCEEDED",
      );
    }
    const createdRelationCount = checkedInteger(
      row.created_relation_count,
      eligiblePairCount,
      "REFRESH_RESULT_INVALID",
    );
    const createdCandidateCount = checkedInteger(
      row.created_candidate_count,
      eligiblePairCount,
      "REFRESH_RESULT_INVALID",
    );
    return {
      eligiblePairCount,
      createdRelationCount,
      createdCandidateCount,
    };
  }

  private async readOne(
    exec: Executor,
    scope: ProjectScope,
    relationId: string,
  ): Promise<GrowthMapKeywordRelation | null> {
    const result = await exec.execute<RelationProjectionRow>(
      relationProjectionStatement(scope, relationId, null, null, 2),
    );
    if (result.rows.length > 1) {
      throw new KeywordRelationIntegrityError(
        "RELATION_PROJECTION_DUPLICATE",
      );
    }
    const row = result.rows[0];
    return row ? projectRelation(row, scope) : null;
  }

  private async decideWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    relationId: string,
    actorId: string,
    input: DecideKeywordRelationInput,
  ): Promise<KeywordRelationDecisionResult> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    const current = await this.readOne(exec, scope, relationId);
    if (!current) {
      throw new KeywordRelationConflictError(
        "RELATION_NOT_FOUND",
        input.expectedRelationRevision,
      );
    }
    if (
      current.currentRelationRevision !==
      input.expectedRelationRevision
    ) {
      if (
        current.currentRelationRevision ===
          input.expectedRelationRevision + 1 &&
        current.decision !== null &&
        exactReplay(current.decision, actorId, input)
      ) {
        return { data: current, replayed: true };
      }
      throw new KeywordRelationConflictError(
        "REVISION_CONFLICT",
        input.expectedRelationRevision,
        current.currentRelationRevision,
        current.candidate.candidateId,
      );
    }
    if (
      current.currentRelationRevision >=
      MAX_POSTGRES_INTEGER_REVISION
    ) {
      throw new KeywordRelationConflictError(
        "REVISION_EXHAUSTED",
        input.expectedRelationRevision,
        current.currentRelationRevision,
        current.candidate.candidateId,
      );
    }
    if (
      current.candidateState !== "current" ||
      current.candidate.candidateId !== input.candidateId
    ) {
      throw new KeywordRelationConflictError(
        "CANDIDATE_STALE",
        input.expectedRelationRevision,
        current.currentRelationRevision,
        current.candidate.candidateId,
      );
    }
    if (
      input.decisionKind === "primary_supporting" &&
      !(
        (input.primaryKeywordId ===
          current.candidate.keywordA.keywordId &&
          input.supportingKeywordId ===
            current.candidate.keywordB.keywordId) ||
        (input.primaryKeywordId ===
          current.candidate.keywordB.keywordId &&
          input.supportingKeywordId ===
            current.candidate.keywordA.keywordId)
      )
    ) {
      throw new KeywordRelationConflictError(
        "PAIR_MISMATCH",
        input.expectedRelationRevision,
        current.currentRelationRevision,
        current.candidate.candidateId,
      );
    }

    const facts = safeDecisionFacts(this.clock);
    const nextRevision = input.expectedRelationRevision + 1;
    let inserted: { readonly rows: InsertDecisionRow[] };
    try {
      inserted = await exec.execute<InsertDecisionRow>(sql`
        insert into app.keyword_relation_decisions (
          id,
          workspace_id,
          project_id,
          relation_id,
          candidate_id,
          relation_revision,
          decision_kind,
          primary_keyword_id,
          supporting_keyword_id,
          reason,
          decided_by,
          decided_at
        )
        values (
          ${facts.id}::uuid,
          ${scope.workspaceId}::uuid,
          ${scope.projectId}::uuid,
          ${relationId}::uuid,
          ${input.candidateId}::uuid,
          ${nextRevision},
          ${input.decisionKind},
          ${input.primaryKeywordId}::uuid,
          ${input.supportingKeywordId}::uuid,
          ${input.reason},
          ${actorId}::uuid,
          ${facts.now}::timestamptz
        )
        returning id, relation_revision
      `);
    } catch (error) {
      const code = postgresCode(error);
      if (code === "40001") {
        throw new KeywordRelationConflictError(
          "REVISION_CONFLICT",
          input.expectedRelationRevision,
          current.currentRelationRevision,
          current.candidate.candidateId,
        );
      }
      if (code === "55000") {
        throw new KeywordRelationConflictError(
          "CANDIDATE_STALE",
          input.expectedRelationRevision,
          current.currentRelationRevision,
          current.candidate.candidateId,
        );
      }
      if (code === "23514") {
        throw new KeywordRelationConflictError(
          input.decisionKind === "primary_supporting"
            ? "FOLD_GRAPH_CONFLICT"
            : "PAIR_MISMATCH",
          input.expectedRelationRevision,
          current.currentRelationRevision,
          current.candidate.candidateId,
        );
      }
      throw error;
    }
    const insertedRow = inserted.rows[0];
    if (
      inserted.rows.length !== 1 ||
      insertedRow?.id !== facts.id ||
      insertedRow.relation_revision !== nextRevision
    ) {
      throw new KeywordRelationIntegrityError(
        "DECISION_INSERT_FAILED",
      );
    }
    const updated = await this.readOne(exec, scope, relationId);
    if (
      !updated ||
      updated.currentRelationRevision !== nextRevision ||
      updated.decision?.decisionId !== facts.id ||
      updated.decisionState !== "active"
    ) {
      throw new KeywordRelationIntegrityError(
        "DECISION_RESULT_DIVERGED",
      );
    }
    return { data: updated, replayed: false };
  }
}
