import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  createPublicationPreviewService,
  type PublicationPreviewPlanner,
  type PublicationPreviewRepositories,
  type PublicationPreviewServiceDependencies,
} from "./publication-previews";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000101",
  project: "00000000-0000-4000-8000-000000000102",
  site: "00000000-0000-4000-8000-000000000103",
  actor: "00000000-0000-4000-8000-000000000104",
  destination: "00000000-0000-4000-8000-000000000105",
  destinationRow: "00000000-0000-4000-8000-000000000106",
  approval: "00000000-0000-4000-8000-000000000107",
  action: "00000000-0000-4000-8000-000000000108",
  artifact: "00000000-0000-4000-8000-000000000109",
  revision: "00000000-0000-4000-8000-00000000010a",
  sourceAttempt: "00000000-0000-4000-8000-00000000010b",
  sourceReceipt: "00000000-0000-4000-8000-00000000010c",
  previewEvent: "00000000-0000-4000-8000-00000000010d",
  terminalEvent: "00000000-0000-4000-8000-00000000010e",
  previewToken: "00000000-0000-4000-8000-00000000010f",
} as const;

const artifactHash = "a".repeat(64);
const artifactText = "# Customer onboarding";
const contentChecksum = sha256Hex(artifactText);
const previewFactsHash = "d".repeat(64);
const now = new Date("2026-07-28T09:00:00.000Z");
const createdAt = now.toISOString();
const expiresAt = "2026-07-28T09:10:00.000Z";
const previewRef =
  "prv_0000000000004000800000000000010f";

const publishRequest = {
  destinationRef: ids.destination,
  expectedDestinationRevision: 3,
  approvalEventId: ids.approval,
  idempotencyKey: "preview-publish-key",
};

const rollbackRequest = {
  destinationRef: ids.destination,
  expectedDestinationRevision: 3,
  sourcePublicationAttemptId: ids.sourceAttempt,
  sourceChangeReceiptId: ids.sourceReceipt,
  idempotencyKey: "preview-rollback-key",
};

function destination() {
  return {
    id: ids.destinationRow,
    destination_ref: ids.destination,
    revision: 3,
    supersedes_id: null,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    provider_kind: "github" as const,
    target_ref: "/blog/customer-onboarding/",
    state: "ready" as const,
    authorization_grant_id:
      "00000000-0000-4000-8000-000000000120",
    provider_scope: {
      providerKind: "github",
      installationId: 201,
      repositoryId: 101,
      repositoryOwner: "gengrowth",
      repositoryName: "website",
      baseBranch: "main",
      branchPrefix: "gengrowth/",
      contentPath: "content/blog/customer-onboarding.md",
      grantedPermissions: [
        "metadata_read",
        "contents_read",
        "contents_write",
        "pull_requests_write",
      ],
    },
    provider_scope_hash: "c".repeat(64),
    authorization_snapshot: {},
    authorization_snapshot_hash: "e".repeat(64),
    readiness_observation: {
      publicationPlan: {
        providerKind: "github",
        remotePrecondition: {
          kind: "must_match",
          revision: "forged-client-readable-sha",
        },
      },
    },
    limitation: null,
    created_by: ids.actor,
    created_at: createdAt,
  };
}

function previewPlan() {
  return {
    providerPlan: {
      providerKind: "github" as const,
      probeKind: "github_publication_target" as const,
      observedAt: createdAt,
      providerRequestId: "github-request-1",
      remoteScopeRef: "github:repository:101:path:content/blog/customer-onboarding.md",
      facts: { baseBranch: "main", contentPath: "content/blog/customer-onboarding.md" },
    },
    remotePrecondition: {
      kind: "must_match" as const,
      revision: "base-sha",
    },
    rollbackPlan: {
      providerKind: "github" as const,
      strategy: "github_revert_pr" as const,
      priorRemoteRevision: "base-sha",
      expectedCurrentRemoteRevision: "merge-sha",
      facts: { contentPath: "content/blog/customer-onboarding.md" },
    },
  };
}

function fixture(overrides: {
  planner?: Partial<PublicationPreviewPlanner>;
  repositories?: Partial<PublicationPreviewRepositories>;
} = {}) {
  const project = {
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
  };
  const approval = {
    id: ids.approval,
    workspace_id: ids.workspace,
    project_id: ids.project,
    event_kind: "approved",
    artifact_id: ids.artifact,
    artifact_revision_id: ids.revision,
    artifact_revision: 4,
    artifact_content_hash: artifactHash,
    reviewer_actor_id: ids.actor,
  };
  const artifact = {
    id: ids.artifact,
    workspace_id: ids.workspace,
    project_id: ids.project,
    action_id: ids.action,
    status: "ready",
    validation_state: "valid",
    current_revision: 4,
    content_hash: artifactHash,
  };
  const revision = {
    id: ids.revision,
    workspace_id: ids.workspace,
    project_id: ids.project,
    artifact_id: ids.artifact,
    revision: 4,
    content_text: artifactText,
    content_hash: artifactHash,
  };
  const action = {
    id: ids.action,
    status: "approved",
    source_diagnostic_run_id:
      "00000000-0000-4000-8000-000000000121",
    source_finding_id:
      "00000000-0000-4000-8000-000000000122",
  };
  const sourceAttempt = {
    id: ids.sourceAttempt,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    destination_id: ids.destinationRow,
    destination_ref: ids.destination,
    destination_revision: 3,
    provider_kind: "github",
    target_ref: "/blog/customer-onboarding/",
    action_id: ids.action,
    artifact_id: ids.artifact,
    artifact_revision_id: ids.revision,
    approved_artifact_revision: 4,
    approved_artifact_content_hash: artifactHash,
    publication_approval_event_id: ids.approval,
    source_approval_event_id: null,
    content_checksum: contentChecksum,
  };
  const sourceReceipt = {
    id: ids.sourceReceipt,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    publication_attempt_id: ids.sourceAttempt,
    receipt_kind: "change_receipt",
    provider_kind: "github",
    remote_revision: "merge-sha",
    artifact_content_hash: artifactHash,
    content_checksum: contentChecksum,
    verification_state: "verified_live",
  };

  const issuePreview = vi.fn(async (input: {
    readonly previewRef: string;
    readonly previewKind: "publish" | "rollback";
    readonly factsSchemaVersion: string;
    readonly siteId: string;
    readonly sourcePublicationAttemptId: string | null;
    readonly sourceChangeReceiptId: string | null;
    readonly remotePrecondition: Record<string, unknown>;
    readonly rollbackPlan: Record<string, unknown>;
    readonly expiresAt: string;
  }) => ({
    id: ids.previewEvent,
    preview_ref: input.previewRef,
    event_kind: "issued",
    preview_kind: input.previewKind,
    facts_schema_version: input.factsSchemaVersion,
    site_id: input.siteId,
    destination_id: ids.destinationRow,
    destination_ref: ids.destination,
    destination_revision: 3,
    provider_kind: "github",
    target_ref: "/blog/customer-onboarding/",
    action_id: ids.action,
    artifact_id: ids.artifact,
    artifact_revision_id: ids.revision,
    artifact_revision: 4,
    artifact_content_hash: artifactHash,
    artifact_approval_event_id: ids.approval,
    source_publication_attempt_id:
      input.sourcePublicationAttemptId,
    source_change_receipt_id: input.sourceChangeReceiptId,
    remote_precondition: input.remotePrecondition,
    rollback_plan: input.rollbackPlan,
    preview_checksum: artifactHash,
    content_checksum: contentChecksum,
    facts_hash: previewFactsHash,
    expires_at: input.expiresAt,
    created_at: createdAt,
  }));
  const appendTerminalPreviewEvent = vi.fn(async () => ({
    id: ids.terminalEvent,
    event_kind: "revoked",
    supersedes_preview_event_id: ids.previewEvent,
    preview_ref: previewRef,
    created_at: createdAt,
  }));
  const repositories: PublicationPreviewRepositories = {
    projects: {
      findByIdForUpdate: vi.fn(async () => project as never),
    },
    connections: {
      findLatest: vi.fn(async () => destination() as never),
    },
    approvals: {
      findCurrentApproval: vi.fn(async () => approval as never),
      findHistoricalApproval: vi.fn(async () => approval as never),
    },
    artifacts: {
      findByIdForUpdate: vi.fn(async () => artifact as never),
      findById: vi.fn(async () => artifact as never),
      findRevision: vi.fn(async () => revision as never),
    },
    actions: {
      findById: vi.fn(async () => action as never),
    },
    targets: {
      listForFindings: vi.fn(async () => [
        {
          relation: "direct_url",
          target_kind: "url",
          resolution_state: "resolved",
          site_id: ids.site,
          target_ref: "/blog/customer-onboarding/",
        },
      ] as never),
    },
    publications: {
      findAttemptById: vi.fn(async () => sourceAttempt as never),
      requireRollbackSource: vi.fn(async () => ({
        attempt: sourceAttempt,
        changeReceipt: sourceReceipt,
      }) as never),
      findCurrentIssuedPreview: vi.fn(async () => null),
      issuePreview: issuePreview as never,
      appendTerminalPreviewEvent:
        appendTerminalPreviewEvent as never,
    },
    ...overrides.repositories,
  };
  const planner: PublicationPreviewPlanner = {
    resolvePublish: vi.fn(async () => previewPlan()),
    resolveRollback: vi.fn(async () => ({
      ...previewPlan(),
      remotePrecondition: {
        kind: "must_match" as const,
        revision: "merge-sha",
      },
      rollbackPlan: {
        ...previewPlan().rollbackPlan,
        expectedCurrentRemoteRevision: "merge-sha",
      },
    })),
    ...overrides.planner,
  };
  const dependencies: PublicationPreviewServiceDependencies = {
    persistence: {
      transaction: vi.fn(async (operation) => operation(repositories)),
    },
    planner,
    now: () => now,
    previewTtlMs: 10 * 60 * 1_000,
  };
  return {
    service: createPublicationPreviewService(dependencies),
    dependencies,
    repositories,
    planner,
    issuePreview,
    appendTerminalPreviewEvent,
  };
}

describe("publication preview service", () => {
  it("issues a publish preview only from exact active-project, destination, approval and provider-probe facts", async () => {
    const test = fixture();

    const result = await test.service.issuePublish(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      publishRequest.idempotencyKey,
      publishRequest,
    );

    expect(result).toMatchObject({
      previewEventId: ids.previewEvent,
      previewRef: expect.stringMatching(/^prv_[a-f0-9]{64}$/u),
      eventKind: "issued",
      previewKind: "publish",
      destinationId: ids.destinationRow,
      artifactRevisionId: ids.revision,
      artifactContentHash: artifactHash,
      previewChecksum: artifactHash,
      contentChecksum,
      factsHash: previewFactsHash,
      expiresAt,
    });
    expect(test.planner.resolvePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: "github",
        destinationRef: ids.destination,
        artifactRevisionId: ids.revision,
        artifactContentText: artifactText,
      }),
    );
    const plannerInput = vi.mocked(test.planner.resolvePublish).mock
      .calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(plannerInput).not.toHaveProperty("readinessObservation");
    expect(JSON.stringify(plannerInput)).not.toContain(
      "forged-client-readable-sha",
    );
    expect(test.issuePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        previewRef: result.previewRef,
        previewKind: "publish",
        workspaceId: ids.workspace,
        projectId: ids.project,
        artifactRevisionId: ids.revision,
        artifactApprovalEventId: ids.approval,
        providerPlan: previewPlan().providerPlan,
        previewChecksum: artifactHash,
        contentChecksum,
        expiresAt,
      }),
    );
  });

  it("rejects client-supplied provider facts before entering the transaction", async () => {
    const test = fixture();

    await expect(
      test.service.issuePublish(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        publishRequest.idempotencyKey,
        {
          ...publishRequest,
          providerPlan: { providerKind: "github" },
        } as never,
      ),
    ).rejects.toThrow();

    expect(test.dependencies.persistence.transaction).not.toHaveBeenCalled();
    expect(test.planner.resolvePublish).not.toHaveBeenCalled();
    expect(test.issuePreview).not.toHaveBeenCalled();
  });

  it("returns honest unavailability and never issues authority without a provider probe", async () => {
    const test = fixture({
      planner: {
        resolvePublish: vi.fn(async () => {
          throw new ProblemError(
            "DEPENDENCY_UNAVAILABLE",
            "GitHub remote publication probe is not configured.",
          );
        }),
      },
    });

    await expect(
      test.service.issuePublish(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        publishRequest.idempotencyKey,
        publishRequest,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(test.issuePreview).not.toHaveBeenCalled();
  });

  it("issues rollback authority only for the exact verified source change and observed current remote revision", async () => {
    const test = fixture();

    const result = await test.service.issueRollback(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      rollbackRequest.idempotencyKey,
      rollbackRequest,
    );

    expect(result).toMatchObject({
      previewEventId: ids.previewEvent,
      previewRef: expect.stringMatching(/^prv_[a-f0-9]{64}$/u),
      previewKind: "rollback",
      sourcePublicationAttemptId: ids.sourceAttempt,
      sourceChangeReceiptId: ids.sourceReceipt,
      remotePrecondition: {
        kind: "must_match",
        revision: "merge-sha",
      },
    });
    expect(test.repositories.publications.requireRollbackSource)
      .toHaveBeenCalledWith(
        { workspaceId: ids.workspace, projectId: ids.project },
        expect.objectContaining({
          sourcePublicationAttemptId: ids.sourceAttempt,
          sourceChangeReceiptId: ids.sourceReceipt,
        }),
      );
    expect(test.issuePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        previewKind: "rollback",
        sourcePublicationAttemptId: ids.sourceAttempt,
        sourceChangeReceiptId: ids.sourceReceipt,
      }),
    );
  });

  it("allows rollback from an older destination revision when the logical provider target is unchanged", async () => {
    const test = fixture();
    vi.mocked(
      test.repositories.publications.findAttemptById,
    ).mockResolvedValue({
      id: ids.sourceAttempt,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      destination_id:
        "00000000-0000-4000-8000-000000000130",
      destination_ref: ids.destination,
      destination_revision: 2,
      provider_kind: "github",
      target_ref: "/blog/customer-onboarding/",
      action_id: ids.action,
      artifact_id: ids.artifact,
      artifact_revision_id: ids.revision,
      approved_artifact_revision: 4,
      approved_artifact_content_hash: artifactHash,
      publication_approval_event_id: ids.approval,
      source_approval_event_id: null,
      content_checksum: contentChecksum,
    } as never);

    await expect(
      test.service.issueRollback(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        rollbackRequest.idempotencyKey,
        rollbackRequest,
      ),
    ).resolves.toMatchObject({
      previewKind: "rollback",
      destinationRevision: 3,
      sourcePublicationAttemptId: ids.sourceAttempt,
    });
  });

  it("does not issue authority from stale provider probe facts", async () => {
    const test = fixture({
      planner: {
        resolvePublish: vi.fn(async () => ({
          ...previewPlan(),
          providerPlan: {
            ...previewPlan().providerPlan,
            observedAt: "2026-07-28T08:54:59.999Z",
          },
        })),
      },
    });

    await expect(
      test.service.issuePublish(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        publishRequest.idempotencyKey,
        publishRequest,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(test.issuePreview).not.toHaveBeenCalled();
  });

  it("appends a scoped terminal event and keeps preview identity out of the body contract", async () => {
    const test = fixture();
    const request = {
      reason: "Customer cancelled this publication preview.",
      idempotencyKey: "preview-revoke-key",
    };

    await expect(
      test.service.revoke(
        { workspaceId: ids.workspace },
        ids.project,
        ids.previewEvent,
        previewRef,
        ids.actor,
        request.idempotencyKey,
        request,
      ),
    ).resolves.toEqual({
      terminalEventId: ids.terminalEvent,
      eventKind: "revoked",
      supersededPreviewEventId: ids.previewEvent,
      previewRef,
      createdAt,
    });
    expect(test.appendTerminalPreviewEvent).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      {
        sourcePreviewEventId: ids.previewEvent,
        previewRef,
        eventKind: "revoked",
        eventActorId: ids.actor,
        idempotencyKey: request.idempotencyKey,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reason: request.reason,
      },
    );
  });
});
