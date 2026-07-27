import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

const QaGateVersion = z.string().trim().min(1).max(100);
const ApprovalReason = z.string().trim().min(3).max(2000);
const QaGateSnapshot = z.record(
  z.string().trim().min(1).max(200),
  z.unknown(),
);

/** Lower-case SHA-256 used for immutable Artifact and QA snapshots. */
export const PublicationChecksum = z.string().regex(/^[a-f0-9]{64}$/u);
export type PublicationChecksum = z.infer<typeof PublicationChecksum>;

export const ArtifactApprovalEventKind = z.enum([
  "approved",
  "revoked",
  "superseded",
]);
export type ArtifactApprovalEventKind = z.infer<
  typeof ArtifactApprovalEventKind
>;

export const CustomerAcknowledgementScope = z.enum([
  "connector_configuration",
  "exact_artifact_revision_for_publication",
  "rollback_preview",
]);
export type CustomerAcknowledgementScope = z.infer<
  typeof CustomerAcknowledgementScope
>;

/**
 * Durable server-owned acknowledgement. Actor, id and timestamp are never
 * accepted from a client command.
 */
export const CustomerAcknowledgement = z
  .object({
    customerAcknowledgementId: Uuid,
    actorId: Uuid,
    acknowledgedAt: IsoDateTime,
    acknowledgementScope: CustomerAcknowledgementScope,
  })
  .strict();
export type CustomerAcknowledgement = z.infer<
  typeof CustomerAcknowledgement
>;

/** The only acknowledgement facts a client may submit. */
export const CustomerAcknowledgementInput = z
  .object({
    acknowledged: z.literal(true),
    acknowledgementScope: z.enum([
      "exact_artifact_revision_for_publication",
      "rollback_preview",
    ]),
  })
  .strict();
export type CustomerAcknowledgementInput = z.infer<
  typeof CustomerAcknowledgementInput
>;

const PublicationRevisionAcknowledgementInput =
  CustomerAcknowledgementInput.extend({
    acknowledgementScope: z.literal(
      "exact_artifact_revision_for_publication",
    ),
  });

export const PublicationRevisionCustomerAcknowledgement =
  CustomerAcknowledgement.extend({
    acknowledgementScope: z.literal(
      "exact_artifact_revision_for_publication",
    ),
  });
export type PublicationRevisionCustomerAcknowledgement = z.infer<
  typeof PublicationRevisionCustomerAcknowledgement
>;

/**
 * Client command for one exact Artifact Revision. Content hashes, QA snapshot,
 * reviewer identity and durable acknowledgement facts are all server-owned.
 */
export const ApproveArtifactRevisionRequest = z
  .object({
    eventKind: z.literal("approved"),
    artifactRevisionId: Uuid,
    expectedArtifactRevision: z.number().int().min(1),
    expectedQaGateVersion: QaGateVersion,
    customerAcknowledgementInput: PublicationRevisionAcknowledgementInput,
  })
  .strict();
export type ApproveArtifactRevisionRequest = z.infer<
  typeof ApproveArtifactRevisionRequest
>;

/**
 * A terminal client command identifies only its source approved event and
 * reason. The authenticated session supplies the terminal event actor.
 */
export const InvalidateArtifactApprovalRequest = z
  .object({
    eventKind: z.enum(["revoked", "superseded"]),
    supersedesApprovalEventId: Uuid,
    reason: ApprovalReason,
  })
  .strict();
export type InvalidateArtifactApprovalRequest = z.infer<
  typeof InvalidateArtifactApprovalRequest
>;

export const AppendArtifactApprovalEventRequest = z.discriminatedUnion(
  "eventKind",
  [ApproveArtifactRevisionRequest, InvalidateArtifactApprovalRequest],
);
export type AppendArtifactApprovalEventRequest = z.infer<
  typeof AppendArtifactApprovalEventRequest
>;

const ApprovalEventLineageShape = {
  approvalEventId: Uuid,
  artifactId: Uuid,
  artifactRevisionId: Uuid,
  artifactRevision: z.number().int().min(1),
  artifactContentHash: PublicationChecksum,
  qaGateVersion: QaGateVersion,
  qaGateSnapshot: QaGateSnapshot,
  qaGateSnapshotHash: PublicationChecksum,
  customerAcknowledgement: PublicationRevisionCustomerAcknowledgement,
  recordedAt: IsoDateTime,
} as const;

const ApprovedArtifactApprovalEvent = z
  .object({
    ...ApprovalEventLineageShape,
    eventKind: z.literal("approved"),
    supersedesApprovalEventId: z.null(),
    eventActorId: Uuid,
    reviewerActorId: Uuid,
    reason: z.null(),
  })
  .strict();

const TerminalArtifactApprovalEvent = z
  .object({
    ...ApprovalEventLineageShape,
    eventKind: z.enum(["revoked", "superseded"]),
    supersedesApprovalEventId: Uuid,
    eventActorId: Uuid,
    reviewerActorId: z.null(),
    reason: ApprovalReason,
  })
  .strict();

/**
 * Append-only server event. Only an approved event has a reviewer, and that
 * reviewer is the authenticated actor who performed the approval. Terminal
 * events record their own actor while retaining reviewer lineage through the
 * source approval.
 */
export const ArtifactApprovalEvent = z
  .discriminatedUnion("eventKind", [
    ApprovedArtifactApprovalEvent,
    TerminalArtifactApprovalEvent,
  ])
  .superRefine((event, ctx) => {
    if (
      event.eventKind === "approved" &&
      event.eventActorId !== event.reviewerActorId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewerActorId"],
        message:
          "Approved eventActorId must equal the approved-only reviewerActorId",
      });
    }
  });
export type ArtifactApprovalEvent = z.infer<typeof ArtifactApprovalEvent>;

/**
 * Frozen publication authority for one exact revision. Current/unrevoked
 * eligibility is a repository timeline decision, not a client or snapshot
 * boolean.
 */
export const ArtifactApprovalSnapshot = z
  .object({
    approvalEventId: Uuid,
    approvalState: z.literal("approved"),
    artifactId: Uuid,
    artifactRevisionId: Uuid,
    approvedArtifactRevision: z.number().int().min(1),
    approvedArtifactContentHash: PublicationChecksum,
    reviewerActorId: Uuid,
    qaGateVersion: QaGateVersion,
    qaGateSnapshot: QaGateSnapshot,
    qaGateSnapshotHash: PublicationChecksum,
    customerAcknowledgement: PublicationRevisionCustomerAcknowledgement,
    approvedAt: IsoDateTime,
  })
  .strict();
export type ArtifactApprovalSnapshot = z.infer<
  typeof ArtifactApprovalSnapshot
>;
