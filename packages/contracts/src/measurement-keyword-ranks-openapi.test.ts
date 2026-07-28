import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  MeasurementDataForSeoAbsoluteRankPoint as MeasurementDataForSeoAbsoluteRankPointZod,
  MeasurementTargetKeywordRank as MeasurementTargetKeywordRankZod,
  MeasurementTargetKeywordRanks as MeasurementTargetKeywordRanksZod,
} from "./zod/measurement-keyword-ranks.ts";

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

type Operation =
  operations["getProjectMeasurementTargetKeywordRanks"];
type HttpResponse =
  Operation["responses"][200]["content"]["application/json"];
type Response =
  components["schemas"]["MeasurementTargetKeywordRanks"];
type Keyword =
  components["schemas"]["MeasurementTargetKeywordRank"];
type RankPoint =
  components["schemas"]["MeasurementDataForSeoAbsoluteRankPoint"];
type Path =
  paths["/projects/{projectId}/measurement-windows/{measurementWindowId}/keyword-ranks"];

type _NoCallerAuthoredWindow = Expect<
  Equal<Operation["parameters"]["query"], undefined>
>;
type _HttpEnvelopeIsExact = Expect<
  Equal<HttpResponse["data"], Response>
>;
type _ResponseMatchesRuntime = Expect<
  Equal<Response, MeasurementTargetKeywordRanksZod>
>;
type _KeywordMatchesRuntime = Expect<
  Equal<Keyword, MeasurementTargetKeywordRankZod>
>;
type _RankPointMatchesRuntime = Expect<
  Equal<RankPoint, MeasurementDataForSeoAbsoluteRankPointZod>
>;
type _AllResponseFieldsRequired = Expect<
  Equal<RequiredKeys<Response>, keyof Response>
>;
type _OnlyAbsoluteDataForSeoRank = Expect<
  Equal<
    Pick<
      RankPoint,
      "provider" | "metric" | "valuePointer" | "providerDataAsOf"
    >,
    {
      provider: "dataforseo";
      metric: "absolute_rank";
      valuePointer: "/valueJson/currentRank";
      providerDataAsOf: null;
    }
  >
>;
type _PathIsReadOnly = Expect<
  Equal<
    | Path["post"]
    | Path["put"]
    | Path["patch"]
    | Path["delete"],
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

describe("Measurement target Keyword rank generated OpenAPI contract", () => {
  it("publishes one exact read-only Results capability", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/measurement-windows/{measurementWindowId}/keyword-ranks": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectMeasurementTargetKeywordRanks"];',
    );
    expect(openapi).toMatch(
      /This is part of the existing Results module,\s+not a fifth workspace module\./u,
    );
  });

  it("forbids GSC average position from masquerading as absolute rank", () => {
    const start = openapi.indexOf(
      "MeasurementDataForSeoAbsoluteRankPoint:",
    );
    const end = openapi.indexOf(
      "MeasurementKeywordRankState:",
      start,
    );
    const schema = openapi.slice(start, end);
    expect(schema).toContain("const: dataforseo");
    expect(schema).toContain("const: absolute_rank");
    expect(schema).toContain("const: /valueJson/currentRank");
    expect(schema).not.toContain("gsc_28d_average_position");
  });

  it("documents nullable evidence and observational interpretation without synthetic rank zero", () => {
    expect(openapi).toContain(
      "dataforseo_absolute_rank_observational_non_causal",
    );
    expect(openapi).toMatch(
      /A missing\s+before or after observation requires an unavailable trend and explicit limitation\./u,
    );
    const start = openapi.indexOf("MeasurementTargetKeywordRank:");
    const end = openapi.indexOf(
      "MeasurementTargetKeywordRanks:",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(openapi.slice(start, end)).not.toMatch(/default:\s*0/u);
  });
});
