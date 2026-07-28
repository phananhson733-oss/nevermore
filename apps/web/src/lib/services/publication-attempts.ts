import {
  ArtifactApprovalSnapshot,
  CreatePublicationAttemptRequest,
  CreatePublicationRollbackAttemptRequest,
  PublicationAttemptAccepted,
  PublicationChecksum,
  PublicationReceipt,
  PublicationRemotePrecondition,
  PublicationRollbackPlan,
  ReconcilePublicationAttemptRequest,
  PublicationAuthorizationSnapshot,
  type CreatePublicationAttemptRequest as CreatePublicationAttemptRequestDto,
  type CreatePublicationRollbackAttemptRequest as CreatePublicationRollbackAttemptRequestDto,
  type PublicationRemotePrecondition as PublicationRemotePreconditionDto,
  type ReconcilePublicationAttemptRequest as ReconcilePublicationAttemptRequestDto,
} from "@sf/contracts";
import {
  ActionsRepository,
  ArtifactApprovalsRepository,
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionsRepository,
  ExecutionArtifactsRepository,
  FindingTargetsRepository,
  ProjectsRepository,
  PublicationAlreadyActiveError,
  PublicationIdempotencyConflictError,
  PublicationInvariantError,
  PublicationsRepository,
  enqueueRunInTx,
  publicationRequestHash,
  sha256Hex,
  type AsyncRunRow,
  type CreatePublicationAttemptTransaction,
  type DbTx,
  type Executor,
  type PublicationAttemptRow,
  type PublicationAttemptTransactionResult,
  type PublicationDestinationRow,
  type PublicationReceiptRow,
  type ResolvedPublicationAttemptFacts,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLICATION_CONTRACT_VERSION = "publication.0.4.0";

export interface PublicationAttemptStore {
  replayByPermanentKey(
    scope: { readonly workspaceId: string; readonly projectId: string },
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PublicationAttemptTransactionResult | null>;
  createAttemptAtomically(
    command: CreatePublicationAttemptTransaction,
  ): Promise<PublicationAttemptTransactionResult>;
}

export interface PublicationAttemptReadFacts {
  readonly attempt: PublicationAttemptRow;
  readonly run: AsyncRunRow;
  readonly receipts: readonly PublicationReceiptRow[];
  readonly latestDestinationState: string | null;
}

export interface PublicationAttemptAuthority {
  loadPublishTarget(
    exec: Executor,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly request: CreatePublicationAttemptRequestDto;
    },
  ): Promise<{ readonly destinationRef: string; readonly targetRef: string }>;
  resolvePublishFacts(
    tx: DbTx,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly now: Date;
      readonly request: CreatePublicationAttemptRequestDto;
    },
  ): Promise<ResolvedPublicationAttemptFacts>;
  loadRollbackTarget(
    exec: Executor,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly sourcePublicationAttemptId: string;
    },
  ): Promise<{ readonly destinationRef: string; readonly targetRef: string }>;
  resolveRollbackFacts(
    tx: DbTx,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly sourcePublicationAttemptId: string;
      readonly actorId: string;
      readonly now: Date;
      readonly request: CreatePublicationRollbackAttemptRequestDto;
    },
  ): Promise<ResolvedPublicationAttemptFacts>;
  readAttempt(
    exec: Executor,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly publicationAttemptId: string;
    },
  ): Promise<PublicationAttemptReadFacts>;
}

type PublicationEnqueue = (
  tx: DbTx,
  payload: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly contractVersion: string;
  },
) => Promise<unknown> | unknown;

export interface PublicationAttemptServiceDependencies {
  readonly db: Executor;
  readonly now: () => Date;
  readonly contractVersion: string;
  readonly createStore: (
    exec: Executor,
    enqueue: PublicationEnqueue,
    now: () => Date,
  ) => PublicationAttemptStore;
  readonly authority: PublicationAttemptAuthority;
  readonly enqueue: PublicationEnqueue;
}

export interface PublicationAttemptAcceptedResult {
  readonly publicationAttemptId: string;
  readonly asyncRunId: string;
  readonly state: "pending";
  readonly replayed: boolean;
  readonly location: string;
}

export interface CustomerPublicationTimelineEvent {
  readonly kind:
    | "attempt_requested"
    | "delivery_receipt"
    | "change_receipt";
  readonly receiptId: string | null;
  readonly verificationState:
    | "pending"
    | "provider_accepted"
    | "verified_live"
    | "unavailable";
  readonly remoteObjectKind: string | null;
  readonly remoteObjectId: string | null;
  readonly remoteRevision: string | null;
  readonly deliveryUrl: string | null;
  readonly liveCanonicalUrl: string | null;
  readonly artifactContentHash: string;
  readonly contentChecksum: string;
  readonly limitation: string | null;
  readonly occurredAt: string;
}

export interface CustomerPublicationAttempt {
  readonly id: string;
  readonly attemptKind: "publish" | "rollback";
  readonly sourcePublicationAttemptId: string | null;
  readonly sourceChangeReceiptId: string | null;
  readonly state: "pending" | "changed" | "unavailable" | "revoked";
  readonly run: AsyncRunDto;
  readonly siteId: string;
  readonly destinationRef: string;
  readonly destinationRevision: number;
  readonly providerKind: "github" | "wordpress";
  readonly targetRef: string;
  readonly actionId: string;
  readonly artifact: {
    readonly id: string;
    readonly revision: number;
    readonly contentHash: string;
  };
  readonly preview: {
    readonly ref: string;
    readonly artifactContentHash: string;
    readonly contentChecksum: string;
  };
  readonly remotePrecondition: PublicationRemotePreconditionDto;
  readonly rollbackStrategy:
    | "github_revert_pr"
    | "wordpress_restore_revision";
  readonly requestedAt: string;
  readonly timeline: readonly CustomerPublicationTimelineEvent[];
}

function stalePublication(detail: string): never {
  throw new ProblemError("STALE_REVISION", detail);
}

function approvalSnapshot(
  row: Awaited<
    ReturnType<ArtifactApprovalsRepository["findHistoricalApproval"]>
  >,
) {
  if (!row || row.event_kind !== "approved" || !row.reviewer_actor_id) {
    stalePublication("已批准的交付物版本已不可用于本次操作。");
  }
  const parsed = ArtifactApprovalSnapshot.safeParse({
    approvalEventId: row.id,
    approvalState: "approved",
    artifactId: row.artifact_id,
    artifactRevisionId: row.artifact_revision_id,
    approvedArtifactRevision: row.artifact_revision,
    approvedArtifactContentHash: row.artifact_content_hash,
    reviewerActorId: row.reviewer_actor_id,
    qaGateVersion: row.qa_gate_version,
    qaGateSnapshot: row.qa_gate_snapshot,
    qaGateSnapshotHash: row.qa_gate_snapshot_hash,
    customerAcknowledgement: row.customer_acknowledgement,
    approvedAt: row.created_at,
  });
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "交付物批准记录未通过完整性校验。",
    );
  }
  return { row, snapshot: parsed.data };
}

function assertProjectActive(
  project: Awaited<ReturnType<ProjectsRepository["findById"]>>,
): void {
  if (!project) throw new ProblemError("NOT_FOUND", "项目不存在。");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "项目已归档。");
  }
}

function assertAuthorizationSnapshot(input: {
  readonly grant: Awaited<
    ReturnType<DeliveryAuthorizationGrantsRepository["findForUpdate"]>
  >;
  readonly actorId: string;
  readonly destination: PublicationDestinationRow;
  readonly purpose: "publish" | "rollback";
  readonly now: Date;
}): NonNullable<typeof input.grant> {
  const { grant } = input;
  if (!grant) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "本次发布授权不存在或不属于当前项目。",
    );
  }
  const snapshot = PublicationAuthorizationSnapshot.safeParse(
    grant.authorization_snapshot,
  );
  if (!snapshot.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "发布授权记录未通过完整性校验。",
    );
  }
  const expiresAt = grant.expires_at;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (
    grant.state !== "ready" ||
    grant.provider_kind !== input.destination.provider_kind ||
    grant.purpose !== input.purpose ||
    grant.destination_ref !== input.destination.destination_ref ||
    grant.destination_revision !== input.destination.revision ||
    grant.target_ref !== input.destination.target_ref ||
    snapshot.data.authorizationId !== grant.id ||
    snapshot.data.actorId !== input.actorId ||
    snapshot.data.purpose !== input.purpose ||
    snapshot.data.destinationRef !== input.destination.destination_ref ||
    snapshot.data.destinationRevision !== input.destination.revision ||
    snapshot.data.customerAcknowledgement.actorId !== input.actorId ||
    snapshot.data.expiresAt !== expiresAt ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= input.now.getTime()
  ) {
    stalePublication("本次发布授权已失效或与当前目标不一致。");
  }
  return grant;
}

function canonicalActionTarget(input: {
  readonly targets: Awaited<
    ReturnType<FindingTargetsRepository["listForFindings"]>
  >;
  readonly destination: PublicationDestinationRow;
}): void {
  const resolved = input.targets.filter(
    (target) => target.resolution_state === "resolved",
  );
  const root =
    resolved.find(
      (target) =>
        target.relation === "direct_url" && target.target_kind === "url",
    ) ??
    resolved[0] ??
    input.targets[0] ??
    null;
  if (
    !root ||
    root.site_id !== input.destination.site_id ||
    root.target_ref !== input.destination.target_ref
  ) {
    stalePublication("发布目标已不再对应当前 Action 的规范目标。");
  }
}

function publicationReader(
  exec: Executor,
  now?: Date,
): PublicationsRepository {
  return new PublicationsRepository(exec, {
    enqueue: () => {
      throw new Error("publication read path must not enqueue");
    },
    ...(now ? { clock: { now: () => now } } : {}),
  });
}

export class DefaultPublicationAttemptAuthority
  implements PublicationAttemptAuthority
{
  async loadPublishTarget(
    exec: Executor,
    input: {
      workspaceId: string;
      projectId: string;
      request: CreatePublicationAttemptRequestDto;
    },
  ) {
    assertProjectActive(
      await new ProjectsRepository(exec).findById(
        { workspaceId: input.workspaceId },
        input.projectId,
      ),
    );
    const destination = await new DeliveryConnectionsRepository(
      exec,
    ).findLatest(
      { workspaceId: input.workspaceId, projectId: input.projectId },
      input.request.destinationRef,
    );
    if (!destination) {
      throw new ProblemError("NOT_FOUND", "发布目标不存在。");
    }
    if (
      destination.revision !==
        input.request.expectedDestinationRevision ||
      destination.state !== "ready"
    ) {
      stalePublication("发布目标版本已变化或当前不可用。");
    }
    return {
      destinationRef: destination.destination_ref,
      targetRef: destination.target_ref,
    };
  }

  async resolvePublishFacts(
    tx: DbTx,
    input: {
      workspaceId: string;
      projectId: string;
      actorId: string;
      now: Date;
      request: CreatePublicationAttemptRequestDto;
    },
  ): Promise<ResolvedPublicationAttemptFacts> {
    const workspaceScope = { workspaceId: input.workspaceId };
    const projectScope = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    };
    assertProjectActive(
      await new ProjectsRepository(tx).findByIdForUpdate(
        workspaceScope,
        input.projectId,
      ),
    );
    const destination = await new DeliveryConnectionsRepository(
      tx,
    ).findLatest(projectScope, input.request.destinationRef, true);
    if (
      !destination ||
      destination.revision !==
        input.request.expectedDestinationRevision ||
      destination.state !== "ready"
    ) {
      stalePublication("发布目标版本已变化或当前不可用。");
    }
    const currentApproval = approvalSnapshot(
      await new ArtifactApprovalsRepository(tx).findCurrentApproval(
        projectScope,
        input.request.approvalEventId,
      ),
    );
    const artifacts = new ExecutionArtifactsRepository(tx);
    const artifact = await artifacts.findByIdForUpdate(
      projectScope,
      currentApproval.row.artifact_id,
    );
    const revision = artifact
      ? await artifacts.findRevision(
          projectScope,
          artifact.id,
          currentApproval.row.artifact_revision,
        )
      : null;
    if (
      !artifact ||
      !revision ||
      artifact.status !== "ready" ||
      artifact.validation_state !== "valid" ||
      artifact.current_revision !== currentApproval.row.artifact_revision ||
      artifact.content_hash !== currentApproval.row.artifact_content_hash ||
      revision.id !== currentApproval.row.artifact_revision_id ||
      revision.content_hash !== currentApproval.row.artifact_content_hash
    ) {
      stalePublication("交付物已经产生新版本，请重新审核后发布。");
    }
    const action = await new ActionsRepository(tx).findById(
      projectScope,
      artifact.action_id,
    );
    if (!action || action.status === "dismissed") {
      throw new ProblemError(
        "ACTION_NOT_EXECUTABLE",
        "当前 Action 不可执行。",
      );
    }
    const targets = await new FindingTargetsRepository(tx).listForFindings(
      projectScope,
      action.source_diagnostic_run_id,
      [action.source_finding_id],
    );
    canonicalActionTarget({ targets, destination });

    const grant = assertAuthorizationSnapshot({
      grant: await new DeliveryAuthorizationGrantsRepository(tx).findForUpdate(
        projectScope,
        input.request.authorizationGrantRef,
      ),
      actorId: input.actorId,
      destination,
      purpose: "publish",
      now: input.now,
    });
    const preview = await publicationReader(
      tx,
      input.now,
    ).findCurrentIssuedPreview(
      projectScope,
      { previewRef: input.request.previewRef },
      { lock: true },
    );
    const remotePrecondition = PublicationRemotePrecondition.safeParse(
      preview?.remote_precondition,
    );
    const rollbackPlan = PublicationRollbackPlan.safeParse(
      preview?.rollback_plan,
    );
    if (
      !preview ||
      preview.event_kind !== "issued" ||
      preview.preview_kind !== "publish" ||
      preview.workspace_id !== input.workspaceId ||
      preview.project_id !== input.projectId ||
      preview.site_id !== destination.site_id ||
      preview.destination_id !== destination.id ||
      preview.destination_ref !== destination.destination_ref ||
      preview.destination_revision !== destination.revision ||
      preview.provider_kind !== destination.provider_kind ||
      preview.target_ref !== destination.target_ref ||
      preview.action_id !== action.id ||
      preview.artifact_id !== artifact.id ||
      preview.artifact_revision_id !== revision.id ||
      preview.artifact_revision !== revision.revision ||
      preview.artifact_content_hash !== revision.content_hash ||
      preview.artifact_approval_event_id !== currentApproval.row.id ||
      preview.artifact_approval_event_kind !== "approved" ||
      preview.source_publication_attempt_id !== null ||
      preview.source_change_receipt_id !== null ||
      preview.provider_plan.providerKind !== destination.provider_kind ||
      preview.preview_checksum !== revision.content_hash ||
      typeof revision.content_text !== "string" ||
      revision.content_text.length < 1 ||
      preview.content_checksum !== sha256Hex(revision.content_text) ||
      !remotePrecondition.success ||
      !rollbackPlan.success ||
      rollbackPlan.data.providerKind !== destination.provider_kind ||
      publicationRequestHash(remotePrecondition.data) !==
        publicationRequestHash(input.request.remotePrecondition)
    ) {
      stalePublication(
        "当前 issued preview 已失效或与批准交付物不一致，请重新生成预览。",
      );
    }
    return {
      attemptKind: "publish",
      sourcePublicationAttemptId: null,
      siteId: destination.site_id,
      destination,
      actionId: action.id,
      artifactId: artifact.id,
      artifactRevisionId: revision.id,
      approvedArtifactRevision: revision.revision,
      approvedArtifactContentHash: revision.content_hash,
      publicationApprovalEventId: currentApproval.row.id,
      sourceApprovalEventId: null,
      authorizationGrant: grant,
      authorizationPurpose: "publish",
      previewEventId: preview.id,
      previewEventKind: "issued",
      previewFactsHash: preview.facts_hash,
      previewRef: preview.preview_ref,
      previewChecksum: preview.preview_checksum,
      contentChecksum: preview.content_checksum,
      remotePrecondition: remotePrecondition.data,
      rollbackPlan: rollbackPlan.data,
    };
  }

  async loadRollbackTarget(
    exec: Executor,
    input: {
      workspaceId: string;
      projectId: string;
      sourcePublicationAttemptId: string;
    },
  ) {
    const source = await publicationReader(exec).findAttemptById(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      },
      input.sourcePublicationAttemptId,
    );
    if (!source) {
      throw new ProblemError("NOT_FOUND", "源发布记录不存在。");
    }
    return {
      destinationRef: source.destination_ref,
      targetRef: source.target_ref,
    };
  }

  async resolveRollbackFacts(
    tx: DbTx,
    input: {
      workspaceId: string;
      projectId: string;
      sourcePublicationAttemptId: string;
      actorId: string;
      now: Date;
      request: CreatePublicationRollbackAttemptRequestDto;
    },
  ): Promise<ResolvedPublicationAttemptFacts> {
    const projectScope = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    };
    assertProjectActive(
      await new ProjectsRepository(tx).findByIdForUpdate(
        { workspaceId: input.workspaceId },
        input.projectId,
      ),
    );
    const sourceAttempt = await publicationReader(tx).findAttemptById(
      projectScope,
      input.sourcePublicationAttemptId,
      { lock: true },
    );
    if (!sourceAttempt) {
      throw new ProblemError("NOT_FOUND", "源发布记录不存在。");
    }
    const destination = await new DeliveryConnectionsRepository(
      tx,
    ).findLatest(projectScope, sourceAttempt.destination_ref, true);
    if (
      !destination ||
      destination.state !== "ready" ||
      destination.site_id !== sourceAttempt.site_id ||
      destination.provider_kind !== sourceAttempt.provider_kind ||
      destination.target_ref !== sourceAttempt.target_ref
    ) {
      stalePublication("当前发布目标已变化或不可用于回滚。");
    }
    const source = await new PublicationsRepository(tx, {
      enqueue: () => {
        throw new Error("rollback source lookup must not enqueue");
      },
    }).requireRollbackSource(projectScope, {
      sourcePublicationAttemptId: sourceAttempt.id,
      sourceChangeReceiptId: input.request.sourceChangeReceiptId,
      destinationRef: destination.destination_ref,
      providerKind: destination.provider_kind,
      targetRef: destination.target_ref,
    });
    if (
      source.changeReceipt.remote_revision !==
        input.request.expectedCurrentRemoteRevision ||
      source.changeReceipt.artifact_content_hash !==
        sourceAttempt.approved_artifact_content_hash ||
      source.changeReceipt.content_checksum !==
        sourceAttempt.content_checksum
    ) {
      stalePublication("远端内容版本已经变化，请重新生成回滚预览。");
    }
    const sourceApprovalId =
      sourceAttempt.publication_approval_event_id ??
      sourceAttempt.source_approval_event_id;
    const historicalApproval = approvalSnapshot(
      sourceApprovalId
        ? await new ArtifactApprovalsRepository(tx).findHistoricalApproval(
            projectScope,
            sourceApprovalId,
          )
        : null,
    );
    if (
      historicalApproval.row.artifact_id !== sourceAttempt.artifact_id ||
      historicalApproval.row.artifact_revision_id !==
        sourceAttempt.artifact_revision_id ||
      historicalApproval.row.artifact_revision !==
        sourceAttempt.approved_artifact_revision ||
      historicalApproval.row.artifact_content_hash !==
        sourceAttempt.approved_artifact_content_hash
    ) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "源发布批准记录与发布事实不一致。",
      );
    }
    const artifacts = new ExecutionArtifactsRepository(tx);
    const artifact = await artifacts.findById(
      projectScope,
      sourceAttempt.artifact_id,
    );
    const revision = artifact
      ? await artifacts.findRevision(
          projectScope,
          artifact.id,
          sourceAttempt.approved_artifact_revision,
        )
      : null;
    const action = artifact
      ? await new ActionsRepository(tx).findById(
          projectScope,
          sourceAttempt.action_id,
        )
      : null;
    if (
      !artifact ||
      !revision ||
      !action ||
      artifact.action_id !== action.id ||
      revision.id !== sourceAttempt.artifact_revision_id ||
      revision.content_hash !==
        sourceAttempt.approved_artifact_content_hash
    ) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "源发布交付物的不可变谱系不完整。",
      );
    }
    const grant = assertAuthorizationSnapshot({
      grant: await new DeliveryAuthorizationGrantsRepository(tx).findForUpdate(
        projectScope,
        input.request.authorizationGrantRef,
      ),
      actorId: input.actorId,
      destination,
      purpose: "rollback",
      now: input.now,
    });
    const preview = await publicationReader(
      tx,
      input.now,
    ).findCurrentIssuedPreview(
      projectScope,
      { previewRef: input.request.previewRef },
      { lock: true },
    );
    const remotePrecondition = PublicationRemotePrecondition.safeParse(
      preview?.remote_precondition,
    );
    const rollbackPlan = PublicationRollbackPlan.safeParse(
      preview?.rollback_plan,
    );
    if (
      !preview ||
      preview.event_kind !== "issued" ||
      preview.preview_kind !== "rollback" ||
      preview.workspace_id !== input.workspaceId ||
      preview.project_id !== input.projectId ||
      preview.site_id !== destination.site_id ||
      preview.destination_id !== destination.id ||
      preview.destination_ref !== destination.destination_ref ||
      preview.destination_revision !== destination.revision ||
      preview.provider_kind !== destination.provider_kind ||
      preview.target_ref !== destination.target_ref ||
      preview.action_id !== action.id ||
      preview.artifact_id !== artifact.id ||
      preview.artifact_revision_id !== revision.id ||
      preview.artifact_revision !== revision.revision ||
      preview.artifact_content_hash !== revision.content_hash ||
      preview.artifact_approval_event_id !==
        historicalApproval.row.id ||
      preview.artifact_approval_event_kind !== "approved" ||
      preview.source_publication_attempt_id !== sourceAttempt.id ||
      preview.source_change_receipt_id !== source.changeReceipt.id ||
      preview.provider_plan.providerKind !== destination.provider_kind ||
      preview.preview_checksum !==
        sourceAttempt.approved_artifact_content_hash ||
      preview.content_checksum !== sourceAttempt.content_checksum ||
      !remotePrecondition.success ||
      remotePrecondition.data.kind !== "must_match" ||
      remotePrecondition.data.revision !==
        input.request.expectedCurrentRemoteRevision ||
      !rollbackPlan.success ||
      rollbackPlan.data.providerKind !== destination.provider_kind ||
      rollbackPlan.data.expectedCurrentRemoteRevision !==
        input.request.expectedCurrentRemoteRevision
    ) {
      stalePublication(
        "当前 rollback issued preview 已失效或与源发布谱系不一致。",
      );
    }
    return {
      attemptKind: "rollback",
      sourcePublicationAttemptId: sourceAttempt.id,
      siteId: destination.site_id,
      destination,
      actionId: action.id,
      artifactId: artifact.id,
      artifactRevisionId: revision.id,
      approvedArtifactRevision: revision.revision,
      approvedArtifactContentHash: revision.content_hash,
      publicationApprovalEventId: null,
      sourceApprovalEventId: historicalApproval.row.id,
      authorizationGrant: grant,
      authorizationPurpose: "rollback",
      previewEventId: preview.id,
      previewEventKind: "issued",
      previewFactsHash: preview.facts_hash,
      previewRef: preview.preview_ref,
      previewChecksum: preview.preview_checksum,
      contentChecksum: preview.content_checksum,
      remotePrecondition: remotePrecondition.data,
      rollbackPlan: rollbackPlan.data,
    };
  }

  async readAttempt(
    exec: Executor,
    input: {
      workspaceId: string;
      projectId: string;
      publicationAttemptId: string;
    },
  ): Promise<PublicationAttemptReadFacts> {
    const projectScope = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    };
    const execution = await publicationReader(
      exec,
    ).loadAttemptHistory(
      projectScope,
      input.publicationAttemptId,
    );
    if (!execution) {
      throw new ProblemError("NOT_FOUND", "发布记录不存在。");
    }
    const latestDestination = await new DeliveryConnectionsRepository(
      exec,
    ).findLatest(
      projectScope,
      execution.attempt.destination_ref,
    );
    return {
      attempt: execution.attempt,
      run: execution.run,
      receipts: execution.receipts,
      latestDestinationState: latestDestination?.state ?? null,
    };
  }
}

function acceptedResult(
  projectId: string,
  result: PublicationAttemptTransactionResult,
): PublicationAttemptAcceptedResult {
  const accepted = PublicationAttemptAccepted.parse({
    publicationAttemptId: result.attempt.id,
    asyncRunId: result.attempt.async_run_id,
    state: "pending",
    replayed: result.replayed,
  });
  return {
    ...accepted,
    location: publicationAttemptStatusUrl(
      projectId,
      accepted.asyncRunId,
    ),
  };
}

function mapRepositoryError(
  error: unknown,
  projectId: string,
): never {
  if (error instanceof ProblemError) throw error;
  if (error instanceof PublicationIdempotencyConflictError) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key 已被不同的发布请求使用。",
    );
  }
  if (error instanceof PublicationAlreadyActiveError) {
    const location = error.activeRunId
      ? publicationAttemptStatusUrl(projectId, error.activeRunId)
      : null;
    throw new ProblemError(
      "RUN_ALREADY_ACTIVE",
      "同一发布目标已有进行中的发布任务。",
      {
        ...(location ? { headers: { Location: location } } : {}),
        current: error.activeRunId
          ? { runId: error.activeRunId, statusUrl: location }
          : null,
      },
    );
  }
  if (error instanceof PublicationInvariantError) {
    const staleCodes = new Set([
      "PUBLICATION_DESTINATION_STALE",
      "PUBLICATION_ATTEMPT_AUTHORIZATION_INVALID",
      "PUBLICATION_ATTEMPT_PREVIEW_INVALID",
      "PUBLICATION_PREVIEW_NOT_CURRENT",
      "ROLLBACK_SOURCE_CHANGE_NOT_VERIFIED",
      "ROLLBACK_SOURCE_APPROVAL_LINEAGE_INVALID",
    ]);
    if (staleCodes.has(error.code)) {
      throw new ProblemError(
        "STALE_REVISION",
        "发布所依据的目标、批准、授权或远端版本已经变化。",
      );
    }
    if (error.code === "PUBLICATION_IDEMPOTENCY_IN_PROGRESS") {
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "相同发布请求正在处理中。",
      );
    }
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "发布请求未能通过服务端完整性校验。",
    );
  }
  throw error;
}

function assertIdempotencyMatches(
  headerValue: string,
  bodyValue: string,
): void {
  if (headerValue !== bodyValue) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "请求体 idempotencyKey 必须与 Idempotency-Key 请求头一致。",
      {
        errors: [
          {
            pointer: "/idempotencyKey",
            code: "custom",
            message: "Must match the Idempotency-Key header.",
          },
        ],
      },
    );
  }
}

function requestExpiry(now: Date): string {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
}

function mapReceipt(
  row: PublicationReceiptRow,
): CustomerPublicationTimelineEvent {
  const receipt = PublicationReceipt.safeParse({
    id: row.id,
    receiptKind: row.receipt_kind,
    predecessorDeliveryReceiptId:
      row.predecessor_delivery_receipt_id,
    providerKind: row.provider_kind,
    providerRequestId: row.provider_request_id,
    remoteScopeRef: row.remote_scope_ref,
    remoteObjectKind: row.remote_object_kind,
    remoteObjectId: row.remote_object_id,
    remoteRevision: row.remote_revision,
    deliveryUrl: row.delivery_url,
    liveCanonicalUrl: row.live_canonical_url,
    artifactContentHash: row.artifact_content_hash,
    contentChecksum: row.content_checksum,
    verificationState: row.verification_state,
    remoteFacts: row.remote_facts,
    evidenceRefs: row.evidence_refs,
    limitation: row.limitation,
    observedAt: row.observed_at,
  });
  if (!receipt.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "发布回执未通过完整性校验。",
    );
  }
  return {
    kind: receipt.data.receiptKind,
    receiptId: receipt.data.id,
    verificationState: receipt.data.verificationState,
    remoteObjectKind: receipt.data.remoteObjectKind,
    remoteObjectId: receipt.data.remoteObjectId,
    remoteRevision: receipt.data.remoteRevision,
    deliveryUrl: receipt.data.deliveryUrl,
    liveCanonicalUrl: receipt.data.liveCanonicalUrl,
    artifactContentHash: receipt.data.artifactContentHash,
    contentChecksum: receipt.data.contentChecksum,
    limitation: receipt.data.limitation,
    occurredAt: receipt.data.observedAt,
  };
}

function honestAttemptState(
  facts: PublicationAttemptReadFacts,
): CustomerPublicationAttempt["state"] {
  if (facts.latestDestinationState === "revoked") return "revoked";
  if (
    facts.receipts.some(
      (receipt) =>
        receipt.receipt_kind === "change_receipt" &&
        receipt.verification_state === "verified_live",
    )
  ) {
    return "changed";
  }
  if (
    facts.run.status === "failed" ||
    facts.run.status === "cancelled" ||
    facts.run.status === "partial" ||
    facts.latestDestinationState === "unavailable" ||
    facts.receipts.some(
      (receipt) => receipt.verification_state === "unavailable",
    )
  ) {
    return "unavailable";
  }
  return "pending";
}

function toCustomerAttempt(
  facts: PublicationAttemptReadFacts,
): CustomerPublicationAttempt {
  const { attempt } = facts;
  const precondition = PublicationRemotePrecondition.safeParse(
    attempt.remote_precondition,
  );
  const rollbackPlan = PublicationRollbackPlan.safeParse(
    attempt.rollback_plan,
  );
  if (
    !precondition.success ||
    !rollbackPlan.success ||
    rollbackPlan.data.providerKind !== attempt.provider_kind ||
    !PublicationChecksum.safeParse(
      attempt.approved_artifact_content_hash,
    ).success ||
    !PublicationChecksum.safeParse(attempt.content_checksum).success ||
    attempt.preview_checksum !==
      attempt.approved_artifact_content_hash ||
    facts.receipts.some(
      (receipt) =>
        receipt.artifact_content_hash !==
          attempt.approved_artifact_content_hash ||
        receipt.content_checksum !== attempt.content_checksum,
    )
  ) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "发布记录未通过完整性校验。",
    );
  }
  const timeline: CustomerPublicationTimelineEvent[] = [
    {
      kind: "attempt_requested",
      receiptId: null,
      verificationState: "pending",
      remoteObjectKind: null,
      remoteObjectId: null,
      remoteRevision: null,
      deliveryUrl: null,
      liveCanonicalUrl: null,
      artifactContentHash: attempt.approved_artifact_content_hash,
      contentChecksum: attempt.content_checksum,
      limitation: null,
      occurredAt: attempt.requested_at,
    },
    ...facts.receipts.map(mapReceipt),
  ];
  return {
    id: attempt.id,
    attemptKind: attempt.attempt_kind,
    sourcePublicationAttemptId:
      attempt.source_publication_attempt_id,
    sourceChangeReceiptId: attempt.source_change_receipt_id,
    state: honestAttemptState(facts),
    run: toAsyncRunDto(facts.run),
    siteId: attempt.site_id,
    destinationRef: attempt.destination_ref,
    destinationRevision: attempt.destination_revision,
    providerKind: attempt.provider_kind,
    targetRef: attempt.target_ref,
    actionId: attempt.action_id,
    artifact: {
      id: attempt.artifact_id,
      revision: attempt.approved_artifact_revision,
      contentHash: attempt.approved_artifact_content_hash,
    },
    preview: {
      ref: attempt.preview_ref,
      artifactContentHash: attempt.preview_checksum,
      contentChecksum: attempt.content_checksum,
    },
    remotePrecondition: precondition.data,
    rollbackStrategy: rollbackPlan.data.strategy,
    requestedAt: attempt.requested_at,
    timeline,
  };
}

export function publicationAttemptStatusUrl(
  projectId: string,
  runId: string,
): string {
  return runStatusUrl(projectId, runId);
}

export function createPublicationAttemptService(
  dependencies: PublicationAttemptServiceDependencies,
) {
  return {
    async createPublish(
      scope: WorkspaceScope,
      projectId: string,
      actorId: string,
      idempotencyKey: string,
      request: CreatePublicationAttemptRequestDto,
    ): Promise<PublicationAttemptAcceptedResult> {
      const body = CreatePublicationAttemptRequest.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const requestHash = publicationRequestHash({
        operation: "publish",
        projectId,
        actorId,
        ...body,
      });
      const projectScope = {
        workspaceId: scope.workspaceId,
        projectId,
      };
      const commandNow = dependencies.now();
      const store = dependencies.createStore(
        dependencies.db,
        dependencies.enqueue,
        () => commandNow,
      );
      try {
        const replay = await store.replayByPermanentKey(
          projectScope,
          idempotencyKey,
          requestHash,
        );
        if (replay) return acceptedResult(projectId, replay);
        const target = await dependencies.authority.loadPublishTarget(
          dependencies.db,
          {
            ...projectScope,
            request: body,
          },
        );
        const result = await store.createAttemptAtomically({
          ...projectScope,
          destinationRef: target.destinationRef,
          targetRef: target.targetRef,
          idempotencyKey,
          requestHash,
          idempotencyExpiresAt: requestExpiry(commandNow),
          requestedBy: actorId,
          contractVersion: dependencies.contractVersion,
          resolveCurrentFacts: (tx) =>
            dependencies.authority.resolvePublishFacts(tx, {
              ...projectScope,
              actorId,
              now: commandNow,
              request: body,
            }),
        });
        return acceptedResult(projectId, result);
      } catch (error) {
        mapRepositoryError(error, projectId);
      }
    },

    async createRollback(
      scope: WorkspaceScope,
      projectId: string,
      sourcePublicationAttemptId: string,
      actorId: string,
      idempotencyKey: string,
      request: CreatePublicationRollbackAttemptRequestDto,
    ): Promise<PublicationAttemptAcceptedResult> {
      const body = CreatePublicationRollbackAttemptRequest.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const requestHash = publicationRequestHash({
        operation: "rollback",
        projectId,
        sourcePublicationAttemptId,
        actorId,
        ...body,
      });
      const projectScope = {
        workspaceId: scope.workspaceId,
        projectId,
      };
      const commandNow = dependencies.now();
      const store = dependencies.createStore(
        dependencies.db,
        dependencies.enqueue,
        () => commandNow,
      );
      try {
        const replay = await store.replayByPermanentKey(
          projectScope,
          idempotencyKey,
          requestHash,
        );
        if (replay) return acceptedResult(projectId, replay);
        const target = await dependencies.authority.loadRollbackTarget(
          dependencies.db,
          {
            ...projectScope,
            sourcePublicationAttemptId,
          },
        );
        const result = await store.createAttemptAtomically({
          ...projectScope,
          destinationRef: target.destinationRef,
          targetRef: target.targetRef,
          idempotencyKey,
          requestHash,
          idempotencyExpiresAt: requestExpiry(commandNow),
          requestedBy: actorId,
          contractVersion: dependencies.contractVersion,
          sourceChangeReceiptId: body.sourceChangeReceiptId,
          resolveCurrentFacts: (tx) =>
            dependencies.authority.resolveRollbackFacts(tx, {
              ...projectScope,
              sourcePublicationAttemptId,
              actorId,
              now: commandNow,
              request: body,
            }),
        });
        return acceptedResult(projectId, result);
      } catch (error) {
        mapRepositoryError(error, projectId);
      }
    },

    async getAttempt(
      scope: WorkspaceScope,
      projectId: string,
      publicationAttemptId: string,
    ): Promise<CustomerPublicationAttempt> {
      const facts = await dependencies.authority.readAttempt(
        dependencies.db,
        {
          workspaceId: scope.workspaceId,
          projectId,
          publicationAttemptId,
        },
      );
      return toCustomerAttempt(facts);
    },
  };
}

function productionDependencies(): PublicationAttemptServiceDependencies {
  const { db } = getDb();
  return {
    db,
    now: () => new Date(),
    contractVersion: PUBLICATION_CONTRACT_VERSION,
    authority: new DefaultPublicationAttemptAuthority(),
    enqueue: async (tx, payload) =>
      enqueueRunInTx(await getBoss(), tx, "publication", payload),
    createStore: (exec, enqueue, now) =>
      new PublicationsRepository(exec, {
        enqueue,
        clock: { now },
      }),
  };
}

export async function createPublicationAttempt(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  request: CreatePublicationAttemptRequestDto,
): Promise<PublicationAttemptAcceptedResult> {
  return createPublicationAttemptService(
    productionDependencies(),
  ).createPublish(scope, projectId, actorId, idempotencyKey, request);
}

export async function createPublicationRollbackAttempt(
  scope: WorkspaceScope,
  projectId: string,
  sourcePublicationAttemptId: string,
  actorId: string,
  idempotencyKey: string,
  request: CreatePublicationRollbackAttemptRequestDto,
): Promise<PublicationAttemptAcceptedResult> {
  return createPublicationAttemptService(
    productionDependencies(),
  ).createRollback(
    scope,
    projectId,
    sourcePublicationAttemptId,
    actorId,
    idempotencyKey,
    request,
  );
}

export async function getPublicationAttempt(
  scope: WorkspaceScope,
  projectId: string,
  publicationAttemptId: string,
): Promise<CustomerPublicationAttempt> {
  return createPublicationAttemptService(
    productionDependencies(),
  ).getAttempt(scope, projectId, publicationAttemptId);
}

/**
 * Reconciliation is intentionally fail-closed until a registered publication
 * worker can consume and terminalize a dedicated reconcile run. Enqueuing here
 * before that consumer exists would create a permanently queued "success".
 */
export async function reconcilePublicationAttempt(
  _scope: WorkspaceScope,
  _projectId: string,
  _publicationAttemptId: string,
  _actorId: string,
  _idempotencyKey: string,
  request: ReconcilePublicationAttemptRequestDto,
): Promise<never> {
  ReconcilePublicationAttemptRequest.parse(request);
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "发布结果自动核验尚未启用；当前不会创建或排队任何核验任务。",
  );
}
