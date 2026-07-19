import {
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  FindingsRepository,
  ProjectsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";
import { loadEvidenceByFinding } from "./diagnostic-load";
import {
  toCoverageDto,
  toFindingDto,
  toRuleResultDto,
  type CoverageDto,
  type FindingDto,
  type RuleResultDto,
} from "./diagnostic-mappers";

/**
 * `listProjectFindings` (spec §11.3). Returns a page of findings with evidence
 * plus meta that distinguishes "no finding" from "rule did not run": the latest
 * diagnostic run, its coverage, and all rule results (pass/candidate/skipped/
 * inconclusive with reason).
 */

export interface FindingListResult {
  readonly data: FindingDto[];
  readonly meta: {
    nextCursor: string | null;
    hasNext: boolean;
    limit: number;
    latestRun: AsyncRunDto | null;
    coverage: CoverageDto | null;
    ruleResults: RuleResultDto[];
  };
}

export async function listProjectFindings(
  scope: WorkspaceScope,
  projectId: string,
  opts: { limit: number; cursor: string | null; activeOnly: boolean },
): Promise<FindingListResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const page = await new FindingsRepository(db).list(projectScope, opts);
  const findingIds = page.rows.map((f) => f.id);
  const evidenceByFinding = await loadEvidenceByFinding(db, projectScope, findingIds);
  const data = page.rows.map((f) => toFindingDto(f, evidenceByFinding.get(f.id) ?? []));

  // Meta: latest diagnostic run, coverage, and the 11 rule results.
  const diagRepo = new DiagnosticRunsRepository(db);
  const latest = await diagRepo.findLatest(projectScope);
  let latestRun: AsyncRunDto | null = null;
  let coverage: CoverageDto | null = null;
  let ruleResults: RuleResultDto[] = [];
  if (latest) {
    const asyncRun = await new AsyncRunsRepository(db).findById(projectScope, latest.id);
    latestRun = asyncRun ? toAsyncRunDto(asyncRun) : null;
    coverage = toCoverageDto(latest.coverage);
    const rows = await diagRepo.listRuleResults(latest.id);
    ruleResults = rows.map(toRuleResultDto);
  }

  return {
    data,
    meta: {
      nextCursor: page.nextCursor,
      hasNext: page.nextCursor !== null,
      limit: opts.limit,
      latestRun,
      coverage,
      ruleResults,
    },
  };
}
