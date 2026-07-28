import { describe, expect, it, vi } from "vitest";
import type {
  PublicationAttemptRow,
  PublicationAttemptTransactionResult,
  PublicationReceiptRow,
  ResolvedPublicationAttemptFacts,
} from "@sf/db";
import {
  ActionsRepository,
  ArtifactApprovalsRepository,
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionsRepository,
  ExecutionArtifactsRepository,
  FindingTargetsRepository,
  ProjectsRepository,
  PublicationIdempotencyConflictError,
  PublicationsRepository,
  sha256Hex,
} from "@sf/db";
import {
  DefaultPublicationAttemptAuthority,
  createPublicationAttemptService,
  publicationAttemptStatusUrl,
  reconcilePublicationAttempt,
  type PublicationAttemptAuthority,
  type PublicationAttemptServiceDependencies,
  type PublicationAttemptStore,
} from "./publication-attempts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  actorB: "00000000-0000-4000-8000-000000000011",
  destination: "00000000-0000-4000-8000-000000000004",
  destinationRow: "00000000-0000-4000-8000-000000000005",
  grant: "00000000-0000-4000-8000-000000000006",
  approval: "00000000-0000-4000-8000-000000000007",
  action: "00000000-0000-4000-8000-000000000008",
  artifact: "00000000-0000-4000-8000-000000000009",
  artifactRevision: "00000000-0000-4000-8000-00000000000a",
  attempt: "00000000-0000-4000-8000-00000000000b",
  run: "00000000-0000-4000-8000-00000000000c",
  sourceAttempt: "00000000-0000-4000-8000-00000000000d",
  sourceChangeReceipt: "00000000-0000-4000-8000-00000000000e",
  deliveryReceipt: "00000000-0000-4000-8000-00000000000f",
  previewEvent: "00000000-0000-4000-8000-000000000012",
  rollbackPreviewEvent:
    "00000000-0000-4000-8000-000000000013",
} as const;

const checksum = "a".repeat(64);
const providerChecksum = "f".repeat(64);
const requestHash = "b".repeat(64);
const scope = { workspaceId: ids.workspace };
const requestedAt = "2026-07-27T10:00:00.000Z";

function runRow(status = "queued") {
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    kind: "publication",
    status,
    active_key: `publication:${ids.destination}:/blog/customer-onboarding/`,
    contract_version: "2026-07-27",
    request_payload: { publicationAttemptId: ids.attempt },
    progress: {
      phase: status,
      current: status === "completed" ? 1 : 0,
      total: 1,
      messageKey: `run.${status}`,
    },
    last_error_code: status === "failed" ? "PROVIDER_UNAVAILABLE" : null,
    last_error_summary: status === "failed" ? "发布平台暂时不可用。" : null,
    result_type: "publication_attempt",
    result_id: ids.attempt,
    attempt_count: status === "queued" ? 0 : 1,
    initiated_by: ids.actor,
    queued_at: requestedAt,
    started_at: status === "queued" ? null : requestedAt,
    completed_at:
      status === "completed" || status === "failed"
        ? "2026-07-27T10:02:00.000Z"
        : null,
  } as const;
}

function attemptRow(
  overrides: Partial<PublicationAttemptRow> = {},
): PublicationAttemptRow {
  return {
    id: ids.attempt,
    attempt_kind: "publish",
    source_publication_attempt_id: null,
    source_change_receipt_id: null,
    preview_event_id: ids.previewEvent,
    preview_event_kind: "issued",
    preview_facts_hash: "d".repeat(64),
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: "00000000-0000-4000-8000-000000000010",
    async_run_id: ids.run,
    destination_id: ids.destinationRow,
    destination_ref: ids.destination,
    destination_revision: 3,
    provider_kind: "github",
    target_ref: "/blog/customer-onboarding/",
    action_id: ids.action,
    artifact_id: ids.artifact,
    artifact_revision_id: ids.artifactRevision,
    approved_artifact_revision: 4,
    approved_artifact_content_hash: checksum,
    content_checksum: providerChecksum,
    publication_approval_event_id: ids.approval,
    publication_approval_event_kind: "approved",
    source_approval_event_id: null,
    source_approval_event_kind: null,
    side_effect_class: "external_write",
    authorization_grant_id: ids.grant,
    authorization_purpose: "publish",
    authorization_snapshot: {
      authorizationId: ids.grant,
      actorId: ids.actor,
      token: "must-never-leave-the-server",
    },
    authorization_snapshot_hash: "c".repeat(64),
    preview_ref: "preview://artifact/revision/4",
    preview_checksum: checksum,
    remote_precondition: { kind: "must_match", revision: "base-sha" },
    rollback_plan: {
      providerKind: "github",
      strategy: "github_revert_pr",
      priorRemoteRevision: "base-sha",
      expectedCurrentRemoteRevision: "merge-sha",
      facts: { secretProviderFact: "redact-me" },
    },
    idempotency_key: "publish-key",
    request_hash: requestHash,
    requested_by: ids.actor,
    requested_at: requestedAt,
    ...overrides,
  };
}

function receiptRow(
  overrides: Partial<PublicationReceiptRow> = {},
): PublicationReceiptRow {
  return {
    id: ids.deliveryReceipt,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: "00000000-0000-4000-8000-000000000010",
    publication_attempt_id: ids.attempt,
    receipt_kind: "delivery_receipt",
    predecessor_delivery_receipt_id: null,
    provider_kind: "github",
    provider_request_id: "provider-request-secret",
    remote_scope_ref: "github:repository:123:pull-request:44",
    remote_object_kind: "github_pull_request",
    remote_object_id: "44",
    remote_revision: "head-sha",
    delivery_url: "https://github.com/gengrowth/site/pull/44",
    live_canonical_url: null,
    artifact_content_hash: checksum,
    content_checksum: providerChecksum,
    verification_state: "provider_accepted",
    remote_facts: { installationToken: "must-not-leak" },
    evidence_refs: ["s3://private/evidence"],
    limitation: null,
    observed_at: "2026-07-27T10:01:00.000Z",
    created_at: "2026-07-27T10:01:01.000Z",
    ...overrides,
  };
}

function transactionResult(
  overrides: Partial<PublicationAttemptTransactionResult> = {},
): PublicationAttemptTransactionResult {
  return {
    attempt: attemptRow(),
    run: runRow(),
    receipts: [],
    replayed: false,
    ...overrides,
  };
}

function fakeDependencies(overrides: {
  store?: Partial<PublicationAttemptStore>;
  authority?: Partial<PublicationAttemptAuthority>;
  now?: () => Date;
} = {}) {
  const store: PublicationAttemptStore = {
    replayByPermanentKey: vi.fn(async () => null),
    createAttemptAtomically: vi.fn(async (command) => {
      await command.resolveCurrentFacts({ transaction: true } as never);
      return transactionResult();
    }),
    ...overrides.store,
  };
  const authority: PublicationAttemptAuthority = {
    loadPublishTarget: vi.fn(async () => ({
      destinationRef: ids.destination,
      targetRef: "/blog/customer-onboarding/",
    })),
    resolvePublishFacts: vi.fn(
      async (): Promise<ResolvedPublicationAttemptFacts> => ({
      attemptKind: "publish",
      sourcePublicationAttemptId: null,
      siteId: "00000000-0000-4000-8000-000000000010",
      destination: {
        id: ids.destinationRow,
        destination_ref: ids.destination,
        revision: 3,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "00000000-0000-4000-8000-000000000010",
        provider_kind: "github",
        target_ref: "/blog/customer-onboarding/",
        state: "ready",
      },
      actionId: ids.action,
      artifactId: ids.artifact,
      artifactRevisionId: ids.artifactRevision,
      approvedArtifactRevision: 4,
      approvedArtifactContentHash: checksum,
      contentChecksum: providerChecksum,
      publicationApprovalEventId: ids.approval,
      sourceApprovalEventId: null,
      authorizationGrant: {
        id: ids.grant,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "00000000-0000-4000-8000-000000000010",
        provider_kind: "github",
        purpose: "publish",
        state: "ready",
        destination_ref: ids.destination,
        destination_revision: 3,
        target_ref: "/blog/customer-onboarding/",
        authorization_snapshot: {},
        authorization_snapshot_hash: "c".repeat(64),
        expires_at: "2026-07-27T10:10:00.000Z",
      },
      authorizationPurpose: "publish",
      previewEventId: ids.previewEvent,
      previewEventKind: "issued",
      previewFactsHash: "d".repeat(64),
      previewRef: "preview://artifact/revision/4",
      previewChecksum: checksum,
      remotePrecondition: { kind: "must_match", revision: "base-sha" },
      rollbackPlan: {
        providerKind: "github",
        strategy: "github_revert_pr",
        priorRemoteRevision: "base-sha",
        expectedCurrentRemoteRevision: "merge-sha",
        facts: {},
      },
      }),
    ),
    loadRollbackTarget: vi.fn(async () => ({
      destinationRef: ids.destination,
      targetRef: "/blog/customer-onboarding/",
    })),
    resolveRollbackFacts: vi.fn(
      async (): Promise<ResolvedPublicationAttemptFacts> => ({
      attemptKind: "rollback",
      sourcePublicationAttemptId: ids.sourceAttempt,
      siteId: "00000000-0000-4000-8000-000000000010",
      destination: {
        id: ids.destinationRow,
        destination_ref: ids.destination,
        revision: 3,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "00000000-0000-4000-8000-000000000010",
        provider_kind: "github",
        target_ref: "/blog/customer-onboarding/",
        state: "ready",
      },
      actionId: ids.action,
      artifactId: ids.artifact,
      artifactRevisionId: ids.artifactRevision,
      approvedArtifactRevision: 4,
      approvedArtifactContentHash: checksum,
      contentChecksum: providerChecksum,
      publicationApprovalEventId: null,
      sourceApprovalEventId: ids.approval,
      authorizationGrant: {
        id: ids.grant,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "00000000-0000-4000-8000-000000000010",
        provider_kind: "github",
        purpose: "rollback",
        state: "ready",
        destination_ref: ids.destination,
        destination_revision: 3,
        target_ref: "/blog/customer-onboarding/",
        authorization_snapshot: {},
        authorization_snapshot_hash: "c".repeat(64),
        expires_at: "2026-07-27T10:10:00.000Z",
      },
      authorizationPurpose: "rollback",
      previewEventId: ids.rollbackPreviewEvent,
      previewEventKind: "issued",
      previewFactsHash: "e".repeat(64),
      previewRef: "preview://rollback/source-attempt",
      previewChecksum: checksum,
      remotePrecondition: { kind: "must_match", revision: "merge-sha" },
      rollbackPlan: {
        providerKind: "github",
        strategy: "github_revert_pr",
        priorRemoteRevision: "base-sha",
        expectedCurrentRemoteRevision: "merge-sha",
        facts: { reason: "客户要求撤销" },
      },
      }),
    ),
    readAttempt: vi.fn(async () => ({
      attempt: attemptRow(),
      run: runRow("completed"),
      receipts: [receiptRow()],
      latestDestinationState: "ready",
    })),
    ...overrides.authority,
  };
  const enqueue = vi.fn();
  const dependencies: PublicationAttemptServiceDependencies = {
    db: { name: "fake-db" } as never,
    now:
      overrides.now ??
      (() => new Date("2026-07-27T10:00:00.000Z")),
    contractVersion: "2026-07-27",
    createStore: vi.fn(() => store),
    authority,
    enqueue,
  };
  return { dependencies, store, authority, enqueue };
}

const publishBody = {
  destinationRef: ids.destination,
  expectedDestinationRevision: 3,
  authorizationGrantRef: ids.grant,
  approvalEventId: ids.approval,
  previewRef: "preview://artifact/revision/4",
  rollbackPlanRef: "rollback-plan://artifact/revision/4",
  remotePrecondition: { kind: "must_match" as const, revision: "base-sha" },
  idempotencyKey: "publish-key",
};

const rollbackBody = {
  authorizationGrantRef: ids.grant,
  sourceChangeReceiptId: ids.sourceChangeReceipt,
  previewRef: "preview://rollback/source-attempt",
  expectedCurrentRemoteRevision: "merge-sha",
  customerAcknowledgementInput: {
    acknowledged: true as const,
    acknowledgementScope: "rollback_preview" as const,
  },
  reason: "客户确认撤销本次发布",
  idempotencyKey: "rollback-key",
};

describe("publication attempt command service", () => {
  it("fails closed without creating a run when reconciliation has no registered worker terminal path", async () => {
    await expect(
      reconcilePublicationAttempt(
        scope,
        ids.project,
        ids.attempt,
        ids.actor,
        "reconcile-key",
        {},
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });

  it("freezes publish facts in the repository transaction and returns canonical polling metadata", async () => {
    const frozenNow = new Date("2026-07-27T10:00:00.000Z");
    const now = vi.fn(() => frozenNow);
    const fixture = fakeDependencies({ now });
    const service = createPublicationAttemptService(fixture.dependencies);

    await expect(
      service.createPublish(
        scope,
        ids.project,
        ids.actor,
        "publish-key",
        publishBody,
      ),
    ).resolves.toEqual({
      publicationAttemptId: ids.attempt,
      asyncRunId: ids.run,
      state: "pending",
      replayed: false,
      location: publicationAttemptStatusUrl(ids.project, ids.run),
    });

    expect(fixture.authority.resolvePublishFacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: ids.workspace,
        projectId: ids.project,
        actorId: ids.actor,
        now: frozenNow,
        request: publishBody,
      }),
    );
    expect(fixture.store.createAttemptAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ids.workspace,
        projectId: ids.project,
        destinationRef: ids.destination,
        targetRef: "/blog/customer-onboarding/",
        idempotencyKey: "publish-key",
        requestedBy: ids.actor,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        idempotencyExpiresAt: "2026-07-28T10:00:00.000Z",
      }),
    );
    expect(
      (
        fixture.store.createAttemptAtomically as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[0],
    ).not.toHaveProperty("sourceChangeReceiptId");
    expect(
      (
        fixture.store.createAttemptAtomically as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[0].requestHash,
    ).not.toBe(checksum);
    expect(now).toHaveBeenCalledTimes(1);
    const repositoryClock = (
      fixture.dependencies.createStore as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[2] as (() => Date) | undefined;
    expect(repositoryClock?.()).toBe(frozenNow);
    // Queue dispatch is owned by the repository's transaction callback. The
    // command service never dispatches before current facts are resolved.
    expect(fixture.enqueue).not.toHaveBeenCalled();
  });

  it("returns permanent same-key replay before reading mutable destination or approval facts", async () => {
    const replay = transactionResult({ replayed: true });
    const fixture = fakeDependencies({
      store: {
        replayByPermanentKey: vi.fn(async () => ({
          ...replay,
          replayed: true as const,
        })),
      },
    });
    const service = createPublicationAttemptService(fixture.dependencies);

    const result = await service.createPublish(
      scope,
      ids.project,
      ids.actor,
      "publish-key",
      publishBody,
    );

    expect(result.replayed).toBe(true);
    expect(fixture.authority.loadPublishTarget).not.toHaveBeenCalled();
    expect(fixture.authority.resolvePublishFacts).not.toHaveBeenCalled();
    expect(fixture.store.createAttemptAtomically).not.toHaveBeenCalled();
  });

  it("rejects a body idempotency key that differs from the request header before any read", async () => {
    const now = vi.fn(() => new Date(requestedAt));
    const fixture = fakeDependencies({ now });
    const service = createPublicationAttemptService(fixture.dependencies);

    await expect(
      service.createPublish(
        scope,
        ids.project,
        ids.actor,
        "different-header-key",
        publishBody,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(now).not.toHaveBeenCalled();
    expect(fixture.store.replayByPermanentKey).not.toHaveBeenCalled();
    expect(fixture.authority.loadPublishTarget).not.toHaveBeenCalled();
  });

  it("rejects a second publish actor reusing the first actor's idempotency key", async () => {
    let firstRequestHash: string | null = null;
    const fixture = fakeDependencies({
      store: {
        replayByPermanentKey: vi.fn(
          async (_scope, _key, candidateRequestHash) => {
            if (
              firstRequestHash !== null &&
              candidateRequestHash !== firstRequestHash
            ) {
              throw new PublicationIdempotencyConflictError(
                "cross-actor replay",
              );
            }
            return null;
          },
        ),
        createAttemptAtomically: vi.fn(async (command) => {
          firstRequestHash = command.requestHash;
          await command.resolveCurrentFacts({} as never);
          return transactionResult();
        }),
      },
    });
    const service = createPublicationAttemptService(fixture.dependencies);

    await service.createPublish(
      scope,
      ids.project,
      ids.actor,
      "publish-key",
      publishBody,
    );
    await expect(
      service.createPublish(
        scope,
        ids.project,
        ids.actorB,
        "publish-key",
        publishBody,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    expect(fixture.authority.loadPublishTarget).toHaveBeenCalledTimes(1);
    expect(fixture.authority.resolvePublishFacts).toHaveBeenCalledTimes(1);
  });

  it("binds rollback to the source attempt path and exact verified Change Receipt", async () => {
    const fixture = fakeDependencies({
      store: {
        createAttemptAtomically: vi.fn(async (command) => {
          expect(command.sourceChangeReceiptId).toBe(
            ids.sourceChangeReceipt,
          );
          const facts = await command.resolveCurrentFacts({} as never);
          expect(facts).toMatchObject({
            attemptKind: "rollback",
            sourcePublicationAttemptId: ids.sourceAttempt,
            sourceApprovalEventId: ids.approval,
            previewChecksum: checksum,
            remotePrecondition: {
              kind: "must_match",
              revision: "merge-sha",
            },
          });
          return transactionResult({
            attempt: attemptRow({
              attempt_kind: "rollback",
              source_publication_attempt_id: ids.sourceAttempt,
              source_change_receipt_id: ids.sourceChangeReceipt,
              publication_approval_event_id: null,
              publication_approval_event_kind: null,
              source_approval_event_id: ids.approval,
              source_approval_event_kind: "approved",
              authorization_purpose: "rollback",
            }),
          });
        }),
      },
    });
    const service = createPublicationAttemptService(fixture.dependencies);

    await service.createRollback(
      scope,
      ids.project,
      ids.sourceAttempt,
      ids.actor,
      "rollback-key",
      rollbackBody,
    );

    expect(fixture.authority.resolveRollbackFacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourcePublicationAttemptId: ids.sourceAttempt,
        request: rollbackBody,
      }),
    );
  });

  it("rejects a second rollback actor reusing the first actor's idempotency key", async () => {
    let firstRequestHash: string | null = null;
    const fixture = fakeDependencies({
      store: {
        replayByPermanentKey: vi.fn(
          async (_scope, _key, candidateRequestHash) => {
            if (
              firstRequestHash !== null &&
              candidateRequestHash !== firstRequestHash
            ) {
              throw new PublicationIdempotencyConflictError(
                "cross-actor replay",
              );
            }
            return null;
          },
        ),
        createAttemptAtomically: vi.fn(async (command) => {
          firstRequestHash = command.requestHash;
          await command.resolveCurrentFacts({} as never);
          return transactionResult();
        }),
      },
    });
    const service = createPublicationAttemptService(fixture.dependencies);

    await service.createRollback(
      scope,
      ids.project,
      ids.sourceAttempt,
      ids.actor,
      "rollback-key",
      rollbackBody,
    );
    await expect(
      service.createRollback(
        scope,
        ids.project,
        ids.sourceAttempt,
        ids.actorB,
        "rollback-key",
        rollbackBody,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    expect(fixture.authority.loadRollbackTarget).toHaveBeenCalledTimes(1);
    expect(fixture.authority.resolveRollbackFacts).toHaveBeenCalledTimes(1);
  });
});

describe("customer publication timeline", () => {
  it("loads immutable customer history through the archive-readable canonical repository path", async () => {
    const history = vi
      .spyOn(PublicationsRepository.prototype, "loadAttemptHistory")
      .mockResolvedValue({
        attempt: attemptRow(),
        run: runRow("completed"),
        receipts: [receiptRow()],
      });
    const executionOnly = vi.spyOn(
      PublicationsRepository.prototype,
      "loadAttemptForExecution",
    );
    const destination = vi
      .spyOn(DeliveryConnectionsRepository.prototype, "findLatest")
      .mockResolvedValue({
        id: ids.destinationRow,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "00000000-0000-4000-8000-000000000010",
        destination_ref: ids.destination,
        revision: 3,
        supersedes_id: null,
        provider_kind: "github",
        target_ref: "/blog/customer-onboarding/",
        state: "ready",
        authorization_grant_id: ids.grant,
        provider_scope: {},
        provider_scope_hash: "d".repeat(64),
        authorization_snapshot: {},
        authorization_snapshot_hash: "e".repeat(64),
        readiness_observation: {},
        limitation: null,
        created_by: ids.actor,
        created_at: requestedAt,
      });
    const authority = new DefaultPublicationAttemptAuthority();

    try {
      await expect(
        authority.readAttempt({} as never, {
          workspaceId: ids.workspace,
          projectId: ids.project,
          publicationAttemptId: ids.attempt,
        }),
      ).resolves.toMatchObject({
        attempt: { id: ids.attempt },
        run: { id: ids.run },
        latestDestinationState: "ready",
      });
      expect(history).toHaveBeenCalledWith(
        { workspaceId: ids.workspace, projectId: ids.project },
        ids.attempt,
      );
      expect(executionOnly).not.toHaveBeenCalled();
    } finally {
      history.mockRestore();
      executionOnly.mockRestore();
      destination.mockRestore();
    }
  });

  it("derives honest pending state from async truth and redacts internal authorization/provider facts", async () => {
    const fixture = fakeDependencies();
    const service = createPublicationAttemptService(fixture.dependencies);

    const result = await service.getAttempt(
      scope,
      ids.project,
      ids.attempt,
    );
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      id: ids.attempt,
      attemptKind: "publish",
      state: "pending",
      providerKind: "github",
      run: { id: ids.run, status: "completed" },
      artifact: { contentHash: checksum },
      preview: {
        artifactContentHash: checksum,
        contentChecksum: providerChecksum,
      },
      timeline: [
        {
          kind: "attempt_requested",
          artifactContentHash: checksum,
          contentChecksum: providerChecksum,
          occurredAt: requestedAt,
        },
        {
          kind: "delivery_receipt",
          verificationState: "provider_accepted",
          artifactContentHash: checksum,
          contentChecksum: providerChecksum,
          deliveryUrl: "https://github.com/gengrowth/site/pull/44",
        },
      ],
    });
    expect(serialized).not.toContain("must-never-leave-the-server");
    expect(serialized).not.toContain("provider-request-secret");
    expect(serialized).not.toContain("installationToken");
    expect(serialized).not.toContain("s3://private/evidence");
    expect(serialized).not.toContain("publish-key");
    expect(serialized).not.toContain(requestHash);
  });

  it("reports changed only from a verified Change Receipt and unavailable from honest failure facts", async () => {
    const change = receiptRow({
      id: ids.sourceChangeReceipt,
      receipt_kind: "change_receipt",
      predecessor_delivery_receipt_id: ids.deliveryReceipt,
      remote_object_kind: "github_merge",
      remote_revision: "merge-sha",
      live_canonical_url:
        "https://example.com/blog/customer-onboarding/",
      verification_state: "verified_live",
      observed_at: "2026-07-27T10:03:00.000Z",
    });
    const changedFixture = fakeDependencies({
      authority: {
        readAttempt: vi.fn(async () => ({
          attempt: attemptRow(),
          run: runRow("completed"),
          receipts: [receiptRow(), change],
          latestDestinationState: "ready",
        })),
      },
    });
    const changed = await createPublicationAttemptService(
      changedFixture.dependencies,
    ).getAttempt(scope, ids.project, ids.attempt);
    expect(changed.state).toBe("changed");

    const unavailableFixture = fakeDependencies({
      authority: {
        readAttempt: vi.fn(async () => ({
          attempt: attemptRow(),
          run: runRow("failed"),
          receipts: [],
          latestDestinationState: "ready",
        })),
      },
    });
    const unavailable = await createPublicationAttemptService(
      unavailableFixture.dependencies,
    ).getAttempt(scope, ids.project, ids.attempt);
    expect(unavailable.state).toBe("unavailable");
  });

  it("fails closed when a receipt swaps Artifact identity and provider bytes checksums", async () => {
    const fixture = fakeDependencies({
      authority: {
        readAttempt: vi.fn(async () => ({
          attempt: attemptRow(),
          run: runRow("completed"),
          receipts: [
            receiptRow({
              artifact_content_hash: providerChecksum,
              content_checksum: checksum,
            }),
          ],
          latestDestinationState: "ready",
        })),
      },
    });

    await expect(
      createPublicationAttemptService(fixture.dependencies).getAttempt(
        scope,
        ids.project,
        ids.attempt,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});

describe("issued publication preview authority", () => {
  it("locks the current issued preview and derives attempt facts without reading destination observations", async () => {
    const exactProviderContent = "# Customer onboarding";
    const exactProviderChecksum = sha256Hex(exactProviderContent);
    const siteId = "00000000-0000-4000-8000-000000000010";
    const diagnosticRunId =
      "00000000-0000-4000-8000-000000000014";
    const findingId =
      "00000000-0000-4000-8000-000000000015";
    const acknowledgementId =
      "00000000-0000-4000-8000-000000000016";
    const expiresAt = "2026-07-27T10:10:00.000Z";
    const authorizationSnapshot = {
      authorizationId: ids.grant,
      actorId: ids.actor,
      grantedAt: "2026-07-27T09:59:00.000Z",
      expiresAt,
      scopes: ["contents_write"],
      destinationRef: ids.destination,
      destinationRevision: 3,
      purpose: "publish",
      customerAcknowledgement: {
        customerAcknowledgementId: acknowledgementId,
        actorId: ids.actor,
        acknowledgedAt: "2026-07-27T09:58:00.000Z",
        acknowledgementScope:
          "exact_artifact_revision_for_publication",
      },
    };
    const readinessObservation = new Proxy(
      {},
      {
        get() {
          throw new Error("readiness_observation must not be authority");
        },
      },
    );
    const destination = {
      id: ids.destinationRow,
      destination_ref: ids.destination,
      revision: 3,
      supersedes_id: null,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: siteId,
      provider_kind: "github" as const,
      target_ref: "/blog/customer-onboarding/",
      state: "ready" as const,
      authorization_grant_id: ids.grant,
      provider_scope: {},
      provider_scope_hash: "d".repeat(64),
      authorization_snapshot: {},
      authorization_snapshot_hash: "e".repeat(64),
      readiness_observation: readinessObservation,
      limitation: null,
      created_by: ids.actor,
      created_at: requestedAt,
    };
    const approval = {
      id: ids.approval,
      workspace_id: ids.workspace,
      project_id: ids.project,
      artifact_id: ids.artifact,
      artifact_revision_id: ids.artifactRevision,
      artifact_revision: 4,
      artifact_content_hash: checksum,
      event_kind: "approved",
      supersedes_approval_event_id: null,
      supersedes_approval_event_kind: null,
      event_actor_id: ids.actor,
      reviewer_actor_id: ids.actor,
      qa_gate_version: "qa.v1",
      qa_gate_snapshot: {},
      qa_gate_snapshot_hash: "1".repeat(64),
      customer_acknowledgement:
        authorizationSnapshot.customerAcknowledgement,
      customer_acknowledgement_hash: "2".repeat(64),
      reason: null,
      created_at: "2026-07-27T09:58:00.000Z",
    };
    const artifact = {
      id: ids.artifact,
      workspace_id: ids.workspace,
      project_id: ids.project,
      action_id: ids.action,
      status: "ready",
      validation_state: "valid",
      current_revision: 4,
      content_hash: checksum,
    };
    const revision = {
      id: ids.artifactRevision,
      workspace_id: ids.workspace,
      project_id: ids.project,
      artifact_id: ids.artifact,
      revision: 4,
      content_text: exactProviderContent,
      content_hash: checksum,
    };
    const action = {
      id: ids.action,
      status: "approved",
      source_diagnostic_run_id: diagnosticRunId,
      source_finding_id: findingId,
    };
    const grant = {
      id: ids.grant,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: siteId,
      provider_kind: "github",
      purpose: "publish",
      state: "ready",
      destination_ref: ids.destination,
      destination_revision: 3,
      target_ref: "/blog/customer-onboarding/",
      authorization_snapshot: authorizationSnapshot,
      authorization_snapshot_hash: "3".repeat(64),
      expires_at: expiresAt,
    };
    const preview = {
      id: ids.previewEvent,
      preview_ref: publishBody.previewRef,
      event_kind: "issued",
      preview_kind: "publish",
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: siteId,
      destination_id: ids.destinationRow,
      destination_ref: ids.destination,
      destination_revision: 3,
      provider_kind: "github",
      target_ref: "/blog/customer-onboarding/",
      action_id: ids.action,
      artifact_id: ids.artifact,
      artifact_revision_id: ids.artifactRevision,
      artifact_revision: 4,
      artifact_content_hash: checksum,
      artifact_approval_event_id: ids.approval,
      artifact_approval_event_kind: "approved",
      source_publication_attempt_id: null,
      source_change_receipt_id: null,
      provider_plan: { providerKind: "github" },
      remote_precondition: publishBody.remotePrecondition,
      rollback_plan: {
        providerKind: "github",
        strategy: "github_revert_pr",
        priorRemoteRevision: "base-sha",
        expectedCurrentRemoteRevision: "merge-sha",
        facts: {},
      },
      preview_checksum: checksum,
      content_checksum: exactProviderChecksum,
      facts_hash: "4".repeat(64),
    };

    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue({
      id: ids.project,
      workspace_id: ids.workspace,
      archived_at: null,
    } as never);
    vi.spyOn(
      DeliveryConnectionsRepository.prototype,
      "findLatest",
    ).mockResolvedValue(destination as never);
    vi.spyOn(
      ArtifactApprovalsRepository.prototype,
      "findCurrentApproval",
    ).mockResolvedValue(approval as never);
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue(artifact as never);
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(revision as never);
    vi.spyOn(
      ActionsRepository.prototype,
      "findById",
    ).mockResolvedValue(action as never);
    vi.spyOn(
      FindingTargetsRepository.prototype,
      "listForFindings",
    ).mockResolvedValue([
      {
        relation: "direct_url",
        target_kind: "url",
        resolution_state: "resolved",
        site_id: siteId,
        target_ref: "/blog/customer-onboarding/",
      },
    ] as never);
    vi.spyOn(
      DeliveryAuthorizationGrantsRepository.prototype,
      "findForUpdate",
    ).mockResolvedValue(grant as never);
    const currentPreview = vi
      .spyOn(
        PublicationsRepository.prototype,
        "findCurrentIssuedPreview",
      )
      .mockResolvedValue(preview as never);

    try {
      await expect(
        new DefaultPublicationAttemptAuthority().resolvePublishFacts(
          {} as never,
          {
            workspaceId: ids.workspace,
            projectId: ids.project,
            actorId: ids.actor,
            now: new Date("2026-07-27T10:00:00.000Z"),
            request: publishBody,
          },
        ),
      ).resolves.toMatchObject({
        previewEventId: ids.previewEvent,
        previewEventKind: "issued",
        previewFactsHash: "4".repeat(64),
        previewRef: publishBody.previewRef,
        previewChecksum: checksum,
        contentChecksum: exactProviderChecksum,
        remotePrecondition: publishBody.remotePrecondition,
      });
      expect(currentPreview).toHaveBeenCalledWith(
        { workspaceId: ids.workspace, projectId: ids.project },
        { previewRef: publishBody.previewRef },
        { lock: true },
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
