// @input  -- the target page extract, this run's normalized queries, the declared page role
// @output -- the keyword evidence region published beside the neutral audit ledger
// @pos    -- assembles coverage, occurrences, density, focus and the brand label
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { brandTermCandidates } from "../../traffic-drop/brand-candidates.ts";
import type { SeoAuditTargetPageExtract } from "../types.ts";
import type { NormalizedTargetQuery } from "./normalize.ts";
import { normalizeForMatch } from "./normalize.ts";
import {
  countOccurrencesInList,
  countOccurrencesInText,
  tokenizationOf,
  urlCovered,
  type QueryTokenization,
  type SlotState,
} from "./match.ts";
import { countTextUnits, hasCjk, TEXT_UNITS_VERSION } from "./text-units.ts";
import {
  KEYWORD_EVIDENCE_VERSION,
  type KeywordEvidence,
  type KeywordEvidenceBrandCandidate,
  type KeywordEvidenceDensity,
  type KeywordEvidenceLimitation,
  type KeywordEvidencePageRole,
  type KeywordEvidencePrimaryReason,
  type KeywordEvidenceQuery,
  type KeywordEvidenceSlots,
  type KeywordEvidenceTextSlotResult,
  type KeywordEvidenceUnavailableReason,
} from "./types.ts";

/** The region as a whole could not be built. Never rendered as zeros. */
export function keywordEvidenceUnavailable(
  reason: KeywordEvidenceUnavailableReason,
): KeywordEvidence {
  return {
    availability: "unavailable",
    reason,
    version: KEYWORD_EVIDENCE_VERSION,
  };
}

/** A text field that exists on the page, or null when there was nothing to read. */
function presentText(value: string | null): string | null {
  if (value === null) return null;
  return normalizeForMatch(value) === "" ? null : value;
}

/** A list field that exists on the page, or null when it is absent or empty. */
function presentList(
  value: readonly string[] | null,
): readonly string[] | null {
  if (value === null || value.length === 0) return null;
  return value.some((entry) => normalizeForMatch(entry) !== "") ? value : null;
}

function textSlot(
  identity: string,
  text: string | null,
  tokenization: QueryTokenization,
): KeywordEvidenceTextSlotResult {
  if (text === null) return { state: "not_applicable", occurrences: null };
  const occurrences = countOccurrencesInText(identity, text, tokenization);
  return { state: occurrences > 0 ? "covered" : "not_covered", occurrences };
}

function listSlot(
  identity: string,
  texts: readonly string[] | null,
  tokenization: QueryTokenization,
): KeywordEvidenceTextSlotResult {
  if (texts === null) return { state: "not_applicable", occurrences: null };
  const occurrences = countOccurrencesInList(identity, texts, tokenization);
  return { state: occurrences > 0 ? "covered" : "not_covered", occurrences };
}

/**
 * Whether the query is the site's own domain word.
 *
 * A label only. It is `not_applicable` — never `not_matched` — when the
 * comparison cannot be made at all: the mechanical variants are Latin labels
 * pulled from a hostname, so a CJK query has nothing to be compared against
 * and a bare "no" would read as a finding about the query.
 */
function brandCandidateOf(
  identity: string,
  targetUrl: string,
): KeywordEvidenceBrandCandidate {
  if (hasCjk(identity) && !/\p{ASCII}*[a-z]/u.test(identity)) {
    return "not_applicable";
  }
  const candidates = brandTermCandidates(targetUrl);
  if (candidates.length === 0) return "not_applicable";
  return candidates.includes(identity) ? "matched" : "not_matched";
}

/** Round to four decimals; the percentage itself is a display concern. */
function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface SlotAccumulator {
  readonly slots: KeywordEvidenceSlots;
  readonly capturedOccurrences: number;
  readonly coveredCount: number;
  readonly applicableCount: number;
}

function buildSlots(
  identity: string,
  extract: SeoAuditTargetPageExtract,
  tokenization: QueryTokenization,
): SlotAccumulator {
  const title = textSlot(identity, presentText(extract.title), tokenization);
  const description = textSlot(
    identity,
    presentText(extract.metaDescription),
    tokenization,
  );
  const h1 = listSlot(identity, presentList(extract.h1), tokenization);
  const subHeadings = listSlot(
    identity,
    presentList(extract.subHeadings),
    tokenization,
  );
  const openingText = textSlot(
    identity,
    presentText(extract.openingText),
    tokenization,
  );
  const url: { readonly state: SlotState } = {
    state: urlCovered(identity, extract.url) ? "covered" : "not_covered",
  };

  const textSlots = [title, description, h1, subHeadings, openingText];
  const capturedOccurrences = textSlots.reduce(
    (total, slot) => total + (slot.occurrences ?? 0),
    0,
  );
  const states: readonly SlotState[] = [
    ...textSlots.map((slot) => slot.state),
    url.state,
  ];

  return {
    slots: { title, description, h1, subHeadings, openingText, url },
    capturedOccurrences,
    coveredCount: states.filter((state) => state === "covered").length,
    applicableCount: states.filter((state) => state !== "not_applicable")
      .length,
  };
}

/**
 * The text every occurrence was counted in.
 *
 * Density's denominator has to be this same text: counting hits in the
 * captured fields and dividing by a page-wide word count would produce a ratio
 * whose numerator and denominator describe different documents.
 */
function capturedText(extract: SeoAuditTargetPageExtract): string {
  return [
    presentText(extract.title) ?? "",
    presentText(extract.metaDescription) ?? "",
    ...(presentList(extract.h1) ?? []),
    ...(presentList(extract.subHeadings) ?? []),
    presentText(extract.openingText) ?? "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

function densityOf(
  identity: string,
  capturedOccurrences: number,
  denominator: ReturnType<typeof countTextUnits>,
): KeywordEvidenceDensity | null {
  if (denominator.units === 0) return null;
  const numeratorUnits = capturedOccurrences * countTextUnits(identity).units;
  return {
    value: roundRatio(numeratorUnits / denominator.units),
    basis: "captured_text",
    unitsBasis: denominator.basis,
    numeratorUnits,
    denominatorUnits: denominator.units,
  };
}

interface Scored {
  readonly index: number;
  readonly coveredCount: number;
  readonly units: number;
}

/**
 * Pick the primary query and name the rule that picked it.
 *
 * Every input is a number already shown on the same screen, so the choice can
 * be checked rather than trusted. Coverage first, then the longer query as the
 * more specific one, then the order the visitor typed them in.
 */
function selectPrimary(scored: readonly Scored[]): {
  readonly index: number;
  readonly reason: KeywordEvidencePrimaryReason;
} {
  const best = scored.reduce((winner, candidate) => {
    if (candidate.coveredCount !== winner.coveredCount) {
      return candidate.coveredCount > winner.coveredCount ? candidate : winner;
    }
    if (candidate.units !== winner.units) {
      return candidate.units > winner.units ? candidate : winner;
    }
    return winner;
  });

  const tiedOnCoverage = scored.filter(
    (entry) => entry.coveredCount === best.coveredCount,
  );
  if (tiedOnCoverage.length === 1) {
    return { index: best.index, reason: "most_fields_covered" };
  }
  const tiedOnUnits = tiedOnCoverage.filter(
    (entry) => entry.units === best.units,
  );
  return {
    index: best.index,
    reason: tiedOnUnits.length === 1 ? "longest" : "submission_order",
  };
}

function limitationsOf(
  extract: SeoAuditTargetPageExtract,
): readonly KeywordEvidenceLimitation[] {
  const limitations: KeywordEvidenceLimitation[] = [
    "sub_headings_h2_h6_merged_no_levels",
    "opening_text_first_500_chars_static_extraction",
    "density_basis_captured_text_only",
  ];
  if (extract.subHeadings === null) {
    limitations.push("sub_headings_underivable_h1_cap_reached");
  }
  if (extract.staticBodyWords === null) {
    limitations.push("static_body_words_unavailable_for_cjk");
  }
  if (extract.truncatedLists) limitations.push("extract_lists_truncated");
  return limitations;
}

/**
 * Build the keyword evidence region for one run.
 *
 * Pure, and deliberately holds no page text of its own: every string it
 * publishes came from the visitor's own queries. The page's words stay in the
 * extract, so this region can be recomputed per request without carrying a
 * copy of someone else's page around with it.
 */
export function buildKeywordEvidence(
  extract: SeoAuditTargetPageExtract | null,
  queries: readonly NormalizedTargetQuery[],
  pageRole: KeywordEvidencePageRole | null,
): KeywordEvidence {
  if (extract === null) {
    return keywordEvidenceUnavailable("target_page_not_captured");
  }

  const denominator = countTextUnits(normalizeForMatch(capturedText(extract)));

  const built = queries.map((query, index) => {
    const tokenization = tokenizationOf(query.identity);
    const accumulated = buildSlots(query.identity, extract, tokenization);
    return {
      index,
      query,
      tokenization,
      accumulated,
      units: countTextUnits(query.identity).units,
    };
  });

  const primary =
    built.length === 0
      ? null
      : selectPrimary(
          built.map((entry) => ({
            index: entry.index,
            coveredCount: entry.accumulated.coveredCount,
            units: entry.units,
          })),
        );

  const evidenceQueries: readonly KeywordEvidenceQuery[] = built.map(
    (entry): KeywordEvidenceQuery => {
      const isPrimary = primary !== null && primary.index === entry.index;
      const base = {
        displayQuery: entry.query.displayQuery,
        isPrimary,
        brandCandidate: brandCandidateOf(entry.query.identity, extract.url),
        tokenization: entry.tokenization,
        slots: entry.accumulated.slots,
        capturedOccurrences: entry.accumulated.capturedOccurrences,
        density: densityOf(
          entry.query.identity,
          entry.accumulated.capturedOccurrences,
          denominator,
        ),
      };
      return isPrimary && primary !== null
        ? { ...base, primaryReason: primary.reason }
        : base;
    },
  );

  return {
    availability: "available",
    version: KEYWORD_EVIDENCE_VERSION,
    textUnitsVersion: TEXT_UNITS_VERSION,
    pageRole,
    queries: evidenceQueries,
    focus: {
      covered: built.reduce(
        (total, entry) => total + entry.accumulated.coveredCount,
        0,
      ),
      applicable: built.reduce(
        (total, entry) => total + entry.accumulated.applicableCount,
        0,
      ),
    },
    limitations: limitationsOf(extract),
  };
}
