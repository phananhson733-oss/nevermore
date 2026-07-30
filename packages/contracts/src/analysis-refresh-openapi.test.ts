import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  CreateAnalysisRefreshRunRequest as RuntimeRequest,
} from "./zod/analysis-refresh.ts";

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

type RefreshPath =
  paths["/projects/{projectId}/analysis-refresh-runs"];
type RefreshOperation = operations["createAnalysisRefreshRun"];
type RefreshHeaders = NonNullable<
  RefreshOperation["parameters"]["header"]
>;
type RefreshRequest = NonNullable<
  RefreshOperation["requestBody"]
>["content"]["application/json"];
type RefreshAccepted =
  RefreshOperation["responses"][202]["content"]["application/json"];
type AsyncAccepted = components["schemas"]["AsyncAcceptedResponse"];

type _HeaderIsExact = Expect<
  Equal<keyof RefreshHeaders, "Idempotency-Key">
>;
type _HeaderIsRequired = Expect<
  Equal<RequiredKeys<RefreshHeaders>, "Idempotency-Key">
>;
type _RequestMatchesRuntimeStrictEmptyObject = Expect<
  Equal<RefreshRequest, RuntimeRequest>
>;
type _AcceptedIsShared = Expect<Equal<RefreshAccepted, AsyncAccepted>>;
type _PathHasOnlyPost = Expect<
  Equal<
    | RefreshPath["get"]
    | RefreshPath["put"]
    | RefreshPath["delete"]
    | RefreshPath["options"]
    | RefreshPath["head"]
    | RefreshPath["patch"]
    | RefreshPath["trace"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("Analysis Refresh generated OpenAPI contract", () => {
  it("publishes exactly one durable async command without a new GET operation", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/analysis-refresh-runs": {',
    );
    expect(generated).toContain(
      'post: operations["createAnalysisRefreshRun"];',
    );
    expect(generated).toContain(
      "CreateAnalysisRefreshRunRequest: Record<string, never>;",
    );
  });

  it("extends the shared run and resource identities", () => {
    expect(generated).toContain('"analysis_refresh"');
    expect(generated).toContain('"analysis_refresh_run"');
  });
});
