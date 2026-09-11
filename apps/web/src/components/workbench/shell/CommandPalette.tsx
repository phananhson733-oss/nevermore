"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { workbenchHref } from "@/lib/workbench/routes";
import { cn } from "../ui/cn.ts";
import { Dialog } from "../ui/Dialog.tsx";
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
  const router = useRouter();
  const { confirmLeave } = useContextNavigationConfirm();
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

  function go(entry: PaletteEntry | undefined): void {
    if (!entry) return;
    // The rail links ask before leaving a dirty Context editor; a palette jump
    // is the same navigation. Declining keeps the palette open so the operator
    // can pick a different destination or dismiss it.
    if (!confirmLeave()) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(activeEntry);
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
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="wb-palette-list"
        aria-activedescendant={
          activeEntry ? `wb-palette-${activeEntry.key}` : undefined
        }
        className="w-full border-b border-slate-200 px-4 py-3 text-sm outline-none"
      />
      <div
        id="wb-palette-list"
        role="listbox"
        aria-label={t("shell.palette.title")}
        className="max-h-80 overflow-y-auto py-1"
      >
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            id={`wb-palette-${entry.key}`}
            type="button"
            role="option"
            // Options are reached with the arrow keys from the input, which
            // keeps the `aria-activedescendant` contract; they must therefore
            // stay out of the Tab order (and out of the dialog's focus trap).
            tabIndex={-1}
            aria-selected={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => go(entry)}
            className={cn(
              "flex w-full items-center justify-between px-4 py-2 text-left text-sm",
              index === activeIndex ? "bg-slate-100" : "hover:bg-slate-50",
            )}
          >
            <span>{entry.label}</span>
            <span className="text-[11px] text-slate-500">
              {t(`shell.palette.${entry.group}`)}
            </span>
          </button>
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
