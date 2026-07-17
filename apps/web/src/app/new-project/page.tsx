import { getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/ui";
import { NewProjectForm } from "./_form.tsx";
import styles from "./new-project.module.css";

/**
 * Create-project screen (spec §6.1). Lives OUTSIDE the project app shell (no
 * sidebar): an operator with no projects lands here, and the sidebar's
 * "New project" link routes here too. The form itself is the client island.
 */
export default async function NewProjectPage() {
  const t = await getTranslations("newProject");
  const tShell = await getTranslations("appShell");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className="sf-eyebrow">SignalFrame</p>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
        <LocaleSwitch aria-label={tShell("localeSwitch")} />
      </header>

      <NewProjectForm />
    </main>
  );
}
