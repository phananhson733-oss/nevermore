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

// Deterministic templates (spec §10.1).
export {
  buildTemplateArtifact,
  buildContentBrief,
  buildMetadataRewrite,
  buildTechnicalTicket,
} from "./templates/index.ts";

// Validators (spec §10.1, §14.4).
export {
  validateArtifact,
  validateMarkdownSections,
  validateMetadata,
} from "./validators/index.ts";
export type { ValidateArtifactOptions } from "./validators/index.ts";

// Enterprise export (spec §10.5).
export { assembleBundle } from "./export/bundle.ts";
export type {
  BundleInput,
  BundleArtifact,
  BundleArtifactRevision,
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
