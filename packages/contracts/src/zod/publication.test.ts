import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePublicationAttemptRequest,
  CreatePublicationRollbackAttemptRequest,
  IssuePublicationPreviewRequest,
  IssuePublicationPreviewResponse,
  IssuePublicationRollbackPreviewRequest,
  IssuePublicationRollbackPreviewResponse,
  PublicationAttempt,
  PublicationAttemptAccepted,
  PublicationChangeReceipt,
  PublicationDeliveryReceipt,
  PublicationReceipt,
  PublicationRemotePrecondition,
  PublicationRollbackPlan,
  PublicationState,
  ReconcilePublicationAttemptRequest,
  RevokePublicationPreviewRequest,
  RevokePublicationPreviewResponse,
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
  destinationRow: "00000000-0000-4000-8000-000000000217",
  previewEvent: "00000000-0000-4000-8000-000000000218",
  receipt: "00000000-0000-4000-8000-000000000209",
  revision: "00000000-0000-4000-8000-000000000210",
  rollbackGrant: "00000000-0000-4000-8000-000000000211",
  sourceAttempt: "00000000-0000-4000-8000-000000000212",
  attempt: "00000000-0000-4000-8000-000000000213",
  site: "00000000-0000-4000-8000-000000000214",
  terminalPreviewEvent: "00000000-0000-4000-8000-000000000219",
};
const artifactText = "# Customer onboarding\n";
const sha256Utf8 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
// A one-key object has the same serialization under JSON.stringify and JCS.
const artifactContentHash = sha256Utf8(
  JSON.stringify({ text: artifactText }),
);
const contentChecksum = sha256Utf8(artifactText);
const qaChecksum = "b".repeat(64);
const requestHash = "c".repeat(64);
const previewFactsHash = "d".repeat(64);
const previewRef =
  "pvw_00000000-0000-4000-8000-000000000218";

const approvalSnapshot = {
  approvalEventId: ids.approval,
  approvalState: "approved" as const,
  artifactId: ids.artifact,
  artifactRevisionId: ids.revision,
  approvedArtifactRevision: 3,
  approvedArtifactContentHash: artifactContentHash,
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
    ["approvedArtifactContentHash", artifactContentHash],
    ["qaGateSnapshot", { verdict: "passed" }],
    ["qaGateSnapshotHash", qaChecksum],
    ["authorizationSnapshot", publishAuthorization],
    ["rollbackPlan", rollbackPlan],
    ["previewChecksum", artifactContentHash],
    ["contentChecksum", contentChecksum],
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
      ["previewChecksum", artifactContentHash],
      ["contentChecksum", contentChecksum],
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

describe("publication preview authority contracts", () => {
  const publishIssueRequest = {
    destinationRef: ids.destination,
    expectedDestinationRevision: 1,
    approvalEventId: ids.approval,
    idempotencyKey: "publication-preview-issue-1",
  };
  const rollbackIssueRequest = {
    destinationRef: ids.destination,
    expectedDestinationRevision: 1,
    sourcePublicationAttemptId: ids.sourceAttempt,
    sourceChangeReceiptId: ids.receipt,
    idempotencyKey: "publication-rollback-preview-issue-1",
  };
  const commonIssuedLineage = {
    previewEventId: ids.previewEvent,
    previewRef,
    eventKind: "issued" as const,
    factsSchemaVersion: "publication-preview-facts.v1",
    siteId: ids.site,
    destinationId: ids.destinationRow,
    destinationRef: ids.destination,
    destinationRevision: 1,
    providerKind: "github" as const,
    targetRef: "content/blog/customer-onboarding.md",
    actionId: ids.action,
    artifactId: ids.artifact,
    artifactRevisionId: ids.revision,
    artifactRevision: 3,
    artifactContentHash,
    artifactApprovalEventId: ids.approval,
    rollbackPlan,
    previewChecksum: artifactContentHash,
    contentChecksum,
    factsHash: previewFactsHash,
    expiresAt: "2026-07-27T09:30:00Z",
    createdAt: "2026-07-27T09:20:00Z",
  };
  const publishIssued = {
    ...commonIssuedLineage,
    previewKind: "publish" as const,
    sourcePublicationAttemptId: null,
    sourceChangeReceiptId: null,
    remotePrecondition: {
      kind: "must_match" as const,
      revision: "base-sha",
    },
  };
  const rollbackIssued = {
    ...commonIssuedLineage,
    previewKind: "rollback" as const,
    sourcePublicationAttemptId: ids.sourceAttempt,
    sourceChangeReceiptId: ids.receipt,
    remotePrecondition: {
      kind: "must_match" as const,
      revision: rollbackPlan.expectedCurrentRemoteRevision,
    },
  };

  it("accepts only publish preview selection intent from the client", () => {
    expect(IssuePublicationPreviewRequest.parse(publishIssueRequest)).toEqual(
      publishIssueRequest,
    );

    for (const [field, value] of [
      ["previewEventId", ids.previewEvent],
      ["previewRef", previewRef],
      ["previewKind", "publish"],
      ["factsSchemaVersion", "publication-preview-facts.v1"],
      ["siteId", ids.site],
      ["destinationId", ids.destinationRow],
      ["providerKind", "github"],
      ["targetRef", "content/blog/customer-onboarding.md"],
      ["actionId", ids.action],
      ["artifactId", ids.artifact],
      ["artifactRevisionId", ids.revision],
      ["artifactRevision", 3],
      ["artifactContentHash", artifactContentHash],
      ["providerPlan", { providerKind: "github", operation: "publish" }],
      [
        "remotePrecondition",
        { kind: "must_match", revision: "base-sha" },
      ],
      ["rollbackPlan", rollbackPlan],
      ["previewChecksum", artifactContentHash],
      ["contentChecksum", contentChecksum],
      ["factsHash", previewFactsHash],
      ["expiresAt", "2026-07-27T09:30:00Z"],
      ["eventActorId", ids.actor],
      ["actorId", ids.actor],
      ["requestHash", requestHash],
      ["sourcePublicationAttemptId", ids.sourceAttempt],
      ["sourceChangeReceiptId", ids.receipt],
    ] as const) {
      expect(
        IssuePublicationPreviewRequest.safeParse({
          ...publishIssueRequest,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts only rollback source selection intent from the client", () => {
    expect(
      IssuePublicationRollbackPreviewRequest.parse(rollbackIssueRequest),
    ).toEqual(rollbackIssueRequest);

    for (const [field, value] of [
      ["previewEventId", ids.previewEvent],
      ["previewRef", previewRef],
      ["previewKind", "rollback"],
      ["factsSchemaVersion", "publication-preview-facts.v1"],
      ["approvalEventId", ids.approval],
      ["siteId", ids.site],
      ["destinationId", ids.destinationRow],
      ["providerKind", "github"],
      ["targetRef", "content/blog/customer-onboarding.md"],
      ["artifactContentHash", artifactContentHash],
      ["expectedCurrentRemoteRevision", "merged-sha"],
      ["reason", "Restore the last verified live version."],
      ["providerPlan", { providerKind: "github", operation: "rollback" }],
      [
        "remotePrecondition",
        { kind: "must_match", revision: "merged-sha" },
      ],
      ["rollbackPlan", rollbackPlan],
      ["previewChecksum", artifactContentHash],
      ["contentChecksum", contentChecksum],
      ["factsHash", previewFactsHash],
      ["expiresAt", "2026-07-27T09:30:00Z"],
      ["eventActorId", ids.actor],
      ["actorId", ids.actor],
      ["requestHash", requestHash],
    ] as const) {
      expect(
        IssuePublicationRollbackPreviewRequest.safeParse({
          ...rollbackIssueRequest,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it("returns strict customer-safe publish and rollback lineage", () => {
    expect(IssuePublicationPreviewResponse.parse(publishIssued)).toEqual(
      publishIssued,
    );
    expect(
      IssuePublicationRollbackPreviewResponse.parse(rollbackIssued),
    ).toEqual(rollbackIssued);

    for (const [field, value] of [
      ["providerPlan", { providerKind: "github", credentialRef: "secret" }],
      ["eventActorId", ids.actor],
      ["requestHash", requestHash],
      ["idempotencyKey", publishIssueRequest.idempotencyKey],
    ] as const) {
      expect(
        IssuePublicationPreviewResponse.safeParse({
          ...publishIssued,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects divergent or temporally invalid frozen lineage", () => {
    expect(
      IssuePublicationPreviewResponse.safeParse({
        ...publishIssued,
        previewRef: "preview://legacy/ref",
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationPreviewResponse.safeParse({
        ...publishIssued,
        previewChecksum: "e".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationPreviewResponse.safeParse({
        ...publishIssued,
        rollbackPlan: {
          ...rollbackPlan,
          providerKind: "wordpress",
          strategy: "wordpress_restore_revision",
        },
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationPreviewResponse.safeParse({
        ...publishIssued,
        expiresAt: publishIssued.createdAt,
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationRollbackPreviewResponse.safeParse({
        ...rollbackIssued,
        remotePrecondition: {
          kind: "must_not_exist",
          revision: null,
        },
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationRollbackPreviewResponse.safeParse({
        ...rollbackIssued,
        remotePrecondition: {
          kind: "must_match",
          revision: "different-current-revision",
        },
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationPreviewResponse.safeParse({
        ...publishIssued,
        sourcePublicationAttemptId: ids.sourceAttempt,
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationRollbackPreviewResponse.safeParse({
        ...rollbackIssued,
        sourceChangeReceiptId: null,
      }).success,
    ).toBe(false);
  });

  it("keeps preview identity in the revoke path and body as intent only", () => {
    const request = {
      reason: "The destination changed after preview generation.",
      idempotencyKey: "publication-preview-revoke-1",
    };
    const response = {
      terminalEventId: ids.terminalPreviewEvent,
      eventKind: "revoked" as const,
      supersededPreviewEventId: ids.previewEvent,
      previewRef,
      createdAt: "2026-07-27T09:25:00Z",
    };

    expect(RevokePublicationPreviewRequest.parse(request)).toEqual(request);
    expect(RevokePublicationPreviewResponse.parse(response)).toEqual(
      response,
    );
    for (const [field, value] of [
      ["previewEventId", ids.previewEvent],
      ["previewRef", previewRef],
      ["eventKind", "revoked"],
      ["eventActorId", ids.actor],
      ["factsHash", previewFactsHash],
      ["providerPlan", { providerKind: "github" }],
    ] as const) {
      expect(
        RevokePublicationPreviewRequest.safeParse({
          ...request,
          [field]: value,
        }).success,
      ).toBe(false);
    }
    expect(
      RevokePublicationPreviewResponse.safeParse({
        ...response,
        eventActorId: ids.actor,
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
    artifactContentHash,
    contentChecksum,
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

  it("keeps the JCS Artifact identity distinct from exact UTF-8 provider bytes", () => {
    expect(artifactContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(contentChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifactContentHash).not.toBe(contentChecksum);
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
    approvedArtifactContentHash: artifactContentHash,
    providerKind: "github" as const,
    sideEffectClass: "external_write" as const,
    previewRef: "preview://artifact/revision/3",
    previewChecksum: artifactContentHash,
    contentChecksum,
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

  it("binds every publish and rollback preview to the exact approved artifact content", () => {
    for (const attempt of [publish, rollback]) {
      expect(
        PublicationAttempt.safeParse({
          ...attempt,
          previewChecksum: qaChecksum,
        }).success,
      ).toBe(false);
    }
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
      artifactContentHash,
      contentChecksum,
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
        { ...change, artifactContentHash: contentChecksum },
      ],
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

    expect(
      PublicationAttempt.safeParse({
        ...changedAttempt,
        contentChecksum: artifactContentHash,
      }).success,
    ).toBe(false);
    expect(
      PublicationAttempt.safeParse({
        ...changedAttempt,
        receipts: [
          {
            ...delivery,
            artifactContentHash: contentChecksum,
            contentChecksum: artifactContentHash,
          },
          {
            ...change,
            artifactContentHash: contentChecksum,
            contentChecksum: artifactContentHash,
          },
        ],
      }).success,
    ).toBe(false);
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
