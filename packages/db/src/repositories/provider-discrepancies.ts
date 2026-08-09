import {
  and,
  asc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  dataSnapshots,
  normalizedObservations,
  providerDiscrepancies,
} from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `provider_discrepancies` records conflicting observations for the same
 * metric/subject/provider/window. Conflicts are NOT averaged (spec §7.6); the
 * pair is recorded and the diagnostic engine lowers confidence when a finding's
 * evidence overlaps a discrepancy.
 */

export interface ProviderDiscrepancyRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly metric_key: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly left_observation_id: string;
  readonly right_observation_id: string;
  readonly resolution: string;
  readonly created_at: string;
}

function parseDetectionRows(value: unknown): ProviderDiscrepancyRow[] {
  const rows = (value as { readonly rows?: readonly Record<string, unknown>[] })
    .rows;
  if (!Array.isArray(rows)) {
    throw new Error("provider discrepancy detection returned an invalid result");
  }
  const pairs = new Set<string>();
  return rows.map((row) => {
    for (const key of [
      "id",
      "workspace_id",
      "project_id",
      "metric_key",
      "subject_type",
      "subject_ref",
      "left_observation_id",
      "right_observation_id",
      "resolution",
    ] as const) {
      if (typeof row[key] !== "string") {
        throw new Error(
          "provider discrepancy detection returned an invalid result",
        );
      }
    }
    const createdAt =
      row["created_at"] instanceof Date
        ? row["created_at"].toISOString()
        : row["created_at"];
    if (typeof createdAt !== "string") {
      throw new Error(
        "provider discrepancy detection returned an invalid result",
      );
    }
    const leftObservationId = row["left_observation_id"] as string;
    const rightObservationId = row["right_observation_id"] as string;
    if (leftObservationId >= rightObservationId) {
      throw new Error(
        "provider discrepancy detection returned a non-canonical pair",
      );
    }
    const pair = `${leftObservationId}:${rightObservationId}`;
    if (pairs.has(pair)) {
      throw new Error(
        "provider discrepancy detection returned a duplicate pair",
      );
    }
    pairs.add(pair);
    return {
      id: row["id"] as string,
      workspace_id: row["workspace_id"] as string,
      project_id: row["project_id"] as string,
      metric_key: row["metric_key"] as string,
      subject_type: row["subject_type"] as string,
      subject_ref: row["subject_ref"] as string,
      left_observation_id: leftObservationId,
      right_observation_id: rightObservationId,
      resolution: row["resolution"] as string,
      created_at: createdAt,
    };
  });
}

export class ProviderDiscrepanciesRepository extends Repository {
  /**
   * Serialize collection commits for one project/provider/window. Without this
   * transaction-scoped lock, two equal-window collections could both inspect an
   * uncommitted prior set and miss their conflict. PostgreSQL releases the lock
   * automatically on commit/rollback.
   */
  async lockCollectionWindow(
    scope: ProjectScope,
    provider: string,
    sourceWindow: Record<string, unknown>,
  ): Promise<void> {
    const windowJson = JSON.stringify(sourceWindow);
    await this.exec.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${scope.workspaceId}:${scope.projectId}:${provider}:`} || (${windowJson}::jsonb)::text, 0))`,
    );
  }

  /** Insert one canonically ordered pair, replaying the existing row on conflict. */
  async insert(
    scope: ProjectScope,
    values: {
      metricKey: string;
      subjectType: string;
      subjectRef: string;
      leftObservationId: string;
      rightObservationId: string;
    },
  ): Promise<ProviderDiscrepancyRow> {
    const orderedObservationIds = [
      values.leftObservationId,
      values.rightObservationId,
    ].sort();
    const leftObservationId = orderedObservationIds[0]!;
    const rightObservationId = orderedObservationIds[1]!;
    const leftObservation = alias(
      normalizedObservations,
      "insert_left_observation",
    );
    const rightObservation = alias(
      normalizedObservations,
      "insert_right_observation",
    );
    const leftSnapshot = alias(dataSnapshots, "insert_left_snapshot");
    const rightSnapshot = alias(dataSnapshots, "insert_right_snapshot");
    const validPair = await this.exec
      .select({ id: leftObservation.id })
      .from(leftObservation)
      .innerJoin(
        rightObservation,
        eq(rightObservation.id, rightObservationId),
      )
      .innerJoin(
        leftSnapshot,
        eq(leftSnapshot.id, leftObservation.snapshot_id),
      )
      .innerJoin(
        rightSnapshot,
        eq(rightSnapshot.id, rightObservation.snapshot_id),
      )
      .where(
        and(
          eq(leftObservation.id, leftObservationId),
          projectPredicate(leftObservation, scope),
          projectPredicate(rightObservation, scope),
          projectPredicate(leftSnapshot, scope),
          projectPredicate(rightSnapshot, scope),
          eq(leftObservation.provider, rightObservation.provider),
          eq(leftObservation.metric_key, values.metricKey),
          eq(rightObservation.metric_key, values.metricKey),
          eq(leftObservation.subject_type, values.subjectType),
          eq(rightObservation.subject_type, values.subjectType),
          eq(leftObservation.subject_ref, values.subjectRef),
          eq(rightObservation.subject_ref, values.subjectRef),
          sql`${leftSnapshot.source_window} = ${rightSnapshot.source_window}`,
          sql`(
            ${leftObservation.availability} is distinct from ${rightObservation.availability}
            or ${leftObservation.value_numeric} is distinct from ${rightObservation.value_numeric}
            or ${leftObservation.value_text} is distinct from ${rightObservation.value_text}
            or ${leftObservation.value_json} is distinct from ${rightObservation.value_json}
          )`,
        ),
      )
      .limit(1);
    if (!validPair[0]) {
      throw new Error(
        "provider discrepancy observations are outside scope or not a substantive equal-window conflict",
      );
    }
    const [inserted] = await this.exec
      .insert(providerDiscrepancies)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        metric_key: values.metricKey,
        subject_type: values.subjectType,
        subject_ref: values.subjectRef,
        left_observation_id: leftObservationId,
        right_observation_id: rightObservationId,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as ProviderDiscrepancyRow;

    const rows = await this.exec
      .select()
      .from(providerDiscrepancies)
      .where(
        and(
          projectPredicate(providerDiscrepancies, scope),
          eq(providerDiscrepancies.left_observation_id, leftObservationId),
          eq(providerDiscrepancies.right_observation_id, rightObservationId),
        ),
      )
      .limit(1);
    const existing = rows[0] as ProviderDiscrepancyRow | undefined;
    if (!existing) {
      throw new Error("provider discrepancy conflict replay missing");
    }
    return existing;
  }

  /**
   * Compare a newly-written snapshot with prior snapshots from the exact same
   * project/provider/source window, then append only substantive conflicts.
   * PostgreSQL `IS DISTINCT FROM` gives null-safe comparisons; JSONB equality
   * ignores object-key order but preserves array order, and numeric equality
   * treats equivalent decimal representations as the same canonical value.
   */
  async detectForSnapshot(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<ProviderDiscrepancyRow[]> {
    const result = await this.exec.execute(sql`
      select
        id,
        workspace_id,
        project_id,
        metric_key,
        subject_type,
        subject_ref,
        left_observation_id,
        right_observation_id,
        resolution,
        created_at
      from app.detect_provider_discrepancies_for_snapshot(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${snapshotId}::uuid
      )
    `);
    return parseDetectionRows(result);
  }

  async listByProject(scope: ProjectScope): Promise<ProviderDiscrepancyRow[]> {
    return (await this.exec
      .select()
      .from(providerDiscrepancies)
      .where(
        projectPredicate(providerDiscrepancies, scope),
      )
      .orderBy(
        asc(providerDiscrepancies.created_at),
        asc(providerDiscrepancies.id),
      )) as ProviderDiscrepancyRow[];
  }

  /**
   * Only unresolved discrepancies touching a frozen manifest snapshot can
   * affect that diagnostic run. Every joined row is project-scoped in SQL so a
   * foreign snapshot/observation ID cannot leak or downgrade confidence.
   */
  async listUnresolvedBySnapshotIds(
    scope: ProjectScope,
    snapshotIds: readonly string[],
  ): Promise<ProviderDiscrepancyRow[]> {
    if (snapshotIds.length === 0) return [];
    const leftObservation = alias(normalizedObservations, "left_observation");
    const rightObservation = alias(
      normalizedObservations,
      "right_observation",
    );
    return (await this.exec
      .select({
        id: providerDiscrepancies.id,
        workspace_id: providerDiscrepancies.workspace_id,
        project_id: providerDiscrepancies.project_id,
        metric_key: providerDiscrepancies.metric_key,
        subject_type: providerDiscrepancies.subject_type,
        subject_ref: providerDiscrepancies.subject_ref,
        left_observation_id: providerDiscrepancies.left_observation_id,
        right_observation_id: providerDiscrepancies.right_observation_id,
        resolution: providerDiscrepancies.resolution,
        created_at: providerDiscrepancies.created_at,
      })
      .from(providerDiscrepancies)
      .innerJoin(
        leftObservation,
        eq(leftObservation.id, providerDiscrepancies.left_observation_id),
      )
      .innerJoin(
        rightObservation,
        eq(rightObservation.id, providerDiscrepancies.right_observation_id),
      )
      .where(
        and(
          projectPredicate(providerDiscrepancies, scope),
          projectPredicate(leftObservation, scope),
          projectPredicate(rightObservation, scope),
          eq(providerDiscrepancies.resolution, "unresolved"),
          or(
            inArray(leftObservation.snapshot_id, [...snapshotIds]),
            inArray(rightObservation.snapshot_id, [...snapshotIds]),
          ),
        ),
      )
      .orderBy(
        asc(providerDiscrepancies.created_at),
        asc(providerDiscrepancies.id),
      )) as ProviderDiscrepancyRow[];
  }
}
