/**
 * Artifact generation contracts (spec §10). Shared by the LLM adapter, the
 * deterministic template generator, the validators, and the export assembler.
 * The prompt input is an ALLOWLIST (§10.2): it never carries OAuth tokens, full
 * raw CSV, unfiltered site text, other projects' content, or logs.
 */

import type { ContentBriefOutline } from "./brief/outline.ts";

export type ArtifactType =
  | "content_brief"
  | "metadata_rewrite"
  | "technical_ticket"
  | "english_blog_draft";
export type GenerationMode = "template" | "structured_llm";
export type ContentFormat = "markdown" | "json" | "csv";

/** The canonical content format for each artifact type (spec §10.1). */
export const ARTIFACT_FORMAT: Record<ArtifactType, ContentFormat> = {
  content_brief: "markdown",
  metadata_rewrite: "json",
  technical_ticket: "markdown",
  english_blog_draft: "markdown",
};

export const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";

/**
 * The validator-aligned technical-ticket prompt contract.
 *
 * This version is scoped because `PROMPT_SET_VERSION` is also persisted by the
 * diagnostic pipeline and is pinned by a database CHECK. Technical tickets are
 * recorded in `analysis_invocations`, whose prompt version is intentionally an
 * unconstrained ledger value, so changing this one prompt must not drift queued
 * diagnostics or the unrelated content-brief and metadata prompts.
 */
export const TECHNICAL_TICKET_PROMPT_SET_VERSION =
  "mvp.prompts.technical-ticket.0.3.0";

/**
 * The prompt set for the Content Shadow English draft (Slice 2 Task 4b).
 *
 * SCOPED, not global. `PROMPT_SET_VERSION` is pinned by a DB CHECK on
 * `diagnostic_runs.prompt_set_version`, so bumping it globally would require a
 * migration, the authority schema, both verifiers and ~40 fixtures — and would
 * make every queued DIAGNOSTIC run drift, for a change that only touches the
 * `english_blog_draft` prompt. `analysis_invocations.prompt_set_version` has no
 * CHECK and the repository already carries a scoped precedent
 * (`PRODUCT_PROFILE_PROMPT_SET_VERSION`), so the draft prompt gets its own,
 * semantically precise name. The content-brief and metadata prompts keep the
 * global version, while the independently changed technical-ticket prompt has
 * its own scoped version. This stays honest because `contentBriefOutline` is
 * gated to `english_blog_draft` and cannot alter any of those other prompts.
 *
 * This is the ONE definition the accepting service, the worker replay guard and
 * the LLM client all read. They used to read two different constants that
 * merely happened to be equal.
 */
export const CONTENT_SHADOW_PROMPT_SET_VERSION =
  "mvp.prompts.content-shadow.0.4.0";

/** Closed task vocabulary persisted by AnalysisInvocation. */
export const ANALYSIS_INVOCATION_TASKS = [
  "artifact_generation",
  "finding_summary",
  "product_profile_synthesis",
  "topic_model_generation",
  "keyword_governance_suggestion_generation",
  // The Content Shadow English draft call. It uses the same pinned markdown
  // envelope as artifact generation but belongs to a different, shadow-mode
  // pipeline, so its invocations stay separately auditable (Slice 2 D4).
  "content_shadow_draft",
] as const;
export type AnalysisInvocationTask = (typeof ANALYSIS_INVOCATION_TASKS)[number];

/** Maximum items accepted by any bounded artifact prompt/output collection. */
export const MAX_ARTIFACT_COLLECTION_ITEMS = 100;

/** Maximum evidence rows admitted to one artifact-generation prompt. */
export const MAX_ARTIFACT_EVIDENCE_ROWS = 100;

/** A short evidence excerpt allowlisted into the prompt (numbers + claim only). */
export interface EvidenceExcerpt {
  readonly evidenceId: string;
  readonly claim: string;
  readonly grade: string;
  readonly subjectRefs: readonly string[];
  readonly observedAt: string;
}

/** Allowlisted ICP fields for the prompt (spec §10.2). */
export interface PromptIcp {
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly offers: readonly string[];
  readonly useCases: readonly string[];
  readonly differentiators: readonly string[];
  readonly primaryConversion: {
    readonly label: string;
    readonly type: string;
    readonly targetUrl: string | null;
  } | null;
  readonly marketCodes: readonly string[];
}

export interface PromptAction {
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly expectedOutcome: string;
  readonly effort: string;
  readonly risk: string;
}

export interface PromptFinding {
  readonly ruleId: string;
  readonly domain: string;
  readonly summary: string;
  readonly severity: string;
  readonly confidence: string;
  readonly subjectRefs: readonly string[];
}

/** Frozen crawl metadata for a metadata rewrite target; unknown values stay null. */
export interface PromptCurrentMetadata {
  readonly url: string | null;
  readonly currentTitle: string | null;
  readonly currentDescription: string | null;
}

/**
 * One immutable, bounded research excerpt admitted to the English Blog prompt.
 *
 * The full retrieved page body is deliberately absent: the model receives only
 * the excerpt selected by the governed research stage plus the source identity,
 * capture time, and content hash needed to audit that selection.
 */
export interface PromptResearchSource {
  readonly sourceRef: string;
  readonly kind: string;
  readonly label: string;
  readonly url: string;
  readonly availability: string;
  readonly authorityTier: string;
  readonly capturedAt: string;
  readonly contentHash: string;
  readonly excerpt: string;
  readonly evidenceRefs: readonly string[];
  readonly limitation: string;
}

/** Customer-confirmed brand/compliance rules frozen with the research pack. */
export interface PromptContentPolicy {
  readonly brandConstraints: readonly string[];
  readonly complianceConstraints: readonly string[];
  readonly prohibitedTerms: readonly string[];
  /**
   * Customer-specific restrictions stay verbatim instead of being narrowed to
   * three built-in rules. The prompt boundary still sanitizes and bounds every
   * entry before it leaves the process.
   */
  readonly claimRestrictions: readonly string[];
}

/** Governed research projection available only to `english_blog_draft`. */
export interface PromptResearchContext {
  readonly sources: readonly PromptResearchSource[];
  readonly policy: PromptContentPolicy;
}

/** The full allowlisted artifact generation input. */
export interface ArtifactPromptInput {
  readonly artifactType: ArtifactType;
  readonly outputLocale: string;
  readonly operatorInstructions: string | null;
  readonly icp: PromptIcp;
  readonly action: PromptAction;
  readonly finding: PromptFinding;
  readonly currentMetadata: PromptCurrentMetadata;
  readonly evidence: readonly EvidenceExcerpt[];
  /** Whether the source action is a high-risk technical change (spec §9.3 step 8). */
  readonly requiresValidationRollback: boolean;
  /**
   * Structured extraction of the pinned `content_brief` revision. Only
   * `english_blog_draft` prompts carry it (spec §10.2); every other artifact
   * type passes `null` and its prompt bytes are unchanged. `null` means "no
   * outline was supplied", which is NOT the same value as an outline whose
   * `briefSections` is empty ("the brief carried no readable outline").
   */
  readonly contentBriefOutline: ContentBriefOutline | null;
  /**
   * Frozen research excerpts and content policy for the English Blog draft.
   * Every other artifact type passes `null`, preserving its prompt bytes and
   * preventing research-page text from leaking into unrelated generation.
   */
  readonly researchContext: PromptResearchContext | null;
}

/** Built artifact content — a markdown/csv string or a metadata JSON object. */
export interface ArtifactContent {
  readonly contentFormat: ContentFormat;
  readonly content: string | Record<string, unknown>;
}

export interface ArtifactValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Immutable record of one model call (spec §10.2). No prompt/output text. */
export interface AnalysisInvocationRecord {
  readonly task: AnalysisInvocationTask;
  readonly provider: string;
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly status: "succeeded" | "failed" | "rejected";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export interface LLMArtifactResult {
  readonly content: ArtifactContent;
  readonly invocation: AnalysisInvocationRecord;
}

/** The LLM client contract (OpenAI is the first-release implementation, §10.2). */
export interface LLMClient {
  generateArtifact(input: ArtifactPromptInput): Promise<LLMArtifactResult>;
}
