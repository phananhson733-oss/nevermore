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

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type KeywordListOperation = operations["listProjectAuditKeywords"];
type KeywordDetailOperation = operations["getProjectAuditKeyword"];
type KeywordListQuery = NonNullable<
  KeywordListOperation["parameters"]["query"]
>;
type KeywordListHttpResponse =
  KeywordListOperation["responses"][200]["content"]["application/json"];
type KeywordDetailHttpResponse =
  KeywordDetailOperation["responses"][200]["content"]["application/json"];
type KeywordItem = components["schemas"]["GrowthMapKeywordLibraryItem"];
type KeywordSourceOccurrence =
  components["schemas"]["GrowthMapKeywordSourceOccurrence"];
type KeywordMappedTarget =
  components["schemas"]["GrowthMapKeywordMappedTarget"];
type KeywordMetrics = components["schemas"]["GrowthMapKeywordMetrics"];

type _ListQueryIsCursorOnly = Expect<
  Equal<keyof KeywordListQuery, "limit" | "cursor">
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
type _SourceKinds = Expect<
  Equal<
    KeywordSourceOccurrence["sourceKind"],
    "csv_import" | "dataforseo_ranked" | "gsc_top_query" | "manual"
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
    KeywordListPath["post"] | KeywordListPath["put"] | KeywordListPath["patch"] | KeywordListPath["delete"],
    undefined
  >
>;
type _DetailHasNoMutation = Expect<
  Equal<
    KeywordDetailPath["post"] | KeywordDetailPath["put"] | KeywordDetailPath["patch"] | KeywordDetailPath["delete"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("Keyword Library generated OpenAPI contract", () => {
  it("publishes only the implemented cursor-page and exact-detail reads", () => {
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
  });

  it("preserves source and mapped-target discriminator wire literals", () => {
    for (const [property, literal] of [
      ["sourceKind", "csv_import"],
      ["sourceKind", "dataforseo_ranked"],
      ["sourceKind", "gsc_top_query"],
      ["sourceKind", "manual"],
      ["kind", "unassigned"],
      ["kind", "existing_page"],
      ["kind", "new_asset"],
    ] as const) {
      expect(generated).toContain(`${property}: "${literal}";`);
    }
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
});
