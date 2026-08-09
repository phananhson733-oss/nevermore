import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { components, operations } from "./generated/openapi.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
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
type ExportSchemaVersion =
  components["schemas"]["ExportBundle"]["schemaVersion"];

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
type _OverviewDecisionReminders = Expect<
  Equal<
    components["schemas"]["OverviewView"]["decisionReminders"],
    components["schemas"]["OverviewDecisionReminder"][]
  >
>;
type _OverviewContentDecayMonitor = Expect<
  Equal<
    components["schemas"]["OverviewView"]["contentDecayMonitor"],
    components["schemas"]["OverviewContentDecayMonitor"]
  >
>;
type _ContentDecayProjectionMode = Expect<
  Equal<
    components["schemas"]["OverviewContentDecayMonitor"]["projectionMode"],
    "read_time"
  >
>;
type _ContentDecayScheduleState = Expect<
  Equal<
    components["schemas"]["OverviewContentDecayMonitor"]["scheduleState"],
    "not_configured"
  >
>;
type _ContentDecayTriggers = Expect<
  Equal<
    components["schemas"]["OverviewContentDecayAlert"]["triggers"][number],
    "rank_decline" | "traffic_decline"
  >
>;
type _OverviewReminderReviewState = Expect<
  Equal<
    components["schemas"]["OverviewDecisionReminder"]["reviewState"],
    "unreviewed" | "needs_more_data"
  >
>;
// Stop gate §19.4: the workspace aggregate serves exactly the one view a
// shipped screen consumes. If this union widens again, that is a deliberate
// contract change, not drift.
type _WorkspaceResponseView = Expect<
  Equal<WorkspaceResponse["data"]["view"], "overview">
>;
type _ReadableExportSchemaVersions = Expect<
  Equal<
    ExportSchemaVersion,
    "signalframe.service-bundle.0.2.0" | "signalframe.service-bundle.0.3.0"
  >
>;
type _SubjectRefType = Expect<
  Equal<
    components["schemas"]["SubjectRef"]["type"],
    | "url"
    | "site"
    | "competitor"
    | "page_set"
    | "http_status"
    | "canonical_issue"
    | "keyword_cluster"
    | "user_agent"
  >
>;
type _RunKinds = Expect<
  Equal<
    components["schemas"]["RunKind"],
    | "collection"
    | "product_profile_synthesis"
    | "diagnostic"
    | "artifact_generation"
    | "export"
    | "content_shadow"
    | "publication"
    | "measurement"
    | "analysis_refresh"
    | "topic_model_generation"
  >
>;
type AsyncRunResult = NonNullable<
  components["schemas"]["AsyncRun"]["resultRef"]
>;
type AsyncAcceptedResource = NonNullable<
  components["schemas"]["AsyncAcceptedResponse"]["data"]["resourceRef"]
>;
type _AsyncRunResultKinds = Expect<
  Equal<
    AsyncRunResult["type"],
    | "collection_run"
    | "product_profile_run"
    | "icp_profile"
    | "diagnostic_run"
    | "artifact"
    | "export"
    | "flow_shadow_run"
    | "publication_attempt"
    | "measurement_window"
    | "analysis_refresh_run"
    | "topic_model_generation_run"
  >
>;
type _AsyncAcceptedResourceKinds = Expect<
  Equal<
    AsyncAcceptedResource["type"],
    | "collection_run"
    | "product_profile_run"
    | "icp_profile"
    | "diagnostic_run"
    | "artifact"
    | "export"
    | "audit_run"
    | "flow_shadow_run"
    | "analysis_refresh_run"
    | "topic_model_generation_run"
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const authoritySchema = readFileSync(
  new URL(
    "../../../authority/implementation-spec-v0.4/schema.sql",
    import.meta.url,
  ),
  "utf8",
);
const authoritySpec = readFileSync(
  new URL(
    "../../../authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
    import.meta.url,
  ),
  "utf8",
);
const topicModelGenerationMigration = readFileSync(
  new URL(
    "../../db/migrations/0048_topic_model_generation.sql",
    import.meta.url,
  ),
  "utf8",
);

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),=])\s*/gu, "$1")
    .trim();

function analysisRefreshPlanSql(
  version: "analysis-refresh.plan.v1" | "analysis-refresh.plan.v2" | "analysis-refresh.plan.v3",
  steps: readonly {
    readonly ordinal: number;
    readonly stepKey: string;
    readonly required: boolean;
  }[],
  hash: string,
): string {
  const sqlSteps = steps
    .map(
      ({ ordinal, stepKey, required }) =>
        `jsonb_build_object('ordinal', ${ordinal}, 'stepKey', '${stepKey}', 'required', ${String(required)})`,
    )
    .join(", ");
  return normalizeWhitespace(
    `plan_manifest = jsonb_build_object('version', '${version}', 'steps', jsonb_build_array(${sqlSteps})) AND plan_hash = '${hash}'`,
  );
}

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
    ] as const) {
      expect(generated).not.toContain(`${property}: "${schemaName}";`);
    }
  });

  it("no longer emits the retired workspace views (stop gate §19.4)", () => {
    // `plan`, `studio` and `report` were Slice 1 redirect screens and
    // `execution` never reached the contract; none of them may resurface as a
    // workspace view literal without a deliberate spec change.
    for (const literal of ["plan", "studio", "report", "execution"] as const) {
      expect(generated).not.toContain(`view: "${literal}";`);
    }
    for (const schemaName of [
      "PlanView",
      "StudioView",
      "ReportView",
    ] as const) {
      expect(generated).not.toContain(schemaName);
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

  it("keeps competitor evidence as an explicit SubjectRef type", () => {
    const start = generated.indexOf("        SubjectRef:");
    const end = generated.indexOf("        Finding:", start);
    const subjectRefSchema = generated.slice(start, end);

    expect(subjectRefSchema).toContain('type: "competitor";');
    expect(subjectRefSchema).toContain(
      'value: components["schemas"]["Uuid"];',
    );
  });

  it("exposes the internal Topic generation run only through shared run discriminators", () => {
    expect(generated).toContain(
      'RunKind: "collection" | "product_profile_synthesis" | "diagnostic" | "artifact_generation" | "export" | "content_shadow" | "publication" | "measurement" | "analysis_refresh" | "topic_model_generation";',
    );
    expect(generated.match(/"topic_model_generation_run"/gu)).toHaveLength(2);
    expect(generated).not.toContain("TopicModelGenerationReservation");
    expect(generated).not.toContain("TopicModelGenerationInvocationAttempt");
  });

  it("adopts migration 0047 verbatim once and preserves exact Analysis Refresh v1/v2/v3 plans", () => {
    const beginMarker =
      "-- BEGIN EXACT ORDERED MIGRATION 0048_topic_model_generation.sql";
    const endMarker =
      "-- END EXACT ORDERED MIGRATION 0048_topic_model_generation.sql";
    const exactMigrationBlock = `${beginMarker}\n${topicModelGenerationMigration.trimEnd()}\n${endMarker}`;

    expect(authoritySchema.split(beginMarker)).toHaveLength(2);
    expect(authoritySchema.split(endMarker)).toHaveLength(2);
    expect(authoritySchema).toContain(exactMigrationBlock);

    const normalizedSchema = normalizeWhitespace(authoritySchema);
    for (const plan of [
      {
        version: "analysis-refresh.plan.v1",
        steps: [
          { ordinal: 1, stepKey: "crawl", required: true },
          { ordinal: 2, stepKey: "gsc", required: false },
          { ordinal: 3, stepKey: "ga4", required: false },
          { ordinal: 4, stepKey: "dataforseo", required: false },
          { ordinal: 5, stepKey: "growth_audit", required: true },
        ],
        hash: "d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af",
      },
      {
        version: "analysis-refresh.plan.v2",
        steps: [
          { ordinal: 1, stepKey: "crawl", required: true },
          { ordinal: 2, stepKey: "gsc", required: false },
          { ordinal: 3, stepKey: "ga4", required: false },
          { ordinal: 4, stepKey: "dataforseo", required: false },
          {
            ordinal: 5,
            stepKey: "dataforseo_backlinks",
            required: false,
          },
          { ordinal: 6, stepKey: "growth_audit", required: true },
        ],
        hash: "3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65",
      },
      {
        version: "analysis-refresh.plan.v3",
        steps: [
          { ordinal: 1, stepKey: "crawl", required: true },
          { ordinal: 2, stepKey: "gsc", required: false },
          { ordinal: 3, stepKey: "ga4", required: false },
          { ordinal: 4, stepKey: "dataforseo", required: false },
          {
            ordinal: 5,
            stepKey: "dataforseo_backlinks",
            required: false,
          },
          { ordinal: 6, stepKey: "topic_model", required: false },
          { ordinal: 7, stepKey: "growth_audit", required: true },
        ],
        hash: "fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b",
      },
    ] as const) {
      expect(normalizedSchema).toContain(
        analysisRefreshPlanSql(plan.version, plan.steps, plan.hash),
      );
      expect(authoritySpec).toContain(`\`${plan.version}\``);
      expect(authoritySpec).toContain(`\`${plan.hash}\``);
    }

    expect(authoritySchema.match(/fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b/gu)).toHaveLength(1);
  });

  it("locks successful Topic invocation lineage without raw prompt or output storage", () => {
    expect(authoritySchema).toMatch(
      /analysis_invocations_task_check[\s\S]*?'topic_model_generation'/u,
    );
    expect(authoritySchema).toContain(
      "app.topic_model_generation_invocation_attempts",
    );
    expect(authoritySchema).toContain("'outcome_unknown'");
    expect(authoritySchema).toContain(
      "keyword_review_decisions_analysis_invocation_fk",
    );
    expect(authoritySchema).not.toMatch(
      /raw_prompt|raw_output|raw_response|prompt_text|response_text/iu,
    );
  });
});
