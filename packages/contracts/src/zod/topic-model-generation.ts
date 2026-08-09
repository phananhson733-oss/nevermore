import { z } from "zod";
import { Bcp47Locale, IsoDateTime, MarketCode, Uuid } from "./common.ts";
import { MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION } from "./keyword-governance.ts";

export const TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION =
  "topic-model-generation-input.v1" as const;
export const MAX_TOPIC_MODEL_GENERATION_GROUPS = 100;
export const MAX_TOPIC_MODEL_GENERATION_KEYWORDS = 500;

const MAX_REPRESENTATIVE_KEYWORDS = 12;
const MAX_URLS_PER_GROUP = 8;
const MAX_GROUP_KEY_CHARS = 128;
const MAX_KEYWORD_CHARS = 240;
const MAX_URL_CHARS = 2_048;
const MAX_FACT_CHARS = 500;
const MAX_FACT_ITEMS = 20;
const MAX_GROUP_KEYWORD_COUNT = 1_000_000;
const GROUP_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const BoundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), "Must already be trimmed");
const NullableBoundedText = (maximum: number) =>
  BoundedText(maximum).nullable();
const UniqueTextList = (maximum: number, itemMaximum: number) =>
  z
    .array(BoundedText(itemMaximum))
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: "Values must be unique",
    });
const NonNegativeSafeInteger = z.number().int().nonnegative().safe();

export const TopicModelGenerationSearchIntent = z.enum([
  "informational",
  "navigational",
  "commercial",
  "transactional",
]);
export type TopicModelGenerationSearchIntent = z.infer<
  typeof TopicModelGenerationSearchIntent
>;

export const TopicModelGenerationProviderIntentDistribution = z
  .object({
    informational: NonNegativeSafeInteger,
    navigational: NonNegativeSafeInteger,
    commercial: NonNegativeSafeInteger,
    transactional: NonNegativeSafeInteger,
  })
  .strict();
export type TopicModelGenerationProviderIntentDistribution = z.infer<
  typeof TopicModelGenerationProviderIntentDistribution
>;

const TopicModelGenerationUrl = BoundedText(MAX_URL_CHARS).superRefine(
  (value, ctx) => {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        url.username !== "" ||
        url.password !== ""
      ) {
        ctx.addIssue({
          code: "custom",
          message: "URL must be credential-free HTTP(S)",
        });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "URL is invalid" });
    }
  },
);

export const TopicModelGenerationGroup = z
  .object({
    groupKey: BoundedText(MAX_GROUP_KEY_CHARS).regex(GROUP_KEY),
    representativeKeywords: z
      .array(BoundedText(MAX_KEYWORD_CHARS))
      .min(1)
      .max(MAX_REPRESENTATIVE_KEYWORDS)
      .refine((values) => new Set(values).size === values.length, {
        message: "Representative keywords must be unique",
      }),
    keywordCount: NonNegativeSafeInteger.positive().max(
      MAX_GROUP_KEYWORD_COUNT,
    ),
    aggregateSearchVolume: NonNegativeSafeInteger.nullable(),
    providerIntentDistribution:
      TopicModelGenerationProviderIntentDistribution,
    urls: z
      .array(TopicModelGenerationUrl)
      .max(MAX_URLS_PER_GROUP)
      .refine((values) => new Set(values).size === values.length, {
        message: "URLs must be unique",
      }),
  })
  .strict();
export type TopicModelGenerationGroup = z.infer<
  typeof TopicModelGenerationGroup
>;

export const TopicModelGenerationProductProfileFacts = z
  .object({
    productName: NullableBoundedText(MAX_FACT_CHARS),
    oneLiner: NullableBoundedText(MAX_FACT_CHARS),
    category: NullableBoundedText(MAX_FACT_CHARS),
    valueProposition: NullableBoundedText(MAX_FACT_CHARS),
    coreFeatures: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
  })
  .strict();
export type TopicModelGenerationProductProfileFacts = z.infer<
  typeof TopicModelGenerationProductProfileFacts
>;

export const TopicModelGenerationIcpFacts = z
  .object({
    targetCompanyOrAudience: NullableBoundedText(MAX_FACT_CHARS),
    buyerRoles: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
    userRoles: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
    useCases: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
    pains: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
    outcomes: UniqueTextList(MAX_FACT_ITEMS, MAX_FACT_CHARS),
  })
  .strict();
export type TopicModelGenerationIcpFacts = z.infer<
  typeof TopicModelGenerationIcpFacts
>;

export const TopicModelGenerationProviderSearchIntent = z
  .object({
    value: TopicModelGenerationSearchIntent.nullable(),
    snapshotId: Uuid,
    observationId: Uuid,
    observedAt: IsoDateTime,
  })
  .strict();
export type TopicModelGenerationProviderSearchIntent = z.infer<
  typeof TopicModelGenerationProviderSearchIntent
>;

export const TopicModelGenerationKeyword = z
  .object({
    keywordId: Uuid,
    expectedGovernanceRevision: NonNegativeSafeInteger.max(
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
    ),
    groupKey: BoundedText(MAX_GROUP_KEY_CHARS).regex(GROUP_KEY),
    providerSearchIntent: TopicModelGenerationProviderSearchIntent.nullable(),
  })
  .strict();
export type TopicModelGenerationKeyword = z.infer<
  typeof TopicModelGenerationKeyword
>;

const SEARCH_INTENTS = TopicModelGenerationSearchIntent.options;

export const TopicModelGenerationInputManifest = z
  .object({
    schemaVersion: z.literal(TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION),
    analysisRefreshRunId: Uuid,
    projectId: Uuid,
    market: MarketCode,
    language: Bcp47Locale,
    groups: z
      .array(TopicModelGenerationGroup)
      .min(1)
      .max(MAX_TOPIC_MODEL_GENERATION_GROUPS),
    productProfile: TopicModelGenerationProductProfileFacts.nullable(),
    icp: TopicModelGenerationIcpFacts.nullable(),
    keywords: z
      .array(TopicModelGenerationKeyword)
      .min(1)
      .max(MAX_TOPIC_MODEL_GENERATION_KEYWORDS),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const groups = new Map<string, TopicModelGenerationGroup>();
    for (const [index, group] of manifest.groups.entries()) {
      if (groups.has(group.groupKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "groupKey"],
          message: "Group keys must be unique",
        });
      }
      groups.set(group.groupKey, group);
    }

    const keywordIds = new Set<string>();
    const observationIds = new Set<string>();
    const keywordCounts = new Map<string, number>();
    const intentCounts = new Map<
      string,
      Record<TopicModelGenerationSearchIntent, number>
    >();
    for (const [index, keyword] of manifest.keywords.entries()) {
      if (keywordIds.has(keyword.keywordId)) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords", index, "keywordId"],
          message: "Keyword ids must be unique",
        });
      }
      keywordIds.add(keyword.keywordId);
      if (!groups.has(keyword.groupKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords", index, "groupKey"],
          message: "Keyword group must exist",
        });
      }
      keywordCounts.set(
        keyword.groupKey,
        (keywordCounts.get(keyword.groupKey) ?? 0) + 1,
      );
      const provider = keyword.providerSearchIntent;
      if (provider === null) continue;
      if (observationIds.has(provider.observationId)) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords", index, "providerSearchIntent", "observationId"],
          message: "Provider observation ids must be unique",
        });
      }
      observationIds.add(provider.observationId);
      if (provider.value === null) continue;
      const counts = intentCounts.get(keyword.groupKey) ?? {
        informational: 0,
        navigational: 0,
        commercial: 0,
        transactional: 0,
      };
      counts[provider.value] += 1;
      intentCounts.set(keyword.groupKey, counts);
    }

    for (const [index, group] of manifest.groups.entries()) {
      if (group.representativeKeywords.length > group.keywordCount) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "representativeKeywords"],
          message: "Representative keywords cannot exceed keywordCount",
        });
      }
      if ((keywordCounts.get(group.groupKey) ?? 0) !== group.keywordCount) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "keywordCount"],
          message: "keywordCount must match frozen keyword references",
        });
      }
      const counts = intentCounts.get(group.groupKey) ?? {
        informational: 0,
        navigational: 0,
        commercial: 0,
        transactional: 0,
      };
      if (
        SEARCH_INTENTS.some(
          (intent) =>
            counts[intent] !== group.providerIntentDistribution[intent],
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "providerIntentDistribution"],
          message: "Provider intent counts must match frozen occurrences",
        });
      }
    }
  });
export type TopicModelGenerationInputManifest = z.infer<
  typeof TopicModelGenerationInputManifest
>;

export function parseTopicModelGenerationInputManifest(
  value: unknown,
): TopicModelGenerationInputManifest {
  return TopicModelGenerationInputManifest.parse(value);
}
