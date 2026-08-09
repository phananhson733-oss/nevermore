import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  GrowthMapCompetitorDetailResponse as GrowthMapCompetitorDetailResponseZod,
  GrowthMapCompetitorLibraryResponse as GrowthMapCompetitorLibraryResponseZod,
} from "./zod/growth-map.ts";
import type { ReviewCompetitorRequest as ReviewCompetitorRequestZod } from "./zod/keyword-governance.ts";

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

type CompetitorListOperation = operations["listProjectAuditCompetitors"];
type CompetitorDetailOperation = operations["getProjectAuditCompetitor"];
type CompetitorReviewOperation =
  operations["reviewProjectAuditCompetitor"];
type CompetitorListQuery = NonNullable<
  CompetitorListOperation["parameters"]["query"]
>;
type CompetitorDetailQuery = NonNullable<
  CompetitorDetailOperation["parameters"]["query"]
>;
type CompetitorListHttpResponse =
  CompetitorListOperation["responses"][200]["content"]["application/json"];
type CompetitorDetailHttpResponse =
  CompetitorDetailOperation["responses"][200]["content"]["application/json"];
type CompetitorReviewRequest =
  CompetitorReviewOperation["requestBody"]["content"]["application/json"];
type CompetitorPage =
  components["schemas"]["GrowthMapCompetitorLibraryResponse"];
type CompetitorPageMeta =
  components["schemas"]["GrowthMapCompetitorLibraryPageMeta"];
type CompetitorItem =
  components["schemas"]["GrowthMapCompetitorLibraryItem"];
type CompetitorOrigin =
  components["schemas"]["GrowthMapCompetitorOriginOccurrence"];
type ProductProfileOrigin = Extract<
  CompetitorOrigin,
  { originKind: "product_profile" }
>;
type CsvKeywordGapOrigin = Extract<
  CompetitorOrigin,
  { originKind: "csv_keyword_gap" }
>;
type ManualOrigin = Extract<CompetitorOrigin, { originKind: "manual" }>;
type SerpOverlap =
  components["schemas"]["GrowthMapCompetitorSerpOverlap"];
type AiCitationInsight =
  components["schemas"]["GrowthMapCompetitorAiCitationInsight"];
type AvailableSerpOverlap = Extract<
  SerpOverlap,
  { availability: "available" }
>;
type UnavailableSerpOverlap = Extract<
  SerpOverlap,
  { availability: "unavailable" }
>;
type AvailableAiCitationInsight = Extract<
  AiCitationInsight,
  { availability: "available" }
>;
type SharedKeywordInsight =
  components["schemas"]["GrowthMapCompetitorSharedKeywordInsight"];
type AvailableSharedKeywordInsight = Extract<
  SharedKeywordInsight,
  { availability: "available" }
>;

type _ListQueryIncludesPublishedGeneration = Expect<
  Equal<keyof CompetitorListQuery, "limit" | "cursor" | "diagnosticRunId">
>;
type _DetailQueryIsGenerationOrReview = Expect<
  Equal<keyof CompetitorDetailQuery, "diagnosticRunId" | "view">
>;
type _DetailReviewViewIsExact = Expect<
  Equal<NonNullable<CompetitorDetailQuery["view"]>, "review">
>;
type _ListHttpEnvelope = Expect<
  Equal<
    CompetitorListHttpResponse["data"],
    components["schemas"]["GrowthMapCompetitorLibraryResponse"]
  >
>;
type _DetailHttpEnvelope = Expect<
  Equal<
    CompetitorDetailHttpResponse["data"],
    components["schemas"]["GrowthMapCompetitorDetailResponse"]
  >
>;
type _ListMatchesRuntimeContract = Expect<
  CompetitorListHttpResponse["data"] extends GrowthMapCompetitorLibraryResponseZod
    ? true
    : false
>;
type _DetailMatchesRuntimeContract = Expect<
  CompetitorDetailHttpResponse["data"] extends GrowthMapCompetitorDetailResponseZod
    ? true
    : false
>;
type _PageFields = Expect<
  Equal<keyof CompetitorPage, "projectId" | "data" | "meta">
>;
type _PageRequiredFields = Expect<
  Equal<RequiredKeys<CompetitorPage>, keyof CompetitorPage>
>;
type _PageMetaFields = Expect<
  Equal<
    keyof CompetitorPageMeta,
    "limit" | "nextCursor" | "hasNext" | "coverage"
  >
>;
type _PageMetaRequiredFields = Expect<
  Equal<RequiredKeys<CompetitorPageMeta>, keyof CompetitorPageMeta>
>;
type _ItemFields = Expect<
  Equal<
    keyof CompetitorItem,
    | "projectId"
    | "competitorId"
    | "domain"
    | "name"
    | "reviewStatus"
    | "relationship"
    | "analysisScope"
    | "revision"
    | "originOccurrences"
    | "lastObservedAt"
    | "serpOverlap"
    | "aiCitationInsight"
    | "sharedKeywordInsight"
    | "coverage"
  >
>;
type _ItemRequiredFields = Expect<
  Equal<RequiredKeys<CompetitorItem>, keyof CompetitorItem>
>;
type _ItemIsClosed = Expect<
  Equal<string extends keyof CompetitorItem ? true : false, false>
>;
type _OriginIsClosed = Expect<
  Equal<string extends keyof CompetitorOrigin ? true : false, false>
>;
type _OriginKinds = Expect<
  Equal<
    CompetitorOrigin["originKind"],
    | "product_profile"
    | "csv_keyword_gap"
    | "manual"
    | "serp_overlap"
    | "ai_citation"
  >
>;
type _ProductProfileEvidenceIsTyped = Expect<
  Equal<
    ProductProfileOrigin["evidenceRefs"][number],
    components["schemas"]["ProductProfileEvidenceRef"]
  >
>;
type _ProductProfileEvidenceKinds = Expect<
  Equal<
    ProductProfileOrigin["evidenceRefs"][number]["kind"],
    | "snapshot"
    | "pageSnapshot"
    | "observation"
    | "analysisInvocation"
    | "declaredHint"
    | "userEdit"
  >
>;
type _CsvEvidenceIsCanonicalAppEvidence = Expect<
  Equal<
    CsvKeywordGapOrigin["evidenceRefs"][number],
    components["schemas"]["GrowthMapCompetitorEvidenceRef"]
  >
>;
type _ManualEvidenceIsCanonicalAppEvidence = Expect<
  Equal<
    ManualOrigin["evidenceRefs"][number],
    components["schemas"]["GrowthMapCompetitorEvidenceRef"]
  >
>;
type _CanonicalAppEvidenceKind = Expect<
  Equal<
    components["schemas"]["GrowthMapCompetitorEvidenceRef"]["kind"],
    "evidence"
  >
>;
type _SerpAvailability = Expect<
  Equal<SerpOverlap["availability"], "available" | "unavailable">
>;
type _AiCitationAvailability = Expect<
  Equal<AiCitationInsight["availability"], "available" | "unavailable">
>;
type _SharedKeywordAvailability = Expect<
  Equal<SharedKeywordInsight["availability"], "available" | "unavailable">
>;
type _UnavailableInsightFields = Expect<
  Equal<
    keyof UnavailableSerpOverlap,
    "availability" | "value" | "limitation"
  >
>;
type _UnavailableInsightValue = Expect<
  Equal<UnavailableSerpOverlap["value"], null>
>;
type _SerpPointer = Expect<
  Equal<AvailableSerpOverlap["valuePointer"], "/valueJson/serpOverlap">
>;
type _AiCitationPointer = Expect<
  Equal<
    AvailableAiCitationInsight["valuePointer"],
    "/valueJson/citedQueries"
  >
>;
type _SharedKeywordPointer = Expect<
  Equal<
    AvailableSharedKeywordInsight["valuePointer"],
    "/valueJson/intersections"
  >
>;

type CompetitorListPath =
  paths["/projects/{projectId}/audit/competitors"];
type CompetitorDetailPath =
  paths["/projects/{projectId}/audit/competitors/{competitorId}"];
type _ListIsReadOnly = Expect<
  Equal<
    | CompetitorListPath["post"]
    | CompetitorListPath["put"]
    | CompetitorListPath["patch"]
    | CompetitorListPath["delete"]
    | CompetitorListPath["head"]
    | CompetitorListPath["options"]
    | CompetitorListPath["trace"],
    undefined
  >
>;
type _DetailHasNoOtherMutation = Expect<
  Equal<
    | CompetitorDetailPath["post"]
    | CompetitorDetailPath["put"]
    | CompetitorDetailPath["delete"]
    | CompetitorDetailPath["head"]
    | CompetitorDetailPath["options"]
    | CompetitorDetailPath["trace"],
    undefined
  >
>;
type _DetailHasReviewPatch = Expect<
  Equal<CompetitorDetailPath["patch"] extends undefined ? true : false, false>
>;
type _ReviewRequestMatchesRuntimeContract = Expect<
  Equal<CompetitorReviewRequest, ReviewCompetitorRequestZod>
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

describe("Competitor Library generated OpenAPI contract", () => {
  it("publishes the implemented cursor read, detail read, and governed review", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/competitors": {',
    );
    expect(generated).toContain(
      '"/projects/{projectId}/audit/competitors/{competitorId}": {',
    );
    expect(generated).toContain(
      'get: operations["listProjectAuditCompetitors"];',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditCompetitor"];',
    );
    expect(generated).toContain(
      'patch: operations["reviewProjectAuditCompetitor"];',
    );
  });

  it("preserves strict origin and insight discriminator wire literals", () => {
    for (const [property, literal] of [
      ["originKind", "product_profile"],
      ["originKind", "csv_keyword_gap"],
      ["originKind", "manual"],
      ["originKind", "serp_overlap"],
      ["originKind", "ai_citation"],
      ["kind", "evidence"],
      ["availability", "unavailable"],
      ["availability", "available"],
    ] as const) {
      expect(generated).toContain(`${property}: "${literal}";`);
    }
  });

  it("keeps available insights attached to canonical Observation pointers", () => {
    expect(generated).toContain(
      'valuePointer: "/valueJson/serpOverlap";',
    );
    expect(generated).toContain(
      'valuePointer: "/valueJson/citedQueries";',
    );
    expect(generated).toContain(
      'valuePointer: "/valueJson/intersections";',
    );
  });

  it("keeps Competitor CAS input incrementable inside PostgreSQL integer storage", () => {
    expect(openapi).toMatch(
      /ReviewCompetitorRequest:[\s\S]*?expectedRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483646/u,
    );
  });
});
