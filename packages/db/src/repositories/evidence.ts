import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { evidence, findingObservations } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

const EVIDENCE_QUERY_CHUNK_SIZE = 500;

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

export interface EvidenceLinkReadOptions {
  /**
   * Hard cap for bounded projections. Callers may request their remaining
   * budget plus one row and use that final row as an overflow sentinel.
   */
  readonly maxRows?: number;
  /** Restrict links to the exact frozen diagnostic run when supplied. */
  readonly diagnosticRunId?: string;
}

export interface EvidenceReadPageOptions {
  readonly limit: number;
  /** Last evidence id returned by the preceding ascending-id page. */
  readonly cursor: string | null;
}

export interface ExportEvidenceSizePageRow {
  readonly id: string;
  readonly estimated_bytes: number;
}

export interface ExportEvidenceSizePage {
  readonly rows: ExportEvidenceSizePageRow[];
  readonly nextCursor: string | null;
}

export interface ExportEvidencePageRow {
  readonly id: string;
  readonly source_provider: string;
  readonly grade: string;
  readonly subject_refs: unknown[];
  readonly claim: string;
  readonly observed_at: string;
}

export interface ExportEvidencePage {
  readonly rows: ExportEvidencePageRow[];
  readonly nextCursor: string | null;
}

export interface EvidenceRow {
  readonly id: string;
  readonly diagnostic_run_id: string;
  readonly source_provider: string;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly availability: string;
  readonly support: string;
  readonly subject_refs: unknown[];
  readonly claim: string;
  readonly observed_at: string;
  readonly limitation: string;
  readonly snapshot_id: string | null;
  readonly analysis_invocation_id: string | null;
}

function assertEvidencePageOptions(options: EvidenceReadPageOptions): void {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit <= 0 ||
    options.limit >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("limit must be a positive safe integer");
  }
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
    options: EvidenceLinkReadOptions = {},
  ): Promise<
    { finding_id: string; evidence_id: string; role: string }[]
  > {
    if (findingIds.length === 0) return [];
    if (
      options.maxRows !== undefined &&
      (!Number.isSafeInteger(options.maxRows) || options.maxRows < 0)
    ) {
      throw new RangeError("maxRows must be a non-negative safe integer");
    }
    // Sorted chunks plus the SQL ORDER BY below make the concatenated result
    // globally deterministic, independent of caller or physical row order.
    const ids = [...new Set(findingIds)].sort();
    const rows: { finding_id: string; evidence_id: string; role: string }[] = [];
    for (let offset = 0; offset < ids.length; offset += EVIDENCE_QUERY_CHUNK_SIZE) {
      const remaining = options.maxRows === undefined
        ? undefined
        : options.maxRows - rows.length;
      if (remaining === 0) break;
      const chunk = ids.slice(offset, offset + EVIDENCE_QUERY_CHUNK_SIZE);
      const query = this.exec
        .select({
          finding_id: findingObservations.finding_id,
          evidence_id: findingObservations.evidence_id,
          role: findingObservations.role,
        })
        .from(findingObservations)
        .where(
          and(
            projectPredicate(findingObservations, scope),
            inArray(findingObservations.finding_id, chunk),
            options.diagnosticRunId === undefined
              ? undefined
              : eq(
                  findingObservations.diagnostic_run_id,
                  options.diagnosticRunId,
                ),
          ),
        )
        .orderBy(
          asc(findingObservations.finding_id),
          asc(findingObservations.evidence_id),
          asc(findingObservations.role),
        );
      const batchRows = (await (remaining === undefined
        ? query
        : query.limit(remaining))) as {
        finding_id: string;
        evidence_id: string;
        role: string;
      }[];
      const boundedRows = remaining === undefined
        ? batchRows
        : batchRows.slice(0, remaining);
      for (const row of boundedRows) rows.push(row);
    }
    return rows;
  }

  /** Load evidence rows by id (project-scoped), for evidence summaries. */
  async findByIds(
    scope: ProjectScope,
    ids: readonly string[],
  ): Promise<EvidenceRow[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    const rows: EvidenceRow[] = [];
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += EVIDENCE_QUERY_CHUNK_SIZE
    ) {
      const chunk = uniqueIds.slice(offset, offset + EVIDENCE_QUERY_CHUNK_SIZE);
      rows.push(
        ...((await this.exec
          .select()
          .from(evidence)
          .where(
            and(projectPredicate(evidence, scope), inArray(evidence.id, chunk)),
          )
          .orderBy(asc(evidence.id))) as EvidenceRow[]),
      );
    }
    return rows;
  }

  /**
   * Export preflight reader: stable ascending-id page that exposes a
   * PostgreSQL UTF-8 byte estimate for the mapped evidence row used by the
   * compact-payload budget. This bounds body materialization only; it is not a
   * final ZIP estimate.
   */
  async listExportByteSizesByIdsPage(
    scope: ProjectScope,
    ids: readonly string[],
    options: EvidenceReadPageOptions,
  ): Promise<ExportEvidenceSizePage> {
    assertEvidencePageOptions(options);
    if (ids.length === 0) {
      return { rows: [], nextCursor: null };
    }
    const uniqueIds = [...new Set(ids)].sort();
    const rows = (await this.exec
      .select({
        id: evidence.id,
        estimated_bytes: sql<number>`(
          octet_length(
            convert_to(
              json_build_object(
                'id', ${evidence.id},
                'sourceProvider', ${evidence.source_provider},
                'grade', ${evidence.grade},
                'claim', ${evidence.claim},
                'subjectRefs', ${evidence.subject_refs},
                'observedAt', ${evidence.observed_at}
              )::text,
              'UTF8'
            )
          ) + 1
        )`,
      })
      .from(evidence)
      .where(
        and(
          projectPredicate(evidence, scope),
          inArray(evidence.id, uniqueIds),
          options.cursor === null ? undefined : gt(evidence.id, options.cursor),
        ),
      )
      .orderBy(asc(evidence.id))
      .limit(options.limit + 1)) as ExportEvidenceSizePageRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      rows: page,
      nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Materialize only the fields that enter evidence.json, after the caller has
   * completed the lightweight SQL byte/item preflight for the same id subset.
   */
  async listExportByIdsPage(
    scope: ProjectScope,
    ids: readonly string[],
    options: EvidenceReadPageOptions,
  ): Promise<ExportEvidencePage> {
    assertEvidencePageOptions(options);
    if (ids.length === 0) {
      return { rows: [], nextCursor: null };
    }
    const uniqueIds = [...new Set(ids)].sort();
    const rows = (await this.exec
      .select({
        id: evidence.id,
        source_provider: evidence.source_provider,
        grade: evidence.grade,
        subject_refs: evidence.subject_refs,
        claim: evidence.claim,
        observed_at: evidence.observed_at,
      })
      .from(evidence)
      .where(
        and(
          projectPredicate(evidence, scope),
          inArray(evidence.id, uniqueIds),
          options.cursor === null ? undefined : gt(evidence.id, options.cursor),
        ),
      )
      .orderBy(asc(evidence.id))
      .limit(options.limit + 1)) as ExportEvidencePageRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      rows: page,
      nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
