"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { useDeleteProject } from "@/lib/api";
import styles from "./settings.module.css";

export function ProjectSettings({
  projectId,
}: {
  readonly projectId: string;
}) {
  const t = useTranslations("projectSettings");
  const router = useRouter();
  const deleteProject = useDeleteProject(projectId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function confirmDelete(): Promise<void> {
    try {
      await deleteProject.mutateAsync();
      router.replace("/new-project");
      router.refresh();
    } catch {
      // The mutation retains its typed error; the UI exposes only approved,
      // localized copy rather than raw server detail.
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className="sf-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </header>

      <section className={styles.dangerCard} aria-labelledby="delete-product-title">
        <div className={styles.dangerIcon} aria-hidden="true">
          <Trash2 size={21} strokeWidth={1.8} />
        </div>
        <div className={styles.dangerBody}>
          <p className={styles.sectionLabel}>{t("dangerZone")}</p>
          <h2 id="delete-product-title">{t("delete.title")}</h2>
          <p>{t("delete.description")}</p>
          <p className={styles.retentionNote}>{t("delete.retention")}</p>

          {deleteProject.isError ? (
            <p className={styles.error} role="alert">
              {t("delete.error")}
            </p>
          ) : null}

          {confirmingDelete ? (
            <div
              className={styles.confirmation}
              role="group"
              aria-label={t("delete.confirmTitle")}
            >
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>{t("delete.confirmTitle")}</strong>
                <p>{t("delete.confirmDescription")}</p>
              </div>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  disabled={deleteProject.isPending}
                  onClick={() => {
                    deleteProject.reset();
                    setConfirmingDelete(false);
                  }}
                >
                  {t("delete.cancel")}
                </Button>
                <Button
                  className={styles.deleteButton}
                  disabled={deleteProject.isPending}
                  onClick={() => void confirmDelete()}
                >
                  {deleteProject.isPending
                    ? t("delete.deleting")
                    : t("delete.confirmAction")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              className={styles.deleteTrigger}
              onClick={() => {
                deleteProject.reset();
                setConfirmingDelete(true);
              }}
            >
              {t("delete.action")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
