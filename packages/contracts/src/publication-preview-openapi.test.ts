import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  IssuePublicationPreviewRequest as IssuePublicationPreviewRequestZod,
  IssuePublicationPreviewResponse as IssuePublicationPreviewResponseZod,
  IssuePublicationRollbackPreviewRequest as IssuePublicationRollbackPreviewRequestZod,
  IssuePublicationRollbackPreviewResponse as IssuePublicationRollbackPreviewResponseZod,
  RevokePublicationPreviewRequest as RevokePublicationPreviewRequestZod,
  RevokePublicationPreviewResponse as RevokePublicationPreviewResponseZod,
} from "./zod/publication.ts";

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

type IssueOperation = operations["issuePublicationPreview"];
type RollbackIssueOperation =
  operations["issuePublicationRollbackPreview"];
type RevokeOperation = operations["revokePublicationPreview"];

type IssuePathParams = IssueOperation["parameters"]["path"];
type RollbackIssuePathParams =
  RollbackIssueOperation["parameters"]["path"];
type RevokePathParams = RevokeOperation["parameters"]["path"];
type IssueHeaders = IssueOperation["parameters"]["header"];
type RollbackIssueHeaders =
  RollbackIssueOperation["parameters"]["header"];
type RevokeHeaders = RevokeOperation["parameters"]["header"];

type IssueRequest =
  IssueOperation["requestBody"]["content"]["application/json"];
type RollbackIssueRequest =
  RollbackIssueOperation["requestBody"]["content"]["application/json"];
type RevokeRequest =
  RevokeOperation["requestBody"]["content"]["application/json"];
type IssueResponse =
  IssueOperation["responses"][201]["content"]["application/json"]["data"];
type RollbackIssueResponse =
  RollbackIssueOperation["responses"][201]["content"]["application/json"]["data"];
type RevokeResponse =
  RevokeOperation["responses"][200]["content"]["application/json"]["data"];

type _IssuePathParamsAreExact = Expect<
  Equal<keyof IssuePathParams, "projectId">
>;
type _RollbackIssuePathParamsAreExact = Expect<
  Equal<keyof RollbackIssuePathParams, "projectId">
>;
type _RevokePathParamsAreExact = Expect<
  Equal<
    keyof RevokePathParams,
    "projectId" | "previewEventId" | "previewRef"
  >
>;
type _IssuePathParamsAreRequired = Expect<
  Equal<RequiredKeys<IssuePathParams>, keyof IssuePathParams>
>;
type _RollbackIssuePathParamsAreRequired = Expect<
  Equal<
    RequiredKeys<RollbackIssuePathParams>,
    keyof RollbackIssuePathParams
  >
>;
type _RevokePathParamsAreRequired = Expect<
  Equal<RequiredKeys<RevokePathParams>, keyof RevokePathParams>
>;
type _IssueHeaderIsExact = Expect<
  Equal<keyof IssueHeaders, "Idempotency-Key">
>;
type _RollbackIssueHeaderIsExact = Expect<
  Equal<keyof RollbackIssueHeaders, "Idempotency-Key">
>;
type _RevokeHeaderIsExact = Expect<
  Equal<keyof RevokeHeaders, "Idempotency-Key">
>;
type _IssueHeaderIsRequired = Expect<
  Equal<RequiredKeys<IssueHeaders>, "Idempotency-Key">
>;
type _RollbackIssueHeaderIsRequired = Expect<
  Equal<RequiredKeys<RollbackIssueHeaders>, "Idempotency-Key">
>;
type _RevokeHeaderIsRequired = Expect<
  Equal<RequiredKeys<RevokeHeaders>, "Idempotency-Key">
>;
type _IssueStatusCodesAreExact = Expect<
  Equal<
    keyof IssueOperation["responses"],
    201 | 400 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;
type _RollbackIssueStatusCodesAreExact = Expect<
  Equal<
    keyof RollbackIssueOperation["responses"],
    201 | 400 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;
type _RevokeStatusCodesAreExact = Expect<
  Equal<
    keyof RevokeOperation["responses"],
    200 | 400 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;

type _IssueRequestMatchesRuntime = Expect<
  Equal<IssueRequest, IssuePublicationPreviewRequestZod>
>;
type _RollbackIssueRequestMatchesRuntime = Expect<
  Equal<
    RollbackIssueRequest,
    IssuePublicationRollbackPreviewRequestZod
  >
>;
type _RevokeRequestMatchesRuntime = Expect<
  Equal<RevokeRequest, RevokePublicationPreviewRequestZod>
>;
type _IssueResponseMatchesRuntime = Expect<
  Equal<IssueResponse, IssuePublicationPreviewResponseZod>
>;
type _RollbackIssueResponseMatchesRuntime = Expect<
  Equal<
    RollbackIssueResponse,
    IssuePublicationRollbackPreviewResponseZod
  >
>;
type _RevokeResponseMatchesRuntime = Expect<
  Equal<RevokeResponse, RevokePublicationPreviewResponseZod>
>;

type IssuePath =
  paths["/projects/{projectId}/publications/previews"];
type RollbackIssuePath =
  paths["/projects/{projectId}/publications/previews/rollback"];
type RevokePath =
  paths["/projects/{projectId}/publications/previews/{previewEventId}/{previewRef}/revoke"];
type _IssueIsPostOnly = Expect<
  Equal<
    | IssuePath["get"]
    | IssuePath["put"]
    | IssuePath["patch"]
    | IssuePath["delete"]
    | IssuePath["head"]
    | IssuePath["options"]
    | IssuePath["trace"],
    undefined
  >
>;
type _RollbackIssueIsPostOnly = Expect<
  Equal<
    | RollbackIssuePath["get"]
    | RollbackIssuePath["put"]
    | RollbackIssuePath["patch"]
    | RollbackIssuePath["delete"]
    | RollbackIssuePath["head"]
    | RollbackIssuePath["options"]
    | RollbackIssuePath["trace"],
    undefined
  >
>;
type _RevokeIsPostOnly = Expect<
  Equal<
    | RevokePath["get"]
    | RevokePath["put"]
    | RevokePath["patch"]
    | RevokePath["delete"]
    | RevokePath["head"]
    | RevokePath["options"]
    | RevokePath["trace"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

function schemaSource(name: string, nextName: string): string {
  const start = generated.indexOf(`        ${name}:`);
  const end = generated.indexOf(`        ${nextName}:`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return generated.slice(start, end);
}

describe("Publication Preview generated OpenAPI contract", () => {
  it("publishes exactly the three implemented POST operations", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/publications/previews": {',
    );
    expect(generated).toContain(
      '"/projects/{projectId}/publications/previews/rollback": {',
    );
    expect(generated).toContain(
      '"/projects/{projectId}/publications/previews/{previewEventId}/{previewRef}/revoke": {',
    );
    expect(generated).toContain(
      'post: operations["issuePublicationPreview"];',
    );
    expect(generated).toContain(
      'post: operations["issuePublicationRollbackPreview"];',
    );
    expect(generated).toContain(
      'post: operations["revokePublicationPreview"];',
    );
  });

  it("keeps provider plans, readiness, and frozen server facts out of client issue requests", () => {
    const publishRequest = schemaSource(
      "IssuePublicationPreviewRequest",
      "IssuePublicationRollbackPreviewRequest",
    );
    const rollbackRequest = schemaSource(
      "IssuePublicationRollbackPreviewRequest",
      "PublicationPreviewRef",
    );

    for (const request of [publishRequest, rollbackRequest]) {
      expect(request).not.toContain("providerPlan");
      expect(request).not.toContain("readiness");
      expect(request).not.toContain("remotePrecondition");
      expect(request).not.toContain("rollbackPlan");
      expect(request).not.toContain("previewChecksum");
      expect(request).not.toContain("contentChecksum");
      expect(request).not.toContain("factsHash");
    }
  });

  it("returns the customer-safe frozen lineage without exposing providerPlan or readiness authority", () => {
    const publishResponse = schemaSource(
      "IssuePublicationPreviewResponse",
      "IssuePublicationRollbackPreviewResponse",
    );
    const rollbackResponse = schemaSource(
      "IssuePublicationRollbackPreviewResponse",
      "RevokePublicationPreviewRequest",
    );

    for (const response of [publishResponse, rollbackResponse]) {
      expect(response).toContain("remotePrecondition");
      expect(response).toContain("rollbackPlan");
      expect(response).toContain("factsHash");
      expect(response).not.toContain("providerPlan");
      expect(response).not.toContain("readiness");
    }
  });
});
