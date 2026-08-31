// @input -- frozen research and scoped first-party evidence
// @output -- v2 assembly and confirmed delivery vocabulary
// @pos -- explicit new-generation contract; never relabel historical v1 exports
import type { LlmReadMeta, ProfileFact } from "./contract.ts";
import type { ModelResearchOutput, ResearchBundle, ResearchOutlineItem, ResearchResult } from "./v2-contract.ts";

export interface BriefV2Input {
  readonly primary: string;
  readonly supporting: readonly string[];
  readonly market: string;
  readonly language: string;
}

/** Exact normalized phrase, not an inferred topic or substring match. */
export interface ScopedQueryPage {
  readonly id: string;
  readonly query: string;
  readonly keyword: string;
  readonly scope: "primary" | "supporting";
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number | null;
}

export interface BriefV2Gsc {
  readonly status: "complete" | "partial" | "unavailable";
  readonly property: string | null;
  readonly window: { readonly start: string; readonly end: string; readonly lookback_days: 28 } | null;
  readonly reason: "not_requested" | "not_connected" | "timeout" | "provider_error" | null;
  readonly matches: readonly ScopedQueryPage[];
  readonly omitted_matches: number;
}

export interface OwnedCandidate {
  readonly id: string;
  readonly url: string;
  readonly match_refs: readonly string[];
  readonly read: "observed" | "unavailable" | "redirected";
}

export interface BriefV2Context {
  readonly input: BriefV2Input;
  readonly research: ResearchBundle;
  readonly facts: readonly ProfileFact[];
  readonly profile_snapshot: { readonly website_id: string; readonly revision: number; readonly hash: string } | null;
  readonly gsc: BriefV2Gsc;
  readonly candidates: readonly OwnedCandidate[];
}

export interface BriefV2PlanStep {
  readonly kind: "keep" | "add" | "rewrite";
  readonly instruction: string;
  /** U ids: keep/rewrite must bind actual target excerpts; PAA alone is not factual support. */
  readonly sources: readonly string[];
  /** Model uses question anchor U ids; public result uses Q ids. */
  readonly answers: readonly string[];
}

export interface BriefV2PagePlan {
  readonly action: "create" | "update" | "undecidable";
  readonly rationale: string;
  readonly target_ref: string | null;
  readonly steps: readonly BriefV2PlanStep[];
}

export interface BriefV2WritingPlan {
  readonly intent: { readonly value: "informational" | "commercial" | "transactional" | "navigational"; readonly rationale: string } | null;
  readonly format: { readonly value: "guide" | "listicle" | "comparison" | "product_page" | "tool" | "other"; readonly rationale: string } | null;
  readonly page_plan: BriefV2PagePlan;
  readonly gap_angle: { readonly value: string; readonly rationale: string; readonly fact_refs: readonly string[]; readonly sources: readonly string[] } | null;
  readonly internal_links: readonly { readonly page_ref: string; readonly anchor: string; readonly why: string }[];
  readonly do_not_cover: readonly { readonly page_ref: string; readonly topic: string; readonly why: string }[];
}

export interface ModelBriefV2Output extends BriefV2WritingPlan {
  readonly research: ModelResearchOutput;
}

export interface BriefV2Generated extends BriefV2WritingPlan {
  readonly research: ResearchResult;
}

/** Source read metadata, independent of model generation and user edits. */
export interface BriefV2Read {
  readonly source: "serp" | "paa" | "competitors" | "owned_pages" | "gsc" | "profile";
  readonly status: "complete" | "partial" | "unavailable";
  readonly attempted: number | null;
  readonly retained: number | null;
  readonly reason: "not_requested" | "not_connected" | "not_configured" | "timeout" | "provider_error" | "insufficient_evidence" | null;
}

export interface ContentBriefV2 {
  readonly schema: "gengrowth.content_brief/v2";
  readonly context: BriefV2Context;
  readonly generated: BriefV2Generated | null;
  readonly run: {
    readonly run_id: string;
    readonly collected_at: string;
    readonly elapsed_ms: number;
    readonly budget_ms: 45000;
    readonly reads: readonly BriefV2Read[];
    readonly llm: LlmReadMeta;
    readonly serp_cost_usd: number | null;
    readonly prompt_bytes: number;
    readonly fingerprint: string;
  };
}

/** User-owned headings/order only. Questions, mappings, plan and source observations remain frozen. */
export interface ConfirmedBriefV2 {
  readonly schema: "gengrowth.confirmed_brief/v2";
  readonly brief: ContentBriefV2;
  readonly revision: number;
  readonly confirmed_at: string;
  readonly outline: readonly ResearchOutlineItem[];
  /** Explicit resolution is required when the generated page action is undecidable. */
  readonly resolution: "accept_recommendation" | "create_despite_uncertainty";
  readonly fingerprint: string;
}
