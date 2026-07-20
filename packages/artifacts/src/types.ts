/**
 * Artifact generation contracts (spec §10). Shared by the LLM adapter, the
 * deterministic template generator, the validators, and the export assembler.
 * The prompt input is an ALLOWLIST (§10.2): it never carries OAuth tokens, full
 * raw CSV, unfiltered site text, other projects' content, or logs.
 */

export type ArtifactType = "content_brief" | "metadata_rewrite" | "technical_ticket";
export type GenerationMode = "template" | "structured_llm";
export type ContentFormat = "markdown" | "json" | "csv";

/** The canonical content format for each artifact type (spec §10.1). */
export const ARTIFACT_FORMAT: Record<ArtifactType, ContentFormat> = {
  content_brief: "markdown",
  metadata_rewrite: "json",
  technical_ticket: "markdown",
};

export const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";

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
  readonly primaryConversion: { readonly label: string; readonly type: string; readonly targetUrl: string | null } | null;
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
  readonly task: string;
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
