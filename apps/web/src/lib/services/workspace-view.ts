import { AsyncRunsRepository, type WorkspaceScope } from "@sf/db";
import { getDb } from "@/lib/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";
import { listProjectActions } from "./actions-service";
import { listProjectArtifacts } from "./artifacts";
import { getProjectReport, type ReportDto } from "./report";
import { listProjectFindings } from "./findings-list";
import type { ActionDto, CoverageDto } from "./diagnostic-mappers";
import type { ArtifactDto } from "./artifact-mappers";

/**
 * Workspace aggregate read model (spec §11.3). Each view is produced by the SAME
 * canonical projection as its dedicated API (AC-036): `plan` ↔ Actions, `studio`
 * ↔ Artifacts, `report` ↔ Report. It is a read convenience, never a separate
 * store, and never recomputes priority.
 */

export type WorkspaceViewName = "overview" | "plan" | "studio" | "report";

export interface OverviewView {
  view: "overview";
  project: ProjectDto;
  coverage: CoverageDto;
  activeRuns: AsyncRunDto[];
  topActions: ActionDto[];
}

/**
 * Honest empty coverage for a project with no diagnostic run yet. The OpenAPI
 * `OverviewView.coverage` is required + non-nullable, and `overall: "unavailable"`
 * is the canonical "no data" marker (spec §1.3 — unavailable, never fabricated).
 * Empty `domains` renders every domain as "missing" in the overview.
 */
const EMPTY_COVERAGE: CoverageDto = {
  overall: "unavailable",
  domains: {},
  limitations: [],
};

export interface PlanView {
  view: "plan";
  actions: ActionDto[];
}

export interface StudioView {
  view: "studio";
  artifacts: ArtifactDto[];
}

export interface ReportView {
  view: "report";
  report: ReportDto;
}

export type WorkspaceView = OverviewView | PlanView | StudioView | ReportView;

export async function getWorkspaceView(
  scope: WorkspaceScope,
  projectId: string,
  view: WorkspaceViewName,
  outputLocale: string | null,
): Promise<WorkspaceView> {
  switch (view) {
    case "overview": {
      const projectScope = { workspaceId: scope.workspaceId, projectId };
      const project = await getProject(scope, projectId);
      const { db } = getDb();
      const activeRunRows = await new AsyncRunsRepository(
        db,
      ).listActiveByProject(projectScope);
      const findings = await listProjectFindings(scope, projectId, {
        limit: 1,
        cursor: null,
        activeOnly: true,
      });
      const plan = await listProjectActions(scope, projectId, {
        limit: 5,
        cursor: null,
      });
      return {
        view: "overview",
        project,
        coverage: findings.meta.coverage ?? EMPTY_COVERAGE,
        activeRuns: activeRunRows.map(toAsyncRunDto),
        topActions: plan.data,
      };
    }
    case "plan": {
      const plan = await listProjectActions(scope, projectId, {
        limit: 100,
        cursor: null,
      });
      return { view: "plan", actions: plan.data };
    }
    case "studio": {
      const studio = await listProjectArtifacts(scope, projectId, {
        limit: 100,
        cursor: null,
      });
      return { view: "studio", artifacts: studio.data };
    }
    case "report": {
      const report = await getProjectReport(
        scope,
        projectId,
        outputLocale,
        new Date().toISOString(),
      );
      return { view: "report", report };
    }
  }
}
