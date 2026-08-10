import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type { GrowthMapKeywordLibraryResponse as GrowthMapKeywordLibraryResponseZod } from "./zod/growth-map.ts";
import type { ReviewKeywordRequest as ReviewKeywordRequestZod } from "./zod/keyword-governance.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type RequiredKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? never
    : Key;
}[keyof Value];

type KeywordListOperation = operations["listProjectAuditKeywords"];
type KeywordDetailOperation = operations["getProjectAuditKeyword"];
type KeywordReviewOperation = operations["reviewProjectAuditKeyword"];
type KeywordListQuery = NonNullable<
  KeywordListOperation["parameters"]["query"]
>;
type KeywordDetailQuery = NonNullable<
  KeywordDetailOperation["parameters"]["query"]
>;
type KeywordListHttpResponse =
  KeywordListOperation["responses"][200]["content"]["application/json"];
type KeywordDetailHttpResponse =
  KeywordDetailOperation["responses"][200]["content"]["application/json"];
type KeywordReviewRequest =
  KeywordReviewOperation["requestBody"]["content"]["application/json"];
type KeywordItem = components["schemas"]["GrowthMapKeywordLibraryItem"];
type KeywordSearchIntent =
  components["schemas"]["GrowthMapKeywordSearchIntent"];
type KeywordClusterRef =
  components["schemas"]["GrowthMapKeywordClusterRef"];
type KeywordRecollection =
  components["schemas"]["GrowthMapKeywordRecollection"];
type KeywordSourceOccurrence =
  components["schemas"]["GrowthMapKeywordSourceOccurrence"];
type KeywordProductProfileOccurrence =
  components["schemas"]["GrowthMapKeywordProductProfileOccurrence"];
type KeywordMappedTarget =
  components["schemas"]["GrowthMapKeywordMappedTarget"];
type KeywordMetrics = components["schemas"]["GrowthMapKeywordMetrics"];
type KeywordPage = components["schemas"]["GrowthMapKeywordLibraryResponse"];
type KeywordPageMeta =
  components["schemas"]["GrowthMapKeywordLibraryPageMeta"];
type KeywordSourceCounts =
  components["schemas"]["GrowthMapKeywordSourceCounts"];

type _ListQueryIncludesPublishedGeneration = Expect<
  Equal<
    keyof KeywordListQuery,
    "limit" | "cursor" | "diagnosticRunId" | "sourceKind"
  >
>;
type _DetailQueryIsGenerationOrReview = Expect<
  Equal<keyof KeywordDetailQuery, "diagnosticRunId" | "view">
>;
type _DetailReviewViewIsExact = Expect<
  Equal<NonNullable<KeywordDetailQuery["view"]>, "review">
>;
type _ListHttpEnvelope = Expect<
  Equal<
    KeywordListHttpResponse["data"],
    components["schemas"]["GrowthMapKeywordLibraryResponse"]
  >
>;
type _DetailHttpEnvelope = Expect<
  Equal<
    KeywordDetailHttpResponse["data"],
    components["schemas"]["GrowthMapKeywordDetailResponse"]
  >
>;
type _ListMatchesRuntimeContract = Expect<
  KeywordListHttpResponse["data"] extends GrowthMapKeywordLibraryResponseZod
    ? true
    : false
>;
type _DetailCurrentSuggestionIsNullable = Expect<
  Extract<
    KeywordDetailHttpResponse["data"],
    { diagnosticRunId: null }
  >["data"]["pendingSuggestion"] extends
    | components["schemas"]["KeywordGovernancePendingSuggestion"]
    | null
    ? true
    : false
>;
type _DetailPinnedSuggestionIsNull = Expect<
  Extract<
    KeywordDetailHttpResponse["data"],
    { diagnosticRunId: string }
  >["data"]["pendingSuggestion"] extends null ? true : false
>;
type _KeywordItemIsClosed = Expect<
  Equal<string extends keyof KeywordItem ? true : false, false>
>;
type _KeywordItemFields = Expect<
  Equal<
    keyof KeywordItem,
    | "projectId"
    | "keywordId"
    | "displayKeyword"
    | "normalizedKeyword"
    | "marketCode"
    | "languageTag"
    | "queryKind"
    | "status"
    | "reviewOrigin"
    | "revision"
    | "intent"
    | "searchIntent"
    | "buyerStage"
    | "cluster"
    | "classificationLimitations"
    | "mappedTarget"
    | "sourceOccurrences"
    | "metrics"
    | "recollection"
    | "coverage"
  >
>;
type _KeywordIntentRemainsBackwardCompatible = Expect<
  Equal<KeywordItem["intent"], string | null>
>;
type _KeywordClusterRefUsesExactTopicRevision = Expect<
  Equal<keyof KeywordClusterRef, "clusterId" | "topicModelRevision" | "name">
>;
type _KeywordRecollectionReasonIsClosed = Expect<
  Equal<
    KeywordRecollection["reason"],
    "historical_dataforseo_observation_missing_fields"
  >
>;
type _KeywordRecollectionFieldsAreClosed = Expect<
  Equal<
    KeywordRecollection["fields"][number],
    "keyword_difficulty" | "provider_search_intent"
  >
>;
type _KeywordSearchIntentIsClosed = Expect<
  Equal<string extends keyof KeywordSearchIntent ? true : false, false>
>;
type _KeywordSearchIntentFields = Expect<
  Equal<
    keyof KeywordSearchIntent,
    | "value"
    | "authority"
    | "snapshotId"
    | "observationId"
    | "analysisInvocationId"
    | "observedAt"
    | "limitation"
  >
>;
type _KeywordSearchIntentValue = Expect<
  Equal<KeywordSearchIntent["value"], string | null>
>;
type _KeywordSearchIntentAuthority = Expect<
  Equal<
    KeywordSearchIntent["authority"],
    | "user_confirmed"
    | "governed_legacy"
    | "provider_observed"
    | "llm_generated"
    | "unavailable"
  >
>;
type _KeywordSourceOccurrenceIsClosed = Expect<
  Equal<string extends keyof KeywordSourceOccurrence ? true : false, false>
>;
type _KeywordProductProfileOccurrenceIsClosed = Expect<
  Equal<
    string extends keyof KeywordProductProfileOccurrence ? true : false,
    false
  >
>;
type _KeywordMappedTargetIsClosed = Expect<
  Equal<string extends keyof KeywordMappedTarget ? true : false, false>
>;
type _KeywordPageFields = Expect<
  Equal<keyof KeywordPage, "projectId" | "diagnosticRunId" | "data" | "meta">
>;
type _KeywordPageRunIdentity = Expect<
  Equal<KeywordPage["diagnosticRunId"], string | null>
>;
type _KeywordPageRequiredFields = Expect<
  Equal<RequiredKeys<KeywordPage>, keyof KeywordPage>
>;
type _KeywordPageMetaFields = Expect<
  Equal<
    keyof KeywordPageMeta,
    "limit" | "nextCursor" | "hasNext" | "coverage" | "sourceCounts"
  >
>;
type _KeywordSourceCountsIsClosed = Expect<
  Equal<
    string extends keyof components["schemas"]["GrowthMapKeywordSourceCounts"]
      ? true
      : false,
    false
  >
>;
type _KeywordSourceCountFields = Expect<
  Equal<
    keyof KeywordSourceCounts,
    | "all"
    | "product_profile"
    | "csv_import"
    | "dataforseo_ranked"
    | "gsc_top_query"
    | "interview_summary"
    | "user_review"
    | "manual"
  >
>;
type _KeywordSourceCountsAreRequired = Expect<
  Equal<RequiredKeys<KeywordSourceCounts>, keyof KeywordSourceCounts>
>;
type _KeywordPageMetaRequiredFields = Expect<
  Equal<RequiredKeys<KeywordPageMeta>, keyof KeywordPageMeta>
>;
type _KeywordLanguageTagUsesCanonicalContract = Expect<
  Equal<
    KeywordItem["languageTag"],
    components["schemas"]["GrowthMapLibraryLanguageTag"]
  >
>;
type _SourceKinds = Expect<
  Equal<
    KeywordSourceOccurrence["sourceKind"],
    | "product_profile"
    | "csv_import"
    | "dataforseo_ranked"
    | "gsc_top_query"
    | "interview_summary"
    | "user_review"
    | "manual"
  >
>;
type _SourceKindFilter = Expect<
  Equal<
    NonNullable<KeywordListQuery["sourceKind"]>,
    | "product_profile"
    | "csv_import"
    | "dataforseo_ranked"
    | "gsc_top_query"
    | "interview_summary"
    | "user_review"
    | "manual"
  >
>;
type _ProductProfileOccurrenceFields = Expect<
  Equal<
    keyof KeywordProductProfileOccurrence,
    | "occurrenceId"
    | "sourceKind"
    | "productProfileId"
    | "snapshotId"
    | "sourceObservationId"
    | "sourcePointer"
    | "collectedAt"
    | "providerDataAsOf"
    | "freshness"
    | "limitation"
    | "scopeBasis"
    | "scopeLimitation"
    | "marketCode"
    | "languageTag"
  >
>;
type _ProductProfileOccurrenceFieldsAreRequired = Expect<
  Equal<
    RequiredKeys<KeywordProductProfileOccurrence>,
    keyof KeywordProductProfileOccurrence
  >
>;
type _ProductProfileSourceKind = Expect<
  Equal<KeywordProductProfileOccurrence["sourceKind"], "product_profile">
>;
type _ProductProfileIdIsUuid = Expect<
  Equal<
    KeywordProductProfileOccurrence["productProfileId"],
    components["schemas"]["Uuid"]
  >
>;
type _ProductProfileHasNoProviderObservation = Expect<
  Equal<
    Pick<
      KeywordProductProfileOccurrence,
      | "snapshotId"
      | "sourceObservationId"
      | "sourcePointer"
      | "providerDataAsOf"
    >,
    {
      snapshotId: null;
      sourceObservationId: null;
      sourcePointer: null;
      providerDataAsOf: null;
    }
  >
>;
type _ProductProfileFreshnessIsUnknown = Expect<
  Equal<KeywordProductProfileOccurrence["freshness"], "unknown">
>;
type _ProductProfileScopeIsProjectContext = Expect<
  Equal<KeywordProductProfileOccurrence["scopeBasis"], "project_context">
>;
type _MappedTargetKinds = Expect<
  Equal<
    KeywordMappedTarget["kind"],
    "unassigned" | "existing_page" | "new_asset"
  >
>;
type _VolumePointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["volume"]>["valuePointer"],
    "/valueJson/searchVolume"
  >
>;
type _DifficultyPointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["kd"]>["valuePointer"],
    "/valueJson/keywordDifficulty"
  >
>;
type _CurrentRankPointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["currentRank"]>["valuePointer"],
    "/valueJson/currentRank"
  >
>;
type _CurrentUrlPointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["currentUrl"]>["valuePointer"],
    "/valueJson/currentUrl"
  >
>;
type _CompetitorDomainPointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["competitorDomain"]>["valuePointer"],
    "/valueJson/competitorDomain"
  >
>;
type _CompetitorRankPointer = Expect<
  Equal<
    NonNullable<KeywordMetrics["competitorRank"]>["valuePointer"],
    "/valueJson/competitorRank"
  >
>;

type KeywordListPath = paths["/projects/{projectId}/audit/keywords"];
type KeywordDetailPath =
  paths["/projects/{projectId}/audit/keywords/{keywordId}"];
type _ListHasNoMutation = Expect<
  Equal<
    | KeywordListPath["post"]
    | KeywordListPath["put"]
    | KeywordListPath["patch"]
    | KeywordListPath["delete"]
    | KeywordListPath["head"]
    | KeywordListPath["options"]
    | KeywordListPath["trace"],
    undefined
  >
>;
type _DetailHasNoOtherMutation = Expect<
  Equal<
    | KeywordDetailPath["post"]
    | KeywordDetailPath["put"]
    | KeywordDetailPath["delete"]
    | KeywordDetailPath["head"]
    | KeywordDetailPath["options"]
    | KeywordDetailPath["trace"],
    undefined
  >
>;
type _DetailHasReviewPatch = Expect<
  Equal<KeywordDetailPath["patch"] extends undefined ? true : false, false>
>;
type _ReviewRequestMatchesRuntimeContract = Expect<
  Equal<KeywordReviewRequest, ReviewKeywordRequestZod>
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);
const implementationSpec = readFileSync(
  new URL(
    "../../../authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
    import.meta.url,
  ),
  "utf8",
);

describe("Keyword Library generated OpenAPI contract", () => {
  it("publishes the scoped one-click suggestion approval operation", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keywords/{keywordId}/review-suggestions/{suggestionId}/approve": {',
    );
    expect(generated).toContain(
      'post: operations["approveProjectAuditKeywordReviewSuggestion"];',
    );
  });

  it("keeps current detail suggestions nullable and pinned detail suggestions literal-null", () => {
    expect(openapi).toMatch(
      /GrowthMapKeywordDetailItem:[\s\S]*?pendingSuggestion:[\s\S]*?KeywordGovernancePendingSuggestion/u,
    );
    expect(generated).toContain("pendingSuggestion: components[\"schemas\"][\"KeywordGovernancePendingSuggestion\"] | null;");
  });

  it("publishes concrete pending-suggestion lineage unions and a satisfiable closed detail item", () => {
    expect(openapi).toMatch(
      /KeywordGovernanceSuggestionLlmLineage:[\s\S]*?required: \[generationVersion, promptSetVersion, authority, analysisInvocationId\]/u,
    );
    expect(openapi).toMatch(
      /KeywordGovernanceSuggestionIntentLineage:[\s\S]*?discriminator:[\s\S]*?propertyName: authority/u,
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordDetailItem:[\s\S]*?additionalProperties: false[\s\S]*?pendingSuggestion:/u,
    );
    expect(openapi).not.toMatch(
      /GrowthMapKeywordLibraryItem'\s*\n\s*- type: object[\s\S]{0,200}pendingSuggestion/u,
    );
    expect(generated).toContain(
      'intentLineage: components["schemas"]["KeywordGovernanceSuggestionIntentLineage"] | null;',
    );
  });

  it("publishes the implemented cursor read, detail read, and governed review", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keywords": {',
    );
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keywords/{keywordId}": {',
    );
    expect(generated).toContain(
      'get: operations["listProjectAuditKeywords"];',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditKeyword"];',
    );
    expect(generated).toContain(
      'patch: operations["reviewProjectAuditKeyword"];',
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordLibraryResponse:\s*\n\s*type: object[\s\S]*?required: \[projectId, diagnosticRunId, data, meta\][\s\S]*?diagnosticRunId: \{ type: \[string, 'null'\], format: uuid \}[\s\S]*?x-signalframe-runtime-refinement: keywordPageScopeRunIdentityAndItemUniqueness/u,
    );
  });

  it("preserves source and mapped-target discriminator wire literals", () => {
    for (const [property, literal] of [
      ["sourceKind", "product_profile"],
      ["sourceKind", "csv_import"],
      ["sourceKind", "dataforseo_ranked"],
      ["sourceKind", "gsc_top_query"],
      ["sourceKind", "interview_summary"],
      ["sourceKind", "user_review"],
      ["sourceKind", "manual"],
      ["kind", "unassigned"],
      ["kind", "existing_page"],
      ["kind", "new_asset"],
    ] as const) {
      expect(generated).toContain(`${property}: "${literal}";`);
    }
  });

  it("publishes confirmed Product Profile queries as exact non-provider keyword lineage", () => {
    expect(openapi).toMatch(
      /KeywordSourceKindFilter:[\s\S]*?enum: \[product_profile, csv_import, dataforseo_ranked, gsc_top_query, interview_summary, user_review, manual\]/u,
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordProductProfileOccurrence:\s*\n\s*type: object\s*\n\s*additionalProperties: false\s*\n\s*required: \[occurrenceId, sourceKind, productProfileId, snapshotId, sourceObservationId, sourcePointer, collectedAt, providerDataAsOf, freshness, limitation, scopeBasis, scopeLimitation, marketCode, languageTag\][\s\S]*?sourceKind: \{ type: string, const: product_profile \}[\s\S]*?productProfileId: \{ \$ref: '#\/components\/schemas\/Uuid' \}[\s\S]*?snapshotId: \{ type: 'null' \}[\s\S]*?sourceObservationId: \{ type: 'null' \}[\s\S]*?sourcePointer: \{ type: 'null' \}[\s\S]*?providerDataAsOf: \{ type: 'null' \}[\s\S]*?freshness: \{ type: string, const: unknown \}[\s\S]*?scopeBasis: \{ type: string, const: project_context \}[\s\S]*?GrowthMapKeywordCsvImportOccurrence:/u,
    );
    expect(openapi).toContain(
      "- $ref: '#/components/schemas/GrowthMapKeywordProductProfileOccurrence'",
    );
    expect(openapi).toContain(
      "product_profile: '#/components/schemas/GrowthMapKeywordProductProfileOccurrence'",
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordSourceCounts:[\s\S]*?required: \[all, product_profile, csv_import, dataforseo_ranked, gsc_top_query, interview_summary, user_review, manual\][\s\S]*?product_profile: \{ type: integer, minimum: 0 \}[\s\S]*?GrowthMapKeywordLibraryPageMeta:/u,
    );
  });

  it("keeps interview summaries and public reviews separate without exposing raw people or review text", () => {
    expect(openapi).toContain(
      "interview_summary: '#/components/schemas/GrowthMapKeywordInterviewSummaryOccurrence'",
    );
    expect(openapi).toContain(
      "user_review: '#/components/schemas/GrowthMapKeywordUserReviewOccurrence'",
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordInterviewSummaryOccurrence:[\s\S]*?collectionRunId:[\s\S]*?sourceRecordHash:[\s\S]*?GrowthMapKeywordUserReviewOccurrence:/u,
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordUserReviewOccurrence:[\s\S]*?collectionRunId:[\s\S]*?reviewPlatform:[\s\S]*?enum: \[app_store, g2, capterra, other\]/u,
    );
    expect(openapi).not.toMatch(
      /GrowthMapKeyword(?:InterviewSummary|UserReview)Occurrence:[\s\S]*?(participantName|reviewAuthor|reviewBody|transcript):/u,
    );
  });

  it("keeps every metric attached to its canonical Observation pointer", () => {
    for (const pointer of [
      "/valueJson/searchVolume",
      "/valueJson/keywordDifficulty",
      "/valueJson/currentRank",
      "/valueJson/currentUrl",
      "/valueJson/competitorDomain",
      "/valueJson/competitorRank",
    ]) {
      expect(generated).toContain(`valuePointer: "${pointer}";`);
    }
  });

  it("publishes a separate, required provenance-bearing search intent without widening intent", () => {
    const searchIntentSchema = openapi.slice(
      openapi.indexOf("    GrowthMapKeywordSearchIntent:"),
      openapi.indexOf("    GrowthMapKeywordClassificationLimitations:"),
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordSearchIntent:\s*\n\s*type: object[\s\S]*?authority:\s*\n\s*type: string\s*\n\s*enum: \[user_confirmed, governed_legacy, provider_observed, llm_generated, unavailable\][\s\S]*?analysisInvocationId:[\s\S]*?GrowthMapKeywordClassificationLimitations:/u,
    );
    expect(openapi).toMatch(
      /GrowthMapKeywordLibraryItem:[\s\S]*?required: \[[^\]]*intent, searchIntent, buyerStage[^\]]*\][\s\S]*?intent: \{ type: \[string, 'null'\], minLength: 1, maxLength: 500 \}\s*\n\s*searchIntent: \{ \$ref: '#\/components\/schemas\/GrowthMapKeywordSearchIntent' \}/u,
    );
    for (const title of [
      "Provider-observed search intent",
      "LLM-generated search intent",
    ]) {
      expect(openapi).toMatch(
        new RegExp(
          `title: ${title}[\\s\\S]*?value: \\{ type: string, enum: \\[informational, navigational, commercial, transactional\\] \\}`,
          "u",
        ),
      );
    }
    expect(generated).toContain(
      "searchIntent: components[\"schemas\"][\"GrowthMapKeywordSearchIntent\"];",
    );
    expect(generated).toContain(
      "authority: \"user_confirmed\" | \"governed_legacy\" | \"provider_observed\" | \"llm_generated\" | \"unavailable\";",
    );
    expect(openapi).toContain(
      "reviewOrigin may be migration_baseline, system_suggestion, or null for pre-ledger provenance.",
    );
    expect(implementationSpec).toMatch(
      /`reviewOrigin` 可为\s+`migration_baseline`、`system_suggestion` 或 `null`/u,
    );
    expect(
      searchIntentSchema.match(
        /pattern: '\^\\S\(\?:\[\\s\\S\]\*\\S\)\?\$'/gu,
      ),
    ).toHaveLength(2);
    expect(searchIntentSchema).toContain(
      "Boundary whitespace is rejected without trimming or coercion.",
    );
  });

  it("keeps Keyword CAS input incrementable inside PostgreSQL integer storage", () => {
    expect(openapi).toMatch(
      /ReviewKeywordRequest:[\s\S]*?expectedGovernanceRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483646[\s\S]*?topicModelRevision:\s*\n\s*type: \[integer, 'null'\]\s*\n\s*minimum: 1\s*\n\s*maximum: 2147483647/u,
    );
  });
});
