// @input -- measured questions plus independent site/reference/T2 evidence
// @output -- bounded evidence-conditioned next actions, never causal attribution
// @pos -- browser/server shared gap vocabulary and fixed decision precedence
export const GEO_GAP_METHOD = "marketing-geo-gap.v1";
export const GEO_GAP_PRECEDENCE = ["B", "A", "D", "C"] as const;
export type GeoGapKind = "A" | "B" | "C" | "D" | "unattributed";
export type GeoGapReason = "measurement_insufficient" | "prompted_question" | "site_evidence_unavailable" | "question_mapping_unavailable" | "relevant_page_citability_failed" | "no_matching_page_in_audited_inventory" | "repeated_competitor_list_position" | "missing_from_read_reference_pages" | "inventory_incomplete" | "citability_unavailable" | "no_actionable_gap";
export interface GeoGap {
  readonly id: string;
  readonly questionId: string;
  readonly kind: GeoGapKind;
  readonly reason: GeoGapReason;
  readonly evidenceIds: readonly string[];
  readonly pageUrl: string | null;
  readonly sourceUrls: readonly string[];
  readonly action: "brief" | "citability" | "third_party" | "none";
}
