import {
  ActionsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { getDb } from "@/lib/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";
import { loadEvidenceByFinding } from "./diagnostic-load";
import {
  toActionDto,
  toCoverageDto,
  toFindingDto,
  type ActionDto,
  type CoverageDto,
  type FindingDto,
} from "./diagnostic-mappers";
import { toArtifactDto, type ArtifactDto } from "./artifact-mappers";

/**
 * Client report projection (spec §10.4). A server-side read model — NOT a table.
 * It reads only canonical objects (AC-036): confirmed + active findings with key
 * evidence, non-dismissed actions (the 30/60/90 plan), and READY artifacts (draft
 * artifacts are excluded from the client view). It never recomputes priority.
 */

const METHODOLOGY =
  "Findings are derived from deterministic rules over first-party and public evidence; " +
  "no result, ranking, or revenue outcome is promised.";

export interface ReportDto {
  project: ProjectDto;
  outputLocale: string;
  generatedAt: string;
  coverage: CoverageDto;
  findings: FindingDto[];
  actions: ActionDto[];
  artifacts: ArtifactDto[];
  methodology: string;
  limitations: string[];
}

function emptyCoverage(): CoverageDto {
  return {
    overall: "unavailable",
    domains: {
      technical_seo: "unavailable",
      search_performance: "unavailable",
      content_intent: "unavailable",
      conversion_journey: "unavailable",
      geo_ai: "unavailable",
    },
    limitations: ["No diagnostic run has completed for this project yet."],
  };
}

export async function getProjectReport(
  scope: WorkspaceScope,
  projectId: string,
  outputLocale: string | null,
  generatedAt: string,
): Promise<ReportDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await getProject(scope, projectId);
  const locale = outputLocale ?? project.defaultDeliveryLocale;

  const latest = await new DiagnosticRunsRepository(db).findLatest(projectScope);
  const coverage = latest ? toCoverageDto(latest.coverage) : emptyCoverage();

  // Confirmed + active findings (client-readable), with key evidence.
  const findingPage = await new FindingsRepository(db).list(projectScope, {
    limit: 100,
    cursor: null,
    activeOnly: true,
  });
  const confirmed = findingPage.rows.filter((f) => f.review_state === "confirmed");
  const evidenceByFinding = await loadEvidenceByFinding(
    db,
    projectScope,
    confirmed.map((f) => f.id),
  );
  const findings = confirmed.map((f) => toFindingDto(f, evidenceByFinding.get(f.id) ?? []));

  // Non-dismissed actions (the 30/60/90 plan).
  const actionPage = await new ActionsRepository(db).list(projectScope, { limit: 100, cursor: null });
  const actions = actionPage.rows
    .filter((a) => a.status !== "dismissed")
    .map(toActionDto);

  // READY artifacts only (draft artifacts stay out of the client view).
  const artifactsRepo = new ExecutionArtifactsRepository(db);
  const artifactPage = await artifactsRepo.listByProject(projectScope, { limit: 100, cursor: null });
  const readyArtifacts = artifactPage.rows.filter((a) => a.status === "ready");
  const artifacts: ArtifactDto[] = [];
  for (const a of readyArtifacts) {
    const current = a.current_revision > 0
      ? await artifactsRepo.findRevision(projectScope, a.id, a.current_revision)
      : null;
    artifacts.push(toArtifactDto(a, current, null));
  }

  return {
    project,
    outputLocale: locale,
    generatedAt,
    coverage,
    findings,
    actions,
    artifacts,
    methodology: METHODOLOGY,
    limitations: coverage.limitations,
  };
}
