import type { ResearchSource } from "../types.ts";
import type { QaContext } from "./context.ts";
import { jaccard, shingles } from "./ngram.ts";
import { fail, pass, unevaluable, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import { tokenize, truncateExcerpt } from "./text.ts";

/**
 * Page-overlap detection is deliberately independent of the brief-overlap DP.
 *
 * A frozen page corpus can contain several full documents. Comparing each page
 * to the draft with the O(n·m) dynamic program would multiply its worst case by
 * the number of sources. Instead this rule uses two bounded set comparisons:
 *
 * - 48-token shingles identify a verbatim passage exactly;
 * - 5-token shingles identify a near duplicate through Jaccard similarity.
 *
 * Joining normalized tokens makes the exact check collision-free (there is no
 * probabilistic hash). Every collection has a fixed prefix bound. If a bound
 * prevents the whole corpus from being read, absence of a match is reported as
 * unevaluable rather than being laundered into a clean pass.
 */

const MAX_PAGE_SOURCES = 32;
const MAX_SOURCE_CHARS = 80_000;
const MAX_OVERLAP_TOKENS = QA_THRESHOLDS.maxNgramTokens;
const EXACT_SHINGLE_TOKENS = 48;
const NEAR_SHINGLE_TOKENS = 5;
const MIN_NEAR_SHINGLES = 12;
const NEAR_JACCARD_FLOOR = 0.5;

interface PageSourceView {
  readonly source: ResearchSource;
  readonly kind: "first_party_page" | "external_page";
  readonly label: string;
  readonly url: string | null;
  readonly contentText: string;
}

interface OverlapFinding {
  readonly source: PageSourceView;
  readonly exact: boolean;
  readonly jaccard: number;
}

interface StructuralSourceFields {
  readonly label?: unknown;
  readonly url?: unknown;
  readonly contentText?: unknown;
}

function pageSourceView(source: ResearchSource): PageSourceView | null {
  const kind = String(source.kind);
  if (kind !== "first_party_page" && kind !== "external_page") return null;
  const structural = source as ResearchSource & StructuralSourceFields;
  if (
    typeof structural.contentText !== "string" ||
    structural.contentText.trim().length === 0
  ) {
    return null;
  }
  const label =
    typeof structural.label === "string" && structural.label.trim().length > 0
      ? structural.label.trim()
      : source.ref;
  const url =
    typeof structural.url === "string" && structural.url.trim().length > 0
      ? structural.url.trim()
      : null;
  return {
    source,
    kind,
    label,
    url,
    contentText: structural.contentText,
  };
}

function sharedCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) if (larger.has(value)) count += 1;
  return count;
}

function sourceDescription(source: PageSourceView): string {
  const role =
    source.kind === "first_party_page" ? "first-party page" : "external page";
  const address = source.url === null ? source.source.ref : source.url;
  return `${role} "${truncateExcerpt(source.label, 80)}" (${truncateExcerpt(address, 160)})`;
}

function findingDescription(finding: OverlapFinding): string {
  const score = Math.round(finding.jaccard * 1_000) / 1_000;
  return finding.exact
    ? `${sourceDescription(finding.source)} shares an exact ${EXACT_SHINGLE_TOKENS}-token passage (5-token shingle Jaccard ${score})`
    : `${sourceDescription(finding.source)} has 5-token shingle Jaccard ${score}`;
}

export function checkSourceOverlap(context: QaContext): QaRuleResult {
  const pageSources = context.input.pack.sources
    .map(pageSourceView)
    .filter((source): source is PageSourceView => source !== null);
  if (pageSources.length === 0) {
    return unevaluable(
      "scdup_source_overlap",
      "scdup_source_corpus_missing",
      "No frozen first-party or external page carries contentText, so draft-to-source duplicate detection had no corpus to compare. Site identity alone is not page content. This is review-required, never a clean plagiarism pass.",
    );
  }

  const boundedSources = pageSources.slice(0, MAX_PAGE_SOURCES);
  const draftWasBounded = context.draftTokens.length > MAX_OVERLAP_TOKENS;
  const draftTokens = context.draftTokens.slice(0, MAX_OVERLAP_TOKENS);
  const draftNear = shingles(draftTokens, NEAR_SHINGLE_TOKENS);
  const draftExact = shingles(draftTokens, EXACT_SHINGLE_TOKENS);
  const findings: OverlapFinding[] = [];
  let sourceWasBounded =
    pageSources.length > boundedSources.length ||
    boundedSources.some((source) => source.source.contentTruncated);
  let usableSources = 0;

  for (const source of boundedSources) {
    const boundedText =
      source.contentText.length > MAX_SOURCE_CHARS
        ? source.contentText.slice(0, MAX_SOURCE_CHARS)
        : source.contentText;
    if (boundedText.length !== source.contentText.length) sourceWasBounded = true;
    const allTokens = tokenize(boundedText);
    if (allTokens.length > MAX_OVERLAP_TOKENS) sourceWasBounded = true;
    const sourceTokens = allTokens.slice(0, MAX_OVERLAP_TOKENS);
    const sourceNear = shingles(sourceTokens, NEAR_SHINGLE_TOKENS);
    if (sourceNear.size < MIN_NEAR_SHINGLES || draftNear.size < MIN_NEAR_SHINGLES) {
      continue;
    }
    usableSources += 1;
    const sourceExact = shingles(sourceTokens, EXACT_SHINGLE_TOKENS);
    const exact =
      draftExact.size > 0 &&
      sourceExact.size > 0 &&
      sharedCount(draftExact, sourceExact) > 0;
    const similarity = jaccard(draftNear, sourceNear);
    if (exact || similarity >= NEAR_JACCARD_FLOOR) {
      findings.push({ source, exact, jaccard: similarity });
    }
  }

  if (findings.length > 0) {
    const exact = findings.filter((finding) => finding.exact);
    const relevant = (exact.length > 0 ? exact : findings).slice(
      0,
      QA_THRESHOLDS.maxReportedFindings,
    );
    const hidden = (exact.length > 0 ? exact : findings).length - relevant.length;
    const detail = relevant.map(findingDescription).join("; ");
    return fail(
      "scdup_source_overlap",
      exact.length > 0
        ? "scdup_source_overlap"
        : "scdup_source_near_duplicate",
      `${exact.length > 0 ? "Exact source overlap" : "Near-duplicate source overlap"} requires review: ${detail}${hidden > 0 ? `; and ${hidden} more matching source(s)` : ""}. The comparison is deterministic and bounded; it is a lexical duplicate check, not a copyright judgement.`,
    );
  }

  if (draftWasBounded || sourceWasBounded) {
    return unevaluable(
      "scdup_source_overlap",
      "scdup_source_comparison_bounded",
      `No duplicate was found inside the deterministic comparison prefix, but the complete corpus was not judged: at most ${MAX_PAGE_SOURCES} pages, ${MAX_SOURCE_CHARS} characters per page, and ${MAX_OVERLAP_TOKENS} tokens per side are scanned. A bounded-away match could still exist, so a human reviews this draft.`,
    );
  }

  if (usableSources === 0) {
    return unevaluable(
      "scdup_source_overlap",
      "scdup_source_corpus_too_short",
      `Frozen page content was present, but neither side supplied the ${MIN_NEAR_SHINGLES} distinct ${NEAR_SHINGLE_TOKENS}-token shingles needed for a reliable duplicate comparison. Short-text similarity is left to a reviewer.`,
    );
  }

  return pass(
    "scdup_source_overlap",
    "scdup_source_distinct",
    `The draft shared no exact ${EXACT_SHINGLE_TOKENS}-token passage and no ${NEAR_SHINGLE_TOKENS}-token shingle Jaccard score reached ${NEAR_JACCARD_FLOOR} across ${usableSources} frozen first-party/external page(s). This is a bounded lexical check, not a guarantee of originality.`,
  );
}
