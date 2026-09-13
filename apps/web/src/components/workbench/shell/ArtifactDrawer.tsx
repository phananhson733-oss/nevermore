"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ARTIFACT_MIME, downloadName } from "@/lib/workbench/artifact-file";
import { downloadText } from "@/lib/workbench/download";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { Dialog } from "../ui/Dialog.tsx";

/** How long the "Copied" label stays up (jsx `flash()`). */
const COPY_FLASH_MS = 1300;

/**
 * The artifact basket (jsx L2485–2526). Producers write the "sample data"
 * provenance line into `content` (§6.8); the drawer only presents it.
 */
export function ArtifactDrawer({
  open,
  onClose,
  returnFocusTo,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("workbench.shell.drawer");
  const { state, dispatch } = useWorkbench();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same "adjusting state when a prop changes" pattern as the palette: a stale
  // "Copied" label must not greet the next open of the drawer.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCopied(null);
  }

  function clearFlash(): void {
    if (flashTimer.current === null) return;
    clearTimeout(flashTimer.current);
    flashTimer.current = null;
  }

  // Drop a pending flash whenever the drawer closes (or unmounts): a timer that
  // fires into a closed drawer is a setState on a component nobody is reading.
  useEffect(() => clearFlash, [open]);

  async function copy(id: string, content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(id);
      clearFlash();
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        setCopied(null);
      }, COPY_FLASH_MS);
    } catch {
      window.prompt(t("copy"), content);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="wb-drawer-title"
      initialFocus={closeRef}
      returnFocusTo={returnFocusTo}
      className="right-0 top-0 flex h-full w-[min(480px,100vw)] flex-col border-l border-slate-200"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 id="wb-drawer-title" className="text-sm font-semibold">
          {t("title")} · {state.artifacts.length}
        </h2>
        <div className="flex items-center gap-2">
          {state.artifacts.length > 0 ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "clearArtifacts" })}
              // `-my-1 py-1` raises the 16px line box of `text-xs` to the 24px
              // WCAG 2.5.8 minimum without moving anything: the margin box is
              // the size it was. Vertical only — every label here is already
              // wider than 24px, and `-mx-1` would leave the hit areas of
              // neighbouring buttons 4px apart instead of the visible 12.
              className="-my-1 py-1 text-xs text-slate-600 hover:text-slate-900"
            >
              {t("clear")}
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            // p-1.5, not p-1: a 16px icon plus p-1 lands exactly on the 24px
            // minimum, with nothing left for a rounding difference.
            className="rounded p-1.5 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {state.artifacts.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium text-slate-600">{t("empty")}</p>
            <p className="mt-1 text-sm text-slate-500">{t("emptyDetail")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {state.artifacts.map((a) => (
              <li key={a.id} className="px-4 py-3" data-wb-artifact={a.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {a.at}
                  </span>
                </div>
                {/* Same `-my-1 py-1` as the header's "clear": 24px tall hit
                    areas, unchanged layout, and the visible 12px gap between
                    them left alone. */}
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => void copy(a.id, a.content)}
                    className="-my-1 py-1 text-slate-600 hover:text-slate-900"
                  >
                    {copied === a.id ? t("copied") : t("copy")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        downloadName(a),
                        a.content,
                        ARTIFACT_MIME[a.type],
                      )
                    }
                    className="-my-1 py-1 text-slate-600 hover:text-slate-900"
                  >
                    {t("download")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: "removeArtifact", id: a.id })
                    }
                    className="-my-1 py-1 text-rose-600 hover:text-rose-800"
                  >
                    {t("remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
