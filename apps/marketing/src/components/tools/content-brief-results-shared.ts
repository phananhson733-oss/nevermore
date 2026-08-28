// @input  -- the tool's next-intl translator type, one ContentBrief, and its run meta
// @output -- the narrowed translator type, reason-to-copy lookup, read-status tone,
//            and the small formatting helpers every brief card shares
// @pos    -- shared by every content-brief result module; carries NO source colour
//            (those live only in the three whitelisted files, see source-tokens.test.ts)

import type { useTranslations } from "next-intl";
import type {
  ContentBrief,
  Unavailable,
  UnavailableReason,
} from "@sf/public-tools/content-brief/contract";

import { chipTone, type ChipTone } from "./competitor-keyword-gap-results-shared";

export {
  ACTION_BUTTON,
  BADGE,
  CARD,
  DATA_CHIP,
  META_TEXT,
  PRIMARY_ACTION_BUTTON,
  chipTone,
  number,
  pagePath,
  safePageUrl,
} from "./competitor-keyword-gap-results-shared";

export type Translate = ReturnType<
  typeof useTranslations<"tools.contentBrief">
>;

export type TranslateValues = Readonly<Record<string, string | number>>;

export function translated(
  t: Translate,
  key: string,
  values?: TranslateValues,
): string {
  return t(key as Parameters<typeof t>[0], values);
}

/**
 * The copy for an `Unavailable` reason, field-specific first.
 *
 * Every field that can be unavailable has a table of the reasons it can carry
 * in its own words (`length.insufficient` says "fewer than N fully fetched
 * pages", which the generic sentence cannot). A reason without a field-specific
 * line falls back to the closed `unavailable.<reason>` table, so a new reason
 * renders a real sentence rather than a key path -- and the messages test pins
 * that the fallback table is complete.
 */
export function reasonCopy(
  t: Translate,
  group: string,
  reason: UnavailableReason,
  values?: TranslateValues,
): string {
  const specific = `${group}.${reason}`;
  return t.has(specific as Parameters<typeof t.has>[0])
    ? translated(t, specific, values)
    : translated(t, `unavailable.${reason}`, values);
}

/** "attempted N", or the honest "attempts not known" when the engine did not know. */
export function attemptedCopy(t: Translate, read: Unavailable): string {
  return read.attempted === null
    ? t("coverage.attemptedUnknown")
    : t("coverage.attempted", { count: read.attempted });
}

export type ReadStatus = "complete" | "partial" | "unavailable";

/** A read's status as a pill tone: green complete, amber partial, red unavailable. */
export function statusTone(status: ReadStatus): string {
  switch (status) {
    case "complete":
      return chipTone("positive");
    case "partial":
      return chipTone("caution");
    case "unavailable":
      return "border-brand-error/35 bg-brand-error/[0.10] text-brand-error";
  }
}

/** The run mode as a pill tone; `degraded` is a caution, `unavailable` an error. */
export function modeTone(mode: ContentBrief["run"]["mode"]): string {
  const tone: ChipTone | "error" =
    mode === "complete"
      ? "positive"
      : mode === "unavailable"
        ? "error"
        : "caution";
  return tone === "error" ? statusTone("unavailable") : chipTone(tone);
}

export const PILL =
  "inline-flex items-center rounded-full border px-2 py-[3px] font-mono text-[10.5px] leading-none tracking-[0.04em]";

export const SECTION_TITLE =
  "text-[15px] font-semibold tracking-[-0.01em] text-text-dark-primary";

export const BODY_TEXT = "text-[12.5px] leading-[1.6] text-text-dark-secondary";

export const MONO_FIGURE =
  "font-mono text-[13px] leading-[1.35] text-text-dark-primary";

export const ID_CHIP =
  "inline-flex shrink-0 items-center rounded-[6px] border border-brand-border-strong bg-brand-panel-sunken px-1.5 py-[2px] font-mono text-[10.5px] leading-none text-text-dark-secondary";

export function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

export function collectedTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

/** The SERP rows actually returned, which is the denominator every SERP-derived field prints. */
export function serpReturned(brief: ContentBrief): number | null {
  const serp = brief.run.reads.serp;
  return serp.status === "unavailable" ? null : serp.returned;
}

/** The crawl counts every must-answer denominator reads; null when no URL was fetched at all. */
export function crawlCounts(brief: ContentBrief): {
  readonly attempted: number | null;
  readonly observed: number;
  readonly truncated: number;
  readonly failed: number;
  readonly skipped: number;
} | null {
  const crawl = brief.run.reads.crawl;
  if (crawl.status === "unavailable") return null;
  return {
    attempted: crawl.attempted,
    observed: crawl.observed,
    truncated: crawl.truncated,
    failed: crawl.failed,
    skipped: crawl.skipped,
  };
}

/** A GSC page from the ledger by reference, or null when the model cited one that is not there. */
export function gscPage(brief: ContentBrief, ref: string) {
  return brief.evidence.gsc_pages.find((page) => page.id === ref) ?? null;
}

/** A crawl observation from the ledger by id. */
export function crawlObservation(brief: ContentBrief, id: string) {
  return (
    brief.evidence.crawl.observed.find((page) => page.id === id) ?? null
  );
}

/** A profile fact from the ledger by id. */
export function profileFact(brief: ContentBrief, id: string) {
  return brief.evidence.profile?.facts.find((fact) => fact.id === id) ?? null;
}

export function joinList(items: readonly string[], locale: string): string {
  if (items.length === 0) return "";
  try {
    return new Intl.ListFormat(locale, {
      style: "narrow",
      type: "unit",
    }).format(items);
  } catch {
    return items.join(", ");
  }
}
