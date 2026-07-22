import { and, asc, eq, inArray } from "drizzle-orm";
import { findingTargets } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

export type FindingTargetRelation =
  | "direct_url"
  | "affected_by_template"
  | "affected_by_site"
  | "affected_by_page_set"
  | "affected_by_http_status"
  | "affected_by_canonical_issue"
  | "affected_by_keyword_cluster"
  | "affected_by_user_agent";

export type FindingTargetKind =
  | "url"
  | "template"
  | "site"
  | "page_set"
  | "http_status"
  | "canonical_issue"
  | "keyword_cluster"
  | "user_agent";

export type FindingTargetResolutionState =
  | "resolved"
  | "unresolved"
  | "definition_only";

export type FindingTargetBasisKind =
  | "crawl_exact_fetch"
  | "observation_site_page"
  | "unresolved_observation"
  | "target_definition";

export interface FindingTargetRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly finding_id: string;
  readonly diagnostic_run_id: string;
  readonly relation: FindingTargetRelation;
  readonly target_kind: FindingTargetKind;
  readonly target_ref: string;
  readonly resolution_state: FindingTargetResolutionState;
  readonly basis_kind: FindingTargetBasisKind;
  readonly site_page_id: string | null;
  readonly page_snapshot_id: string | null;
  readonly source_observation_id: string | null;
  readonly member_ref: string | null;
  readonly limitation: string | null;
  readonly relation_key: string;
  readonly created_at: string;
}

/** Semantic target/member data; scope and relation_key are repository/DB owned. */
export interface FindingTargetInsert {
  readonly siteId: string;
  readonly findingId: string;
  readonly diagnosticRunId: string;
  readonly relation: FindingTargetRelation;
  readonly targetKind: FindingTargetKind;
  readonly targetRef: string;
  readonly resolutionState: FindingTargetResolutionState;
  readonly basisKind: FindingTargetBasisKind;
  readonly sitePageId?: string | null;
  readonly pageSnapshotId?: string | null;
  readonly sourceObservationId?: string | null;
  readonly memberRef?: string | null;
  readonly limitation?: string | null;
}

export const MAX_FINDING_TARGET_INSERT = 500;
export const MAX_FINDING_TARGET_LOOKUP = 200;
const INSERT_CHUNK = 250;
const MAX_ID_LENGTH = 256;

function assertBoundedId(label: string, value: string): void {
  if (value.trim().length === 0 || value.length > MAX_ID_LENGTH) {
    throw new RangeError(
      `${label} must be between 1 and ${MAX_ID_LENGTH} characters`,
    );
  }
}

function assertBoundedText(
  label: string,
  value: string,
  maximum: number,
): void {
  if (
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    throw new RangeError(
      `${label} must be trimmed and contain 1 to ${maximum} characters`,
    );
  }
}

function compareNullable(left: string | null | undefined, right: string | null | undefined): number {
  return compareCodeUnits(left ?? "", right ?? "");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareInserts(left: FindingTargetInsert, right: FindingTargetInsert): number {
  return (
    compareCodeUnits(left.findingId, right.findingId) ||
    compareCodeUnits(left.diagnosticRunId, right.diagnosticRunId) ||
    compareCodeUnits(left.relation, right.relation) ||
    compareCodeUnits(left.targetRef, right.targetRef) ||
    compareNullable(left.sourceObservationId, right.sourceObservationId) ||
    compareNullable(left.sitePageId, right.sitePageId) ||
    compareNullable(left.memberRef, right.memberRef)
  );
}

function validateInsert(value: FindingTargetInsert): void {
  assertBoundedId("siteId", value.siteId);
  assertBoundedId("findingId", value.findingId);
  assertBoundedId("diagnosticRunId", value.diagnosticRunId);
  for (const [label, id] of [
    ["sitePageId", value.sitePageId],
    ["pageSnapshotId", value.pageSnapshotId],
    ["sourceObservationId", value.sourceObservationId],
  ] as const) {
    if (id !== null && id !== undefined) assertBoundedId(label, id);
  }
  assertBoundedText(
    "targetRef",
    value.targetRef,
    value.targetKind === "url" ? 2048 : 500,
  );
  if (value.memberRef !== null && value.memberRef !== undefined) {
    assertBoundedText("memberRef", value.memberRef, 2048);
  }
  if (value.limitation !== null && value.limitation !== undefined) {
    assertBoundedText("limitation", value.limitation, 2000);
  }
}

export class FindingTargetsRepository extends Repository {
  /**
   * Append a bounded per-run ledger batch. Sorting by Finding before each
   * multi-row INSERT gives the DB's Finding-row locks one global order, while
   * the relation-key conflict target makes exact replay a no-op.
   */
  async insertMany(
    scope: ProjectScope,
    targets: readonly FindingTargetInsert[],
  ): Promise<number> {
    if (targets.length === 0) return 0;
    if (targets.length > MAX_FINDING_TARGET_INSERT) {
      throw new RangeError(
        `finding target insert accepts at most ${MAX_FINDING_TARGET_INSERT} rows`,
      );
    }
    for (const target of targets) validateInsert(target);
    const ordered = [...targets].sort(compareInserts);
    let inserted = 0;
    for (let offset = 0; offset < ordered.length; offset += INSERT_CHUNK) {
      const chunk = ordered.slice(offset, offset + INSERT_CHUNK);
      const rows = await this.exec
        .insert(findingTargets)
        .values(
          chunk.map((target) => ({
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: target.siteId,
            finding_id: target.findingId,
            diagnostic_run_id: target.diagnosticRunId,
            relation: target.relation,
            target_kind: target.targetKind,
            target_ref: target.targetRef,
            resolution_state: target.resolutionState,
            basis_kind: target.basisKind,
            site_page_id: target.sitePageId ?? null,
            page_snapshot_id: target.pageSnapshotId ?? null,
            source_observation_id: target.sourceObservationId ?? null,
            member_ref: target.memberRef ?? null,
            limitation: target.limitation ?? null,
          })),
        )
        .onConflictDoNothing({
          target: [
            findingTargets.finding_id,
            findingTargets.diagnostic_run_id,
            findingTargets.relation_key,
          ],
        })
        .returning({ id: findingTargets.id });
      inserted += rows.length;
    }
    return inserted;
  }

  /** URL read model: unresolved and definition-only rows have no page membership. */
  async listForSitePage(
    scope: ProjectScope,
    diagnosticRunId: string,
    sitePageId: string,
  ): Promise<FindingTargetRow[]> {
    assertBoundedId("diagnosticRunId", diagnosticRunId);
    assertBoundedId("sitePageId", sitePageId);
    return (await this.exec
      .select()
      .from(findingTargets)
      .where(
        and(
          projectPredicate(findingTargets, scope),
          eq(findingTargets.diagnostic_run_id, diagnosticRunId),
          eq(findingTargets.site_page_id, sitePageId),
          eq(findingTargets.resolution_state, "resolved"),
        ),
      )
      .orderBy(
        asc(findingTargets.finding_id),
        asc(findingTargets.relation_key),
        asc(findingTargets.id),
      )) as FindingTargetRow[];
  }

  /** Run-scoped ledger read used to project canonical roots and all members. */
  async listForFindings(
    scope: ProjectScope,
    diagnosticRunId: string,
    findingIds: readonly string[],
  ): Promise<FindingTargetRow[]> {
    if (findingIds.length === 0) return [];
    assertBoundedId("diagnosticRunId", diagnosticRunId);
    const ids = [...new Set(findingIds)];
    if (ids.length > MAX_FINDING_TARGET_LOOKUP) {
      throw new RangeError(
        `finding target lookup accepts at most ${MAX_FINDING_TARGET_LOOKUP} unique IDs`,
      );
    }
    for (const id of ids) assertBoundedId("findingId", id);
    return (await this.exec
      .select()
      .from(findingTargets)
      .where(
        and(
          projectPredicate(findingTargets, scope),
          eq(findingTargets.diagnostic_run_id, diagnosticRunId),
          inArray(findingTargets.finding_id, ids),
        ),
      )
      .orderBy(
        asc(findingTargets.finding_id),
        asc(findingTargets.relation_key),
        asc(findingTargets.id),
      )) as FindingTargetRow[];
  }
}
