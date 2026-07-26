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

import { citationEntry, stripEmphasis } from "./names.ts";

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
 * A frontmatter body line: a `key:` entry, an entry continuation, a YAML list
 * item, or a blank. Anything else means the block between two `---` fences is
 * not frontmatter.
 */
const FRONTMATTER_ENTRY = /^[A-Za-z_][\w.-]*\s*:(?:\s|$)/;
const FRONTMATTER_FILLER = /^(?:\s+\S|-\s+\S|\s*$)/;

/**
 * Index of the line that CLOSES a leading frontmatter block, or `-1` when the
 * draft has none.
 *
 * Two shapes have already reached this function, and BOTH of them masked real
 * content:
 *
 * 1. A first line of `---` with no closing delimiter at all. The streaming
 *    version opened the mask and never closed it, so the whole draft was
 *    blanked and every language rule reported "we found nothing wrong" over an
 *    empty document.
 * 2. A first line of `---` used as a thematic break, with a SECOND `---`
 *    further down used as another thematic break. Taking "the next `---`" as
 *    the closing delimiter masked the entire first content block, and the two
 *    fabricated attributions inside it were never scanned.
 *
 * Both come from the same mistake: treating the delimiter as sufficient
 * evidence that the region between the delimiters is metadata. The region has
 * to LOOK like frontmatter as well, so this refuses to mask anything that is
 * not a run of `key: value` entries. A leading thematic break is perfectly
 * ordinary LLM output and `draftMarkdown` is raw model text, so both shapes
 * WILL be handed to us.
 *
 * The bias is the one the gate needs: when this returns `-1` the candidate
 * block stays in the body, where every rule scans it. Content is never removed
 * from the judgement on a guess — it is either metadata by shape, or it is
 * checked.
 */
function frontmatterEndIndex(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  let entries = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    // A run of `key: value` lines closed by `---` is frontmatter; a delimiter
    // reached with no entry at all is two thematic breaks around body content.
    if (text.trim() === "---") return entries > 0 ? index : -1;
    if (FRONTMATTER_ENTRY.test(text)) {
      entries += 1;
      continue;
    }
    if (FRONTMATTER_FILLER.test(text)) continue;
    return -1;
  }
  return -1;
}

/**
 * A setext underline: `===` (H1) or `---` (H2) directly under a one-line
 * paragraph. CommonMark renders that paragraph as a heading, and a model
 * writing `Sources` over `-------` has written `## Sources` — but the ATX-only
 * reader saw a paragraph, so the fabricated bibliography under it stayed
 * invisible to the only rule that resolves reference entries.
 */
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;

/** Can this line be the TITLE of a setext heading? */
function isSetextTitle(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (HEADING.test(text)) return false;
  if (LIST_ITEM.test(text)) return false;
  if (TABLE_ROW.test(text)) return false;
  if (BLOCKQUOTE.test(text)) return false;
  return !SETEXT_UNDERLINE.test(text);
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

    // A setext heading is REWRITTEN into its ATX equivalent in place rather
    // than recorded only in `headings`: every downstream consumer asks
    // `isHeadingLine`, and a heading that answers `false` there would be a
    // section boundary for the partition and ordinary prose for everything
    // else. The line NUMBER is untouched, so excerpts still point at the draft.
    const underline = SETEXT_UNDERLINE.exec(text);
    const title = prose[prose.length - 1];
    const beforeTitle = prose[prose.length - 2];
    if (
      underline &&
      title !== undefined &&
      isSetextTitle(title.text) &&
      // Only a ONE-LINE paragraph. A multi-line paragraph under an underline is
      // a heading in CommonMark too, but converting it would move a whole
      // paragraph of prose out of the body, and this reader never trades scanned
      // content for a guess.
      (beforeTitle === undefined ||
        beforeTitle.text.trim().length === 0 ||
        HEADING.test(beforeTitle.text))
    ) {
      const level = underline[1]?.startsWith("=") ? 1 : 2;
      const titleText = title.text.trim();
      prose[prose.length - 1] = {
        line: title.line,
        text: `${"#".repeat(level)} ${titleText}`,
      };
      headings.push({ line: title.line, level, text: titleText });
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

/**
 * Punctuation a heading carries for typography, never for meaning.
 *
 * `## Sources:` and `## Sources：` are the same heading as `## Sources`, and
 * `## References (external)` is the same heading as `## References external`.
 * Leaving the punctuation attached made each of those a DIFFERENT title to
 * every matcher in the gate — which is how a fabricated bibliography under
 * `## Sources:` was never recognised as a reference list. The class is written
 * out as explicit code points rather than a Unicode property escape, because
 * property escapes track the host's Unicode tables and this file may not depend
 * on the host (purity rule 1).
 */
const HEADING_PUNCTUATION =
  /[.,;:!?()[\]{}<>|"'‘’“”«»…、。「」『』！（），：；？]/g;

/** Heading text normalized for matching a section title. */
export function normalizeHeading(text: string): string {
  return text
    .replace(/[#*_`]/g, " ")
    .replace(HEADING_PUNCTUATION, " ")
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

/**
 * The two STANDARDS a reference heading can set, split apart.
 *
 * They used to be one list, and mixing them is what made three headings that
 * mean the same thing to a reader behave three different ways. `## Further
 * reading`, `## See Also` and `## Related links` listing the customer's OWN
 * pages came back blocked, blocked and passed — and the blocked ones carried
 * the gate's strongest verdict, with a detail calling a B2B post's internal
 * navigation an unresolvable source at authority D. That is the
 * false-accusation failure, arriving through heading recognition instead of
 * through a citation cue.
 *
 * - **evidence** (`sources`, `references`, `citations`, `bibliography`, `works
 *   cited`, `footnotes`): the heading says outside sources stand behind the
 *   draft. Its entries must resolve to evidence, and the customer's own web
 *   identity is never evidence. Unchanged strictness.
 * - **locator** (`further reading`, `see also`): the heading says "more pages to
 *   go to". Its entries are ADDRESSES, so the customer's own address is a
 *   complete answer to one — exactly the locator/evidence split RL12 already
 *   makes for a bare URL in prose.
 *
 * The section standard sets the DEFAULT role of its entries; an entry may still
 * override it upward on its own shape (a bibliographic citation written under a
 * navigation heading is still a citation), never downward.
 */
export type ReferenceStandard = "evidence" | "locator";

const REFERENCE_TITLE_CORE_EVIDENCE =
  /^(?:sources?|references?|citations?|bibliography|bibliographies|cited|footnotes?|endnotes?)$/;

const REFERENCE_TITLE_CORE_LOCATOR = /^(?:reading|readings|see)$/;

/**
 * Reference-list headings that are not ASCII words.
 *
 * `outputLocale` is part of the frozen pack and may be any locale, and the
 * partition runs for every locale (SC9b carries no English guard — it resolves
 * identities, not language). A `## 参考文献` list of fabricated references was
 * therefore invisible for exactly the same reason `## Works Cited` once was.
 * These count as both vocabulary and core word: each is a whole heading on its
 * own, not a word that combines. They carry the same evidence/locator split as
 * their English counterparts — `延伸阅读` IS `further reading`.
 */
const REFERENCE_TITLE_CORE_NON_ASCII_EVIDENCE =
  /^(?:参考文献|參考文獻|参考资料|参考資料|參考資料|资料来源|資料來源|引用文献|引用文獻|参考|參考|出典|出处|出處)$/;

const REFERENCE_TITLE_CORE_NON_ASCII_LOCATOR = /^(?:延伸阅读|延伸閱讀)$/;

function isReferenceTitleWord(word: string): boolean {
  return (
    REFERENCE_TITLE_WORD.test(word) ||
    REFERENCE_TITLE_CORE_NON_ASCII_EVIDENCE.test(word) ||
    REFERENCE_TITLE_CORE_NON_ASCII_LOCATOR.test(word)
  );
}

function isEvidenceTitleCore(word: string): boolean {
  return (
    REFERENCE_TITLE_CORE_EVIDENCE.test(word) ||
    REFERENCE_TITLE_CORE_NON_ASCII_EVIDENCE.test(word)
  );
}

function isLocatorTitleCore(word: string): boolean {
  return (
    REFERENCE_TITLE_CORE_LOCATOR.test(word) ||
    REFERENCE_TITLE_CORE_NON_ASCII_LOCATOR.test(word)
  );
}

/**
 * Which standard a heading sets, or `null` when it is not a reference list.
 *
 * Evidence wins a tie: `## Sources and further reading` promises sources, and
 * the weaker word next to it does not withdraw the promise.
 */
export function referenceSectionStandard(
  heading: string,
): ReferenceStandard | null {
  const words = normalizeHeading(heading)
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  if (!words.every(isReferenceTitleWord)) return null;
  if (words.some(isEvidenceTitleCore)) return "evidence";
  return words.some(isLocatorTitleCore) ? "locator" : null;
}

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
 *
 * The every-word rule is KEPT rather than relaxed to "contains a core word".
 * Relaxing it would pull `## Sources of onboarding friction` and `## Related
 * links` — a B2B post's own pages — out of the body and report each of them as
 * an unresolvable reference, which is the false-accusation failure the previous
 * rework had to repair. What makes the conservative bias safe is no longer the
 * bias itself but the BACKSTOP: a bibliographic entry left in the body by an
 * unrecognised heading is caught by RL12's reference-entry shape, so a miss
 * here costs a differently-worded block, not a silent pass.
 */
export function isReferenceSectionTitle(heading: string): boolean {
  return referenceSectionStandard(heading) !== null;
}

/**
 * A line that is nothing but bold text: `**Sources**`.
 *
 * Models write this instead of a `##` heading often enough that a fabricated
 * bibliography under one passed the gate with `partitionDraft().reference`
 * empty. It is recognised ONLY when the bold text is a reference-list title, so
 * `**Onboarding analytics** is the practice of …` — and every other bold span
 * SC1 looks for — is untouched.
 */
const BOLD_ONLY_LINE = /^\s{0,3}(?:\*\*|__)\s*([^*_\n]+?)\s*(?:\*\*|__)\s*$/;

export function referencePseudoHeading(text: string): string | null {
  const match = BOLD_ONLY_LINE.exec(text);
  const title = match?.[1]?.trim();
  if (title === undefined || title.length === 0) return null;
  return isReferenceSectionTitle(title) ? title : null;
}

export interface ReferenceSection {
  readonly title: string;
  /** What the heading promises about its entries. */
  readonly standard: ReferenceStandard;
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

const PSEUDO_HEADING_LEVEL = 7;

const FOOTNOTE_DEFINITION_LINE = /^\s{0,3}\[\^[^\]\s]+\]:/;
const HTML_LIST_LINE = /<(?:li|dd|dt|ul|ol|dl)\b/i;

/**
 * Does the region under a reference heading actually PRESENT as a list of
 * entries?
 *
 * The heading text had a guard; what followed it had none. So a bold pseudo
 * heading — `**Further reading**`, which models write constantly — claimed the
 * next two paragraphs of ordinary prose, and SC9b read every non-empty line
 * under it as a reference entry: two perfectly honest sentences were reported
 * as unresolvable references at authority D. A heading only names a region; it
 * cannot make the region be what it says.
 *
 * The test is the same one the entry predicate uses, so it does not add a second
 * vocabulary that can drift from the first: entry FORM (a list item, a table
 * row, a blockquote, a footnote definition, an HTML list element), an ADDRESS,
 * or a line that reads as a name rather than as a sentence. A region with none
 * of those stays in the body, where the red lines scan it — the conservative
 * direction this reader always fails in.
 */
function presentsAsEntryList(lines: readonly DraftLine[]): boolean {
  for (const entry of lines) {
    const text = entry.text.trim();
    if (text.length === 0) continue;
    if (
      isListItem(text) ||
      isTableRow(text) ||
      isBlockquote(text) ||
      FOOTNOTE_DEFINITION_LINE.test(entry.text) ||
      HTML_LIST_LINE.test(text)
    ) {
      return true;
    }
    if (extractUrls(text).length > 0) return true;
    if (extractMarkdownLinks(text).length > 0) return true;
    if (citationEntry(stripInlineCode(text)) !== null) return true;
  }
  return false;
}

interface OpenSection {
  title: string;
  standard: ReferenceStandard;
  headingLine: number;
  headingText: string;
  level: number;
  lines: DraftLine[];
}

export function partitionDraft(view: DraftView): DraftPartition {
  const segments: (
    | { readonly kind: "body"; readonly line: DraftLine }
    | { readonly kind: "reference"; readonly section: OpenSection }
  )[] = [];
  let open: OpenSection | null = null;

  const headingByLine = new Map(
    view.headings.map((heading) => [heading.line, heading]),
  );

  for (const entry of view.prose) {
    const heading = headingByLine.get(entry.line);
    if (heading) {
      if (open !== null && heading.level <= open.level) open = null;
      const standard =
        open === null ? referenceSectionStandard(heading.text) : null;
      if (standard !== null) {
        const section: OpenSection = {
          title: heading.text,
          standard,
          headingLine: heading.line,
          headingText: entry.text,
          level: heading.level,
          lines: [],
        };
        open = section;
        segments.push({ kind: "reference", section });
        continue;
      }
    }
    // A bold line standing in for a heading. Level 7 is below every real
    // heading, so the next `#` of ANY depth closes the section — a pseudo
    // heading may not swallow the rest of the document.
    const pseudoTitle =
      heading === undefined ? referencePseudoHeading(entry.text) : null;
    const pseudoStandard =
      pseudoTitle === null ? null : referenceSectionStandard(pseudoTitle);
    if (pseudoTitle !== null && pseudoStandard !== null) {
      const section: OpenSection = {
        title: pseudoTitle,
        standard: pseudoStandard,
        headingLine: entry.line,
        headingText: entry.text,
        level: PSEUDO_HEADING_LEVEL,
        lines: [],
      };
      open = section;
      segments.push({ kind: "reference", section });
      continue;
    }
    if (open !== null) {
      open.lines.push(entry);
      continue;
    }
    segments.push({ kind: "body", line: entry });
  }

  // Second pass: a heading that named a region which is not a list of entries
  // never claimed it. Rebuilding from segments rather than deciding inline is
  // what keeps the partition TOTAL — every prose line lands in exactly one half
  // whichever way the decision goes.
  const body: DraftLine[] = [];
  const reference: ReferenceSection[] = [];
  for (const segment of segments) {
    if (segment.kind === "body") {
      body.push(segment.line);
      continue;
    }
    const section = segment.section;
    if (!presentsAsEntryList(section.lines)) {
      body.push({ line: section.headingLine, text: section.headingText });
      body.push(...section.lines);
      continue;
    }
    reference.push({
      title: section.title,
      standard: section.standard,
      headingLine: section.headingLine,
      lines: section.lines,
    });
  }
  return { body, reference };
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
  return flattenLine(text).links.map((link) => ({
    label: link.label,
    target: link.target,
  }));
}

const INLINE_CODE = /`[^`]*`/g;
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi;

interface ScannedLink {
  readonly start: number;
  /** Exclusive, past the closing `)`. */
  readonly end: number;
  readonly label: string;
  readonly target: string;
}

/**
 * CommonMark inline links, SCANNED rather than pattern-matched.
 *
 * The regex this replaced was `\[([^\]\n]*)\]\(...\)` — a link label that may
 * not contain a bracket. CommonMark allows balanced brackets in a label, and
 * models write them: `[Forrester [Inc]](url)` and `[the 2024 benchmark
 * [PDF]](url)` render as ordinary links. Failing to parse them did not merely
 * lose the link; it put the raw URL back into the sentence text, where it was
 * harvested as a bare URL and classified as a LOCATOR — so the same sentence
 * that was blocked with the link parsed came back `passed` with one extra pair
 * of brackets, because a first-party address answers a locator. RL12b could not
 * see the link at all.
 *
 * A scan also cannot backtrack, which is the property the rest of this file
 * needs (see `names.ts` on the quadratic name-run regex).
 */
function scanMarkdownLinks(source: string): readonly ScannedLink[] {
  const links: ScannedLink[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char !== "[") {
      index += 1;
      continue;
    }
    let depth = 1;
    let cursor = index + 1;
    while (cursor < source.length && depth > 0) {
      const current = source[cursor];
      if (current === "\\") {
        cursor += 2;
        continue;
      }
      if (current === "\n") break;
      if (current === "[") depth += 1;
      else if (current === "]") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0 || source[cursor] !== "(") {
      index += 1;
      continue;
    }
    const labelEnd = cursor - 1;
    let parens = 1;
    let close = cursor + 1;
    while (close < source.length && parens > 0) {
      const current = source[close];
      if (current === "\\") {
        close += 2;
        continue;
      }
      if (current === "\n") break;
      if (current === "(") parens += 1;
      else if (current === ")") parens -= 1;
      if (parens === 0) break;
      close += 1;
    }
    if (parens !== 0) {
      index += 1;
      continue;
    }
    const destination = source.slice(cursor + 1, close).trim();
    const target = (destination.split(/\s+/)[0] ?? "").replace(/^<|>$/g, "");
    if (target.length === 0) {
      index += 1;
      continue;
    }
    links.push({
      start: index,
      end: close + 1,
      label: source.slice(index + 1, labelEnd),
      target,
    });
    index = close + 1;
  }
  return links;
}

export interface FlatSpan {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

export interface FlatLink extends FlatSpan {
  readonly label: string;
  readonly target: string;
}

export interface FlatUrl extends FlatSpan {
  readonly value: string;
}

/**
 * One line, flattened so that WHERE a token sits is answerable.
 *
 * Two defects came from asking "what appears anywhere on this line?" instead:
 *
 * 1. A bare domain literal was harvested out of ANOTHER url's query string, so
 *    `https://attacker.test/?u=https://signalframe.example/` handed a sentence
 *    the customer's own domain as an attribution and the sentence read as
 *    supported. Here a url occupies a SPAN, and nothing is extracted from
 *    inside it.
 * 2. `[Forrester](https://analyst.example/x) reports that 73% …` matched no
 *    assertion pattern at all, because the name it attributes to was wrapped in
 *    link syntax. Here a link is replaced by its LABEL, so the sentence reads
 *    exactly as a reader reads it, and the target stays recoverable through the
 *    label's span.
 *
 * Inline code is blanked first, so a `\`research shows\`` sample is still not a
 * claim. The result is a NEW string with its own offsets; nothing here reports
 * a position back into the raw draft, and line numbers are untouched.
 */
export interface FlatLine {
  readonly text: string;
  /** Spans in `text`, each covering the link's label. */
  readonly links: readonly FlatLink[];
  /** Bare urls in `text`. A link's target is never one of these. */
  readonly urls: readonly FlatUrl[];
}

/** A trailing run of emphasis closers, which is markup even against a url. */
const EMPHASIS_TAIL = /[*~_]+$/;

/**
 * The url spans that emphasis stripping must not touch.
 *
 * A CLOSING run at the very end is excluded, so `**https://example.com/a**` and
 * `~~https://example.com/a~~` still flatten to the address a reader sees. The
 * interior is protected: everything else on the line is prose, and only inside
 * an address are `_` and `~` characters rather than typography.
 */
function protectedUrlSpans(source: string): readonly FlatSpan[] {
  const spans: FlatSpan[] = [];
  for (const match of source.matchAll(URL_IN_TEXT)) {
    if (match.index === undefined) continue;
    const address = match[0].replace(EMPHASIS_TAIL, "");
    if (address.length === 0) continue;
    spans.push({ start: match.index, end: match.index + address.length });
  }
  return spans;
}

/**
 * Strip emphasis from the prose of a line and from NOTHING inside a url.
 *
 * `stripEmphasis` removes `~` everywhere and `_` at token boundaries, which is
 * correct for prose and wrong for an address: `https://signalframe.example/
 * ~guides/a` reached the resolver as `.../guides/a`, so the same url on the
 * same line had two different values depending on which extractor read it —
 * `extractUrls` reads the raw line, `flattenLine` read the emphasis-stripped
 * one. Two extractors disagreeing about one address is enough on its own; the
 * sharp edge is that deletion can FORGE a host, and `https://signal~frame.
 * example/x` — a domain that is not the customer's — flattened to
 * `signalframe.example` and resolved as the customer's own property.
 *
 * This does not widen what is read out of a url: `locatedAttributions` still
 * extracts nothing from the inside of one. It only stops the flattener from
 * rewriting the address it then hands to the resolver.
 */
function stripEmphasisOutsideUrls(source: string): string {
  let flattened = "";
  let cursor = 0;
  for (const span of protectedUrlSpans(source)) {
    flattened += stripEmphasis(source.slice(cursor, span.start));
    flattened += source.slice(span.start, span.end);
    cursor = span.end;
  }
  return flattened + stripEmphasis(source.slice(cursor));
}

export function flattenLine(raw: string): FlatLine {
  // Emphasis is typography, so it is removed before anything reads the line:
  // `Forrester's **2024** data puts churn at 42%` has to be the same sentence
  // as `Forrester's 2024 data puts churn at 42%`, and it was not — the second
  // was blocked and the first passed. Inside a url it is not typography, so
  // `stripEmphasisOutsideUrls` leaves addresses byte-identical to the raw line.
  const source = stripEmphasisOutsideUrls(raw.replace(INLINE_CODE, " "));
  const links: FlatLink[] = [];
  let text = "";
  let cursor = 0;
  for (const link of scanMarkdownLinks(source)) {
    text += source.slice(cursor, link.start);
    links.push({
      start: text.length,
      end: text.length + link.label.length,
      label: link.label,
      target: link.target,
    });
    text += link.label;
    cursor = link.end;
  }
  text += source.slice(cursor);

  const urls: FlatUrl[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    if (match.index === undefined) continue;
    urls.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
    });
  }
  return { text, links, urls };
}

/** Is `inner` wholly inside `outer`? */
export function spanWithin(inner: FlatSpan, outer: FlatSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** Do the two spans share at least one character? */
export function spansOverlap(left: FlatSpan, right: FlatSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * The span of the sentence containing `offset`.
 *
 * Locality is the weaker half of "an assertion is supported by the source it
 * attributes to": when an assertion names no attribution at all, the sentence
 * is the widest region a reader would read as belonging to it. A url two
 * sentences away is not that assertion's source.
 */
export function sentenceSpanAt(text: string, offset: number): FlatSpan {
  let start = 0;
  for (const match of text.matchAll(/[.!?]+(?=\s|$)/g)) {
    if (match.index === undefined) continue;
    const boundary = match.index + match[0].length;
    if (boundary <= offset) start = boundary;
    else return { start, end: boundary };
  }
  return { start, end: text.length };
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
  /**
   * How many source lines this block was joined from.
   *
   * A reference entry occupies ONE line; a paragraph of prose usually does not.
   * That is the only thing separating a bare bibliography entry written without
   * a list marker from the running text around it, so the count is carried
   * rather than recomputed by whoever needs it.
   */
  readonly lines: number;
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
        blocks.push({
          line: first.line,
          text,
          kind: blockKind(first.text),
          lines: buffer.length,
        });
      }
    }
    buffer = [];
  };

  for (const entry of lines) {
    if (entry.text.trim().length === 0 || isHeadingLine(entry.text)) {
      flush();
      continue;
    }
    if (
      isListItem(entry.text) ||
      isTableRow(entry.text) ||
      isMarkupItem(entry.text)
    ) {
      flush();
      blocks.push({
        line: entry.line,
        text: entry.text.trim(),
        kind: blockKind(entry.text),
        lines: 1,
      });
      continue;
    }
    buffer.push(entry);
  }
  flush();
  return blocks;
}

/**
 * A line that is a LIST in a markup a reader sees but `-`/`*` does not cover: a
 * definition-list term line (`: 2024 analyst report`) and any HTML list markup a
 * model emits (`<ul>`, `<li>…</li>`).
 *
 * They are separated into their own blocks for the same reason list items are:
 * joined into the surrounding paragraph, an entry stops occupying an entry
 * position, and the bibliography written in either markup walked past the whole
 * gate. This is markdown/HTML syntax, not a vocabulary of citation forms.
 */
const MARKUP_ITEM =
  /^\s{0,3}(?::\s+\S|<\/?(?:ul|ol|li|dl|dt|dd|table|tr|td|th|p)\b)/i;

function isMarkupItem(text: string): boolean {
  return MARKUP_ITEM.test(text);
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
