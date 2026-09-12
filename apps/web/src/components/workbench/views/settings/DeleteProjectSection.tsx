"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useDeleteProject } from "@/lib/api";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { cn } from "../../ui/cn.ts";

const BUTTON_BASE = "rounded-lg border px-4 py-1.5 text-[13px] font-medium transition-colors";

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const prevConfirming = useRef(confirming);

  /**
   * The trigger unmounts when the confirmation opens and the whole group
   * unmounts when it closes, so keyboard focus would otherwise fall to
   * <body>. Act only on an actual change: a first mount must not steal focus
   * from wherever the operator already is on the page.
   */
  useEffect(() => {
    if (prevConfirming.current === confirming) return;
    prevConfirming.current = confirming;
    if (confirming) confirmRef.current?.focus();
    else triggerRef.current?.focus();
  }, [confirming]);

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

  /**
   * `router.replace` is a transition: this tree stays interactive until the new
   * route commits. Without holding the buttons disabled after success a second
   * click fires a second DELETE for a project that is already gone: the handler
   * archives idempotently (204 again), so the success path would run twice; a
   * transport failure on that retry would show the delete-failure copy. (That
   * copy is outcome-neutral on purpose: a rejected mutation does not prove the
   * server did not delete, since the response can be lost after the commit.)
   */
  const busy = deleteProject.isPending || deleteProject.isSuccess;
  return (
    <section
      aria-labelledby="delete-product-title"
      className="rounded-xl border border-rose-200 bg-white p-6 shadow-sm"
      data-wb-real-action=""
    >
      <div className="mb-3 flex items-center gap-2">
        <Trash2 size={18} aria-hidden="true" className="text-rose-600" />
        <span
          title={tWb("realActionTitle")}
          className="rounded border border-rose-200 bg-rose-50 px-2 text-[11px] font-medium text-rose-700"
        >
          {tWb("realAction")}
        </span>
        <span className="text-[11px] font-medium uppercase text-slate-600">
          {t("dangerZone")}
        </span>
      </div>
      <h2 id="delete-product-title" className="text-[15px] font-semibold">
        {t("delete.title")}
      </h2>
      {/* Body copy is never below 14px (`text-sm`); only labels and badges are. */}
      <p className="mt-1 text-sm text-slate-600">{t("delete.description")}</p>
      <p className="mt-1 text-sm text-slate-600">{t("delete.retention")}</p>
      {deleteProject.isError ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
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
            <p className="text-sm text-slate-600">{t("delete.confirmDescription")}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                deleteProject.reset();
                setConfirming(false);
              }}
              className={cn(
                BUTTON_BASE,
                "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {t("delete.cancel")}
            </button>
            <button
              ref={confirmRef}
              type="button"
              disabled={busy}
              onClick={() => void confirmDelete()}
              className={cn(
                BUTTON_BASE,
                // The base focus ring is `currentColor` (white here), invisible on the
                // rose-50 group behind the button; focus lands here programmatically.
                "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-slate-900",
              )}
            >
              {busy ? t("delete.deleting") : t("delete.confirmAction")}
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            deleteProject.reset();
            setConfirming(true);
          }}
          className={cn(BUTTON_BASE, "mt-4 border-rose-200 bg-white text-rose-700 hover:bg-rose-50")}
        >
          {t("delete.action")}
        </button>
      )}
    </section>
  );
}
