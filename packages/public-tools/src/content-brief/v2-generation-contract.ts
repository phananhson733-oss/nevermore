// @input -- frozen research, scoped first-party evidence and optional versioned SERP snapshot
// @output -- v2/v3 Brief assembly and confirmed delivery vocabulary
// @pos -- v3 adds actual SERP evidence; historical v2 bytes and v1 exports retain their contracts
import type { LlmReadMeta, ProfileFact, SerpObservation, SerpReadMeta } from "./contract.ts";
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
  /** Required by Brief v3, forbidden by Brief v2; raw vendor URL is source data, not a safe link. */
  readonly serp?: {
    readonly rows: readonly SerpObservation[];
    readonly read: SerpReadMeta;
  };
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

/** One title the article could carry, with the one-sentence reason for it. */
export interface BriefV2TitleOption {
  readonly value: string;
  readonly rationale: string;
}

/**
 * The article title the brief recommends, plus the other framings it considered.
 *
 * A title is the one string in a brief that gets published without passing
 * through the sentence model, so it carries no evidence_refs and can never be
 * treated as support for anything. What keeps it honest is subtraction: it may
 * not introduce a number, and it may not name an authority the excerpts never
 * supplied. Everything else about it -- length, capitalization, punctuation --
 * is the writer's judgment, not the server's.
 */
export interface BriefV2TitlePlan {
  readonly recommended: BriefV2TitleOption;
  readonly alternatives: readonly BriefV2TitleOption[];
}

/**
 * Editorial planning the run asked the model for, absent when it did not.
 *
 * Planning is guidance about what to write, never a fact: nothing here may be
 * cited by any sentence, in this brief or in the draft written from it. The key
 * is optional rather than nullable so a brief issued before planning existed
 * serializes to the same bytes, and therefore the same fingerprint, as it
 * always did.
 *
 * Its own members follow the same rule for the same reason: every layer added
 * after the first is optional, so a brief issued between two deploys stays
 * readable instead of failing the exact key set with a field nobody had yet.
 * title shipped with the key and is the one member always present.
 */
export interface BriefV2Planning {
  readonly title: BriefV2TitlePlan;
  readonly sections?: readonly BriefV2SectionPlan[];
}

/**
 * One sentence saying what a section is for, bound to the section it plans.
 *
 * The reader task the section completes and the supported coverage it uses to
 * do it, in one sentence -- the sentence an editor would write on the outline
 * before anyone starts drafting. It exists because six sections written from
 * six question lists and nothing else read as six answers rather than one
 * article; the writer of section four has no way to know what section two was
 * for.
 *
 * Bound by the generated section's O id, not by position: the operator may
 * reorder and rename the outline at confirmation, and the plan has to follow
 * the section it was written for rather than the slot it happened to sit in.
 *
 * It is never published. It reaches the draft's section prompt as writing
 * instruction, and every sentence written from it still passes the draft's own
 * claim rules, which is why it carries no evidence reference and needs none.
 */
export interface BriefV2SectionPlan {
  readonly section_id: string;
  readonly focus: string;
}

export interface BriefV2WritingPlan {
  readonly intent: { readonly value: "informational" | "commercial" | "transactional" | "navigational"; readonly rationale: string } | null;
  readonly format: { readonly value: "guide" | "listicle" | "comparison" | "product_page" | "tool" | "other"; readonly rationale: string } | null;
  readonly page_plan: BriefV2PagePlan;
  readonly gap_angle: { readonly value: string; readonly rationale: string; readonly fact_refs: readonly string[]; readonly sources: readonly string[] } | null;
  readonly internal_links: readonly { readonly page_ref: string; readonly anchor: string; readonly why: string }[];
  readonly do_not_cover: readonly { readonly page_ref: string; readonly topic: string; readonly why: string }[];
  /** Present only on a run that was offered the planning layer and got one. */
  readonly planning?: BriefV2Planning;
}

/**
 * The planning a model reply carries, before the server binds it to sections.
 *
 * A reply cannot name an O id: the ids are derived here from the outline it
 * returned. So the model sends one focus per section in outline order and the
 * server attaches the id, which is also what makes a mismatched count a
 * rejection rather than a silent misalignment.
 */
export interface ModelBriefV2Planning {
  readonly title: BriefV2TitlePlan;
  readonly sections?: readonly { readonly focus: string }[];
}

export interface ModelBriefV2Output extends Omit<BriefV2WritingPlan, "planning"> {
  readonly research: ModelResearchOutput;
  readonly planning?: ModelBriefV2Planning;
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
  readonly schema: "gengrowth.content_brief/v2" | "gengrowth.content_brief/v3";
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
  readonly schema: "gengrowth.confirmed_brief/v2" | "gengrowth.confirmed_brief/v3";
  readonly brief: ContentBriefV2;
  readonly revision: number;
  readonly confirmed_at: string;
  readonly outline: readonly ResearchOutlineItem[];
  /** Explicit resolution is required when the generated page action is undecidable. */
  readonly resolution: "accept_recommendation" | "create_despite_uncertainty";
  /**
   * The title the operator chose, when the run offered any.
   *
   * Absent, never empty: a confirmation made before titles existed, one whose
   * run produced no title, and one whose operator declined every title are the
   * same document, and they keep the fingerprint they always had. The value is
   * one of the strings the model returned and the server checked, not free
   * text -- a title is the one string in the brief no claim rule ever sees.
   */
  readonly title?: string;
  readonly fingerprint: string;
}
