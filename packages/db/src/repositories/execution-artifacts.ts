import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  analysisInvocations,
  artifactRevisions,
  executionArtifacts,
} from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

/**
 * `execution_artifacts` + `artifact_revisions` (spec §10.1, §10.3). An artifact is
 * created `generating`; the worker writes revision 1 and sets `draft`. Regenerate
 * reuses the artifact id + a new run without overwriting old revisions. Each PATCH
 * appends a new immutable revision; only a revision with no validation errors may
 * be set `ready`.
 */

export interface ArtifactRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly action_id: string;
  readonly artifact_type: string;
  readonly status: string;
  readonly generation_mode: string;
  readonly output_locale: string;
  readonly current_revision: number;
  readonly validation_state: string;
  readonly content_hash: string | null;
  readonly latest_generation_run_id: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ArtifactRevisionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly artifact_id: string;
  readonly revision: number;
  readonly output_locale: string;
  readonly content_format: string;
  readonly content_text: string | null;
  readonly content_json: unknown;
  readonly content_hash: string;
  readonly generated_by: string;
  readonly editor_id: string | null;
  readonly analysis_invocation_id: string | null;
  readonly note: string | null;
  readonly validation_errors: unknown[];
  readonly created_at: string;
}

export interface ArtifactListPage {
  readonly rows: ArtifactRow[];
  readonly nextCursor: string | null;
}

export interface ArtifactRevisionListPage {
  readonly rows: ArtifactRevisionRow[];
  /** Last revision returned by the preceding descending-revision page. */
  readonly nextCursor: number | null;
}

export interface ArtifactRevisionListPageOptions {
  readonly limit: number;
  readonly cursor: number | null;
}

function encodeCursor(row: { updated_at: string; id: string }): string {
  return encodeTimestampUuidCursor(row.updated_at, row.id);
}
function decodeCursor(
  cursor: string,
): { updatedAt: string; id: string } | null {
  const decoded = decodeTimestampUuidCursor(cursor);
  return decoded ? { updatedAt: decoded.timestamp, id: decoded.id } : null;
}

export class ExecutionArtifactsRepository extends Repository {
  async insert(values: {
    id?: string;
    workspaceId: string;
    projectId: string;
    actionId: string;
    artifactType: string;
    generationMode: string;
    outputLocale: string;
    latestGenerationRunId: string;
    createdBy: string;
  }): Promise<ArtifactRow> {
    const [row] = await this.exec
      .insert(executionArtifacts)
      .values({
        ...(values.id ? { id: values.id } : {}),
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        action_id: values.actionId,
        artifact_type: values.artifactType,
        generation_mode: values.generationMode,
        output_locale: values.outputLocale,
        latest_generation_run_id: values.latestGenerationRunId,
        created_by: values.createdBy,
      })
      .returning();
    return row as ArtifactRow;
  }

  async findById(scope: ProjectScope, id: string): Promise<ArtifactRow | null> {
    const rows = await this.exec
      .select()
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactRow | undefined) ?? null;
  }

  /** Lock one artifact row for an atomic no-op / compare-and-swap decision. */
  async findByIdForUpdate(
    scope: ProjectScope,
    id: string,
  ): Promise<ArtifactRow | null> {
    const rows = await this.exec
      .select()
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as ArtifactRow | undefined) ?? null;
  }

  /** A non-archived artifact for an action + type (regenerate reuse, spec §10.1). */
  async findLiveByActionType(
    scope: ProjectScope,
    actionId: string,
    artifactType: string,
  ): Promise<ArtifactRow | null> {
    const rows = await this.exec
      .select()
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.action_id, actionId),
          eq(executionArtifacts.artifact_type, artifactType),
          sql`${executionArtifacts.status} <> 'archived'`,
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactRow | undefined) ?? null;
  }

  /**
   * The artifact one exact generation run currently owns. Unlike the
   * action-scoped lookup this cannot answer with an artifact a different run
   * claimed, so a run-scoped reader never reports someone else's work.
   */
  async findByGenerationRun(
    scope: ProjectScope,
    runId: string,
  ): Promise<ArtifactRow | null> {
    const rows = await this.exec
      .select()
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.latest_generation_run_id, runId),
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactRow | undefined) ?? null;
  }

  /** Point an existing artifact at a new generation run (regenerate). */
  async startRegeneration(
    id: string,
    runId: string,
    values?: { generationMode: string; outputLocale: string },
  ): Promise<void> {
    await this.exec
      .update(executionArtifacts)
      .set({
        status: "generating",
        latest_generation_run_id: runId,
        ...(values
          ? {
              generation_mode: values.generationMode,
              output_locale: values.outputLocale,
            }
          : {}),
        updated_at: sql`now()`,
      })
      .where(eq(executionArtifacts.id, id));
  }

  /**
   * Service-side regeneration claim. A stale pre-transaction lookup must not
   * resurrect an artifact that was archived before the command commits.
   */
  async startRegenerationIfLive(
    scope: ProjectScope,
    id: string,
    runId: string,
    values: { generationMode: string; outputLocale: string },
  ): Promise<boolean> {
    const rows = await this.exec
      .update(executionArtifacts)
      .set({
        status: "generating",
        latest_generation_run_id: runId,
        generation_mode: values.generationMode,
        output_locale: values.outputLocale,
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          sql`${executionArtifacts.status} <> 'archived'`,
        ),
      )
      .returning({ id: executionArtifacts.id });
    return rows.length === 1;
  }

  /** Worker completion: bump current revision + status + validation state. */
  async setGenerated(
    id: string,
    values: {
      status: string;
      currentRevision: number;
      validationState: string;
      contentHash: string;
    },
  ): Promise<void> {
    await this.exec
      .update(executionArtifacts)
      .set({
        status: values.status,
        current_revision: values.currentRevision,
        validation_state: values.validationState,
        content_hash: values.contentHash,
        updated_at: sql`now()`,
      })
      .where(eq(executionArtifacts.id, id));
  }

  /**
   * Atomically install a manually edited revision if `expectedRevision` is
   * still current. The conditional UPDATE takes the row lock, so two editors
   * cannot both advance the same base revision.
   */
  async setGeneratedIfRevision(
    scope: ProjectScope,
    id: string,
    values: {
      status: string;
      currentRevision: number;
      expectedRevision: number;
      expectedStatus: string;
      validationState: string;
      contentHash: string;
    },
  ): Promise<boolean> {
    const rows = (await this.exec
      .update(executionArtifacts)
      .set({
        status: values.status,
        current_revision: values.currentRevision,
        validation_state: values.validationState,
        content_hash: values.contentHash,
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          eq(executionArtifacts.current_revision, values.expectedRevision),
          eq(executionArtifacts.status, values.expectedStatus),
        ),
      )
      .returning({ id: executionArtifacts.id })) as { id: string }[];
    return rows.length > 0;
  }

  /**
   * Worker completion CAS. The worker may install generated content only while
   * the scoped artifact is still owned by this exact generation run, remains in
   * `generating`, and has not advanced beyond the revision observed before the
   * potentially long-running generation step.
   */
  async setGeneratedForGenerationRun(
    scope: ProjectScope,
    id: string,
    runId: string,
    values: {
      status: string;
      currentRevision: number;
      expectedRevision: number;
      validationState: string;
      contentHash: string;
    },
  ): Promise<boolean> {
    const rows = await this.exec
      .update(executionArtifacts)
      .set({
        status: values.status,
        current_revision: values.currentRevision,
        validation_state: values.validationState,
        content_hash: values.contentHash,
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          eq(executionArtifacts.latest_generation_run_id, runId),
          eq(executionArtifacts.status, "generating"),
          eq(executionArtifacts.current_revision, values.expectedRevision),
        ),
      )
      .returning({ id: executionArtifacts.id });
    return rows.length === 1;
  }

  async setStatus(
    scope: ProjectScope,
    id: string,
    status: string,
  ): Promise<void> {
    await this.exec
      .update(executionArtifacts)
      .set({ status, updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
        ),
      );
  }

  /** Status compare-and-swap against the caller's current content revision. */
  async setStatusIfRevision(
    scope: ProjectScope,
    id: string,
    status: string,
    expectedRevision: number,
    expectedStatus: string,
  ): Promise<boolean> {
    const rows = (await this.exec
      .update(executionArtifacts)
      .set({ status, updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          eq(executionArtifacts.current_revision, expectedRevision),
          eq(executionArtifacts.status, expectedStatus),
        ),
      )
      .returning({ id: executionArtifacts.id })) as { id: string }[];
    return rows.length > 0;
  }

  async setFailed(id: string): Promise<void> {
    await this.exec
      .update(executionArtifacts)
      .set({ status: "failed", updated_at: sql`now()` })
      .where(eq(executionArtifacts.id, id));
  }

  /**
   * Fail only the scoped artifact still owned by this exact generation run. A
   * live worker supplies `expectedRevision`; queue recovery may omit it because
   * it has no pre-generation snapshot, while retaining scope/run/status guards.
   */
  async setFailedForGenerationRun(
    scope: ProjectScope,
    id: string,
    runId: string,
    expectedRevision?: number,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(executionArtifacts)
      .set({ status: "failed", updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          eq(executionArtifacts.latest_generation_run_id, runId),
          eq(executionArtifacts.status, "generating"),
          expectedRevision === undefined
            ? undefined
            : eq(executionArtifacts.current_revision, expectedRevision),
        ),
      )
      .returning({ id: executionArtifacts.id });
    return rows.length === 1;
  }

  /**
   * Reclaim every scoped artifact still owned by this exact generation run.
   *
   * Some capabilities (Content Shadow) claim their artifact inside the worker
   * rather than in the accepting command, so the failure path has no artifact id
   * to compensate with. Keying on `latest_generation_run_id` is exactly as
   * narrow as `setFailedForGenerationRun`: an artifact a later run already took
   * over no longer matches, so a superseded run cannot fail someone else's work.
   */
  async failGeneratingByGenerationRun(
    scope: ProjectScope,
    runId: string,
  ): Promise<number> {
    const rows = await this.exec
      .update(executionArtifacts)
      .set({ status: "failed", updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.latest_generation_run_id, runId),
          eq(executionArtifacts.status, "generating"),
        ),
      )
      .returning({ id: executionArtifacts.id });
    return rows.length;
  }

  // --- revisions ----------------------------------------------------------

  async insertRevision(values: {
    workspaceId: string;
    projectId: string;
    artifactId: string;
    revision: number;
    outputLocale: string;
    contentFormat: string;
    contentText: string | null;
    contentJson: unknown | null;
    contentHash: string;
    generatedBy: string;
    editorId: string | null;
    analysisInvocationId: string | null;
    note: string | null;
    validationErrors: unknown[];
  }): Promise<ArtifactRevisionRow> {
    const [row] = await this.exec
      .insert(artifactRevisions)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        artifact_id: values.artifactId,
        revision: values.revision,
        output_locale: values.outputLocale,
        content_format: values.contentFormat,
        content_text: values.contentText,
        content_json: values.contentJson,
        content_hash: values.contentHash,
        generated_by: values.generatedBy,
        editor_id: values.editorId,
        analysis_invocation_id: values.analysisInvocationId,
        note: values.note,
        validation_errors: values.validationErrors,
      })
      .returning();
    return row as ArtifactRevisionRow;
  }

  async findRevision(
    scope: ProjectScope,
    artifactId: string,
    revision: number,
  ): Promise<ArtifactRevisionRow | null> {
    const rows = await this.exec
      .select()
      .from(artifactRevisions)
      .where(
        and(
          projectPredicate(artifactRevisions, scope),
          eq(artifactRevisions.artifact_id, artifactId),
          eq(artifactRevisions.revision, revision),
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactRevisionRow | undefined) ?? null;
  }

  /**
   * The artifact revision one exact async Run generated, resolved through the
   * append-only invocation ledger (revision -> analysis_invocation -> run).
   *
   * `execution_artifacts.latest_generation_run_id` is a MUTABLE pointer that a
   * later regeneration re-aims, so it cannot answer "what did this finished run
   * produce". This lineage can: both rows it walks are append-only.
   */
  async findRevisionByGenerationRun(
    scope: ProjectScope,
    asyncRunId: string,
  ): Promise<ArtifactRevisionRow | null> {
    const rows = (await this.exec
      .select({
        id: artifactRevisions.id,
        workspace_id: artifactRevisions.workspace_id,
        project_id: artifactRevisions.project_id,
        artifact_id: artifactRevisions.artifact_id,
        revision: artifactRevisions.revision,
        output_locale: artifactRevisions.output_locale,
        content_format: artifactRevisions.content_format,
        content_text: artifactRevisions.content_text,
        content_json: artifactRevisions.content_json,
        content_hash: artifactRevisions.content_hash,
        generated_by: artifactRevisions.generated_by,
        editor_id: artifactRevisions.editor_id,
        analysis_invocation_id: artifactRevisions.analysis_invocation_id,
        note: artifactRevisions.note,
        validation_errors: artifactRevisions.validation_errors,
        created_at: artifactRevisions.created_at,
      })
      .from(artifactRevisions)
      .innerJoin(
        analysisInvocations,
        eq(analysisInvocations.id, artifactRevisions.analysis_invocation_id),
      )
      .where(
        and(
          projectPredicate(artifactRevisions, scope),
          projectPredicate(analysisInvocations, scope),
          eq(analysisInvocations.async_run_id, asyncRunId),
        ),
      )
      .orderBy(desc(artifactRevisions.revision))
      .limit(1)) as ArtifactRevisionRow[];
    return rows[0] ?? null;
  }

  async listRevisions(
    scope: ProjectScope,
    artifactId: string,
  ): Promise<ArtifactRevisionRow[]> {
    return (await this.exec
      .select()
      .from(artifactRevisions)
      .where(
        and(
          projectPredicate(artifactRevisions, scope),
          eq(artifactRevisions.artifact_id, artifactId),
        ),
      )
      .orderBy(desc(artifactRevisions.revision))) as ArtifactRevisionRow[];
  }

  /**
   * Bounded revision reader for export assembly. `artifact_id` plus the
   * monotonically increasing revision is unique, and the artifact predicate is
   * fixed for the whole walk, so `revision < cursor` is a stable descending
   * keyset inside the caller's repeatable-read snapshot.
   */
  async listRevisionsPage(
    scope: ProjectScope,
    artifactId: string,
    options: ArtifactRevisionListPageOptions,
  ): Promise<ArtifactRevisionListPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new RangeError("limit must be a positive safe integer");
    }
    if (
      options.cursor !== null &&
      (!Number.isSafeInteger(options.cursor) || options.cursor <= 0)
    ) {
      throw new RangeError("cursor must be a positive safe integer or null");
    }
    const rows = (await this.exec
      .select()
      .from(artifactRevisions)
      .where(
        and(
          projectPredicate(artifactRevisions, scope),
          eq(artifactRevisions.artifact_id, artifactId),
          options.cursor === null
            ? undefined
            : lt(artifactRevisions.revision, options.cursor),
        ),
      )
      .orderBy(desc(artifactRevisions.revision))
      .limit(options.limit + 1)) as ArtifactRevisionRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      rows: page,
      nextCursor: hasNext ? (page[page.length - 1]?.revision ?? null) : null,
    };
  }

  async listByProject(
    scope: ProjectScope,
    opts: {
      limit: number;
      cursor: string | null;
      artifactType?: string | null;
      status?: string | null;
    },
  ): Promise<ArtifactListPage> {
    const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !keyset) return { rows: [], nextCursor: null };
    const after =
      keyset != null
        ? or(
            lt(executionArtifacts.updated_at, keyset.updatedAt),
            and(
              eq(executionArtifacts.updated_at, keyset.updatedAt),
              lt(executionArtifacts.id, keyset.id),
            ),
          )
        : undefined;
    const typeFilter = opts.artifactType
      ? eq(executionArtifacts.artifact_type, opts.artifactType)
      : undefined;
    const statusFilter = opts.status
      ? eq(executionArtifacts.status, opts.status)
      : undefined;
    const rows = (await this.exec
      .select()
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          typeFilter,
          statusFilter,
          after,
        ),
      )
      .orderBy(desc(executionArtifacts.updated_at), desc(executionArtifacts.id))
      .limit(opts.limit + 1)) as ArtifactRow[];
    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeCursor(last) : null,
    };
  }
}
