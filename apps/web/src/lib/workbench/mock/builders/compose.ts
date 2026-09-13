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
 * `escapeRawHtml` has already escaped every `<` that could start one (the one
 * it leaves at the start of a line opens an autolink, which no HTML block
 * start condition accepts).
 */
const LEADS_BLOCK =
  /^(?:#{1,6}(?=[ \t]|$)|>|[-+*](?=[ \t]|$)|-(?:[ \t]*-)+[ \t]*$|([*_])(?:[ \t]*\1){2,}[ \t]*$|`{3,}|~{3,}|\[(?:\\.|[^\]\\])*\]:|\[[ xX]\](?=[ \t]|$))/;
/** An ordered-list marker (at most nine digits): the delimiter is escaped so the number stays readable. */
const LEADS_ORDERED = /^(\d{1,9})([.)])(?=[ \t]|$)/;

/** The ASCII punctuation a backslash escapes (CommonMark, marked). */
const ESCAPABLE = /^[!-/:-@[-`{-~]$/u;

/**
 * What may follow a `<` that opens raw HTML: a letter (open tag), `/` (closing
 * tag), `!` (comment, declaration, CDATA) or `?` (processing instruction). A
 * deliberate over-match: `A <B>` is written `A \<B>` and still reads `A <B>`.
 */
const HTML_AFTER_LT = /^[A-Za-z!?/]$/u;

/**
 * A URI or email autolink (CommonMark, narrowed to what marked 17 also takes:
 * no Unicode whitespace, at least one dot in an email domain). No raw HTML
 * reads it either way: a tag name cannot hold `:` or `@`, and an attribute
 * needs whitespace before it.
 */
const AUTOLINK =
  /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\p{Cc}<>]*|[A-Za-z0-9.!#$%&'*+/=?_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/u;

/**
 * The link text before a destination: `[`, plain text, `](`. Plain means no
 * bracket, backtick, angle bracket, parenthesis or quote other than a
 * backslash-escaped one, and no `]` right before the `[`; with any of those,
 * marked and CommonMark can disagree about whether this is a link at all.
 */
const LINK_TEXT_BEFORE = /(?<!\])\[(?:\\[!-/:-@[-`{-~]|[^\\[\]`<>()"'])*\]\([ \t]*$/u;

/** An angle-bracket destination, an optional title without backslashes, and the closing `)`. */
const LINK_DESTINATION =
  /^<[^<>\\\n]+>(?=(?:[ \t]+(?:"[^"\\\n]*"|'[^'\\\n]*'|\([^()\\\n]*\)))?[ \t]*\))/u;

interface Brackets {
  /** Unescaped `[` not yet closed, outside code spans and autolinks. */
  readonly depth: number;
  /** Where each `[` opened with no other bracket open stands. */
  readonly topLevel: readonly number[];
}

const NO_BRACKETS: Brackets = { depth: 0, topLevel: [] };

function afterBracket(brackets: Brackets, char: string, at: number): Brackets {
  if (char === "[") {
    const topLevel = brackets.depth === 0 ? [...brackets.topLevel, at] : brackets.topLevel;
    return { depth: brackets.depth + 1, topLevel };
  }
  return char === "]" ? { ...brackets, depth: Math.max(0, brackets.depth - 1) } : brackets;
}

function backtickRun(text: string, at: number): number {
  const run = /^`+/u.exec(text.slice(at));
  return run === null ? 0 : run[0].length;
}

/** The end of the code span opening at `at`, or of the backtick run itself when no run of its length closes it. */
function codeSpanEnd(text: string, at: number): number {
  const size = backtickRun(text, at);
  for (let next = text.indexOf("`", at + size); next !== -1; ) {
    const run = backtickRun(text, next);
    if (run === size) return next + run;
    next = text.indexOf("`", next + run);
  }
  return at + size;
}

/** The end of a link destination at `at`, when the link before and after it is one every reader agrees on. */
function destinationEnd(text: string, at: number, brackets: Brackets): number | null {
  const before = LINK_TEXT_BEFORE.exec(text.slice(0, at));
  if (before === null || brackets.depth !== 0 || !brackets.topLevel.includes(before.index)) return null;
  const destination = LINK_DESTINATION.exec(text.slice(at));
  return destination === null ? null : at + destination[0].length;
}

/** Where a run copied as it stands ends: a backslash escape, a code span, an autolink or a link destination. */
function verbatimEnd(text: string, at: number, brackets: Brackets): number | null {
  const char = text.charAt(at);
  if (char === "\\") return ESCAPABLE.test(text.charAt(at + 1)) ? at + 2 : at + 1;
  if (char === "`") return codeSpanEnd(text, at);
  if (char !== "<") return null;
  const autolink = AUTOLINK.exec(text.slice(at));
  return autolink === null ? destinationEnd(text, at, brackets) : at + autolink[0].length;
}

/**
 * Gives a backslash to every `<` that would open raw HTML, reading the line
 * left to right the way a CommonMark reader does, so the Markdown around it
 * keeps its meaning (codex S7r2 #1): a code span's text, an autolink and an
 * angle-bracket link destination are copied as they stand, and a `<` a
 * backslash already escapes is left alone. Where marked and CommonMark could
 * read a destination differently (nested brackets, punctuation in the link
 * text, a title with a backslash) the `<` is escaped: that costs the link its
 * target, never lets a tag through.
 */
function escapeRawHtml(text: string): string {
  let written = "";
  let at = 0;
  let brackets = NO_BRACKETS;
  while (at < text.length) {
    const end = verbatimEnd(text, at, brackets);
    if (end !== null) {
      written += text.slice(at, end);
      at = end;
      continue;
    }
    const char = text.charAt(at);
    written += char === "<" && HTML_AFTER_LT.test(text.charAt(at + 1)) ? "\\<" : char;
    brackets = afterBracket(brackets, char, at);
    at += 1;
  }
  return written;
}

/**
 * User or AI text for a document bullet: folded onto one line by `oneLine`,
 * every `<` that would open raw HTML given a backslash (`escapeRawHtml`),
 * then one backslash where the line would open a block, so it renders as the
 * folded text.
 *
 * The HTML escape covers the whole line, not only its start (codex S7b #1): a
 * title like `x <h1>…</h1><br>…` rendered a real heading and a line of its own
 * in a reader that allows HTML. The Studio preview drops raw HTML; an exported
 * `.md` opened elsewhere may not. Other inline Markdown (emphasis, code spans,
 * autolinks, links and their angle-bracket destinations, a backslash the user
 * typed) is left alone.
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
