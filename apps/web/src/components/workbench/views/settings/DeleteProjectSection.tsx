"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDeleteProject } from "@/lib/api";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { cn } from "../../ui/cn.ts";

/**
 * The one real action on the settings page (design §6.6). Moved verbatim in
 * behaviour from the retired `settings/_settings.tsx`: two explicit steps,
 * localized copy only, replace to "/" and refresh on success. Adds: clears the
 * project's workbench localStorage key.
 */
export function DeleteProjectSection({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("projectSettings");
  const tWb = useTranslations("workbench.settings");
  const router = useRouter();
  const { forgetProject } = useWorkbench();
  const deleteProject = useDeleteProject(projectId);
  const [confirming, setConfirming] = useState(false);

  async function confirmDelete(): Promise<void> {
    try {
      await deleteProject.mutateAsync();
      forgetProject();
      router.replace("/");
      router.refresh();
    } catch {
      // The mutation keeps its typed error; only localized copy is shown.
    }
  }

  const button = "rounded-lg border px-4 py-1.5 text-[13px] font-medium transition-colors";
  return (
    <section
      aria-labelledby="delete-product-title"
      className="rounded-xl border border-rose-200 bg-white p-6 shadow-sm"
      data-wb-real-action=""
    >
      <div className="mb-3 flex items-center gap-2">
        <Trash2 size={18} aria-hidden="true" className="text-rose-600" />
        <span className="rounded border border-rose-200 bg-rose-50 px-2 text-[11px] font-medium text-rose-700">
          {tWb("realAction")}
        </span>
        <span className="text-[11px] font-medium uppercase text-slate-400">
          {t("dangerZone")}
        </span>
      </div>
      <h2 id="delete-product-title" className="text-[15px] font-semibold">
        {t("delete.title")}
      </h2>
      <p className="mt-1 text-[13px] text-slate-500">{t("delete.description")}</p>
      <p className="mt-1 text-[12px] text-slate-400">{t("delete.retention")}</p>
      {deleteProject.isError ? (
        <p role="alert" className="mt-3 text-[13px] text-rose-700">
          {t("delete.error")}
        </p>
      ) : null}
      {confirming ? (
        <div
          role="group"
          aria-label={t("delete.confirmTitle")}
          className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4"
        >
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 text-rose-600" />
          <div className="flex-1">
            <strong className="text-[13px]">{t("delete.confirmTitle")}</strong>
            <p className="text-[12px] text-slate-600">{t("delete.confirmDescription")}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={deleteProject.isPending}
              onClick={() => {
                deleteProject.reset();
                setConfirming(false);
              }}
              className={cn(button, "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
            >
              {t("delete.cancel")}
            </button>
            <button
              type="button"
              disabled={deleteProject.isPending}
              onClick={() => void confirmDelete()}
              className={cn(button, "border-rose-600 bg-rose-600 text-white hover:bg-rose-700")}
            >
              {deleteProject.isPending ? t("delete.deleting") : t("delete.confirmAction")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            deleteProject.reset();
            setConfirming(true);
          }}
          className={cn(button, "mt-4 border-rose-200 bg-white text-rose-700 hover:bg-rose-50")}
        >
          {t("delete.action")}
        </button>
      )}
    </section>
  );
}
