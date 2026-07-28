import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  ActionExecutionStateBatch as BatchZod,
  ActionExecutionStateTimeline as TimelineZod,
  RecordActionExecutionStateResult as ResultZod,
  UpdateActionExecutionStateRequest as UpdateZod,
} from "./zod/action-execution-state.ts";

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

type GetOperation = operations["getActionExecutionStateTimeline"];
type GetBatchOperation = operations["getArtifactExecutionStateBatch"];
type UpdateOperation = operations["updateActionExecutionState"];
type GetBatchQuery = NonNullable<
  GetBatchOperation["parameters"]["query"]
>;
type GetQuery = NonNullable<GetOperation["parameters"]["query"]>;
type UpdateQuery = NonNullable<
  UpdateOperation["parameters"]["query"]
>;
type UpdateHeaders = NonNullable<
  UpdateOperation["parameters"]["header"]
>;
type UpdateRequest =
  UpdateOperation["requestBody"]["content"]["application/json"];
type Timeline =
  components["schemas"]["ActionExecutionStateTimeline"];
type Batch = components["schemas"]["ActionExecutionStateBatch"];
type UpdateResult =
  components["schemas"]["RecordActionExecutionStateResult"];
type GetResponse =
  GetOperation["responses"][200]["content"]["application/json"];
type GetBatchResponse =
  GetBatchOperation["responses"][200]["content"]["application/json"];
type PostResponse =
  UpdateOperation["responses"][201]["content"]["application/json"];
type ExecutionPath =
  paths["/projects/{projectId}/actions/{actionId}/execution-state"];
type ExecutionBatchPath =
  paths["/projects/{projectId}/artifacts/execution-states"];

type _BatchQueryOnlySelectsArtifacts = Expect<
  Equal<keyof GetBatchQuery, "artifactId">
>;
type _BatchQueryIsRequired = Expect<
  Equal<RequiredKeys<GetBatchQuery>, "artifactId">
>;

type _GetQueryOnlySelectsExactArtifact = Expect<
  Equal<keyof GetQuery, "artifactId">
>;
type _GetQueryIsOptional = Expect<
  Equal<RequiredKeys<GetQuery>, never>
>;
type _UpdateQueryOnlySelectsExactArtifact = Expect<
  Equal<keyof UpdateQuery, "artifactId">
>;
type _IdempotencyHeaderIsExact = Expect<
  Equal<keyof UpdateHeaders, "Idempotency-Key">
>;
type _IdempotencyHeaderIsRequired = Expect<
  Equal<RequiredKeys<UpdateHeaders>, "Idempotency-Key">
>;
type _GeneratedUpdateMatchesRuntime = Expect<
  Equal<UpdateRequest, UpdateZod>
>;
type _GeneratedTimelineMatchesRuntime = Expect<
  Equal<Timeline, TimelineZod>
>;
type _GeneratedBatchMatchesRuntime = Expect<Equal<Batch, BatchZod>>;
type _GeneratedResultMatchesRuntime = Expect<
  Equal<UpdateResult, ResultZod>
>;
type _GetEnvelopeIsExact = Expect<
  Equal<GetResponse["data"], Timeline>
>;
type _GetBatchEnvelopeIsExact = Expect<
  Equal<GetBatchResponse["data"], Batch>
>;
type _PostEnvelopeIsExact = Expect<
  Equal<PostResponse["data"], UpdateResult>
>;
type _PathHasOnlyImplementedGetAndPost = Expect<
  Equal<
    | ExecutionPath["put"]
    | ExecutionPath["patch"]
    | ExecutionPath["delete"]
    | ExecutionPath["head"]
    | ExecutionPath["options"]
    | ExecutionPath["trace"],
    undefined
  >
>;
type _BatchPathHasOnlyImplementedGet = Expect<
  Equal<
    | ExecutionBatchPath["post"]
    | ExecutionBatchPath["put"]
    | ExecutionBatchPath["patch"]
    | ExecutionBatchPath["delete"]
    | ExecutionBatchPath["head"]
    | ExecutionBatchPath["options"]
    | ExecutionBatchPath["trace"],
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

describe("Action Execution State generated OpenAPI contract", () => {
  it("publishes one exact Action- or Artifact-level stream inside the existing Execution Center", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/actions/{actionId}/execution-state": {',
    );
    expect(generated).toContain(
      'get: operations["getActionExecutionStateTimeline"];',
    );
    expect(generated).toContain(
      'post: operations["updateActionExecutionState"];',
    );
    expect(openapi).toMatch(
      /No artifactId selects the independent Action-level stream; an\s+artifactId selects only that Artifact stream\./u,
    );
    expect(openapi).toMatch(
      /does not create a fifth\s+workspace module/u,
    );
  });

  it("publishes one bounded queue batch without creating per-card reads", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/artifacts/execution-states": {',
    );
    expect(generated).toContain(
      'get: operations["getArtifactExecutionStateBatch"];',
    );
    expect(openapi).toMatch(
      /one bounded project-scoped read\s+instead of one request\s+per card/u,
    );
    expect(openapi).toMatch(
      /An item with current\s+null means no execution event has been recorded; clients must not infer one from\s+legacy Action or Artifact status/u,
    );
  });

  it("does not let the browser author execution scope or evidence authority", () => {
    const start = generated.indexOf(
      "UpdateActionExecutionStateRequest:",
    );
    const end = generated.indexOf(
      "RecordActionExecutionStateResult:",
      start,
    );
    const schema = generated.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    for (const forbidden of [
      "actionId:",
      "artifactId:",
      "idempotencyKey:",
      "actorId:",
      "occurredAt:",
      "ownerId:",
      "sourceKind:",
      "sourceRef:",
      "observedAt:",
      "freshness:",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("keeps legacy plan workflow status separate from delivery execution facts", () => {
    expect(openapi).toMatch(
      /legacy Action status remains the plan\/review workflow and is never\s+used as a fallback for this delivery execution stream/u,
    );
  });
});
