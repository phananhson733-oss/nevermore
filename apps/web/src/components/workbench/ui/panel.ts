/**
 * Shared class strings for the workbench's card / panel shells and for the
 * buttons that sit in their headers and footers. They are constants rather than
 * components because the three shells differ only in their header, and wrapping
 * that in props costs more than it saves (design §4.1); what must not differ is
 * the surface itself, which the prototype hand-copied per view.
 *
 * Three rules are encoded here, and all three fail silently when a diff drops them:
 *
 * - Tailwind runs with NO preflight and `.wb-reset` sets `border-width: 0`
 *   (app/workbench.css), so every rule line is an explicit `border*` utility
 *   and every `<table>` says `border-collapse` itself. A missing `border-…`
 *   class does not fall back to a hairline, it removes the line.
 * - `.wb-reset :focus-visible` draws the ring in `currentColor`, which is
 *   invisible on an inverted (`text-white`) fill, so every inverted control
 *   names its own `focus-visible:outline-*` (Topbar.tsx:140 has the same note).
 * - Every clickable surface declares its hit area HERE, as a `min-h-[…px]`:
 *   panel.test.ts sweeps this module's exports for those numbers and holds them
 *   above 24px. A size written in a component file is covered by nothing, which
 *   is why `SWITCH_TRACK` (an input, not a button) lives here too.
 *
 * Colours are Tailwind built-ins or the `--color-wb-*` tokens; no raw hex, and
 * no 11–13px body text (PR-1 lifted body copy to 14px and left the smaller
 * sizes to badges, column heads and timestamps).
 *
 * 一旦本文件被更新，务必更新开头注释
 */

/** Output/input panel shell: `overflow-hidden` so the header's fill is clipped to the radius. */
export const PANEL_SHELL =
  "flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";

/** Panel header row: title on the left, tabs or a count on the right. */
export const PANEL_HEAD =
  "flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 md:px-6";

/**
 * The small "input" / "output" tag that opens a panel header. slate-600, not
 * slate-500: on slate-100 that pair is 4.35:1, under AA for 12px text, and this
 * tag is the only text in the file that sits on a tinted fill. color-pairs.test.ts
 * measures it (6.90:1 as written) instead of trusting this sentence.
 */
export const PANEL_TAG =
  "inline-flex items-center rounded border border-slate-200/60 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600";

/** Panel and block headings (15px: above the 14px body floor, below the 24px h1). */
export const PANEL_TITLE = "text-[15px] font-semibold text-slate-900";

/** Panel body. `flex-1` so a short body still pushes the footer to the bottom. */
export const PANEL_BODY = "flex-1 p-4 md:p-6";

/** Panel footer (action row). Its rule line is explicit, see the header note. */
export const PANEL_FOOT =
  "flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 md:px-6";

/** Plain card shell (no header fill, no clipping). */
export const CARD_SHELL =
  "rounded-xl border border-slate-200 bg-white shadow-sm";

/** Roomy padding for a card that carries a block of its own, e.g. "what next". */
export const CARD_PAD = "p-6 md:p-8";

/** Metric card shell. `min-h` keeps a row of cards level when one foot wraps. */
export const STAT_CARD_SHELL =
  "flex min-h-[140px] flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

/** Footnote under a metric or a card body: pushed down, above its own rule. */
export const FOOT_NOTE =
  "mt-auto border-t border-slate-100 pt-3 text-xs text-slate-500";

/** A horizontal rule between blocks. `<hr>` has no line of its own here. */
export const SECTION_RULE = "border-t border-slate-100";

/** A row separator inside a list of rows. */
export const ROW_RULE = "border-t border-slate-100";

/** `<table>`: `border-collapse` is not a default under `.wb-reset`. */
export const TABLE_SHELL = "w-full border-collapse text-left";

/** `<thead>` row. Column heads may sit below the body floor. */
export const TABLE_HEAD_ROW =
  "border-b border-slate-100 text-xs font-medium text-slate-500";

/** `<tbody>` row. */
export const TABLE_ROW =
  "border-b border-slate-100 text-sm text-slate-700 hover:bg-slate-50";

/** Primary action. Inverted, so it carries its own focus ring (see header). */
export const BUTTON_PRIMARY =
  "inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-wb-ink bg-wb-ink px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-black focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60";

/** Secondary action on paper. */
export const BUTTON_SECONDARY =
  "inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The switch in `Toggle.tsx`: the real `<input type="checkbox">`, sized and
 * painted here rather than in the component. `appearance-none` is required —
 * the `.wb-reset` block styles `progress` but leaves native checkboxes alone —
 * and the knob is an `after:` pseudo-element so nothing needs an inline style.
 *
 * The size lives in this module on purpose: the hit-area sweep in
 * `panel.test.ts` iterates this module's exports, so a `min-h` written in a
 * component file sits outside it. 24x44 clears WCAG 2.5.8's 24px floor in both
 * dimensions, and the input itself is the target (a visually-hidden input with a
 * big label would measure 1px).
 */
export const SWITCH_TRACK =
  "relative inline-flex min-h-[24px] w-[44px] shrink-0 cursor-pointer appearance-none rounded-full border border-slate-300 bg-slate-200 transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform checked:border-wb-ink checked:bg-wb-ink checked:after:translate-x-[20px] disabled:cursor-not-allowed disabled:opacity-60";

/** Compact action for a panel footer. 28px tall, above the 24px target floor. */
export const BUTTON_MINI =
  "inline-flex min-h-[28px] items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
