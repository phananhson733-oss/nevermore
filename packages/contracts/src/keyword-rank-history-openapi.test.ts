import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type { GrowthMapKeywordRankHistory as GrowthMapKeywordRankHistoryZod } from "./zod/growth-map.ts";

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

type RankHistoryOperation =
  operations["getProjectAuditKeywordRankHistory"];
type RankHistoryHttpResponse =
  RankHistoryOperation["responses"][200]["content"]["application/json"];
type RankHistory =
  components["schemas"]["GrowthMapKeywordRankHistory"];
type RankPoint = components["schemas"]["GrowthMapKeywordRankPoint"];
type RankSeries = components["schemas"]["GrowthMapKeywordRankSeries"];
type RankWindow = components["schemas"]["GrowthMapKeywordRankWindow"];
type RankHistoryPath =
  paths["/projects/{projectId}/audit/keywords/{keywordId}/rank-history"];

type _NoCallerAuthoredQuery = Expect<
  Equal<RankHistoryOperation["parameters"]["query"], undefined>
>;
type _HttpEnvelopeIsExact = Expect<
  Equal<RankHistoryHttpResponse["data"], RankHistory>
>;
type _GeneratedResponseExtendsRuntimeContract = Expect<
  RankHistory extends GrowthMapKeywordRankHistoryZod ? true : false
>;
type _HistoryFieldsAreExact = Expect<
  Equal<
    keyof RankHistory,
    | "projectId"
    | "keywordId"
    | "mappedPage"
    | "window"
    | "series"
    | "changeMarkers"
    | "coverage"
    | "generatedAt"
  >
>;
type _HistoryFieldsAreRequired = Expect<
  Equal<RequiredKeys<RankHistory>, keyof RankHistory>
>;
type _ProvidersAreExact = Expect<
  Equal<RankPoint["provider"], "dataforseo" | "gsc">
>;
type _MetricsAreExact = Expect<
  Equal<
    RankPoint["metric"],
    "absolute_rank" | "gsc_28d_average_position"
  >
>;
type _SeriesKeepsTheSameMetricVocabulary = Expect<
  Equal<RankSeries["metric"], RankPoint["metric"]>
>;
type _WindowIsFixed = Expect<Equal<RankWindow["days"], 90>>;
type _PathHasOnlyImplementedGet = Expect<
  Equal<
    | RankHistoryPath["post"]
    | RankHistoryPath["put"]
    | RankHistoryPath["patch"]
    | RankHistoryPath["delete"]
    | RankHistoryPath["head"]
    | RankHistoryPath["options"]
    | RankHistoryPath["trace"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

describe("Keyword rank history generated OpenAPI contract", () => {
  it("publishes one read-only Growth Map detail path with no caller-authored window", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keywords/{keywordId}/rank-history": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditKeywordRankHistory"];',
    );
    expect(openapi).toMatch(
      /\/projects\/\{projectId\}\/audit\/keywords\/\{keywordId\}\/rank-history:[\s\S]*?parameters:\s*\n\s*- \$ref: '#\/components\/parameters\/ProjectId'\s*\n\s*- \$ref: '#\/components\/parameters\/KeywordId'\s*\n\s*responses:/u,
    );
  });

  it("keeps absolute rank and GSC average position as separate wire metrics", () => {
    expect(generated).toContain(
      'metric: "absolute_rank" | "gsc_28d_average_position";',
    );
    expect(generated).toContain(
      'provider: "dataforseo" | "gsc";',
    );
    expect(generated).toContain("days: 90;");
  });

  it("documents Change Receipt lineage and rejects Delivery Receipt substitution", () => {
    const markerStart = openapi.indexOf(
      "GrowthMapKeywordContentChangeMarker:",
    );
    const markerEnd = openapi.indexOf(
      "GrowthMapKeywordRankWindow:",
      markerStart,
    );
    const markerSchema = openapi.slice(markerStart, markerEnd);

    expect(markerStart).toBeGreaterThan(-1);
    expect(markerEnd).toBeGreaterThan(markerStart);
    for (const field of [
      "changeReceiptId:",
      "publicationAttemptId:",
      "liveCanonicalUrl:",
      "changedAt:",
    ]) {
      expect(markerSchema).toContain(field);
    }
    expect(markerSchema).not.toContain("deliveryReceiptId:");
  });

  it("states that this remains an internal Growth Map capability", () => {
    expect(openapi).toMatch(
      /this built-in Growth Map capability is not a fifth workspace module\./u,
    );
  });
});
