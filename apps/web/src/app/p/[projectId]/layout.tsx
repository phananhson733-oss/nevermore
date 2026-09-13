import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { WorkbenchShell } from "@/components/workbench/shell/WorkbenchShell";
import { getOperatorContext } from "@/lib/auth/session";
import {
  getProjectShell,
  type ProjectShellProjection,
} from "@/lib/services/project-shell";
import { ProjectSwitcher } from "./_project-switcher.tsx";

/**
 * Project shell (design §4.1). Server component: resolves the operator + project
 * (404, never 403, for a foreign or absent project so existence never leaks),
 * then frames every project page — new workbench pages and the retained legacy
 * pages alike — with the workbench chrome.
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

  return (
    <WorkbenchShell
      shell={shell}
      projectControl={
        <ProjectSwitcher
          projectId={shell.currentProject.id}
          options={shell.projectOptions}
        />
      }
    >
      {children}
    </WorkbenchShell>
  );
}
