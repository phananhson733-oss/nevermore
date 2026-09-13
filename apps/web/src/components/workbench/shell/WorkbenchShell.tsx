import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/lib/auth/actions";
import { LocaleSwitch } from "@/components/ui";
import type { ProjectShellProjection } from "@/lib/services/project-shell";
import { WorkbenchProvider } from "@/lib/workbench/store/WorkbenchProvider";
import { ShellChrome } from "./ShellChrome.tsx";
import { SignOutButton } from "./SignOutButton.tsx";

/**
 * Server assembly of the workbench shell (design §4.1). Owns everything that
 * needs the server: translations for the skip link, the sign-out server action,
 * and the real project mirror handed to the per-project store.
 */
export async function WorkbenchShell({
  shell,
  projectControl,
  children,
}: {
  readonly shell: ProjectShellProjection;
  readonly projectControl: ReactNode;
  readonly children: ReactNode;
}) {
  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");
  const project = shell.currentProject;
  const accountControl = (
    <div className="flex items-center gap-2">
      <LocaleSwitch aria-label={tShell("localeSwitch")} />
      <SignOutButton action={signOutAction} label={tNav("logout")} />
    </div>
  );
  return (
    <WorkbenchProvider
      key={project.id}
      projectId={project.id}
      seed={{
        url: project.host,
        brand: project.clientName,
        market: project.marketCode ?? "",
      }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {tShell("skipToContent")}
      </a>
      <ShellChrome
        projectId={project.id}
        site={{
          host: project.host,
          marketCode: project.marketCode,
          gscConnected: null,
        }}
        projectOptions={shell.projectOptions}
        projectControl={projectControl}
        accountControl={accountControl}
      >
        {children}
      </ShellChrome>
    </WorkbenchProvider>
  );
}
