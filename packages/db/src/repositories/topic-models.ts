import { randomUUID } from "node:crypto";
import {
  ConfirmTopicModelRequest as ConfirmTopicModelRequestSchema,
  PatchTopicModelDraftRequest as PatchTopicModelDraftRequestSchema,
  TopicModelRevision as TopicModelRevisionSchema,
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
  MAX_POSTGRES_INTEGER_REVISION,
  type ConfirmTopicModelRequest,
  type PatchTopicModelDraftRequest,
  type TopicModelRevision,
  type TopicNodeDraftIntent,
} from "@sf/contracts";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DbTx } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  canonicalUtcTimestamptz,
  isTimestamptzInstant,
} from "../instant.ts";
import {
  clientProjects,
  keywordEntities,
  keywordReviewDecisions,
  topicClusterAliases,
  topicModelRevisions,
  topicNodeIdentities,
  topicNodeRevisions,
  topicNodeSuccessors,
} from "../schema.ts";
import {
  projectPredicate,
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";

type DraftModel = Extract<TopicModelRevision, { state: "draft" }>;
type ConfirmedModel = Extract<TopicModelRevision, { state: "confirmed" }>;

export type TopicModelConflictCode =
  | "PROJECT_NOT_FOUND"
  | "DRAFT_EXISTS"
  | "DRAFT_NOT_FOUND"
  | "MODEL_REVISION_CONFLICT"
  | "EDIT_REVISION_CONFLICT"
  | "TOPIC_NODE_NOT_FOUND"
  | "TOPIC_NODE_INVALID"
  | "TOPIC_ROOT_RETIRE_FORBIDDEN"
  | "TOPIC_NODE_HAS_ACTIVE_CHILDREN"
  | "TOPIC_ALIAS_CONFLICT"
  | "REVISION_EXHAUSTED";

export class TopicModelConflictError extends Error {
  override readonly name = "TopicModelConflictError";

  constructor(
    readonly code: TopicModelConflictCode,
    readonly expectedRevision: number | null = null,
    readonly currentRevision: number | null = null,
  ) {
    super(
      {
        PROJECT_NOT_FOUND: "The Topic Model project is not active",
        DRAFT_EXISTS: "The project already has a Topic Model draft",
        DRAFT_NOT_FOUND: "The Topic Model draft does not exist",
        MODEL_REVISION_CONFLICT: "The Topic Model revision is stale",
        EDIT_REVISION_CONFLICT: "The Topic Model draft edit revision is stale",
        TOPIC_NODE_NOT_FOUND: "The Topic Node does not exist in this draft",
        TOPIC_NODE_INVALID: "The Topic mutation would create invalid topology",
        TOPIC_ROOT_RETIRE_FORBIDDEN:
          "The root Topic Node cannot be retired",
        TOPIC_NODE_HAS_ACTIVE_CHILDREN:
          "A Topic Node with active children cannot be retired",
        TOPIC_ALIAS_CONFLICT: "The server could not allocate a Topic alias",
        REVISION_EXHAUSTED: "The Topic Model revision cannot be advanced",
      }[code],
    );
  }
}

export type TopicModelIntegrityCode =
  | "SERVER_FACT_INVALID"
  | "CONFIRMED_STATE_DIVERGED"
  | "DRAFT_STATE_DIVERGED"
  | "MULTIPLE_DRAFTS"
  | "CONFIRMATION_TIME_MISSING"
  | "CONFIRMATION_ACTOR_MISSING"
  | "CONTENT_HASH_MISSING"
  | "PROJECTION_INVALID"
  | "DRAFT_INSERT_FAILED"
  | "DRAFT_INSERT_STATE_INVALID"
  | "SERVER_ID_INVALID"
  | "NEW_NODE_ALIAS_MISSING"
  | "PATCH_RESULT_NOT_DRAFT"
  | "AMBIGUOUS_TOPIC_INVALIDATION"
  | "KEYWORD_MIRROR_DIVERGED"
  | "KEYWORD_REVISION_EXHAUSTED"
  | "KEYWORD_INVALIDATION_KIND_MISSING"
  | "KEYWORD_HISTORY_PROJECTION_INVALID"
  | "KEYWORD_INVALIDATION_CAS_FAILED"
  | "DRAFT_NODE_LINEAGE_INVALID"
  | "CONFIRM_RESULT_NOT_CONFIRMED";

export class TopicModelIntegrityError extends Error {
  override readonly name = "TopicModelIntegrityError";

  constructor(readonly code: TopicModelIntegrityCode) {
    super(`Topic Model authority failed integrity validation: ${code}`);
  }
}

export interface TopicModelClock {
  readonly newId: () => string;
  readonly now: () => string;
}

const DEFAULT_CLOCK: TopicModelClock = {
  newId: randomUUID,
  now: () => new Date().toISOString(),
};

export interface BeginTopicModelDraftInput {
  readonly expectedLatestConfirmedRevision: number;
  readonly reason: string;
  readonly generationBasis?: Readonly<Record<string, unknown>>;
  readonly evidenceRefs?: readonly Readonly<Record<string, unknown>>[];
}

interface ModelRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly revision: number;
  readonly edit_revision: number;
  readonly status: string;
  readonly root_topic_node_id: string | null;
  readonly generation_basis: Record<string, unknown>;
  readonly evidence_refs: readonly Record<string, unknown>[];
  readonly content_hash: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
}

interface NodeRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly topic_node_id: string;
  readonly topic_model_revision: number;
  readonly parent_topic_node_id: string | null;
  readonly label: string;
  readonly description: string | null;
  readonly intent_envelope: readonly string[];
  readonly lifecycle_state: "active" | "superseded";
  readonly created_by: string;
  readonly created_at: string;
}

interface AliasRow {
  readonly id: string;
  readonly topic_node_id: string;
  readonly legacy_cluster_key: string;
  readonly valid_from_revision: number;
  readonly valid_to_revision: number | null;
  readonly is_current: boolean;
}

interface SuccessorRow {
  readonly predecessor_topic_node_id: string;
  readonly successor_topic_node_id: string;
  readonly topic_model_revision: number;
  readonly successor_kind: "split_into" | "merged_into";
}

interface MutableNode {
  readonly rowId: string;
  readonly topicNodeId: string;
  parentTopicNodeId: string | null;
  label: string;
  description: string | null;
  intentEnvelope: string[];
  lifecycleState: "active" | "superseded";
  readonly isNew: boolean;
  readonly initialClusterKey: string | null;
}

interface PendingSuccessor {
  readonly predecessorTopicNodeId: string;
  readonly successorTopicNodeId: string;
  readonly kind: "split_into" | "merged_into";
  readonly reason: string;
}

type TopicAssignmentInvalidation =
  | "topic_split"
  | "topic_merge"
  | "topic_retire";

interface LatestKeywordDecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly keyword_entity_id: string;
  readonly governance_revision: number;
  readonly status: "candidate" | "approved" | "excluded" | "parked";
  readonly intent: string | null;
  readonly buyer_stage: string | null;
  readonly topic_node_id: string | null;
  readonly topic_model_revision: number | null;
  readonly cluster_key_at_decision: string | null;
  readonly mapping_decision: "unassigned" | "existing_page" | "new_asset";
  readonly mapped_site_page_id: string | null;
  readonly review_state: "unreviewed" | "confirmed";
  readonly assignment_invalidated_by:
    | "topic_split"
    | "topic_merge"
    | "topic_retire"
    | null;
  readonly reviewed_projection: Record<string, unknown>;
  readonly entity_revision: number;
  readonly entity_status: string;
  readonly entity_intent: string | null;
  readonly entity_buyer_stage: string | null;
  readonly entity_cluster_key: string | null;
  readonly entity_mapping_decision: string;
  readonly entity_mapped_site_page_id: string | null;
  readonly entity_review_state: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new RangeError(`${label} must be a UUID`);
}

function assertProjectScope(scope: ProjectScope, actorId?: string): void {
  assertUuid(scope.workspaceId, "workspaceId");
  assertUuid(scope.projectId, "projectId");
  if (actorId !== undefined) assertUuid(actorId, "actorId");
}

function assertReason(reason: string): void {
  if (
    reason.length < 3 ||
    reason.length > 2_000 ||
    reason.trim() !== reason
  ) {
    throw new RangeError(
      "reason must contain 3 to 2000 trimmed characters",
    );
  }
}

function safeClock(clock: TopicModelClock): {
  readonly id: string;
  readonly now: string;
} {
  const id = clock.newId();
  const now = clock.now();
  if (!UUID.test(id) || !isTimestamptzInstant(now)) {
    throw new TopicModelIntegrityError("SERVER_FACT_INVALID");
  }
  return { id, now: canonicalUtcTimestamptz(now) };
}

/** One transaction-scoped project writer lock shared by Topic and Keyword writes. */
export async function acquireTopicGovernanceProjectWriterLock(
  exec: Executor,
  scope: ProjectScope,
): Promise<void> {
  assertProjectScope(scope);
  const key = `topic-governance:${scope.workspaceId}:${scope.projectId}`;
  await exec.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

function slugBase(label: string): string {
  const value = label
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return value.slice(0, 180) || "topic";
}

/** Server-only canonical alias allocation; callers never submit clusterKey. */
export function canonicalTopicClusterKey(
  label: string,
  reserved: ReadonlySet<string>,
  identityId: string,
): string {
  const base = slugBase(label);
  if (!reserved.has(base)) return base;
  const suffix = identityId.replace(/-/gu, "").slice(0, 12).toLowerCase();
  const candidate = `${base.slice(0, Math.max(1, 187 - suffix.length))}-${suffix}`;
  if (!reserved.has(candidate)) return candidate;
  throw new TopicModelConflictError("TOPIC_ALIAS_CONFLICT");
}

export function assertConfirmedTopicTopology(input: {
  readonly rootTopicNodeId: string | null;
  readonly nodes: readonly {
    readonly topicNodeId: string;
    readonly parentTopicNodeId: string | null;
  }[];
}): void {
  if (input.rootTopicNodeId === null || input.nodes.length === 0) {
    throw new TopicModelConflictError("TOPIC_NODE_INVALID");
  }
  const nodes = new Map(input.nodes.map((node) => [node.topicNodeId, node]));
  const root = nodes.get(input.rootTopicNodeId);
  if (!root || root.parentTopicNodeId !== null) {
    throw new TopicModelConflictError("TOPIC_NODE_INVALID");
  }
  for (const node of input.nodes) {
    const seen = new Set<string>();
    let current: typeof node | undefined = node;
    while (current && current.topicNodeId !== input.rootTopicNodeId) {
      if (seen.has(current.topicNodeId)) {
        throw new TopicModelConflictError("TOPIC_NODE_INVALID");
      }
      seen.add(current.topicNodeId);
      current =
        current.parentTopicNodeId === null
          ? undefined
          : nodes.get(current.parentTopicNodeId);
    }
    if (current?.topicNodeId !== input.rootTopicNodeId) {
      throw new TopicModelConflictError("TOPIC_NODE_INVALID");
    }
  }
}

function topicAssignmentInvalidations(input: {
  readonly rootTopicNodeId: string | null;
  readonly currentNodes: readonly NodeRow[];
  readonly previousNodes: readonly NodeRow[];
  readonly successors: readonly SuccessorRow[];
}): Map<string, TopicAssignmentInvalidation> {
  const currentById = new Map(
    input.currentNodes.map((node) => [node.topic_node_id, node]),
  );
  const previousById = new Map(
    input.previousNodes.map((node) => [node.topic_node_id, node]),
  );
  const root =
    input.rootTopicNodeId === null
      ? null
      : currentById.get(input.rootTopicNodeId);
  if (!root || root.lifecycle_state !== "active") {
    throw new TopicModelConflictError(
      root?.lifecycle_state === "superseded"
        ? "TOPIC_ROOT_RETIRE_FORBIDDEN"
        : "TOPIC_NODE_INVALID",
    );
  }

  for (const previous of input.previousNodes) {
    const current = currentById.get(previous.topic_node_id);
    if (
      !current ||
      (previous.lifecycle_state === "superseded" &&
        current.lifecycle_state === "active")
    ) {
      throw new TopicModelIntegrityError(
        "DRAFT_NODE_LINEAGE_INVALID",
      );
    }
  }

  const invalidations = new Map<
    string,
    TopicAssignmentInvalidation
  >();
  for (const successor of input.successors) {
    const current = currentById.get(
      successor.predecessor_topic_node_id,
    );
    const previous = previousById.get(
      successor.predecessor_topic_node_id,
    );
    if (
      !current ||
      current.lifecycle_state !== "superseded" ||
      previous?.lifecycle_state === "superseded"
    ) {
      throw new TopicModelIntegrityError(
        "DRAFT_NODE_LINEAGE_INVALID",
      );
    }
    const invalidation: TopicAssignmentInvalidation =
      successor.successor_kind === "split_into"
        ? "topic_split"
        : "topic_merge";
    const existing = invalidations.get(current.topic_node_id);
    if (existing && existing !== invalidation) {
      throw new TopicModelIntegrityError(
        "AMBIGUOUS_TOPIC_INVALIDATION",
      );
    }
    invalidations.set(current.topic_node_id, invalidation);
  }

  for (const current of input.currentNodes) {
    const previous = previousById.get(current.topic_node_id);
    const newlySuperseded =
      current.lifecycle_state === "superseded" &&
      previous?.lifecycle_state !== "superseded";
    if (!newlySuperseded || invalidations.has(current.topic_node_id)) {
      continue;
    }
    if (
      input.currentNodes.some(
        (candidate) =>
          candidate.lifecycle_state === "active" &&
          candidate.parent_topic_node_id === current.topic_node_id,
      )
    ) {
      throw new TopicModelConflictError(
        "TOPIC_NODE_HAS_ACTIVE_CHILDREN",
      );
    }
    invalidations.set(current.topic_node_id, "topic_retire");
  }
  return invalidations;
}

type TransactionalExecutor = Executor & {
  transaction?: <T>(run: (tx: DbTx) => Promise<T>) => Promise<T>;
};

export class TopicModelsRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: TopicModelClock = DEFAULT_CLOCK,
  ) {
    super(exec);
  }

  async getLatestConfirmed(
    scope: ProjectScope,
  ): Promise<ConfirmedModel | null> {
    assertProjectScope(scope);
    const model = await this.findLatestModel(
      this.exec,
      scope,
      "confirmed",
      false,
    );
    if (!model) return null;
    const projection = await this.projectModel(this.exec, scope, model);
    if (projection.state !== "confirmed") {
      throw new TopicModelIntegrityError("CONFIRMED_STATE_DIVERGED");
    }
    return projection;
  }

  async getDraft(scope: ProjectScope): Promise<DraftModel | null> {
    assertProjectScope(scope);
    const model = await this.findLatestModel(
      this.exec,
      scope,
      "draft",
      false,
    );
    if (!model) return null;
    const projection = await this.projectModel(this.exec, scope, model);
    if (projection.state !== "draft") {
      throw new TopicModelIntegrityError("DRAFT_STATE_DIVERGED");
    }
    return projection;
  }

  async beginDraftFromLatestConfirmed(
    scope: ProjectScope,
    actorId: string,
    input: BeginTopicModelDraftInput,
  ): Promise<DraftModel> {
    assertProjectScope(scope, actorId);
    assertReason(input.reason);
    if (
      !Number.isSafeInteger(input.expectedLatestConfirmedRevision) ||
      input.expectedLatestConfirmedRevision < 0 ||
      input.expectedLatestConfirmedRevision >
        MAX_POSTGRES_INTEGER_REVISION
    ) {
      throw new RangeError(
        "expectedLatestConfirmedRevision is outside the PostgreSQL integer range",
      );
    }
    return this.inTransaction((tx) =>
      this.beginDraftWithExecutor(tx, scope, actorId, input),
    );
  }

  async patchDraft(
    scope: ProjectScope,
    actorId: string,
    input: PatchTopicModelDraftRequest,
  ): Promise<DraftModel> {
    assertProjectScope(scope, actorId);
    const parsed = PatchTopicModelDraftRequestSchema.parse(input);
    return this.inTransaction((tx) =>
      this.patchDraftWithExecutor(tx, scope, actorId, parsed),
    );
  }

  async confirmDraft(
    scope: ProjectScope,
    actorId: string,
    input: ConfirmTopicModelRequest,
  ): Promise<ConfirmedModel> {
    assertProjectScope(scope, actorId);
    const parsed = ConfirmTopicModelRequestSchema.parse(input);
    return this.inTransaction((tx) =>
      this.confirmDraftWithExecutor(tx, scope, actorId, parsed),
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

  private async assertActiveProject(
    exec: Executor,
    scope: ProjectScope,
  ): Promise<void> {
    const rows = await exec
      .select({ id: clientProjects.id })
      .from(clientProjects)
      .where(
        and(
          eq(clientProjects.workspace_id, scope.workspaceId),
          eq(clientProjects.id, scope.projectId),
          isNull(clientProjects.archived_at),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new TopicModelConflictError("PROJECT_NOT_FOUND");
    }
  }

  private async findLatestModel(
    exec: Executor,
    scope: ProjectScope,
    status: "draft" | "confirmed",
    lock: boolean,
  ): Promise<ModelRow | null> {
    const query = exec
      .select()
      .from(topicModelRevisions)
      .where(
        and(
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.status, status),
        ),
      )
      .orderBy(desc(topicModelRevisions.revision))
      .limit(2);
    const rows = (await (lock ? query.for("update") : query)) as ModelRow[];
    if (rows.length > 1 && status === "draft") {
      throw new TopicModelIntegrityError("MULTIPLE_DRAFTS");
    }
    return rows[0] ?? null;
  }

  private async loadNodes(
    exec: Executor,
    scope: ProjectScope,
    revision: number,
  ): Promise<NodeRow[]> {
    return (await exec
      .select()
      .from(topicNodeRevisions)
      .where(
        and(
          projectPredicate(topicNodeRevisions, scope),
          eq(topicNodeRevisions.topic_model_revision, revision),
        ),
      )
      .orderBy(asc(topicNodeRevisions.topic_node_id))) as NodeRow[];
  }

  private async loadAliases(
    exec: Executor,
    scope: ProjectScope,
    revision: number,
  ): Promise<AliasRow[]> {
    return (await exec
      .select({
        id: topicClusterAliases.id,
        topic_node_id: topicClusterAliases.topic_node_id,
        legacy_cluster_key: topicClusterAliases.legacy_cluster_key,
        valid_from_revision: topicClusterAliases.valid_from_revision,
        valid_to_revision: topicClusterAliases.valid_to_revision,
        is_current: topicClusterAliases.is_current,
      })
      .from(topicClusterAliases)
      .where(
        and(
          projectPredicate(topicClusterAliases, scope),
          lte(topicClusterAliases.valid_from_revision, revision),
          or(
            isNull(topicClusterAliases.valid_to_revision),
            sql`${topicClusterAliases.valid_to_revision} >= ${revision}`,
          ),
        ),
      )
      .orderBy(
        asc(topicClusterAliases.legacy_cluster_key),
        asc(topicClusterAliases.valid_from_revision),
        asc(topicClusterAliases.id),
      )) as AliasRow[];
  }

  private async loadSuccessors(
    exec: Executor,
    scope: ProjectScope,
    revision: number,
  ): Promise<SuccessorRow[]> {
    return (await exec
      .select({
        predecessor_topic_node_id:
          topicNodeSuccessors.predecessor_topic_node_id,
        successor_topic_node_id:
          topicNodeSuccessors.successor_topic_node_id,
        topic_model_revision: topicNodeSuccessors.topic_model_revision,
        successor_kind: topicNodeSuccessors.successor_kind,
      })
      .from(topicNodeSuccessors)
      .where(
        and(
          projectPredicate(topicNodeSuccessors, scope),
          eq(topicNodeSuccessors.topic_model_revision, revision),
        ),
      )
      .orderBy(
        asc(topicNodeSuccessors.predecessor_topic_node_id),
        asc(topicNodeSuccessors.successor_topic_node_id),
      )) as SuccessorRow[];
  }

  private async projectModel(
    exec: Executor,
    scope: ProjectScope,
    model: ModelRow,
  ): Promise<TopicModelRevision> {
    // A transaction executor owns one pg client. Keep reads sequential so
    // node-postgres never receives concurrent client.query calls (pg 9 removes
    // that deprecated behavior entirely).
    const nodes = await this.loadNodes(exec, scope, model.revision);
    const aliases = await this.loadAliases(exec, scope, model.revision);
    const successors = await this.loadSuccessors(
      exec,
      scope,
      model.revision,
    );
    const common = {
      projectId: scope.projectId,
      topicModelRevision: model.revision,
      editRevision: model.edit_revision,
      rootTopicNodeId: model.root_topic_node_id,
      nodes: nodes.map((node) => ({
        projectId: scope.projectId,
        topicNodeId: node.topic_node_id,
        topicModelRevision: model.revision,
        parentTopicNodeId: node.parent_topic_node_id,
        label: node.label,
        description: node.description,
        intentEnvelope: [...node.intent_envelope],
        lifecycleState: node.lifecycle_state,
      })),
      aliases: aliases.map((alias) => ({
        aliasId: alias.id,
        projectId: scope.projectId,
        topicNodeId: alias.topic_node_id,
        clusterKey: alias.legacy_cluster_key,
        validFromTopicModelRevision: alias.valid_from_revision,
        validThroughTopicModelRevision: alias.valid_to_revision,
        isCurrent: alias.is_current,
      })),
      successorRelationships: successors.map((successor) => ({
        kind: successor.successor_kind,
        sourceTopicNodeId: successor.predecessor_topic_node_id,
        successorTopicNodeId: successor.successor_topic_node_id,
        topicModelRevision: model.revision,
      })),
      createdAt: canonicalUtcTimestamptz(model.created_at),
      createdBy: model.created_by,
    } as const;
    const value =
      model.status === "draft"
        ? {
            ...common,
            state: "draft" as const,
            updatedAt: canonicalUtcTimestamptz(model.updated_at),
          }
        : {
            ...common,
            state: "confirmed" as const,
            confirmedAt: canonicalUtcTimestamptz(
              model.confirmed_at ??
                (() => {
                  throw new TopicModelIntegrityError(
                    "CONFIRMATION_TIME_MISSING",
                  );
                })(),
            ),
            confirmedBy:
              model.confirmed_by ??
              (() => {
                throw new TopicModelIntegrityError(
                  "CONFIRMATION_ACTOR_MISSING",
                );
              })(),
            contentHash:
              model.content_hash ??
              (() => {
                throw new TopicModelIntegrityError(
                  "CONTENT_HASH_MISSING",
                );
              })(),
          };
    const parsed = TopicModelRevisionSchema.safeParse(value);
    if (!parsed.success) {
      throw new TopicModelIntegrityError("PROJECTION_INVALID");
    }
    return parsed.data;
  }

  private async beginDraftWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    actorId: string,
    input: BeginTopicModelDraftInput,
  ): Promise<DraftModel> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    await this.assertActiveProject(exec, scope);
    const existingDraft = await this.findLatestModel(
      exec,
      scope,
      "draft",
      true,
    );
    if (existingDraft) {
      throw new TopicModelConflictError(
        "DRAFT_EXISTS",
        input.expectedLatestConfirmedRevision,
        existingDraft.revision,
      );
    }
    const latest = await this.findLatestModel(
      exec,
      scope,
      "confirmed",
      true,
    );
    const latestRevision = latest?.revision ?? 0;
    if (latestRevision !== input.expectedLatestConfirmedRevision) {
      throw new TopicModelConflictError(
        "MODEL_REVISION_CONFLICT",
        input.expectedLatestConfirmedRevision,
        latestRevision,
      );
    }
    if (latestRevision >= MAX_POSTGRES_INTEGER_REVISION) {
      throw new TopicModelConflictError("REVISION_EXHAUSTED");
    }
    const facts = safeClock(this.clock);
    const revision = latestRevision + 1;
    const generationBasis = {
      ...(input.generationBasis ?? {}),
      origin: "draft_from_latest_confirmed",
      baseTopicModelRevision: latestRevision === 0 ? null : latestRevision,
      reason: input.reason,
    };
    const inserted = await exec
      .insert(topicModelRevisions)
      .values({
        id: facts.id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        revision,
        edit_revision: 0,
        status: "draft",
        root_topic_node_id: latest?.root_topic_node_id ?? null,
        generation_basis: generationBasis as never,
        evidence_refs: [...(input.evidenceRefs ?? [])] as never,
        created_by: actorId,
        created_at: facts.now,
        updated_at: facts.now,
      })
      .returning();
    const model = inserted[0] as ModelRow | undefined;
    if (!model) throw new TopicModelIntegrityError("DRAFT_INSERT_FAILED");

    if (latest) {
      const priorNodes = await this.loadNodes(
        exec,
        scope,
        latest.revision,
      );
      if (priorNodes.length > 0) {
        await exec.insert(topicNodeRevisions).values(
          priorNodes.map((node) => ({
            id: this.newId(),
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            topic_node_id: node.topic_node_id,
            topic_model_revision: revision,
            parent_topic_node_id: node.parent_topic_node_id,
            label: node.label,
            description: node.description,
            intent_envelope: [...node.intent_envelope],
            lifecycle_state: node.lifecycle_state,
            created_by: actorId,
            created_at: facts.now,
          })),
        );
      }
    }
    const projection = await this.projectModel(exec, scope, model);
    if (projection.state !== "draft") {
      throw new TopicModelIntegrityError("DRAFT_INSERT_STATE_INVALID");
    }
    return projection;
  }

  private newId(): string {
    const id = this.clock.newId();
    if (!UUID.test(id)) {
      throw new TopicModelIntegrityError("SERVER_ID_INVALID");
    }
    return id;
  }

  private async reservedClusterKeys(
    exec: Executor,
    scope: ProjectScope,
  ): Promise<Set<string>> {
    const identities = await exec
      .select({ value: topicNodeIdentities.initial_cluster_key })
      .from(topicNodeIdentities)
      .where(projectPredicate(topicNodeIdentities, scope));
    const aliases = await exec
      .select({ value: topicClusterAliases.legacy_cluster_key })
      .from(topicClusterAliases)
      .where(projectPredicate(topicClusterAliases, scope));
    return new Set(
      [...identities, ...aliases].map((row) => row.value),
    );
  }

  private createMutableNode(
    intent: {
      readonly parentTopicNodeId: string | null;
      readonly label: string;
      readonly description: string | null;
      readonly intentEnvelope: readonly string[];
    },
    reserved: Set<string>,
  ): MutableNode {
    const topicNodeId = this.newId();
    const rowId = this.newId();
    const initialClusterKey = canonicalTopicClusterKey(
      intent.label,
      reserved,
      topicNodeId,
    );
    reserved.add(initialClusterKey);
    return {
      rowId,
      topicNodeId,
      parentTopicNodeId: intent.parentTopicNodeId,
      label: intent.label,
      description: intent.description,
      intentEnvelope: [...intent.intentEnvelope],
      lifecycleState: "active",
      isNew: true,
      initialClusterKey,
    };
  }

  private requireActiveNode(
    nodes: Map<string, MutableNode>,
    topicNodeId: string,
  ): MutableNode {
    const node = nodes.get(topicNodeId);
    if (!node || node.lifecycleState !== "active") {
      throw new TopicModelConflictError("TOPIC_NODE_NOT_FOUND");
    }
    return node;
  }

  private applyIntent(
    intent: TopicNodeDraftIntent,
    nodes: Map<string, MutableNode>,
    reserved: Set<string>,
    successors: PendingSuccessor[],
    retiredSources: Set<string>,
    root: { value: string | null },
    reason: string,
  ): void {
    switch (intent.kind) {
      case "create": {
        if (
          intent.parentTopicNodeId !== null &&
          nodes.get(intent.parentTopicNodeId)?.lifecycleState !==
            "active"
        ) {
          throw new TopicModelConflictError("TOPIC_NODE_INVALID");
        }
        const node = this.createMutableNode(intent, reserved);
        nodes.set(node.topicNodeId, node);
        if (root.value === null && node.parentTopicNodeId === null) {
          root.value = node.topicNodeId;
        }
        return;
      }
      case "update": {
        const node = this.requireActiveNode(nodes, intent.topicNodeId);
        if (intent.parentTopicNodeId !== undefined) {
          if (
            intent.parentTopicNodeId !== null &&
            nodes.get(intent.parentTopicNodeId)?.lifecycleState !==
              "active"
          ) {
            throw new TopicModelConflictError("TOPIC_NODE_INVALID");
          }
          node.parentTopicNodeId = intent.parentTopicNodeId;
        }
        if (intent.description !== undefined) {
          node.description = intent.description;
        }
        if (intent.intentEnvelope !== undefined) {
          node.intentEnvelope = [...intent.intentEnvelope];
        }
        return;
      }
      case "rename": {
        const node = this.requireActiveNode(nodes, intent.topicNodeId);
        node.label = intent.label;
        return;
      }
      case "retire": {
        const node = this.requireActiveNode(nodes, intent.topicNodeId);
        if (root.value === node.topicNodeId) {
          throw new TopicModelConflictError(
            "TOPIC_ROOT_RETIRE_FORBIDDEN",
          );
        }
        if (
          [...nodes.values()].some(
            (candidate) =>
              candidate.lifecycleState === "active" &&
              candidate.parentTopicNodeId === node.topicNodeId,
          )
        ) {
          throw new TopicModelConflictError(
            "TOPIC_NODE_HAS_ACTIVE_CHILDREN",
          );
        }
        node.lifecycleState = "superseded";
        retiredSources.add(node.topicNodeId);
        return;
      }
      case "split": {
        const source = this.requireActiveNode(
          nodes,
          intent.sourceTopicNodeId,
        );
        source.lifecycleState = "superseded";
        const created = intent.successors.map((value) => {
          if (
            value.parentTopicNodeId !== null &&
            nodes.get(value.parentTopicNodeId)?.lifecycleState !==
              "active"
          ) {
            throw new TopicModelConflictError("TOPIC_NODE_INVALID");
          }
          return this.createMutableNode(
            {
              ...value,
              parentTopicNodeId:
                value.parentTopicNodeId ?? source.parentTopicNodeId,
            },
            reserved,
          );
        });
        if (root.value === source.topicNodeId) {
          const newRoot = created[0]!;
          newRoot.parentTopicNodeId = null;
          root.value = newRoot.topicNodeId;
          source.parentTopicNodeId = newRoot.topicNodeId;
          for (const node of created.slice(1)) {
            if (node.parentTopicNodeId === null) {
              node.parentTopicNodeId = newRoot.topicNodeId;
            }
          }
        }
        for (const node of created) {
          nodes.set(node.topicNodeId, node);
          successors.push({
            predecessorTopicNodeId: source.topicNodeId,
            successorTopicNodeId: node.topicNodeId,
            kind: "split_into",
            reason,
          });
        }
        return;
      }
      case "merge": {
        const sources = intent.sourceTopicNodeIds.map((id) =>
          this.requireActiveNode(nodes, id),
        );
        const includesRoot = sources.some(
          (source) => source.topicNodeId === root.value,
        );
        const commonParent = sources.every(
          (source) =>
            source.parentTopicNodeId ===
            sources[0]!.parentTopicNodeId,
        )
          ? sources[0]!.parentTopicNodeId
          : root.value;
        if (
          intent.successor.parentTopicNodeId !== null &&
          nodes.get(intent.successor.parentTopicNodeId)
            ?.lifecycleState !== "active"
        ) {
          throw new TopicModelConflictError("TOPIC_NODE_INVALID");
        }
        const successor = this.createMutableNode(
          {
            ...intent.successor,
            parentTopicNodeId:
              intent.successor.parentTopicNodeId ?? commonParent,
          },
          reserved,
        );
        if (includesRoot) {
          successor.parentTopicNodeId = null;
          root.value = successor.topicNodeId;
          for (const source of sources) {
            if (source.parentTopicNodeId === null) {
              source.parentTopicNodeId = successor.topicNodeId;
            }
          }
        }
        nodes.set(successor.topicNodeId, successor);
        for (const source of sources) {
          source.lifecycleState = "superseded";
          successors.push({
            predecessorTopicNodeId: source.topicNodeId,
            successorTopicNodeId: successor.topicNodeId,
            kind: "merged_into",
            reason,
          });
        }
      }
    }
  }

  private async patchDraftWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    actorId: string,
    input: PatchTopicModelDraftRequest,
  ): Promise<DraftModel> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    await this.assertActiveProject(exec, scope);
    const draft = await this.findLatestModel(
      exec,
      scope,
      "draft",
      true,
    );
    if (!draft) throw new TopicModelConflictError("DRAFT_NOT_FOUND");
    if (draft.revision !== input.topicModelRevision) {
      throw new TopicModelConflictError(
        "MODEL_REVISION_CONFLICT",
        input.topicModelRevision,
        draft.revision,
      );
    }
    if (draft.edit_revision !== input.expectedEditRevision) {
      throw new TopicModelConflictError(
        "EDIT_REVISION_CONFLICT",
        input.expectedEditRevision,
        draft.edit_revision,
      );
    }

    const currentRows = await this.loadNodes(exec, scope, draft.revision);
    const nodes = new Map<string, MutableNode>(
      currentRows.map((node) => [
        node.topic_node_id,
        {
          rowId: node.id,
          topicNodeId: node.topic_node_id,
          parentTopicNodeId: node.parent_topic_node_id,
          label: node.label,
          description: node.description,
          intentEnvelope: [...node.intent_envelope],
          lifecycleState: node.lifecycle_state,
          isNew: false,
          initialClusterKey: null,
        },
      ]),
    );
    const reserved = await this.reservedClusterKeys(exec, scope);
    const successors: PendingSuccessor[] = [];
    const retiredSources = new Set<string>();
    const root = { value: draft.root_topic_node_id };
    const affectedSources = new Set<string>();
    for (const intent of input.intents) {
      const sources =
        intent.kind === "split"
          ? [intent.sourceTopicNodeId]
          : intent.kind === "merge"
            ? intent.sourceTopicNodeIds
            : intent.kind === "retire"
              ? [intent.topicNodeId]
              : [];
      for (const source of sources) {
        if (affectedSources.has(source)) {
          throw new TopicModelConflictError("TOPIC_NODE_INVALID");
        }
        affectedSources.add(source);
      }
      this.applyIntent(
        intent,
        nodes,
        reserved,
        successors,
        retiredSources,
        root,
        input.reason,
      );
    }

    for (const source of retiredSources) {
      if (
        [...nodes.values()].some(
          (candidate) =>
            candidate.lifecycleState === "active" &&
            candidate.parentTopicNodeId === source,
        )
      ) {
        throw new TopicModelConflictError(
          "TOPIC_NODE_HAS_ACTIVE_CHILDREN",
        );
      }
    }

    for (const node of nodes.values()) {
      if (
        node.parentTopicNodeId !== null &&
        !nodes.has(node.parentTopicNodeId)
      ) {
        throw new TopicModelConflictError("TOPIC_NODE_INVALID");
      }
    }
    const facts = safeClock(this.clock);
    const newNodes = [...nodes.values()].filter((node) => node.isNew);
    if (newNodes.length > 0) {
      await exec.insert(topicNodeIdentities).values(
        newNodes.map((node) => ({
          id: node.topicNodeId,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          created_in_revision: draft.revision,
          initial_cluster_key:
            node.initialClusterKey ??
            (() => {
              throw new TopicModelIntegrityError(
                "NEW_NODE_ALIAS_MISSING",
              );
            })(),
          created_by: actorId,
          created_at: facts.now,
        })),
      );
      await exec.insert(topicNodeRevisions).values(
        newNodes.map((node) => ({
          id: node.rowId,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          topic_node_id: node.topicNodeId,
          topic_model_revision: draft.revision,
          parent_topic_node_id: node.parentTopicNodeId,
          label: node.label,
          description: node.description,
          intent_envelope: node.intentEnvelope,
          lifecycle_state: node.lifecycleState,
          created_by: actorId,
          created_at: facts.now,
        })),
      );
    }
    for (const node of [...nodes.values()].filter((value) => !value.isNew)) {
      await exec
        .update(topicNodeRevisions)
        .set({
          parent_topic_node_id: node.parentTopicNodeId,
          label: node.label,
          description: node.description,
          intent_envelope: node.intentEnvelope,
          lifecycle_state: node.lifecycleState,
        })
        .where(
          and(
            projectPredicate(topicNodeRevisions, scope),
            eq(topicNodeRevisions.topic_model_revision, draft.revision),
            eq(topicNodeRevisions.topic_node_id, node.topicNodeId),
          ),
        );
    }
    if (successors.length > 0) {
      await exec.insert(topicNodeSuccessors).values(
        successors.map((successor) => ({
          id: this.newId(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          predecessor_topic_node_id:
            successor.predecessorTopicNodeId,
          successor_topic_node_id: successor.successorTopicNodeId,
          topic_model_revision: draft.revision,
          successor_kind: successor.kind,
          created_by: actorId,
          reason: successor.reason,
          created_at: facts.now,
        })),
      );
    }

    const updated = await exec
      .update(topicModelRevisions)
      .set({
        edit_revision: input.expectedEditRevision + 1,
        root_topic_node_id: root.value,
        updated_at: facts.now,
      })
      .where(
        and(
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.id, draft.id),
          eq(topicModelRevisions.status, "draft"),
          eq(
            topicModelRevisions.edit_revision,
            input.expectedEditRevision,
          ),
        ),
      )
      .returning();
    const model = updated[0] as ModelRow | undefined;
    if (!model) {
      throw new TopicModelConflictError(
        "EDIT_REVISION_CONFLICT",
        input.expectedEditRevision,
        draft.edit_revision,
      );
    }
    const projection = await this.projectModel(exec, scope, model);
    if (projection.state !== "draft") {
      throw new TopicModelIntegrityError("PATCH_RESULT_NOT_DRAFT");
    }
    return projection;
  }

  private async materializeAliases(
    exec: Executor,
    scope: ProjectScope,
    actorId: string,
    model: ModelRow,
    nodes: readonly NodeRow[],
    previousNodes: readonly NodeRow[],
    now: string,
  ): Promise<void> {
    const priorLabels = new Map(
      previousNodes.map((node) => [node.topic_node_id, node.label]),
    );
    const currentAliases = (await exec
      .select()
      .from(topicClusterAliases)
      .where(
        and(
          projectPredicate(topicClusterAliases, scope),
          eq(topicClusterAliases.is_current, true),
        ),
      )
      .orderBy(asc(topicClusterAliases.legacy_cluster_key))) as AliasRow[];
    const reserved = new Set(
      currentAliases.map((alias) => alias.legacy_cluster_key),
    );

    for (const node of nodes) {
      const hasAlias = currentAliases.some(
        (alias) => alias.topic_node_id === node.topic_node_id,
      );
      const labelChanged =
        priorLabels.get(node.topic_node_id) !== node.label;
      if (hasAlias && !labelChanged) continue;

      const aliasesForNode = currentAliases.filter(
        (alias) => alias.topic_node_id === node.topic_node_id,
      );
      for (const alias of aliasesForNode) {
        await exec
          .update(topicClusterAliases)
          .set({
            valid_to_revision: model.revision - 1,
            is_current: false,
          })
          .where(
            and(
              projectPredicate(topicClusterAliases, scope),
              eq(topicClusterAliases.id, alias.id),
              eq(topicClusterAliases.is_current, true),
            ),
          );
        reserved.delete(alias.legacy_cluster_key);
      }

      const identity = await exec
        .select({
          initial_cluster_key: topicNodeIdentities.initial_cluster_key,
        })
        .from(topicNodeIdentities)
        .where(
          and(
            projectPredicate(topicNodeIdentities, scope),
            eq(topicNodeIdentities.id, node.topic_node_id),
          ),
        )
        .limit(1);
      const initialKey = identity[0]?.initial_cluster_key;
      const key =
        !hasAlias && typeof initialKey === "string" && !reserved.has(initialKey)
          ? initialKey
          : canonicalTopicClusterKey(
              node.label,
              reserved,
              node.topic_node_id,
            );
      reserved.add(key);
      await exec.insert(topicClusterAliases).values({
        id: this.newId(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        topic_node_id: node.topic_node_id,
        legacy_cluster_key: key,
        valid_from_revision: model.revision,
        valid_to_revision: null,
        alias_kind: hasAlias ? "rename" : "canonical",
        is_current: true,
        created_by: actorId,
        created_at: now,
      });
    }
  }

  private async invalidateAffectedKeywords(
    exec: Executor,
    scope: ProjectScope,
    actorId: string,
    modelRevision: number,
    rootTopicNodeId: string | null,
    currentNodes: readonly NodeRow[],
    previousNodes: readonly NodeRow[],
    reason: string,
    now: string,
  ): Promise<void> {
    const successorRows = await this.loadSuccessors(
      exec,
      scope,
      modelRevision,
    );
    const invalidationByTopic = topicAssignmentInvalidations({
      rootTopicNodeId,
      currentNodes,
      previousNodes,
      successors: successorRows,
    });
    const affected = [...invalidationByTopic.keys()].sort();
    if (affected.length === 0) return;
    const params = affected.map((value) => sql`${value}::uuid`);
    const result = await exec.execute<LatestKeywordDecisionRow>(sql`
      select
        decision.*,
        entity.mapping_revision as entity_revision,
        entity.status as entity_status,
        entity.intent as entity_intent,
        entity.buyer_stage as entity_buyer_stage,
        entity.cluster_key as entity_cluster_key,
        entity.mapping_decision as entity_mapping_decision,
        entity.mapped_site_page_id as entity_mapped_site_page_id,
        entity.mapping_review_state as entity_review_state
      from ${keywordEntities} entity
      join lateral (
        select latest.*
        from ${keywordReviewDecisions} latest
        where latest.workspace_id = entity.workspace_id
          and latest.project_id = entity.project_id
          and latest.keyword_entity_id = entity.id
        order by latest.governance_revision desc, latest.id desc
        limit 1
      ) decision on true
      where entity.workspace_id = ${scope.workspaceId}::uuid
        and entity.project_id = ${scope.projectId}::uuid
        and decision.topic_node_id in (${sql.join(params, sql`, `)})
        and (
          decision.review_state <> 'unreviewed'
          or decision.assignment_invalidated_by is null
        )
      order by entity.id
      for update of entity
    `);
    for (const row of result.rows) {
      if (
        row.entity_revision !== row.governance_revision ||
        row.entity_status !== row.status ||
        row.entity_intent !== row.intent ||
        row.entity_buyer_stage !== row.buyer_stage ||
        row.entity_cluster_key !== row.cluster_key_at_decision ||
        row.entity_mapping_decision !== row.mapping_decision ||
        row.entity_mapped_site_page_id !== row.mapped_site_page_id ||
        row.entity_review_state !== row.review_state
      ) {
        throw new TopicModelIntegrityError(
          "KEYWORD_MIRROR_DIVERGED",
        );
      }
      if (
        row.governance_revision >
        MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
      ) {
        throw new TopicModelIntegrityError(
          "KEYWORD_REVISION_EXHAUSTED",
        );
      }
      const invalidatedBy = invalidationByTopic.get(
        row.topic_node_id ?? "",
      );
      if (!invalidatedBy) {
        throw new TopicModelIntegrityError(
          "KEYWORD_INVALIDATION_KIND_MISSING",
        );
      }
      const governanceRevision = row.governance_revision + 1;
      if (
        typeof row.reviewed_projection !== "object" ||
        row.reviewed_projection === null ||
        Array.isArray(row.reviewed_projection)
      ) {
        throw new TopicModelIntegrityError(
          "KEYWORD_HISTORY_PROJECTION_INVALID",
        );
      }
      const earlierHistoryAvailable =
        row.reviewed_projection["earlierHistoryAvailable"];
      if (typeof earlierHistoryAvailable !== "boolean") {
        throw new TopicModelIntegrityError(
          "KEYWORD_HISTORY_PROJECTION_INVALID",
        );
      }
      const reviewedProjection = {
        projectId: scope.projectId,
        keywordId: row.keyword_entity_id,
        governanceRevision,
        status: row.status,
        intent: row.intent,
        buyerStage: row.buyer_stage,
        topicNodeId: row.topic_node_id,
        topicModelRevision: row.topic_model_revision,
        clusterKey: row.cluster_key_at_decision,
        mappingDecision: row.mapping_decision,
        mappedSitePageId: row.mapped_site_page_id,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: invalidatedBy,
        earlierHistoryAvailable,
      } as const;
      const updated = await exec
        .update(keywordEntities)
        .set({
          mapping_review_state: "unreviewed",
          mapping_revision: governanceRevision,
          updated_at: now,
        })
        .where(
          and(
            projectPredicate(keywordEntities, scope),
            eq(keywordEntities.id, row.keyword_entity_id),
            eq(
              keywordEntities.mapping_revision,
              row.governance_revision,
            ),
          ),
        )
        .returning({ id: keywordEntities.id });
      if (!updated[0]) {
        throw new TopicModelIntegrityError(
          "KEYWORD_INVALIDATION_CAS_FAILED",
        );
      }
      await exec.insert(keywordReviewDecisions).values({
        id: this.newId(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        keyword_entity_id: row.keyword_entity_id,
        governance_revision: governanceRevision,
        decision_origin: "system_suggestion",
        status: row.status,
        intent: row.intent,
        buyer_stage: row.buyer_stage,
        topic_node_id: row.topic_node_id,
        topic_model_revision: row.topic_model_revision,
        cluster_key_at_decision: row.cluster_key_at_decision,
        mapping_decision: row.mapping_decision,
        mapped_site_page_id: row.mapped_site_page_id,
        review_state: "unreviewed",
        assignment_invalidated_by: invalidatedBy,
        decided_by: actorId,
        reason,
        decided_at: now,
        reviewed_projection: reviewedProjection,
        created_at: now,
      });
    }
  }

  private topicContentProjection(
    projection: TopicModelRevision,
  ): Record<string, unknown> {
    return {
      projectionVersion: "topic-model.1.0.0",
      projectId: projection.projectId,
      topicModelRevision: projection.topicModelRevision,
      editRevision: projection.editRevision,
      rootTopicNodeId: projection.rootTopicNodeId,
      nodes: projection.nodes,
      aliases: projection.aliases,
      successorRelationships: projection.successorRelationships,
    };
  }

  private async confirmDraftWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    actorId: string,
    input: ConfirmTopicModelRequest,
  ): Promise<ConfirmedModel> {
    await acquireTopicGovernanceProjectWriterLock(exec, scope);
    await this.assertActiveProject(exec, scope);
    const draft = await this.findLatestModel(
      exec,
      scope,
      "draft",
      true,
    );
    if (!draft) throw new TopicModelConflictError("DRAFT_NOT_FOUND");
    if (draft.revision !== input.topicModelRevision) {
      throw new TopicModelConflictError(
        "MODEL_REVISION_CONFLICT",
        input.topicModelRevision,
        draft.revision,
      );
    }
    if (draft.edit_revision !== input.expectedEditRevision) {
      throw new TopicModelConflictError(
        "EDIT_REVISION_CONFLICT",
        input.expectedEditRevision,
        draft.edit_revision,
      );
    }
    const nodes = await this.loadNodes(exec, scope, draft.revision);
    assertConfirmedTopicTopology({
      rootTopicNodeId: draft.root_topic_node_id,
      nodes: nodes.map((node) => ({
        topicNodeId: node.topic_node_id,
        parentTopicNodeId: node.parent_topic_node_id,
      })),
    });
    const previous = await this.findLatestModel(
      exec,
      scope,
      "confirmed",
      false,
    );
    const previousNodes = previous
      ? await this.loadNodes(exec, scope, previous.revision)
      : [];
    const facts = safeClock(this.clock);
    await this.materializeAliases(
      exec,
      scope,
      actorId,
      draft,
      nodes,
      previousNodes,
      facts.now,
    );
    await this.invalidateAffectedKeywords(
      exec,
      scope,
      actorId,
      draft.revision,
      draft.root_topic_node_id,
      nodes,
      previousNodes,
      input.reason,
      facts.now,
    );

    const draftProjection = await this.projectModel(exec, scope, draft);
    const hash = contentHash(
      this.topicContentProjection(draftProjection) as never,
    );
    const updated = await exec
      .update(topicModelRevisions)
      .set({
        status: "confirmed",
        content_hash: hash,
        confirmed_by: actorId,
        confirmed_at: facts.now,
      })
      .where(
        and(
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.id, draft.id),
          eq(topicModelRevisions.status, "draft"),
          eq(
            topicModelRevisions.edit_revision,
            input.expectedEditRevision,
          ),
        ),
      )
      .returning();
    const model = updated[0] as ModelRow | undefined;
    if (!model) {
      throw new TopicModelConflictError(
        "EDIT_REVISION_CONFLICT",
        input.expectedEditRevision,
        draft.edit_revision,
      );
    }
    const projection = await this.projectModel(exec, scope, model);
    if (projection.state !== "confirmed") {
      throw new TopicModelIntegrityError(
        "CONFIRM_RESULT_NOT_CONFIRMED",
      );
    }
    return projection;
  }
}
