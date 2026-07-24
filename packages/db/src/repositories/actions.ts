import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { actionOverrideAudit, actions } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

/**
 * `actions` are template-derived (spec §9.2), created idempotently when a Finding
 * is confirmed. `action_key = sha256({projectId, findingKey, templateId})` is
 * unique per project; re-confirm merges evidence refs and refreshes timestamps
 * but never duplicates the Action, rebinds its source DiagnosticRun, or
 * overwrites human priority/status.
 * `action_override_audit` is the append-only human-override trail (spec §9.3).
 */

export interface ActionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly source_finding_id: string;
  readonly source_diagnostic_run_id: string;
  readonly action_key: string;
  readonly template_id: string;
  readonly template_version: number;
  readonly title: string;
  readonly description: string;
  readonly content_locale: string;
  readonly priority_band: string;
  readonly roadmap_lane: string;
  readonly status: string;
  readonly effort: string;
  readonly risk: string;
  readonly expected_outcome: string;
  readonly evidence_refs: unknown[];
  readonly revision: number;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ActionListPage {
  readonly rows: ActionRow[];
  readonly nextCursor: string | null;
}

function encodeCursor(row: { updated_at: string; id: string }): string {
  return encodeTimestampUuidCursor(row.updated_at, row.id);
}

export class ActionsRepository extends Repository {
  static isListCursorValid(cursor: string): boolean {
    return decodeTimestampUuidCursor(cursor) !== null;
  }

  async findByKey(
    scope: ProjectScope,
    actionKey: string,
  ): Promise<ActionRow | null> {
    const rows = await this.exec
      .select()
      .from(actions)
      .where(
        and(
          projectPredicate(actions, scope),
          eq(actions.action_key, actionKey),
        ),
      )
      .limit(1);
    return (rows[0] as ActionRow | undefined) ?? null;
  }

  async findById(scope: ProjectScope, id: string): Promise<ActionRow | null> {
    const rows = await this.exec
      .select()
      .from(actions)
      .where(and(projectPredicate(actions, scope), eq(actions.id, id)))
      .limit(1);
    return (rows[0] as ActionRow | undefined) ?? null;
  }

  /** Lock one project-scoped Action through a mutable gate and its writes. */
  async findByIdForUpdate(
    scope: ProjectScope,
    id: string,
  ): Promise<ActionRow | null> {
    const rows = await this.exec
      .select()
      .from(actions)
      .where(and(projectPredicate(actions, scope), eq(actions.id, id)))
      .limit(1)
      .for("update");
    return (rows[0] as ActionRow | undefined) ?? null;
  }

  /** Create the template Action (Finding confirm tx, spec §9.2). */
  async insert(values: {
    workspaceId: string;
    projectId: string;
    sourceFindingId: string;
    sourceDiagnosticRunId: string;
    actionKey: string;
    templateId: string;
    templateVersion: number;
    title: string;
    description: string;
    contentLocale: string;
    priorityBand: string;
    roadmapLane: string;
    status: string;
    effort: string;
    risk: string;
    expectedOutcome: string;
    evidenceRefs: unknown[];
    createdBy: string;
  }): Promise<ActionRow> {
    const [row] = await this.exec
      .insert(actions)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        source_finding_id: values.sourceFindingId,
        source_diagnostic_run_id: values.sourceDiagnosticRunId,
        action_key: values.actionKey,
        template_id: values.templateId,
        template_version: values.templateVersion,
        title: values.title,
        description: values.description,
        content_locale: values.contentLocale,
        priority_band: values.priorityBand,
        roadmap_lane: values.roadmapLane,
        status: values.status,
        effort: values.effort,
        risk: values.risk,
        expected_outcome: values.expectedOutcome,
        evidence_refs: values.evidenceRefs,
        created_by: values.createdBy,
      })
      .returning();
    return row as ActionRow;
  }

  /** Merge evidence refs on re-confirm without touching human priority/status. */
  async mergeEvidenceRefs(id: string, evidenceRefs: unknown[]): Promise<void> {
    await this.exec
      .update(actions)
      .set({ evidence_refs: evidenceRefs, updated_at: sql`now()` })
      .where(eq(actions.id, id));
  }

  /**
   * Apply a human override with an atomic compare-and-swap revision bump.
   * Returns false when a concurrent writer has already advanced the revision.
   */
  async applyOverride(
    scope: ProjectScope,
    id: string,
    values: {
      status?: string;
      priorityBand?: string;
      roadmapLane?: string;
      toRevision: number;
      expectedRevision: number;
    },
  ): Promise<boolean> {
    const rows = (await this.exec
      .update(actions)
      .set({
        ...(values.status ? { status: values.status } : {}),
        ...(values.priorityBand ? { priority_band: values.priorityBand } : {}),
        ...(values.roadmapLane ? { roadmap_lane: values.roadmapLane } : {}),
        revision: values.toRevision,
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(actions, scope),
          eq(actions.id, id),
          eq(actions.revision, values.expectedRevision),
        ),
      )
      .returning({ id: actions.id })) as { id: string }[];
    return rows.length > 0;
  }

  /** Append the override audit row (append-only, spec §9.3). */
  async appendOverrideAudit(values: {
    workspaceId: string;
    projectId: string;
    actionId: string;
    fromRevision: number;
    toRevision: number;
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    reason: string;
    note: string | null;
    actorId: string;
  }): Promise<void> {
    await this.exec.insert(actionOverrideAudit).values({
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      action_id: values.actionId,
      from_revision: values.fromRevision,
      to_revision: values.toRevision,
      old_values: values.oldValues,
      new_values: values.newValues,
      reason: values.reason,
      note: values.note,
      actor_id: values.actorId,
    });
  }

  /** List a project's actions for the 30/60/90 plan (spec §9.3). */
  async list(
    scope: ProjectScope,
    opts: {
      limit: number;
      cursor: string | null;
      lane?: string | null;
      status?: string | null;
    },
  ): Promise<ActionListPage> {
    const keyset = opts.cursor ? decodeTimestampUuidCursor(opts.cursor) : null;
    const laneFilter = opts.lane
      ? eq(actions.roadmap_lane, opts.lane)
      : undefined;
    const statusFilter = opts.status
      ? eq(actions.status, opts.status)
      : undefined;
    const after =
      keyset != null
        ? or(
            lt(actions.updated_at, keyset.timestamp),
            and(
              eq(actions.updated_at, keyset.timestamp),
              lt(actions.id, keyset.id),
            ),
          )
        : undefined;
    const rows = (await this.exec
      .select()
      .from(actions)
      .where(
        and(projectPredicate(actions, scope), laneFilter, statusFilter, after),
      )
      .orderBy(desc(actions.updated_at), desc(actions.id))
      .limit(opts.limit + 1)) as ActionRow[];
    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeCursor(last) : null,
    };
  }

  /** Active (non-dismissed) actions for a source finding (review gate, spec §9.1). */
  async findActiveByFinding(
    scope: ProjectScope,
    findingId: string,
  ): Promise<ActionRow | null> {
    const rows = await this.exec
      .select()
      .from(actions)
      .where(
        and(
          projectPredicate(actions, scope),
          eq(actions.source_finding_id, findingId),
          sql`${actions.status} <> 'dismissed'`,
        ),
      )
      .limit(1);
    return (rows[0] as ActionRow | undefined) ?? null;
  }

  /**
   * Count the non-dismissed Actions bound to one source Finding. Mirrors
   * `findActiveByFinding` but returns a scalar so read-only projections can
   * assert the canonical "one confirmed Finding -> one Action" cardinality
   * without materializing rows. Dismissed Actions are excluded (spec §9.1).
   */
  async countActionsForFinding(
    scope: ProjectScope,
    findingId: string,
  ): Promise<number> {
    const rows = (await this.exec
      .select({ value: sql<number>`count(*)` })
      .from(actions)
      .where(
        and(
          projectPredicate(actions, scope),
          eq(actions.source_finding_id, findingId),
          sql`${actions.status} <> 'dismissed'`,
        ),
      )) as { value: number | string }[];
    const first = rows[0];
    return first ? Number(first.value) : 0;
  }
}
