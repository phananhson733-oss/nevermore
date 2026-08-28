// @input  -- the draft tool's next-intl translator type and one DraftResult's run meta
// @output -- the narrowed translator type, reason-to-copy lookup, and the small
//            helpers every draft card shares; the style tokens are re-exported from
//            the brief's shared module so both tools look like one surface
// @pos    -- shared by every content-draft result module; carries NO source colour
//            (those live only in the whitelisted files, see app/source-tokens.test.ts)

import type { useTranslations } from "next-intl";
import type {
  DraftResult,
  UnavailableReason,
} from "@sf/public-tools/content-brief/contract";

import { chipTone, type ChipTone } from "./competitor-keyword-gap-results-shared";

export {
  ACTION_BUTTON,
  BADGE,
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  MONO_FIGURE,
  PILL,
  PRIMARY_ACTION_BUTTON,
  SECTION_TITLE,
  chipTone,
  collectedTime,
  joinList,
  number,
  seconds,
  statusTone,
} from "./content-brief-results-shared";

export type DraftTranslate = ReturnType<
  typeof useTranslations<"tools.contentDraft">
>;

export type TranslateValues = Readonly<Record<string, string | number>>;

export function translated(
  t: DraftTranslate,
  key: string,
  values?: TranslateValues,
): string {
  return t(key as Parameters<typeof t>[0], values);
}

/** Field-specific copy for an `Unavailable` reason first, the closed generic table otherwise. */
export function reasonCopy(
  t: DraftTranslate,
  group: string,
  reason: UnavailableReason,
  values?: TranslateValues,
): string {
  const specific = `${group}.${reason}`;
  return t.has(specific as Parameters<typeof t.has>[0])
    ? translated(t, specific, values)
    : translated(t, `unavailable.${reason}`, values);
}

/** The run mode as a pill tone; `degraded` is a caution, `unavailable` an error. */
export function modeTone(mode: DraftResult["run"]["mode"]): string {
  const tone: ChipTone | "error" =
    mode === "complete"
      ? "positive"
      : mode === "unavailable"
        ? "error"
        : "caution";
  return tone === "error"
    ? "border-brand-error/35 bg-brand-error/[0.10] text-brand-error"
    : chipTone(tone);
}

/** One section by id, or null when the result names a section it does not carry. */
export function sectionById(result: DraftResult, id: string) {
  return result.sections.find((section) => section.id === id) ?? null;
}
