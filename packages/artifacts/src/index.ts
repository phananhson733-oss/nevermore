// @sf/artifacts public surface (spec §10). Artifact generation + validation +
// enterprise export bundle assembly.

export * from "./types.ts";

// LLM adapter (spec §10.2).
export {
  OpenAIClient,
  createOpenAIClient,
  LLMError,
} from "./llm/openai-client.ts";
export type { OpenAIClientOptions, LLMErrorCode } from "./llm/openai-client.ts";
export {
  OpenAIFindingSummaryClient,
  createOpenAIFindingSummaryClient,
  MAX_FINDING_SUMMARY_CHARS,
  MAX_FINDING_SUMMARY_EVIDENCE,
  MAX_FINDING_SUMMARY_EVIDENCE_CLAIM_CHARS,
  MAX_FINDING_SUMMARY_SUBJECT_REFS,
} from "./llm/finding-summary-client.ts";
export type {
  FindingSummaryClient,
  FindingSummaryClientOptions,
  LLMFindingSummaryResult,
} from "./llm/finding-summary-client.ts";
export {
  OpenAIProductProfileClient,
  createOpenAIProductProfileClient,
  prepareProductProfileSynthesis,
  productProfilePageKeyForIndex,
  PRODUCT_PROFILE_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_SEMANTIC_PATHS,
  MAX_PRODUCT_PROFILE_PAGES,
  MAX_PRODUCT_PROFILE_H1,
  MAX_PRODUCT_PROFILE_HEADINGS,
  MAX_PRODUCT_PROFILE_PARAGRAPHS,
  MAX_PRODUCT_PROFILE_JSON_LD_TYPES,
  MAX_PRODUCT_PROFILE_RESPONSE_CHARS,
} from "./llm/product-profile-client.ts";
export type {
  ProductProfileClientOptions,
  ProductProfilePageDescriptor,
  ProductProfilePageKeyMapEntry,
  ProductProfileSemanticCandidateEnvelope,
  ProductProfileSynthesisClient,
  ProductProfileSynthesisInput,
  ProductProfileSynthesisPreflight,
  ProductProfileSynthesisResult,
} from "./llm/product-profile-client.ts";
export { buildProductProfileDraft } from "./product-profile-draft.ts";
export type { BuildProductProfileDraftInput } from "./product-profile-draft.ts";

// Deterministic templates (spec §10.1).
export {
  buildTemplateArtifact,
  buildContentBrief,
  buildMetadataRewrite,
  buildTechnicalTicket,
  assertTemplateArtifactLocale,
  normalizeTemplateArtifactLocale,
  UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE,
  UnsupportedTemplateLocaleError,
} from "./templates/index.ts";
export type { TemplateArtifactLocale } from "./templates/index.ts";

// Content Shadow brief -> draft structured extraction (spec §10.2, Task 4b).
export {
  aggregatePageAssignment,
  extractBriefSectionLabels,
  extractContentBriefOutline,
  sanitizeOutlineItem,
  MAX_BRIEF_OUTLINE_KEYWORDS,
  MAX_BRIEF_OUTLINE_KEYWORD_CHARS,
  MAX_BRIEF_OUTLINE_SECTIONS,
  MAX_BRIEF_OUTLINE_SECTION_CHARS,
} from "./brief/outline.ts";
export type {
  BriefKeywordMappingDecision,
  BriefKeywordMappingReviewState,
  BriefOutlineKeyword,
  BriefPageAssignment,
  ContentBriefOutline,
  ContentBriefOutlineExtraction,
} from "./brief/outline.ts";

// Prompt envelope helpers reused by the Content Shadow worker.
export {
  contentBriefOutlineSchema,
  safePromptContentBriefOutline,
} from "./llm/envelope.ts";

// Validators (spec §10.1, §14.4).
export {
  validateArtifact,
  validateMarkdownSections,
  validateMetadata,
} from "./validators/index.ts";
export type { ValidateArtifactOptions } from "./validators/index.ts";

// Enterprise export (spec §10.5).
export {
  assembleBundle,
  DEFAULT_BUNDLE_ASSEMBLY_LIMITS,
  ExportBundleLimitError,
} from "./export/bundle.ts";
export type {
  BundleAssemblyLimits,
  BundleInput,
  BundleArtifact,
  BundleArtifactRevision,
  BundleFindingEvidenceLink,
  BundleFinding,
  AssembledBundle,
} from "./export/bundle.ts";
export { buildManifest, mediaTypeFor } from "./export/manifest.ts";
export type {
  Manifest,
  ManifestFileEntry,
  ManifestItemCounts,
  BundleKind,
} from "./export/manifest.ts";
export { createZip, readZip } from "./export/zip.ts";
