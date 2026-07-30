import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { components, operations } from "./generated/openapi.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type SourcesRead = operations["listProjectSources"];
type SourcesReadResponses = SourcesRead["responses"];
type SourcesReadValidationProblem =
  SourcesReadResponses[422]["content"]["application/problem+json"];
type CanonicalProblem = components["schemas"]["Problem"];

type _SourcesReadResponsesAreExact = Expect<
  Equal<keyof SourcesReadResponses, 200 | 401 | 404 | 422>
>;
type _SourcesReadUsesCanonicalProblem = Expect<
  Equal<SourcesReadValidationProblem, CanonicalProblem>
>;

const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

describe("Sources read generated OpenAPI contract", () => {
  it("documents the confirmed Product/ICP gate and archived-history exception", () => {
    const start = openapi.indexOf(
      "operationId: listProjectSources",
    );
    const end = openapi.indexOf("operationId:", start + 1);
    const operation = openapi.slice(start, end);

    expect(operation).toContain("CONTEXT_INCOMPLETE");
    expect(operation).toContain("Archived projects");
    expect(operation).toContain(
      "'422': { $ref: '#/components/responses/ValidationError' }",
    );
  });
});
