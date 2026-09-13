/** Small formatting pieces shared by the artifact builders. */
import { oneLine } from "../text.ts";

/**
 * A count for a document line. Missing or non-finite prints `n/a`, never `0`:
 * an unavailable number is not zero. Accepts `null` so GSC counts that may be
 * unknown render the same way.
 */
export function countText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "n/a";
}

/**
 * What opens a block at the start of a `- ` list item's content (CommonMark +
 * GFM, checked against marked 17): ATX heading, blockquote, bullet, a dash run
 * that joins the item's own `-` into a thematic break (`- --`), a `*` / `_`
 * thematic break, backtick or tilde fence, HTML block, link reference
 * definition (labels may hold escaped brackets), GFM task marker.
 */
const LEADS_BLOCK =
  /^(?:#{1,6}(?=[ \t]|$)|>|[-+*](?=[ \t]|$)|-(?:[ \t]*-)+[ \t]*$|([*_])(?:[ \t]*\1){2,}[ \t]*$|`{3,}|~{3,}|<[A-Za-z!?/]|\[(?:\\.|[^\]\\])*\]:|\[[ xX]\](?=[ \t]|$))/;
/** An ordered-list marker (at most nine digits): the delimiter is escaped so the number stays readable. */
const LEADS_ORDERED = /^(\d{1,9})([.)])(?=[ \t]|$)/;

/**
 * User or AI text for the start of a document bullet: folded onto one line by
 * `oneLine`, then given one backslash where it would open a block, so it
 * renders as the folded text. Inline Markdown (emphasis, code spans, links, a
 * backslash the user typed) is left alone.
 */
export function docText(value: string): string {
  const folded = oneLine(value);
  if (LEADS_ORDERED.test(folded)) {
    return folded.replace(LEADS_ORDERED, "$1\\$2");
  }
  return LEADS_BLOCK.test(folded) ? `\\${folded}` : folded;
}

/**
 * Bullet lines for user or AI text in a document (not a prompt, R6): each item
 * goes through `docText`, so it stays on its own line and cannot open a
 * heading, fence, quote, list, rule, HTML block, link definition or task box
 * inside its bullet. Inline Markdown in it still renders. Items that fold to
 * nothing are dropped.
 */
export function bulletLines(values: readonly string[]): readonly string[] {
  return values
    .map(docText)
    .filter((value) => value !== "")
    .map((value) => `- ${value}`);
}

/** A `## title` section, or `null` when it has no lines (empty sections are omitted). */
export function docSection(
  title: string,
  lines: readonly string[],
): string | null {
  return lines.length === 0 ? null : [`## ${title}`, ...lines].join("\n");
}

/** Joins the parts that are present with a blank line between them. */
export function joinParts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join("\n\n");
}
