import { getTranslations } from "next-intl/server";
import {
  AppShell,
  LockedProjectNavigation,
  NewProductControl,
} from "@/components/app-shell";
import { NewProjectForm } from "./_form.tsx";
import styles from "./new-project.module.css";

/**
 * URL-first product entry (spec §6.1). This is the zero-project state of the
 * same four-module GenGrowth workbench, not a second onboarding visual system.
 * The form remains the only client island and still creates canonical data.
 */
export default async function NewProjectPage() {
  const t = await getTranslations("newProject");
  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");

  return (
    <AppShell
      state="empty-project"
      projectControl={
        <NewProductControl
          title={t("shell.productTitle")}
          detail={t("shell.productDetail")}
        />
      }
      navigation={
        <LockedProjectNavigation
          ariaLabel={tShell("projectSections")}
          lockedLabel={t("shell.modulesLocked")}
          labels={{
            overview: tNav("overview"),
            growthMap: tNav("growthMap"),
            execution: tNav("execution"),
            results: tNav("results"),
          }}
        />
      }
      breadcrumbRoot={t("shell.workspace")}
      breadcrumbCurrent={t("title")}
      statusLabel={t("shell.status")}
    >
      <div className={styles.page}>
        <header className={styles.header}>
          <p className="sf-eyebrow">{t("eyebrow")}</p>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </header>

        <NewProjectForm />
      </div>
    </AppShell>
  );
}
