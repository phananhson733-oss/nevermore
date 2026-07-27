import { PublishingProviderError } from "./errors";
import type {
  ReceiptLineageChange,
  ReceiptLineageDelivery,
  RemoteRevisionPrecondition,
} from "./types";

export const DEFAULT_PUBLICATION_POLICY = Object.freeze({
  githubAutoMerge: false,
  wordpressDirectPublish: false,
});

export interface GitHubDeliveryPlanInput {
  readonly baseBranch: string;
  readonly branchName: string;
  readonly path: string;
  readonly expectedBaseSha: string;
  readonly expectedRemoteRevision: RemoteRevisionPrecondition;
}

export function buildGitHubDeliveryPlan(
  input: GitHubDeliveryPlanInput,
): Readonly<{
  provider: "github";
  mode: "delivery";
  steps: readonly [
    "probe_installation_and_repository",
    "verify_remote_revision",
    "create_or_update_branch",
    "commit_exact_content",
    "create_or_update_pull_request",
  ];
  autoMerge: false;
  mergeMode: "external_human";
}> {
  assertNonEmpty(input.baseBranch, "baseBranch", "github");
  assertNonEmpty(input.branchName, "branchName", "github");
  assertNonEmpty(input.path, "path", "github");
  assertNonEmpty(input.expectedBaseSha, "expectedBaseSha", "github");

  return {
    provider: "github",
    mode: "delivery",
    steps: [
      "probe_installation_and_repository",
      "verify_remote_revision",
      "create_or_update_branch",
      "commit_exact_content",
      "create_or_update_pull_request",
    ],
    autoMerge: false,
    mergeMode: "external_human",
  };
}

export interface WordPressDeliveryPlanInput {
  readonly status: "draft" | "future" | "publish";
  readonly expectedRemoteRevision: RemoteRevisionPrecondition;
}

export function buildWordPressDeliveryPlan(
  input: WordPressDeliveryPlanInput,
): Readonly<{
  provider: "wordpress";
  mode: "delivery";
  steps: readonly [
    "probe_site_and_capabilities",
    "verify_remote_revision",
    "create_or_update_post",
  ];
  directPublish: false;
  requiresExplicitPublishApproval: true;
}> {
  if (input.status === "publish") {
    throw new PublishingProviderError({
      code: "DIRECT_PUBLISH_FORBIDDEN",
      provider: "wordpress",
      operation: "build_delivery_plan",
      message:
        "Direct publish is forbidden; use a separate explicit publish approval.",
    });
  }

  return {
    provider: "wordpress",
    mode: "delivery",
    steps: [
      "probe_site_and_capabilities",
      "verify_remote_revision",
      "create_or_update_post",
    ],
    directPublish: false,
    requiresExplicitPublishApproval: true,
  };
}

export interface GitHubRollbackPreviewInput {
  readonly repositoryId: number;
  readonly owner: string;
  readonly repository: string;
  readonly sourcePullRequestNumber: number;
  readonly sourceMergedSha: string;
  readonly baseSha: string;
  readonly path: string;
  readonly preChangeBlobSha: string;
  readonly expectedCurrentRemoteRevision: string;
  readonly revertBranchName: string;
}

export function buildGitHubRollbackPreview(input: GitHubRollbackPreviewInput) {
  assertPositiveInteger(input.repositoryId, "repositoryId", "github");
  assertPositiveInteger(
    input.sourcePullRequestNumber,
    "sourcePullRequestNumber",
    "github",
  );
  assertNonEmpty(input.owner, "owner", "github");
  assertNonEmpty(input.repository, "repository", "github");
  assertNonEmpty(input.sourceMergedSha, "sourceMergedSha", "github");
  assertNonEmpty(
    input.expectedCurrentRemoteRevision,
    "expectedCurrentRemoteRevision",
    "github",
  );

  return {
    provider: "github" as const,
    mode: "rollback_preview" as const,
    mutatesRemote: false as const,
    source: {
      repositoryId: input.repositoryId,
      pullRequestNumber: input.sourcePullRequestNumber,
      mergedSha: input.sourceMergedSha,
    },
    remotePrecondition: {
      expectedCurrentRevision: input.expectedCurrentRemoteRevision,
    },
    proposed: {
      baseSha: input.baseSha,
      path: input.path,
      restoreBlobSha: input.preChangeBlobSha,
      branchName: input.revertBranchName,
      delivery: "new_pull_request" as const,
    },
  };
}

export interface WordPressRollbackPreviewInput {
  readonly siteOrigin: string;
  readonly postId: number;
  readonly priorRevision: string;
  readonly priorContentChecksum: string;
  readonly priorStatus: "draft" | "future" | "publish";
  readonly authorId: number;
  readonly slug: string;
  readonly expectedCurrentRemoteRevision: string;
}

export function buildWordPressRollbackPreview(
  input: WordPressRollbackPreviewInput,
) {
  assertPositiveInteger(input.postId, "postId", "wordpress");
  assertPositiveInteger(input.authorId, "authorId", "wordpress");
  assertNonEmpty(input.siteOrigin, "siteOrigin", "wordpress");
  assertNonEmpty(input.priorRevision, "priorRevision", "wordpress");
  assertNonEmpty(
    input.expectedCurrentRemoteRevision,
    "expectedCurrentRemoteRevision",
    "wordpress",
  );

  return {
    provider: "wordpress" as const,
    mode: "rollback_preview" as const,
    mutatesRemote: false as const,
    source: {
      siteOrigin: input.siteOrigin,
      postId: input.postId,
    },
    remotePrecondition: {
      expectedCurrentRevision: input.expectedCurrentRemoteRevision,
    },
    proposed: {
      restoreRevision: input.priorRevision,
      restoreContentChecksum: input.priorContentChecksum,
      status: input.priorStatus,
      authorId: input.authorId,
      slug: input.slug,
    },
  };
}

export function assertReceiptLineage(input: {
  readonly delivery: ReceiptLineageDelivery;
  readonly change: ReceiptLineageChange;
}): void {
  const matches =
    input.change.predecessorDeliveryReceiptId === input.delivery.id &&
    input.change.provider === input.delivery.provider &&
    input.change.contentChecksum === input.delivery.contentChecksum &&
    input.change.remoteScopeRef === input.delivery.remoteScopeRef &&
    Date.parse(input.change.observedAt) > Date.parse(input.delivery.observedAt);

  if (!matches) {
    throw new PublishingProviderError({
      code: "LINEAGE_MISMATCH",
      provider: input.change.provider,
      operation: "assert_receipt_lineage",
      message:
        "Change observation does not match its predecessor delivery lineage.",
      remoteScopeRef: input.change.remoteScopeRef,
    });
  }
}

function assertNonEmpty(
  value: string,
  field: string,
  provider: "github" | "wordpress",
): void {
  if (value.trim().length === 0) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider,
      operation: "validate_policy_input",
      message: "Publication policy input is invalid.",
      safeDetails: { field },
    });
  }
}

function assertPositiveInteger(
  value: number,
  field: string,
  provider: "github" | "wordpress",
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider,
      operation: "validate_policy_input",
      message: "Publication policy input is invalid.",
      safeDetails: { field },
    });
  }
}
