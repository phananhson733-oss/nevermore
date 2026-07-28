import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  CompetitorMonitorConfig as ConfigZod,
  CompetitorMonitorResponse as ResponseZod,
  UpdateCompetitorMonitorRequest as UpdateZod,
} from "./zod/competitor-monitor.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type MonitorPath =
  paths["/projects/{projectId}/audit/competitor-monitor"];
type GetOperation = operations["getProjectAuditCompetitorMonitor"];
type PutOperation = operations["updateProjectAuditCompetitorMonitor"];
type GeneratedResponse =
  components["schemas"]["CompetitorMonitorResponse"];
type GeneratedConfig =
  components["schemas"]["CompetitorMonitorConfig"];
type GeneratedUpdate =
  PutOperation["requestBody"]["content"]["application/json"];
type GetEnvelope =
  GetOperation["responses"][200]["content"]["application/json"];
type PutEnvelope =
  PutOperation["responses"][200]["content"]["application/json"];

type _ResponseMatchesRuntime = Expect<
  Equal<GeneratedResponse, ResponseZod>
>;
type _ConfigMatchesRuntime = Expect<Equal<GeneratedConfig, ConfigZod>>;
type _UpdateMatchesRuntime = Expect<Equal<GeneratedUpdate, UpdateZod>>;
type _GetEnvelopeIsExact = Expect<
  Equal<GetEnvelope["data"], GeneratedResponse>
>;
type _PutEnvelopeIsExact = Expect<
  Equal<PutEnvelope["data"], GeneratedConfig>
>;
type _PathOnlyImplementsGetAndPut = Expect<
  Equal<
    | MonitorPath["post"]
    | MonitorPath["patch"]
    | MonitorPath["delete"],
    undefined
  >
>;

const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);
const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("Growth Map competitor monitor generated OpenAPI", () => {
  it("stays inside the existing Competitor Library rather than creating a module", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/audit/competitor-monitor": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectAuditCompetitorMonitor"];',
    );
    expect(generated).toContain(
      'put: operations["updateProjectAuditCompetitorMonitor"];',
    );
    expect(openapi).toContain("This is a built-in Growth Map");
    expect(openapi).toContain(
      "Competitor Library capability, not a fifth workspace module.",
    );
  });

  it("documents monthly real evidence and explicit unavailable states", () => {
    expect(openapi).toContain("frequency: { type: string, const: monthly }");
    expect(openapi).toContain("first_observed_in_ranked_keywords");
    expect(openapi).toContain("exclusiveMinimum: 5");
    expect(openapi).toContain(
      "Missing source, history, confirmed Topic authority, or a",
    );
    expect(openapi).toContain(
      "comparable window is unavailable; it is never represented as zero.",
    );
  });
});
