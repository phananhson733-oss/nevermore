// @input -- one exact confirmed Brief v2 revision
// @output -- explicit Draft v2 delivery, usage and rerun vocabulary
// @pos -- separate from the historical v1 Draft contract
import type { CoverageItem, DraftResult, LlmAggregateMeta, LlmReadMeta, RunMode, SectionFailReason, Unavailable } from "./contract.ts";
import type { SectionCallMeta } from "./draft-assemble.ts";
import { DRAFT_RESULT_MAX_BYTES } from "./constants.ts";
import { CONFIRMED_BRIEF_V2_MAX_BYTES } from "./v2-brief.ts";
import type { ResearchLength } from "./v2-contract.ts";
import type { DraftV2SectionBody } from "./v2-draft-section.ts";

export const DRAFT_V2_SCHEMA = "gengrowth.content_draft/v2";
export const DRAFT_V2_PROMPT_MAX_BYTES = 96 * 1024;
/** Adds <=20160 JSON bytes for 7*3*160 H3 characters, plus <12KiB of length/revision metadata. */
export const DRAFT_V2_MAX_BYTES = DRAFT_RESULT_MAX_BYTES + 32 * 1024;
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
export interface DraftResultV2 {
  readonly schema: typeof DRAFT_V2_SCHEMA;
  readonly confirmed_ref: {
    readonly schema: "gengrowth.confirmed_brief/v2";
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
