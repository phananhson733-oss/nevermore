/**
 * Proper-name primitives: the structural half of "is this a reference?".
 *
 * WHY THIS FILE REPLACED A LIST OF BIBLIOGRAPHIC FORMS.
 *
 * The reference detector used to ask "does this line match one of the shapes a
 * bibliography is written in?" — `Name, 2024`, `Name (2024)`, `Name et al.`.
 * That question has an unbounded answer set, and every rework proved it: the
 * identical fabricated reference walked through by dropping the year, moving the
 * year in front, swapping the comma for a period, quoting the title, writing the
 * year as `'24`, or moving the entry into a table cell. Each escape was one
 * token away from a shape that was caught, so each fix bought exactly one row of
 * the escape table and the next rework found the neighbouring row.
 *
 * A frozen pack may or may not carry external page captures, so recognition and
 * resolution remain separate: first find every plausible reference, then ask
 * whether its identity exists in eligible frozen evidence. A recognition rule
 * made only of bibliographic forms is still a rule made of holes.
 *
 * So the question is inverted. Instead of "which bibliographic form is this?"
 * this file answers:
 *
 *   **At an entry position, is there a capitalized proper-name phrase that is
 *   not part of the customer's own identity, and does that phrase DOMINATE the
 *   entry rather than sit inside a sentence?**
 *
 * The phrase survives every mutation the form list did not: removing the year,
 * reordering, repunctuating, moving into a table cell or an HTML list item all
 * leave `Forrester Digital Experience Report` exactly where it was. What the
 * phrase cannot tell us is how CONFIDENT to be, so that is reported separately
 * (`corroborated`) and the rules calibrate on it: a corroborated citation entry
 * is blocked, an uncorroborated one is sent to a human. Saying "this looks like
 * an external reference, please confirm" is honest; saying "this is unsupported"
 * about a phrase that might be a product name is not.
 *
 * Nothing here imports anything. It is string arithmetic, so it inherits the
 * whole file-level purity contract of the gate by construction.
 */

/** A maximal run of capitalized tokens, with the count that makes it a name. */
export interface NamePhrase {
  readonly value: string;
  /** How many capitalized tokens the run carries. Always >= 2. */
  readonly tokens: number;
}

export interface NameProfile {
  readonly phrases: readonly NamePhrase[];
  /** Capitalized tokens belonging to a phrase (a run of two or more). */
  readonly properTokens: number;
  /** Alphabetic words that are NOT part of a phrase. */
  readonly otherWords: number;
}

/**
 * Emphasis markers are typography, never tokens.
 *
 * `Forrester's **2024** data puts churn at 42%` read as a different sentence
 * from `Forrester's 2024 data puts churn at 42%` to every matcher in the gate,
 * and the first one passed. Underscores are removed only at token boundaries so
 * `snake_case` stays one word.
 */
export function stripEmphasis(text: string): string {
  return text
    .replace(/[*~]+/g, "")
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "");
}

/**
 * HTML a model writes around a list. The tag body is bounded so the scan is
 * linear whatever the input (see the note on complexity in `thresholds.ts`).
 */
export function stripHtmlTags(text: string): string {
  return text.replace(/<\/?[A-Za-z][^<>]{0,200}>/g, " ");
}

/**
 * Words that are capitalized for grammar rather than for identity.
 *
 * These are function words — articles, pronouns, deictics, conjunctions. A
 * sentence-initial `It`, `The` or `We` is not the name of an outside authority,
 * and counting it as one turned every ordinary bullet into a name phrase. This
 * is a grammar class, not a vocabulary of reference forms: it does not grow when
 * a model invents a new way to write a citation.
 */
const FUNCTION_WORD: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its", "we", "us",
  "our", "ours", "you", "your", "yours", "they", "them", "their", "theirs",
  "he", "him", "his", "she", "her", "hers", "i", "my", "mine", "there", "here",
  "then", "now", "today", "but", "or", "if", "so", "when", "while", "after",
  "before", "because", "however", "although", "though", "since", "most",
  "many", "some", "few", "all", "both", "each", "every", "no", "not",
  "another", "other", "such", "who", "whose", "which", "what", "how", "why",
]);

/**
 * Lowercase words that may sit INSIDE a name without ending it: `Nielsen Norman
 * Group of America`, `Bureau of Labor Statistics`, `Ernst & Young`. They never
 * open or close a run, so they cannot manufacture one on their own.
 */
const NAME_CONNECTOR: ReadonlySet<string> = new Set([
  "of", "and", "for", "de", "van", "der", "von", "da", "del", "di", "la",
  "le", "du", "el",
]);

/**
 * The calendar, which is a CLOSED vocabulary.
 *
 * `(March 2024)` and `(Forrester, 2024)` are the same shape, and blocking the
 * first would be the false-accusation failure this gate has already had to
 * repair twice. Excluding month names is safe in a way that excluding
 * bibliographic forms is not: there is no thirteenth month for a fabricated
 * citation to escape through, so this list is complete by construction rather
 * than complete until the next counterexample.
 */
const CALENDAR_NAME: ReadonlySet<string> = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "jan", "feb", "mar", "apr",
  "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * One pass over a line, yielding words, numbers and the punctuation that ends a
 * name. Written as a token scan rather than as a nested-quantifier regex: the
 * regex form of this question is what made a single 396k-character line take a
 * minute of backtracking, and a scan cannot backtrack at all.
 */
const NAME_TOKEN = /([A-Za-z][A-Za-z0-9'’-]*)|(\d[\w'’.-]*)|(&)|([^\sA-Za-z0-9])/g;

type TokenKind = "title" | "word" | "number" | "connector" | "break";

interface ScannedToken {
  readonly kind: TokenKind;
  readonly value: string;
}

function scanTokens(text: string): readonly ScannedToken[] {
  const tokens: ScannedToken[] = [];
  for (const match of text.matchAll(NAME_TOKEN)) {
    const word = match[1];
    if (word !== undefined) {
      const lower = word.toLowerCase();
      if (NAME_CONNECTOR.has(lower) && word === lower) {
        tokens.push({ kind: "connector", value: word });
        continue;
      }
      const capitalized = /^[A-Z]/.test(word) && !FUNCTION_WORD.has(lower);
      tokens.push({ kind: capitalized ? "title" : "word", value: word });
      continue;
    }
    if (match[2] !== undefined) {
      tokens.push({ kind: "number", value: match[2] });
      continue;
    }
    if (match[3] !== undefined) {
      tokens.push({ kind: "connector", value: "&" });
      continue;
    }
    const punctuation = match[4] ?? "";
    // An apostrophe or hyphen already lives inside a token; everything else
    // ends the name, which is what keeps `Forrester, Digital Experience Report`
    // two names instead of one five-token phrase.
    if (punctuation === "'" || punctuation === "’" || punctuation === "-") {
      continue;
    }
    tokens.push({ kind: "break", value: punctuation });
  }
  return tokens;
}

/**
 * Every capitalized name phrase in `text`, plus how much of the text is NOT one.
 *
 * A phrase is a run of two or more capitalized tokens, optionally bridged by a
 * lowercase connector. One capitalized token on its own is never a phrase: that
 * is the sentence-initial case, and treating it as an identity is what would
 * report `It tracks activation milestones.` as a bibliography entry.
 */
export function nameProfile(text: string): NameProfile {
  const tokens = scanTokens(stripHtmlTags(stripEmphasis(text)));
  const phrases: NamePhrase[] = [];
  let run: string[] = [];
  let pendingConnector: string | null = null;
  let otherWords = 0;
  let properTokens = 0;

  const flush = (): void => {
    if (run.length >= 2) {
      phrases.push({ value: run.join(" "), tokens: run.length });
      properTokens += run.length;
    }
    run = [];
    pendingConnector = null;
  };

  for (const token of tokens) {
    if (token.kind === "title") {
      if (pendingConnector !== null && run.length > 0) pendingConnector = null;
      run.push(token.value);
      continue;
    }
    if (token.kind === "connector") {
      // A connector only survives when a capitalized token follows it.
      if (run.length > 0 && pendingConnector === null) {
        pendingConnector = token.value;
        continue;
      }
      flush();
      continue;
    }
    if (token.kind === "word") {
      flush();
      otherWords += 1;
      continue;
    }
    flush();
  }
  flush();
  return { phrases, properTokens, otherWords };
}

/** The longest phrase in a profile, or `null` when there is none. */
export function longestPhrase(profile: NameProfile): NamePhrase | null {
  let best: NamePhrase | null = null;
  for (const phrase of profile.phrases) {
    if (best === null || phrase.tokens > best.tokens) best = phrase;
  }
  return best;
}

const YEAR = /(?:^|[^\d])(?:19|20)\d{2}(?![\d])/;
const ET_AL = /\bet\s+al\b/i;
const QUOTED_TITLE = /["“][^"”\n]{6,}["”]/;

/**
 * Does this entry carry a second, independent citation signal?
 *
 * A name phrase says "something outside is being named". A year, an `et al.` or
 * a quoted title says "and it is being named AS a source". The two together are
 * what a bibliography entry is, and it is the pair — never the year alone —
 * that this gate is willing to call unsupported. Without the second signal the
 * phrase could be a product, a feature or a section title, so the honest answer
 * is a review rather than an accusation.
 */
export function hasCitationCorroboration(text: string): boolean {
  const flat = stripHtmlTags(stripEmphasis(text));
  return YEAR.test(flat) || ET_AL.test(flat) || QUOTED_TITLE.test(flat);
}

export interface CitationEntry {
  /** The name phrase the entry is built around. */
  readonly name: string;
  /** A year, `et al.` or a quoted title accompanies the name. */
  readonly corroborated: boolean;
}

/** Below this a name run is too short to be an entry on its own evidence. */
const UNCORROBORATED_MIN_TOKENS = 3;
const CORROBORATED_MIN_TOKENS = 2;

/**
 * Is this entry text a REFERENCE rather than a sentence?
 *
 * Two conditions, both structural:
 *
 * 1. It carries a capitalized name phrase.
 * 2. The phrase DOMINATES: its tokens are at least as many as the entry's other
 *    words. `Forrester Digital Experience Report, 2024` is four name tokens and
 *    nothing else; `It tracks activation milestones.` is no name at all; `Teams
 *    that instrument activation once tend to keep the weekly review going.` is
 *    one sentence-initial capital and eleven other words.
 *
 * The token floor is higher without corroboration, because a two-token title
 * (`Activation Rate`, `Onboarding Guide`) is ordinary B2B section vocabulary
 * and reporting it would be the false-accusation failure again.
 */
export function citationEntry(text: string): CitationEntry | null {
  const profile = nameProfile(text);
  const phrase = longestPhrase(profile);
  if (phrase === null) return null;
  if (profile.properTokens < profile.otherWords) return null;
  const corroborated = hasCitationCorroboration(text);
  const floor = corroborated
    ? CORROBORATED_MIN_TOKENS
    : UNCORROBORATED_MIN_TOKENS;
  if (phrase.tokens < floor) return null;
  return { name: phrase.value, corroborated };
}

export interface ParentheticalCitation {
  readonly index: number;
  readonly excerpt: string;
  readonly name: string;
}

/** A bracketed group. Bounded so no input can make the scan super-linear. */
const BRACKET_GROUP = /\(([^()\n]{0,200})\)|\[([^[\]\n]{0,200})\]/g;

/**
 * `(Author, Year)` — the most common inline academic citation there is, and the
 * one no bibliographic form in this gate reached. `Forrester (2024) reports 73%`
 * was blocked while `73% of teams churn (Forrester, 2024).` passed, which is the
 * same one-token-away failure the entry predicate exists to end.
 *
 * The bracket IS the entry position here: a reader reads whatever sits inside it
 * as the citation slot. So the same question is asked of its contents — is there
 * a name that is not calendar vocabulary, alongside a year — and nothing else
 * about the sentence has to match.
 */
export function parentheticalCitations(
  text: string,
): readonly ParentheticalCitation[] {
  const found: ParentheticalCitation[] = [];
  for (const match of stripEmphasis(text).matchAll(BRACKET_GROUP)) {
    if (match.index === undefined) continue;
    const inner = match[1] ?? match[2] ?? "";
    if (!YEAR.test(inner)) continue;
    const tokens = scanTokens(inner);
    const named = tokens.filter(
      (token) =>
        token.kind === "title" &&
        /^[A-Za-z]{3,}/.test(token.value) &&
        !CALENDAR_NAME.has(token.value.toLowerCase()),
    );
    if (named.length === 0) continue;
    // `(the 2024 numbers we published)` is prose in brackets, not a citation.
    const others = tokens.filter(
      (token) => token.kind === "word" && !/^(?:et|al)$/i.test(token.value),
    ).length;
    if (others > 0) continue;
    found.push({
      index: match.index,
      excerpt: match[0],
      name: named.map((token) => token.value).join(" "),
    });
  }
  return found;
}
