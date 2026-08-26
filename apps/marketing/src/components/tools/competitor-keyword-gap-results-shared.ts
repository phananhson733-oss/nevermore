// @input  -- nothing at runtime; the tool's next-intl translator type, locale strings, and provider URLs
// @output -- shared Tailwind class tokens (cards, chips by shape and tone, column provenance badges), the narrowed translator type, and number/translate/URL-safety-and-shape helpers
// @pos    -- styling and formatting shared by every Marketing competitor gap results module

import type { useTranslations } from "next-intl";

export const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
export const BADGE =
  "inline-flex items-center rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2.5 py-1 font-mono text-[10px] tracking-[0.05em] text-text-dark-secondary uppercase";
export const TABLE_TEXT = "text-[13px] leading-[1.45]";
export const META_TEXT = "text-[12px] leading-[1.35]";
export const KEYWORD_TEXT =
  "text-[15.5px] font-semibold leading-[1.25] text-text-dark-primary";
export const CHIP_TEXT =
  "inline-flex items-center rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2 py-1 font-mono text-[11px] leading-none text-text-dark-primary";

/**
 * Two chip shapes, and the difference carries meaning.
 *
 * A rectangle is a DATUM the provider or Search Console reported -- a rank, a
 * difficulty, a SERP feature. A pill is a STATE this row is in. Keeping them
 * visually distinct stops a reader from scanning a stored provider snapshot as
 * if it were their own measured status, which is the one confusion this table
 * exists to prevent.
 */
export const DATA_CHIP =
  "inline-flex items-center gap-1 rounded-[6px] border px-2 py-[3px] font-mono text-[11.5px] leading-[1.35]";

export type ChipTone = "neutral" | "positive" | "caution" | "muted";

/**
 * Tone is reading order, never a verdict. `positive` marks a row the
 * pre-screen puts near the top of the queue; it does not say the keyword is
 * winnable, and the chip's own title still names the basis.
 */
export function chipTone(tone: ChipTone): string {
  switch (tone) {
    case "positive":
      return "border-brand-success/35 bg-brand-success/[0.10] text-brand-success";
    case "caution":
      return "border-brand-warning/35 bg-brand-warning/[0.10] text-brand-warning";
    case "muted":
      return "border-brand-border bg-brand-panel-sunken text-text-dark-secondary";
    case "neutral":
      return "border-brand-border-strong bg-brand-panel-sunken text-text-dark-primary";
  }
}

/**
 * The provenance badge that sits in a column header.
 *
 * It is in the header rather than a legend box because the question it answers
 * -- "is this number mine or a third party's guess?" -- is asked while reading
 * a cell, and a legend twenty lines up does not answer it there.
 */
export const COLUMN_BADGE =
  "ml-1.5 inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[9.5px] leading-[1.5] tracking-[0.03em] normal-case";

export const COLUMN_BADGE_TONE: Readonly<Record<"dfs" | "gsc" | "tool", string>> =
  {
    dfs: "border-brand-info/35 bg-brand-info/[0.10] text-brand-info",
    gsc: "border-brand-success/35 bg-brand-success/[0.10] text-brand-success",
    // Distinct from `dfs` on purpose: a band this tool derived from its own
    // text and URL heuristics is not something the provider reported.
    tool: "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary",
  };
export const ACTION_BUTTON =
  "inline-flex items-center whitespace-nowrap rounded-[10px] border border-brand-border-strong bg-brand-panel-raised px-3 py-2 text-[12px] font-medium text-text-dark-primary transition hover:border-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
export const PRIMARY_ACTION_BUTTON =
  "inline-flex items-center whitespace-nowrap rounded-[10px] bg-brand-accent px-3 py-2 text-[12px] font-semibold text-brand-on-accent transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

export type Translate = ReturnType<
  typeof useTranslations<"tools.competitorKeywordGap">
>;

export function translated(t: Translate, key: string): string {
  return t(key as Parameters<typeof t>[0]);
}

export function number(
  value: number,
  locale: string,
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    useGrouping: true,
  }).format(value);
}

/** http(s) only and never credentialed, so a provider URL can be rendered as a link. */
export function safePageUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * The path alone, for a control that has to name the page it opens without
 * pushing every other column off the screen. The host is this visitor's own
 * site in every case, so repeating it buys nothing; the control's title still
 * carries the entire URL it acts on.
 */
const ACTION_PATH_MAX = 28;

/**
 * Everything after the scheme, query string included.
 *
 * Search Console attributes query-string URLs routinely. Dropping the search
 * rendered `/products?category=shoes` and `/products?category=hats` as the
 * identical line while the two rows named different pages -- a label that
 * cannot be told apart from its neighbour is not naming anything.
 */
export function pagePath(value: string | null): string | null {
  const page = safePageUrl(value);
  if (page === null) return null;
  const url = new URL(page);
  // The bare root path is dropped, but only when there is no search after it:
  // `example.com?a=1` is not an address anyone can read back.
  const path = url.pathname === "/" && url.search === "" ? "" : url.pathname;
  return `${url.hostname}${path}${url.search}`;
}

/**
 * The same value without the host, shortened from the MIDDLE to fit a column.
 *
 * Trimming the tail defeated the reason the search string was added at all.
 * The URLs that need telling apart are exactly the ones that share a long
 * prefix -- `/collections/all?filter=color-red` and `...color-blue` both cut
 * to the same 28 characters, so two rows named different pages with the same
 * label again. Keeping both ends preserves whatever actually differs; the full
 * URL is on the control's title either way.
 */
export function ownPagePath(value: string | null): string | null {
  const page = safePageUrl(value);
  if (page === null) return null;
  const url = new URL(page);
  const path = `${url.pathname === "" ? "/" : url.pathname}${url.search}`;
  if (path.length <= ACTION_PATH_MAX) return path;
  const head = Math.ceil((ACTION_PATH_MAX - 1) / 2);
  const tail = ACTION_PATH_MAX - 1 - head;
  return `${path.slice(0, head)}\u2026${path.slice(path.length - tail)}`;
}
