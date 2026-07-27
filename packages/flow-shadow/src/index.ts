// @sf/flow-shadow public surface: the pinned, extraction-only Content Shadow
// Flow adapter. Pure and I/O-free — no clock, randomness, network, filesystem,
// database, or runtime import of the sibling `gengrowth-flow-mvp` repository
// (Slice 2 red line D). Domain ownership is exact-host and dependency-free.

export * from "./types.ts";
export { CONTENT_SHADOW_ADAPTER_VERSION } from "./version.ts";
export {
  FIRST_PARTY_SOURCE_KINDS,
  isFirstPartySourceKind,
  normalizeFirstPartyUrl,
} from "./first-party.ts";
export {
  isUrlOwnedByFirstPartySite,
  normalizeFirstPartySiteOrigin,
} from "./first-party-site.ts";
export {
  assertObservationSeparation,
  buildContentShadowInputManifest,
  canonicalizeContentShadowResearchContext,
  ContentShadowFirstPartyIdentityError,
  ContentShadowFirstPartyPageOwnershipError,
  ContentShadowObservationSeparationError,
  ContentShadowResearchContextBoundsError,
  ContentShadowResearchContextConflictError,
  CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS,
} from "./research/manifest.ts";
export {
  extractContentBriefExternalTargets,
  MAX_CONTENT_BRIEF_EXTERNAL_TARGETS,
} from "./research/external-targets.ts";
export {
  buildResearchPack,
  CONTENT_SHADOW_OUTLINE,
  MAX_RESEARCH_PACK_CONTENT_CHARS,
  MAX_RESEARCH_PACK_SOURCES,
  MAX_RESEARCH_SOURCE_CONTENT_CHARS,
  MAX_RESEARCH_SOURCE_EXCERPT_CHARS,
  ResearchSnapshotIntegrityError,
  researchPackToJson,
} from "./research/research-pack.ts";
export * from "./qa/index.ts";
