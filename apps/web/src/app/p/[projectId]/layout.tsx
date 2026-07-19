import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button, LocaleSwitch } from "@/components/ui";
import { signOutAction } from "@/lib/auth/actions";
import { getOperatorContext } from "@/lib/auth/session";
import { getProject } from "@/lib/services/projects";
import { CurrentPageLabel, ProjectNav } from "./_nav.tsx";
import {
  E2E_PROJECT_ID,
  e2eProjectShell,
  shouldUseE2eProjectShell,
} from "./_e2e-shell.ts";
import styles from "./layout.module.css";

/**
 * Project app shell (spec §4). Server component: resolves the operator + project
 * (404, never 403, for a foreign or absent project so existence never leaks),
 * then frames every project page with a dark sidebar (brand, project header,
 * section nav) and a sticky frosted topbar (breadcrumb, locale switch, logout).
 * The nav's active-state + breadcrumb are the only client pieces.
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
  let project: Awaited<ReturnType<typeof getProject>> | null;
  if (mockShell) {
    project = e2eProjectShell(E2E_PROJECT_ID);
  } else {
    const operator = await getOperatorContext();
    if (!operator) notFound();
    project = await getProject(
      { workspaceId: operator.workspaceId },
      projectId,
    ).catch(() => null);
  }
  if (!project) notFound();

  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        {tShell("skipToContent")}
      </a>

      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <span className={styles.brandWord}>SignalFrame</span>
        </div>

        <div className={styles.projectHeader}>
          <span className={styles.projectClient}>{project.clientName}</span>
          <span className={styles.projectHost}>{project.site.host}</span>
          <Link href="/new-project" className={styles.newProjectLink}>
            {tNav("newProject")}
          </Link>
        </div>

        <ProjectNav projectId={project.id} />
      </aside>

      <div className={styles.body}>
        <header className={styles.topbar}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <span className={styles.crumbRoot}>{project.clientName}</span>
            <span className={styles.crumbSep} aria-hidden="true">
              /
            </span>
            <CurrentPageLabel projectId={project.id} className={styles.crumbCurrent} />
          </nav>

          <div className={styles.topbarActions}>
            <LocaleSwitch aria-label={tShell("localeSwitch")} />
            <form action={signOutAction}>
              <Button variant="ghost" type="submit">
                {tNav("logout")}
              </Button>
            </form>
          </div>
        </header>

        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
