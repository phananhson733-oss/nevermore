// @input -- one already validated section body and the server-built evidence scope it was written from
// @output -- one bounded prose rejection naming a server-built path, and the advisory writing warnings
// @pos -- Draft v2 prose gate; runs only at generation, never when parsing a stored draft
import { DRAFT_V2_QUALITY_MAX } from "./constants.ts";
import type { DraftV2SectionScope } from "./v2-draft-scope.ts";
import type { DraftV2SectionBody, DraftV2SectionEvidence } from "./v2-draft-section.ts";
import type { ConfirmedBriefV2 } from "./v2-generation-contract.ts";

/** The closed set of prose rules a repair call is allowed to be told it broke. */
export type DraftV2ProseRule = "number_without_source" | "chat_residue";

export interface DraftV2ProseRejection {
  readonly rule: DraftV2ProseRule;
  /** Built here from paragraph and sentence indices, never from anything the model wrote. */
  readonly path: string;
}

/**
 * A written number and whether it was written as a proportion.
 *
 * The first branch is the only place a comma is a thousands separator: a group
 * of one to three digits followed by groups of exactly three. Reading commas
 * greedily instead would fuse "samples 10,20" into 1020 and reject a sentence
 * whose source says 10 and 20.
 *
 * The proportion suffix is part of the number's identity, not decoration. "5%"
 * and "5" are different claims, and a source that counts five failures does not
 * support a sentence reporting a five percent failure rate. The word is
 * accepted alongside the sign so the two spellings are one number.
 *
 * Two forms are deliberately outside this: a sign, because "10-12" would then
 * read as ten and minus twelve and reject prose its source supports, and a
 * space as a thousands separator, which English does not use.
 */
const NUMBER = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s?(%|percent\b|per cent\b)?/giu;

/**
 * Any Unicode decimal digit as its ASCII counterpart.
 *
 * NFKC folds the fullwidth digits but not the Arabic-Indic, Devanagari or Thai
 * ones, so a figure written in those scripts would otherwise match nothing and
 * pass the rule unchecked. Every Unicode decimal-digit set is ten contiguous
 * code points beginning at its own zero, so walking back to the first code
 * point that is no longer a digit finds that zero and the offset is the value.
 */
function asciiDigit(char: string): string {
  const code = char.codePointAt(0)!;
  for (let zero = code; zero > code - 10; zero -= 1) {
    if (!/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) return String(code - zero);
  }
  return char;
}

interface WrittenNumber {
  readonly value: string;
  /**
   * Whether a missing source for this number is worth failing a section over.
   *
   * A lone digit is a step count, an ordinal or a list length far more often
   * than it is a statistic, and the price of a wrong rejection here is the
   * whole section: two attempts is the budget, so a rule that misfires
   * systematically deletes the prose rather than repairing it. Two or more
   * digits, or any number written as a percentage, is a measurement.
   */
  readonly checked: boolean;
}

function writtenNumbers(text: string): readonly WrittenNumber[] {
  const folded = text.normalize("NFKC").replace(/\p{Nd}/gu, asciiDigit);
  return [...folded.matchAll(NUMBER)].map((match) => {
    const written = match[1]!;
    const proportion = match[2] !== undefined;
    // Compared as a quantity, not as a spelling: "1,200", "1200" and "1200.0"
    // are one figure, and so are ".5" and "0.5". Both sides of every comparison
    // go through this, so a loss of precision on an absurd figure still matches
    // itself.
    const value = String(Number(written.replace(/,/gu, "")));
    return { value: proportion ? `${value}%` : value, checked: written.replace(/\D/gu, "").length >= 2 || proportion };
  });
}

function numbersOf(texts: Iterable<string>): ReadonlySet<string> {
  const values = new Set<string>();
  for (const text of texts) for (const number of writtenNumbers(text)) values.add(number.value);
  return values;
}

/**
 * Openings and asides that belong to a chat reply rather than to an article.
 *
 * Deliberately short. Every entry here is a rejection, so a phrase that a
 * competent writer might reach for on purpose ("Certainly, the report shows")
 * does not belong in it however much it smells; those live in the advisory
 * warnings instead. Sentence text reaches this list already whitespace
 * normalized and trimmed, so the anchored patterns see the real first word.
 */
/** Typographic apostrophes fold to the plain one so one spelling of each pattern is enough. */
function flatten(text: string): string {
  return text.normalize("NFKC").replace(/[\u2018\u2019\u02BC]/gu, "'");
}

const CHAT_RESIDUE: readonly RegExp[] = [
  /\bas an ai\b/iu,
  /\bas a language model\b/iu,
  /\bi hope (?:this|that) helps\b/iu,
  /\blet me know if\b/iu,
  /\b(?:as requested|per your request)\b/iu,
  // "Sure" only as the chat acknowledgement, punctuation and all: "Sure footing
  // requires checking the window" and "Sure enough, the report arrived" are
  // prose, and a rejection they repeat costs the whole section.
  /^sure\s*[,!]/iu,
  /^(?:great question|good question|happy to help)\b/iu,
  /^here(?:'s| is| are) (?:the|a|an|your) (?:rewritten|revised|updated|requested|corrected|expanded|section|draft|article|response|answer|breakdown|overview|summary)\b/iu,
  /^#{1,6}\s/u,
  /```/u,
];

/**
 * The prose rules that are worth another call, checked in sentence order.
 *
 * Kept out of `validateDraftV2Section` on purpose. That validator also parses
 * stored deliveries, and a draft written before a rule existed must keep
 * parsing: a tightening there would fail a rerun of prose the owner already
 * has on screen. These run at generation only, where the answer is a repair
 * call rather than a dead draft.
 */
export function checkDraftV2Prose(body: DraftV2SectionBody, scope: DraftV2SectionScope, confirmed: ConfirmedBriefV2): DraftV2ProseRejection | null {
  // The brief's own text counts as supplied everywhere. The rule is about
  // invention, not about which supplied place a figure came from: a keyword,
  // a confirmed heading, a question or a plan step that says "10 tools" makes
  // "10" a number this draft was handed, and rejecting the writer for repeating
  // it would be the rule misfiring on the operator's own words.
  const supplied = numbersOf([
    confirmed.brief.context.input.primary, ...confirmed.brief.context.input.supporting,
    ...(confirmed.title === undefined ? [] : [confirmed.title]),
    scope.section.h2, ...scope.section.h3,
    ...scope.questions.map((question) => question.q),
    ...scope.steps.map((step) => step.instruction),
    ...(scope.gap_angle === null ? [] : [scope.gap_angle.value]),
  ]);
  const everything = numbersOf([
    ...[...scope.page_units.values()].map((unit) => unit.text),
    ...[...scope.facts.values()].map((fact) => fact.text),
  ]);
  for (const [pIndex, paragraph] of body.paragraphs.entries()) {
    for (const [sIndex, sentence] of paragraph.sentences.entries()) {
      const path = `paragraphs[${pIndex}].sentences[${sIndex}].text`;
      if (CHAT_RESIDUE.some((pattern) => pattern.test(flatten(sentence.text)))) return { rule: "chat_residue", path };
      // A sentence that cites evidence is traced to exactly what it cited. One
      // that cites none has nothing to trace to, so the tightest bar left is
      // this section's own evidence -- which also closes the obvious way past
      // the rule, relabelling a fabricated measurement as no_claim.
      const allowed = sentence.evidence_refs.length === 0 ? everything : numbersOf([
        ...sentence.evidence_refs.map((ref) => scope.page_units.get(ref)?.text ?? scope.facts.get(ref)?.text ?? ""),
      ]);
      for (const number of writtenNumbers(sentence.text)) {
        if (number.checked && !allowed.has(number.value) && !supplied.has(number.value)) return { rule: "number_without_source", path };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Writing warnings                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a reader is told to look at, never what the tool refuses to deliver.
 *
 * These are advisory on purpose. Each one is a recognizable pattern, not a
 * judgement: paragraph_too_long counts sentences, filler_phrase matches a list
 * of phrases known to read as padding, and the two reuse codes report a shared
 * run of words. None of them measures whether the prose is good.
 */
export type DraftV2WarningCode = "paragraph_too_long" | "filler_phrase" | "source_phrase_reused" | "repeated_across_sections";

export interface DraftV2QualityLocation {
  readonly section_id: string;
  readonly paragraph: number;
  /** null when the warning is about the whole paragraph rather than one sentence. */
  readonly sentence: number | null;
}

export interface DraftV2Warning {
  readonly code: DraftV2WarningCode;
  readonly at: DraftV2QualityLocation;
  /** The other place involved when the warning is about two of them; null otherwise. */
  readonly other: DraftV2QualityLocation | null;
}

export interface DraftV2ProseSection {
  readonly id: string;
  readonly body: DraftV2SectionBody;
  readonly evidence: DraftV2SectionEvidence;
}

/** Long enough that two texts sharing one are not sharing it by coincidence. */
const PHRASE_RUN_WORDS = 8;
/** The prompt asks for paragraphs of roughly two to four sentences. */
const PARAGRAPH_SENTENCES_MAX = 4;

/** Phrasing that reads as padding often enough to be worth a second look. */
const FILLER: readonly RegExp[] = [
  /\bit(?:'s| is) (?:important|worth) (?:to note|noting|mentioning)\b/iu,
  /\bin today's (?:digital )?(?:world|landscape|age|market|environment)\b/iu,
  /\bplays? an? (?:crucial|vital|key|important|significant|pivotal) role\b/iu,
  /\bwhen it comes to\b/iu,
  /\bat the end of the day\b/iu,
  /\ba game[- ]chang(?:er|ing)\b/iu,
  /\bin conclusion\b/iu,
  /\bthe (?:ever[- ]changing|fast[- ]paced) world of\b/iu,
  /\bunlock the (?:power|potential)\b/iu,
  /\bdelve into\b/iu,
  /\bin the realm of\b/iu,
  /\btake your [\p{L}]+ to the next level\b/iu,
  /\bthere are (?:many|several|a number of) (?:factors|things|reasons|ways|benefits)\b/iu,
];

/**
 * Every run of PHRASE_RUN_WORDS tokens in a text, where a token is a run of
 * letters or digits and everything else is a separator.
 *
 * That is a word for scripts that space their words, Korean included, and a
 * whole clause for an unbroken Chinese, Japanese or Thai one -- which then
 * yields too few tokens to form a run, and the two reuse warnings stay quiet.
 * They are not quiet for those scripts in general: a punctuation-separated list
 * still produces one token per item. Counting characters instead would flag
 * ordinary shared vocabulary as copying, so this limitation is the price of not
 * being wrong in the other direction.
 */
function phraseRuns(text: string): ReadonlySet<string> {
  const words = flatten(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  const runs = new Set<string>();
  for (let index = 0; index + PHRASE_RUN_WORDS <= words.length; index += 1) {
    runs.add(words.slice(index, index + PHRASE_RUN_WORDS).join(" "));
  }
  return runs;
}

function sourceRuns(evidence: DraftV2SectionEvidence): ReadonlySet<string> {
  const runs = new Set<string>();
  for (const unit of evidence.page_units.values()) for (const run of phraseRuns(unit.text)) runs.add(run);
  return runs;
}

/**
 * The writing warnings for one whole draft, in reading order and bounded.
 *
 * Pure over the accepted sections and their scopes, so a stored delivery
 * re-derives exactly this list. Only sections with prose are passed in;
 * failed and skipped ones have nothing to warn about.
 */
export function draftV2Warnings(sections: readonly DraftV2ProseSection[]): readonly DraftV2Warning[] {
  const warnings: DraftV2Warning[] = [];
  /** Runs already used by an earlier section, so repetition is reported once, on the later use. */
  const seen = new Map<string, DraftV2QualityLocation>();
  for (const section of sections) {
    const sources = sourceRuns(section.evidence);
    const mine = new Map<string, DraftV2QualityLocation>();
    for (const [pIndex, paragraph] of section.body.paragraphs.entries()) {
      const at: DraftV2QualityLocation = { section_id: section.id, paragraph: pIndex, sentence: null };
      // A run of bullets is a list, not a block of prose, so it does not count
      // against the paragraph rhythm the prompt asks for.
      if (paragraph.sentences.filter((sentence) => sentence.bullet !== true).length > PARAGRAPH_SENTENCES_MAX) {
        warnings.push({ code: "paragraph_too_long", at, other: null });
      }
      for (const [sIndex, sentence] of paragraph.sentences.entries()) {
        const here: DraftV2QualityLocation = { section_id: section.id, paragraph: pIndex, sentence: sIndex };
        const flat = flatten(sentence.text);
        if (FILLER.some((pattern) => pattern.test(flat))) warnings.push({ code: "filler_phrase", at: here, other: null });
        const runs = phraseRuns(sentence.text);
        if ([...runs].some((run) => sources.has(run))) warnings.push({ code: "source_phrase_reused", at: here, other: null });
        const earlier = [...runs].map((run) => seen.get(run)).find((location) => location !== undefined);
        if (earlier !== undefined) warnings.push({ code: "repeated_across_sections", at: here, other: earlier });
        for (const run of runs) if (!mine.has(run)) mine.set(run, here);
      }
    }
    for (const [run, location] of mine) if (!seen.has(run)) seen.set(run, location);
  }
  return warnings.slice(0, DRAFT_V2_QUALITY_MAX);
}
