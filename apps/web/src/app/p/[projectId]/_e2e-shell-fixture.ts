import type { ProjectDto } from "@/lib/services/mappers";
import type { ProjectShellProjection } from "@/lib/services/project-shell";

/** Reserved id used only by the database-free Playwright harness. */
export const E2E_PROJECT_ID = "00000000-0000-4000-8000-000000000042";

/** Stable shell-only projection; all screen API data is fulfilled by Playwright. */
export function e2eProjectShell(
  projectId: typeof E2E_PROJECT_ID,
  env: Readonly<Record<string, string | undefined>> = {},
): ProjectDto {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const clientName =
    env["SF_E2E_CLIENT_NAME"]?.trim() || "E2E Client";
  const projectName =
    env["SF_E2E_PROJECT_NAME"]?.trim() || "E2E Critical Flow";
  return {
    id: projectId,
    clientName,
    projectName,
    stage: "planning",
    site: {
      id: "00000000-0000-4000-8000-000000000043",
      origin: "https://example.test",
      host: "example.test",
      marketCodes: ["US"],
      languageCodes: ["en", "zh-CN"],
    },
    contextStatus: "complete",
    currentIcpProfileVersion: 1,
    confirmedIcpProfileVersion: 1,
    defaultDeliveryLocale: "en",
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

/**
 * Stable cockpit-only fixture for database-free Playwright. These values are
 * explicit harness data, not product authority: the production layout always
 * calls the scoped repository-backed `getProjectShell` projection.
 */
export function e2eProjectShellProjection(
  projectId: typeof E2E_PROJECT_ID,
  env: Readonly<Record<string, string | undefined>> = {},
): ProjectShellProjection {
  const project = e2eProjectShell(projectId, env);
  return {
    currentProject: {
      id: project.id,
      clientName: project.clientName,
      projectName: project.projectName,
      host: project.site.host,
      stage: "planning",
      createdAt: project.createdAt,
    },
    projectOptions: [
      {
        id: project.id,
        clientName: project.clientName,
        projectName: project.projectName,
        host: project.site.host,
        label: `${project.clientName} — ${project.projectName}`,
        selected: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000044",
        clientName: "E2E Alt Client",
        projectName: "E2E Alternate Program",
        host: "alternate.example.test",
        label: "E2E Alt Client — E2E Alternate Program",
        selected: false,
      },
    ],
    navigationBadges: { diagnosis: 1, studio: 1 },
    program: { day: 30, totalDays: 90, progressPercent: 33 },
  };
}
