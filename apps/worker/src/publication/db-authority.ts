import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  PublicationAuthorizationSnapshot,
  PublicationDestinationScope,
  PublicationRemotePrecondition,
  PublicationRollbackPlan,
} from "@sf/contracts";
import {
  ActionsRepository,
  ArtifactApprovalsRepository,
  AsyncRunsRepository,
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionsRepository,
  ExecutionArtifactsRepository,
  FindingTargetsRepository,
  ProjectsRepository,
  PublicationsRepository,
  toRunAttempt,
  type ActionRow,
  type ArtifactApprovalEventRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type DeliveryAuthorizationGrantRow,
  type FindingTargetRow,
  type PublicationAttemptExecutionRead,
  type PublicationDestinationRow,
  type PublicationReceiptRow,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import type {
  PublicationExecutionAuthority,
  PublicationExecutionFacts,
  PublicationJobPayload,
  PublicationReceiptWrite,
} from "./run-publication.ts";

const EXECUTION_SCHEMA_VERSION = "publication-execution.1";

export interface BuildPublicationExecutionFactsInput {
  readonly payload: PublicationJobPayload;
  readonly execution: PublicationAttemptExecutionRead;
  readonly destination: PublicationDestinationRow | null;
  readonly grant: DeliveryAuthorizationGrantRow | null;
  readonly approval: ArtifactApprovalEventRow | null;
  readonly artifact: ArtifactRow | null;
  readonly revision: ArtifactRevisionRow | null;
  readonly action: ActionRow | null;
  readonly targets: readonly FindingTargetRow[];
  readonly now: Date;
}

/**
 * Convert repository rows into the strict, provider-ready snapshot consumed by
 * the side-effect orchestrator. Any drift returns null before credentials or a
 * provider adapter can be reached.
 */
export function buildPublicationExecutionFacts(
  input: BuildPublicationExecutionFactsInput,
): PublicationExecutionFacts | null {
  const {
    attempt,
    run,
  } = input.execution;
  const destination = input.destination;
  const grant = input.grant;
  const approval = input.approval;
  const artifact = input.artifact;
  const revision = input.revision;
  const action = input.action;
  const expectedPurpose =
    attempt.attempt_kind === "publish" ? "publish" : "rollback";
  const approvalEventId =
    attempt.attempt_kind === "publish"
      ? attempt.publication_approval_event_id
      : attempt.source_approval_event_id;
  const authorization = PublicationAuthorizationSnapshot.safeParse(
    attempt.authorization_snapshot,
  );
  const grantAuthorization = PublicationAuthorizationSnapshot.safeParse(
    grant?.authorization_snapshot,
  );
  const remotePrecondition = PublicationRemotePrecondition.safeParse(
    attempt.remote_precondition,
  );
  const rollbackPlan = PublicationRollbackPlan.safeParse(
    attempt.rollback_plan,
  );
  const contentChecksum = attempt.content_checksum;
  const expiresAt = grant?.expires_at ?? null;
  const expiresAtMs = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  const consumedAt = grant?.consumed_at ?? null;
  const consumedAtMs =
    consumedAt === null ? Number.NaN : Date.parse(consumedAt);
  const grantedAtMs = authorization.success
    ? Date.parse(authorization.data.grantedAt)
    : Number.NaN;

  if (
    run.id !== input.payload.runId ||
    run.workspace_id !== input.payload.workspaceId ||
    run.project_id !== input.payload.projectId ||
    run.status !== "running" ||
    run.kind !== "publication" ||
    run.result_type !== "publication_attempt" ||
    run.result_id !== attempt.id ||
    run.attempt_count < 1 ||
    attempt.async_run_id !== run.id ||
    attempt.workspace_id !== input.payload.workspaceId ||
    attempt.project_id !== input.payload.projectId ||
    attempt.side_effect_class !== "external_write" ||
    attempt.authorization_purpose !== expectedPurpose ||
    approvalEventId === null ||
    !destination ||
    destination.id !== attempt.destination_id ||
    destination.destination_ref !== attempt.destination_ref ||
    destination.revision !== attempt.destination_revision ||
    destination.site_id !== attempt.site_id ||
    destination.provider_kind !== attempt.provider_kind ||
    destination.target_ref !== attempt.target_ref ||
    destination.state !== "ready" ||
    !grant ||
    grant.id !== attempt.authorization_grant_id ||
    grant.state !== "consumed" ||
    grant.site_id !== attempt.site_id ||
    grant.provider_kind !== attempt.provider_kind ||
    grant.purpose !== expectedPurpose ||
    grant.destination_ref !== attempt.destination_ref ||
    grant.destination_revision !== attempt.destination_revision ||
    grant.target_ref !== attempt.target_ref ||
    grant.authorization_snapshot_hash !==
      attempt.authorization_snapshot_hash ||
    !authorization.success ||
    !grantAuthorization.success ||
    JSON.stringify(authorization.data) !==
      JSON.stringify(grantAuthorization.data) ||
    authorization.data.authorizationId !== grant.id ||
    authorization.data.purpose !== expectedPurpose ||
    authorization.data.destinationRef !== attempt.destination_ref ||
    authorization.data.destinationRevision !==
      attempt.destination_revision ||
    authorization.data.expiresAt !== expiresAt ||
    expiresAt === null ||
    consumedAt === null ||
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(consumedAtMs) ||
    !Number.isFinite(grantedAtMs) ||
    consumedAtMs < grantedAtMs ||
    consumedAtMs > expiresAtMs ||
    !approval ||
    approval.id !== approvalEventId ||
    approval.event_kind !== "approved" ||
    approval.artifact_id !== attempt.artifact_id ||
    approval.artifact_revision_id !== attempt.artifact_revision_id ||
    approval.artifact_revision !== attempt.approved_artifact_revision ||
    approval.artifact_content_hash !==
      attempt.approved_artifact_content_hash ||
    !artifact ||
    artifact.id !== attempt.artifact_id ||
    artifact.action_id !== attempt.action_id ||
    artifact.status !== "ready" ||
    artifact.validation_state !== "valid" ||
    artifact.current_revision !== attempt.approved_artifact_revision ||
    artifact.content_hash !== attempt.approved_artifact_content_hash ||
    !revision ||
    revision.id !== attempt.artifact_revision_id ||
    revision.artifact_id !== artifact.id ||
    revision.revision !== attempt.approved_artifact_revision ||
    revision.content_hash !== attempt.approved_artifact_content_hash ||
    typeof revision.content_text !== "string" ||
    revision.content_text.length === 0 ||
    attempt.preview_checksum !== attempt.approved_artifact_content_hash ||
    utf8Checksum(revision.content_text) !== contentChecksum ||
    !remotePrecondition.success ||
    !rollbackPlan.success ||
    rollbackPlan.data.providerKind !== attempt.provider_kind ||
    !action ||
    action.id !== attempt.action_id ||
    action.status === "dismissed" ||
    !canonicalTargetMatches(
      input.targets,
      attempt.site_id,
      attempt.target_ref,
    )
  ) {
    return null;
  }

  const providerScope = PublicationDestinationScope.safeParse(
    destination.provider_scope,
  );
  if (
    !providerScope.success ||
    providerScope.data.providerKind !== attempt.provider_kind
  ) {
    return null;
  }

  const common: Omit<PublicationExecutionFacts, "plan"> = {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    run: {
      id: run.id,
      attemptCount: run.attempt_count,
    },
    attempt: {
      id: attempt.id,
      attemptKind: attempt.attempt_kind,
      runId: run.id,
      workspaceId: attempt.workspace_id,
      projectId: attempt.project_id,
      siteId: attempt.site_id,
      destinationId: attempt.destination_id,
      destinationRef: attempt.destination_ref,
      destinationRevision: attempt.destination_revision,
      providerKind: attempt.provider_kind,
      targetRef: attempt.target_ref,
      actionId: attempt.action_id,
      artifactId: attempt.artifact_id,
      artifactRevisionId: attempt.artifact_revision_id,
      approvedArtifactRevision: attempt.approved_artifact_revision,
      approvedArtifactContentHash:
        attempt.approved_artifact_content_hash,
      contentChecksum,
      approvalEventId,
      authorizationGrantId: attempt.authorization_grant_id,
      authorizationPurpose: attempt.authorization_purpose,
      previewChecksum: attempt.preview_checksum,
      remotePrecondition: remotePrecondition.data,
    },
    destination: {
      id: destination.id,
      destinationRef: destination.destination_ref,
      revision: destination.revision,
      siteId: destination.site_id,
      providerKind: destination.provider_kind,
      targetRef: destination.target_ref,
      state: "ready",
    },
    authorization: {
      id: grant.id,
      state: "consumed",
      siteId: grant.site_id,
      providerKind: grant.provider_kind,
      purpose: grant.purpose as "publish" | "rollback",
      destinationRef: grant.destination_ref,
      destinationRevision: grant.destination_revision,
      targetRef: grant.target_ref,
      expiresAt,
      consumedAt,
      snapshot: authorization.data,
    },
    approval: {
      id: approval.id,
      eventKind: "approved",
      artifactId: approval.artifact_id,
      artifactRevisionId: approval.artifact_revision_id,
      artifactRevision: approval.artifact_revision,
      artifactContentHash: approval.artifact_content_hash,
    },
    artifact: {
      id: artifact.id,
      revisionId: revision.id,
      revision: revision.revision,
      contentHash: revision.content_hash,
      contentText: revision.content_text,
    },
  };

  if (providerScope.data.providerKind === "github") {
    const providerPrecondition = githubPrecondition(
      remotePrecondition.data,
      rollbackPlan.data.facts,
    );
    if (!providerPrecondition) return null;
    return {
      ...common,
      plan: {
        providerKind: "github",
        phase: "deliver",
        scope: {
          installationId: providerScope.data.installationId,
          repositoryId: providerScope.data.repositoryId,
          owner: providerScope.data.repositoryOwner,
          repository: providerScope.data.repositoryName,
          baseBranch: providerScope.data.baseBranch,
          allowedBranchPrefix: providerScope.data.branchPrefix,
          contentPath: providerScope.data.contentPath,
        },
        branchName:
          `${providerScope.data.branchPrefix}${attempt.id}`,
        path: providerScope.data.contentPath,
        content: revision.content_text,
        commitMessage: `Publish approved artifact ${attempt.id}`,
        pullRequest: {
          title: `Publish ${action.title || "approved artifact"}`,
          body:
            `Generated from approved publication attempt ${attempt.id}. ` +
            "This pull request requires human review and merge.",
        },
        remotePrecondition: providerPrecondition,
      },
    };
  }

  const statuses = providerScope.data.statusAllowlist.filter(
    (status): status is "draft" | "future" =>
      status === "draft" || status === "future",
  );
  const status = statuses.includes("draft")
    ? "draft"
    : statuses.includes("future")
      ? "future"
      : null;
  const facts = rollbackPlan.data.facts;
  const scheduledAt =
    status === "future" ? recordString(facts, "scheduledAt") : null;
  const canonical = normalizedHttpUrl(attempt.target_ref);
  const authorId = providerScope.data.authorAllowlist[0];
  if (
    status === null ||
    authorId === undefined ||
    canonical === null ||
    (status === "future" &&
      (scheduledAt === null ||
        Date.parse(scheduledAt) <= input.now.getTime()))
  ) {
    return null;
  }
  const slug = recordString(facts, "slug") ?? slugFromUrl(canonical);
  const title =
    recordString(facts, "title") ??
    markdownTitle(revision.content_text) ??
    slug;
  if (!slug || !title) return null;
  const postId = recordPositiveInteger(facts, "postId");
  const excerpt = recordString(facts, "excerpt");
  const explicitPublish =
    facts["explicitPublish"] === true &&
    providerScope.data.statusAllowlist.includes("publish")
      ? { expectedCanonicalUrl: canonical }
      : null;
  const providerPrecondition =
    remotePrecondition.data.kind === "must_not_exist"
      ? ({ kind: "must_not_exist" } as const)
      : ({
          kind: "match",
          revision: remotePrecondition.data.revision,
        } as const);

  return {
    ...common,
    plan: {
      providerKind: "wordpress",
      phase: "deliver",
      scope: {
        siteOrigin: new URL(providerScope.data.siteBaseUrl).origin,
        authenticatedUserId:
          providerScope.data.authenticatedUserId,
        allowedAuthorIds: [...providerScope.data.authorAllowlist],
        allowedStatuses: statuses,
        allowedPostTypes: [providerScope.data.postType],
      },
      ...(postId === null ? {} : { postId }),
      postType: providerScope.data.postType,
      title,
      slug,
      content: revision.content_text,
      ...(excerpt === null ? {} : { excerpt }),
      authorId,
      status,
      ...(scheduledAt === null ? {} : { scheduledAt }),
      canonicalExpectation: canonical,
      remotePrecondition: providerPrecondition,
      explicitPublish,
    },
  };
}

export function createDbPublicationAuthority(
  ctx: WorkerContext,
  clock: () => Date = () => new Date(),
): PublicationExecutionAuthority {
  return {
    async load(payload) {
      const scope = {
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
      };
      const observedRun = await new AsyncRunsRepository(ctx.db).findById(
        scope,
        payload.runId,
      );
      const attemptId = observedRun
        ? recordString(
            observedRun.request_payload,
            "publicationAttemptId",
          )
        : null;
      if (!observedRun || !attemptId) return null;

      return ctx.db.transaction(
        async (tx) => {
          const executionNow = clock();
          const runs = new AsyncRunsRepository(tx);
          const lockedRun = await runs.lockAttemptForUpdate(
            toRunAttempt(observedRun),
          );
          if (!lockedRun) return null;
          const project = await new ProjectsRepository(
            tx,
          ).findByIdForUpdate(
            { workspaceId: payload.workspaceId },
            payload.projectId,
          );
          if (!project) return null;
          if (project.archived_at !== null) {
            return {
              schemaVersion:
                "publication-execution-unavailable.1",
              code: "PUBLICATION_PROJECT_ARCHIVED",
              limitation:
                "Project was archived after publication acceptance; no provider write was attempted.",
            } as const;
          }
          const publications = publicationRepository(tx);
          const execution =
            await publications.loadAttemptForExecution(
              scope,
              attemptId,
              { lock: true },
            );
          if (!execution || execution.run.id !== lockedRun.id) {
            return null;
          }
          const attempt = execution.attempt;
          const destination =
            await new DeliveryConnectionsRepository(
              tx,
            ).findExactForExecution(
              scope,
              {
                id: attempt.destination_id,
                destinationRef: attempt.destination_ref,
                revision: attempt.destination_revision,
                siteId: attempt.site_id,
                providerKind: attempt.provider_kind,
                targetRef: attempt.target_ref,
              },
              { lock: true },
            );
          const grant =
            await new DeliveryAuthorizationGrantsRepository(
              tx,
            ).findExactForExecution(
              scope,
              {
                grantId: attempt.authorization_grant_id,
                siteId: attempt.site_id,
                providerKind: attempt.provider_kind,
                purpose: attempt.authorization_purpose,
                destinationRef: attempt.destination_ref,
                destinationRevision:
                  attempt.destination_revision,
                targetRef: attempt.target_ref,
                authorizationSnapshotHash:
                  attempt.authorization_snapshot_hash,
              },
              { lock: true },
            );
          const approvals = new ArtifactApprovalsRepository(tx);
          const approvalId =
            attempt.attempt_kind === "publish"
              ? attempt.publication_approval_event_id
              : attempt.source_approval_event_id;
          const approval = approvalId
            ? attempt.attempt_kind === "publish"
              ? await approvals.findCurrentApproval(scope, approvalId)
              : await approvals.findHistoricalApproval(
                  scope,
                  approvalId,
                )
            : null;
          const artifacts = new ExecutionArtifactsRepository(tx);
          const artifact = await artifacts.findByIdForUpdate(
            scope,
            attempt.artifact_id,
          );
          const revision = artifact
            ? await artifacts.findRevision(
                scope,
                artifact.id,
                attempt.approved_artifact_revision,
              )
            : null;
          const action = await new ActionsRepository(
            tx,
          ).findByIdForUpdate(scope, attempt.action_id);
          const targets = action
            ? await new FindingTargetsRepository(tx).listForFindings(
                scope,
                action.source_diagnostic_run_id,
                [action.source_finding_id],
              )
            : [];
          return buildPublicationExecutionFacts({
            payload,
            execution,
            destination,
            grant,
            approval,
            artifact,
            revision,
            action,
            targets,
            now: executionNow,
          });
        },
        { isolationLevel: "repeatable read" },
      );
    },

    async recordDelivery(input) {
      return ctx.db.transaction(async (tx) => {
        const { publications, execution } = await lockExecution(
          tx,
          input.execution,
        );
        const existing = execution.receipts.find(
          (receipt) => receipt.receipt_kind === "delivery_receipt",
        );
        const row = existing
          ? requireMatchingReceipt(existing, input.receipt)
          : await appendReceipt(
              publications,
              input.execution,
              input.receipt,
            );
        if (input.terminal) {
          await terminalize(
            tx,
            input.execution,
            "completed",
            undefined,
          );
        }
        return { receiptId: row.id };
      });
    },

    async recordChange(input) {
      await ctx.db.transaction(async (tx) => {
        const { publications, execution } = await lockExecution(
          tx,
          input.execution,
        );
        const existing = execution.receipts.find(
          (receipt) => receipt.receipt_kind === "change_receipt",
        );
        if (existing) {
          requireMatchingReceipt(existing, input.receipt);
        } else {
          await appendReceipt(
            publications,
            input.execution,
            input.receipt,
          );
        }
        await terminalize(
          tx,
          input.execution,
          "completed",
          undefined,
        );
      });
    },

    async recordUnavailable(input) {
      await ctx.db.transaction(async (tx) => {
        if (input.execution === null) {
          const scope = {
            workspaceId: input.payload.workspaceId,
            projectId: input.payload.projectId,
          };
          const run = await new AsyncRunsRepository(tx).findById(
            scope,
            input.payload.runId,
          );
          if (!run || run.status !== "running") return;
          const runs = new AsyncRunsRepository(tx);
          if (!(await runs.lockAttemptForUpdate(toRunAttempt(run)))) return;
          await runs.setTerminal(toRunAttempt(run), {
            status:
              input.code === "PUBLICATION_PROJECT_ARCHIVED"
                ? "cancelled"
                : "failed",
            lastErrorCode: input.code,
            lastErrorSummary: input.limitation,
          });
          return;
        }

        const { publications, execution } = await lockExecution(
          tx,
          input.execution,
        );
        const existingDelivery = execution.receipts.find(
          (receipt) => receipt.receipt_kind === "delivery_receipt",
        );
        if (
          input.predecessorDeliveryReceiptId === null &&
          !existingDelivery
        ) {
          await appendReceipt(
            publications,
            input.execution,
            unavailableReceipt(input.execution, input),
          );
        }
        await terminalize(
          tx,
          input.execution,
          "failed",
          {
            code: input.code,
            summary: input.limitation,
          },
        );
      });
    },
  };
}

function publicationRepository(
  exec: ConstructorParameters<typeof PublicationsRepository>[0],
): PublicationsRepository {
  return new PublicationsRepository(exec, {
    enqueue() {
      throw new Error("publication execution reader cannot enqueue");
    },
  });
}

async function lockExecution(
  tx: Parameters<
    Parameters<WorkerContext["db"]["transaction"]>[0]
  >[0],
  expected: PublicationExecutionFacts,
): Promise<{
  readonly publications: PublicationsRepository;
  readonly execution: PublicationAttemptExecutionRead;
}> {
  const runs = new AsyncRunsRepository(tx);
  const attempt = {
    workspaceId: expected.attempt.workspaceId,
    projectId: expected.attempt.projectId,
    runId: expected.run.id,
    attemptCount: expected.run.attemptCount,
  };
  if (!(await runs.lockAttemptForUpdate(attempt))) {
    throw new Error("publication run attempt ownership changed");
  }
  const publications = publicationRepository(tx);
  const execution = await publications.loadAttemptForExecution(
    {
      workspaceId: expected.attempt.workspaceId,
      projectId: expected.attempt.projectId,
    },
    expected.attempt.id,
    { lock: true },
  );
  if (
    !execution ||
    execution.attempt.async_run_id !== expected.run.id ||
    execution.attempt.destination_ref !==
      expected.attempt.destinationRef ||
    execution.attempt.preview_checksum !==
      expected.attempt.previewChecksum
  ) {
    throw new Error("publication execution lineage changed");
  }
  return { publications, execution };
}

async function terminalize(
  tx: Parameters<
    Parameters<WorkerContext["db"]["transaction"]>[0]
  >[0],
  execution: PublicationExecutionFacts,
  status: "completed" | "failed",
  failure:
    | {
        readonly code: string;
        readonly summary: string;
      }
    | undefined,
): Promise<void> {
  const changed = await new AsyncRunsRepository(tx).setTerminal(
    {
      workspaceId: execution.attempt.workspaceId,
      projectId: execution.attempt.projectId,
      runId: execution.run.id,
      attemptCount: execution.run.attemptCount,
    },
    {
      status,
      resultType: "publication_attempt",
      resultId: execution.attempt.id,
      ...(failure
        ? {
            lastErrorCode: failure.code,
            lastErrorSummary: failure.summary,
          }
        : {}),
    },
  );
  if (!changed) {
    throw new Error("publication run attempt ownership changed");
  }
}

async function appendReceipt(
  publications: PublicationsRepository,
  execution: PublicationExecutionFacts,
  receipt: PublicationReceiptWrite,
): Promise<PublicationReceiptRow> {
  const values: Parameters<
    PublicationsRepository["appendReceipt"]
  >[0] = {
    workspaceId: execution.attempt.workspaceId,
    projectId: execution.attempt.projectId,
    siteId: execution.attempt.siteId,
    publicationAttemptId: execution.attempt.id,
    receiptKind: receipt.receiptKind,
    predecessorDeliveryReceiptId:
      receipt.predecessorDeliveryReceiptId,
    providerKind: receipt.providerKind,
    providerRequestId: receipt.providerRequestId,
    remoteScopeRef: receipt.remoteScopeRef,
    remoteObjectKind: receipt.remoteObjectKind,
    remoteObjectId: receipt.remoteObjectId,
    remoteRevision: receipt.remoteRevision,
    deliveryUrl: receipt.deliveryUrl,
    liveCanonicalUrl: receipt.liveCanonicalUrl,
    artifactContentHash: receipt.artifactContentHash,
    contentChecksum: receipt.contentChecksum,
    verificationState: receipt.verificationState,
    remoteFacts: { ...receipt.remoteFacts },
    evidenceRefs: [...receipt.evidenceRefs],
    limitation: receipt.limitation,
    observedAt: receipt.observedAt,
  };
  return publications.appendReceipt(values);
}

function unavailableReceipt(
  execution: PublicationExecutionFacts,
  input: {
    readonly limitation: string;
    readonly observedAt: string;
  },
): PublicationReceiptWrite {
  const github = execution.plan.providerKind === "github";
  return {
    receiptKind: "delivery_receipt",
    predecessorDeliveryReceiptId: null,
    providerKind: execution.attempt.providerKind,
    providerRequestId: null,
    remoteScopeRef: github
      ? `github:repository:${execution.plan.scope.repositoryId}`
      : `wordpress:site:${execution.plan.scope.siteOrigin}`,
    remoteObjectKind: github
      ? "github_pull_request"
      : "wordpress_post",
    remoteObjectId: execution.attempt.id,
    remoteRevision: "not_observed",
    deliveryUrl: null,
    liveCanonicalUrl: null,
    artifactContentHash:
      execution.attempt.approvedArtifactContentHash,
    contentChecksum: execution.attempt.contentChecksum,
    verificationState: "unavailable",
    remoteFacts: { state: "unavailable" },
    evidenceRefs: [],
    limitation: input.limitation,
    observedAt: input.observedAt,
  };
}

function requireMatchingReceipt(
  existing: PublicationReceiptRow,
  expected: PublicationReceiptWrite,
): PublicationReceiptRow {
  if (
    existing.receipt_kind !== expected.receiptKind ||
    existing.predecessor_delivery_receipt_id !==
      expected.predecessorDeliveryReceiptId ||
    existing.provider_kind !== expected.providerKind ||
    existing.remote_scope_ref !== expected.remoteScopeRef ||
    existing.remote_object_kind !== expected.remoteObjectKind ||
    existing.remote_object_id !== expected.remoteObjectId ||
    existing.remote_revision !== expected.remoteRevision ||
    existing.delivery_url !== expected.deliveryUrl ||
    existing.live_canonical_url !== expected.liveCanonicalUrl ||
    existing.content_checksum !== expected.contentChecksum ||
    existing.artifact_content_hash !== expected.artifactContentHash ||
    existing.verification_state !== expected.verificationState ||
    !isDeepStrictEqual(existing.remote_facts, expected.remoteFacts) ||
    !isDeepStrictEqual(existing.evidence_refs, expected.evidenceRefs) ||
    existing.limitation !== expected.limitation
  ) {
    throw new Error("publication receipt replay conflict");
  }
  return existing;
}

function canonicalTargetMatches(
  targets: readonly FindingTargetRow[],
  siteId: string,
  targetRef: string,
): boolean {
  const resolved = targets.filter(
    (target) => target.resolution_state === "resolved",
  );
  const root =
    resolved.find(
      (target) =>
        target.relation === "direct_url" &&
        target.target_kind === "url",
    ) ??
    resolved[0] ??
    targets[0] ??
    null;
  return (
    root !== null &&
    root.site_id === siteId &&
    root.target_ref === targetRef
  );
}

function githubPrecondition(
  remote: ReturnType<typeof PublicationRemotePrecondition.parse>,
  facts: Record<string, unknown>,
):
  | { readonly kind: "must_not_exist" }
  | {
      readonly kind: "match";
      readonly branchHeadSha: string;
      readonly contentSha: string;
    }
  | null {
  if (remote.kind === "must_not_exist") {
    return { kind: "must_not_exist" };
  }
  const branchHeadSha = recordString(facts, "branchHeadSha");
  const contentSha = recordString(facts, "contentSha");
  if (
    !branchHeadSha ||
    !contentSha ||
    remote.revision !== `${branchHeadSha}:${contentSha}`
  ) {
    return null;
  }
  return { kind: "match", branchHeadSha, contentSha };
}

function utf8Checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function recordString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function recordPositiveInteger(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const candidate = value[key];
  return Number.isSafeInteger(candidate) && Number(candidate) > 0
    ? Number(candidate)
    : null;
}

function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function slugFromUrl(value: string): string {
  const segments = new URL(value).pathname.split("/").filter(Boolean);
  return segments.at(-1) ?? "approved-artifact";
}

function markdownTitle(content: string): string | null {
  const match = /^#\s+(.+)$/mu.exec(content);
  return match?.[1]?.trim() || null;
}
