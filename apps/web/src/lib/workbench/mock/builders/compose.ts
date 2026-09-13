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
 * thematic break, backtick or tilde fence, link reference definition (labels
 * may hold escaped brackets), GFM task marker. An HTML block is not listed:
 * `escapeRawHtml` has already encoded every `<` that could start one.
 */
const LEADS_BLOCK =
  /^(?:#{1,6}(?=[ \t]|$)|>|[-+*](?=[ \t]|$)|-(?:[ \t]*-)+[ \t]*$|([*_])(?:[ \t]*\1){2,}[ \t]*$|`{3,}|~{3,}|\[(?:\\.|[^\]\\])*\]:|\[[ xX]\](?=[ \t]|$))/;
/** An ordered-list marker (at most nine digits): the delimiter is escaped so the number stays readable. */
const LEADS_ORDERED = /^(\d{1,9})([.)])(?=[ \t]|$)/;

/**
 * A `<` that could open raw HTML: followed by a letter (open tag), `/` (closing
 * tag), `!` (comment, declaration, CDATA) or `?` (processing instruction). A
 * deliberate over-match: `A <B>` is written `A &lt;B>` and still reads `A <B>`.
 */
const TAG_OPENER = /<(?=[A-Za-z!?/])/gu;

/**
 * Encodes every tag-shaped `<` as `&lt;`, wherever it stands, without reading
 * the Markdown around it (codex S7r3, the second round in which a scanner that
 * skipped code spans and link destinations was beaten by constructed input).
 *
 * Why an entity and not a backslash: under GFM an extended autolink
 * (`www.example.com/<b>`) swallows the backslash into its href, and the `<`
 * after it opens a tag again. An entity holds no `<`, so whatever a reader
 * folds it into, a link or a code span, it can only show as text.
 *
 * Why no context: deciding "this `<` is inside a code span or a link
 * destination, leave it" means agreeing with every reader about where those
 * start and end, and a block-start backslash `docText` adds afterwards, or a
 * GFM autolink that eats the link text, moves those boundaries. Two rounds of
 * such inputs (``` ```<b>x</b>``` ```, `www.example.com/[x](<b>)`) are what this
 * ruling ends; structure in an exported `.md` wins over fidelity.
 *
 * Known costs, accepted: a tag-shaped `<` inside a code span or an angle-bracket
 * link destination shows as `&lt;`; an angle-bracket autolink `<https://…>` is
 * no longer an autolink (with GFM on, the bare URL inside is still linked). An
 * entity the user typed themselves (`&lt;h1&gt;`) is left as typed and renders
 * as the character it names — not in this batch's scope.
 */
function escapeRawHtml(text: string): string {
  return text.replace(TAG_OPENER, "&lt;");
}

/**
 * User or AI text for a document bullet: folded onto one line by `oneLine`,
 * every `<` that would open raw HTML encoded as `&lt;` (`escapeRawHtml`), then
 * one backslash where the line would open a block, so it renders as the
 * folded text.
 *
 * The HTML encoding covers the whole line, not only its start (codex S7b #1): a
 * title like `x <h1>…</h1><br>…` rendered a real heading and a line of its own
 * in a reader that allows HTML. The Studio preview drops raw HTML; an exported
 * `.md` opened elsewhere may not. Other inline Markdown (emphasis, links, a
 * backslash the user typed) is left alone; a backslash typed right before a
 * tag-shaped `<` now escapes the entity's `&`, so that reader shows `&lt;`.
 */
export function docText(value: string): string {
  const folded = escapeRawHtml(oneLine(value));
  if (LEADS_ORDERED.test(folded)) {
    return folded.replace(LEADS_ORDERED, "$1\\$2");
  }
  return LEADS_BLOCK.test(folded) ? `\\${folded}` : folded;
}

/**
 * Bullet lines for user or AI text in a document (not a prompt, R6): each item
 * goes through `docText`, so it stays on its own line, cannot open a heading,
 * fence, quote, list, rule, link definition or task box inside its bullet, and
 * carries no raw HTML anywhere in it. Other inline Markdown in it still
 * renders. Items that fold to nothing are dropped.
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
