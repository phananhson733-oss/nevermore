"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import {
  useWorkbench,
  useWorkbenchArtifacts,
} from "@/lib/workbench/store/hooks";
import { DemoChip } from "../ui/DemoChip.tsx";
import { useContextNavigationConfirm } from "./useContextNavigationConfirm.ts";

/** The workbench topbar (opengengrowth `Header.tsx`). */
export function Topbar({
  projectControl,
  accountControl,
  onMenu,
  onPalette,
  onDrawer,
  paletteButtonRef,
  drawerButtonRef,
  sidebarId,
  sidebarOpen,
}: {
  readonly projectControl: ReactNode;
  readonly accountControl: ReactNode;
  readonly onMenu: () => void;
  readonly onPalette: () => void;
  readonly onDrawer: () => void;
  readonly paletteButtonRef: RefObject<HTMLButtonElement | null>;
  readonly drawerButtonRef: RefObject<HTMLButtonElement | null>;
  readonly sidebarId: string;
  readonly sidebarOpen: boolean;
}) {
  const t = useTranslations("workbench.shell");
  const { state, storageMode, ready } = useWorkbench();
  const artifacts = useWorkbenchArtifacts();
  // Called here rather than threaded down from ShellChrome: the topbar owns the
  // only link it guards, and the hook is already used the same way one level
  // over in CommandPalette — both sit in the same client tree.
  const { confirmNavigation } = useContextNavigationConfirm();
  return (
    <header
      data-app-shell-topbar=""
      className="wb-reset sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-wb-paper px-4 font-sans text-slate-900"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label={sidebarOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          className="mr-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        {projectControl}
        <Link
          href="/new-project"
          // Leaving for a new site discards a dirty Context editor exactly like
          // a rail link or a palette jump does, so it asks the same question.
          // `current` is false: this destination is never the current page.
          onClick={(event) => confirmNavigation(event, false)}
          className="hidden text-xs font-medium text-slate-500 hover:text-slate-900 sm:inline"
        >
          + {t("newSite")}
        </Link>
        <button
          ref={paletteButtonRef}
          type="button"
          onClick={onPalette}
          className="ml-2 hidden w-64 items-center gap-2 rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-1.5 text-xs text-slate-500 hover:border-slate-300 md:flex"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1 text-left">{t("search")}</span>
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-500">
            ⌘K
          </kbd>
        </button>
      </div>
      <div className="flex items-center gap-3">
        {/* Exactly one status element, rendered on every viewport and before it
            has anything to say: a live region has to exist in the accessibility
            tree BEFORE its text changes, or the announcement is lost (and a
            second one would break the shell e2e's single-status locator).
            Below `lg` the topbar has no room for the sentence, so it is
            `sr-only` there — still announced, just not painted; `sr-only`
            takes it out of the flex flow, so it adds no gap and `empty:-mr-3`
            only has to cancel one from `lg` up. `swept` is deliberately
            silent: that state was discarded on purpose. */}
        <span
          role="status"
          className="max-lg:sr-only text-xs text-amber-700 empty:-mr-3 lg:max-w-[40vw] lg:truncate"
        >
          {ready && storageMode !== "ok" && storageMode !== "swept"
            ? storageMode === "quota"
              ? t("quota")
              : t("volatile")
            : null}
        </span>
        <DemoChip demo={ready && state.demo} />
        <button
          ref={drawerButtonRef}
          type="button"
          onClick={onDrawer}
          data-wb-drawer-button=""
          // The count is 0 until the store has read storage; `aria-busy` says
          // the value is provisional instead of asserting an empty basket.
          aria-busy={!ready}
          // `.wb-reset :focus-visible` draws the ring in `currentColor`, which
          // is white on this inverted button and invisible on the cream topbar.
          className="h-[26px] rounded bg-wb-ink px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-black focus-visible:outline-slate-900"
        >
          {t("artifacts", { count: ready ? artifacts.length : 0 })}
        </button>
        {accountControl}
      </div>
    </header>
  );
}
