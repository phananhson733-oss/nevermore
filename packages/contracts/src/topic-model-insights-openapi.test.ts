import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  GrowthMapTopicModelInsights as GrowthMapTopicModelInsightsZod,
  GrowthMapTopicNodeInsight as GrowthMapTopicNodeInsightZod,
} from "./zod/topic-model-insights.ts";

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

type InsightsOperation =
  operations["getProjectAuditTopicModelInsights"];
type InsightsPath =
  paths["/projects/{projectId}/audit/topic-model/insights"];
type InsightsResponse =
  InsightsOperation["responses"][200]["content"]["application/json"];
type Insights =
  components["schemas"]["GrowthMapTopicModelInsights"];
type NodeInsight =
  components["schemas"]["GrowthMapTopicNodeInsight"];

type _EnvelopeMatchesSchema = Expect<
  Equal<InsightsResponse["data"], Insights>
>;
type _InsightsMatchesRuntime = Expect<
  Equal<Insights, GrowthMapTopicModelInsightsZod>
>;
type _NodeMatchesRuntime = Expect<
  Equal<NodeInsight, GrowthMapTopicNodeInsightZod>
>;
type _AllInsightFieldsAreRequired = Expect<
  Equal<RequiredKeys<Insights>, keyof Insights>
>;
type _AllNodeFieldsAreRequired = Expect<
  Equal<RequiredKeys<NodeInsight>, keyof NodeInsight>
>;
type _NoCallerAuthoredFilters = Expect<
  Equal<
    | InsightsOperation["parameters"]["query"]
    | InsightsOperation["parameters"]["header"]
    | InsightsOperation["requestBody"],
    undefined
  >
>;
type _PathIsReadOnly = Expect<
  Equal<
    | InsightsPath["post"]
    | InsightsPath["put"]
    | InsightsPath["patch"]
    | InsightsPath["delete"],
    undefined
  >
>;
type _ResponseStatesAreExplicit = Expect<
  Equal<
    keyof InsightsOperation["responses"],
    200 | 401 | 404 | 422 | 503
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

describe("Growth Map Topic insight generated OpenAPI contract", () => {
  it("publishes confirmed Topic coverage only inside Growth Map", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/topic-model/insights": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditTopicModelInsights"];',
    );
    expect(openapi).toContain(
      "remain part of the existing Growth Map workspace.",
    );
  });

  it("keeps counts bounded and the node projection closed", () => {
    expect(openapi).toMatch(
      /GrowthMapTopicNodeInsight:\n\s+type: object\n\s+additionalProperties: false/u,
    );
    expect(openapi).toMatch(
      /nodes:\n\s+type: array\n\s+maxItems: 500/u,
    );
    expect(openapi).toContain(
      "Mapping-decision\n        counts partition keywordCount",
    );
  });

  it("keeps drafts outside the confirmed analysis authority", () => {
    expect(openapi).toContain(
      "Draft edits never change this analysis before explicit",
    );
    expect(openapi).toContain(
      "Without a\n        confirmed model, the revision is null, nodes are empty, and coverage is unavailable.",
    );
  });
});
