import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell, SidebarProgress } from "@/components/app-shell";
import { getOperatorContext } from "@/lib/auth/session";
import {
  getProjectShell,
  type ProjectShellProjection,
} from "@/lib/services/project-shell";
import { CurrentPageLabel, ProjectNav } from "./_nav.tsx";
import { ProjectSwitcher } from "./_project-switcher.tsx";

/**
 * Project app shell (spec §4). Server component: resolves the operator + project
 * (404, never 403, for a foreign or absent project so existence never leaks),
 * then frames every project page with a server-backed program cockpit: an
 * accessible project switcher, canonical activity badges, a 90-day position,
 * live section routes, and product/account chrome. The switcher and nav remain
 * the only route-aware client pieces.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let shell: ProjectShellProjection | null = null;
  if (process.env.NODE_ENV === "development") {
    const { loadE2eProjectShell } = await import("./_e2e-shell.ts");
    shell = await loadE2eProjectShell(process.env, projectId);
  }

  if (!shell) {
    const operator = await getOperatorContext();
    if (!operator) notFound();
    shell = await getProjectShell(
      { workspaceId: operator.workspaceId },
      projectId,
    );
  }
  if (!shell) notFound();

  const { currentProject: project } = shell;

  const tShell = await getTranslations("appShell");
  const tStage = await getTranslations("projectStage");

  return (
    <AppShell
      state="project"
      projectControl={
        <ProjectSwitcher
          projectId={project.id}
          options={shell.projectOptions}
        />
      }
      navigation={
        <ProjectNav
          projectId={project.id}
          navigationBadges={shell.navigationBadges}
        />
      }
      sidebarPanel={
        <SidebarProgress
          title={tShell("programTitle")}
          stage={tStage(project.stage)}
          summary={tShell("programDay", {
            day: shell.program.day,
            total: shell.program.totalDays,
          })}
          progressLabel={tShell("programProgress")}
          value={shell.program.day}
          max={shell.program.totalDays}
        />
      }
      settingsHref={`/p/${project.id}/settings`}
      breadcrumbRoot={project.clientName}
      breadcrumbCurrent={<CurrentPageLabel projectId={project.id} />}
      statusLabel={tStage(project.stage)}
    >
      {children}
    </AppShell>
  );
}
