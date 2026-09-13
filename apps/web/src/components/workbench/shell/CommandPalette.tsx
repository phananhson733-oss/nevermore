"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { workbenchHref } from "@/lib/workbench/routes";
import { cn } from "../ui/cn.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { isComposingKey } from "../ui/keyboard.ts";
import { useContextNavigationConfirm } from "./useContextNavigationConfirm.ts";
import { WORKBENCH_NAV } from "./workbench-nav.ts";

interface PaletteEntry {
  readonly key: string;
  readonly group: "sections" | "projects" | "newProject";
  readonly label: string;
  readonly href: string;
}

/** ⌘K jump list (jsx L3040–3085): sections, then projects, then "new site". */
export function CommandPalette({
  open,
  onClose,
  returnFocusTo,
  projectId,
  projectOptions,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusTo: RefObject<HTMLElement | null>;
  readonly projectId: string;
  readonly projectOptions: readonly ProjectShellOption[];
}) {
  const t = useTranslations("workbench");
  const { confirmNavigation } = useContextNavigationConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // "Adjusting state when a prop changes" (React docs): the jsx prototype
  // mounted the palette conditionally, so it always opened on an empty query.
  // Done during render rather than in an effect so the first painted frame
  // already shows the full list instead of the previous search.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  const entries = useMemo<readonly PaletteEntry[]>(() => {
    const sections = WORKBENCH_NAV.flatMap((g) => g.items).map((item) => ({
      key: `s:${item.id}`,
      group: "sections" as const,
      label: t(`nav.items.${item.id}`),
      href: workbenchHref(projectId, item.id),
    }));
    const projects = projectOptions.map((p) => ({
      key: `p:${p.id}`,
      group: "projects" as const,
      label: p.label,
      href: workbenchHref(p.id, "overview"),
    }));
    const all = [
      ...sections,
      ...projects,
      {
        key: "new",
        group: "newProject" as const,
        label: t("shell.palette.newProject"),
        href: "/new-project",
      },
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((e) => e.label.toLowerCase().includes(q)) : all;
  }, [query, projectId, projectOptions, t]);

  const activeEntry = entries[activeIndex];
  const activeKey = activeEntry?.key;

  // The listbox scrolls (`max-h-80` over ~18 entries) but the arrow keys only
  // move `aria-activedescendant`: focus never leaves the input, so the browser
  // scrolls nothing and the highlight walks off the bottom unseen.
  useEffect(() => {
    if (!activeKey) return;
    const option = document.getElementById(`wb-palette-${activeKey}`);
    // jsdom implements no scroll API; guard rather than stub it everywhere.
    if (typeof option?.scrollIntoView !== "function") return;
    option.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  /**
   * Every option is a real anchor and every jump is a real click on it, so the
   * guards that watch the document for link clicks see a palette jump exactly
   * as they see a rail link: the Studio editor guard
   * (`app/p/[projectId]/_unsaved-navigation-guard.ts`) fences `a[href]` from a
   * capture-phase click listener and cancels the event when the operator
   * declines; a `router.push` from a button would have walked straight past
   * it. The Context guard runs here, in the anchor's own handler, and cancels
   * the same way. A cancelled click never reaches `Link`'s navigation, and the
   * palette stays open so the operator can pick another destination.
   */
  function onOptionClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.defaultPrevented) return;
    confirmNavigation(event, false);
    if (event.defaultPrevented) return;
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // Mid-composition keys belong to the IME (see `isComposingKey`); no
    // `preventDefault`, or Enter could no longer commit the candidate.
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (event.key === "Enter" && activeEntry) {
      event.preventDefault();
      // A synthetic click on the anchor, not a router push: see `onOptionClick`.
      document.getElementById(`wb-palette-${activeEntry.key}`)?.click();
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="wb-palette-title"
      initialFocus={inputRef}
      returnFocusTo={returnFocusTo}
      className="left-1/2 top-24 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200"
    >
      <h2 id="wb-palette-title" className="sr-only">
        {t("shell.palette.title")}
      </h2>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("shell.palette.placeholder")}
        aria-label={t("shell.palette.title")}
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="wb-palette-list"
        aria-activedescendant={
          activeEntry ? `wb-palette-${activeEntry.key}` : undefined
        }
        // Inset ring: the panel is `overflow-hidden`, so an offset outline
        // would be clipped on three sides.
        className="w-full border-b border-slate-200 px-4 py-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
      />
      <div
        id="wb-palette-list"
        role="listbox"
        aria-label={t("shell.palette.title")}
        className="max-h-80 overflow-y-auto py-1"
      >
        {entries.map((entry, index) => (
          <Link
            key={entry.key}
            id={`wb-palette-${entry.key}`}
            href={entry.href}
            role="option"
            // Options are reached with the arrow keys from the input, which
            // keeps the `aria-activedescendant` contract; they must therefore
            // stay out of the Tab order (and out of the dialog's focus trap).
            tabIndex={-1}
            aria-selected={index === activeIndex}
            // Pointer MOVE, not enter: ArrowDown scrolls the listbox and the
            // browser then synthesises enter/leave for whatever slides under a
            // stationary pointer, which would hijack the keyboard selection.
            onPointerMove={() => setActiveIndex(index)}
            onClick={onOptionClick}
            className={cn(
              "flex w-full items-center justify-between px-4 py-2 text-left text-sm",
              index === activeIndex ? "bg-slate-100" : "hover:bg-slate-50",
            )}
          >
            <span>{entry.label}</span>
            <span className="text-[11px] text-slate-600">
              {t(`shell.palette.${entry.group}`)}
            </span>
          </Link>
        ))}
      </div>
      {/* Outside the listbox: a paragraph is not an option, and a listbox with
          one non-option child is malformed for AT. */}
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          {t("shell.palette.empty")}
        </p>
      ) : null}
      {/* Filtering changes the list silently otherwise. Reusing the palette's own
          title names what the number counts — a bare "3" is meaningless out of
          context — without adding a catalog key. */}
      <span role="status" className="sr-only">
        {t("shell.palette.title")}: {entries.length}
      </span>
    </Dialog>
  );
}
