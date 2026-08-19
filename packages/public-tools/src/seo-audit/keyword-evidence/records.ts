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
/**
 * The heading shape the visitor's confirmed page type asks for.
 *
 * Passed in rather than imported: the preset table lives with the catalogue,
 * which already depends on this package, and reaching back for it would close
 * the loop. It is the caller that knows which page type was confirmed anyway.
 */
export interface HeadingShapeInput {
  readonly levels: readonly number[];
  readonly pageType: string;
  readonly h2: { readonly min: number; readonly max: number };
  readonly h3: { readonly min: number; readonly max: number };
}

function headingCountRecord(
  id: string,
  level: 2 | 3,
  targetUrl: string,
  shape: HeadingShapeInput | null | undefined,
): SeoAuditRecord {
  const base = {
    id,
    category: "keyword_evidence" as const,
    unit: "pages" as const,
    population: "target_page" as const,
  };
  if (!shape) {
    return {
      ...base,
      state: "unverified",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation:
        "no_page_type_was_confirmed_so_there_is_no_reviewed_range_to_compare_against",
    };
  }
  const count = shape.levels.filter((entry) => entry === level).length;
  const range = level === 2 ? shape.h2 : shape.h3;
  const outside = count < range.min || count > range.max;
  return {
    ...base,
    state: outside ? "observed" : "not_observed",
    targetTested: true,
    tested: 1,
    affected: outside ? 1 : 0,
    observations: outside
      ? [
          {
            url: targetUrl,
            values: [
              { label: "heading_count", value: count },
              { label: "reviewed_minimum", value: range.min },
              { label: "reviewed_maximum", value: range.max },
              { label: "confirmed_page_type", value: shape.pageType },
            ],
          },
        ]
      : [],
    limitation:
      "a_reviewed_range_for_the_confirmed_page_type_not_a_documented_rule",
  };
}

/**
 * Keyword density for the primary query (4.2).
 *
 * Published, never judged: the check's own threshold says density is not a
 * documented ranking signal and is not used to decide anything. It is here so
 * the number the evidence layer already computed reaches the reader, instead of
 * the check reporting that no detector exists for it.
 */
function densityRecord(
  targetUrl: string,
  evidence: KeywordEvidence | null | undefined,
): SeoAuditRecord {
  const base = {
    id: "target_query_density",
    category: "keyword_evidence" as const,
    unit: "pages" as const,
    population: "target_page" as const,
  };
  const query =
    evidence && evidence.availability === "available"
      ? primaryQuery(evidence)
      : null;
  if (query === null || query.density === null) {
    return {
      ...base,
      state: "unverified",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation:
        "no_confirmed_query_or_no_captured_text_to_compute_a_density_over",
    };
  }
  return {
    ...base,
    state: "observed",
    targetTested: true,
    tested: 1,
    affected: 1,
    observations: [
      {
        url: targetUrl,
        values: [
          { label: "target_query", value: query.displayQuery },
          { label: "query_density", value: query.density.value },
          { label: "density_numerator_units", value: query.density.numeratorUnits },
          { label: "density_denominator_units", value: query.density.denominatorUnits },
        ],
      },
    ],
    limitation: "density_over_the_captured_text_only_and_never_judged",
  };
}

/**
 * Schema types that fit each confirmed page type (7.2).
 *
 * Neither repo had this table, which is why the check sat unwired. It is a
 * judgement, so it is written down where it can be argued with rather than
 * buried in a condition, and it is deliberately generous: every entry is a type
 * a reasonable implementer would choose for that page, and the check is a Tip.
 * A page carrying something outside its row is worth a second look, not a
 * defect — plenty of pages are legitimately more than one thing.
 */
const PAGE_TYPE_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  homepage: ["website", "organization", "localbusiness", "webpage"],
  product: ["product", "offer", "aggregateoffer", "softwareapplication"],
  tool: ["softwareapplication", "webapplication", "howto", "webpage"],
  guide: ["article", "blogposting", "newsarticle", "howto", "faqpage"],
};

/**
 * Whether the page declares a type that fits what the visitor said it is.
 *
 * `BreadcrumbList`, `WebSite` and the organisation types are ignored when
 * deciding: they are site furniture that appears on every page of a
 * well-built site, so counting them would let any page pass by declaring its
 * navigation.
 */
const SITE_FURNITURE = new Set([
  "breadcrumblist",
  "website",
  "organization",
  "localbusiness",
  "sitenavigationelement",
  "webpage",
]);

function schemaTypeRecord(
  targetUrl: string,
  pageType: string | null | undefined,
  jsonLdTypes: readonly string[] | null | undefined,
): SeoAuditRecord {
  const base = {
    id: "schema_type_unmatched_to_page_type",
    category: "keyword_evidence" as const,
    unit: "pages" as const,
    population: "target_page" as const,
  };
  const expected = pageType === null || pageType === undefined
    ? undefined
    : PAGE_TYPE_SCHEMA[pageType];
  if (expected === undefined) {
    return {
      ...base,
      state: "unverified",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation:
        "no_page_type_was_confirmed_so_there_is_nothing_to_match_the_schema_against",
    };
  }
  if (jsonLdTypes === null || jsonLdTypes === undefined) {
    return {
      ...base,
      state: "unverified",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation: "the_submitted_page_was_not_collected_so_it_declared_nothing",
    };
  }
  const declared = jsonLdTypes.map((type) => type.trim().toLowerCase());
  // A page with no JSON-LD at all is check 7.1's finding, not this one.
  const substantive = declared.filter((type) => !SITE_FURNITURE.has(type));
  if (substantive.length === 0) {
    return {
      ...base,
      state: "unverified",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation:
        "this_page_declares_only_site_furniture_types_which_check_7_1_reports",
    };
  }
  const matched = substantive.some((type) => expected.includes(type));
  return {
    ...base,
    state: matched ? "not_observed" : "observed",
    targetTested: true,
    tested: 1,
    affected: matched ? 0 : 1,
    observations: matched
      ? []
      : [
          {
            url: targetUrl,
            values: [
              { label: "confirmed_page_type", value: pageType ?? "" },
              { label: "declared_schema_types", value: substantive.join(" ") },
              { label: "expected_schema_types", value: expected.join(" ") },
            ],
          },
        ],
    limitation: "a_reviewed_mapping_of_page_type_to_schema_type_not_a_rule",
  };
}

export function buildKeywordEvidenceRecords(
  targetUrl: string,
  evidence: KeywordEvidence | null | undefined,
  headingShape?: HeadingShapeInput | null,
  /** What the target page declared, for the schema-fit check. */
  jsonLdTypes?: readonly string[] | null,
): readonly SeoAuditRecord[] {
  return [
    slotRecord("title_without_target_query", "title", targetUrl, evidence),
    slotRecord("h1_without_target_query", "h1", targetUrl, evidence),
    headingCountRecord("h2_count_outside_reviewed_range", 2, targetUrl, headingShape),
    headingCountRecord("h3_count_outside_reviewed_range", 3, targetUrl, headingShape),
    densityRecord(targetUrl, evidence),
    schemaTypeRecord(targetUrl, headingShape?.pageType ?? null, jsonLdTypes),
  ];
}

export const KEYWORD_EVIDENCE_RECORD_IDS: readonly string[] = [
  "title_without_target_query",
  "h1_without_target_query",
  "h2_count_outside_reviewed_range",
  "h3_count_outside_reviewed_range",
  "target_query_density",
  "schema_type_unmatched_to_page_type",
];

export const KEYWORD_EVIDENCE_EVIDENCE_LABELS: readonly string[] = [
  "heading_count",
  "reviewed_minimum",
  "reviewed_maximum",
  "confirmed_page_type",
  "declared_schema_types",
  "expected_schema_types",
  "query_density",
  "density_numerator_units",
  "density_denominator_units",
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
  "no_page_type_was_confirmed_so_there_is_no_reviewed_range_to_compare_against",
  "a_reviewed_range_for_the_confirmed_page_type_not_a_documented_rule",
  "no_confirmed_query_or_no_captured_text_to_compute_a_density_over",
  "density_over_the_captured_text_only_and_never_judged",
  "no_page_type_was_confirmed_so_there_is_nothing_to_match_the_schema_against",
  "the_submitted_page_was_not_collected_so_it_declared_nothing",
  "this_page_declares_only_site_furniture_types_which_check_7_1_reports",
  "a_reviewed_mapping_of_page_type_to_schema_type_not_a_rule",
];
