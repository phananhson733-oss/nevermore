import { describe, expect, it } from "vitest";
import {
  CreatePublicationAttemptRequest,
  CreatePublicationRollbackAttemptRequest,
  PublicationAttempt,
  PublicationAttemptAccepted,
  PublicationChangeReceipt,
  PublicationDeliveryReceipt,
  PublicationReceipt,
  PublicationRemotePrecondition,
  PublicationRollbackPlan,
  PublicationState,
  ReconcilePublicationAttemptRequest,
} from "./publication.ts";

const ids = {
  acknowledgement: "00000000-0000-4000-8000-000000000201",
  action: "00000000-0000-4000-8000-000000000202",
  actor: "00000000-0000-4000-8000-000000000203",
  approval: "00000000-0000-4000-8000-000000000204",
  artifact: "00000000-0000-4000-8000-000000000205",
  asyncRun: "00000000-0000-4000-8000-000000000206",
  authorization: "00000000-0000-4000-8000-000000000207",
  destination: "00000000-0000-4000-8000-000000000208",
  receipt: "00000000-0000-4000-8000-000000000209",
  revision: "00000000-0000-4000-8000-000000000210",
  rollbackGrant: "00000000-0000-4000-8000-000000000211",
  sourceAttempt: "00000000-0000-4000-8000-000000000212",
  attempt: "00000000-0000-4000-8000-000000000213",
  site: "00000000-0000-4000-8000-000000000214",
};
const checksum = "a".repeat(64);
const qaChecksum = "b".repeat(64);
const requestHash = "c".repeat(64);

const approvalSnapshot = {
  approvalEventId: ids.approval,
  approvalState: "approved" as const,
  artifactId: ids.artifact,
  artifactRevisionId: ids.revision,
  approvedArtifactRevision: 3,
  approvedArtifactContentHash: checksum,
  reviewerActorId: ids.actor,
  qaGateVersion: "content-shadow.qa.v4",
  qaGateSnapshot: { verdict: "passed" },
  qaGateSnapshotHash: qaChecksum,
  customerAcknowledgement: {
    customerAcknowledgementId: ids.acknowledgement,
    actorId: ids.actor,
    acknowledgedAt: "2026-07-27T09:00:00Z",
    acknowledgementScope: "exact_artifact_revision_for_publication" as const,
  },
  approvedAt: "2026-07-27T09:00:01Z",
};

const publishAuthorization = {
  authorizationId: ids.authorization,
  actorId: ids.actor,
  grantedAt: "2026-07-27T09:01:00Z",
  expiresAt: null,
  scopes: ["contents_read", "contents_write"],
  destinationRef: ids.destination,
  destinationRevision: 1,
  purpose: "publish" as const,
  customerAcknowledgement: approvalSnapshot.customerAcknowledgement,
};

const rollbackAuthorization = {
  ...publishAuthorization,
  authorizationId: ids.rollbackGrant,
  purpose: "rollback" as const,
  customerAcknowledgement: {
    customerAcknowledgementId: "00000000-0000-4000-8000-000000000215",
    actorId: ids.actor,
    acknowledgedAt: "2026-07-27T10:00:00Z",
    acknowledgementScope: "rollback_preview" as const,
  },
};

const rollbackPlan = {
  providerKind: "github" as const,
  strategy: "github_revert_pr" as const,
  priorRemoteRevision: "base-sha",
  expectedCurrentRemoteRevision: "merged-sha",
  facts: { path: "content/blog/customer-onboarding.md" },
};

describe("publication and rollback client requests", () => {
  it("uses the closed customer state set without delivered", () => {
    for (const state of ["pending", "changed", "unavailable", "revoked"]) {
      expect(PublicationState.parse(state)).toBe(state);
    }
    expect(PublicationState.safeParse("delivered").success).toBe(false);
    expect(PublicationState.safeParse("failed").success).toBe(false);
  });

  it("accepts a publish request that references approvalEventId only", () => {
    const request = {
      destinationRef: ids.destination,
      expectedDestinationRevision: 1,
      authorizationGrantRef: ids.authorization,
      approvalEventId: ids.approval,
      previewRef: "preview://artifact/revision/3",
      rollbackPlanRef: "rollback-plan://artifact/revision/3",
      remotePrecondition: {
        kind: "must_match",
        revision: "base-sha",
      },
      idempotencyKey: "publication-attempt-1",
    };

    expect(CreatePublicationAttemptRequest.parse(request)).toEqual(request);
    expect(
      CreatePublicationAttemptRequest.safeParse({
        destinationRef: ids.destination,
        expectedDestinationRevision: 1,
        approvalEventId: ids.approval,
        previewRef: "preview://artifact/revision/3",
        rollbackPlanRef: "rollback-plan://artifact/revision/3",
        remotePrecondition: {
          kind: "must_match",
          revision: "base-sha",
        },
        idempotencyKey: "publication-attempt-1",
      }).success,
    ).toBe(false);
    expect(
      CreatePublicationAttemptRequest.safeParse({
        ...request,
        authorizationGrantRef: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["artifactId", ids.artifact],
    ["artifactRevisionId", ids.revision],
    ["approvedArtifactRevision", 3],
    ["approvedArtifactContentHash", checksum],
    ["qaGateSnapshot", { verdict: "passed" }],
    ["qaGateSnapshotHash", qaChecksum],
    ["authorizationSnapshot", publishAuthorization],
    ["rollbackPlan", rollbackPlan],
    ["previewChecksum", checksum],
    ["rollbackPlanChecksum", qaChecksum],
    ["actorId", ids.actor],
    ["reviewerActorId", ids.actor],
    ["probeFacts", { remoteWritable: true }],
  ])("rejects client-authored publish fact %s", (field, value) => {
    const request = {
      destinationRef: ids.destination,
      expectedDestinationRevision: 1,
      authorizationGrantRef: ids.authorization,
      approvalEventId: ids.approval,
      previewRef: "preview://artifact/revision/3",
      rollbackPlanRef: "rollback-plan://artifact/revision/3",
      remotePrecondition: {
        kind: "must_match",
        revision: "base-sha",
      },
      idempotencyKey: "publication-attempt-1",
      [field]: value,
    };

    expect(CreatePublicationAttemptRequest.safeParse(request).success).toBe(
      false,
    );
  });

  it("requires a new rollback grant, acknowledgement, source change receipt and current remote revision", () => {
    const request = {
      authorizationGrantRef: ids.rollbackGrant,
      sourceChangeReceiptId: ids.receipt,
      previewRef: "preview://rollback/source-attempt",
      expectedCurrentRemoteRevision: "merged-sha",
      customerAcknowledgementInput: {
        acknowledged: true,
        acknowledgementScope: "rollback_preview",
      },
      reason: "Restore the previously verified live version.",
      idempotencyKey: "rollback-attempt-1",
    };

    expect(CreatePublicationRollbackAttemptRequest.parse(request)).toEqual(
      request,
    );
    for (const forbidden of [
      ["approvalEventId", ids.approval],
      ["sourceApprovalCurrent", true],
      ["authorizationSnapshot", rollbackAuthorization],
      ["sourceApproval", approvalSnapshot],
      ["rollbackPlan", rollbackPlan],
      ["previewChecksum", checksum],
      ["actorId", ids.actor],
      ["reviewerActorId", ids.actor],
      ["probeFacts", { revisionExists: true }],
    ] as const) {
      expect(
        CreatePublicationRollbackAttemptRequest.safeParse({
          ...request,
          [forbidden[0]]: forbidden[1],
        }).success,
      ).toBe(false);
    }
  });

  it("uses the common printable ASCII idempotency boundary", () => {
    const base = {
      destinationRef: ids.destination,
      expectedDestinationRevision: 1,
      authorizationGrantRef: ids.authorization,
      approvalEventId: ids.approval,
      previewRef: "preview://artifact/revision/3",
      rollbackPlanRef: "rollback-plan://artifact/revision/3",
      remotePrecondition: { kind: "must_not_exist", revision: null },
    };

    expect(
      CreatePublicationAttemptRequest.safeParse({
        ...base,
        idempotencyKey: "x".repeat(128),
      }).success,
    ).toBe(true);
    expect(
      CreatePublicationAttemptRequest.safeParse({
        ...base,
        idempotencyKey: "x".repeat(129),
      }).success,
    ).toBe(false);
    expect(
      CreatePublicationAttemptRequest.safeParse({
        ...base,
        idempotencyKey: "line\nbreak",
      }).success,
    ).toBe(false);
  });

  it("uses a closed remote precondition union", () => {
    expect(
      PublicationRemotePrecondition.parse({
        kind: "must_match",
        revision: "base-sha",
      }),
    ).toEqual({ kind: "must_match", revision: "base-sha" });
    expect(
      PublicationRemotePrecondition.parse({
        kind: "must_not_exist",
        revision: null,
      }),
    ).toEqual({ kind: "must_not_exist", revision: null });
    expect(
      PublicationRemotePrecondition.safeParse({
        kind: "must_match",
        revision: null,
      }).success,
    ).toBe(false);
    expect(
      PublicationRemotePrecondition.safeParse({
        kind: "must_not_exist",
        revision: "anything",
      }).success,
    ).toBe(false);
  });

  it("reconciles from server-held attempt facts without a client hash or probe", () => {
    expect(ReconcilePublicationAttemptRequest.parse({})).toEqual({});
    expect(
      ReconcilePublicationAttemptRequest.safeParse({
        expectedAttemptRequestHash: requestHash,
      }).success,
    ).toBe(false);
    expect(
      ReconcilePublicationAttemptRequest.safeParse({
        probeFacts: { providerAccepted: true },
      }).success,
    ).toBe(false);
  });
});

describe("delivery and change receipt lineage", () => {
  const delivery = {
    id: ids.receipt,
    receiptKind: "delivery_receipt" as const,
    predecessorDeliveryReceiptId: null,
    providerKind: "github" as const,
    providerRequestId: "github-request-1",
    remoteScopeRef: "github:repository:101:pull-request:42",
    remoteObjectKind: "github_pull_request" as const,
    remoteObjectId: "42",
    remoteRevision: "head-sha",
    deliveryUrl: "https://github.com/gengrowth/website/pull/42",
    liveCanonicalUrl: null,
    contentChecksum: checksum,
    verificationState: "provider_accepted" as const,
    remoteFacts: { headSha: "head-sha", baseSha: "base-sha" },
    evidenceRefs: [],
    limitation: null,
    observedAt: "2026-07-27T09:05:00Z",
  };
  const change = {
    ...delivery,
    id: "00000000-0000-4000-8000-000000000216",
    receiptKind: "change_receipt" as const,
    predecessorDeliveryReceiptId: ids.receipt,
    remoteObjectKind: "github_merge" as const,
    remoteRevision: "merged-sha",
    liveCanonicalUrl: "https://example.com/blog/customer-onboarding/",
    verificationState: "verified_live" as const,
    evidenceRefs: ["evidence://github/merge/42", "evidence://live/page"],
    limitation: null,
    observedAt: "2026-07-27T09:15:00Z",
  };

  it("accepts strict discriminated delivery and change receipts", () => {
    expect(PublicationDeliveryReceipt.parse(delivery)).toEqual(delivery);
    expect(PublicationReceipt.parse(delivery)).toEqual(delivery);
    expect(PublicationChangeReceipt.parse(change)).toEqual(change);
    expect(PublicationReceipt.parse(change)).toEqual(change);
  });

  it("requires change receipts to point to a delivery predecessor", () => {
    expect(
      PublicationChangeReceipt.safeParse({
        ...change,
        predecessorDeliveryReceiptId: null,
      }).success,
    ).toBe(false);
    expect(
      PublicationDeliveryReceipt.safeParse({
        ...delivery,
        predecessorDeliveryReceiptId: ids.receipt,
      }).success,
    ).toBe(false);
  });

  it("allows an absent provider request ID without fabricating one", () => {
    expect(
      PublicationDeliveryReceipt.parse({
        ...delivery,
        providerRequestId: null,
      }),
    ).toEqual({
      ...delivery,
      providerRequestId: null,
    });
    expect(
      PublicationChangeReceipt.parse({
        ...change,
        providerRequestId: null,
      }),
    ).toEqual({
      ...change,
      providerRequestId: null,
    });

    for (const malformed of ["", "x".repeat(513)]) {
      expect(
        PublicationDeliveryReceipt.safeParse({
          ...delivery,
          providerRequestId: malformed,
        }).success,
      ).toBe(false);
      expect(
        PublicationChangeReceipt.safeParse({
          ...change,
          providerRequestId: malformed,
        }).success,
      ).toBe(false);
    }
  });

  it("requires verified live evidence for change and forbids it on delivery", () => {
    expect(
      PublicationChangeReceipt.safeParse({
        ...change,
        verificationState: "pending",
      }).success,
    ).toBe(false);
    expect(
      PublicationChangeReceipt.safeParse({
        ...change,
        evidenceRefs: [],
      }).success,
    ).toBe(false);
    expect(
      PublicationChangeReceipt.safeParse({
        ...change,
        liveCanonicalUrl: null,
      }).success,
    ).toBe(false);
    expect(
      PublicationDeliveryReceipt.safeParse({
        ...delivery,
        liveCanonicalUrl: "https://example.com/blog/customer-onboarding/",
      }).success,
    ).toBe(false);
  });

  it("keeps provider and remote object kinds closed", () => {
    expect(
      PublicationDeliveryReceipt.safeParse({
        ...delivery,
        providerKind: "wordpress",
      }).success,
    ).toBe(false);
    expect(
      PublicationChangeReceipt.safeParse({
        ...change,
        remoteObjectKind: "github_pull_request",
      }).success,
    ).toBe(false);
    expect(
      PublicationReceipt.safeParse({ ...change, resultLift: 20 }).success,
    ).toBe(false);
  });
});

describe("server publication attempt union", () => {
  const common = {
    id: ids.attempt,
    asyncRunId: ids.asyncRun,
    siteId: ids.site,
    destinationRef: ids.destination,
    destinationRevision: 1,
    targetRef: "/blog/customer-onboarding/",
    actionId: ids.action,
    artifactId: ids.artifact,
    approvedArtifactRevision: 3,
    approvedArtifactContentHash: checksum,
    providerKind: "github" as const,
    sideEffectClass: "external_write" as const,
    previewRef: "preview://artifact/revision/3",
    previewChecksum: checksum,
    remotePrecondition: {
      kind: "must_match" as const,
      revision: "base-sha",
    },
    rollbackPlan,
    idempotencyKey: "publication-attempt-1",
    requestHash,
    state: "pending" as const,
    receipts: [],
    requestedAt: "2026-07-27T09:02:00Z",
  };
  const publish = {
    ...common,
    attemptKind: "publish" as const,
    sourcePublicationAttemptId: null,
    sourceChangeReceiptId: null,
    authorizationGrantRef: ids.authorization,
    publicationApproval: approvalSnapshot,
    sourceApproval: null,
    authorizationSnapshot: publishAuthorization,
  };
  const rollback = {
    ...common,
    attemptKind: "rollback" as const,
    sourcePublicationAttemptId: ids.sourceAttempt,
    sourceChangeReceiptId: ids.receipt,
    authorizationGrantRef: ids.rollbackGrant,
    publicationApproval: null,
    sourceApproval: approvalSnapshot,
    authorizationSnapshot: rollbackAuthorization,
    idempotencyKey: "rollback-attempt-1",
  };

  it("requires current publication approval only for publish attempts", () => {
    expect(PublicationAttempt.parse(publish)).toEqual(publish);
    expect(
      PublicationAttempt.safeParse({
        ...publish,
        publicationApproval: null,
      }).success,
    ).toBe(false);
  });

  it("accepts historical source approval lineage for rollback without a current-source flag", () => {
    expect(PublicationRollbackPlan.parse(rollbackPlan)).toEqual(rollbackPlan);
    expect(PublicationAttempt.parse(rollback)).toEqual(rollback);
    expect(
      PublicationAttempt.safeParse({
        ...rollback,
        publicationApproval: approvalSnapshot,
      }).success,
    ).toBe(false);
  });

  it("validates embedded delivery/change lineage against the attempt", () => {
    const delivery = {
      id: ids.receipt,
      receiptKind: "delivery_receipt" as const,
      predecessorDeliveryReceiptId: null,
      providerKind: "github" as const,
      providerRequestId: "github-request-1",
      remoteScopeRef: "github:repository:101:pull-request:42",
      remoteObjectKind: "github_pull_request" as const,
      remoteObjectId: "42",
      remoteRevision: "head-sha",
      deliveryUrl: "https://github.com/gengrowth/website/pull/42",
      liveCanonicalUrl: null,
      contentChecksum: checksum,
      verificationState: "provider_accepted" as const,
      remoteFacts: { headSha: "head-sha", baseSha: "base-sha" },
      evidenceRefs: [],
      limitation: null,
      observedAt: "2026-07-27T09:05:00Z",
    };
    const change = {
      ...delivery,
      id: "00000000-0000-4000-8000-000000000216",
      receiptKind: "change_receipt" as const,
      predecessorDeliveryReceiptId: ids.receipt,
      remoteObjectKind: "github_merge" as const,
      remoteRevision: "merged-sha",
      liveCanonicalUrl: "https://example.com/blog/customer-onboarding/",
      verificationState: "verified_live" as const,
      evidenceRefs: ["evidence://github/merge/42"],
      observedAt: "2026-07-27T09:15:00Z",
    };
    const changedAttempt = {
      ...publish,
      state: "changed" as const,
      receipts: [delivery, change],
    };

    expect(PublicationAttempt.parse(changedAttempt)).toEqual(changedAttempt);

    const invalidReceiptSets = [
      [
        delivery,
        {
          ...change,
          predecessorDeliveryReceiptId:
            "00000000-0000-4000-8000-000000000299",
        },
      ],
      [delivery, { ...change, contentChecksum: qaChecksum }],
      [
        delivery,
        {
          ...change,
          remoteScopeRef: "github:repository:101:pull-request:43",
        },
      ],
      [delivery, { ...change, observedAt: delivery.observedAt }],
      [change],
      [
        {
          ...delivery,
          providerKind: "wordpress" as const,
          remoteObjectKind: "wordpress_post" as const,
        },
      ],
    ];

    for (const receipts of invalidReceiptSets) {
      expect(
        PublicationAttempt.safeParse({
          ...changedAttempt,
          receipts,
        }).success,
      ).toBe(false);
    }
  });

  it("returns a strict accepted response without claiming delivery", () => {
    const accepted = {
      publicationAttemptId: ids.attempt,
      asyncRunId: ids.asyncRun,
      state: "pending" as const,
      replayed: false,
    };

    expect(PublicationAttemptAccepted.parse(accepted)).toEqual(accepted);
    expect(
      PublicationAttemptAccepted.safeParse({
        ...accepted,
        state: "delivered",
      }).success,
    ).toBe(false);
  });
});
