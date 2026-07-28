import {
  DecideKeywordRelationRequest as DecideKeywordRelationRequestSchema,
  GrowthMapKeywordRelation as GrowthMapKeywordRelationSchema,
  KeywordRelationDecisionResult as KeywordRelationDecisionResultSchema,
  KeywordRelationDetailResponse,
  KeywordRelationListResponse,
  KeywordRelationRefreshResponse,
  KeywordRelationRevisionConflict,
  Uuid,
  type DecideKeywordRelationRequest,
  type GrowthMapCoverage,
  type GrowthMapKeywordRelation,
} from "@sf/contracts";
import {
  KeywordRelationConflictError,
  KeywordRelationIntegrityError,
  KeywordRelationsRepository,
  MAX_KEYWORD_RELATION_KEYWORD_LOOKUP,
  MAX_KEYWORD_RELATION_PAGE_SIZE,
  ProjectsRepository,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError, type ProblemFieldError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { assertValidTimestampUuidListCursor } from "./list-cursor";

const NO_RELATIONS =
  "No current or historical Keyword Relation candidates are available on this cursor page.";
const STALE_RELATIONS =
  "One or more Keyword Relations are stale because Keyword governance changed; refresh candidates before deciding.";

export interface GrowthMapKeywordRelationListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  /**
   * Optional bounded association lookup for the Keyword Library page currently
   * visible to the customer. Either member of the canonical pair may match.
   */
  readonly keywordIds?: readonly string[];
}

export interface KeywordRelationMutationScope extends WorkspaceScope {
  /** Server-resolved operator identity; never accepted from request input. */
  readonly actorId: string;
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function relationNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Keyword Relation not found.");
}

function assertRelationId(relationId: string): void {
  if (!Uuid.safeParse(relationId).success) relationNotFound();
}

function relationAuthorityUnavailable(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Keyword Relation authority failed its integrity checks.",
  );
}

function pointerFor(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return `/${path
    .map((segment) =>
      String(segment).replace(/~/gu, "~0").replace(/\//gu, "~1"),
    )
    .join("/")}`;
}

function validationError(
  detail: string,
  errors: readonly ProblemFieldError[],
): never {
  throw new ProblemError("VALIDATION_ERROR", detail, { errors });
}

function invalidListOption(pointer: string): never {
  return validationError("Query parameter failed validation.", [
    {
      pointer,
      code: "invalid_query_value",
      message: "Invalid query parameter.",
    },
  ]);
}

function parseDecision(
  input: DecideKeywordRelationRequest,
): DecideKeywordRelationRequest {
  const parsed = DecideKeywordRelationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Request failed validation.",
      parsed.error.issues.map((issue) => ({
        pointer: pointerFor(issue.path),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function assertListOptions(
  options: GrowthMapKeywordRelationListOptions,
): void {
  assertValidTimestampUuidListCursor(options.cursor);
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_KEYWORD_RELATION_PAGE_SIZE
  ) {
    invalidListOption("/limit");
  }
  const keywordIds = options.keywordIds;
  if (keywordIds === undefined) return;
  if (
    keywordIds.length < 1 ||
    keywordIds.length > MAX_KEYWORD_RELATION_KEYWORD_LOOKUP ||
    new Set(keywordIds).size !== keywordIds.length ||
    keywordIds.some((keywordId) => !Uuid.safeParse(keywordId).success)
  ) {
    invalidListOption("/keywordId");
  }
}

async function loadActiveProject(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<ProjectScope> {
  const project = await new ProjectsRepository(exec).findById(
    scope,
    projectId,
  );
  if (
    !project ||
    project.workspace_id !== scope.workspaceId ||
    project.id !== projectId ||
    project.archived_at !== null
  ) {
    return projectNotFound();
  }
  return { workspaceId: scope.workspaceId, projectId };
}

function coverageFor(
  rows: readonly GrowthMapKeywordRelation[],
): GrowthMapCoverage {
  if (rows.length === 0) {
    return {
      availability: "unavailable",
      limitations: [NO_RELATIONS],
    };
  }
  if (
    rows.some(
      (row) =>
        row.candidateState === "stale" ||
        row.decisionState === "stale",
    )
  ) {
    return {
      availability: "partial",
      limitations: [STALE_RELATIONS],
    };
  }
  return { availability: "available", limitations: [] };
}

function parseListResponse(
  value: unknown,
): ReturnType<typeof KeywordRelationListResponse.parse> {
  const parsed = KeywordRelationListResponse.safeParse(value);
  if (!parsed.success) return relationAuthorityUnavailable();
  return parsed.data;
}

function parseDetailResponse(
  value: unknown,
): ReturnType<typeof KeywordRelationDetailResponse.parse> {
  const parsed = KeywordRelationDetailResponse.safeParse(value);
  if (!parsed.success) return relationAuthorityUnavailable();
  return parsed.data;
}

function parseRefreshResponse(
  value: unknown,
): ReturnType<typeof KeywordRelationRefreshResponse.parse> {
  const parsed = KeywordRelationRefreshResponse.safeParse(value);
  if (!parsed.success) return relationAuthorityUnavailable();
  return parsed.data;
}

function parseDecisionResult(
  value: unknown,
): ReturnType<typeof KeywordRelationDecisionResultSchema.parse> {
  const parsed = KeywordRelationDecisionResultSchema.safeParse(value);
  if (!parsed.success) return relationAuthorityUnavailable();
  return parsed.data;
}

function canonicalNow(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return relationAuthorityUnavailable();
  }
  return now.toISOString();
}

function revisionConflict(
  projectId: string,
  relationId: string,
  input: DecideKeywordRelationRequest,
  error: KeywordRelationConflictError,
): never {
  if (
    error.expectedRevision !== input.expectedRelationRevision ||
    error.currentRevision === null ||
    error.currentCandidateId === null
  ) {
    return relationAuthorityUnavailable();
  }
  const parsed = KeywordRelationRevisionConflict.safeParse({
    kind: "revision_conflict",
    resource: "keyword_relation",
    projectId,
    resourceId: relationId,
    expectedRevision: error.expectedRevision,
    currentRevision: error.currentRevision,
    currentCandidateId: error.currentCandidateId,
  });
  if (!parsed.success) return relationAuthorityUnavailable();
  throw new ProblemError(
    "STALE_REVISION",
    "Keyword Relation revision is stale; refetch and retry.",
    { current: parsed.data },
  );
}

async function currentRelationForConflict(
  repository: KeywordRelationsRepository,
  scope: ProjectScope,
  relationId: string,
  input: DecideKeywordRelationRequest,
  error: KeywordRelationConflictError,
): Promise<GrowthMapKeywordRelation> {
  let relation: GrowthMapKeywordRelation | null;
  try {
    relation = await repository.findById(scope, relationId);
  } catch (error) {
    if (error instanceof KeywordRelationIntegrityError) {
      return relationAuthorityUnavailable();
    }
    throw error;
  }
  const parsed = GrowthMapKeywordRelationSchema.safeParse(relation);
  if (
    !parsed.success ||
    error.expectedRevision !== input.expectedRelationRevision ||
    error.currentRevision !== parsed.data.currentRelationRevision ||
    error.currentCandidateId !== parsed.data.candidate.candidateId
  ) {
    return relationAuthorityUnavailable();
  }
  return parsed.data;
}

async function mapDecisionError(
  error: unknown,
  repository: KeywordRelationsRepository,
  scope: ProjectScope,
  relationId: string,
  input: DecideKeywordRelationRequest,
): Promise<never> {
  if (error instanceof KeywordRelationConflictError) {
    switch (error.code) {
      case "PROJECT_NOT_FOUND":
        return projectNotFound();
      case "RELATION_NOT_FOUND":
        return relationNotFound();
      case "REVISION_CONFLICT":
        return revisionConflict(
          scope.projectId,
          relationId,
          input,
          error,
        );
      case "CANDIDATE_STALE": {
        const relation = await currentRelationForConflict(
          repository,
          scope,
          relationId,
          input,
          error,
        );
        throw new ProblemError(
          "VERSION_CONFLICT",
          "The Keyword Relation candidate is stale; refetch the current evidence and retry.",
          {
            current: {
              kind: "candidate_stale",
              resource: "keyword_relation",
              projectId: scope.projectId,
              resourceId: relationId,
              expectedRevision: input.expectedRelationRevision,
              currentRevision: relation.currentRelationRevision,
              currentCandidateId: relation.candidate.candidateId,
              relation,
            },
          },
        );
      }
      case "PAIR_MISMATCH":
        if (
          error.expectedRevision !== input.expectedRelationRevision ||
          error.currentRevision !== input.expectedRelationRevision ||
          error.currentCandidateId !== input.candidateId
        ) {
          return relationAuthorityUnavailable();
        }
        return validationError(
          "The fold decision must use the exact Keyword Relation pair.",
          [
            {
              pointer: "/primaryKeywordId",
              code: "keyword_relation_pair_mismatch",
              message:
                "Primary and supporting Keyword IDs must be the exact relation pair.",
            },
            {
              pointer: "/supportingKeywordId",
              code: "keyword_relation_pair_mismatch",
              message:
                "Primary and supporting Keyword IDs must be the exact relation pair.",
            },
          ],
        );
      case "FOLD_GRAPH_CONFLICT": {
        const relation = await currentRelationForConflict(
          repository,
          scope,
          relationId,
          input,
          error,
        );
        throw new ProblemError(
          "VERSION_CONFLICT",
          "The requested fold would create a Keyword Relation chain or cycle.",
          {
            current: {
              kind: "fold_graph_conflict",
              resource: "keyword_relation",
              projectId: scope.projectId,
              resourceId: relationId,
              currentRevision: relation.currentRelationRevision,
              currentCandidateId: relation.candidate.candidateId,
              relation,
            },
          },
        );
      }
      case "REVISION_EXHAUSTED":
        return relationAuthorityUnavailable();
    }
  }
  if (error instanceof KeywordRelationIntegrityError) {
    return relationAuthorityUnavailable();
  }
  throw error;
}

function mapRefreshError(error: unknown): never {
  if (error instanceof KeywordRelationConflictError) {
    if (error.code === "PROJECT_NOT_FOUND") return projectNotFound();
    if (error.code === "RELATION_NOT_FOUND") return relationNotFound();
    if (error.code === "REVISION_EXHAUSTED") {
      return relationAuthorityUnavailable();
    }
  }
  if (error instanceof KeywordRelationIntegrityError) {
    return relationAuthorityUnavailable();
  }
  throw error;
}

async function listInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  options: GrowthMapKeywordRelationListOptions,
): Promise<ReturnType<typeof KeywordRelationListResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  try {
    const page = await new KeywordRelationsRepository(exec).listByProject(
      scope,
      {
        limit: options.limit,
        cursor: options.cursor,
        ...(options.keywordIds === undefined
          ? {}
          : { keywordIds: options.keywordIds }),
      },
    );
    return parseListResponse({
      projectId,
      data: page.rows,
      meta: {
        limit: options.limit,
        nextCursor: page.nextCursor,
        hasNext: page.nextCursor !== null,
        coverage: coverageFor(page.rows),
      },
    });
  } catch (error) {
    if (error instanceof KeywordRelationIntegrityError) {
      return relationAuthorityUnavailable();
    }
    throw error;
  }
}

async function detailInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  relationId: string,
): Promise<ReturnType<typeof KeywordRelationDetailResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  try {
    const data = await new KeywordRelationsRepository(exec).findById(
      scope,
      relationId,
    );
    if (!data) return relationNotFound();
    return parseDetailResponse({ projectId, data });
  } catch (error) {
    if (error instanceof KeywordRelationIntegrityError) {
      return relationAuthorityUnavailable();
    }
    throw error;
  }
}

async function refreshInTransaction(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  generatedAt: string,
): Promise<ReturnType<typeof KeywordRelationRefreshResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  try {
    const result =
      await new KeywordRelationsRepository(exec).refreshCandidates(scope);
    return parseRefreshResponse({ projectId, ...result, generatedAt });
  } catch (error) {
    return mapRefreshError(error);
  }
}

async function decideInTransaction(
  exec: Executor,
  mutationScope: KeywordRelationMutationScope,
  projectId: string,
  relationId: string,
  input: DecideKeywordRelationRequest,
): Promise<ReturnType<typeof KeywordRelationDecisionResultSchema.parse>> {
  const scope = await loadActiveProject(exec, mutationScope, projectId);
  const repository = new KeywordRelationsRepository(exec);
  try {
    const result = await repository.decide(
      scope,
      relationId,
      mutationScope.actorId,
      input,
    );
    return parseDecisionResult(result);
  } catch (error) {
    return mapDecisionError(
      error,
      repository,
      scope,
      relationId,
      input,
    );
  }
}

/**
 * List current/historical Keyword Relation projections. A bounded keywordIds
 * lookup joins one visible Keyword Library page without N+1 database reads.
 */
export async function listProjectAuditKeywordRelations(
  scope: WorkspaceScope,
  projectId: string,
  options: GrowthMapKeywordRelationListOptions,
  exec?: Executor,
): Promise<ReturnType<typeof KeywordRelationListResponse.parse>> {
  assertListOptions(options);
  if (exec) return listInSnapshot(exec, scope, projectId, options);
  return getDb().db.transaction(
    (tx) => listInSnapshot(tx, scope, projectId, options),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Read one customer-visible Keyword Relation projection. */
export async function getProjectAuditKeywordRelation(
  scope: WorkspaceScope,
  projectId: string,
  relationId: string,
  exec?: Executor,
): Promise<ReturnType<typeof KeywordRelationDetailResponse.parse>> {
  assertRelationId(relationId);
  if (exec) {
    return detailInSnapshot(exec, scope, projectId, relationId);
  }
  return getDb().db.transaction(
    (tx) => detailInSnapshot(tx, scope, projectId, relationId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Re-evaluate governed Keywords and append immutable duplicate candidates. */
export async function refreshProjectAuditKeywordRelations(
  scope: WorkspaceScope,
  projectId: string,
  exec?: Executor,
  now: Date = new Date(),
): Promise<ReturnType<typeof KeywordRelationRefreshResponse.parse>> {
  const generatedAt = canonicalNow(now);
  if (exec) {
    return refreshInTransaction(exec, scope, projectId, generatedAt);
  }
  return getDb().db.transaction((tx) =>
    refreshInTransaction(tx, scope, projectId, generatedAt),
  );
}

/**
 * Append one compare-and-swap customer decision. The actor is always the
 * authenticated server operator and exact replays remain successful.
 */
export async function decideProjectAuditKeywordRelation(
  scope: KeywordRelationMutationScope,
  projectId: string,
  relationId: string,
  body: DecideKeywordRelationRequest,
  exec?: Executor,
): Promise<ReturnType<typeof KeywordRelationDecisionResultSchema.parse>> {
  assertRelationId(relationId);
  const input = parseDecision(body);
  if (exec) {
    return decideInTransaction(
      exec,
      scope,
      projectId,
      relationId,
      input,
    );
  }
  return getDb().db.transaction((tx) =>
    decideInTransaction(
      tx,
      scope,
      projectId,
      relationId,
      input,
    ),
  );
}
