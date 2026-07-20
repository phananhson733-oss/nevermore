import { EvidenceRepository, type Db, type DbTx, type ProjectScope } from "@sf/db";
import { toEvidenceDto, type EvidenceDto } from "./diagnostic-mappers";

const EVIDENCE_LOAD_BATCH_SIZE = 500;

export interface EvidenceLoadBudget {
  readonly maxLinks: number;
  readonly maxEvidenceRows: number;
  readonly maxEvidenceBytes: number;
  readonly onExceeded: () => never;
}

function batches<T>(values: readonly T[]): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += EVIDENCE_LOAD_BATCH_SIZE) {
    result.push(values.slice(offset, offset + EVIDENCE_LOAD_BATCH_SIZE));
  }
  return result;
}

/**
 * Load evidence DTOs grouped by finding id (spec §8, §11.3). Findings and the
 * report share this so evidence rendering is identical everywhere (AC-036).
 */
export async function loadEvidenceByFinding(
  exec: Db | DbTx,
  scope: ProjectScope,
  findingIds: readonly string[],
  budget?: EvidenceLoadBudget,
): Promise<Map<string, EvidenceDto[]>> {
  const result = new Map<string, EvidenceDto[]>();
  if (findingIds.length === 0) return result;

  const repo = new EvidenceRepository(exec);
  const uniqueFindingIds = [...new Set(findingIds)];
  const links: Awaited<ReturnType<EvidenceRepository["listForFindings"]>> = [];
  for (const findingBatch of batches(uniqueFindingIds)) {
    const batchLinks = budget
      ? await repo.listForFindings(scope, findingBatch, {
          maxRows: budget.maxLinks - links.length + 1,
        })
      : await repo.listForFindings(scope, findingBatch);
    for (const link of batchLinks) links.push(link);
    if (budget && links.length > budget.maxLinks) budget.onExceeded();
  }

  const evidenceIds = [...new Set(links.map((l) => l.evidence_id))];
  if (budget && evidenceIds.length > budget.maxEvidenceRows) budget.onExceeded();

  const byId = new Map<string, EvidenceDto>();
  const encoder = budget ? new TextEncoder() : null;
  let evidenceBytes = 2; // JSON array brackets.
  for (const evidenceBatch of batches(evidenceIds)) {
    const rows = await repo.findByIds(scope, evidenceBatch);
    for (const row of rows) {
      if (byId.has(row.id)) continue;
      const dto = toEvidenceDto(row);
      if (budget && encoder) {
        const serialized = JSON.stringify(dto);
        evidenceBytes +=
          (byId.size === 0 ? 0 : 1) + encoder.encode(serialized).byteLength;
        if (evidenceBytes > budget.maxEvidenceBytes) budget.onExceeded();
      }
      byId.set(row.id, dto);
    }
  }

  for (const findingId of uniqueFindingIds) result.set(findingId, []);
  for (const link of links) {
    const dto = byId.get(link.evidence_id);
    if (dto) result.get(link.finding_id)?.push(dto);
  }
  return result;
}
