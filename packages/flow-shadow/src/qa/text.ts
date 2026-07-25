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

/** Parse a draft once: masked prose lines plus the heading spine. */
export function readDraft(markdown: string): DraftView {
  const lines = markdown.split("\n");
  const prose: DraftLine[] = [];
  const headings: DraftHeading[] = [];
  let inFence = false;
  let frontmatterState: "none" | "open" | "closed" =
    lines[0]?.trim() === "---" ? "open" : "none";

  for (const [index, text] of lines.entries()) {
    const lineNumber = index + 1;
    if (frontmatterState === "open") {
      if (index > 0 && text.trim() === "---") frontmatterState = "closed";
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
    const next = view.headings.find((candidate) => candidate.line === entry.line);
    if (next && next.level <= heading.level) break;
    body.push(entry);
  }
  return body;
}

/**
 * Prose lines that come before the first tail section (`Sources`, `References`,
 * `Related Reading`). A reference list is not prose, and scanning it for
 * unsupported assertions would double-report every citation.
 */
export function bodyBefore(
  view: DraftView,
  titles: readonly string[],
): readonly DraftLine[] {
  const wanted = new Set(titles.map((title) => title.toLowerCase()));
  const cut = view.headings.find((candidate) =>
    wanted.has(normalizeHeading(candidate.text)),
  );
  const limit = cut ? cut.line : Number.POSITIVE_INFINITY;
  return view.prose.filter((entry) => entry.line < limit);
}

export const TAIL_SECTION_TITLES: readonly string[] = [
  "sources",
  "references",
  "related reading",
  "further reading",
];

export const SOURCES_SECTION_TITLES: readonly string[] = [
  "sources",
  "references",
];

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

const NEGATION =
  /\b(no|not|never|without|lacks?|lacking|absent|neither|nor|n't|little|few)\b/i;

export function hasNegationCue(text: string): boolean {
  return NEGATION.test(text);
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

export function truncateExcerpt(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
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
      const text = buffer.map((entry) => entry.text).join(" ").trim();
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
