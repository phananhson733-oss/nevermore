import { z } from "zod";
import {
  ArtifactApprovalSnapshot,
  CustomerAcknowledgementInput,
  PublicationChecksum,
} from "./artifact-approval.ts";
import { IdempotencyKey, IsoDateTime, Uuid } from "./common.ts";
import {
  PublicationAuthorizationSnapshot,
  PublicationHttpUrl,
  PublicationProviderKind,
} from "./delivery-connections.ts";

const nonEmptyText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const OpaqueRef = nonEmptyText(1024);
const RemoteRef = nonEmptyText(512);
const TargetRef = nonEmptyText(2048);
const EvidenceRef = nonEmptyText(500);
const ArtifactContentHash = PublicationChecksum.describe(
  "SHA-256 of the JCS artifact identity payload, currently contentHash({ text })",
);
const ProviderContentChecksum = PublicationChecksum.describe(
  "SHA-256 of the exact provider content/payload UTF-8 bytes",
);

const uniqueEvidenceRefs = (minimum = 0) =>
  z
    .array(EvidenceRef)
    .min(minimum)
    .max(100)
    .refine((refs) => new Set(refs).size === refs.length, {
      message: "Evidence refs must be unique",
    });

const RemoteFacts = z.record(
  z.string().trim().min(1).max(200),
  z.unknown(),
);

export const PublicationState = z.enum([
  "pending",
  "changed",
  "unavailable",
  "revoked",
]);
export type PublicationState = z.infer<typeof PublicationState>;

export const PublicationReceiptKind = z.enum([
  "delivery_receipt",
  "change_receipt",
]);
export type PublicationReceiptKind = z.infer<
  typeof PublicationReceiptKind
>;

const MatchRemotePrecondition = z
  .object({
    kind: z.literal("must_match"),
    revision: RemoteRef,
  })
  .strict();

const MissingRemotePrecondition = z
  .object({
    kind: z.literal("must_not_exist"),
    revision: z.null(),
  })
  .strict();

export const PublicationRemotePrecondition = z.discriminatedUnion("kind", [
  MatchRemotePrecondition,
  MissingRemotePrecondition,
]);
export type PublicationRemotePrecondition = z.infer<
  typeof PublicationRemotePrecondition
>;

const GitHubPublicationRollbackPlan = z
  .object({
    providerKind: z.literal("github"),
    strategy: z.literal("github_revert_pr"),
    priorRemoteRevision: RemoteRef,
    expectedCurrentRemoteRevision: RemoteRef,
    facts: RemoteFacts,
  })
  .strict();

const WordPressPublicationRollbackPlan = z
  .object({
    providerKind: z.literal("wordpress"),
    strategy: z.literal("wordpress_restore_revision"),
    priorRemoteRevision: RemoteRef,
    expectedCurrentRemoteRevision: RemoteRef,
    facts: RemoteFacts,
  })
  .strict();

export const PublicationRollbackPlan = z.discriminatedUnion("providerKind", [
  GitHubPublicationRollbackPlan,
  WordPressPublicationRollbackPlan,
]);
export type PublicationRollbackPlan = z.infer<
  typeof PublicationRollbackPlan
>;

/**
 * New publish command. The approval event is the only Artifact/approval
 * authority supplied by the client; revision, content hash and QA facts are
 * re-read server-side.
 */
export const CreatePublicationAttemptRequest = z
  .object({
    destinationRef: Uuid,
    expectedDestinationRevision: z.number().int().min(1),
    authorizationGrantRef: Uuid,
    approvalEventId: Uuid,
    previewRef: OpaqueRef,
    rollbackPlanRef: OpaqueRef,
    remotePrecondition: PublicationRemotePrecondition,
    idempotencyKey: IdempotencyKey,
  })
  .strict();
export type CreatePublicationAttemptRequest = z.infer<
  typeof CreatePublicationAttemptRequest
>;

const RollbackAcknowledgementInput = CustomerAcknowledgementInput.extend({
  acknowledgementScope: z.literal("rollback_preview"),
});

/**
 * Rollback is a new authorized external write. The source attempt is the route
 * identity; the request binds its verified Change Receipt and supplies a fresh
 * server-issued rollback grant plus acknowledgement intent.
 */
export const CreatePublicationRollbackAttemptRequest = z
  .object({
    authorizationGrantRef: Uuid,
    sourceChangeReceiptId: Uuid,
    previewRef: OpaqueRef,
    expectedCurrentRemoteRevision: RemoteRef,
    customerAcknowledgementInput: RollbackAcknowledgementInput,
    reason: z.string().trim().min(3).max(2000),
    idempotencyKey: IdempotencyKey,
  })
  .strict();
export type CreatePublicationRollbackAttemptRequest = z.infer<
  typeof CreatePublicationRollbackAttemptRequest
>;

export const ReconcilePublicationAttemptRequest = z
  .object({})
  .strict();
export type ReconcilePublicationAttemptRequest = z.infer<
  typeof ReconcilePublicationAttemptRequest
>;

export const PublicationAttemptAccepted = z
  .object({
    publicationAttemptId: Uuid,
    asyncRunId: Uuid,
    state: z.literal("pending"),
    replayed: z.boolean(),
  })
  .strict();
export type PublicationAttemptAccepted = z.infer<
  typeof PublicationAttemptAccepted
>;

const PublicationReceiptCommonShape = {
  id: Uuid,
  providerKind: PublicationProviderKind,
  providerRequestId: RemoteRef.nullable(),
  remoteScopeRef: OpaqueRef,
  remoteObjectId: RemoteRef,
  remoteRevision: RemoteRef,
  deliveryUrl: PublicationHttpUrl.nullable(),
  artifactContentHash: ArtifactContentHash,
  contentChecksum: ProviderContentChecksum,
  remoteFacts: RemoteFacts,
  observedAt: IsoDateTime,
} as const;

const PublicationDeliveryReceiptObject = z
  .object({
    ...PublicationReceiptCommonShape,
    receiptKind: z.literal("delivery_receipt"),
    predecessorDeliveryReceiptId: z.null(),
    remoteObjectKind: z.enum([
      "github_pull_request",
      "wordpress_post",
    ]),
    liveCanonicalUrl: z.null(),
    verificationState: z.enum([
      "provider_accepted",
      "pending",
      "unavailable",
    ]),
    evidenceRefs: uniqueEvidenceRefs(),
    limitation: nonEmptyText(2000).nullable(),
  })
  .strict();

function validateDeliveryProvider(
  receipt: z.infer<typeof PublicationDeliveryReceiptObject>,
  ctx: z.RefinementCtx,
): void {
  const valid =
    (receipt.providerKind === "github" &&
      receipt.remoteObjectKind === "github_pull_request") ||
    (receipt.providerKind === "wordpress" &&
      receipt.remoteObjectKind === "wordpress_post");
  if (!valid) {
    ctx.addIssue({
      code: "custom",
      path: ["remoteObjectKind"],
      message: "Delivery remote object kind must match providerKind",
    });
  }
  if (
    receipt.verificationState === "unavailable" &&
    receipt.limitation === null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: "Unavailable delivery receipt requires a limitation",
    });
  }
}

export const PublicationDeliveryReceipt =
  PublicationDeliveryReceiptObject.superRefine(validateDeliveryProvider);
export type PublicationDeliveryReceipt = z.infer<
  typeof PublicationDeliveryReceipt
>;

const PublicationChangeReceiptObject = z
  .object({
    ...PublicationReceiptCommonShape,
    receiptKind: z.literal("change_receipt"),
    predecessorDeliveryReceiptId: Uuid,
    remoteObjectKind: z.enum(["github_merge", "wordpress_revision"]),
    liveCanonicalUrl: PublicationHttpUrl,
    verificationState: z.literal("verified_live"),
    evidenceRefs: uniqueEvidenceRefs(1),
    limitation: z.null(),
  })
  .strict();

function validateChangeProvider(
  receipt: z.infer<typeof PublicationChangeReceiptObject>,
  ctx: z.RefinementCtx,
): void {
  const valid =
    (receipt.providerKind === "github" &&
      receipt.remoteObjectKind === "github_merge") ||
    (receipt.providerKind === "wordpress" &&
      receipt.remoteObjectKind === "wordpress_revision");
  if (!valid) {
    ctx.addIssue({
      code: "custom",
      path: ["remoteObjectKind"],
      message: "Change remote object kind must match providerKind",
    });
  }
}

export const PublicationChangeReceipt =
  PublicationChangeReceiptObject.superRefine(validateChangeProvider);
export type PublicationChangeReceipt = z.infer<
  typeof PublicationChangeReceipt
>;

export const PublicationReceipt = z
  .discriminatedUnion("receiptKind", [
    PublicationDeliveryReceiptObject,
    PublicationChangeReceiptObject,
  ])
  .superRefine((receipt, ctx) => {
    if (receipt.receiptKind === "delivery_receipt") {
      validateDeliveryProvider(receipt, ctx);
    } else {
      validateChangeProvider(receipt, ctx);
    }
  });
export type PublicationReceipt = z.infer<typeof PublicationReceipt>;

const PublicationAttemptCommonShape = {
  id: Uuid,
  asyncRunId: Uuid,
  siteId: Uuid,
  destinationRef: Uuid,
  destinationRevision: z.number().int().min(1),
  targetRef: TargetRef,
  actionId: Uuid,
  artifactId: Uuid,
  approvedArtifactRevision: z.number().int().min(1),
  approvedArtifactContentHash: ArtifactContentHash,
  providerKind: PublicationProviderKind,
  sideEffectClass: z.literal("external_write"),
  previewRef: OpaqueRef,
  previewChecksum: ArtifactContentHash,
  contentChecksum: ProviderContentChecksum,
  remotePrecondition: PublicationRemotePrecondition,
  rollbackPlan: PublicationRollbackPlan,
  authorizationGrantRef: Uuid,
  idempotencyKey: IdempotencyKey,
  requestHash: PublicationChecksum,
  state: PublicationState,
  receipts: z
    .array(PublicationReceipt)
    .max(2)
    .refine(
      (receipts) =>
        new Set(receipts.map((receipt) => receipt.receiptKind)).size ===
        receipts.length,
      { message: "Receipt kinds must be unique within one attempt" },
    ),
  requestedAt: IsoDateTime,
} as const;

const PublishPublicationAttempt = z
  .object({
    ...PublicationAttemptCommonShape,
    attemptKind: z.literal("publish"),
    sourcePublicationAttemptId: z.null(),
    sourceChangeReceiptId: z.null(),
    publicationApproval: ArtifactApprovalSnapshot,
    sourceApproval: z.null(),
    authorizationSnapshot: PublicationAuthorizationSnapshot,
  })
  .strict();

const RollbackPublicationAttempt = z
  .object({
    ...PublicationAttemptCommonShape,
    attemptKind: z.literal("rollback"),
    sourcePublicationAttemptId: Uuid,
    sourceChangeReceiptId: Uuid,
    publicationApproval: z.null(),
    sourceApproval: ArtifactApprovalSnapshot,
    authorizationSnapshot: PublicationAuthorizationSnapshot,
  })
  .strict();

export const PublicationAttempt = z
  .discriminatedUnion("attemptKind", [
    PublishPublicationAttempt,
    RollbackPublicationAttempt,
  ])
  .superRefine((attempt, ctx) => {
    const approval =
      attempt.attemptKind === "publish"
        ? attempt.publicationApproval
        : attempt.sourceApproval;
    const expectedPurpose =
      attempt.attemptKind === "publish" ? "publish" : "rollback";

    if (approval.artifactId !== attempt.artifactId) {
      ctx.addIssue({
        code: "custom",
        path: [
          attempt.attemptKind === "publish"
            ? "publicationApproval"
            : "sourceApproval",
          "artifactId",
        ],
        message: "Approval artifact must match the attempt artifact",
      });
    }
    if (
      approval.approvedArtifactRevision !==
        attempt.approvedArtifactRevision ||
      approval.approvedArtifactContentHash !==
        attempt.approvedArtifactContentHash
    ) {
      ctx.addIssue({
        code: "custom",
        path: [
          attempt.attemptKind === "publish"
            ? "publicationApproval"
            : "sourceApproval",
        ],
        message: "Approval revision and content hash must match the attempt",
      });
    }
    if (
      attempt.previewChecksum !== attempt.approvedArtifactContentHash
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["previewChecksum"],
        message:
          "Preview checksum must match the exact approved artifact content",
      });
    }
    if (
      attempt.authorizationSnapshot.destinationRef !==
        attempt.destinationRef ||
      attempt.authorizationSnapshot.destinationRevision !==
        attempt.destinationRevision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSnapshot"],
        message:
          "Authorization must bind the attempt destination and revision",
      });
    }
    if (attempt.authorizationSnapshot.purpose !== expectedPurpose) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSnapshot", "purpose"],
        message: `Attempt kind ${attempt.attemptKind} requires ${expectedPurpose} authorization`,
      });
    }
    if (attempt.rollbackPlan.providerKind !== attempt.providerKind) {
      ctx.addIssue({
        code: "custom",
        path: ["rollbackPlan", "providerKind"],
        message: "Rollback plan provider must match attempt provider",
      });
    }

    const deliveryIndex = attempt.receipts.findIndex(
      (receipt) => receipt.receiptKind === "delivery_receipt",
    );
    const changeIndex = attempt.receipts.findIndex(
      (receipt) => receipt.receiptKind === "change_receipt",
    );
    const delivery =
      deliveryIndex >= 0 ? attempt.receipts[deliveryIndex] : undefined;
    const change =
      changeIndex >= 0 ? attempt.receipts[changeIndex] : undefined;

    for (const [index, receipt] of attempt.receipts.entries()) {
      if (receipt.providerKind !== attempt.providerKind) {
        ctx.addIssue({
          code: "custom",
          path: ["receipts", index, "providerKind"],
          message: "Receipt provider must match the publication attempt",
        });
      }
      if (
        receipt.artifactContentHash !==
        attempt.approvedArtifactContentHash
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["receipts", index, "artifactContentHash"],
          message:
            "Receipt Artifact identity must match the approved Artifact content hash",
        });
      }
      if (receipt.contentChecksum !== attempt.contentChecksum) {
        ctx.addIssue({
          code: "custom",
          path: ["receipts", index, "contentChecksum"],
          message:
            "Receipt provider bytes must match the publication attempt content checksum",
        });
      }
    }

    if (change === undefined) {
      return;
    }
    if (delivery === undefined || delivery.receiptKind !== "delivery_receipt") {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "predecessorDeliveryReceiptId"],
        message: "A Change Receipt requires an embedded Delivery Receipt",
      });
      return;
    }
    if (change.receiptKind !== "change_receipt") {
      return;
    }
    if (change.predecessorDeliveryReceiptId !== delivery.id) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "predecessorDeliveryReceiptId"],
        message:
          "Change Receipt predecessor must reference the embedded Delivery Receipt",
      });
    }
    if (change.providerKind !== delivery.providerKind) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "providerKind"],
        message: "Delivery and Change Receipt providers must match",
      });
    }
    if (change.contentChecksum !== delivery.contentChecksum) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "contentChecksum"],
        message: "Delivery and Change Receipt checksums must match",
      });
    }
    if (
      change.artifactContentHash !== delivery.artifactContentHash
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "artifactContentHash"],
        message:
          "Delivery and Change Receipt Artifact identities must match",
      });
    }
    if (change.remoteScopeRef !== delivery.remoteScopeRef) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "remoteScopeRef"],
        message: "Delivery and Change Receipt remote scopes must match",
      });
    }
    if (
      Date.parse(change.observedAt) <= Date.parse(delivery.observedAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["receipts", changeIndex, "observedAt"],
        message:
          "Change Receipt observedAt must be strictly later than Delivery Receipt observedAt",
      });
    }
  });
export type PublicationAttempt = z.infer<typeof PublicationAttempt>;

// Candidate-compatible public aliases.
export const ReceiptKind = PublicationReceiptKind;
export type ReceiptKind = PublicationReceiptKind;
export const RemotePrecondition = PublicationRemotePrecondition;
export type RemotePrecondition = PublicationRemotePrecondition;
export const RollbackPlan = PublicationRollbackPlan;
export type RollbackPlan = PublicationRollbackPlan;
