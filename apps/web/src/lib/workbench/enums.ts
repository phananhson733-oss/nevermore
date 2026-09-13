/**
 * Runtime id lists for every domain enum (design §7, ruling R2). Labels live in
 * `workbench.enums.<group>.<id>`; `enums-i18n.test.ts` asserts both locales
 * carry exactly these ids. Order is meaningful where a builder depends on it
 * (`KB_CATEGORIES`, `PROMPT_KINDS`, `LINK_TYPES`), so do not reorder those.
 */
import type {
  ArtifactType,
  Engine,
  GscStatus,
  Intent,
  KbCategory,
  KbOrigin,
  KeywordSource,
  Level,
  LinkType,
  ModuleId,
  PageType,
  PromptKind,
  SavedSource,
  Severity,
  Stage,
} from "./types.ts";

export const SEVERITIES = [
  "high",
  "mid",
  "low",
] as const satisfies readonly Severity[];
export const ENGINES = [
  "seo",
  "geo",
  "both",
] as const satisfies readonly Engine[];
export const LEVELS = [
  "high",
  "mid",
  "low",
] as const satisfies readonly Level[];
export const GSC_STATUSES = [
  "ranked",
  "borderline",
  "gap",
  "unknown",
] as const satisfies readonly GscStatus[];
export const INTENTS = [
  "navigational",
  "informational",
  "commercial",
  "transactional",
] as const satisfies readonly Intent[];
export const STAGES = [
  "TOFU",
  "MOFU",
  "BOFU",
] as const satisfies readonly Stage[];
export const PAGE_TYPES = [
  "landing",
  "blog",
  "comparison",
  "listicle",
  "tool",
  "glossary",
  "answer-page",
] as const satisfies readonly PageType[];
export const KEYWORD_SOURCES = [
  "gsc",
  "generated",
] as const satisfies readonly KeywordSource[];
export const SAVED_SOURCES = [
  "matrix",
  "manual",
  "gap",
] as const satisfies readonly SavedSource[];
export const PROMPT_KINDS = [
  "discover",
  "compare",
  "verify",
  "alternative",
  "scenario",
] as const satisfies readonly PromptKind[];
/** `kbMarkdown` emits one section per category in this order. */
export const KB_CATEGORIES = [
  "definition",
  "capability",
  "boundary",
  "pricing",
  "comparison",
  "data",
  "faq",
] as const satisfies readonly KbCategory[];
export const KB_ORIGINS = [
  "crawl",
  "gap",
  "aiDraft",
  "manual",
] as const satisfies readonly KbOrigin[];
export const LINK_TYPES = [
  "dir",
  "agg",
  "comm",
  "rev",
  "media",
  "swap",
] as const satisfies readonly LinkType[];
export const ARTIFACT_TYPES = [
  "csv",
  "prompt",
  "md",
  "json",
] as const satisfies readonly ArtifactType[];
export const MODULE_IDS = [
  "audit",
  "visibility",
  "keywords",
  "keywordLibrary",
  "competitors",
  "links",
  "content",
  "kb",
  "answers",
  "profile",
  "week",
] as const satisfies readonly ModuleId[];
/** Content asset kinds have no domain type of their own; the array is the source of truth. */
export const CONTENT_ASSETS = [
  "blog",
  "landing",
  "tool",
  "comparison",
  "image",
  "video",
] as const;
export type ContentAsset = (typeof CONTENT_ASSETS)[number];

/**
 * Exhaustiveness guards. `satisfies readonly X[]` above rejects an id outside
 * the union; each alias below fails to compile when the union has an id the
 * array lacks.
 */
type AssertNever<T extends never> = T;
type _SeverityCovered = AssertNever<
  Exclude<Severity, (typeof SEVERITIES)[number]>
>;
type _EngineCovered = AssertNever<Exclude<Engine, (typeof ENGINES)[number]>>;
type _LevelCovered = AssertNever<Exclude<Level, (typeof LEVELS)[number]>>;
type _GscStatusCovered = AssertNever<
  Exclude<GscStatus, (typeof GSC_STATUSES)[number]>
>;
type _IntentCovered = AssertNever<Exclude<Intent, (typeof INTENTS)[number]>>;
type _StageCovered = AssertNever<Exclude<Stage, (typeof STAGES)[number]>>;
type _PageTypeCovered = AssertNever<
  Exclude<PageType, (typeof PAGE_TYPES)[number]>
>;
type _KeywordSourceCovered = AssertNever<
  Exclude<KeywordSource, (typeof KEYWORD_SOURCES)[number]>
>;
type _SavedSourceCovered = AssertNever<
  Exclude<SavedSource, (typeof SAVED_SOURCES)[number]>
>;
type _PromptKindCovered = AssertNever<
  Exclude<PromptKind, (typeof PROMPT_KINDS)[number]>
>;
type _KbCategoryCovered = AssertNever<
  Exclude<KbCategory, (typeof KB_CATEGORIES)[number]>
>;
type _KbOriginCovered = AssertNever<
  Exclude<KbOrigin, (typeof KB_ORIGINS)[number]>
>;
type _LinkTypeCovered = AssertNever<
  Exclude<LinkType, (typeof LINK_TYPES)[number]>
>;
type _ArtifactTypeCovered = AssertNever<
  Exclude<ArtifactType, (typeof ARTIFACT_TYPES)[number]>
>;
type _ModuleIdCovered = AssertNever<
  Exclude<ModuleId, (typeof MODULE_IDS)[number]>
>;

/** Keyed by the `workbench.enums.<group>` message group name. */
export const ENUM_GROUPS = {
  severity: SEVERITIES,
  engine: ENGINES,
  level: LEVELS,
  gscStatus: GSC_STATUSES,
  intent: INTENTS,
  stage: STAGES,
  pageType: PAGE_TYPES,
  keywordSource: KEYWORD_SOURCES,
  savedSource: SAVED_SOURCES,
  promptKind: PROMPT_KINDS,
  kbCategory: KB_CATEGORIES,
  kbOrigin: KB_ORIGINS,
  linkType: LINK_TYPES,
  artifactType: ARTIFACT_TYPES,
  module: MODULE_IDS,
  contentAsset: CONTENT_ASSETS,
} as const;
