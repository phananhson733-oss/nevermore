import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TopicModelWorkspaceProjection } from "./zod/keyword-governance.ts";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  BeginTopicModelDraftRequest as BeginTopicModelDraftRequestZod,
  ConfirmTopicModelRequest as ConfirmTopicModelRequestZod,
  PatchTopicModelDraftRequest as PatchTopicModelDraftRequestZod,
  TopicModelRevision as TopicModelRevisionZod,
  TopicModelWorkspaceProjection as TopicModelWorkspaceProjectionZod,
  TopicNodeDraftIntent as TopicNodeDraftIntentZod,
} from "./zod/keyword-governance.ts";

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

type WorkspaceOperation =
  operations["getProjectAuditTopicModelWorkspace"];
type BeginOperation = operations["beginProjectAuditTopicModelDraft"];
type PatchOperation = operations["patchProjectAuditTopicModelDraft"];
type ConfirmOperation = operations["confirmProjectAuditTopicModelDraft"];

type WorkspaceHttpResponse =
  WorkspaceOperation["responses"][200]["content"]["application/json"];
type BeginHttpResponse =
  BeginOperation["responses"][200]["content"]["application/json"];
type PatchHttpResponse =
  PatchOperation["responses"][200]["content"]["application/json"];
type ConfirmHttpResponse =
  ConfirmOperation["responses"][200]["content"]["application/json"];

type Workspace =
  components["schemas"]["TopicModelWorkspaceProjection"];
type DraftModel = components["schemas"]["TopicModelDraftRevision"];
type ConfirmedModel =
  components["schemas"]["TopicModelConfirmedRevision"];
type TopicIntent = components["schemas"]["TopicNodeDraftIntent"];
type BeginRequest =
  BeginOperation["requestBody"]["content"]["application/json"];
type PatchRequest =
  PatchOperation["requestBody"]["content"]["application/json"];
type ConfirmRequest =
  ConfirmOperation["requestBody"]["content"]["application/json"];

type _WorkspaceEnvelope = Expect<
  Equal<WorkspaceHttpResponse["data"], Workspace>
>;
type _AllMutationEnvelopesStayOnWorkspace = Expect<
  Equal<
    | BeginHttpResponse["data"]
    | PatchHttpResponse["data"]
    | ConfirmHttpResponse["data"],
    Workspace
  >
>;
type _WorkspaceMatchesRuntime = Expect<
  Equal<Workspace, TopicModelWorkspaceProjectionZod>
>;
type _DraftMatchesRuntime = Expect<
  Equal<DraftModel, Extract<TopicModelRevisionZod, { state: "draft" }>>
>;
type _ConfirmedMatchesRuntime = Expect<
  Equal<
    ConfirmedModel,
    Extract<TopicModelRevisionZod, { state: "confirmed" }>
  >
>;
type _IntentMatchesRuntime = Expect<
  Equal<TopicIntent, TopicNodeDraftIntentZod>
>;
type _BeginMatchesRuntime = Expect<
  Equal<BeginRequest, BeginTopicModelDraftRequestZod>
>;
type _PatchMatchesRuntime = Expect<
  Equal<PatchRequest, PatchTopicModelDraftRequestZod>
>;
type _ConfirmMatchesRuntime = Expect<
  Equal<ConfirmRequest, ConfirmTopicModelRequestZod>
>;
type _WorkspaceIsClosed = Expect<
  Equal<string extends keyof Workspace ? true : false, false>
>;
type _WorkspaceAllFieldsRequired = Expect<
  Equal<RequiredKeys<Workspace>, keyof Workspace>
>;
type _BeginAllFieldsRequired = Expect<
  Equal<RequiredKeys<BeginRequest>, keyof BeginRequest>
>;
type _PatchAllFieldsRequired = Expect<
  Equal<RequiredKeys<PatchRequest>, keyof PatchRequest>
>;
type _ConfirmAllFieldsRequired = Expect<
  Equal<RequiredKeys<ConfirmRequest>, keyof ConfirmRequest>
>;
type _BeginServerFactsForbidden = Expect<
  Equal<
    Extract<
      keyof BeginRequest,
      | "actorId"
      | "createdAt"
      | "generationBasis"
      | "evidenceRefs"
      | "rootTopicNodeId"
      | "nodes"
    >,
    never
  >
>;
type _PatchServerFactsForbidden = Expect<
  Equal<
    Extract<
      keyof PatchRequest,
      | "actorId"
      | "createdAt"
      | "updatedAt"
      | "clusterKey"
      | "aliases"
      | "contentHash"
    >,
    never
  >
>;
type _BeginResponses = Expect<
  Equal<
    keyof BeginOperation["responses"],
    200 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;
type _PatchResponses = Expect<
  Equal<
    keyof PatchOperation["responses"],
    200 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;
type _ConfirmResponses = Expect<
  Equal<
    keyof ConfirmOperation["responses"],
    200 | 401 | 404 | 409 | 422 | 429 | 503
  >
>;

type WorkspacePath =
  paths["/projects/{projectId}/audit/topic-model"];
type DraftPath =
  paths["/projects/{projectId}/audit/topic-model/draft"];
type ConfirmPath =
  paths["/projects/{projectId}/audit/topic-model/draft/confirm"];
type _WorkspacePathIsReadOnly = Expect<
  Equal<
    | WorkspacePath["post"]
    | WorkspacePath["put"]
    | WorkspacePath["patch"]
    | WorkspacePath["delete"],
    undefined
  >
>;
type _DraftPathHasOnlyPostAndPatch = Expect<
  Equal<
    | DraftPath["get"]
    | DraftPath["put"]
    | DraftPath["delete"],
    undefined
  >
>;
type _ConfirmPathHasOnlyPost = Expect<
  Equal<
    | ConfirmPath["get"]
    | ConfirmPath["put"]
    | ConfirmPath["patch"]
    | ConfirmPath["delete"],
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

describe("Growth Map Topic Model generated OpenAPI contract", () => {
  it("accepts an explicitly system-confirmed Topic revision with truthful generated lineage", () => {
    const projectId = "70000000-0000-4000-8000-000000000001";
    const actorId = "70000000-0000-4000-8000-000000000002";
    const rootTopicNodeId = "70000000-0000-4000-8000-000000000003";
    const invocationId = "70000000-0000-4000-8000-000000000004";
    const confirmedAt = "2026-08-09T09:00:00.000Z";
    const projection = {
      projectId,
      latestConfirmed: {
        state: "confirmed",
        projectId,
        topicModelRevision: 1,
        editRevision: 1,
        rootTopicNodeId,
        nodes: [
          {
            projectId,
            topicNodeId: rootTopicNodeId,
            topicModelRevision: 1,
            parentTopicNodeId: null,
            label: "Growth strategy",
            description: "The generated Topic root.",
            intentEnvelope: ["commercial"],
            lifecycleState: "active",
          },
        ],
        aliases: [],
        successorRelationships: [],
        createdAt: confirmedAt,
        createdBy: actorId,
        confirmedAt,
        confirmedBy: null,
        confirmationMode: "system_auto",
        contentHash: "a".repeat(64),
        generationSummary: {
          origin: "llm_auto_confirmed",
          generationVersion: "topic-model-generation.v1",
          baseTopicModelRevision: null,
          analysisInvocationId: invocationId,
          promptSetVersion: "topic-model.prompt.v1",
          inputHash: "b".repeat(64),
          generatedAt: confirmedAt,
          keywordGroupCount: 2,
          keywordCount: 5,
          assignedCount: 2,
          unassignedGroupCount: 1,
          skippedCount: 3,
          limitations: [
            "keyword_assignments_skipped",
            "topic_groups_unassigned",
          ],
          reason: "Initial model generated by Analysis Refresh",
        },
      },
      draft: null,
      generatedAt: confirmedAt,
    } as const;

    expect(TopicModelWorkspaceProjection.parse(projection)).toEqual(
      projection,
    );
  });

  it("publishes the workspace and exact draft lifecycle without a separate module", () => {
    for (const path of [
      "/projects/{projectId}/audit/topic-model",
      "/projects/{projectId}/audit/topic-model/draft",
      "/projects/{projectId}/audit/topic-model/draft/confirm",
    ]) {
      expect(generated).toContain(`"${path}": {`);
    }
    expect(generated).toContain(
      'get: operations["getProjectAuditTopicModelWorkspace"];',
    );
    expect(generated).toContain(
      'post: operations["beginProjectAuditTopicModelDraft"];',
    );
    expect(generated).toContain(
      'patch: operations["patchProjectAuditTopicModelDraft"];',
    );
    expect(generated).toContain(
      'post: operations["confirmProjectAuditTopicModelDraft"];',
    );
    expect(openapi).toContain(
      "Topic Map is an internal Growth Map capability, not a fifth customer workspace module.",
    );
  });

  it("keeps every request closed and every identity/provenance fact server-owned", () => {
    for (const schema of [
      "BeginTopicModelDraftRequest",
      "CreateTopicNodeIntent",
      "UpdateTopicNodeIntent",
      "RenameTopicNodeIntent",
      "RetireTopicNodeIntent",
      "SplitTopicNodeIntent",
      "MergeTopicNodeIntent",
      "PatchTopicModelDraftRequest",
      "ConfirmTopicModelRequest",
    ]) {
      expect(openapi).toMatch(
        new RegExp(`${schema}:\\n\\s+type: object\\n\\s+additionalProperties: false`, "u"),
      );
    }
    expect(openapi).toContain(
      "Actor identity, generation provenance, evidence, timestamps,",
    );
    expect(openapi).toContain(
      "The client never\n        submits Topic Node UUIDs for new nodes, legacy aliases, actors, provenance, or timestamps.",
    );
  });

  it("keeps compare-and-swap fields inside PostgreSQL integer ceilings", () => {
    expect(openapi).toMatch(
      /BeginTopicModelDraftRequest:[\s\S]*?expectedLatestConfirmedRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483646/u,
    );
    expect(openapi).toMatch(
      /PatchTopicModelDraftRequest:[\s\S]*?topicModelRevision:\s*\n\s*type: integer\s*\n\s*minimum: 1\s*\n\s*maximum: 2147483647[\s\S]*?expectedEditRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483646/u,
    );
    expect(openapi).toMatch(
      /ConfirmTopicModelRequest:[\s\S]*?expectedEditRevision:\s*\n\s*type: integer\s*\n\s*minimum: 0\s*\n\s*maximum: 2147483647/u,
    );
  });

  it("preserves all six governed edit intent discriminator literals", () => {
    for (const literal of [
      "create",
      "update",
      "rename",
      "retire",
      "split",
      "merge",
    ]) {
      expect(generated).toContain(`kind: "${literal}";`);
    }
    expect(generated).toContain(
      'affectedKeywordReviewState: "unreviewed";',
    );
  });
});
