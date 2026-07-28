import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  AppendArtifactApprovalEventRequest as RuntimeApprovalRequest,
  ArtifactApprovalEvent as RuntimeApprovalEvent,
} from "./zod/artifact-approval.ts";

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

type ApprovalOperation = operations["appendArtifactApprovalEvent"];
type ApprovalPath =
  paths["/projects/{projectId}/artifacts/{artifactId}/approval"];
type ApprovalHeaders = NonNullable<
  ApprovalOperation["parameters"]["header"]
>;
type ApprovalRequest =
  ApprovalOperation["requestBody"]["content"]["application/json"];
type ApprovalHttpResponse =
  ApprovalOperation["responses"][201]["content"]["application/json"];
type ApprovalEvent = components["schemas"]["ArtifactApprovalEvent"];

type _HeaderIsExact = Expect<
  Equal<keyof ApprovalHeaders, "Idempotency-Key">
>;
type _HeaderIsRequired = Expect<
  Equal<RequiredKeys<ApprovalHeaders>, "Idempotency-Key">
>;
type _RequestMatchesRuntime = Expect<
  Equal<ApprovalRequest, RuntimeApprovalRequest>
>;
type _EventMatchesRuntime = Expect<
  Equal<ApprovalEvent, RuntimeApprovalEvent>
>;
type _ResponseEnvelopeIsExact = Expect<
  Equal<ApprovalHttpResponse["data"], ApprovalEvent>
>;
type _PathHasOnlyImplementedPost = Expect<
  Equal<
    | ApprovalPath["get"]
    | ApprovalPath["put"]
    | ApprovalPath["delete"]
    | ApprovalPath["options"]
    | ApprovalPath["head"]
    | ApprovalPath["patch"]
    | ApprovalPath["trace"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("Artifact approval generated OpenAPI contract", () => {
  it("publishes the append-only approval endpoint inside the existing Execution Center", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/artifacts/{artifactId}/approval": {',
    );
    expect(generated).toContain(
      'post: operations["appendArtifactApprovalEvent"];',
    );
  });

  it("keeps actor, hashes, QA snapshot, and timestamp out of the browser command", () => {
    const requestStart = generated.indexOf(
      "ApproveArtifactRevisionRequest:",
    );
    const requestEnd = generated.indexOf(
      "InvalidateArtifactApprovalRequest:",
      requestStart,
    );
    const requestSchema = generated.slice(requestStart, requestEnd);

    expect(requestStart).toBeGreaterThan(-1);
    expect(requestEnd).toBeGreaterThan(requestStart);
    expect(requestSchema).toContain("artifactRevisionId:");
    expect(requestSchema).toContain("expectedArtifactRevision:");
    expect(requestSchema).toContain("expectedQaGateVersion:");
    expect(requestSchema).toContain("customerAcknowledgementInput:");
    for (const serverFact of [
      "eventActorId:",
      "reviewerActorId:",
      "artifactContentHash:",
      "qaGateSnapshot:",
      "recordedAt:",
      "acknowledgedAt:",
    ]) {
      expect(requestSchema).not.toContain(serverFact);
    }
  });
});
