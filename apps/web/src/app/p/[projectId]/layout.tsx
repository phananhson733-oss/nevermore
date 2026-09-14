import type { ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { WorkbenchShell } from "@/components/workbench/shell/WorkbenchShell";
import { WB_ROOT_ID } from "@/components/workbench/ui/ids";
import { getOperatorContext } from "@/lib/auth/session";
import {
  getProjectShell,
  type ProjectShellProjection,
} from "@/lib/services/project-shell";
import { ProjectSwitcher } from "./_project-switcher.tsx";
// Mounted here, not in the root layout: everything below this segment renders
// workbench chrome, and nothing above it does. /login and /new-project therefore
// load neither the stylesheet (which carries the whole Tailwind utility set) nor
// the face. Because the face's variable no longer sits on <html>, workbench.css
// has to bind it with `@theme inline` — app/workbench-css.test.ts pins both ends.
import "../../workbench.css";

// Workbench body face (design source: opengengrowth). Self-hosted at build time
// like the two in the root layout, so `font-src 'self'` holds; Chinese glyphs
// fall back to the system stack declared in workbench.css.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: "variable", // Plus Jakarta Sans is a variable face (wght 200-800): one file instead of five
  variable: "--font-wb",
  display: "swap",
});

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
    // `--font-wb` is defined by this class and inherits from here down, so the
    // element has to sit above everything the shell renders: `ShellChrome` puts
    // the command palette and the artifact drawer *beside* `#wb-app`, not inside
    // it. It is also the portal target confirm dialogs ask for by id — a portal
    // into `document.body` would land outside this class and fall back to the
    // system face without any error (裁决 Q32 needs "outside `#wb-app`", which
    // this element satisfies: `Dialog` marks `#wb-app` inert, never this one).
    <div id={WB_ROOT_ID} className={plusJakarta.variable}>
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
    </div>
  );
}
