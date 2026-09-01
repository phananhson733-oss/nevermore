// @input -- frozen page/PAA observations and one model's source-bound research output
// @output -- the v2 research vocabulary shared by extraction, assembly, validation and Draft
// @pos -- explicit new semantics; never changes the legacy v1 contract or parser

export const CONTENT_BRIEF_V2_SCHEMA = "gengrowth.content_brief/v2" as const;
export const CONTENT_BRIEF_V3_SCHEMA = "gengrowth.content_brief/v3" as const;
export const RESEARCH_SEGMENT_MAX_CHARS = 300;
export const RESEARCH_HEADING_MAX_CHARS = 160;
export const RESEARCH_SEGMENTS_PER_PAGE = 12;
export const RESEARCH_PAGE_UNITS_MAX = 60;
export const RESEARCH_PAA_MAX = 8;
export const RESEARCH_QUESTION_MAX = 8;
export const RESEARCH_OUTLINE_MAX = 7;
export const RESEARCH_QUESTION_MAX_CHARS = 400;
export const RESEARCH_PROMPT_MAX_BYTES = 48 * 1024;
/** Leaves room in the 256 KiB handoff for the plan, metadata and confirmed edits. */
export const RESEARCH_BUNDLE_MAX_BYTES = 128 * 1024;

export interface ResearchHeading {
  readonly level: "h2" | "h3";
  readonly text: string;
}

export interface ResearchSegment {
  readonly heading: ResearchHeading | null;
  readonly text: string;
  /** The segment is a bounded excerpt, not the whole underlying section. */
  readonly truncated: boolean;
}

export interface ResearchLength {
  readonly value: number;
  readonly unit: "words" | "non_whitespace_characters";
  readonly tokenizer: "whitespace" | "unicode_code_points";
}

/** Descriptive observed length only; neither measure is a ranking target. */
export function measureResearchLength(text: string, language: string): ResearchLength {
  const primaryLanguage = language.toLowerCase().split(/[-_]/)[0];
  const containsUnspacedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(text);
  if (["zh", "ja", "ko", "th"].includes(primaryLanguage ?? "") || containsUnspacedScript) {
    return { value: Array.from(text.replace(/\s/gu, "")).length, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" };
  }
  return { value: text.trim() === "" ? 0 : text.trim().split(/\s+/u).length, unit: "words", tokenizer: "whitespace" };
}

/**
 * Counts describe cleaned material observed in the HTTP response, not a whole
 * site. They are acquisition metadata: omitted text cannot be reconstructed
 * from retained excerpts. Shape/invariant validation is not authentication of
 * a user-supplied observation (nor is its eventual content fingerprint).
 */
export interface ExtractedPageResearch {
  readonly segments: readonly ResearchSegment[];
  readonly segments_total: number;
  readonly omitted_segments: number;
  readonly length: ResearchLength;
}

export interface ResearchPage {
  readonly id: string;
  readonly role: "competitor" | "owned";
  readonly url: string;
  readonly final_url: string;
  readonly fetched_at: string;
  readonly content_hash: string;
  readonly body_complete: boolean;
  readonly research: ExtractedPageResearch;
}

export interface ResearchPaaQuestion {
  readonly id: string;
  readonly question: string;
  readonly seed_question: string | null;
}

export type ResearchUnit =
  | {
      readonly id: string;
      readonly kind: "page";
      readonly page_ref: string;
      readonly segment_index: number;
    }
  | {
      readonly id: string;
      readonly kind: "paa";
      readonly paa_ref: string;
    };

export interface ResearchBundle {
  readonly pages: readonly ResearchPage[];
  readonly paa: readonly ResearchPaaQuestion[];
  readonly units: readonly ResearchUnit[];
  readonly budget: {
    readonly page_units_available: number;
    readonly page_units_retained: number;
    readonly page_units_omitted: number;
    readonly paa_available: number;
    readonly paa_retained: number;
    readonly paa_duplicates: number;
    readonly paa_omitted: number;
  };
}

/** Anchors are existing source-unit ids. Only the server assigns final question ids. */
export interface ModelResearchQuestion {
  readonly anchor: string;
  readonly q: string;
  readonly sources: readonly string[];
}

export interface ModelResearchOutline {
  readonly h2: string;
  readonly h3: readonly string[];
  readonly answers: readonly string[];
}

export interface ModelResearchOutput {
  readonly questions: readonly ModelResearchQuestion[];
  readonly outline: readonly ModelResearchOutline[];
}

export interface ResearchQuestion {
  readonly id: string;
  readonly anchor: string;
  readonly q: string;
  readonly source_refs: readonly string[];
  /** Computed from distinct competitor final-page identities; PAA and owned pages add none. */
  readonly covered_by: number;
  readonly paa_refs: readonly string[];
}

export interface ResearchOutlineItem {
  readonly id: string;
  readonly h2: string;
  readonly h3: readonly string[];
  readonly answers: readonly string[];
}

export interface ResearchResult {
  readonly questions: readonly ResearchQuestion[];
  readonly outline: readonly ResearchOutlineItem[];
}
