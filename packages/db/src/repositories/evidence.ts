import { and, inArray } from "drizzle-orm";
import { evidence, findingObservations } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `evidence` and `finding_observations` are append-only (spec §7.7, §12.3).
 * Evidence records the five axes (origin/method/grade/availability/support) and
 * links to its snapshot / collection run / analysis invocation. `generated`
 * evidence MUST have an `analysis_invocation_id` — a DB check enforces this, so a
 * model output can never masquerade as observed (AC-024).
 */

export interface EvidenceInsert {
  readonly sourceProvider: string;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly availability: string;
  readonly support: string;
  readonly subjectRefs: unknown[];
  readonly claim: string;
  readonly observedAt: string;
  readonly limitation: string;
  readonly snapshotId?: string | null;
  readonly analysisInvocationId?: string | null;
}

export interface FindingObservationInsert {
  readonly findingId: string;
  readonly evidenceId: string;
  readonly role: string;
}

export class EvidenceRepository extends Repository {
  /** Batch-insert evidence for a run, returning the new ids in input order. */
  async insertMany(
    values: { workspaceId: string; projectId: string; diagnosticRunId: string },
    rows: readonly EvidenceInsert[],
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = (await this.exec
      .insert(evidence)
      .values(
        rows.map((e) => ({
          workspace_id: values.workspaceId,
          project_id: values.projectId,
          diagnostic_run_id: values.diagnosticRunId,
          snapshot_id: e.snapshotId ?? null,
          analysis_invocation_id: e.analysisInvocationId ?? null,
          source_provider: e.sourceProvider,
          origin: e.origin,
          method: e.method,
          grade: e.grade,
          availability: e.availability,
          support: e.support,
          subject_refs: e.subjectRefs,
          claim: e.claim,
          observed_at: e.observedAt,
          limitation: e.limitation,
        })),
      )
      .returning({ id: evidence.id })) as { id: string }[];
    return inserted.map((r) => r.id);
  }

  /** Link findings to their evidence (append-only). */
  async linkObservations(
    values: { workspaceId: string; projectId: string; diagnosticRunId: string },
    links: readonly FindingObservationInsert[],
  ): Promise<void> {
    if (links.length === 0) return;
    await this.exec.insert(findingObservations).values(
      links.map((l) => ({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        finding_id: l.findingId,
        diagnostic_run_id: values.diagnosticRunId,
        evidence_id: l.evidenceId,
        role: l.role,
      })),
    );
  }

  /** Load the evidence linked to a set of findings (Diagnosis screen / report). */
  async listForFindings(
    scope: ProjectScope,
    findingIds: readonly string[],
  ): Promise<
    { finding_id: string; evidence_id: string; role: string }[]
  > {
    if (findingIds.length === 0) return [];
    return (await this.exec
      .select({
        finding_id: findingObservations.finding_id,
        evidence_id: findingObservations.evidence_id,
        role: findingObservations.role,
      })
      .from(findingObservations)
      .where(
        and(
          projectPredicate(findingObservations, scope),
          inArray(findingObservations.finding_id, [...findingIds]),
        ),
      )) as { finding_id: string; evidence_id: string; role: string }[];
  }

  /** Load evidence rows by id (project-scoped), for evidence summaries. */
  async findByIds(
    scope: ProjectScope,
    ids: readonly string[],
  ): Promise<
    {
      id: string;
      source_provider: string;
      origin: string;
      method: string;
      grade: string;
      availability: string;
      support: string;
      subject_refs: unknown[];
      claim: string;
      observed_at: string;
      limitation: string;
      snapshot_id: string | null;
      analysis_invocation_id: string | null;
    }[]
  > {
    if (ids.length === 0) return [];
    return (await this.exec
      .select()
      .from(evidence)
      .where(and(projectPredicate(evidence, scope), inArray(evidence.id, [...ids])))) as {
      id: string;
      source_provider: string;
      origin: string;
      method: string;
      grade: string;
      availability: string;
      support: string;
      subject_refs: unknown[];
      claim: string;
      observed_at: string;
      limitation: string;
      snapshot_id: string | null;
      analysis_invocation_id: string | null;
    }[];
  }
}
