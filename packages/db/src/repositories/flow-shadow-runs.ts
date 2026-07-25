import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  flowShadowQaGates,
  flowShadowResearchPacks,
  flowShadowRuns,
} from "../schema.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * The frozen projection version of a Content Shadow run. Like the Growth Audit
 * projection version it is immutable so a shadow run can be re-rendered
 * deterministically from its frozen inputs and content_hash.
 *
 * 0.3.1 (Slice 2 Task 4b): the frozen manifest and the research pack gained the
 * brief-outline projection. This is the ONLY version position that records
 * "the extraction algorithm itself changed", which is what lets a future
 * auditor tell an input change apart from an algorithm change. Advancing it
 * makes already-queued runs fail with CONTENT_SHADOW_INPUT_DRIFT — that is the
 * intended red-line-C semantics, not something to paper over.
 */
export const CONTENT_SHADOW_PROJECTION_VERSION = "content-shadow.0.3.1";

export interface FlowShadowRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly capability_run_id: string;
  readonly source_finding_id: string;
  readonly source_action_id: string;
  readonly content_brief_artifact_id: string;
  readonly content_brief_revision: number;
  readonly flow_adapter_version: string;
  readonly frozen_input_manifest: Record<string, unknown>;
  readonly content_hash: string;
  readonly projection_version: string;
  readonly created_at: string;
}

export interface FlowShadowRunListPage {
  readonly rows: readonly FlowShadowRunRow[];
  readonly nextCursor: string | null;
}

export interface FlowShadowResearchPackRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly flow_shadow_run_id: string;
  readonly analysis_invocation_id: string | null;
  readonly content_hash: string;
  readonly pack: Record<string, unknown>;
  readonly created_at: string;
}

export interface FlowShadowQaGateRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly flow_shadow_run_id: string;
  readonly evaluated_artifact_id: string;
  readonly evaluated_revision: number;
  readonly analysis_invocation_id: string | null;
  readonly verdict: "passed" | "needs_review" | "blocked";
  readonly claims: readonly unknown[];
  readonly created_at: string;
}

export interface FlowShadowRunCreate {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly capabilityRunId: string;
  readonly sourceFindingId: string;
  readonly sourceActionId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly flowAdapterVersion: string;
  readonly frozenInputManifest: Record<string, unknown>;
  readonly contentHash: string;
  readonly projectionVersion: string;
}

function encodeCursor(row: { created_at: string; id: string }): string {
  return encodeTimestampUuidCursor(row.created_at, row.id);
}

function decodeCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  const decoded = decodeTimestampUuidCursor(cursor);
  return decoded ? { createdAt: decoded.timestamp, id: decoded.id } : null;
}

/** Content Shadow projection over one canonical content_shadow capability run. */
export class FlowShadowRunsRepository extends Repository {
  async create(values: FlowShadowRunCreate): Promise<FlowShadowRunRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const [inserted] = await this.exec
      .insert(flowShadowRuns)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        capability_run_id: values.capabilityRunId,
        source_finding_id: values.sourceFindingId,
        source_action_id: values.sourceActionId,
        content_brief_artifact_id: values.contentBriefArtifactId,
        content_brief_revision: values.contentBriefRevision,
        flow_adapter_version: values.flowAdapterVersion,
        frozen_input_manifest: values.frozenInputManifest,
        content_hash: values.contentHash,
        projection_version: values.projectionVersion,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as FlowShadowRunRow;

    const existing = await this.findByCapabilityRunId(
      scope,
      values.capabilityRunId,
    );
    if (existing && this.matchesImmutable(existing, values)) return existing;
    throw new Error("flow shadow run replay conflicts with immutable values");
  }

  private matchesImmutable(
    row: FlowShadowRunRow,
    values: FlowShadowRunCreate,
  ): boolean {
    return (
      row.site_id === values.siteId &&
      row.source_finding_id === values.sourceFindingId &&
      row.source_action_id === values.sourceActionId &&
      row.content_brief_artifact_id === values.contentBriefArtifactId &&
      row.content_brief_revision === values.contentBriefRevision &&
      row.flow_adapter_version === values.flowAdapterVersion &&
      row.content_hash === values.contentHash &&
      row.projection_version === values.projectionVersion
    );
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<FlowShadowRunRow | null> {
    const rows = await this.exec
      .select()
      .from(flowShadowRuns)
      .where(and(projectPredicate(flowShadowRuns, scope), eq(flowShadowRuns.id, id)))
      .limit(1);
    return (rows[0] as FlowShadowRunRow | undefined) ?? null;
  }

  async findByCapabilityRunId(
    scope: ProjectScope,
    capabilityRunId: string,
  ): Promise<FlowShadowRunRow | null> {
    const rows = await this.exec
      .select()
      .from(flowShadowRuns)
      .where(
        and(
          projectPredicate(flowShadowRuns, scope),
          eq(flowShadowRuns.capability_run_id, capabilityRunId),
        ),
      )
      .limit(1);
    return (rows[0] as FlowShadowRunRow | undefined) ?? null;
  }

  async findByContentHash(
    scope: ProjectScope,
    contentHash: string,
  ): Promise<FlowShadowRunRow | null> {
    const rows = await this.exec
      .select()
      .from(flowShadowRuns)
      .where(
        and(
          projectPredicate(flowShadowRuns, scope),
          eq(flowShadowRuns.content_hash, contentHash),
        ),
      )
      .limit(1);
    return (rows[0] as FlowShadowRunRow | undefined) ?? null;
  }

  async listByProject(
    scope: ProjectScope,
    opts: { limit: number; cursor: string | null },
  ): Promise<FlowShadowRunListPage> {
    const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !keyset) return { rows: [], nextCursor: null };
    const after =
      keyset != null
        ? or(
            lt(flowShadowRuns.created_at, keyset.createdAt),
            and(
              eq(flowShadowRuns.created_at, keyset.createdAt),
              lt(flowShadowRuns.id, keyset.id),
            ),
          )
        : undefined;
    const rows = (await this.exec
      .select()
      .from(flowShadowRuns)
      .where(and(projectPredicate(flowShadowRuns, scope), after))
      .orderBy(desc(flowShadowRuns.created_at), desc(flowShadowRuns.id))
      .limit(opts.limit + 1)) as FlowShadowRunRow[];
    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeCursor(last) : null,
    };
  }
}

export interface FlowShadowResearchPackInsert {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly flowShadowRunId: string;
  readonly analysisInvocationId: string | null;
  readonly contentHash: string;
  readonly pack: Record<string, unknown>;
}

/** Append-only research facts for one shadow run (one pack per run). */
export class FlowShadowResearchPacksRepository extends Repository {
  async insert(
    values: FlowShadowResearchPackInsert,
  ): Promise<FlowShadowResearchPackRow> {
    const [inserted] = await this.exec
      .insert(flowShadowResearchPacks)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        flow_shadow_run_id: values.flowShadowRunId,
        analysis_invocation_id: values.analysisInvocationId,
        content_hash: values.contentHash,
        pack: values.pack,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as FlowShadowResearchPackRow;

    const existing = await this.findByRun(
      { workspaceId: values.workspaceId, projectId: values.projectId },
      values.flowShadowRunId,
    );
    if (existing && existing.content_hash === values.contentHash) {
      return existing;
    }
    throw new Error(
      "flow shadow research pack replay conflicts with immutable values",
    );
  }

  async findByRun(
    scope: ProjectScope,
    flowShadowRunId: string,
  ): Promise<FlowShadowResearchPackRow | null> {
    const rows = await this.exec
      .select()
      .from(flowShadowResearchPacks)
      .where(
        and(
          projectPredicate(flowShadowResearchPacks, scope),
          eq(flowShadowResearchPacks.flow_shadow_run_id, flowShadowRunId),
        ),
      )
      .limit(1);
    return (rows[0] as FlowShadowResearchPackRow | undefined) ?? null;
  }
}

export interface FlowShadowQaGateInsert {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly flowShadowRunId: string;
  readonly evaluatedArtifactId: string;
  readonly evaluatedRevision: number;
  readonly analysisInvocationId: string | null;
  readonly verdict: "passed" | "needs_review" | "blocked";
  readonly claims: readonly unknown[];
}

/** Append-only SEO/GEO + factual review verdicts for evaluated draft revisions. */
export class FlowShadowQaGatesRepository extends Repository {
  async insert(values: FlowShadowQaGateInsert): Promise<FlowShadowQaGateRow> {
    const [inserted] = await this.exec
      .insert(flowShadowQaGates)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        flow_shadow_run_id: values.flowShadowRunId,
        evaluated_artifact_id: values.evaluatedArtifactId,
        evaluated_revision: values.evaluatedRevision,
        analysis_invocation_id: values.analysisInvocationId,
        verdict: values.verdict,
        claims: [...values.claims],
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as FlowShadowQaGateRow;

    const existing = await this.findGate(values);
    if (existing && existing.verdict === values.verdict) return existing;
    throw new Error(
      "flow shadow qa gate replay conflicts with immutable values",
    );
  }

  private async findGate(
    values: FlowShadowQaGateInsert,
  ): Promise<FlowShadowQaGateRow | null> {
    const rows = await this.exec
      .select()
      .from(flowShadowQaGates)
      .where(
        and(
          projectPredicate(flowShadowQaGates, {
            workspaceId: values.workspaceId,
            projectId: values.projectId,
          }),
          eq(flowShadowQaGates.flow_shadow_run_id, values.flowShadowRunId),
          eq(flowShadowQaGates.evaluated_artifact_id, values.evaluatedArtifactId),
          eq(flowShadowQaGates.evaluated_revision, values.evaluatedRevision),
        ),
      )
      .limit(1);
    return (rows[0] as FlowShadowQaGateRow | undefined) ?? null;
  }

  async findByRun(
    scope: ProjectScope,
    flowShadowRunId: string,
  ): Promise<FlowShadowQaGateRow[]> {
    return (await this.exec
      .select()
      .from(flowShadowQaGates)
      .where(
        and(
          projectPredicate(flowShadowQaGates, scope),
          eq(flowShadowQaGates.flow_shadow_run_id, flowShadowRunId),
        ),
      )
      .orderBy(
        desc(flowShadowQaGates.created_at),
        desc(flowShadowQaGates.id),
      )) as FlowShadowQaGateRow[];
  }
}
