import { EvidenceRepository, type Db, type DbTx, type ProjectScope } from "@sf/db";
import { toEvidenceDto, type EvidenceDto } from "./diagnostic-mappers";

/**
 * Load evidence DTOs grouped by finding id (spec §8, §11.3). Findings and the
 * report share this so evidence rendering is identical everywhere (AC-036).
 */
export async function loadEvidenceByFinding(
  exec: Db | DbTx,
  scope: ProjectScope,
  findingIds: readonly string[],
): Promise<Map<string, EvidenceDto[]>> {
  const result = new Map<string, EvidenceDto[]>();
  if (findingIds.length === 0) return result;

  const repo = new EvidenceRepository(exec);
  const links = await repo.listForFindings(scope, findingIds);
  const evidenceIds = [...new Set(links.map((l) => l.evidence_id))];
  const rows = await repo.findByIds(scope, evidenceIds);
  const byId = new Map(rows.map((r) => [r.id, toEvidenceDto(r)]));

  for (const findingId of findingIds) result.set(findingId, []);
  for (const link of links) {
    const dto = byId.get(link.evidence_id);
    if (dto) result.get(link.finding_id)?.push(dto);
  }
  return result;
}
