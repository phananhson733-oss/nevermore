// @input  -- the text of one answer a model gave to the question
// @output -- the subtopics that answer organised itself around, bounded and deduplicated
// @pos    -- deterministic; no model decides what a sampled answer covered

import { normalizeGeoText } from "../agents/geo-canonical.ts";

/** Subtopics kept from one answer. Beyond this the list stops being a list. */
export const GEO_BRIEF_MAX_SUBTOPICS = 8;

/** Longest subtopic worth carrying. A paragraph is not a subtopic. */
export const GEO_BRIEF_MAX_SUBTOPIC_CHARS = 120;

/** Shortest. Below this it is a fragment, not a thing the page has to answer. */
const MIN_SUBTOPIC_CHARS = 4;

/**
 * Markdown headings, list markers and the bold lead-in some answers use instead.
 *
 * Written as separate anchored patterns rather than one alternation so a change
 * to any of them cannot silently widen the others.
 */
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.+)$/;
const ORDERED = /^\s{0,3}\d{1,2}[.)]\s+(.+)$/;
/** `**Pricing**: ...` and `**Pricing** - ...`, which answers use as a heading. */
const BOLD_LEAD = /^\s{0,3}\*\*(.+?)\*\*\s*[:：—-]/;

/**
 * Strip the inline markup a heading carries so two spellings of one subtopic
 * do not both survive deduplication.
 *
 * Only the markers, never the words. Emphasis around a whole heading is
 * decoration; emphasis around one word inside it is not, and removing the
 * marker leaves the word.
 */
function stripInline(value: string): string {
  return value
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * Cut a list item down to its lead-in.
 *
 * A bullet is often "Pricing: starts at $29 per seat for teams of five or more"
 * - the subtopic is everything before the colon, and the rest is one answer's
 * particular claim. Keeping the claim would put another company's numbers in
 * the brief, which is the one thing a sampled answer may never contribute.
 */
function leadIn(value: string): string {
  const separator = value.search(/[:：]|\s[—–-]\s/u);
  if (separator > 0) return value.slice(0, separator).trim();
  return value;
}

function candidate(line: string): string | null {
  const heading = HEADING.exec(line);
  if (heading?.[1] !== undefined) return stripInline(heading[1]);
  const bold = BOLD_LEAD.exec(line);
  if (bold?.[1] !== undefined) return stripInline(bold[1]);
  const bullet = BULLET.exec(line);
  if (bullet?.[1] !== undefined) return leadIn(stripInline(bullet[1]));
  const ordered = ORDERED.exec(line);
  if (ordered?.[1] !== undefined) return leadIn(stripInline(ordered[1]));
  return null;
}

/**
 * The subtopics one sampled answer organised itself around.
 *
 * Deterministic on purpose. The alternative - asking a model what the answer
 * covered - costs a third paid call and makes the provenance a claim rather
 * than an observation: an item labelled "observed in a real answer" would then
 * rest on a second model's summary of a first model's text. Headings and list
 * lead-ins are what the answer itself chose to separate, which is exactly the
 * question being asked.
 *
 * Returns an empty list rather than guessing when the answer is prose with no
 * structure. That case is real and the brief reports it as a run limit; a
 * sentence split into "subtopics" would be this tool inventing the evidence it
 * says it observed.
 */
export function geoBriefSubtopics(answerText: string): readonly string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of answerText.split("\n")) {
    if (kept.length >= GEO_BRIEF_MAX_SUBTOPICS) break;
    const raw = candidate(line);
    if (raw === null) continue;
    const text = normalizeGeoText(raw);
    if (
      text.length < MIN_SUBTOPIC_CHARS ||
      text.length > GEO_BRIEF_MAX_SUBTOPIC_CHARS
    ) {
      continue;
    }
    // Case-folded for the comparison only; the kept spelling is the answer's.
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept;
}
