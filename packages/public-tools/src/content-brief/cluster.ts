// @input  -- h2/h3 headings of observed competitor pages, the SERP language and the brand tokens
// @output -- normalised headings, deterministic lexical clusters and the must_answer selection
// @pos    -- handoff §4.5 steps 2-5; no randomness, no clock, no model
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  HEADING_CLUSTER_JACCARD,
  HEADING_MAX_CHARS,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  PRESERVED_QUESTION_PREFIXES,
  STOPWORDS,
} from "./constants.ts";
import type { ClusterMember } from "./contract.ts";

export interface HeadingInput {
  readonly observation_id: string;
  readonly rank: number;
  readonly heading: string;
  readonly level: "h2" | "h3";
}

export interface HeadingCluster {
  /** Shortest normalised string in the cluster; never a page's verbatim text. */
  readonly canonical_heading: string;
  /** Verbatim headings, in traversal order. */
  readonly members: readonly ClusterMember[];
  /** Distinct observation_id count. */
  readonly covered_by: number;
  /** Minimum SERP rank among members. */
  readonly first_rank: number;
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

const APOSTROPHES = /['’`]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const ORDINAL_WORDS = "(?:step|part|chapter|section|tip)";
/**
 * A number only counts as an ordinal when it carries a marker: a word
 * (`Step 3`), a `#`, parentheses, dotted numbering (`2.1`) or trailing
 * punctuation (`1.` / `1)` / `1:`). A bare `10 best tools` keeps its 10.
 */
const LEADING_ORDINAL = new RegExp(
  `^(?:${ORDINAL_WORDS}\\s+\\d+|#\\d+|\\(\\d+\\)|\\d+(?:\\.\\d+)+(?=\\s)|\\d+[.):\\]])[\\s:.)\\]\\-–—|]*`,
);
const TRAILING_ORDINAL = new RegExp(`[\\s:.(\\-–—|]*(?:${ORDINAL_WORDS}\\s+\\d+|#\\d+|\\(\\d+\\))\\s*$`);

function tokenize(text: string): readonly string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(NON_ALPHANUMERIC, " ")
    .trim()
    .split(" ")
    .filter((token) => token !== "");
}

function stripOrdinals(lowered: string): string {
  return lowered.replace(LEADING_ORDINAL, "").replace(TRAILING_ORDINAL, "");
}

function startsWithSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  return sequence.length > 0 && sequence.every((token, index) => tokens[index] === token);
}

function endsWithSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  const offset = tokens.length - sequence.length;
  return offset >= 0 && sequence.every((token, index) => tokens[offset + index] === token);
}

function stripBrandHead(tokens: readonly string[], brands: readonly (readonly string[])[]): readonly string[] {
  const hit = brands.find((brand) => startsWithSequence(tokens, brand));
  return hit === undefined ? tokens : stripBrandHead(tokens.slice(hit.length), brands);
}

function stripBrandTail(tokens: readonly string[], brands: readonly (readonly string[])[]): readonly string[] {
  const hit = brands.find((brand) => endsWithSequence(tokens, brand));
  return hit === undefined ? tokens : stripBrandTail(tokens.slice(0, tokens.length - hit.length), brands);
}

/** Longest brand first so "acme corp" wins over "acme" when both are passed. */
function normalizeBrands(brandTokens: readonly string[]): readonly (readonly string[])[] {
  return brandTokens
    .map((brand) => tokenize(brand))
    .filter((brand) => brand.length > 0)
    .sort((a, b) => b.length - a.length);
}

const PRESERVED_PREFIX_TOKENS: readonly (readonly string[])[] = PRESERVED_QUESTION_PREFIXES.map((prefix) =>
  tokenize(prefix),
).sort((a, b) => b.length - a.length);

function preservedPrefixLength(tokens: readonly string[]): number {
  return PRESERVED_PREFIX_TOKENS.find((prefix) => startsWithSequence(tokens, prefix))?.length ?? 0;
}

function stopwordsFor(language: string): ReadonlySet<string> | undefined {
  const primary = language.toLowerCase().split("-")[0] ?? "";
  return STOPWORDS[primary];
}

function stripStopwords(tokens: readonly string[], language: string): readonly string[] {
  const table = stopwordsFor(language);
  if (table === undefined) return tokens;
  const keep = preservedPrefixLength(tokens);
  return [...tokens.slice(0, keep), ...tokens.slice(keep).filter((token) => !table.has(token))];
}

/**
 * Lowercase, strip punctuation, fold whitespace, drop leading/trailing
 * ordinals and brand tokens, drop STOPWORDS[language] (none when the language
 * has no table) while keeping a PRESERVED_QUESTION_PREFIXES head, then cut to
 * HEADING_MAX_CHARS. Empty string means "nothing left"; callers drop those.
 */
export function normalizeHeading(heading: string, language: string, brandTokens: readonly string[]): string {
  return normalizeWithBrands(heading, language, normalizeBrands(brandTokens));
}

function normalizeWithBrands(heading: string, language: string, brands: readonly (readonly string[])[]): string {
  const tokens = tokenize(stripOrdinals(heading.normalize("NFKC").toLowerCase()));
  const unbranded = stripBrandTail(stripBrandHead(tokens, brands), brands);
  return stripStopwords(unbranded, language).join(" ").slice(0, HEADING_MAX_CHARS);
}

/* ------------------------------------------------------------------ */
/* clustering                                                          */
/* ------------------------------------------------------------------ */

interface Entry {
  readonly input: HeadingInput;
  readonly index: number;
  readonly normalized: string;
  readonly tokens: readonly string[];
  readonly tokenSet: ReadonlySet<string>;
}

function sharedTokenCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const token of small) if (large.has(token)) shared += 1;
  return shared;
}

/** `needle` appears as a contiguous token run inside `haystack`. */
function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let offset = 0; offset + needle.length <= haystack.length; offset += 1) {
    if (needle.every((token, index) => haystack[offset + index] === token)) return true;
  }
  return false;
}

/**
 * Jaccard on token sets, or one heading being a token-boundary substring of
 * the other. Token boundaries stop `port` from absorbing `support`; the
 * handoff says "substring" and this is the reading that survives real
 * headings. Both rules need at least one shared token, which is what lets the
 * inverted index below skip every pair that shares none.
 */
function similar(a: Entry, b: Entry): boolean {
  const shared = sharedTokenCount(a.tokenSet, b.tokenSet);
  if (shared === 0) return false;
  if (shared / (a.tokenSet.size + b.tokenSet.size - shared) >= HEADING_CLUSTER_JACCARD) return true;
  const [short, long] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  return shared === short.tokenSet.size && containsSequence(long.tokens, short.tokens);
}

function findRoot(parent: Int32Array, index: number): number {
  let root = index;
  while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
  let node = index;
  while ((parent[node] ?? node) !== root) {
    const next = parent[node] ?? node;
    parent[node] = root;
    node = next;
  }
  return root;
}

/** The smaller index stays root so a component is always named by its earliest member. */
function unite(parent: Int32Array, a: number, b: number): void {
  const rootA = findRoot(parent, a);
  const rootB = findRoot(parent, b);
  if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
}

/**
 * Single-linkage connected components over the `similar` relation. Candidate
 * pairs come from a token inverted index built as the traversal advances, so
 * each entry is only compared with earlier entries sharing a token, and never
 * with one it is already connected to. When every heading shares a token the
 * candidate set is still quadratic; the same-component skip is what keeps the
 * "all similar" corner linear. The working arrays are local to this call and
 * never escape it.
 */
function connectedComponents(entries: readonly Entry[]): readonly (readonly Entry[])[] {
  const parent = Int32Array.from(entries, (_, index) => index);
  const lastVisitedBy = new Int32Array(entries.length).fill(-1);
  const postings = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    for (const token of entry.tokenSet) {
      for (const earlier of postings.get(token) ?? []) {
        if (lastVisitedBy[earlier] === index) continue;
        lastVisitedBy[earlier] = index;
        // Already connected: single linkage gains nothing from another comparison.
        if (findRoot(parent, earlier) === findRoot(parent, index)) continue;
        const candidate = entries[earlier];
        if (candidate !== undefined && similar(candidate, entry)) unite(parent, earlier, index);
      }
    }
    for (const token of entry.tokenSet) {
      const list = postings.get(token);
      if (list === undefined) postings.set(token, [index]);
      else list.push(index);
    }
  });
  const groups = new Map<number, Entry[]>();
  entries.forEach((entry, index) => {
    const root = findRoot(parent, index);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [entry]);
    else group.push(entry);
  });
  return [...groups.values()];
}

function finalize(entries: readonly Entry[]): HeadingCluster {
  const canonical = entries.reduce((best, entry) =>
    entry.normalized.length < best.normalized.length ? entry : best,
  );
  return {
    canonical_heading: canonical.normalized,
    members: entries.map(({ input }) => ({
      observation_id: input.observation_id,
      heading: input.heading,
      level: input.level,
    })),
    covered_by: new Set(entries.map(({ input }) => input.observation_id)).size,
    first_rank: Math.min(...entries.map(({ input }) => input.rank)),
  };
}

function toEntry(input: HeadingInput, index: number, normalized: string): Entry {
  const tokens = normalized.split(" ").filter((token) => token !== "");
  return { input, index, normalized, tokens, tokenSet: new Set(tokens) };
}

/**
 * Lexical clustering as connected components of the `similar` relation
 * (true single linkage: a bridge heading joins the headings on either side
 * of it). Traversal is (rank, input order) so members, canonical strings and
 * cluster order are a pure function of the input set. Headings whose
 * normalised form is empty are dropped before clustering.
 */
export function clusterHeadings(
  inputs: readonly HeadingInput[],
  language: string,
  brandTokens: readonly string[],
): HeadingCluster[] {
  const brands = normalizeBrands(brandTokens);
  const entries: readonly Entry[] = inputs
    .map((input, index) => toEntry(input, index, normalizeWithBrands(input.heading, language, brands)))
    .filter((entry) => entry.normalized !== "")
    .sort((a, b) => a.input.rank - b.input.rank || a.index - b.index);
  return connectedComponents(entries).map(finalize);
}

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */

export interface MustAnswerSelection {
  readonly selected: HeadingCluster[];
  /** Clusters at or above MUST_ANSWER_MIN_PAGES, before the cap. */
  readonly candidates: number;
  /** candidates - selected.length; counted, never silently dropped. */
  readonly hidden: number;
}

/** Keep clusters covered by >= MUST_ANSWER_MIN_PAGES pages, order by covered_by desc then first_rank asc, cap. */
export function selectMustAnswer(clusters: readonly HeadingCluster[]): MustAnswerSelection {
  const qualified = clusters
    .filter((cluster) => cluster.covered_by >= MUST_ANSWER_MIN_PAGES)
    .sort((a, b) => b.covered_by - a.covered_by || a.first_rank - b.first_rank);
  const selected = qualified.slice(0, MUST_ANSWER_CAP);
  return { selected, candidates: qualified.length, hidden: qualified.length - selected.length };
}
