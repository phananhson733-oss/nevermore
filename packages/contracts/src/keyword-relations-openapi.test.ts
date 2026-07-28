import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  DecideKeywordRelationRequest as DecideKeywordRelationRequestZod,
  GrowthMapKeywordRelation as GrowthMapKeywordRelationZod,
  KeywordRelationDecisionResult as KeywordRelationDecisionResultZod,
  KeywordRelationDetailResponse as KeywordRelationDetailResponseZod,
  KeywordRelationListResponse as KeywordRelationListResponseZod,
  KeywordRelationRefreshResponse as KeywordRelationRefreshResponseZod,
} from "./zod/keyword-relations.ts";

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

type ListOperation = operations["listProjectAuditKeywordRelations"];
type RefreshOperation =
  operations["refreshProjectAuditKeywordRelations"];
type DetailOperation = operations["getProjectAuditKeywordRelation"];
type DecideOperation = operations["decideProjectAuditKeywordRelation"];

type ListQuery = NonNullable<ListOperation["parameters"]["query"]>;
type ListHttpResponse =
  ListOperation["responses"][200]["content"]["application/json"];
type RefreshHttpResponse =
  RefreshOperation["responses"][200]["content"]["application/json"];
type DetailHttpResponse =
  DetailOperation["responses"][200]["content"]["application/json"];
type DecideHttpResponse =
  DecideOperation["responses"][200]["content"]["application/json"];
type DecideRequest =
  DecideOperation["requestBody"]["content"]["application/json"];

type Relation = components["schemas"]["GrowthMapKeywordRelation"];
type ListResponse =
  components["schemas"]["KeywordRelationListResponse"];
type RefreshResponse =
  components["schemas"]["KeywordRelationRefreshResponse"];
type DetailResponse =
  components["schemas"]["KeywordRelationDetailResponse"];
type DecisionResult =
  components["schemas"]["KeywordRelationDecisionResult"];

type CollectionPath =
  paths["/projects/{projectId}/audit/keyword-relations"];
type DetailPath =
  paths["/projects/{projectId}/audit/keyword-relations/{relationId}"];

type _ListQueryKeysAreExact = Expect<
  Equal<keyof ListQuery, "limit" | "cursor" | "keywordId">
>;
type _ListQueryIsOptional = Expect<
  Equal<RequiredKeys<ListQuery>, never>
>;
type _KeywordLookupIsAnArray = Expect<
  Equal<ListQuery["keywordId"], string[] | undefined>
>;
type _RefreshHasNoCallerInput = Expect<
  Equal<
    | RefreshOperation["parameters"]["query"]
    | RefreshOperation["parameters"]["header"]
    | RefreshOperation["requestBody"],
    undefined
  >
>;
type _ListEnvelope = Expect<
  Equal<ListHttpResponse["data"], ListResponse>
>;
type _RefreshEnvelope = Expect<
  Equal<RefreshHttpResponse["data"], RefreshResponse>
>;
type _DetailEnvelope = Expect<
  Equal<DetailHttpResponse["data"], DetailResponse>
>;
type _DecisionEnvelope = Expect<
  Equal<DecideHttpResponse["data"], DecisionResult>
>;
type _RelationMatchesRuntime = Expect<
  Equal<Relation, GrowthMapKeywordRelationZod>
>;
type _ListMatchesRuntime = Expect<
  Equal<ListResponse, KeywordRelationListResponseZod>
>;
type _RefreshMatchesRuntime = Expect<
  Equal<RefreshResponse, KeywordRelationRefreshResponseZod>
>;
type _DetailMatchesRuntime = Expect<
  Equal<DetailResponse, KeywordRelationDetailResponseZod>
>;
type _DecisionMatchesRuntime = Expect<
  Equal<DecisionResult, KeywordRelationDecisionResultZod>
>;
type _DecisionRequestMatchesRuntime = Expect<
  Equal<DecideRequest, DecideKeywordRelationRequestZod>
>;
type _DecisionRequestFieldsAreRequired = Expect<
  Equal<RequiredKeys<DecideRequest>, keyof DecideRequest>
>;
type _DecisionServerFactsForbidden = Expect<
  Equal<
    Extract<
      keyof DecideRequest,
      "actorId" | "decidedAt" | "decisionId" | "relationRevision"
    >,
    never
  >
>;
type _CollectionHasOnlyGetAndPost = Expect<
  Equal<
    | CollectionPath["put"]
    | CollectionPath["patch"]
    | CollectionPath["delete"],
    undefined
  >
>;
type _DetailHasOnlyGetAndPatch = Expect<
  Equal<
    | DetailPath["post"]
    | DetailPath["put"]
    | DetailPath["delete"],
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

describe("Keyword Relation generated OpenAPI contract", () => {
  it("publishes duplicate governance only inside the existing Growth Map", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keyword-relations": {',
    );
    expect(generated).toContain(
      '"/projects/{projectId}/audit/keyword-relations/{relationId}": {',
    );
    expect(generated).toContain(
      'get: operations["listProjectAuditKeywordRelations"];',
    );
    expect(generated).toContain(
      'post: operations["refreshProjectAuditKeywordRelations"];',
    );
    expect(generated).toContain(
      'patch: operations["decideProjectAuditKeywordRelation"];',
    );
    expect(openapi).toContain(
      "they do not create a separate product module.",
    );
  });

  it("keeps the visible Keyword-page lookup bounded and batch-shaped", () => {
    expect(openapi).toMatch(
      /name: keywordId[\s\S]*?type: array[\s\S]*?minItems: 1[\s\S]*?maxItems: 50[\s\S]*?uniqueItems: true/u,
    );
    expect(generated).toContain(
      "keywordId?: components[\"schemas\"][\"Uuid\"][];",
    );
  });

  it("documents append-only fold semantics and stale visibility restoration", () => {
    expect(openapi).toContain(
      "Only an active decision for the exact current candidate may fold a supporting Keyword;",
    );
    expect(openapi).toContain(
      "stale evidence restores it to the visible list.",
    );
    expect(generated).toContain("isEffectivelyFolded: boolean;");
    expect(generated).toContain(
      'KeywordRelationDisplayState: "possible_duplicate" | "folded" | "kept_separate" | "parked_secondary" | "needs_research" | "stale";',
    );
  });

  it("keeps refresh and decision actors, clocks, evidence, and identities server-owned", () => {
    const refreshStart = openapi.indexOf(
      "operationId: refreshProjectAuditKeywordRelations",
    );
    const detailStart = openapi.indexOf(
      "/projects/{projectId}/audit/keyword-relations/{relationId}:",
    );
    const refreshPath = openapi.slice(refreshStart, detailStart);

    expect(refreshStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(refreshStart);
    expect(refreshPath).not.toContain("requestBody:");
    for (const field of [
      "actorId:",
      "decidedAt:",
      "decisionId:",
      "evidenceHash:",
      "ruleVersion:",
    ]) {
      const requestStart = openapi.indexOf(
        "DecideKeywordRelationRequest:",
      );
      const requestEnd = openapi.indexOf(
        "KeywordRelationDecisionResult:",
        requestStart,
      );
      expect(openapi.slice(requestStart, requestEnd)).not.toContain(
        field,
      );
    }
  });
});
