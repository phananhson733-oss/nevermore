import { describe, expect, it } from "vitest";
import {
  AppendArtifactApprovalEventRequest,
  ApproveArtifactRevisionRequest,
  ArtifactApprovalEvent,
  ArtifactApprovalSnapshot,
  CustomerAcknowledgement,
  CustomerAcknowledgementInput,
  InvalidateArtifactApprovalRequest,
} from "./artifact-approval.ts";

const ids = {
  acknowledgement: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  approval: "00000000-0000-4000-8000-000000000003",
  artifact: "00000000-0000-4000-8000-000000000004",
  revision: "00000000-0000-4000-8000-000000000005",
  terminalActor: "00000000-0000-4000-8000-000000000006",
};
const checksum = "a".repeat(64);
const qaChecksum = "b".repeat(64);

const acknowledgement = {
  customerAcknowledgementId: ids.acknowledgement,
  actorId: ids.actor,
  acknowledgedAt: "2026-07-27T09:00:00Z",
  acknowledgementScope: "exact_artifact_revision_for_publication" as const,
};

const approvedEvent = {
  approvalEventId: ids.approval,
  eventKind: "approved" as const,
  supersedesApprovalEventId: null,
  eventActorId: ids.actor,
  artifactId: ids.artifact,
  artifactRevisionId: ids.revision,
  artifactRevision: 3,
  artifactContentHash: checksum,
  reviewerActorId: ids.actor,
  qaGateVersion: "content-shadow.qa.v4",
  qaGateSnapshot: { verdict: "passed", claimCount: 8 },
  qaGateSnapshotHash: qaChecksum,
  customerAcknowledgement: acknowledgement,
  reason: null,
  recordedAt: "2026-07-27T09:00:01Z",
};

describe("artifact approval client inputs", () => {
  it("accepts only exact-revision identity, optimistic QA facts and acknowledgement intent", () => {
    const input = {
      eventKind: "approved",
      artifactRevisionId: ids.revision,
      expectedArtifactRevision: 3,
      expectedQaGateVersion: "content-shadow.qa.v4",
      customerAcknowledgementInput: {
        acknowledged: true,
        acknowledgementScope: "exact_artifact_revision_for_publication",
      },
    };

    expect(ApproveArtifactRevisionRequest.parse(input)).toEqual(input);
    expect(AppendArtifactApprovalEventRequest.parse(input)).toEqual(input);
  });

  it.each([
    ["eventActorId", ids.actor],
    ["reviewerActorId", ids.actor],
    ["artifactContentHash", checksum],
    ["qaGateSnapshot", { verdict: "passed" }],
    ["qaGateSnapshotHash", qaChecksum],
    ["customerAcknowledgementId", ids.acknowledgement],
    ["acknowledgedAt", "2026-07-27T09:00:00Z"],
  ])("rejects server-owned approved-event fact %s", (field, value) => {
    const input = {
      eventKind: "approved",
      artifactRevisionId: ids.revision,
      expectedArtifactRevision: 3,
      expectedQaGateVersion: "content-shadow.qa.v4",
      customerAcknowledgementInput: {
        acknowledged: true,
        acknowledgementScope: "exact_artifact_revision_for_publication",
      },
      [field]: value,
    };

    expect(ApproveArtifactRevisionRequest.safeParse(input).success).toBe(false);
  });

  it("requires literal acknowledgement and the publication revision scope", () => {
    expect(
      CustomerAcknowledgementInput.safeParse({
        acknowledged: false,
        acknowledgementScope: "exact_artifact_revision_for_publication",
      }).success,
    ).toBe(false);
    expect(
      ApproveArtifactRevisionRequest.safeParse({
        eventKind: "approved",
        artifactRevisionId: ids.revision,
        expectedArtifactRevision: 3,
        expectedQaGateVersion: "content-shadow.qa.v4",
        customerAcknowledgementInput: {
          acknowledged: true,
          acknowledgementScope: "rollback_preview",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only a source approval id and reason for terminal events", () => {
    const terminal = {
      eventKind: "revoked",
      supersedesApprovalEventId: ids.approval,
      reason: "Customer withdrew approval.",
    };

    expect(InvalidateArtifactApprovalRequest.parse(terminal)).toEqual(terminal);
    expect(AppendArtifactApprovalEventRequest.parse(terminal)).toEqual(terminal);
    expect(
      InvalidateArtifactApprovalRequest.safeParse({
        ...terminal,
        eventActorId: ids.terminalActor,
      }).success,
    ).toBe(false);
    expect(
      InvalidateArtifactApprovalRequest.safeParse({
        ...terminal,
        reviewerActorId: ids.actor,
      }).success,
    ).toBe(false);
  });
});

describe("artifact approval server events", () => {
  it("requires eventActorId to equal reviewerActorId only for approved events", () => {
    expect(ArtifactApprovalEvent.parse(approvedEvent)).toEqual(approvedEvent);
    expect(
      ArtifactApprovalEvent.safeParse({
        ...approvedEvent,
        eventActorId: ids.terminalActor,
      }).success,
    ).toBe(false);
    expect(
      ArtifactApprovalEvent.safeParse({
        ...approvedEvent,
        reviewerActorId: null,
      }).success,
    ).toBe(false);
  });

  it.each(["revoked", "superseded"] as const)(
    "records a new event actor and a null reviewer for %s",
    (eventKind) => {
      const terminal = {
        ...approvedEvent,
        approvalEventId: "00000000-0000-4000-8000-000000000010",
        eventKind,
        supersedesApprovalEventId: ids.approval,
        eventActorId: ids.terminalActor,
        reviewerActorId: null,
        reason: `Approval ${eventKind} by customer request.`,
        recordedAt: "2026-07-27T09:05:00Z",
      };

      expect(ArtifactApprovalEvent.parse(terminal)).toEqual(terminal);
      expect(
        ArtifactApprovalEvent.safeParse({
          ...terminal,
          reviewerActorId: ids.actor,
        }).success,
      ).toBe(false);
      expect(
        ArtifactApprovalEvent.safeParse({
          ...terminal,
          eventActorId: undefined,
        }).success,
      ).toBe(false);
    },
  );

  it("keeps approval snapshots exact, strict and server-owned", () => {
    const snapshot = {
      approvalEventId: ids.approval,
      approvalState: "approved",
      artifactId: ids.artifact,
      artifactRevisionId: ids.revision,
      approvedArtifactRevision: 3,
      approvedArtifactContentHash: checksum,
      reviewerActorId: ids.actor,
      qaGateVersion: "content-shadow.qa.v4",
      qaGateSnapshot: { verdict: "passed" },
      qaGateSnapshotHash: qaChecksum,
      customerAcknowledgement: acknowledgement,
      approvedAt: "2026-07-27T09:00:01Z",
    };

    expect(ArtifactApprovalSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(
      ArtifactApprovalSnapshot.safeParse({ ...snapshot, current: true })
        .success,
    ).toBe(false);
  });

  it("enforces UUID, UTC timestamp, checksum and bounded-text constraints", () => {
    expect(CustomerAcknowledgement.parse(acknowledgement)).toEqual(
      acknowledgement,
    );
    expect(
      ArtifactApprovalEvent.safeParse({
        ...approvedEvent,
        approvalEventId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      ArtifactApprovalEvent.safeParse({
        ...approvedEvent,
        artifactContentHash: "A".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      ArtifactApprovalEvent.safeParse({
        ...approvedEvent,
        recordedAt: "2026-07-27T17:00:01+08:00",
      }).success,
    ).toBe(false);
    expect(
      InvalidateArtifactApprovalRequest.safeParse({
        eventKind: "revoked",
        supersedesApprovalEventId: ids.approval,
        reason: "no",
      }).success,
    ).toBe(false);
    expect(
      ApproveArtifactRevisionRequest.safeParse({
        eventKind: "approved",
        artifactRevisionId: ids.revision,
        expectedArtifactRevision: 3,
        expectedQaGateVersion: "v".repeat(101),
        customerAcknowledgementInput: {
          acknowledged: true,
          acknowledgementScope: "exact_artifact_revision_for_publication",
        },
      }).success,
    ).toBe(false);
  });
});
