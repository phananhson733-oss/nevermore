import { createHash } from "node:crypto";
import {
  PublicationAuthorizationSnapshot,
  PublicationRemotePrecondition,
  Uuid,
} from "@sf/contracts";
import {
  createGitHubPublishingAdapter,
  createWordPressPublishingAdapter,
  isPublishingProviderError,
  type BoundedTransportOptions,
  type GitHubDestinationScope,
  type GitHubInstallationToken,
  type GitHubPublishingAdapter,
  type GitHubRemotePrecondition,
  type WordPressCredential,
  type WordPressDeliveryStatus,
  type WordPressDestinationScope,
  type WordPressPublishingAdapter,
  type WordPressRemotePrecondition,
} from "@sf/publishing";
import { z } from "zod";

const PUBLICATION_EXECUTION_SCHEMA_VERSION = "publication-execution.1";
const PUBLICATION_RUNTIME_UNAVAILABLE =
  "Socket-pinned provider transport or credential issuer is unavailable.";
const PUBLICATION_FACTS_INVALID =
  "Frozen publication authority no longer matches the approved destination, grant, artifact, or remote precondition.";
const PUBLICATION_CHECKSUM_INVALID =
  "Provider observation is not bound to the exact approved artifact checksum.";
const PUBLICATION_PROVIDER_UNAVAILABLE =
  "The provider did not return a verifiable publication observation.";
const PUBLICATION_PROJECT_ARCHIVED =
  "Project was archived after publication acceptance; no provider write was attempted.";

const Checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const NonEmpty = z.string().trim().min(1);
const PositiveInteger = z.number().int().min(1);

const GitHubScopeSchema = z
  .object({
    installationId: PositiveInteger,
    repositoryId: PositiveInteger,
    owner: NonEmpty.max(100),
    repository: NonEmpty.max(100),
    baseBranch: NonEmpty.max(255),
    allowedBranchPrefix: NonEmpty.max(200),
    contentPath: NonEmpty.max(1024),
  })
  .strict();

const GitHubPreconditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("must_not_exist") }).strict(),
  z
    .object({
      kind: z.literal("match"),
      branchHeadSha: NonEmpty.max(512),
      contentSha: NonEmpty.max(512),
    })
    .strict(),
]);

const WordPressScopeSchema = z
  .object({
    siteOrigin: z.string().url().max(2048),
    authenticatedUserId: PositiveInteger,
    allowedAuthorIds: z.array(PositiveInteger).min(1).max(100),
    allowedStatuses: z
      .array(z.enum(["draft", "future"]))
      .min(1)
      .max(2),
    allowedPostTypes: z.array(NonEmpty.max(100)).min(1).max(100),
  })
  .strict();

const WordPressPreconditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("must_not_exist") }).strict(),
  z
    .object({
      kind: z.literal("match"),
      revision: NonEmpty.max(512),
    })
    .strict(),
]);

const GitHubPlanSchema = z
  .object({
    providerKind: z.literal("github"),
    phase: z.literal("deliver"),
    scope: GitHubScopeSchema,
    branchName: NonEmpty.max(255),
    path: NonEmpty.max(1024),
    content: z.string().min(1),
    commitMessage: NonEmpty.max(500),
    pullRequest: z
      .object({
        title: NonEmpty.max(500),
        body: z.string().max(20_000),
      })
      .strict(),
    remotePrecondition: GitHubPreconditionSchema,
  })
  .strict();

const WordPressPlanSchema = z
  .object({
    providerKind: z.literal("wordpress"),
    phase: z.literal("deliver"),
    scope: WordPressScopeSchema,
    postId: PositiveInteger.optional(),
    postType: NonEmpty.max(100),
    title: NonEmpty.max(500),
    slug: NonEmpty.max(500),
    content: z.string().min(1),
    excerpt: z.string().max(20_000).optional(),
    authorId: PositiveInteger,
    status: z.enum(["draft", "future"]),
    scheduledAt: z.string().datetime().optional(),
    canonicalExpectation: z.string().url().max(2048),
    remotePrecondition: WordPressPreconditionSchema,
    explicitPublish: z
      .object({
        expectedCanonicalUrl: z.string().url().max(2048),
      })
      .strict()
      .nullable(),
  })
  .strict();

const ExecutionFactsSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_EXECUTION_SCHEMA_VERSION),
    run: z
      .object({
        id: Uuid,
        attemptCount: PositiveInteger,
      })
      .strict(),
    attempt: z
      .object({
        id: Uuid,
        attemptKind: z.enum(["publish", "rollback"]),
        runId: Uuid,
        workspaceId: Uuid,
        projectId: Uuid,
        siteId: Uuid,
        destinationId: Uuid,
        destinationRef: Uuid,
        destinationRevision: PositiveInteger,
        providerKind: z.enum(["github", "wordpress"]),
        targetRef: NonEmpty.max(2048),
        actionId: Uuid,
        artifactId: Uuid,
        artifactRevisionId: Uuid,
        approvedArtifactRevision: PositiveInteger,
        approvedArtifactContentHash: Checksum,
        contentChecksum: Checksum,
        approvalEventId: Uuid,
        authorizationGrantId: Uuid,
        authorizationPurpose: z.enum(["publish", "rollback"]),
        previewChecksum: Checksum,
        remotePrecondition: PublicationRemotePrecondition,
      })
      .strict(),
    destination: z
      .object({
        id: Uuid,
        destinationRef: Uuid,
        revision: PositiveInteger,
        siteId: Uuid,
        providerKind: z.enum(["github", "wordpress"]),
        targetRef: NonEmpty.max(2048),
        state: z.literal("ready"),
      })
      .strict(),
    authorization: z
      .object({
        id: Uuid,
        state: z.literal("consumed"),
        siteId: Uuid,
        providerKind: z.enum(["github", "wordpress"]),
        purpose: z.enum(["publish", "rollback"]),
        destinationRef: Uuid,
        destinationRevision: PositiveInteger,
        targetRef: NonEmpty.max(2048),
        expiresAt: z.string().datetime(),
        consumedAt: z.string().datetime(),
        snapshot: PublicationAuthorizationSnapshot,
      })
      .strict(),
    approval: z
      .object({
        id: Uuid,
        eventKind: z.literal("approved"),
        artifactId: Uuid,
        artifactRevisionId: Uuid,
        artifactRevision: PositiveInteger,
        artifactContentHash: Checksum,
      })
      .strict(),
    artifact: z
      .object({
        id: Uuid,
        revisionId: Uuid,
        revision: PositiveInteger,
        contentHash: Checksum,
        contentText: z.string().min(1),
      })
      .strict(),
    plan: z.discriminatedUnion("providerKind", [
      GitHubPlanSchema,
      WordPressPlanSchema,
    ]),
  })
  .strict();

const ArchivedExecutionSchema = z
  .object({
    schemaVersion: z.literal(
      "publication-execution-unavailable.1",
    ),
    code: z.literal("PUBLICATION_PROJECT_ARCHIVED"),
    limitation: z.literal(PUBLICATION_PROJECT_ARCHIVED),
  })
  .strict();

export interface PublicationJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contractVersion?: string;
}

export type GitHubPublicationPlan = z.infer<typeof GitHubPlanSchema>;
export type WordPressPublicationPlan = z.infer<
  typeof WordPressPlanSchema
>;
export type PublicationPlan =
  | GitHubPublicationPlan
  | WordPressPublicationPlan;

export interface PublicationExecutionFacts {
  readonly schemaVersion: "publication-execution.1";
  readonly run: {
    readonly id: string;
    readonly attemptCount: number;
  };
  readonly attempt: {
    readonly id: string;
    readonly attemptKind: "publish" | "rollback";
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly siteId: string;
    readonly destinationId: string;
    readonly destinationRef: string;
    readonly destinationRevision: number;
    readonly providerKind: "github" | "wordpress";
    readonly targetRef: string;
    readonly actionId: string;
    readonly artifactId: string;
    readonly artifactRevisionId: string;
    readonly approvedArtifactRevision: number;
    readonly approvedArtifactContentHash: string;
    readonly contentChecksum: string;
    readonly approvalEventId: string;
    readonly authorizationGrantId: string;
    readonly authorizationPurpose: "publish" | "rollback";
    readonly previewChecksum: string;
    readonly remotePrecondition: z.infer<
      typeof PublicationRemotePrecondition
    >;
  };
  readonly destination: {
    readonly id: string;
    readonly destinationRef: string;
    readonly revision: number;
    readonly siteId: string;
    readonly providerKind: "github" | "wordpress";
    readonly targetRef: string;
    readonly state: "ready";
  };
  readonly authorization: {
    readonly id: string;
    readonly state: "consumed";
    readonly siteId: string;
    readonly providerKind: "github" | "wordpress";
    readonly purpose: "publish" | "rollback";
    readonly destinationRef: string;
    readonly destinationRevision: number;
    readonly targetRef: string;
    readonly expiresAt: string;
    readonly consumedAt: string;
    readonly snapshot: z.infer<
      typeof PublicationAuthorizationSnapshot
    >;
  };
  readonly approval: {
    readonly id: string;
    readonly eventKind: "approved";
    readonly artifactId: string;
    readonly artifactRevisionId: string;
    readonly artifactRevision: number;
    readonly artifactContentHash: string;
  };
  readonly artifact: {
    readonly id: string;
    readonly revisionId: string;
    readonly revision: number;
    readonly contentHash: string;
    readonly contentText: string;
  };
  readonly plan: PublicationPlan;
}

export interface PublicationReceiptWrite {
  readonly receiptKind: "delivery_receipt" | "change_receipt";
  readonly predecessorDeliveryReceiptId: string | null;
  readonly providerKind: "github" | "wordpress";
  readonly providerRequestId: string | null;
  readonly remoteScopeRef: string;
  readonly remoteObjectKind:
    | "github_pull_request"
    | "github_merge"
    | "wordpress_post"
    | "wordpress_revision";
  readonly remoteObjectId: string;
  readonly remoteRevision: string;
  readonly deliveryUrl: string | null;
  readonly liveCanonicalUrl: string | null;
  readonly artifactContentHash: string;
  readonly contentChecksum: string;
  readonly verificationState:
    | "provider_accepted"
    | "pending"
    | "verified_live"
    | "unavailable";
  readonly remoteFacts: Readonly<Record<string, unknown>>;
  readonly evidenceRefs: readonly string[];
  readonly limitation: string | null;
  readonly observedAt: string;
}

export interface PublicationExecutionAuthority {
  /**
   * Returns only a server-built, project-scoped snapshot. Queue payloads carry
   * correlation ids and never carry provider scope, content, or credentials.
   */
  load(payload: PublicationJobPayload): Promise<unknown>;
  /**
   * Appends one idempotent delivery receipt. When terminal is true the same
   * transaction must also complete the fenced canonical async-run attempt.
   */
  recordDelivery(input: {
    readonly execution: PublicationExecutionFacts;
    readonly receipt: PublicationReceiptWrite;
    readonly terminal: boolean;
  }): Promise<{ readonly receiptId: string }>;
  /** Append a verified change receipt and terminalize in one transaction. */
  recordChange(input: {
    readonly execution: PublicationExecutionFacts;
    readonly predecessorDeliveryReceiptId: string;
    readonly receipt: PublicationReceiptWrite;
  }): Promise<void>;
  /**
   * Before a delivery exists this appends an unavailable delivery receipt and
   * fails the run atomically. After a delivery exists it fails only the run:
   * immutable delivery lineage must not be overwritten or fabricated.
   */
  recordUnavailable(input: {
    readonly payload: PublicationJobPayload;
    readonly execution: PublicationExecutionFacts | null;
    readonly predecessorDeliveryReceiptId: string | null;
    readonly code:
      | "PUBLICATION_RUNTIME_UNAVAILABLE"
      | "PUBLICATION_FROZEN_FACTS_INVALID"
      | "PUBLICATION_CHECKSUM_MISMATCH"
      | "PUBLICATION_PROVIDER_UNAVAILABLE"
      | "PUBLICATION_PROJECT_ARCHIVED";
    readonly limitation: string;
    readonly observedAt: string;
  }): Promise<void>;
}

export interface GitHubTokenIssuer {
  (input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly authorizationGrantId: string;
    readonly installationId: number;
    readonly destinationRef: string;
    readonly destinationRevision: number;
  }): Promise<GitHubInstallationToken>;
}

export interface WordPressCredentialIssuer {
  (input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly authorizationGrantId: string;
    readonly destinationRef: string;
    readonly destinationRevision: number;
    readonly siteOrigin: string;
  }): Promise<WordPressCredential>;
}

export interface PublicationProviderRuntime {
  readonly github?: {
    readonly issueToken: GitHubTokenIssuer;
    readonly adapter: GitHubPublishingAdapter;
  };
  readonly wordpress?: {
    readonly issueCredential: WordPressCredentialIssuer;
    readonly adapter: WordPressPublishingAdapter;
  };
}

/**
 * The only production adapter factory. `BoundedTransportOptions.fetch` is a
 * socket-pinned fetch whose third argument is the resolver-attested endpoint;
 * no ordinary/global fetch fallback exists.
 */
export function createPublicationProviderRuntime(input: {
  readonly transport: BoundedTransportOptions;
  readonly githubTokenIssuer?: GitHubTokenIssuer;
  readonly wordpressCredentialIssuer?: WordPressCredentialIssuer;
}): PublicationProviderRuntime {
  return {
    ...(input.githubTokenIssuer
      ? {
          github: {
            issueToken: input.githubTokenIssuer,
            adapter: createGitHubPublishingAdapter(input.transport),
          },
        }
      : {}),
    ...(input.wordpressCredentialIssuer
      ? {
          wordpress: {
            issueCredential: input.wordpressCredentialIssuer,
            adapter: createWordPressPublishingAdapter(input.transport),
          },
        }
      : {}),
  };
}

export interface RunPublicationDependencies {
  readonly authority: PublicationExecutionAuthority;
  readonly runtime: PublicationProviderRuntime;
  readonly now: () => Date;
}

export async function runPublication(
  payload: PublicationJobPayload,
  dependencies: RunPublicationDependencies,
): Promise<void> {
  const loaded = await dependencies.authority.load(payload);
  const archived = ArchivedExecutionSchema.safeParse(loaded);
  if (archived.success) {
    await dependencies.authority.recordUnavailable({
      payload,
      execution: null,
      predecessorDeliveryReceiptId: null,
      code: archived.data.code,
      limitation: archived.data.limitation,
      observedAt: dependencies.now().toISOString(),
    });
    return;
  }
  const parsed = ExecutionFactsSchema.safeParse(loaded);
  if (
    !parsed.success ||
    !lineageIsExact(parsed.data, payload)
  ) {
    await dependencies.authority.recordUnavailable({
      payload,
      execution: null,
      predecessorDeliveryReceiptId: null,
      code: "PUBLICATION_FROZEN_FACTS_INVALID",
      limitation: PUBLICATION_FACTS_INVALID,
      observedAt: dependencies.now().toISOString(),
    });
    return;
  }
  const execution = parsed.data as PublicationExecutionFacts;

  if (execution.attempt.attemptKind !== "publish") {
    await unavailable(
      dependencies,
      payload,
      execution,
      null,
      "PUBLICATION_PROVIDER_UNAVAILABLE",
      "The frozen rollback strategy is not executable by the installed provider adapter.",
    );
    return;
  }

  if (execution.plan.providerKind === "github") {
    await deliverGitHub(payload, execution, dependencies);
    return;
  }
  await deliverWordPress(payload, execution, dependencies);
}

async function deliverGitHub(
  payload: PublicationJobPayload,
  execution: PublicationExecutionFacts,
  dependencies: RunPublicationDependencies,
): Promise<void> {
  if (execution.plan.providerKind !== "github") return;
  const runtime = dependencies.runtime.github;
  if (!runtime) {
    await unavailable(
      dependencies,
      payload,
      execution,
      null,
      "PUBLICATION_RUNTIME_UNAVAILABLE",
      PUBLICATION_RUNTIME_UNAVAILABLE,
    );
    return;
  }

  try {
    const token = await runtime.issueToken({
      workspaceId: execution.attempt.workspaceId,
      projectId: execution.attempt.projectId,
      authorizationGrantId: execution.attempt.authorizationGrantId,
      installationId: execution.plan.scope.installationId,
      destinationRef: execution.attempt.destinationRef,
      destinationRevision: execution.attempt.destinationRevision,
    });
    const delivery = await runtime.adapter.createOrUpdateDelivery({
      token,
      scope: execution.plan.scope satisfies GitHubDestinationScope,
      branchName: execution.plan.branchName,
      path: execution.plan.path,
      content: execution.plan.content,
      commitMessage: execution.plan.commitMessage,
      pullRequest: execution.plan.pullRequest,
      remotePrecondition:
        execution.plan.remotePrecondition satisfies GitHubRemotePrecondition,
    });
    if (delivery.contentChecksum !== execution.attempt.contentChecksum) {
      await unavailable(
        dependencies,
        payload,
        execution,
        null,
        "PUBLICATION_CHECKSUM_MISMATCH",
        PUBLICATION_CHECKSUM_INVALID,
      );
      return;
    }
    await dependencies.authority.recordDelivery({
      execution,
      receipt: {
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        providerKind: "github",
        providerRequestId: delivery.providerRequestId,
        remoteScopeRef: delivery.remoteScopeRef,
        remoteObjectKind: "github_pull_request",
        remoteObjectId: String(delivery.remote.pullRequestNumber),
        remoteRevision: delivery.remote.headSha,
        deliveryUrl: delivery.remote.pullRequestUrl,
        liveCanonicalUrl: null,
        artifactContentHash:
          execution.attempt.approvedArtifactContentHash,
        contentChecksum: delivery.contentChecksum,
        verificationState: "pending",
        remoteFacts: { ...delivery.remote },
        evidenceRefs: [],
        limitation: null,
        observedAt: delivery.observedAt,
      },
      // A PR is a completed delivery, not a verified live change. Human merge
      // and a later reconciliation are deliberately outside this write.
      terminal: true,
    });
  } catch (error: unknown) {
    await providerUnavailable(
      dependencies,
      payload,
      execution,
      null,
      error,
    );
  }
}

async function deliverWordPress(
  payload: PublicationJobPayload,
  execution: PublicationExecutionFacts,
  dependencies: RunPublicationDependencies,
): Promise<void> {
  if (execution.plan.providerKind !== "wordpress") return;
  const runtime = dependencies.runtime.wordpress;
  if (!runtime) {
    await unavailable(
      dependencies,
      payload,
      execution,
      null,
      "PUBLICATION_RUNTIME_UNAVAILABLE",
      PUBLICATION_RUNTIME_UNAVAILABLE,
    );
    return;
  }

  let predecessorDeliveryReceiptId: string | null = null;
  try {
    const credential = await runtime.issueCredential({
      workspaceId: execution.attempt.workspaceId,
      projectId: execution.attempt.projectId,
      authorizationGrantId: execution.attempt.authorizationGrantId,
      destinationRef: execution.attempt.destinationRef,
      destinationRevision: execution.attempt.destinationRevision,
      siteOrigin: execution.plan.scope.siteOrigin,
    });
    const delivery = await runtime.adapter.createOrUpdateDelivery({
      credential,
      scope: execution.plan.scope satisfies WordPressDestinationScope,
      ...(execution.plan.postId === undefined
        ? {}
        : { postId: execution.plan.postId }),
      postType: execution.plan.postType,
      title: execution.plan.title,
      slug: execution.plan.slug,
      content: execution.plan.content,
      ...(execution.plan.excerpt === undefined
        ? {}
        : { excerpt: execution.plan.excerpt }),
      authorId: execution.plan.authorId,
      status: execution.plan.status satisfies WordPressDeliveryStatus,
      ...(execution.plan.scheduledAt === undefined
        ? {}
        : { scheduledAt: execution.plan.scheduledAt }),
      canonicalExpectation: execution.plan.canonicalExpectation,
      remotePrecondition:
        execution.plan.remotePrecondition satisfies WordPressRemotePrecondition,
    });
    if (delivery.contentChecksum !== execution.attempt.contentChecksum) {
      await unavailable(
        dependencies,
        payload,
        execution,
        null,
        "PUBLICATION_CHECKSUM_MISMATCH",
        PUBLICATION_CHECKSUM_INVALID,
      );
      return;
    }

    const persisted = await dependencies.authority.recordDelivery({
      execution,
      receipt: {
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        providerKind: "wordpress",
        providerRequestId: delivery.providerRequestId,
        remoteScopeRef: delivery.remoteScopeRef,
        remoteObjectKind: "wordpress_post",
        remoteObjectId: String(delivery.remote.postId),
        remoteRevision: delivery.remote.revision,
        deliveryUrl: delivery.remote.previewUrl,
        liveCanonicalUrl: null,
        artifactContentHash:
          execution.attempt.approvedArtifactContentHash,
        contentChecksum: delivery.contentChecksum,
        verificationState: "pending",
        remoteFacts: { ...delivery.remote },
        evidenceRefs: [],
        limitation: null,
        observedAt: delivery.observedAt,
      },
      terminal: execution.plan.explicitPublish === null,
    });
    predecessorDeliveryReceiptId = persisted.receiptId;
    if (execution.plan.explicitPublish === null) return;

    const change = await runtime.adapter.publishAndReconcile({
      credential,
      scope: execution.plan.scope,
      predecessorDeliveryReceiptId,
      delivery,
      publishAuthorization: {
        authorizationGrantRef: execution.authorization.id,
        purpose: "publish",
        predecessorDeliveryReceiptId,
        contentChecksum: execution.attempt.contentChecksum,
        remoteScopeRef: delivery.remoteScopeRef,
        expectedRemoteRevision: delivery.remote.revision,
        authorizedAt:
          execution.authorization.snapshot.grantedAt,
        consumedAt: execution.authorization.consumedAt,
        expiresAt: execution.authorization.expiresAt,
      },
      expectedRemoteRevision: delivery.remote.revision,
      expectedCanonicalUrl:
        execution.plan.explicitPublish.expectedCanonicalUrl,
    });
    if (
      change.state !== "verified" ||
      change.contentChecksum !== execution.attempt.contentChecksum ||
      change.predecessorDeliveryReceiptId !== predecessorDeliveryReceiptId
    ) {
      await unavailable(
        dependencies,
        payload,
        execution,
        predecessorDeliveryReceiptId,
        "PUBLICATION_CHECKSUM_MISMATCH",
        PUBLICATION_CHECKSUM_INVALID,
      );
      return;
    }
    await dependencies.authority.recordChange({
      execution,
      predecessorDeliveryReceiptId,
      receipt: {
        receiptKind: "change_receipt",
        predecessorDeliveryReceiptId,
        providerKind: "wordpress",
        providerRequestId: change.providerRequestId,
        remoteScopeRef: change.remoteScopeRef,
        remoteObjectKind: "wordpress_revision",
        remoteObjectId: String(change.evidence.postId),
        remoteRevision: change.remoteRevision,
        deliveryUrl: delivery.remote.previewUrl,
        liveCanonicalUrl: change.liveCanonicalUrl,
        artifactContentHash:
          execution.attempt.approvedArtifactContentHash,
        contentChecksum: change.contentChecksum,
        verificationState: "verified_live",
        remoteFacts: { ...change.evidence },
        evidenceRefs: [change.liveCanonicalUrl],
        limitation: null,
        observedAt: change.observedAt,
      },
    });
  } catch (error: unknown) {
    await providerUnavailable(
      dependencies,
      payload,
      execution,
      predecessorDeliveryReceiptId,
      error,
    );
  }
}

function lineageIsExact(
  execution: z.infer<typeof ExecutionFactsSchema>,
  payload: PublicationJobPayload,
): boolean {
  const { attempt, destination, authorization, approval, artifact, plan, run } =
    execution;
  const expectedPurpose =
    attempt.attemptKind === "publish" ? "publish" : "rollback";
  const expiresAt = Date.parse(authorization.expiresAt);
  const consumedAt = Date.parse(authorization.consumedAt);
  const grantedAt = Date.parse(authorization.snapshot.grantedAt);
  if (
    run.id !== payload.runId ||
    attempt.runId !== payload.runId ||
    attempt.workspaceId !== payload.workspaceId ||
    attempt.projectId !== payload.projectId ||
    destination.id !== attempt.destinationId ||
    destination.destinationRef !== attempt.destinationRef ||
    destination.revision !== attempt.destinationRevision ||
    destination.siteId !== attempt.siteId ||
    destination.providerKind !== attempt.providerKind ||
    destination.targetRef !== attempt.targetRef ||
    authorization.id !== attempt.authorizationGrantId ||
    authorization.siteId !== attempt.siteId ||
    authorization.providerKind !== attempt.providerKind ||
    authorization.purpose !== expectedPurpose ||
    authorization.purpose !== attempt.authorizationPurpose ||
    authorization.destinationRef !== attempt.destinationRef ||
    authorization.destinationRevision !== attempt.destinationRevision ||
    authorization.targetRef !== attempt.targetRef ||
    authorization.snapshot.authorizationId !== authorization.id ||
    authorization.snapshot.purpose !== authorization.purpose ||
    authorization.snapshot.destinationRef !== attempt.destinationRef ||
    authorization.snapshot.destinationRevision !==
      attempt.destinationRevision ||
    authorization.snapshot.expiresAt !== authorization.expiresAt ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(consumedAt) ||
    !Number.isFinite(grantedAt) ||
    consumedAt < grantedAt ||
    consumedAt > expiresAt ||
    approval.id !== attempt.approvalEventId ||
    approval.artifactId !== attempt.artifactId ||
    approval.artifactRevisionId !== attempt.artifactRevisionId ||
    approval.artifactRevision !== attempt.approvedArtifactRevision ||
    approval.artifactContentHash !==
      attempt.approvedArtifactContentHash ||
    artifact.id !== attempt.artifactId ||
    artifact.revisionId !== attempt.artifactRevisionId ||
    artifact.revision !== attempt.approvedArtifactRevision ||
    artifact.contentHash !== attempt.approvedArtifactContentHash ||
    attempt.previewChecksum !== attempt.approvedArtifactContentHash ||
    providerContentChecksum(plan.content) !== attempt.contentChecksum ||
    plan.providerKind !== attempt.providerKind ||
    plan.content !== artifact.contentText
  ) {
    return false;
  }

  if (plan.providerKind === "github") {
    if (
      plan.path !== plan.scope.contentPath ||
      !plan.branchName.startsWith(plan.scope.allowedBranchPrefix)
    ) {
      return false;
    }
  } else if (
    !plan.scope.allowedPostTypes.includes(plan.postType) ||
    !plan.scope.allowedAuthorIds.includes(plan.authorId) ||
    !plan.scope.allowedStatuses.includes(plan.status)
  ) {
    return false;
  }

  return preconditionIsExact(
    attempt.remotePrecondition,
    plan.remotePrecondition,
  );
}

function providerContentChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function preconditionIsExact(
  attempt: z.infer<typeof PublicationRemotePrecondition>,
  provider: GitHubRemotePrecondition | WordPressRemotePrecondition,
): boolean {
  if (attempt.kind === "must_not_exist") {
    return provider.kind === "must_not_exist";
  }
  if (provider.kind !== "match") return false;
  if ("revision" in provider) {
    return attempt.revision === provider.revision;
  }
  return (
    attempt.revision ===
    `${provider.branchHeadSha}:${provider.contentSha}`
  );
}

async function providerUnavailable(
  dependencies: RunPublicationDependencies,
  payload: PublicationJobPayload,
  execution: PublicationExecutionFacts,
  predecessorDeliveryReceiptId: string | null,
  error: unknown,
): Promise<void> {
  const providerCode = isPublishingProviderError(error)
    ? error.code
    : "REMOTE_UNAVAILABLE";
  await unavailable(
    dependencies,
    payload,
    execution,
    predecessorDeliveryReceiptId,
    "PUBLICATION_PROVIDER_UNAVAILABLE",
    `${PUBLICATION_PROVIDER_UNAVAILABLE} (${providerCode})`,
  );
}

async function unavailable(
  dependencies: RunPublicationDependencies,
  payload: PublicationJobPayload,
  execution: PublicationExecutionFacts,
  predecessorDeliveryReceiptId: string | null,
  code:
    | "PUBLICATION_RUNTIME_UNAVAILABLE"
    | "PUBLICATION_FROZEN_FACTS_INVALID"
    | "PUBLICATION_CHECKSUM_MISMATCH"
    | "PUBLICATION_PROVIDER_UNAVAILABLE"
    | "PUBLICATION_PROJECT_ARCHIVED",
  limitation: string,
): Promise<void> {
  await dependencies.authority.recordUnavailable({
    payload,
    execution,
    predecessorDeliveryReceiptId,
    code,
    limitation,
    observedAt: dependencies.now().toISOString(),
  });
}
