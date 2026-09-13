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
 * Each tab carries an `id`, and a tab whose panel is in the DOM also points at
 * it with `aria-controls`. `renderedIds` is required for that reason (裁决
 * Q34): the only production caller, `OutPane`, renders the SELECTED panel and
 * nothing else, so writing the pointer on every tab left the others aimed at an
 * id that does not exist. It is a prop rather than a guess because this
 * component cannot see the caller's DOM, and it has no default because a
 * forgotten one would silently bring the dangling pointers back.
 *
 * The panel itself is the caller's, built with the two exported id helpers
 * rather than by re-spelling the shape — two hand-written halves are exactly how
 * this pointer goes stale. Note that the round-trip assertion in Tabs.test.tsx
 * cannot catch a dangling pointer: its fixture renders every panel, so the gate
 * for that lives at the seam, in OutPane.test.tsx. Home/End are not implemented
 * (APG lists them as optional).
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
  renderedIds,
}: {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly idPrefix: string;
  /**
   * The ids whose panels the caller has actually put in the DOM. Only those tabs
   * get an `aria-controls`; pass `[value]` when one panel is rendered at a time.
   */
  readonly renderedIds: readonly string[];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // The tab the group shows as selected: `value` while it is one of the tabs,
  // else the first tab left. A value can outlive its tab when the list changes
  // under it; with no tab selected the roving tabindex leaves no stop, and the
  // whole group drops out of the Tab order. `onChange` is not called for this:
  // the value is the caller's to change.
  const selectedId = tabs.some(([id]) => id === value) ? value : tabs[0]?.[0];

  function move(delta: number): void {
    const from = tabs.findIndex(([id]) => id === selectedId);
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
        const selected = id === selectedId;
        // An `aria-controls` pointing at an id that is not in the document is a
        // broken promise to assistive technology, not a harmless extra.
        const panelRendered = renderedIds.includes(id);
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabButtonId(idPrefix, id)}
            {...(panelRendered ? { "aria-controls": tabPanelId(idPrefix, id) } : {})}
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
