import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
} from "./generated/openapi.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type ContextRequest =
  operations["updateProjectContext"]["requestBody"]["content"]["application/json"];
type ConnectRequest =
  operations["connectProjectSource"]["requestBody"]["content"]["application/json"];
type ConnectResponse =
  operations["connectProjectSource"]["responses"][200]["content"]["application/json"];
type WorkspaceResponse =
  operations["getProjectWorkspaceView"]["responses"][200]["content"]["application/json"];
type ExportSchemaVersion = components["schemas"]["ExportBundle"]["schemaVersion"];

type _DraftMode = Expect<
  Equal<components["schemas"]["DraftContextRequest"]["mode"], "draft">
>;
type _CompleteMode = Expect<
  Equal<components["schemas"]["CompleteContextRequest"]["mode"], "complete">
>;
type _ContextRequestMode = Expect<
  Equal<ContextRequest["mode"], "draft" | "complete">
>;

type _AuthorizePhase = Expect<
  Equal<components["schemas"]["AuthorizeSourceRequest"]["phase"], "authorize">
>;
type _GetPropertySelectionPhase = Expect<
  Equal<
    components["schemas"]["GetPropertySelectionRequest"]["phase"],
    "property_selection"
  >
>;
type _SelectPropertyPhase = Expect<
  Equal<
    components["schemas"]["SelectPropertyRequest"]["phase"],
    "select_property"
  >
>;
type _ConnectRequestPhase = Expect<
  Equal<
    ConnectRequest["phase"],
    "authorize" | "property_selection" | "select_property"
  >
>;

type _AuthorizationPhase = Expect<
  Equal<components["schemas"]["AuthorizationPhase"]["phase"], "authorization">
>;
type _PropertySelectionPhase = Expect<
  Equal<
    components["schemas"]["PropertySelectionPhase"]["phase"],
    "property_selection"
  >
>;
type _ConnectedPhase = Expect<
  Equal<components["schemas"]["ConnectedPhase"]["phase"], "connected">
>;
type _ConnectResponsePhase = Expect<
  Equal<
    ConnectResponse["data"]["phase"],
    "authorization" | "property_selection" | "connected"
  >
>;

type _OverviewView = Expect<
  Equal<components["schemas"]["OverviewView"]["view"], "overview">
>;
type _OverviewFrozenDiagnosticRun = Expect<
  Equal<
    components["schemas"]["OverviewView"]["frozenDiagnosticRunId"],
    components["schemas"]["Uuid"] | null
  >
>;
type _PlanView = Expect<
  Equal<components["schemas"]["PlanView"]["view"], "plan">
>;
type _StudioView = Expect<
  Equal<components["schemas"]["StudioView"]["view"], "studio">
>;
type _ReportView = Expect<
  Equal<components["schemas"]["ReportView"]["view"], "report">
>;
type _WorkspaceResponseView = Expect<
  Equal<
    WorkspaceResponse["data"]["view"],
    "overview" | "plan" | "studio" | "report"
  >
>;
type _ReadableExportSchemaVersions = Expect<
  Equal<
    ExportSchemaVersion,
    | "signalframe.service-bundle.0.2.0"
    | "signalframe.service-bundle.0.3.0"
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("generated OpenAPI discriminator literals", () => {
  it("emits wire literals instead of component schema names", () => {
    for (const [property, literal] of [
      ["mode", "draft"],
      ["mode", "complete"],
      ["phase", "authorize"],
      ["phase", "property_selection"],
      ["phase", "select_property"],
      ["phase", "authorization"],
      ["phase", "connected"],
      ["view", "overview"],
      ["view", "plan"],
      ["view", "studio"],
      ["view", "report"],
    ] as const) {
      expect(generated).toContain(`${property}: "${literal}";`);
    }

    for (const [property, schemaName] of [
      ["mode", "DraftContextRequest"],
      ["mode", "CompleteContextRequest"],
      ["phase", "AuthorizeSourceRequest"],
      ["phase", "GetPropertySelectionRequest"],
      ["phase", "SelectPropertyRequest"],
      ["phase", "AuthorizationPhase"],
      ["phase", "PropertySelectionPhase"],
      ["phase", "ConnectedPhase"],
      ["view", "OverviewView"],
      ["view", "PlanView"],
      ["view", "StudioView"],
      ["view", "ReportView"],
    ] as const) {
      expect(generated).not.toContain(`${property}: "${schemaName}";`);
    }
  });

  it("documents the fail-closed template locale rule on the public request", () => {
    const localeRule =
      "Template generation supports only en and zh-CN; use structured_llm for every other valid BCP-47 output locale.";

    expect(generated.split(localeRule)).toHaveLength(3);
  });

  it("keeps historical 0.2 export read DTOs compatible with current 0.3 exports", () => {
    expect(generated).toContain(
      'schemaVersion: "signalframe.service-bundle.0.2.0" | "signalframe.service-bundle.0.3.0";',
    );
  });
});
