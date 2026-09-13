"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import {
  useWorkbench,
  useWorkbenchArtifacts,
} from "@/lib/workbench/store/hooks";
import type { StorageMode } from "@/lib/workbench/store/WorkbenchProvider";
import { DemoChip } from "../ui/DemoChip.tsx";
import { useContextNavigationConfirm } from "./useContextNavigationConfirm.ts";

/**
 * What the topbar's single live region says in each storage mode. A `Record`
 * makes a new mode a type error here rather than a silent fallthrough to some
 * other sentence. `swept` says nothing: that state was discarded on purpose.
 */
const STORAGE_NOTICE: Readonly<
  Record<StorageMode, "volatile" | "quota" | "readonly" | null>
> = {
  ok: null,
  volatile: "volatile",
  quota: "quota",
  readonly: "readonly",
  swept: null,
};

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
  const storageNotice = ready ? STORAGE_NOTICE[storageMode] : null;
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
          // `md:hidden`, so this control only ever exists on a touch viewport:
          // 44px (the iOS/Material figure), not the 24px WCAG 2.5.8 floor.
          // A flex box rather than padding around the icon, so the size is the
          // button's own and does not move when the icon does.
          // `shrink-0` is load bearing here and was not needed before: the
          // topbar row is tight at 390px, and the old `p-1.5` held 32px only
          // because padding does not shrink. With the size on the button and an
          // svg the reset gives `max-width: 100%`, min-content is zero, and
          // flex squeezed the only way into the navigation to 0x44 (measured).
          className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 md:hidden"
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
          // A bare `text-xs` link is a 16px line box, which is under the 24px
          // WCAG 2.5.8 minimum: `-my-1 py-1` gets there without changing the
          // margin box, so nothing in the topbar moves. Vertical only — the
          // label is already wider than 24px.
          className="-my-1 hidden py-1 text-xs font-medium text-slate-500 hover:text-slate-900 sm:inline"
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
            `sr-only` there — still announced, just not painted (the compact
            label below is what sighted users see); `sr-only` takes it out of
            the flex flow, so it adds no gap and `empty:-mr-3` only has to
            cancel one from `lg` up. `swept` is deliberately silent: that state
            was discarded on purpose. `readonly` is not: nothing this session
            does will be saved (R14). */}
        <span
          role="status"
          className="max-lg:sr-only text-xs text-amber-700 empty:-mr-3 lg:max-w-[40vw] lg:truncate"
        >
          {storageNotice ? t(storageNotice) : null}
        </span>
        {/* The visible counterpart below `lg`, for every mode with a notice.
            `aria-hidden`: the live region above already announces the full
            sentence, so this is not read twice and is never a second status.
            Absent (not merely hidden) when there is nothing to say, so it adds
            no flex gap; `lg:hidden` is display:none, which adds none either. */}
        {storageNotice ? (
          <span
            aria-hidden="true"
            data-wb-storage-compact=""
            title={t(storageNotice)}
            className="shrink-0 whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 lg:hidden"
          >
            {t("notSavingShort")}
          </span>
        ) : null}
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
          // 44px below `md`, where this is a touch target, and the prototype's
          // 26px pill from `md` up, where it is not: the rail is permanent
          // there and the topbar keeps the density the design asks for.
          className="h-11 rounded bg-wb-ink px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-black focus-visible:outline-slate-900 md:h-[26px]"
        >
          {t("artifacts", { count: ready ? artifacts.length : 0 })}
        </button>
        {accountControl}
      </div>
    </header>
  );
}
