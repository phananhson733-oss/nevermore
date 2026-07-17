import type { WorkspaceScope } from "@sf/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";

/**
 * Workspace aggregate read model (spec §11.3). WP1 implements the `overview`
 * projection (the only screen built in WP1). `plan`/`studio`/`report` return
 * valid empty projections — there are no actions/artifacts/findings until WP3/WP4,
 * where they will share the same projection as the Actions/Artifacts/Report APIs
 * (AC-036). Returning empty is honest for a project without diagnostic data.
 */

export type WorkspaceViewName = "overview" | "plan" | "studio" | "report";

const DOMAINS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

interface Coverage {
  overall: "unavailable" | "partial" | "complete";
  domains: Record<string, "unavailable" | "qualitative" | "partial" | "complete">;
  limitations: string[];
}

/** Coverage for a project with no diagnostic run yet: everything unavailable. */
function emptyCoverage(): Coverage {
  const domains: Coverage["domains"] = {};
  for (const d of DOMAINS) domains[d] = "unavailable";
  return {
    overall: "unavailable",
    domains,
    limitations: ["No data has been collected for this project yet."],
  };
}

export interface OverviewView {
  view: "overview";
  project: ProjectDto;
  coverage: Coverage;
  activeRuns: unknown[];
  topActions: unknown[];
}

export interface PlanView {
  view: "plan";
  actions: unknown[];
}

export interface StudioView {
  view: "studio";
  artifacts: unknown[];
}

export interface ReportView {
  view: "report";
  report: {
    project: ProjectDto;
    outputLocale: string;
    generatedAt: string;
    coverage: Coverage;
    findings: unknown[];
    actions: unknown[];
    artifacts: unknown[];
    methodology: string;
    limitations: string[];
  };
}

export type WorkspaceView = OverviewView | PlanView | StudioView | ReportView;

const METHODOLOGY =
  "Findings are derived from deterministic rules over first-party and public evidence; " +
  "no result, ranking, or revenue outcome is promised.";

export async function getWorkspaceView(
  scope: WorkspaceScope,
  projectId: string,
  view: WorkspaceViewName,
  outputLocale: string | null,
): Promise<WorkspaceView> {
  const project = await getProject(scope, projectId);

  switch (view) {
    case "overview":
      return {
        view: "overview",
        project,
        coverage: emptyCoverage(),
        activeRuns: [],
        topActions: [],
      };
    case "plan":
      return { view: "plan", actions: [] };
    case "studio":
      return { view: "studio", artifacts: [] };
    case "report":
      return {
        view: "report",
        report: {
          project,
          outputLocale: outputLocale ?? project.defaultDeliveryLocale,
          generatedAt: new Date().toISOString(),
          coverage: emptyCoverage(),
          findings: [],
          actions: [],
          artifacts: [],
          methodology: METHODOLOGY,
          limitations: ["No diagnostic run has completed for this project yet."],
        },
      };
  }
}
