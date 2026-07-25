/**
 * Deterministic markdown/text primitives for the QA gate.
 *
 * Purity rules this file exists to keep (each mirrors a real defect in the
 * tooling this was ported from):
 *
 * 1. No `Intl.*`. Segmenter output changes with the host's ICU version, so a
 *    word count derived from it makes the same frozen draft score differently
 *    on two machines. Tokenization here is plain ASCII-class splitting.
 * 2. No module-scope stateful regexes. A `/g` regex reused through `.exec()`
 *    carries `lastIndex` between calls; every global pattern below is either
 *    created inside the function or consumed through `String.matchAll`, which
 *    does not mutate its argument.
 * 3. Masking, never deleting. Frontmatter and fenced code are blanked in place
 *    so every reported line number still refers to the original draft.
 */

export interface DraftLine {
  /** 1-based, relative to the original draft text. */
  readonly line: number;
  readonly text: string;
}

export interface DraftHeading {
  readonly line: number;
  readonly level: number;
  readonly text: string;
}

export interface DraftView {
  readonly raw: string;
  readonly lines: readonly string[];
  /** Frontmatter and fenced code blanked; line numbers preserved. */
  readonly prose: readonly DraftLine[];
  readonly headings: readonly DraftHeading[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s{0,3}(?:```|~~~)/;
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s{0,3}\|.*\|\s*$/;
const BLOCKQUOTE = /^\s{0,3}>/;

/**
 * Index of the line that CLOSES a leading frontmatter block, or `-1` when the
 * draft has none.
 *
 * Resolved up front, in its own pass, because the streaming version of this had
 * a hole with teeth: it opened the mask on a first-line `---` and only ever
 * closed it on a matching `---`, so a draft whose first line is a lone
 * horizontal rule was masked to the last byte. Every language rule then ran on
 * an empty document and reported "we found nothing wrong" — the exact
 * fail-open this gate claims it cannot do. `draftMarkdown` is the raw
 * `content_text` an LLM wrote, and a leading thematic break is perfectly
 * ordinary model output, so this is a shape we WILL be handed.
 *
 * No closing delimiter now means there was no frontmatter, and the `---` is
 * treated as the body content it is.
 */
function frontmatterEndIndex(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") return index;
  }
  return -1;
}

/** Parse a draft once: masked prose lines plus the heading spine. */
export function readDraft(markdown: string): DraftView {
  const lines = markdown.split("\n");
  const prose: DraftLine[] = [];
  const headings: DraftHeading[] = [];
  let inFence = false;
  const frontmatterEnd = frontmatterEndIndex(lines);

  for (const [index, text] of lines.entries()) {
    const lineNumber = index + 1;
    if (index <= frontmatterEnd) {
      prose.push({ line: lineNumber, text: "" });
      continue;
    }
    if (FENCE.test(text)) {
      inFence = !inFence;
      prose.push({ line: lineNumber, text: "" });
      continue;
    }
    if (inFence) {
      prose.push({ line: lineNumber, text: "" });
      continue;
    }
    prose.push({ line: lineNumber, text });
    const heading = HEADING.exec(text);
    if (heading) {
      headings.push({
        line: lineNumber,
        level: heading[1]?.length ?? 1,
        text: (heading[2] ?? "").trim(),
      });
    }
  }
  return { raw: markdown, lines, prose, headings };
}

/** Drop inline code spans so a `\`research shows\`` sample is not a claim. */
export function stripInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

export function isHeadingLine(text: string): boolean {
  return HEADING.test(text);
}

export function isListItem(text: string): boolean {
  return LIST_ITEM.test(text);
}

export function isTableRow(text: string): boolean {
  return TABLE_ROW.test(text);
}

export function isBlockquote(text: string): boolean {
  return BLOCKQUOTE.test(text);
}

/** Heading text normalized for matching a section title. */
export function normalizeHeading(text: string): string {
  return text
    .replace(/[#*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Lines of the first section whose heading matches one of `titles`, up to the
 * next heading of the same or higher level. Returns `null` when absent, which
 * is different from "present but empty".
 */
export function sectionBody(
  view: DraftView,
  titles: readonly string[],
): readonly DraftLine[] | null {
  const wanted = new Set(titles.map((title) => title.toLowerCase()));
  const heading = view.headings.find((candidate) =>
    wanted.has(normalizeHeading(candidate.text)),
  );
  if (!heading) return null;
  const body: DraftLine[] = [];
  for (const entry of view.prose) {
    if (entry.line <= heading.line) continue;
    const next = view.headings.find(
      (candidate) => candidate.line === entry.line,
    );
    if (next && next.level <= heading.level) break;
    body.push(entry);
  }
  return body;
}

/**
 * Vocabulary a reference-list heading is built from.
 *
 * A heading counts as a reference list only when EVERY one of its words comes
 * from this set and at least one is a core reference word. The two-list shape
 * is what keeps `## Sources of onboarding friction` in the body (`onboarding`
 * is not reference vocabulary) while `## Sources and further reading` is
 * recognised as the reference list it is.
 *
 * The bias is deliberate and one-directional: when in doubt a section stays in
 * the BODY, where the red lines scan it. Mistaking a body section for a
 * reference list would let honest prose be reported as unresolvable
 * references; mistaking a reference list for body prose is the milder error,
 * because the body is the more heavily scanned half.
 */
const REFERENCE_TITLE_WORD =
  /^(?:sources?|references?|citations?|bibliography|bibliographies|works|cited|reading|readings|further|related|additional|more|other|external|see|also|list|notes?|footnotes?|endnotes?|links?|and|the|of|our|a|an)$/;

const REFERENCE_TITLE_CORE =
  /^(?:sources?|references?|citations?|bibliography|bibliographies|cited|reading|readings|footnotes?|endnotes?)$/;

/**
 * Does this heading introduce a reference list?
 *
 * Recognition is SEMANTIC rather than an exact-title set. The exact-set version
 * matched `Sources` and `References` and nothing else, so `## Works Cited`,
 * `## Bibliography`, `## Citations` and `## Sources and further reading` were
 * invisible to the only rule that resolves reference entries — and that rule
 * then reported, in a persisted claim, that the draft listed no source entry.
 * A check whose blind spot is stated as a positive finding is worse than no
 * check at all.
 */
export function isReferenceSectionTitle(heading: string): boolean {
  const words = normalizeHeading(heading)
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return false;
  if (!words.every((word) => REFERENCE_TITLE_WORD.test(word))) return false;
  return words.some((word) => REFERENCE_TITLE_CORE.test(word));
}

export interface ReferenceSection {
  readonly title: string;
  /** Line of the heading that opened the section. */
  readonly headingLine: number;
  /** Every line under the heading, up to the next heading of the same level. */
  readonly lines: readonly DraftLine[];
}

/**
 * The draft split into body prose and reference lists.
 *
 * This is ONE source of truth on purpose. It replaced a pair of independent
 * title lists — one that decided where the body was cut, a shorter one that
 * decided which sections a reference rule re-scanned — whose difference was a
 * region NO rule read: a fabricated bibliography under `## Further Reading`
 * was cut out of the body by the first list and skipped by the second, and the
 * draft passed with three blocking claims asserting it carried no external
 * reference at all.
 *
 * The partition is total: every line of `view.prose` appears exactly once as a
 * body line, a reference-section heading, or a reference-section line. A
 * structural test pins that, so the two halves cannot drift apart again.
 */
export interface DraftPartition {
  readonly body: readonly DraftLine[];
  readonly reference: readonly ReferenceSection[];
}

export function partitionDraft(view: DraftView): DraftPartition {
  const body: DraftLine[] = [];
  const reference: {
    title: string;
    headingLine: number;
    level: number;
    lines: DraftLine[];
  }[] = [];
  let open: (typeof reference)[number] | null = null;

  const headingByLine = new Map(
    view.headings.map((heading) => [heading.line, heading]),
  );

  for (const entry of view.prose) {
    const heading = headingByLine.get(entry.line);
    if (heading) {
      if (open !== null && heading.level <= open.level) open = null;
      if (open === null && isReferenceSectionTitle(heading.text)) {
        open = {
          title: heading.text,
          headingLine: heading.line,
          level: heading.level,
          lines: [],
        };
        reference.push(open);
        continue;
      }
    }
    if (open !== null) {
      open.lines.push(entry);
      continue;
    }
    body.push(entry);
  }

  return {
    body,
    reference: reference.map((section) => ({
      title: section.title,
      headingLine: section.headingLine,
      lines: section.lines,
    })),
  };
}

/** ASCII-class tokenizer. Locale-independent by construction (purity rule 1). */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 0);
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

/** Sentence terminators, with a floor of 1 for any non-empty text. */
export function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const terminators = [...trimmed.matchAll(/[.!?]+(?=\s|$)/g)].length;
  return Math.max(1, terminators);
}

/** The clause preceding an offset, cut at the nearest sentence/clause break. */
export function clauseBefore(text: string, offset: number): string {
  const head = text.slice(0, offset);
  const breaks = [...head.matchAll(/[.!?;:,]/g)];
  const last = breaks[breaks.length - 1];
  return last?.index === undefined ? head : head.slice(last.index + 1);
}

/**
 * A negator that DIRECTLY governs the word it precedes: `no study shows`,
 * `not a single report finds`.
 *
 * The previous rule exempted an assertion whenever ANY of
 * no/not/never/without/lacks/absent/neither/nor/n't/little/few appeared
 * anywhere in the preceding clause. That is a false-negative machine, because
 * those words open a large share of ordinary English sentences and their
 * presence says nothing about whether the assertion that follows needs a
 * source. Two sentences that walked straight through it:
 *
 *   "There is no doubt that research shows onboarding analytics doubles
 *    activation rates by 40%."
 *   "Few operators know that a study by Gartner found a 30 percent lift."
 *
 * Both are fabrications wearing a rhetorical hat. The exemption that remains
 * is the narrow one it was written for — the negator has to be the last thing
 * before the research noun, modulo determiners — so an honest disclaimer
 * ("**No study shows** that switching CMS platforms helps") is still exempt
 * while a negation that merely shares the clause is not.
 */
const DIRECT_NEGATION =
  /\b(?:no|not|never|neither|nor)\s+(?:(?:an?|the|any|one|single|other|such|credible|published|independent|peer[\s-]reviewed|reliable|external|serious)\s+)*$/i;

export function hasDirectNegation(text: string): boolean {
  return DIRECT_NEGATION.test(
    text.replace(/[*_`~]+/g, " ").replace(/\s+/g, " "),
  );
}

export interface CanonicalUrl {
  /** scheme-less, lowercase host + path, no trailing slash, no fragment. */
  readonly url: string;
  readonly domain: string;
}

const URL_LIKE = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[^\s]*)?$/i;

/**
 * Normalize a URL without `new URL()`.
 *
 * The WHATWG parser applies IDNA/punycode conversion, whose behaviour depends
 * on the host's Unicode tables — the same portability hazard as `Intl`. Only
 * ASCII hosts are canonicalized here; anything else is treated as unresolvable,
 * which fails towards a human rather than towards a silent match.
 */
export function canonicalUrl(raw: string): CanonicalUrl | null {
  const trimmed = raw
    .trim()
    .replace(/^[<([]+/, "")
    .replace(/[>)\].,;:!?'"]+$/, "");
  const withoutFragment = trimmed.split("#")[0] ?? "";
  const match = URL_LIKE.exec(withoutFragment);
  if (!match) return null;
  const host = (match[1] ?? "").toLowerCase().replace(/^www\./, "");
  if (host.length === 0) return null;
  const path = (match[2] ?? "").replace(/\/+$/, "");
  return { url: path.length > 0 ? `${host}${path}` : host, domain: host };
}

/** Every scheme-qualified or `www.`-qualified URL on a line. */
export function extractUrls(text: string): readonly string[] {
  return [
    ...stripInlineCode(text).matchAll(/(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi),
  ].map((match) => match[0]);
}

export interface MarkdownLink {
  readonly label: string;
  readonly target: string;
}

export function extractMarkdownLinks(text: string): readonly MarkdownLink[] {
  return [
    ...stripInlineCode(text).matchAll(/\[([^\]\n]*)\]\(([^)\s]+)[^)]*\)/g),
  ].map((match) => ({ label: match[1] ?? "", target: match[2] ?? "" }));
}

/** Collapse a display name to a comparable form (no locale-sensitive casing). */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Truncate by CODE POINT, never by UTF-16 code unit.
 *
 * `String.prototype.slice` cuts between the two halves of a surrogate pair, and
 * an excerpt cut in the middle of an emoji leaves a lone surrogate in the
 * claim detail. `JSON.stringify` happily emits that as `\ud83d`, and Postgres
 * then REJECTS the value: `jsonb` refuses unpaired surrogates, so the gate
 * insert throws and a run that produced a perfectly good verdict dies on the
 * write. Splitting on code points makes the excerpt storable by construction.
 */
export function truncateExcerpt(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const points = [...flat];
  if (points.length <= maxChars) return flat;
  return `${points
    .slice(0, Math.max(0, maxChars - 1))
    .join("")
    .trimEnd()}…`;
}

export interface ParagraphBlock {
  readonly line: number;
  readonly text: string;
  readonly kind: "prose" | "list" | "table" | "quote";
}

/** Group masked prose lines into blocks separated by blank lines. */
export function paragraphBlocks(
  lines: readonly DraftLine[],
): readonly ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];
  let buffer: DraftLine[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const first = buffer[0];
    if (first) {
      const text = buffer
        .map((entry) => entry.text)
        .join(" ")
        .trim();
      if (text.length > 0) {
        blocks.push({ line: first.line, text, kind: blockKind(first.text) });
      }
    }
    buffer = [];
  };

  for (const entry of lines) {
    if (entry.text.trim().length === 0 || isHeadingLine(entry.text)) {
      flush();
      continue;
    }
    if (isListItem(entry.text) || isTableRow(entry.text)) {
      flush();
      blocks.push({
        line: entry.line,
        text: entry.text.trim(),
        kind: blockKind(entry.text),
      });
      continue;
    }
    buffer.push(entry);
  }
  flush();
  return blocks;
}

function blockKind(text: string): ParagraphBlock["kind"] {
  if (isTableRow(text)) return "table";
  if (isListItem(text)) return "list";
  if (isBlockquote(text)) return "quote";
  return "prose";
}

/** `en`, `en-US`, `EN-gb` — anything else is not the English fast path. */
export function isEnglishLocale(locale: string): boolean {
  return /^en(-|$)/i.test(locale.trim());
}
