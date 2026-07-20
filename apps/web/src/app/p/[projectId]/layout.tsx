import type { ReactNode } from "react";
import {
  CircleHelp,
  LogOut,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/ui";
import { signOutAction } from "@/lib/auth/actions";
import { getOperatorContext } from "@/lib/auth/session";
import {
  getProjectShell,
  type ProjectShellProjection,
} from "@/lib/services/project-shell";
import { CurrentPageLabel, ProjectNav } from "./_nav.tsx";
import { ProjectSwitcher } from "./_project-switcher.tsx";
import {
  E2E_PROJECT_ID,
  e2eProjectShellProjection,
  shouldUseE2eProjectShell,
} from "./_e2e-shell.ts";
import styles from "./layout.module.css";

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

  const mockShell = shouldUseE2eProjectShell(process.env, projectId);
  let shell: ProjectShellProjection | null;
  if (mockShell) {
    shell = e2eProjectShellProjection(E2E_PROJECT_ID);
  } else {
    const operator = await getOperatorContext();
    if (!operator) notFound();
    shell = await getProjectShell({ workspaceId: operator.workspaceId }, projectId);
  }
  if (!shell) notFound();

  const { currentProject: project } = shell;

  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");
  const tStage = await getTranslations("projectStage");

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        {tShell("skipToContent")}
      </a>

      <aside className={styles.sidebar} data-app-shell-sidebar="">
        <div className={styles.brand} aria-label="SignalFrame">
          <span className={styles.brandMark} aria-hidden="true">
            <Sparkles size={17} strokeWidth={2.2} />
          </span>
          <span className={styles.brandWord}>signalframe</span>
        </div>

        <ProjectSwitcher
          projectId={project.id}
          options={shell.projectOptions}
        />
        <Link href="/new-project" className={styles.newProjectLink}>
          {tNav("newProject")}
        </Link>

        <ProjectNav
          projectId={project.id}
          navigationBadges={shell.navigationBadges}
        />

        <section
          className={styles.program}
          aria-labelledby="sf-program-title"
        >
          <div className={styles.programHeader}>
            <span id="sf-program-title" className={styles.programTitle}>
              {tShell("programTitle")}
            </span>
            <span className={styles.programStage}>
              {tStage(project.stage)}
            </span>
          </div>
          <strong className={styles.programDay}>
            {tShell("programDay", {
              day: shell.program.day,
              total: shell.program.totalDays,
            })}
          </strong>
          <progress
            className={styles.programProgress}
            aria-label={tShell("programProgress")}
            aria-valuemin={1}
            aria-valuenow={shell.program.day}
            aria-valuemax={shell.program.totalDays}
            max={shell.program.totalDays}
            value={shell.program.day}
          />
        </section>
      </aside>

      <div className={styles.body}>
        <header className={styles.topbar} data-app-shell-topbar="">
          <nav className={styles.breadcrumb} aria-label={tShell("breadcrumb")}>
            <span className={styles.crumbRoot}>{project.clientName}</span>
            <span className={styles.crumbSep} aria-hidden="true">
              /
            </span>
            <CurrentPageLabel
              projectId={project.id}
              className={styles.crumbCurrent}
            />
          </nav>

          <div className={styles.topbarActions}>
            <div
              className={styles.productTools}
              role="group"
              aria-label={tShell("productTools")}
            >
              <button
                type="button"
                className={styles.iconButton}
                aria-label={tShell("help")}
                title={`${tShell("help")} — ${tShell("comingSoon")}`}
                disabled
              >
                <CircleHelp aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={tShell("settings")}
                title={`${tShell("settings")} — ${tShell("comingSoon")}`}
                disabled
              >
                <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </div>
            <LocaleSwitch aria-label={tShell("localeSwitch")} />
            <div
              className={styles.account}
              role="group"
              aria-label={tShell("account")}
            >
              <UserRound aria-hidden="true" size={17} strokeWidth={1.9} />
              <span className={styles.accountLabel}>{tShell("account")}</span>
              <form action={signOutAction}>
                <button
                  className={styles.logoutButton}
                  type="submit"
                  aria-label={tNav("logout")}
                  title={tNav("logout")}
                >
                  <LogOut aria-hidden="true" size={16} strokeWidth={1.9} />
                  <span className={styles.logoutLabel}>{tNav("logout")}</span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
