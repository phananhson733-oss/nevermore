import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  GrowthMapInternalLinkMap as GrowthMapInternalLinkMapZod,
  InternalLinkMapEdge as InternalLinkMapEdgeZod,
  InternalLinkMapNode as InternalLinkMapNodeZod,
  InternalLinkRecommendation as InternalLinkRecommendationZod,
} from "./zod/internal-link-map.ts";

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

type InternalLinkMapOperation =
  operations["getProjectAuditInternalLinkMap"];
type InternalLinkMapPath =
  paths["/projects/{projectId}/audit/internal-link-map"];
type InternalLinkMapHttpResponse =
  InternalLinkMapOperation["responses"][200]["content"]["application/json"];
type InternalLinkMap =
  components["schemas"]["GrowthMapInternalLinkMap"];
type InternalLinkNode =
  components["schemas"]["InternalLinkMapNode"];
type InternalLinkEdge =
  components["schemas"]["InternalLinkMapEdge"];
type InternalLinkRecommendation =
  components["schemas"]["InternalLinkRecommendation"];

type _EnvelopeMatchesSchema = Expect<
  Equal<InternalLinkMapHttpResponse["data"], InternalLinkMap>
>;
type _MapMatchesRuntime = Expect<
  Equal<InternalLinkMap, GrowthMapInternalLinkMapZod>
>;
type _NodeMatchesRuntime = Expect<
  Equal<InternalLinkNode, InternalLinkMapNodeZod>
>;
type _EdgeMatchesRuntime = Expect<
  Equal<InternalLinkEdge, InternalLinkMapEdgeZod>
>;
type _RecommendationMatchesRuntime = Expect<
  Equal<InternalLinkRecommendation, InternalLinkRecommendationZod>
>;
type _AllMapFieldsRequired = Expect<
  Equal<RequiredKeys<InternalLinkMap>, keyof InternalLinkMap>
>;
type _OnlySelectedSitePageIsCallerAuthored = Expect<
  Equal<
    keyof NonNullable<InternalLinkMapOperation["parameters"]["query"]>,
    "sitePageId"
  >
>;
type _SelectedSitePageIsOptional = Expect<
  Equal<
    NonNullable<InternalLinkMapOperation["parameters"]["query"]>,
    { sitePageId?: string }
  >
>;
type _PathIsReadOnly = Expect<
  Equal<
    | InternalLinkMapPath["post"]
    | InternalLinkMapPath["put"]
    | InternalLinkMapPath["patch"]
    | InternalLinkMapPath["delete"],
    undefined
  >
>;
type _ResponseStatesAreExplicit = Expect<
  Equal<
    keyof InternalLinkMapOperation["responses"],
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

describe("Growth Map Internal Link Map generated OpenAPI contract", () => {
  it("publishes one read-only capability inside the existing Growth Map", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/internal-link-map": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditInternalLinkMap"];',
    );
    expect(openapi).toMatch(
      /This is a built-in Growth Map capability, not a fifth\s+workspace module\./u,
    );
  });

  it("keeps real graph facts, selected-page inbound evidence, and governed recommendations explicit", () => {
    for (const schema of [
      "InternalLinkMapNode",
      "InternalLinkMapEdge",
      "InternalLinkSelectedPage",
      "InternalLinkRecommendation",
    ]) {
      expect(openapi).toMatch(
        new RegExp(`${schema}:\\n\\s+type: object\\n\\s+additionalProperties: false`, "u"),
      );
    }
    expect(openapi).toContain("observationId:");
    expect(openapi).toContain("executionRefs:");
    expect(openapi).toContain("same_confirmed_topic");
  });

  it("documents partial and unavailable states without inventing orphan or zero claims", () => {
    expect(openapi).toMatch(
      /Partial crawls never assert orphan\s+status, and unavailable data returns no inferred graph\./u,
    );
    expect(openapi).toMatch(
      /Counts describe observed canonical edges only; missing authority is represented by\s+coverage and limitations\./u,
    );
  });
});
