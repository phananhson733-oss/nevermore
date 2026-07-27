import { z } from "zod";
import {
  CustomerAcknowledgement,
  CustomerAcknowledgementInput,
  CustomerAcknowledgementScope,
} from "./artifact-approval.ts";
import { IsoDateTime, Uuid } from "./common.ts";

const nonEmptyText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

const CANONICAL_GITHUB_PERMISSIONS = [
  "metadata_read",
  "contents_read",
  "contents_write",
  "pull_requests_write",
] as const;

const uniqueArray = <T extends z.ZodType>(
  item: T,
  minimum: number,
  maximum: number,
) =>
  z
    .array(item)
    .min(minimum)
    .max(maximum)
    .refine((items) => new Set(items).size === items.length, {
      message: "Items must be unique",
    });

/** HTTP(S), bounded, and without embedded credentials. */
export const PublicationHttpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === ""
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "Publication URLs must use HTTP(S) and must not contain embedded credentials",
    },
  );
export type PublicationHttpUrl = z.infer<typeof PublicationHttpUrl>;

export const PublicationProviderKind = z.enum(["github", "wordpress"]);
export type PublicationProviderKind = z.infer<
  typeof PublicationProviderKind
>;

export const PublicationDestinationState = z.enum([
  "pending",
  "ready",
  "unavailable",
  "revoked",
]);
export type PublicationDestinationState = z.infer<
  typeof PublicationDestinationState
>;

export const DeliveryAuthorizationGrantState = z.enum([
  "ready",
  "consumed",
  "revoked",
  "expired",
]);
export type DeliveryAuthorizationGrantState = z.infer<
  typeof DeliveryAuthorizationGrantState
>;

export const DeliveryAuthorizationGrantPurpose = z.enum([
  "connector_configuration",
  "publish",
  "rollback",
]);
export type DeliveryAuthorizationGrantPurpose = z.infer<
  typeof DeliveryAuthorizationGrantPurpose
>;

export const PublicationAuthorizationPurpose =
  DeliveryAuthorizationGrantPurpose;
export type PublicationAuthorizationPurpose = z.infer<
  typeof PublicationAuthorizationPurpose
>;

const acknowledgementScopeForPurpose: Record<
  PublicationAuthorizationPurpose,
  CustomerAcknowledgementScope
> = {
  connector_configuration: "connector_configuration",
  publish: "exact_artifact_revision_for_publication",
  rollback: "rollback_preview",
};

export const PublicationAuthorizationSnapshot = z
  .object({
    authorizationId: Uuid,
    actorId: Uuid,
    grantedAt: IsoDateTime,
    expiresAt: IsoDateTime.nullable(),
    scopes: uniqueArray(nonEmptyText(200), 1, 50),
    destinationRef: Uuid,
    destinationRevision: z.number().int().min(1),
    purpose: PublicationAuthorizationPurpose,
    customerAcknowledgement: CustomerAcknowledgement,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const expected =
      acknowledgementScopeForPurpose[snapshot.purpose];
    if (
      snapshot.customerAcknowledgement.acknowledgementScope !== expected
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["customerAcknowledgement", "acknowledgementScope"],
        message: `Authorization purpose ${snapshot.purpose} requires acknowledgement scope ${expected}`,
      });
    }
  });
export type PublicationAuthorizationSnapshot = z.infer<
  typeof PublicationAuthorizationSnapshot
>;

export const GitHubPublicationDestinationSelection = z
  .object({
    providerKind: z.literal("github"),
    repositoryId: z.number().int().min(1),
    baseBranch: nonEmptyText(255),
    branchPrefix: nonEmptyText(200),
    contentPath: nonEmptyText(1024),
  })
  .strict();
export type GitHubPublicationDestinationSelection = z.infer<
  typeof GitHubPublicationDestinationSelection
>;

export const WordPressPublicationDestinationSelection = z
  .object({
    providerKind: z.literal("wordpress"),
    postType: nonEmptyText(100),
    authorAllowlist: uniqueArray(z.number().int().min(1), 1, 100),
    statusAllowlist: uniqueArray(
      z.enum(["draft", "future", "publish"]),
      1,
      3,
    ),
  })
  .strict();
export type WordPressPublicationDestinationSelection = z.infer<
  typeof WordPressPublicationDestinationSelection
>;

export const PublicationDestinationSelection = z.discriminatedUnion(
  "providerKind",
  [
    GitHubPublicationDestinationSelection,
    WordPressPublicationDestinationSelection,
  ],
);
export type PublicationDestinationSelection = z.infer<
  typeof PublicationDestinationSelection
>;

export const GitHubPublicationDestinationScope = z
  .object({
    providerKind: z.literal("github"),
    installationId: z.number().int().min(1),
    repositoryId: z.number().int().min(1),
    repositoryOwner: nonEmptyText(100),
    repositoryName: nonEmptyText(100),
    baseBranch: nonEmptyText(255),
    branchPrefix: nonEmptyText(200),
    contentPath: nonEmptyText(1024),
    grantedPermissions: z
      .array(z.enum(CANONICAL_GITHUB_PERMISSIONS))
      .length(CANONICAL_GITHUB_PERMISSIONS.length)
      .refine(
        (permissions) =>
          CANONICAL_GITHUB_PERMISSIONS.every((permission) =>
            permissions.includes(permission),
          ),
        {
          message:
            "GitHub scope requires all canonical publication permissions",
        },
      ),
  })
  .strict();
export type GitHubPublicationDestinationScope = z.infer<
  typeof GitHubPublicationDestinationScope
>;

export const WordPressPublicationDestinationScope = z
  .object({
    providerKind: z.literal("wordpress"),
    siteBaseUrl: PublicationHttpUrl,
    authenticatedUserId: z.number().int().min(1),
    postType: nonEmptyText(100),
    authorAllowlist: uniqueArray(z.number().int().min(1), 1, 100),
    statusAllowlist: uniqueArray(
      z.enum(["draft", "future", "publish"]),
      1,
      3,
    ),
    capabilities: uniqueArray(nonEmptyText(100), 1, 20),
  })
  .strict();
export type WordPressPublicationDestinationScope = z.infer<
  typeof WordPressPublicationDestinationScope
>;

export const PublicationDestinationScope = z.discriminatedUnion(
  "providerKind",
  [GitHubPublicationDestinationScope, WordPressPublicationDestinationScope],
);
export type PublicationDestinationScope = z.infer<
  typeof PublicationDestinationScope
>;

export const GitHubDeliveryAuthorizationGrantProviderScope =
  GitHubPublicationDestinationScope.extend({
    githubAccountId: z.number().int().min(1),
  });
export type GitHubDeliveryAuthorizationGrantProviderScope = z.infer<
  typeof GitHubDeliveryAuthorizationGrantProviderScope
>;

export const WordPressDeliveryAuthorizationGrantProviderScope =
  WordPressPublicationDestinationScope;
export type WordPressDeliveryAuthorizationGrantProviderScope = z.infer<
  typeof WordPressDeliveryAuthorizationGrantProviderScope
>;

export const DeliveryAuthorizationGrantProviderScope =
  z.discriminatedUnion("providerKind", [
    GitHubDeliveryAuthorizationGrantProviderScope,
    WordPressDeliveryAuthorizationGrantProviderScope,
  ]);
export type DeliveryAuthorizationGrantProviderScope = z.infer<
  typeof DeliveryAuthorizationGrantProviderScope
>;

const ConnectorConfigurationAcknowledgementInput =
  CustomerAcknowledgementInput.extend({
    acknowledgementScope: z.literal("connector_configuration"),
  });
const PublishGrantAcknowledgementInput =
  CustomerAcknowledgementInput.extend({
    acknowledgementScope: z.literal(
      "exact_artifact_revision_for_publication",
    ),
  });
const RollbackGrantAcknowledgementInput =
  CustomerAcknowledgementInput.extend({
    acknowledgementScope: z.literal("rollback_preview"),
  });

/**
 * Opaque GitHub App setup callback intent. Account and permission facts are
 * resolved by the service and are intentionally absent here.
 */
export const GitHubInstallationCallbackRequest = z
  .object({
    providerKind: z.literal("github"),
    installationId: z.number().int().min(1),
    setupAction: z.enum(["install", "update"]),
    callbackState: nonEmptyText(1024),
  })
  .strict();
export type GitHubInstallationCallbackRequest = z.infer<
  typeof GitHubInstallationCallbackRequest
>;

/**
 * A repository selection to probe. The request expresses intent only and
 * cannot assert provider permissions or probe results.
 */
export const GitHubAuthorizationProbeIntent = z
  .object({
    providerKind: z.literal("github"),
    installationId: z.number().int().min(1),
    requestedScope: GitHubPublicationDestinationSelection,
  })
  .strict();
export type GitHubAuthorizationProbeIntent = z.infer<
  typeof GitHubAuthorizationProbeIntent
>;

const GrantDestinationBindingShape = {
  siteId: Uuid,
  destinationRef: Uuid,
  destinationRevision: z.number().int().min(1),
  targetRef: nonEmptyText(2048),
} as const;

export const ConnectGitHubDeliveryAuthorizationGrantRequest = z
  .object({
    purpose: z.literal("connector_configuration"),
    ...GrantDestinationBindingShape,
    callback: GitHubInstallationCallbackRequest,
    probeIntent: GitHubAuthorizationProbeIntent,
    customerAcknowledgementInput:
      ConnectorConfigurationAcknowledgementInput,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      request.callback.installationId !==
      request.probeIntent.installationId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["probeIntent", "installationId"],
        message:
          "GitHub callback and permission probe must bind one installation",
      });
    }
  });
export type ConnectGitHubDeliveryAuthorizationGrantRequest = z.infer<
  typeof ConnectGitHubDeliveryAuthorizationGrantRequest
>;

export const WordPressOneTimeCredentialInput = z
  .object({
    username: nonEmptyText(320),
    applicationPassword: z
      .string()
      .min(12)
      .max(512)
      .refine((value) => value.trim().length >= 12, {
        message: "Application password must contain at least 12 characters",
      }),
  })
  .strict();
export type WordPressOneTimeCredentialInput = z.infer<
  typeof WordPressOneTimeCredentialInput
>;

export const WordPressAuthorizationProbeIntent = z
  .object({
    providerKind: z.literal("wordpress"),
    siteBaseUrl: PublicationHttpUrl,
    postType: nonEmptyText(100),
    authorAllowlist: uniqueArray(z.number().int().min(1), 1, 100),
    statusAllowlist: uniqueArray(
      z.enum(["draft", "future", "publish"]),
      1,
      3,
    ),
  })
  .strict();
export type WordPressAuthorizationProbeIntent = z.infer<
  typeof WordPressAuthorizationProbeIntent
>;

/**
 * The sole public contract that accepts a WordPress application password.
 * The service consumes it once and never returns it from a DTO or receipt.
 */
export const ConnectWordPressDeliveryAuthorizationGrantRequest = z
  .object({
    purpose: z.literal("connector_configuration"),
    ...GrantDestinationBindingShape,
    requestedScope: WordPressAuthorizationProbeIntent,
    credentialInput: WordPressOneTimeCredentialInput,
    customerAcknowledgementInput:
      ConnectorConfigurationAcknowledgementInput,
  })
  .strict();
export type ConnectWordPressDeliveryAuthorizationGrantRequest = z.infer<
  typeof ConnectWordPressDeliveryAuthorizationGrantRequest
>;

const PublicationGrantDestinationBindingShape = {
  siteId: Uuid,
  destinationRef: Uuid,
  expectedDestinationRevision: z.number().int().min(1),
  targetRef: nonEmptyText(2048),
} as const;

const IssuePublishAuthorizationGrantRequest = z
  .object({
    ...PublicationGrantDestinationBindingShape,
    purpose: z.literal("publish"),
    approvalEventId: Uuid,
    customerAcknowledgementInput: PublishGrantAcknowledgementInput,
  })
  .strict();

const IssueRollbackAuthorizationGrantRequest = z
  .object({
    ...PublicationGrantDestinationBindingShape,
    purpose: z.literal("rollback"),
    sourcePublicationAttemptId: Uuid,
    sourceChangeReceiptId: Uuid,
    customerAcknowledgementInput: RollbackGrantAcknowledgementInput,
  })
  .strict();

export const IssuePublicationAuthorizationGrantRequest =
  z.discriminatedUnion("purpose", [
    IssuePublishAuthorizationGrantRequest,
    IssueRollbackAuthorizationGrantRequest,
  ]);
export type IssuePublicationAuthorizationGrantRequest = z.infer<
  typeof IssuePublicationAuthorizationGrantRequest
>;

const DeliveryAuthorizationGrantCommonShape = {
  authorizationGrantRef: Uuid,
  siteId: Uuid,
  providerKind: PublicationProviderKind,
  purpose: DeliveryAuthorizationGrantPurpose,
  providerScope: DeliveryAuthorizationGrantProviderScope,
  destinationRef: Uuid.nullable(),
  destinationRevision: z.number().int().min(1).nullable(),
  targetRef: nonEmptyText(2048).nullable(),
  expiresAt: IsoDateTime.nullable(),
  createdBy: Uuid,
  createdAt: IsoDateTime,
} as const;

const ReadyDeliveryAuthorizationGrant = z
  .object({
    ...DeliveryAuthorizationGrantCommonShape,
    state: z.literal("ready"),
    consumedAt: z.null(),
    revokedAt: z.null(),
    revokedBy: z.null(),
    revocationReason: z.null(),
  })
  .strict();

const ConsumedDeliveryAuthorizationGrant = z
  .object({
    ...DeliveryAuthorizationGrantCommonShape,
    state: z.literal("consumed"),
    consumedAt: IsoDateTime,
    revokedAt: z.null(),
    revokedBy: z.null(),
    revocationReason: z.null(),
  })
  .strict();

const RevokedDeliveryAuthorizationGrant = z
  .object({
    ...DeliveryAuthorizationGrantCommonShape,
    state: z.literal("revoked"),
    consumedAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime,
    revokedBy: Uuid,
    revocationReason: nonEmptyText(1000),
  })
  .strict();

const ExpiredDeliveryAuthorizationGrant = z
  .object({
    ...DeliveryAuthorizationGrantCommonShape,
    state: z.literal("expired"),
    expiresAt: IsoDateTime,
    consumedAt: z.null(),
    revokedAt: z.null(),
    revokedBy: z.null(),
    revocationReason: z.null(),
  })
  .strict();

/**
 * Public redacted grant DTO. Ciphertext, KMS metadata, authorization snapshots
 * and hashes remain internal persistence facts.
 */
export const DeliveryAuthorizationGrant = z
  .discriminatedUnion("state", [
    ReadyDeliveryAuthorizationGrant,
    ConsumedDeliveryAuthorizationGrant,
    RevokedDeliveryAuthorizationGrant,
    ExpiredDeliveryAuthorizationGrant,
  ])
  .superRefine((grant, ctx) => {
    if (grant.providerKind !== grant.providerScope.providerKind) {
      ctx.addIssue({
        code: "custom",
        path: ["providerScope", "providerKind"],
        message: "Grant provider scope must match providerKind",
      });
    }

    const bindingPresence = [
      grant.destinationRef,
      grant.destinationRevision,
      grant.targetRef,
    ].map((value) => value !== null);
    if (
      bindingPresence.some(Boolean) &&
      !bindingPresence.every(Boolean)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["destinationRef"],
        message:
          "Grant destinationRef, destinationRevision and targetRef must be all null or all present",
      });
    }
    if (
      grant.purpose !== "connector_configuration" &&
      !bindingPresence.every(Boolean)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["destinationRef"],
        message: "Publish and rollback grants require a destination binding",
      });
    }
    if (
      grant.purpose !== "connector_configuration" &&
      grant.expiresAt === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Publish and rollback grants require an expiry",
      });
    }
  });
export type DeliveryAuthorizationGrant = z.infer<
  typeof DeliveryAuthorizationGrant
>;

export const ConsumeDeliveryAuthorizationGrantResponse = z
  .object({
    authorizationGrantRef: Uuid,
    providerKind: PublicationProviderKind,
    purpose: DeliveryAuthorizationGrantPurpose,
    state: z.literal("consumed"),
    destinationRef: Uuid,
    destinationRevision: z.number().int().min(1),
    targetRef: nonEmptyText(2048),
    consumedAt: IsoDateTime,
  })
  .strict();
export type ConsumeDeliveryAuthorizationGrantResponse = z.infer<
  typeof ConsumeDeliveryAuthorizationGrantResponse
>;

export const RevokeDeliveryAuthorizationGrantRequest = z
  .object({
    authorizationGrantRef: Uuid,
    reason: nonEmptyText(1000),
  })
  .strict();
export type RevokeDeliveryAuthorizationGrantRequest = z.infer<
  typeof RevokeDeliveryAuthorizationGrantRequest
>;

export const RevokeDeliveryAuthorizationGrantResponse = z
  .object({
    authorizationGrantRef: Uuid,
    providerKind: PublicationProviderKind,
    purpose: DeliveryAuthorizationGrantPurpose,
    state: z.literal("revoked"),
    consumedAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime,
    revokedBy: Uuid,
    revocationReason: nonEmptyText(1000),
  })
  .strict();
export type RevokeDeliveryAuthorizationGrantResponse = z.infer<
  typeof RevokeDeliveryAuthorizationGrantResponse
>;

/**
 * Client intent only. Resolved provider scope, secret references, capability
 * facts and authorization snapshots are generated and retained by the
 * service. A client can submit only a server-issued opaque grant UUID.
 */
export const AppendPublicationDestinationRevisionRequest = z
  .object({
    siteId: Uuid,
    destinationRef: Uuid,
    baseRevision: z.number().int().min(0),
    targetRef: nonEmptyText(2048),
    providerKind: PublicationProviderKind,
    requestedScope: PublicationDestinationSelection,
    authorizationGrantRef: Uuid,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.providerKind !== request.requestedScope.providerKind) {
      ctx.addIssue({
        code: "custom",
        path: ["requestedScope", "providerKind"],
        message: "Requested scope must match providerKind",
      });
    }
  });
export type AppendPublicationDestinationRevisionRequest = z.infer<
  typeof AppendPublicationDestinationRevisionRequest
>;

export const RevokePublicationDestinationRequest = z
  .object({
    baseRevision: z.number().int().min(1),
    reason: nonEmptyText(1000),
  })
  .strict();
export type RevokePublicationDestinationRequest = z.infer<
  typeof RevokePublicationDestinationRequest
>;

export const PublicationDestination = z
  .object({
    id: Uuid,
    destinationRef: Uuid,
    revision: z.number().int().min(1),
    siteId: Uuid,
    providerKind: PublicationProviderKind,
    targetRef: nonEmptyText(2048),
    state: PublicationDestinationState,
    providerScope: PublicationDestinationScope,
    authorizationSnapshot: PublicationAuthorizationSnapshot,
    readinessObservation: z.record(
      z.string().trim().min(1).max(200),
      z.unknown(),
    ),
    limitation: nonEmptyText(2000).nullable(),
    createdAt: IsoDateTime,
  })
  .strict()
  .superRefine((destination, ctx) => {
    if (destination.providerKind !== destination.providerScope.providerKind) {
      ctx.addIssue({
        code: "custom",
        path: ["providerScope", "providerKind"],
        message: "Provider scope must match providerKind",
      });
    }
    if (
      destination.authorizationSnapshot.destinationRef !==
      destination.destinationRef
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSnapshot", "destinationRef"],
        message: "Authorization must bind the same destinationRef",
      });
    }
    if (
      destination.authorizationSnapshot.destinationRevision !==
      destination.revision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSnapshot", "destinationRevision"],
        message: "Authorization must bind the same destination revision",
      });
    }
    if (
      destination.authorizationSnapshot.purpose !==
      "connector_configuration"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSnapshot", "purpose"],
        message:
          "Destination revision requires connector_configuration authorization",
      });
    }
    if (destination.state === "ready" && destination.limitation !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "A ready destination cannot carry a limitation",
      });
    }
  });
export type PublicationDestination = z.infer<typeof PublicationDestination>;

// Candidate-compatible public aliases.
export const ProviderKind = PublicationProviderKind;
export type ProviderKind = PublicationProviderKind;
export const DestinationState = PublicationDestinationState;
export type DestinationState = PublicationDestinationState;
export const AuthorizationSnapshot = PublicationAuthorizationSnapshot;
export type AuthorizationSnapshot = PublicationAuthorizationSnapshot;
export const GitHubDestinationSelection =
  GitHubPublicationDestinationSelection;
export type GitHubDestinationSelection =
  GitHubPublicationDestinationSelection;
export const WordPressDestinationSelection =
  WordPressPublicationDestinationSelection;
export type WordPressDestinationSelection =
  WordPressPublicationDestinationSelection;
export const GitHubDestinationScope = GitHubPublicationDestinationScope;
export type GitHubDestinationScope = GitHubPublicationDestinationScope;
export const WordPressDestinationScope =
  WordPressPublicationDestinationScope;
export type WordPressDestinationScope =
  WordPressPublicationDestinationScope;
