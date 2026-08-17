// @input  -- the target page extract and the run's normalized target queries
// @output -- the published keyword evidence shape
// @pos    -- wire types for the keyword layer, deliberately absent from SeoAuditReport
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { TEXT_UNITS_VERSION, type TextUnitsBasis } from "./text-units.ts";

/**
 * Re-exported so the wire guard can compare against the exact literal instead of
 * accepting any string. A response computed under a different counting
 * algorithm is not readable under these rules, and a guard that took `string`
 * would let one through as current.
 */
export { TEXT_UNITS_VERSION };
import type { QueryTokenization, SlotState } from "./match.ts";

/**
 * The evidence shape version.
 *
 * Published inside the region itself so a stored or copied report can be read
 * back without guessing which rules produced it.
 */
export const KEYWORD_EVIDENCE_VERSION = "keyword_evidence.v1" as const;

/** Page roles the visitor may declare. Mirrors the existing profile vocabulary. */
export type KeywordEvidencePageRole =
  | "homepage"
  | "product"
  | "tool"
  | "guide";

/** The five text slots, plus the URL slot that carries no occurrence count. */
export type KeywordEvidenceTextSlot =
  | "title"
  | "description"
  | "h1"
  | "subHeadings"
  | "openingText";

export interface KeywordEvidenceTextSlotResult {
  readonly state: SlotState;
  /**
   * Null whenever the slot is `not_applicable`.
   *
   * A zero would say "we looked and the keyword was absent"; null says "there
   * was nothing to look at". Collapsing the two turns a missing field into a
   * failed check.
   */
  readonly occurrences: number | null;
}

export interface KeywordEvidenceUrlSlotResult {
  readonly state: SlotState;
}

export interface KeywordEvidenceSlots {
  readonly title: KeywordEvidenceTextSlotResult;
  readonly description: KeywordEvidenceTextSlotResult;
  readonly h1: KeywordEvidenceTextSlotResult;
  readonly subHeadings: KeywordEvidenceTextSlotResult;
  readonly openingText: KeywordEvidenceTextSlotResult;
  readonly url: KeywordEvidenceUrlSlotResult;
}

/**
 * Why one query was selected as the primary one.
 *
 * Published so the choice can be checked against the numbers on the same
 * screen rather than taken on faith.
 */
export type KeywordEvidencePrimaryReason =
  | "most_fields_covered"
  | "longest"
  | "submission_order";

/**
 * Whether the query looks like the site's own brand term.
 *
 * A label, not a judgement: it changes no count, no state and no threshold.
 * `not_applicable` covers the cases where the mechanical comparison cannot be
 * made at all rather than pretending it came out negative.
 */
export type KeywordEvidenceBrandCandidate =
  | "matched"
  | "not_matched"
  | "not_applicable";

export interface KeywordEvidenceDensity {
  /** Raw ratio, four decimal places. The percentage is a display concern. */
  readonly value: number;
  /** Always the captured text: never the full page body, which we do not hold. */
  readonly basis: "captured_text";
  readonly unitsBasis: TextUnitsBasis;
  readonly numeratorUnits: number;
  readonly denominatorUnits: number;
}

export interface KeywordEvidenceQuery {
  readonly displayQuery: string;
  readonly isPrimary: boolean;
  readonly primaryReason?: KeywordEvidencePrimaryReason;
  readonly brandCandidate: KeywordEvidenceBrandCandidate;
  readonly tokenization: QueryTokenization;
  readonly slots: KeywordEvidenceSlots;
  readonly capturedOccurrences: number;
  readonly density: KeywordEvidenceDensity | null;
}

/**
 * Coverage as a plain count, never a score.
 *
 * The denominator counts only slots that could be checked, so a page without a
 * meta description does not read as a page that failed one.
 */
export interface KeywordEvidenceFocus {
  readonly covered: number;
  readonly applicable: number;
}

/** Limitation codes published with every region; the UI owns their wording. */
export type KeywordEvidenceLimitation =
  | "sub_headings_h2_h6_merged_no_levels"
  | "sub_headings_underivable_h1_cap_reached"
  | "opening_text_first_500_chars_static_extraction"
  | "density_basis_captured_text_only"
  | "static_body_words_unavailable_for_cjk"
  | "extract_lists_truncated";

export type KeywordEvidenceUnavailableReason =
  | "target_page_not_captured"
  | "extract_missing";

export interface KeywordEvidenceUnavailable {
  readonly availability: "unavailable";
  readonly reason: KeywordEvidenceUnavailableReason;
  readonly version: typeof KEYWORD_EVIDENCE_VERSION;
}

export interface KeywordEvidenceAvailable {
  readonly availability: "available";
  readonly version: typeof KEYWORD_EVIDENCE_VERSION;
  readonly textUnitsVersion: typeof TEXT_UNITS_VERSION;
  readonly pageRole: KeywordEvidencePageRole | null;
  readonly queries: readonly KeywordEvidenceQuery[];
  readonly focus: KeywordEvidenceFocus;
  readonly limitations: readonly KeywordEvidenceLimitation[];
}

export type KeywordEvidence =
  | KeywordEvidenceAvailable
  | KeywordEvidenceUnavailable;
