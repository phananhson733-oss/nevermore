import {
  ArtifactApprovalConflictError,
  ArtifactApprovalsRepository,
  ExecutionArtifactsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowRunsRepository,
  IdempotencyRepository,
  ProjectsRepository,
  type ArtifactApprovalEventRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type FlowShadowQaGateRow,
  type FlowShadowRunRow,
  type IdempotencyRow,
  type ProjectRow,
} from "@sf/db";
import type {
  AppendArtifactApprovalEventRequest,
  ApproveArtifactRevisionRequest,
} from "@sf/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  ARTIFACT_VALIDATION_QA_GATE_VERSION,
  appendArtifactApprovalEvent,
} = await import("./artifact-approval.ts");

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  artifact: "10000000-0000-4000-8000-000000000004",
  otherArtifact: "10000000-0000-4000-8000-000000000005",
  revision: "10000000-0000-4000-8000-000000000006",
  approval: "10000000-0000-4000-8000-000000000007",
  terminal: "10000000-0000-4000-8000-000000000008",
  acknowledgement: "10000000-0000-4000-8000-000000000009",
  idempotency: "10000000-0000-4000-8000-00000000000a",
  flowShadowRun: "10000000-0000-4000-8000-00000000000b",
  capabilityRun: "10000000-0000-4000-8000-00000000000c",
  finding: "10000000-0000-4000-8000-00000000000d",
  action: "10000000-0000-4000-8000-00000000000e",
  brief: "10000000-0000-4000-8000-00000000000f",
  site: "10000000-0000-4000-8000-000000000010",
  qaGate: "10000000-0000-4000-8000-000000000011",
} as const;

const scope = { workspaceId: ids.workspace };
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const contentHash = "a".repeat(64);
const qaGateSnapshotHash = "b".repeat(64);
const acknowledgementHash = "c".repeat(64);
const now = "2026-07-27T10:00:00.000Z";
const db = { transaction: mocks.transaction };
const tx = { transaction: true };

const project: ProjectRow = {
  id: ids.project,
  workspace_id: ids.workspace,
  client_name: "RelayOps",
  project_name: "RelayOps",
  stage: "executing",
  default_delivery_locale: "en-US",
  current_icp_profile_id: null,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: ids.actor,
  created_at: now,
  updated_at: now,
};

function artifactRow(
  overrides: Partial<ArtifactRow> = {},
): ArtifactRow {
  return {
    id: ids.artifact,
    workspace_id: ids.workspace,
    project_id: ids.project,
    action_id: ids.action,
    artifact_type: "technical_ticket",
    status: "ready",
    generation_mode: "template",
    output_locale: "en-US",
    current_revision: 3,
    validation_state: "valid",
    content_hash: contentHash,
    latest_generation_run_id: null,
    created_by: ids.actor,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function revisionRow(
  overrides: Partial<ArtifactRevisionRow> = {},
): ArtifactRevisionRow {
  return {
    id: ids.revision,
    workspace_id: ids.workspace,
    project_id: ids.project,
    artifact_id: ids.artifact,
    revision: 3,
    output_locale: "en-US",
    content_format: "markdown",
    content_text: "# Canonical patch",
    content_json: null,
    content_hash: contentHash,
    generated_by: "operator",
    editor_id: ids.actor,
    analysis_invocation_id: null,
    note: null,
    validation_errors: [],
    created_at: now,
    ...overrides,
  };
}

function approvalRow(
  overrides: Partial<ArtifactApprovalEventRow> = {},
): ArtifactApprovalEventRow {
  return {
    id: ids.approval,
    workspace_id: ids.workspace,
    project_id: ids.project,
    artifact_id: ids.artifact,
    artifact_revision_id: ids.revision,
    artifact_revision: 3,
    artifact_content_hash: contentHash,
    event_kind: "approved",
    supersedes_approval_event_id: null,
    supersedes_approval_event_kind: null,
    event_actor_id: ids.actor,
    reviewer_actor_id: ids.actor,
    qa_gate_version: ARTIFACT_VALIDATION_QA_GATE_VERSION,
    qa_gate_snapshot: {
      authority: "artifact_revision_validation",
      artifactId: ids.artifact,
      artifactRevisionId: ids.revision,
      artifactRevision: 3,
      artifactContentHash: contentHash,
      artifactType: "technical_ticket",
      artifactStatus: "ready",
      validationState: "valid",
      validationErrors: [],
    },
    qa_gate_snapshot_hash: qaGateSnapshotHash,
    customer_acknowledgement: {
      customerAcknowledgementId: ids.acknowledgement,
      actorId: ids.actor,
      acknowledgedAt: now,
      acknowledgementScope:
        "exact_artifact_revision_for_publication",
    },
    customer_acknowledgement_hash: acknowledgementHash,
    reason: null,
    created_at: now,
    ...overrides,
  };
}

function terminalRow(
  eventKind: "revoked" | "superseded" = "revoked",
): ArtifactApprovalEventRow {
  return approvalRow({
    id: ids.terminal,
    event_kind: eventKind,
    supersedes_approval_event_id: ids.approval,
    supersedes_approval_event_kind: "approved",
    event_actor_id: ids.actor,
    reviewer_actor_id: null,
    reason: "Customer withdrew publication approval.",
  });
}

function idempotencyRow(
  overrides: Partial<IdempotencyRow> = {},
): IdempotencyRow {
  return {
    id: ids.idempotency,
    workspace_id: ids.workspace,
    scope: "appendArtifactApprovalEvent",
    idempotency_key: "approval-command-1",
    request_hash: "d".repeat(64),
    status: "in_progress",
    response_status: null,
    response_body: null,
    resource_type: null,
    resource_id: null,
    expires_at: "2026-07-28T10:00:00.000Z",
    ...overrides,
  };
}

const approveBody: ApproveArtifactRevisionRequest = {
  eventKind: "approved",
  artifactRevisionId: ids.revision,
  expectedArtifactRevision: 3,
  expectedQaGateVersion: ARTIFACT_VALIDATION_QA_GATE_VERSION,
  customerAcknowledgementInput: {
    acknowledged: true,
    acknowledgementScope:
      "exact_artifact_revision_for_publication",
  },
};

function append(
  body: AppendArtifactApprovalEventRequest = approveBody,
  idempotencyKey = "approval-command-1",
) {
  return appendArtifactApprovalEvent(
    scope,
    ids.project,
    ids.artifact,
    ids.actor,
    idempotencyKey,
    body,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDb.mockReset().mockReturnValue({ db });
  mocks.transaction.mockReset().mockImplementation(
    async (operation: (executor: object) => Promise<unknown>) =>
      operation(tx),
  );

  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue(artifactRow());
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findRevision",
  ).mockResolvedValue(revisionRow());
  vi.spyOn(
    FlowShadowQaGatesRepository.prototype,
    "findLatestByArtifact",
  ).mockResolvedValue(null);
  vi.spyOn(
    FlowShadowRunsRepository.prototype,
    "findById",
  ).mockResolvedValue(null);
  vi.spyOn(
    ArtifactApprovalsRepository.prototype,
    "approveExactRevision",
  ).mockResolvedValue(approvalRow());
  vi.spyOn(
    ArtifactApprovalsRepository.prototype,
    "findHistoricalApproval",
  ).mockResolvedValue(approvalRow());
  vi.spyOn(
    ArtifactApprovalsRepository.prototype,
    "invalidateApproval",
  ).mockResolvedValue(terminalRow());
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue(
    idempotencyRow(),
  );
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
});

describe("appendArtifactApprovalEvent approval", () => {
  it("freezes the exact scoped ready and valid revision under a server QA snapshot", async () => {
    const result = await append();

    expect(result).toEqual({
      approvalEventId: ids.approval,
      eventKind: "approved",
      supersedesApprovalEventId: null,
      eventActorId: ids.actor,
      artifactId: ids.artifact,
      artifactRevisionId: ids.revision,
      artifactRevision: 3,
      artifactContentHash: contentHash,
      reviewerActorId: ids.actor,
      qaGateVersion: ARTIFACT_VALIDATION_QA_GATE_VERSION,
      qaGateSnapshot: expect.objectContaining({
        authority: "artifact_revision_validation",
        artifactId: ids.artifact,
        artifactRevisionId: ids.revision,
        artifactContentHash: contentHash,
        artifactStatus: "ready",
        validationState: "valid",
      }),
      qaGateSnapshotHash,
      customerAcknowledgement: {
        customerAcknowledgementId: ids.acknowledgement,
        actorId: ids.actor,
        acknowledgedAt: now,
        acknowledgementScope:
          "exact_artifact_revision_for_publication",
      },
      reason: null,
      recordedAt: now,
    });
    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).toHaveBeenCalledWith({
      ...projectScope,
      artifactRevisionId: ids.revision,
      expectedArtifactRevision: 3,
      expectedQaGateVersion: ARTIFACT_VALIDATION_QA_GATE_VERSION,
      actorId: ids.actor,
      qaGate: {
        version: ARTIFACT_VALIDATION_QA_GATE_VERSION,
        snapshot: expect.objectContaining({
          artifactId: ids.artifact,
          artifactRevisionId: ids.revision,
          artifactContentHash: contentHash,
          validationErrors: [],
        }),
      },
      customerAcknowledgementInput:
        approveBody.customerAcknowledgementInput,
    });
    expect(IdempotencyRepository.prototype.complete).toHaveBeenCalledWith(
      ids.idempotency,
      expect.objectContaining({
        responseStatus: 201,
        responseBody: result,
        resourceType: "artifact_approval_event",
        resourceId: ids.approval,
      }),
    );
  });

  it("rejects a body revision id that is not the path artifact's exact revision", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce(
      revisionRow({
        id: "10000000-0000-4000-8000-000000000099",
      }),
    );

    await expect(append()).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).not.toHaveBeenCalled();
  });

  it("rejects stale artifact revision, content hash, status, and validation facts before append", async () => {
    const cases: readonly [string, ArtifactRow][] = [
      [
        "revision",
        artifactRow({ current_revision: 4 }),
      ],
      [
        "hash",
        artifactRow({ content_hash: "e".repeat(64) }),
      ],
      [
        "status",
        artifactRow({ status: "draft" }),
      ],
      [
        "validation",
        artifactRow({ validation_state: "invalid" }),
      ],
    ];

    for (const [, row] of cases) {
      vi.mocked(
        ExecutionArtifactsRepository.prototype.findByIdForUpdate,
      ).mockResolvedValueOnce(row);
      await expect(append()).rejects.toMatchObject({
        code:
          row.status !== "ready" || row.validation_state !== "valid"
            ? "ARTIFACT_VALIDATION_FAILED"
            : "STALE_REVISION",
      });
    }
    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).not.toHaveBeenCalled();
  });

  it("freezes the exact Content Shadow QA authority instead of inventing a generic pass", async () => {
    const gate: FlowShadowQaGateRow = {
      id: ids.qaGate,
      workspace_id: ids.workspace,
      project_id: ids.project,
      flow_shadow_run_id: ids.flowShadowRun,
      evaluated_artifact_id: ids.artifact,
      evaluated_revision: 3,
      analysis_invocation_id: null,
      verdict: "needs_review",
      claims: [
        {
          claimId: "content-shadow.qa.coverage",
          kind: "coverage",
          status: "failed",
          detail: "One brief section needs human review.",
        },
      ],
      created_at: now,
    };
    const shadowRun: FlowShadowRunRow = {
      id: ids.flowShadowRun,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      capability_run_id: ids.capabilityRun,
      source_finding_id: ids.finding,
      source_action_id: ids.action,
      content_brief_artifact_id: ids.brief,
      content_brief_revision: 2,
      flow_adapter_version: "content-shadow-adapter.0.4.0",
      frozen_input_manifest: {},
      content_hash: "f".repeat(64),
      projection_version: "content-shadow.0.4.0",
      created_at: now,
    };
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce(
      artifactRow({ artifact_type: "english_blog_draft" }),
    );
    vi.mocked(
      FlowShadowQaGatesRepository.prototype.findLatestByArtifact,
    ).mockResolvedValueOnce(gate);
    vi.mocked(
      FlowShadowRunsRepository.prototype.findById,
    ).mockResolvedValueOnce(shadowRun);
    vi.mocked(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).mockResolvedValueOnce(
      approvalRow({
        qa_gate_version: shadowRun.flow_adapter_version,
        qa_gate_snapshot: {
          authority: "content_shadow_qa_gate",
          gateId: gate.id,
          flowShadowRunId: shadowRun.id,
          evaluatedArtifactId: ids.artifact,
          evaluatedRevision: 3,
          verdict: gate.verdict,
          claims: gate.claims,
          evaluatedAt: now,
          analysisInvocationId: null,
          flowAdapterVersion: shadowRun.flow_adapter_version,
          projectionVersion: shadowRun.projection_version,
          frozenInputHash: shadowRun.content_hash,
        },
      }),
    );

    await append({
      ...approveBody,
      expectedQaGateVersion: shadowRun.flow_adapter_version,
    });

    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        qaGate: {
          version: shadowRun.flow_adapter_version,
          snapshot: {
            authority: "content_shadow_qa_gate",
            gateId: gate.id,
            flowShadowRunId: shadowRun.id,
            evaluatedArtifactId: ids.artifact,
            evaluatedRevision: 3,
            verdict: "needs_review",
            claims: gate.claims,
            evaluatedAt: now,
            analysisInvocationId: null,
            flowAdapterVersion: shadowRun.flow_adapter_version,
            projectionVersion: shadowRun.projection_version,
            frozenInputHash: shadowRun.content_hash,
          },
        },
      }),
    );
  });

  it("fails closed when an English draft has no exact current QA judgement", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValue(
      artifactRow({ artifact_type: "english_blog_draft" }),
    );

    await expect(
      append({
        ...approveBody,
        expectedQaGateVersion: "content-shadow-adapter.0.4.0",
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });

    vi.mocked(
      FlowShadowQaGatesRepository.prototype.findLatestByArtifact,
    ).mockResolvedValueOnce({
      id: ids.qaGate,
      workspace_id: ids.workspace,
      project_id: ids.project,
      flow_shadow_run_id: ids.flowShadowRun,
      evaluated_artifact_id: ids.artifact,
      evaluated_revision: 2,
      analysis_invocation_id: null,
      verdict: "passed",
      claims: [],
      created_at: now,
    });
    await expect(
      append({
        ...approveBody,
        expectedQaGateVersion: "content-shadow-adapter.0.4.0",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });
  });

  it("refuses a blocked Content Shadow gate and an orphaned gate authority", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValue(
      artifactRow({ artifact_type: "english_blog_draft" }),
    );
    const gate: FlowShadowQaGateRow = {
      id: ids.qaGate,
      workspace_id: ids.workspace,
      project_id: ids.project,
      flow_shadow_run_id: ids.flowShadowRun,
      evaluated_artifact_id: ids.artifact,
      evaluated_revision: 3,
      analysis_invocation_id: null,
      verdict: "blocked",
      claims: [],
      created_at: now,
    };
    vi.mocked(
      FlowShadowQaGatesRepository.prototype.findLatestByArtifact,
    ).mockResolvedValueOnce(gate);
    await expect(
      append({
        ...approveBody,
        expectedQaGateVersion: "content-shadow-adapter.0.4.0",
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_VALIDATION_FAILED",
      status: 422,
    });

    vi.mocked(
      FlowShadowQaGatesRepository.prototype.findLatestByArtifact,
    ).mockResolvedValueOnce({ ...gate, verdict: "passed" });
    await expect(
      append({
        ...approveBody,
        expectedQaGateVersion: "content-shadow-adapter.0.4.0",
      }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("rejects a stale expected QA version without appending an event", async () => {
    await expect(
      append({
        ...approveBody,
        expectedQaGateVersion: "artifact-validation.0",
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).not.toHaveBeenCalled();
  });
});

describe("appendArtifactApprovalEvent terminal events", () => {
  it.each(["revoked", "superseded"] as const)(
    "appends %s with the authenticated actor while preserving source lineage",
    async (eventKind) => {
      vi.mocked(
        ArtifactApprovalsRepository.prototype.invalidateApproval,
      ).mockResolvedValueOnce(terminalRow(eventKind));
      const body = {
        eventKind,
        supersedesApprovalEventId: ids.approval,
        reason: "Customer withdrew publication approval.",
      };

      const result = await append(body);

      expect(
        ArtifactApprovalsRepository.prototype.findHistoricalApproval,
      ).toHaveBeenCalledWith(projectScope, ids.approval);
      expect(
        ArtifactApprovalsRepository.prototype.invalidateApproval,
      ).toHaveBeenCalledWith({
        ...projectScope,
        sourceApprovalEventId: ids.approval,
        eventKind,
        actorId: ids.actor,
        reason: body.reason,
      });
      expect(result).toMatchObject({
        approvalEventId: ids.terminal,
        eventKind,
        supersedesApprovalEventId: ids.approval,
        eventActorId: ids.actor,
        reviewerActorId: null,
      });
    },
  );

  it("hides a source approval belonging to another artifact behind NOT_FOUND", async () => {
    vi.mocked(
      ArtifactApprovalsRepository.prototype.findHistoricalApproval,
    ).mockResolvedValueOnce(
      approvalRow({ artifact_id: ids.otherArtifact }),
    );

    await expect(
      append({
        eventKind: "revoked",
        supersedesApprovalEventId: ids.approval,
        reason: "Customer withdrew publication approval.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(
      ArtifactApprovalsRepository.prototype.invalidateApproval,
    ).not.toHaveBeenCalled();
  });
});

describe("appendArtifactApprovalEvent tenant, conflict and replay semantics", () => {
  it("returns NOT_FOUND for a project or artifact outside the session workspace", async () => {
    vi.mocked(
      ProjectsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce(null);
    await expect(append()).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce(null);
    await expect(append()).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("rejects an archived project inside the same transaction as the append", async () => {
    vi.mocked(
      ProjectsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce({
      ...project,
      archived_at: now,
    });

    await expect(append()).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      status: 422,
    });
    expect(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).not.toHaveBeenCalled();
  });

  it("replays a completed same-key command before reading mutable project or artifact state", async () => {
    const response = approvalRow();
    const expected = {
      approvalEventId: ids.approval,
      eventKind: "approved",
      supersedesApprovalEventId: null,
      eventActorId: ids.actor,
      artifactId: ids.artifact,
      artifactRevisionId: ids.revision,
      artifactRevision: 3,
      artifactContentHash: contentHash,
      reviewerActorId: ids.actor,
      qaGateVersion: ARTIFACT_VALIDATION_QA_GATE_VERSION,
      qaGateSnapshot: response.qa_gate_snapshot,
      qaGateSnapshotHash,
      customerAcknowledgement: response.customer_acknowledgement,
      reason: null,
      recordedAt: now,
    };

    // Capture the canonical request hash through one successful command, then
    // replay an immutable row carrying that same hash.
    await append(undefined, "seed-key");
    const beginCall = vi.mocked(
      IdempotencyRepository.prototype.begin,
    ).mock.calls.at(-1)?.[0];
    vi.mocked(IdempotencyRepository.prototype.find).mockReset().mockResolvedValue(
      idempotencyRow({
        request_hash: beginCall?.requestHash ?? "",
        status: "completed",
        response_status: 201,
        response_body: expected,
        resource_type: "artifact_approval_event",
        resource_id: ids.approval,
      }),
    );
    vi.mocked(
      ProjectsRepository.prototype.findByIdForUpdate,
    ).mockClear();
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockClear();

    await expect(append(undefined, "seed-key")).resolves.toEqual(expected);
    expect(
      ProjectsRepository.prototype.findByIdForUpdate,
    ).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).not.toHaveBeenCalled();
  });

  it("rejects same key reused for a different command and an in-progress winner", async () => {
    await append(undefined, "shared-key");
    const requestHash = vi.mocked(
      IdempotencyRepository.prototype.begin,
    ).mock.calls.at(-1)?.[0].requestHash;

    vi.mocked(IdempotencyRepository.prototype.find).mockReset().mockResolvedValue(
      idempotencyRow({
        idempotency_key: "shared-key",
        request_hash: requestHash ?? "",
        status: "in_progress",
      }),
    );
    await expect(append(undefined, "shared-key")).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });

    await expect(
      append(
        {
          eventKind: "revoked",
          supersedesApprovalEventId: ids.approval,
          reason: "Customer withdrew publication approval.",
        },
        "shared-key",
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
  });

  it.each([
    ["ARTIFACT_REVISION_NOT_FOUND", "NOT_FOUND"],
    ["ARTIFACT_REVISION_STALE", "STALE_REVISION"],
    ["ARTIFACT_REVISION_NOT_READY", "ARTIFACT_VALIDATION_FAILED"],
    ["QA_GATE_VERSION_STALE", "VERSION_CONFLICT"],
    ["CUSTOMER_ACKNOWLEDGEMENT_REQUIRED", "VALIDATION_ERROR"],
    ["APPROVAL_ALREADY_TERMINAL", "VERSION_CONFLICT"],
    ["APPROVAL_NOT_FOUND", "NOT_FOUND"],
  ] as const)("maps repository conflict %s to product problem %s", async (repoCode, problemCode) => {
    if (repoCode.startsWith("APPROVAL_")) {
      vi.mocked(
        ArtifactApprovalsRepository.prototype.invalidateApproval,
      ).mockRejectedValueOnce(new ArtifactApprovalConflictError(repoCode));
      await expect(
        append({
          eventKind: "revoked",
          supersedesApprovalEventId: ids.approval,
          reason: "Customer withdrew publication approval.",
        }),
      ).rejects.toMatchObject({ code: problemCode });
      return;
    }
    vi.mocked(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).mockRejectedValueOnce(new ArtifactApprovalConflictError(repoCode));
    await expect(append()).rejects.toMatchObject({ code: problemCode });
  });

  it("maps a concurrent approval unique constraint to an optimistic conflict", async () => {
    vi.mocked(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).mockRejectedValueOnce({
      code: "23505",
      constraint:
        "artifact_approval_events_one_approval_per_revision_idx",
    });

    await expect(append()).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
  });

  it("fails closed when persistence returns a malformed server event", async () => {
    vi.mocked(
      ArtifactApprovalsRepository.prototype.approveExactRevision,
    ).mockResolvedValueOnce(
      approvalRow({
        created_at: "not-an-instant",
      }),
    );

    await expect(append()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(IdempotencyRepository.prototype.complete).not.toHaveBeenCalled();
  });
});
