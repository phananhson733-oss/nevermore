/** Text helpers for the mock layer: slugs, hosts, list fields, query normalization, brand matching. */
import type { Profile } from "../types.ts";
import { hashOf } from "./rng.ts";

const SLUG_MAX_CODE_POINTS = 60;
/** Diacritics on Latin / Greek / Cyrillic letters only: stripping every mark would split Hangul and turn グ into ク. */
const ALPHABET_DIACRITICS =
  /(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu;
/** Marks with no letter, number or mark before them, e.g. the U+FE0F of "❤️": on their own they render as nothing. */
const ORPHAN_MARKS = /(?<![\p{L}\p{N}\p{M}])\p{M}+/gu;
/** `\p{M}` stays allowed, or Devanagari vowel signs would become separators. */
const NON_SLUG_RUN = /[^\p{L}\p{N}\p{M}]+/gu;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const EDGE_DASHES = /^-+|-+$/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const CJK_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const REGEXP_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

export const COMPETITOR_PLACEHOLDERS = [
  "[竞品 A]",
  "[竞品 B]",
  "[竞品 C]",
] as const;

/** URL path segment for any script, at most 60 code points; `q-<hash>` when no letter or number survives. */
export function slugify(value: string): string {
  const dashed = value
    .normalize("NFKD")
    .replace(ALPHABET_DIACRITICS, "")
    .normalize("NFC")
    .replace(ORPHAN_MARKS, "")
    .toLowerCase()
    .replace(NON_SLUG_RUN, "-")
    .replace(EDGE_DASHES, "");
  const cut = Array.from(dashed)
    .slice(0, SLUG_MAX_CODE_POINTS)
    .join("")
    .replace(EDGE_DASHES, "");
  return LETTER_OR_NUMBER.test(cut) ? cut : `q-${hashOf(value).toString(36)}`;
}

/** Bare lowercase host without `www.` or a trailing dot. Empty input gives an empty string. */
export function domainOf(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") return "";
  try {
    const { hostname } = new URL(
      HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    return hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    // Not a parseable URL (e.g. a space in the host): best-effort slice, never throw.
    // `www.` is stripped before lowercasing, so the `/i` is what handles "WWW.".
    const host =
      trimmed
        .replace(HAS_SCHEME, "")
        .replace(/^www\./i, "")
        .split("/")[0] ?? "";
    return host.toLowerCase().replace(/\.$/, "");
  }
}

/** A comma-separated profile field as trimmed, non-empty items. */
export function splitList(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Comparison key for queries and names: NFKC, collapsed whitespace, lowercase. */
export function normQ(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SYNTAX, "\\$&");
}

/** Whether `text` mentions `brand`: substring for CJK brands, whole-word otherwise ("Gen" does not match "genre"). */
export function matchesBrand(text: string, brand: string): boolean {
  const wanted = normQ(brand);
  if (wanted === "") return false;
  const haystack = normQ(text);
  if (CJK_SCRIPT.test(wanted)) return haystack.includes(wanted);
  const wholeWord = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(wanted)}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return wholeWord.test(haystack);
}

/**
 * Folds line breaks (and the whitespace around them) into one space, so a user
 * field cannot open a new heading. Besides CR and LF it folds NEL, U+2028 and
 * U+2029: a JavaScript regex `.` stops at the last two, which makes a Markdown
 * renderer such as marked drop a heading that holds one.
 */
export function oneLine(value: string): string {
  return value.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, " ").trim();
}

/** The project's competitors, deduped by `normQ` keeping the first spelling; placeholders when none are filled in (R9). */
export function competitorNames(
  profile: Pick<Profile, "competitors">,
): readonly string[] {
  const names = splitList(profile.competitors);
  const keys = names.map(normQ);
  const unique = names.filter(
    (_, index) => keys.indexOf(keys[index] ?? "") === index,
  );
  return unique.length > 0 ? unique : COMPETITOR_PLACEHOLDERS;
}
