// @input -- one exact confirmed Brief v2 or v3 revision
// @output -- explicit Draft v2 delivery, usage and rerun vocabulary
// @pos -- separate from the historical v1 Draft contract
import type { CoverageItem, DraftResult, LlmAggregateMeta, LlmReadMeta, RunMode, SectionFailReason, Unavailable } from "./contract.ts";
import type { SectionCallMeta } from "./draft-assemble.ts";
import { DRAFT_RESULT_MAX_BYTES, DRAFT_V2_QUALITY_MAX, QUALITY_WARNING_BYTES } from "./constants.ts";
import { CONFIRMED_BRIEF_V2_MAX_BYTES } from "./v2-brief.ts";
import type { ResearchLength } from "./v2-contract.ts";
import type { DraftV2Warning } from "./v2-draft-prose.ts";
import type { DraftV2SectionBody } from "./v2-draft-section.ts";

export const DRAFT_V2_SCHEMA = "gengrowth.content_draft/v2";
export const DRAFT_V2_PROMPT_MAX_BYTES = 96 * 1024;
/**
 * Adds <=20160 JSON bytes for 7*3*160 H3 characters, plus <12KiB of
 * length/revision metadata, plus the writing-warning list. The section endpoint
 * carries the whole previous result, so a delivery that legitimately fills the
 * warning list has to stay inside the request limit derived from this.
 */
export const DRAFT_V2_MAX_BYTES = DRAFT_RESULT_MAX_BYTES + 32 * 1024 + DRAFT_V2_QUALITY_MAX * QUALITY_WARNING_BYTES;
export const DRAFT_V2_REQUEST_MAX_BYTES = CONFIRMED_BRIEF_V2_MAX_BYTES + 16 * 1024;
export const DRAFT_V2_SECTION_REQUEST_MAX_BYTES = CONFIRMED_BRIEF_V2_MAX_BYTES + DRAFT_V2_MAX_BYTES + 16 * 1024;

export type DraftV2Settings = DraftResult["settings"];
export type DraftV2Call = Omit<SectionCallMeta, "status" | "fail_reason">;
export type DraftV2SectionGeneration =
  | { readonly status: "ok"; readonly body: DraftV2SectionBody; readonly llm: DraftV2Call }
  | { readonly status: "failed"; readonly fail_reason: SectionFailReason; readonly llm: DraftV2Call };
export interface DraftV2SectionHeading {
  readonly id: string;
  readonly h2: string;
  readonly h3: readonly string[];
  readonly answers: readonly string[];
}
export type DraftV2Section =
  | (DraftV2SectionHeading & { readonly status: "ok"; readonly body: DraftV2SectionBody; readonly llm: DraftV2Call })
  | (DraftV2SectionHeading & { readonly status: "failed"; readonly fail_reason: SectionFailReason; readonly llm: DraftV2Call })
  | (DraftV2SectionHeading & { readonly status: "skipped" });

export type DraftV2Coverage =
  | {
    readonly status: "available";
    readonly items: readonly CoverageItem[];
    readonly total: number;
    readonly covered: number;
    readonly partial: number;
    readonly none: number;
    /** With no generated text, absence of coverage is deterministic, not a model judgement. */
    readonly method: "model" | "empty_draft";
  }
  | Unavailable;

/** One image the owner still has to make: a prompt for an image model and the alt text to publish with it. */
export interface DraftV2ImagePrompt {
  /** Written for an image model; English regardless of article language, which is what those models read best. */
  readonly prompt: string;
  /** Written in the article language; describes the picture, not the paragraph. */
  readonly alt: string;
}
/**
 * The draft's image plan: one hero and one illustration per generated section.
 * Nothing here is an image -- the tool draws nothing and stores nothing.
 */
export type DraftV2ImagePrompts =
  | {
    readonly status: "available";
    readonly hero: DraftV2ImagePrompt;
    /** Exactly the sections with status "ok", in confirmed order. */
    readonly sections: readonly (DraftV2ImagePrompt & { readonly section_id: string })[];
    readonly read: LlmReadMeta;
  }
  | { readonly status: "unavailable"; readonly reason: Unavailable["reason"]; readonly read: LlmReadMeta };

export interface DraftV2VerifyItem {
  readonly sentence: string;
  readonly section_id: string;
  readonly kind: "single_source" | "profile_only" | "gap" | "stance";
  readonly support_count: number;
  readonly evidence_refs: readonly string[];
}
export interface DraftV2Rerun {
  readonly previous_run_id: string;
  readonly previous_fingerprint: string;
  readonly section_id: string;
}
export interface DraftV2Quality {
  readonly warnings: readonly DraftV2Warning[];
}

export interface DraftResultV2 {
  readonly schema: typeof DRAFT_V2_SCHEMA;
  readonly confirmed_ref: {
    readonly schema: "gengrowth.confirmed_brief/v2" | "gengrowth.confirmed_brief/v3";
    readonly fingerprint: string;
    readonly revision: number;
    readonly brief_run_id: string;
    readonly keyword: string;
  };
  readonly settings: DraftV2Settings;
  readonly sections: readonly DraftV2Section[];
  readonly coverage: DraftV2Coverage;
  readonly verify_before_publish: readonly DraftV2VerifyItem[];
  readonly totals: ResearchLength;
  /**
   * Present only on a draft that attempted the image plan. Its own model read
   * lives inside it rather than in run.reads on purpose: a stored draft's run
   * fingerprint is recomputed from its parsed body on every rerun, so a key
   * added anywhere a draft written before image prompts existed would fail that
   * draft with brief_fingerprint_mismatch. Absent means never attempted;
   * unavailable means attempted and not delivered.
   */
  readonly image_prompts?: DraftV2ImagePrompts;
  /**
   * The writing warnings derived from this draft's own prose.
   *
   * Optional for the same reason image_prompts is: a draft written before these
   * checks existed carries no such key, and its run fingerprint was computed
   * without one, so requiring the key would fail a rerun of prose the owner
   * still has open. Absent therefore means "written before the checks", and
   * present with an empty list means "checked, nothing to report" -- two
   * different statements that must not collapse into one.
   */
  readonly quality?: DraftV2Quality;
  readonly run: {
    readonly run_id: string;
    readonly collected_at: string;
    readonly elapsed_ms: number;
    readonly budget_ms: number;
    readonly mode: RunMode;
    readonly rerun: DraftV2Rerun | null;
    readonly reads: {
      readonly sections: { readonly requested: number; readonly ok: number; readonly failed: number; readonly skipped: number };
      /** Only the changed section's call on a rerun; all requested calls on an initial run. */
      readonly llm_sections: LlmAggregateMeta;
      readonly llm_coverage: LlmReadMeta;
    };
    readonly fingerprint: string;
  };
}
