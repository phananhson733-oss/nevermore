// @input  -- nothing at runtime; the tool's next-intl translator type, locale strings, and provider URLs
// @output -- shared Tailwind class tokens, the narrowed translator type, and number/translate/URL-safety helpers
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
export const ACTION_BUTTON =
  "inline-flex items-center rounded-[10px] border border-brand-border-strong px-3 py-2 text-[12px] font-medium text-text-dark-primary transition hover:border-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
export const PRIMARY_ACTION_BUTTON =
  "inline-flex items-center rounded-[10px] bg-brand-accent px-3 py-2 text-[12px] font-semibold text-brand-on-accent transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

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
