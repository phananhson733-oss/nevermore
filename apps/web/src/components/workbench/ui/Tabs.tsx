"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "./cn.ts";
import { isComposingKey } from "./keyboard.ts";

/**
 * The segmented control above an output panel, built as a real tablist: one
 * `role="tablist"`, `role="tab"` + `aria-selected` per item, a roving tabindex
 * so the group is one Tab stop, and Left/Right to move between tabs (arrow keys
 * are how a screen-reader user changes tabs; without them the group is an
 * unreachable set of buttons for them).
 *
 * Activation follows focus (the panels are already rendered, so there is no cost
 * to switching), which is why the arrow handler calls `onChange` and then moves
 * focus to the tab that will be selected.
 *
 * Each tab also carries an `id` and points at its panel with `aria-controls`;
 * WAI-ARIA APG requires that wiring and axe does not flag its absence, so the
 * only thing that catches a missing or mismatched pointer is the round-trip
 * assertion in Tabs.test.tsx. The panel is rendered by the caller, which builds
 * the two ids with the exported helpers rather than re-spelling the shape — two
 * hand-written halves are exactly how this pointer goes stale. Home/End are not
 * implemented (APG lists them as optional).
 *
 * Mid-composition arrows belong to the IME's candidate list, not to us — same
 * guard, same reason, as Dialog.tsx and useGlobalShortcut.
 *
 * Labels arrive as props; the selected tab is inverted, so it names its own
 * focus ring (`.wb-reset :focus-visible` uses `currentColor`, i.e. white here).
 */

export type TabItem = readonly [id: string, label: string];

/** The `id` of the tab button for `id` — also the panel's `aria-labelledby`. */
export function tabButtonId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

/** The `id` of the panel for `id` — also the tab's `aria-controls`. */
export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

const TAB_BASE =
  "inline-flex min-h-[32px] items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";
const TAB_ON = "border-wb-ink bg-wb-ink text-white shadow-sm focus-visible:outline-slate-900";
const TAB_OFF = "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";

export function Tabs({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
}: {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly idPrefix: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  function move(delta: number): void {
    const from = tabs.findIndex(([id]) => id === value);
    if (from < 0) return;
    const to = (from + delta + tabs.length) % tabs.length;
    const next = tabs[to];
    if (next === undefined) return;
    onChange(next[0]);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    move(event.key === "ArrowRight" ? 1 : -1);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex flex-wrap items-center gap-1"
    >
      {tabs.map(([id, text]) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabButtonId(idPrefix, id)}
            aria-controls={tabPanelId(idPrefix, id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(TAB_BASE, selected ? TAB_ON : TAB_OFF)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
