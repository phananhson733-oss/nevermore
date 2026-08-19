// @input  -- the keyword evidence region already built for this one visitor
// @output -- evidence records for the checks about the confirmed target query
// @pos    -- pure projection; adds no measurement, only restates one
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditRecord } from "../types.ts";
import type { KeywordEvidence, KeywordEvidenceQuery } from "./types.ts";

/**
 * Which query these checks are about.
 *
 * The primary one, chosen and explained by the evidence layer itself. Judging
 * the best of several would let a page pass 2.3 on a query the visitor
 * mentioned in passing while failing on the one they actually care about, and
 * judging all of them would fail a page for not naming five things in one
 * title.
 */
function primaryQuery(
  evidence: KeywordEvidence,
): KeywordEvidenceQuery | null {
  if (evidence.availability !== "available") return null;
  return (
    evidence.queries.find((query) => query.isPrimary) ??
    evidence.queries[0] ??
    null
  );
}

function slotRecord(
  id: string,
  slot: "title" | "h1",
  targetUrl: string,
  evidence: KeywordEvidence | null | undefined,
): SeoAuditRecord {
  const unmeasured = (limitation: string): SeoAuditRecord => ({
    id,
    category: "keyword_evidence",
    state: "unverified",
    unit: "pages",
    population: "target_page",
    targetTested: null,
    tested: 0,
    affected: 0,
    observations: [],
    limitation,
  });

  if (!evidence) {
    return unmeasured(
      "no_target_query_was_confirmed_so_this_page_has_nothing_to_be_checked_against",
    );
  }
  if (evidence.availability !== "available") {
    return unmeasured(
      evidence.reason === "target_page_not_captured"
        ? "the_submitted_page_was_not_captured_so_its_text_could_not_be_read"
        : "the_page_text_extract_was_missing_so_no_slot_could_be_compared",
    );
  }

  const query = primaryQuery(evidence);
  if (query === null) {
    return unmeasured(
      "no_target_query_was_confirmed_so_this_page_has_nothing_to_be_checked_against",
    );
  }

  const result = query.slots[slot];
  // `not_applicable` is the page having no such slot at all — no title, no h1.
  // That is a different finding, reported by its own check, and reading it as
  // "the query is missing" would charge one defect twice.
  if (result.state === "not_applicable") {
    return unmeasured(
      slot === "title"
        ? "this_page_has_no_title_so_there_was_no_text_to_compare"
        : "this_page_has_no_h1_so_there_was_no_text_to_compare",
    );
  }

  const covered = result.state === "covered";
  return {
    id,
    category: "keyword_evidence",
    state: covered ? "not_observed" : "observed",
    unit: "pages",
    population: "target_page",
    targetTested: true,
    tested: 1,
    affected: covered ? 0 : 1,
    observations: covered
      ? []
      : [
          {
            url: targetUrl,
            values: [
              { label: "target_query", value: query.displayQuery },
              { label: "query_tokenization", value: query.tokenization },
              { label: "slot_occurrences", value: result.occurrences },
            ],
          },
        ],
    limitation:
      "token_sequence_match_on_the_confirmed_query_no_synonyms_or_stemming",
  };
}

/**
 * Records for the checks about the confirmed target query (2.3, 3.2).
 *
 * Always both, whatever happened. A missing record reads to the wire guard as
 * a producer that broke and takes the whole region down; every way the
 * comparison could not be made is `unverified` with the reason named.
 */
export function buildKeywordEvidenceRecords(
  targetUrl: string,
  evidence: KeywordEvidence | null | undefined,
): readonly SeoAuditRecord[] {
  return [
    slotRecord("title_without_target_query", "title", targetUrl, evidence),
    slotRecord("h1_without_target_query", "h1", targetUrl, evidence),
  ];
}

export const KEYWORD_EVIDENCE_RECORD_IDS: readonly string[] = [
  "title_without_target_query",
  "h1_without_target_query",
];

export const KEYWORD_EVIDENCE_EVIDENCE_LABELS: readonly string[] = [
  "target_query",
  "query_tokenization",
  "slot_occurrences",
];

export const KEYWORD_EVIDENCE_LIMITATION_CODES: readonly string[] = [
  "no_target_query_was_confirmed_so_this_page_has_nothing_to_be_checked_against",
  "the_submitted_page_was_not_captured_so_its_text_could_not_be_read",
  "the_page_text_extract_was_missing_so_no_slot_could_be_compared",
  "this_page_has_no_title_so_there_was_no_text_to_compare",
  "this_page_has_no_h1_so_there_was_no_text_to_compare",
  "token_sequence_match_on_the_confirmed_query_no_synonyms_or_stemming",
];
