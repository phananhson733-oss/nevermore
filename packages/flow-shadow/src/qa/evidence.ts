import type { SourceIdentity, SourceIndex } from "./claims.ts";
import { shingles } from "./ngram.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import { tokenize, truncateExcerpt } from "./text.ts";

const MAX_EVIDENCE_SOURCES = 32;
const MAX_EVIDENCE_CHARS = 80_000;
const MAX_EVIDENCE_TOKENS = QA_THRESHOLDS.maxNgramTokens;
const CLAIM_SHINGLE_TOKENS = 3;
const CLAIM_TOKEN_RECALL_FLOOR = 0.55;

const CLAIM_STOPWORDS: ReadonlySet<string> = new Set([
  "about",
  "according",
  "after",
  "again",
  "against",
  "also",
  "among",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "does",
  "each",
  "every",
  "for",
  "from",
  "had",
  "has",
  "have",
  "into",
  "its",
  "more",
  "most",
  "not",
  "our",
  "per",
  "research",
  "said",
  "says",
  "should",
  "shows",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "was",
  "were",
  "which",
  "will",
  "with",
  "within",
  "would",
  "your",
]);

export type EvidenceScope = "external" | "first_party";

export interface EvidenceTextMatch {
  readonly source: SourceIdentity;
  readonly sharedMeaningfulTokens: number;
  readonly meaningfulTokenRecall: number;
  readonly exactClaimShingle: boolean;
}

export interface EvidenceSearchResult {
  readonly match: EvidenceTextMatch | null;
  readonly candidateCount: number;
  readonly bounded: boolean;
}

function roleForScope(scope: EvidenceScope): SourceIdentity["role"] {
  return scope === "external"
    ? "external_evidence"
    : "first_party_evidence";
}

function meaningfulTokens(text: string): readonly string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const token of tokenize(text)) {
    if (token.length < 4 || CLAIM_STOPWORDS.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    values.push(token);
    if (values.length >= 64) break;
  }
  return values;
}

function metricAtoms(text: string): readonly string[] {
  const atoms: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(
    /(?:[$€£]\s*)?\b\d[\d,.]*(?:\s*(?:%|percent(?:age points?)?|x|times?|hours?|days?|weeks?|months?|years?))?/gi,
  )) {
    const atom = match[0]
      .toLowerCase()
      .replace(/percentage points?/g, "%")
      .replace(/percent/g, "%")
      .replace(/\s+/g, "")
      .replace(/,/g, "");
    if (atom.length === 0 || seen.has(atom)) continue;
    seen.add(atom);
    atoms.push(atom);
    if (atoms.length >= 24) break;
  }
  return atoms;
}

function normalizedForMetricMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/percentage points?/g, "%")
    .replace(/percent/g, "%")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
}

function setsIntersect(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) if (larger.has(value)) return true;
  return false;
}

/**
 * Deterministic lexical support, deliberately short of semantic fact-checking.
 *
 * A match means the frozen page repeats the claim's metrics and enough of its
 * meaningful language to be a plausible evidence passage. A miss does not prove
 * the claim false: callers decide whether that means unsupported or human
 * review. The distinction is what keeps this heuristic honest.
 */
export function findEvidenceTextMatch(
  index: SourceIndex,
  claimText: string,
  scope: EvidenceScope,
): EvidenceSearchResult {
  const allCandidates = index.identities.filter(
    (identity) =>
      identity.role === roleForScope(scope) && identity.contentText !== null,
  );
  const candidates = allCandidates.slice(0, MAX_EVIDENCE_SOURCES);
  let bounded = allCandidates.length > candidates.length;
  const claimTokens = tokenize(claimText).slice(0, 256);
  const claimMeaningful = meaningfulTokens(claimText);
  const claimShingles = shingles(claimTokens, CLAIM_SHINGLE_TOKENS);
  const metrics = metricAtoms(claimText);

  for (const source of candidates) {
    if (source.contentTruncated) bounded = true;
    const content = source.contentText ?? "";
    const boundedContent =
      content.length > MAX_EVIDENCE_CHARS
        ? content.slice(0, MAX_EVIDENCE_CHARS)
        : content;
    if (boundedContent.length !== content.length) bounded = true;
    const allSourceTokens = tokenize(boundedContent);
    if (allSourceTokens.length > MAX_EVIDENCE_TOKENS) bounded = true;
    const sourceTokens = allSourceTokens.slice(0, MAX_EVIDENCE_TOKENS);
    const sourceTokenSet = new Set(sourceTokens);
    let shared = 0;
    for (const token of claimMeaningful) {
      if (sourceTokenSet.has(token)) shared += 1;
    }
    const recall =
      claimMeaningful.length === 0 ? 0 : shared / claimMeaningful.length;
    const exactClaimShingle =
      claimShingles.size > 0 &&
      setsIntersect(
        claimShingles,
        shingles(sourceTokens, CLAIM_SHINGLE_TOKENS),
      );
    const normalizedSource = normalizedForMetricMatch(boundedContent);
    const metricsMatch = metrics.every((metric) =>
      normalizedSource.includes(metric),
    );
    const languageMatch =
      exactClaimShingle ||
      (shared >= 3 && recall >= CLAIM_TOKEN_RECALL_FLOOR);
    if (metricsMatch && languageMatch) {
      return {
        match: {
          source,
          sharedMeaningfulTokens: shared,
          meaningfulTokenRecall: recall,
          exactClaimShingle,
        },
        candidateCount: allCandidates.length,
        bounded,
      };
    }
  }

  return {
    match: null,
    candidateCount: allCandidates.length,
    bounded,
  };
}

/** Run the same bounded alignment against one already-resolved source only. */
export function findEvidenceTextMatchForSource(
  source: SourceIdentity,
  claimText: string,
): EvidenceSearchResult {
  const scope: EvidenceScope =
    source.role === "first_party_evidence" ? "first_party" : "external";
  return findEvidenceTextMatch(
    {
      identities: [source],
      citableCount: source.role === "external_evidence" ? 1 : 0,
    },
    claimText,
    scope,
  );
}

export function evidenceSourceDescription(source: SourceIdentity): string {
  const address = source.url ?? source.ref;
  return `"${truncateExcerpt(source.label, 80)}" (${truncateExcerpt(address, 160)})`;
}
