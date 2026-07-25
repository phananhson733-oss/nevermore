// @sf/flow-shadow public surface: the pinned, extraction-only Content Shadow
// Flow adapter. Pure and dependency-free — no clock, no randomness, no network,
// no database, and never a runtime import of the sibling `gengrowth-flow-mvp`
// repository (Slice 2 red line D).

export * from "./types.ts";
export { CONTENT_SHADOW_ADAPTER_VERSION } from "./version.ts";
export {
  FIRST_PARTY_SOURCE_KINDS,
  isFirstPartySourceKind,
  normalizeFirstPartyUrl,
} from "./first-party.ts";
export {
  assertObservationSeparation,
  buildContentShadowInputManifest,
  ContentShadowObservationSeparationError,
} from "./research/manifest.ts";
export {
  buildResearchPack,
  researchPackToJson,
  CONTENT_SHADOW_OUTLINE,
} from "./research/research-pack.ts";
export * from "./qa/index.ts";
