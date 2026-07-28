import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type { GeoCitationEvidenceResponse as GeoCitationEvidenceResponseZod } from "./zod/geo-citations.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type GeoEvidenceOperation =
  operations["getProjectMeasurementGeoCitations"];
type GeoEvidencePath =
  paths["/projects/{projectId}/measurement-windows/{measurementWindowId}/geo-citations"];
type GeoEvidenceHttpResponse =
  GeoEvidenceOperation["responses"][200]["content"]["application/json"];
type GeoEvidence =
  components["schemas"]["GeoCitationEvidenceResponse"];

type _NoCallerAuthoredQuery = Expect<
  Equal<GeoEvidenceOperation["parameters"]["query"], undefined>
>;
type _HttpEnvelopeIsExact = Expect<
  Equal<GeoEvidenceHttpResponse["data"], GeoEvidence>
>;
type _GeneratedResponseMatchesRuntime = Expect<
  Equal<GeoEvidence, GeoCitationEvidenceResponseZod>
>;
type _PathHasOnlyImplementedGet = Expect<
  Equal<
    | GeoEvidencePath["post"]
    | GeoEvidencePath["put"]
    | GeoEvidencePath["patch"]
    | GeoEvidencePath["delete"],
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

describe("Measurement GEO citation evidence OpenAPI contract", () => {
  it("publishes one read-only Results route with server-owned URL and windows", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/measurement-windows/{measurementWindowId}/geo-citations": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectMeasurementGeoCitations"];',
    );
    expect(openapi).toMatch(
      /This is evidence inside the existing Results module, not a\s+fifth workspace module\./u,
    );
  });

  it("keeps bounded direct evidence and omits a causal why field", () => {
    const start = openapi.indexOf(
      "GeoCitationOccurrenceEvidence:",
    );
    const end = openapi.indexOf(
      "GeoCitationQueryEvidence:",
      start,
    );
    const occurrence = openapi.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(occurrence).toContain("maxLength: 1000");
    expect(occurrence).toContain(
      "evidenceClassification:",
    );
    expect(occurrence).not.toContain("whyItWasCited");
    expect(openapi).not.toContain("caused_by_content_change");
  });
});
