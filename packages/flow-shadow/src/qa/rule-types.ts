import type { QaClaimKind } from "../types.ts";

/**
 * The rule vocabulary of the ported SEO/GEO + factual-review gate (Task 6).
 *
 * Severity, not the rule itself, decides what a failure costs:
 *
 * - `blocking` — the draft contains something that is not true of our records.
 *   Exactly three rules hold this severity and the set is closed by decision;
 *   widening it is a product decision, not an implementation detail.
 * - `review` — a real quality or SEO defect a human must look at.
 * - `advisory` — a style/structure signal that NEVER moves the verdict, not even
 *   to `needs_review`.
 *
 * `blocked` is the strongest signal this gate can emit, so it is reserved for
 * "there is something fabricated in this draft". A paragraph wall or a missing
 * FAQ is a quality problem; dressing it up as a factual failure would train
 * reviewers to ignore the one verdict that matters.
 */
export type QaSeverity = "blocking" | "review" | "advisory";

export type QaRuleId =
  // Red lines (ported from the pinned Flow tooling's B2B profile).
  | "rl4_keyword_anchor"
  | "rl5_keyword_stuffing"
  | "rl7_banned_tokens"
  | "rl8_unsupported_claim"
  | "rl10_chat_residue"
  | "rl11_weak_verb"
  | "rl12_citation_integrity"
  | "rl12b_unresolved_link"
  | "rl13_banned_jargon"
  | "rl14_brand_voice"
  | "rl15_claim_restrictions"
  // Structure checks.
  | "sc1_bolded_definition"
  | "sc2_internal_link_density"
  | "sc3_paragraph_wall"
  | "sc3b_paragraph_fragmentation"
  | "sc3c_section_scatter"
  | "sc4_link_distribution"
  | "sc5_faq_section"
  | "sc6_h1_value_prop"
  | "sc7_snippet_bullets"
  | "sc8_cta_anchor"
  | "sc9_sources_section"
  | "sc9b_sources_resolve_to_pack"
  | "sc10_table_integrity"
  | "sc11_banned_headings"
  | "scdup_brief_overlap"
  | "scdup_source_overlap"
  // GEO citability, advisory by construction.
  | "citability_geo";

export interface QaRuleResult {
  readonly ruleId: QaRuleId;
  /** `false` = this rule found a violation. */
  readonly pass: boolean;
  /**
   * `false` = the rule could not be judged at all (missing context, unsupported
   * locale, oversized input). It is never reported as a pass: an unevaluable
   * `blocking`/`review` rule forces `needs_review`.
   */
  readonly evaluable: boolean;
  /** Stable machine code. Never interpolate counts into it — those go in `detail`. */
  readonly reasonCode: string;
  readonly detail: string;
}

/**
 * Declaration order. It is the ONLY ordering the emitted claim list uses, which
 * is what makes the claim array byte-stable across processes and replays — the
 * property `FlowShadowQaGatesRepository.insert`'s replay comparison depends on.
 */
export const QA_RULE_ORDER: readonly QaRuleId[] = [
  "rl4_keyword_anchor",
  "rl5_keyword_stuffing",
  "rl7_banned_tokens",
  "rl8_unsupported_claim",
  "rl10_chat_residue",
  "rl11_weak_verb",
  "rl12_citation_integrity",
  "rl12b_unresolved_link",
  "rl13_banned_jargon",
  "rl14_brand_voice",
  "rl15_claim_restrictions",
  "sc1_bolded_definition",
  "sc2_internal_link_density",
  "sc3_paragraph_wall",
  "sc3b_paragraph_fragmentation",
  "sc3c_section_scatter",
  "sc4_link_distribution",
  "sc5_faq_section",
  "sc6_h1_value_prop",
  "sc7_snippet_bullets",
  "sc8_cta_anchor",
  "sc9_sources_section",
  "sc9b_sources_resolve_to_pack",
  "sc10_table_integrity",
  "sc11_banned_headings",
  "scdup_brief_overlap",
  "scdup_source_overlap",
  "citability_geo",
];

export const QA_RULE_SEVERITY: Readonly<Record<QaRuleId, QaSeverity>> =
  Object.freeze({
    rl4_keyword_anchor: "review",
    rl5_keyword_stuffing: "review",
    rl7_banned_tokens: "advisory",
    rl8_unsupported_claim: "blocking",
    rl10_chat_residue: "review",
    rl11_weak_verb: "advisory",
    rl12_citation_integrity: "blocking",
    rl12b_unresolved_link: "review",
    rl13_banned_jargon: "advisory",
    rl14_brand_voice: "review",
    rl15_claim_restrictions: "review",
    sc1_bolded_definition: "review",
    sc2_internal_link_density: "advisory",
    sc3_paragraph_wall: "review",
    sc3b_paragraph_fragmentation: "advisory",
    sc3c_section_scatter: "review",
    sc4_link_distribution: "advisory",
    sc5_faq_section: "advisory",
    sc6_h1_value_prop: "advisory",
    sc7_snippet_bullets: "advisory",
    sc8_cta_anchor: "advisory",
    sc9_sources_section: "advisory",
    sc9b_sources_resolve_to_pack: "blocking",
    sc10_table_integrity: "advisory",
    sc11_banned_headings: "review",
    scdup_brief_overlap: "advisory",
    scdup_source_overlap: "review",
    citability_geo: "advisory",
  } as const satisfies Record<QaRuleId, QaSeverity>);

/**
 * The closed blocking set. All three ask the same question — "does this
 * reference resolve to a source the frozen research pack actually carries?" —
 * because that is the only question whose answer we can prove from our own
 * records.
 */
export const BLOCKING_RULE_IDS: readonly QaRuleId[] = QA_RULE_ORDER.filter(
  (ruleId) => QA_RULE_SEVERITY[ruleId] === "blocking",
);

const RULE_KIND: Readonly<Record<QaRuleId, QaClaimKind>> = Object.freeze({
  rl4_keyword_anchor: "red_line",
  rl5_keyword_stuffing: "red_line",
  rl7_banned_tokens: "red_line",
  rl8_unsupported_claim: "red_line",
  rl10_chat_residue: "red_line",
  rl11_weak_verb: "red_line",
  rl12_citation_integrity: "red_line",
  rl12b_unresolved_link: "red_line",
  rl13_banned_jargon: "red_line",
  rl14_brand_voice: "red_line",
  rl15_claim_restrictions: "red_line",
  sc1_bolded_definition: "structure",
  sc2_internal_link_density: "structure",
  sc3_paragraph_wall: "structure",
  sc3b_paragraph_fragmentation: "structure",
  sc3c_section_scatter: "structure",
  sc4_link_distribution: "structure",
  sc5_faq_section: "structure",
  sc6_h1_value_prop: "structure",
  sc7_snippet_bullets: "structure",
  sc8_cta_anchor: "structure",
  sc9_sources_section: "structure",
  sc9b_sources_resolve_to_pack: "structure",
  sc10_table_integrity: "structure",
  sc11_banned_headings: "structure",
  scdup_brief_overlap: "structure",
  scdup_source_overlap: "structure",
  citability_geo: "citability",
} as const satisfies Record<QaRuleId, QaClaimKind>);

export function qaRuleKind(ruleId: QaRuleId): QaClaimKind {
  return RULE_KIND[ruleId];
}

/** The stable persisted claim id for one rule. */
export function claimIdForRule(ruleId: QaRuleId): string {
  return `content-shadow.qa.${ruleId}`;
}

export function pass(
  ruleId: QaRuleId,
  reasonCode: string,
  detail: string,
): QaRuleResult {
  return { ruleId, pass: true, evaluable: true, reasonCode, detail };
}

export function fail(
  ruleId: QaRuleId,
  reasonCode: string,
  detail: string,
): QaRuleResult {
  return { ruleId, pass: false, evaluable: true, reasonCode, detail };
}

/**
 * "We could not judge this." Never a pass: a `blocking`/`review` rule that
 * cannot run forces the draft to a human. The sibling tooling's plagiarism
 * check silently returned `pass: true` whenever its SERP cache was missing,
 * which turned "the corpus is absent" into "the draft is clean".
 */
export function unevaluable(
  ruleId: QaRuleId,
  reasonCode: string,
  detail: string,
): QaRuleResult {
  return { ruleId, pass: true, evaluable: false, reasonCode, detail };
}
