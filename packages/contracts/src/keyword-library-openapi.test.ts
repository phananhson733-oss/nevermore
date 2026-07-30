import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  GrowthMapKeywordDetailResponse as GrowthMapKeywordDetailResponseZod,
  GrowthMapKeywordLibraryResponse as GrowthMapKeywordLibraryResponseZod,
} from "./zod/growth-map.ts";
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
type KeywordSourceOccurrence =
  components["schemas"]["GrowthMapKeywordSourceOccurrence"];
type KeywordMappedTarget =
  components["schemas"]["GrowthMapKeywordMappedTarget"];
type KeywordMetrics = components["schemas"]["GrowthMapKeywordMetrics"];
type KeywordPage = components["schemas"]["GrowthMapKeywordLibraryResponse"];
type KeywordPageMeta =
  components["schemas"]["GrowthMapKeywordLibraryPageMeta"];

type _ListQueryIncludesPublishedGeneration = Expect<
  Equal<keyof KeywordListQuery, "limit" | "cursor" | "diagnosticRunId">
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
type _DetailMatchesRuntimeContract = Expect<
  KeywordDetailHttpResponse["data"] extends GrowthMapKeywordDetailResponseZod
    ? true
    : false
>;
type _KeywordItemIsClosed = Expect<
  Equal<string extends keyof KeywordItem ? true : false, false>
>;
type _KeywordSourceOccurrenceIsClosed = Expect<
  Equal<string extends keyof KeywordSourceOccurrence ? true : false, false>
>;
type _KeywordMappedTargetIsClosed = Expect<
  Equal<string extends keyof KeywordMappedTarget ? true : false, false>
>;
type _KeywordPageFields = Expect<
  Equal<keyof KeywordPage, "projectId" | "data" | "meta">
>;
type _KeywordPageRequiredFields = Expect<
  Equal<RequiredKeys<KeywordPage>, keyof KeywordPage>
>;
type _KeywordPageMetaFields = Expect<
  Equal<keyof KeywordPageMeta, "limit" | "nextCursor" | "hasNext" | "coverage">
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
    | "csv_import"
    | "dataforseo_ranked"
    | "gsc_top_query"
    | "interview_summary"
    | "user_review"
    | "manual"
  >
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

describe("Keyword Library generated OpenAPI contract", () => {
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
  });

  it("preserves source and mapped-target discriminator wire literals", () => {
    for (const [property, literal] of [
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

  it("keeps Keyword CAS input incrementable inside PostgreSQL integer storage", () => {
    expect(openapi).toMatch(
      /ReviewKeywordRequest:[\s\S]*?expectedGovernanceRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483646[\s\S]*?topicModelRevision:\s*\n\s*type: \[integer, 'null'\]\s*\n\s*minimum: 1\s*\n\s*maximum: 2147483647/u,
    );
  });
});
