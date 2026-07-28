import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ActionRow,
  ArtifactApprovalEventRow,
  ArtifactRevisionRow,
  ArtifactRow,
  AsyncRunRow,
  DeliveryAuthorizationGrantRow,
  FindingTargetRow,
  PublicationAttemptExecutionRead,
  PublicationAttemptRow,
  PublicationDestinationRow,
  PublicationReceiptRow,
} from "@sf/db";
import {
  AsyncRunsRepository,
  ProjectsRepository,
  PublicationsRepository,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  buildPublicationExecutionFacts,
  createDbPublicationAuthority,
} from "./db-authority.ts";
import type { PublicationReceiptWrite } from "./run-publication.ts";

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const CONTENT = "# Customer onboarding\n\nApproved content.";
const CONTENT_CHECKSUM = createHash("sha256")
  .update(CONTENT, "utf8")
  .digest("hex");
const ARTIFACT_HASH = "a".repeat(64);
const NOW = new Date("2026-07-27T08:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

function baseInput(providerKind: "github" | "wordpress") {
  const workspaceId = id("1");
  const projectId = id("2");
  const runId = id("3");
  const attemptId = id("4");
  const siteId = id("5");
  const destinationRef = id("6");
  const destinationId = id("7");
  const actionId = id("8");
  const artifactId = id("9");
  const revisionId = id("10");
  const approvalId = id("11");
  const grantId = id("12");
  const actorId = id("13");
  const targetRef =
    "https://relayops.example/customer-onboarding/";
  const attempt = {
    id: attemptId,
    attempt_kind: "publish",
    source_publication_attempt_id: null,
    source_change_receipt_id: null,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    async_run_id: runId,
    destination_id: destinationId,
    destination_ref: destinationRef,
    destination_revision: 3,
    provider_kind: providerKind,
    target_ref: targetRef,
    action_id: actionId,
    artifact_id: artifactId,
    artifact_revision_id: revisionId,
    approved_artifact_revision: 2,
    approved_artifact_content_hash: ARTIFACT_HASH,
    content_checksum: CONTENT_CHECKSUM,
    publication_approval_event_id: approvalId,
    publication_approval_event_kind: "approved",
    source_approval_event_id: null,
    source_approval_event_kind: null,
    side_effect_class: "external_write",
    authorization_grant_id: grantId,
    authorization_purpose: "publish",
    authorization_snapshot: authorizationSnapshot({
      grantId,
      actorId,
      destinationRef,
    }),
    authorization_snapshot_hash: "snapshot-hash",
    preview_ref: "preview://approved",
    preview_checksum: ARTIFACT_HASH,
    remote_precondition: {
      kind: "must_not_exist",
      revision: null,
    },
    rollback_plan: {
      providerKind,
      strategy:
        providerKind === "github"
          ? "github_revert_pr"
          : "wordpress_restore_revision",
      priorRemoteRevision: "prior",
      expectedCurrentRemoteRevision: "current",
      facts:
        providerKind === "wordpress"
          ? { explicitPublish: true }
          : {},
    },
    idempotency_key: "publication-key",
    request_hash: "request-hash",
    requested_by: actorId,
    requested_at: "2026-07-27T07:59:00.000Z",
  } as unknown as PublicationAttemptRow;
  const run = {
    id: runId,
    workspace_id: workspaceId,
    project_id: projectId,
    kind: "publication",
    status: "running",
    active_key: `publication:${destinationRef}:${targetRef}`,
    contract_version: "publication.0.4.0",
    request_payload: {
      publicationAttemptId: attemptId,
      destinationRef,
    },
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: "publication_attempt",
    result_id: attemptId,
    attempt_count: 1,
    initiated_by: actorId,
    queued_at: "2026-07-27T07:59:00.000Z",
    started_at: "2026-07-27T08:00:00.000Z",
    completed_at: null,
  } satisfies AsyncRunRow;
  const destination = {
    id: destinationId,
    destination_ref: destinationRef,
    revision: 3,
    supersedes_id: null,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider_kind: providerKind,
    target_ref: targetRef,
    state: "ready",
    authorization_grant_id: id("99"),
    provider_scope:
      providerKind === "github"
        ? {
            providerKind: "github",
            installationId: 41,
            repositoryId: 99,
            repositoryOwner: "gengrowth",
            repositoryName: "relayops",
            baseBranch: "main",
            branchPrefix: "gengrowth/",
            contentPath: "content/customer-onboarding.md",
            grantedPermissions: [
              "metadata_read",
              "contents_read",
              "contents_write",
              "pull_requests_write",
            ],
          }
        : {
            providerKind: "wordpress",
            siteBaseUrl: "https://relayops.example",
            authenticatedUserId: 7,
            postType: "posts",
            authorAllowlist: [7],
            statusAllowlist: ["draft", "publish"],
            capabilities: ["edit_posts", "publish_posts"],
          },
    provider_scope_hash: "provider-scope-hash",
    authorization_snapshot: {},
    authorization_snapshot_hash: "destination-auth-hash",
    readiness_observation: {},
    limitation: null,
    created_by: actorId,
    created_at: "2026-07-27T07:00:00.000Z",
  } as PublicationDestinationRow;
  const grant = {
    id: grantId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider_kind: providerKind,
    purpose: "publish",
    state: "consumed",
    destination_ref: destinationRef,
    destination_revision: 3,
    target_ref: targetRef,
    requested_scope: destination.provider_scope,
    requested_scope_hash: "provider-scope-hash",
    authorization_snapshot: attempt.authorization_snapshot,
    authorization_snapshot_hash: "snapshot-hash",
    encrypted_payload: null,
    cipher_version: null,
    key_version: null,
    secret_metadata: {},
    expires_at: "2026-07-27T09:00:00.000Z",
    consumed_at: "2026-07-27T07:59:00.000Z",
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    created_by: actorId,
    created_at: "2026-07-27T07:55:00.000Z",
  } satisfies DeliveryAuthorizationGrantRow;
  const approval = {
    id: approvalId,
    workspace_id: workspaceId,
    project_id: projectId,
    artifact_id: artifactId,
    artifact_revision_id: revisionId,
    artifact_revision: 2,
    artifact_content_hash: ARTIFACT_HASH,
    event_kind: "approved",
  } as ArtifactApprovalEventRow;
  const artifact = {
    id: artifactId,
    workspace_id: workspaceId,
    project_id: projectId,
    action_id: actionId,
    status: "ready",
    current_revision: 2,
    validation_state: "valid",
    content_hash: ARTIFACT_HASH,
  } as ArtifactRow;
  const revision = {
    id: revisionId,
    workspace_id: workspaceId,
    project_id: projectId,
    artifact_id: artifactId,
    revision: 2,
    content_format: "markdown",
    content_text: CONTENT,
    content_json: null,
    content_hash: ARTIFACT_HASH,
  } as ArtifactRevisionRow;
  const action = {
    id: actionId,
    workspace_id: workspaceId,
    project_id: projectId,
    source_finding_id: id("14"),
    source_diagnostic_run_id: id("15"),
    status: "planned",
  } as ActionRow;
  const targets = [
    {
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: siteId,
      finding_id: action.source_finding_id,
      diagnostic_run_id: action.source_diagnostic_run_id,
      relation: "direct_url",
      target_kind: "url",
      target_ref: targetRef,
      resolution_state: "resolved",
    } as FindingTargetRow,
  ];
  return {
    payload: { runId, workspaceId, projectId },
    execution: {
      attempt,
      run,
      receipts: [],
    } satisfies PublicationAttemptExecutionRead,
    destination,
    grant,
    approval,
    artifact,
    revision,
    action,
    targets,
    now: NOW,
  };
}

function authorizationSnapshot(input: {
  grantId: string;
  actorId: string;
  destinationRef: string;
}) {
  return {
    authorizationId: input.grantId,
    actorId: input.actorId,
    grantedAt: "2026-07-27T07:55:00.000Z",
    expiresAt: "2026-07-27T09:00:00.000Z",
    scopes: ["publish"],
    destinationRef: input.destinationRef,
    destinationRevision: 3,
    purpose: "publish",
    customerAcknowledgement: {
      customerAcknowledgementId: id("16"),
      actorId: input.actorId,
      acknowledgedAt: "2026-07-27T07:55:00.000Z",
      acknowledgementScope:
        "exact_artifact_revision_for_publication",
    },
  };
}

describe("buildPublicationExecutionFacts", () => {
  it("builds a deterministic GitHub PR plan from exact frozen rows and verifies provider bytes checksum", () => {
    const result = buildPublicationExecutionFacts(baseInput("github"));

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "publication-execution.1",
        attempt: expect.objectContaining({
          contentChecksum: CONTENT_CHECKSUM,
          approvedArtifactContentHash: ARTIFACT_HASH,
          previewChecksum: ARTIFACT_HASH,
        }),
        plan: expect.objectContaining({
          providerKind: "github",
          branchName: `gengrowth/${id("4")}`,
          path: "content/customer-onboarding.md",
          content: CONTENT,
          remotePrecondition: { kind: "must_not_exist" },
        }),
      }),
    );
  });

  it("stages WordPress as draft and enables explicit publish only from the frozen plan plus granted scope", () => {
    const result = buildPublicationExecutionFacts(baseInput("wordpress"));

    expect(result).toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          providerKind: "wordpress",
          status: "draft",
          title: "Customer onboarding",
          slug: "customer-onboarding",
          explicitPublish: {
            expectedCanonicalUrl:
              "https://relayops.example/customer-onboarding/",
          },
        }),
      }),
    );
  });

  it("returns null when the consumed grant has been revoked or no longer exactly binds the attempt", () => {
    const input = baseInput("github");
    const result = buildPublicationExecutionFacts({
      ...input,
      grant: { ...input.grant, state: "revoked" },
    });

    expect(result).toBeNull();
  });

  it("accepts delayed execution when the grant was consumed no later than its frozen expiry", () => {
    const input = baseInput("github");
    const result = buildPublicationExecutionFacts({
      ...input,
      now: new Date("2026-07-27T12:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(result?.authorization).toEqual(
      expect.objectContaining({
        consumedAt: "2026-07-27T07:59:00.000Z",
        expiresAt: "2026-07-27T09:00:00.000Z",
      }),
    );
  });
});

describe("database publication authority", () => {
  it("uses one injected clock and repeatable-read locks to distinguish an archived project before provider facts", async () => {
    const input = baseInput("github");
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue({
      id: input.payload.projectId,
      workspace_id: input.payload.workspaceId,
      archived_at: "2026-07-27T08:01:00.000Z",
    } as never);
    const loadAttempt = vi.spyOn(
      PublicationsRepository.prototype,
      "loadAttemptForExecution",
    );
    const transaction = vi.fn(
      async <T>(
        callback: (tx: WorkerContext["db"]) => Promise<T>,
        _config?: { readonly isolationLevel?: string },
      ): Promise<T> => callback({} as WorkerContext["db"]),
    );
    const ctx = {
      db: { transaction },
    } as unknown as WorkerContext;
    const clock = vi.fn(
      () => new Date("2026-07-27T08:02:00.000Z"),
    );
    const authority = createDbPublicationAuthority(ctx, clock);

    const result = await authority.load(input.payload);

    expect(result).toEqual({
      schemaVersion: "publication-execution-unavailable.1",
      code: "PUBLICATION_PROJECT_ARCHIVED",
      limitation:
        "Project was archived after publication acceptance; no provider write was attempted.",
    });
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "repeatable read" },
    );
    expect(clock).toHaveBeenCalledTimes(1);
    expect(loadAttempt).not.toHaveBeenCalled();
  });

  it("terminalizes an archived accepted run as cancelled without writing a publication receipt", async () => {
    const input = baseInput("github");
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(input.execution.run);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const append = vi.spyOn(
      PublicationsRepository.prototype,
      "appendReceipt",
    );
    const authority = createDbPublicationAuthority(context());
    const limitation =
      "Project was archived after publication acceptance; no provider write was attempted.";

    await authority.recordUnavailable({
      payload: input.payload,
      execution: null,
      code: "PUBLICATION_PROJECT_ARCHIVED",
      limitation,
      predecessorDeliveryReceiptId: null,
      observedAt: "2026-07-27T08:02:00.000Z",
    });

    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: input.execution.run.id,
        attemptCount: input.execution.run.attempt_count,
      }),
      {
        status: "cancelled",
        lastErrorCode: "PUBLICATION_PROJECT_ARCHIVED",
        lastErrorSummary: limitation,
      },
    );
    expect(append).not.toHaveBeenCalled();
  });

  it("appends both artifact identity and provider bytes checksums before terminalizing the fenced run", async () => {
    const input = baseInput("github");
    const facts = buildPublicationExecutionFacts(input);
    if (!facts) throw new Error("expected valid execution facts");
    const receipt = githubReceipt(facts.attempt.id);
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      PublicationsRepository.prototype,
      "loadAttemptForExecution",
    ).mockResolvedValue(input.execution);
    const appended = {
      id: id("20"),
      receipt_kind: "delivery_receipt",
    } as PublicationReceiptRow;
    const append = vi
      .spyOn(PublicationsRepository.prototype, "appendReceipt")
      .mockResolvedValue(appended);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const authority = createDbPublicationAuthority(context());

    const result = await authority.recordDelivery({
      execution: facts,
      receipt,
      terminal: true,
    });

    expect(result).toEqual({ receiptId: id("20") });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationAttemptId: facts.attempt.id,
        artifactContentHash: ARTIFACT_HASH,
        contentChecksum: CONTENT_CHECKSUM,
        verificationState: "pending",
      }),
    );
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: input.execution.run.id,
        attemptCount: 1,
      }),
      expect.objectContaining({
        status: "completed",
        resultType: "publication_attempt",
        resultId: facts.attempt.id,
      }),
    );
  });

  it("replays an existing exact delivery receipt without appending a duplicate", async () => {
    const input = baseInput("github");
    const facts = buildPublicationExecutionFacts(input);
    if (!facts) throw new Error("expected valid execution facts");
    const receipt = githubReceipt(facts.attempt.id);
    const existing = {
      id: id("21"),
      workspace_id: facts.attempt.workspaceId,
      project_id: facts.attempt.projectId,
      site_id: facts.attempt.siteId,
      publication_attempt_id: facts.attempt.id,
      receipt_kind: receipt.receiptKind,
      predecessor_delivery_receipt_id:
        receipt.predecessorDeliveryReceiptId,
      provider_kind: receipt.providerKind,
      provider_request_id: "earlier-provider-request",
      remote_scope_ref: receipt.remoteScopeRef,
      remote_object_kind: receipt.remoteObjectKind,
      remote_object_id: receipt.remoteObjectId,
      remote_revision: receipt.remoteRevision,
      delivery_url: receipt.deliveryUrl,
      live_canonical_url: receipt.liveCanonicalUrl,
      artifact_content_hash: receipt.artifactContentHash,
      content_checksum: receipt.contentChecksum,
      verification_state: receipt.verificationState,
      remote_facts: receipt.remoteFacts,
      evidence_refs: receipt.evidenceRefs,
      limitation: null,
      observed_at: "2026-07-27T07:59:59.000Z",
      created_at: receipt.observedAt,
    } as unknown as PublicationReceiptRow;
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      PublicationsRepository.prototype,
      "loadAttemptForExecution",
    ).mockResolvedValue({
      ...input.execution,
      receipts: [existing],
    });
    const append = vi.spyOn(
      PublicationsRepository.prototype,
      "appendReceipt",
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    ).mockResolvedValue(true);
    const authority = createDbPublicationAuthority(context());

    const result = await authority.recordDelivery({
      execution: facts,
      receipt,
      terminal: true,
    });

    expect(result).toEqual({ receiptId: id("21") });
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects a receipt replay when immutable provider outcome metadata drifts", async () => {
    const input = baseInput("github");
    const facts = buildPublicationExecutionFacts(input);
    if (!facts) throw new Error("expected valid execution facts");
    const receipt = githubReceipt(facts.attempt.id);
    const existing = {
      id: id("22"),
      workspace_id: facts.attempt.workspaceId,
      project_id: facts.attempt.projectId,
      site_id: facts.attempt.siteId,
      publication_attempt_id: facts.attempt.id,
      receipt_kind: receipt.receiptKind,
      predecessor_delivery_receipt_id:
        receipt.predecessorDeliveryReceiptId,
      provider_kind: receipt.providerKind,
      provider_request_id: "different-provider-request",
      remote_scope_ref: receipt.remoteScopeRef,
      remote_object_kind: receipt.remoteObjectKind,
      remote_object_id: receipt.remoteObjectId,
      remote_revision: receipt.remoteRevision,
      delivery_url:
        "https://github.com/gengrowth/relayops/pull/999",
      live_canonical_url: receipt.liveCanonicalUrl,
      artifact_content_hash: receipt.artifactContentHash,
      content_checksum: receipt.contentChecksum,
      verification_state: receipt.verificationState,
      remote_facts: receipt.remoteFacts,
      evidence_refs: receipt.evidenceRefs,
      limitation: receipt.limitation,
      observed_at: "2026-07-27T08:05:00.000Z",
      created_at: receipt.observedAt,
    } as unknown as PublicationReceiptRow;
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(input.execution.run);
    vi.spyOn(
      PublicationsRepository.prototype,
      "loadAttemptForExecution",
    ).mockResolvedValue({
      ...input.execution,
      receipts: [existing],
    });
    const append = vi.spyOn(
      PublicationsRepository.prototype,
      "appendReceipt",
    );
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const authority = createDbPublicationAuthority(context());

    await expect(
      authority.recordDelivery({
        execution: facts,
        receipt,
        terminal: true,
      }),
    ).rejects.toThrow("publication receipt replay conflict");

    expect(append).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
  });
});

function githubReceipt(attemptId: string): PublicationReceiptWrite {
  return {
    receiptKind: "delivery_receipt",
    predecessorDeliveryReceiptId: null,
    providerKind: "github",
    providerRequestId: "request-1",
    remoteScopeRef: "github:repository:99:pull:17",
    remoteObjectKind: "github_pull_request",
    remoteObjectId: "17",
    remoteRevision: "head-sha",
    deliveryUrl:
      "https://github.com/gengrowth/relayops/pull/17",
    liveCanonicalUrl: null,
    artifactContentHash: ARTIFACT_HASH,
    contentChecksum: CONTENT_CHECKSUM,
    verificationState: "pending",
    remoteFacts: {
      attemptId,
      repositoryId: 99,
      pullRequestNumber: 17,
    },
    evidenceRefs: [],
    limitation: null,
    observedAt: "2026-07-27T08:00:05.000Z",
  };
}

function context(): WorkerContext {
  const db = {
    transaction: async <T>(
      callback: (tx: WorkerContext["db"]) => Promise<T>,
    ): Promise<T> => callback({} as WorkerContext["db"]),
  } as unknown as WorkerContext["db"];
  return {
    db,
  } as unknown as WorkerContext;
}
