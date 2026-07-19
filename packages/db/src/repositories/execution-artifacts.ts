import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { artifactRevisions, executionArtifacts } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

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

function encodeCursor(row: { updated_at: string; id: string }): string {
  return Buffer.from(`${row.updated_at} ${row.id}`, "utf8").toString(
    "base64url",
  );
}
function decodeCursor(
  cursor: string,
): { updatedAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.indexOf(" ");
    if (idx < 0) return null;
    return { updatedAt: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
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
  ): Promise<boolean> {
    const rows = (await this.exec
      .update(executionArtifacts)
      .set({ status, updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.id, id),
          eq(executionArtifacts.current_revision, expectedRevision),
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

  // --- revisions ----------------------------------------------------------

  async insertRevision(values: {
    workspaceId: string;
    projectId: string;
    artifactId: string;
    revision: number;
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

  async listByProject(
    scope: ProjectScope,
    opts: { limit: number; cursor: string | null },
  ): Promise<ArtifactListPage> {
    const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;
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
    const rows = (await this.exec
      .select()
      .from(executionArtifacts)
      .where(and(projectPredicate(executionArtifacts, scope), after))
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
