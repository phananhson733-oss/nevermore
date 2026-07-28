import {
  IssuePublicationPreviewRequest,
  IssuePublicationPreviewResponse,
  IssuePublicationRollbackPreviewRequest,
  IssuePublicationRollbackPreviewResponse,
  PublicationDestinationScope,
  PublicationRemotePrecondition,
  PublicationRollbackPlan,
  RevokePublicationPreviewRequest,
  RevokePublicationPreviewResponse,
  type IssuePublicationPreviewRequest as IssuePublicationPreviewRequestDto,
  type IssuePublicationPreviewResponse as IssuePublicationPreviewResponseDto,
  type IssuePublicationRollbackPreviewRequest as IssuePublicationRollbackPreviewRequestDto,
  type IssuePublicationRollbackPreviewResponse as IssuePublicationRollbackPreviewResponseDto,
  type PublicationDestinationScope as PublicationDestinationScopeDto,
  type PublicationRemotePrecondition as PublicationRemotePreconditionDto,
  type PublicationRollbackPlan as PublicationRollbackPlanDto,
  type RevokePublicationPreviewRequest as RevokePublicationPreviewRequestDto,
  type RevokePublicationPreviewResponse as RevokePublicationPreviewResponseDto,
} from "@sf/contracts";
import {
  ActionsRepository,
  ArtifactApprovalsRepository,
  DeliveryConnectionsRepository,
  ExecutionArtifactsRepository,
  FindingTargetsRepository,
  ProjectsRepository,
  PublicationIdempotencyConflictError,
  PublicationInvariantError,
  PublicationsRepository,
  publicationRequestHash,
  sha256Hex,
  type ActionRow,
  type ArtifactApprovalEventRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type DbTx,
  type FindingTargetRow,
  type ProjectRow,
  type ProjectScope,
  type PublicationAttemptRow,
  type PublicationDestinationRow,
  type PublicationReceiptRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { z } from "zod";
import { getDb } from "@/lib/db";

const PREVIEW_FACTS_SCHEMA_VERSION = "publication-preview-facts.v1";
const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1_000;
const MIN_PREVIEW_TTL_MS = 60 * 1_000;
const MAX_PREVIEW_TTL_MS = 30 * 60 * 1_000;
const MAX_PROVIDER_PROBE_AGE_MS = 5 * 60 * 1_000;
const MAX_PROVIDER_PROBE_FUTURE_SKEW_MS = 30 * 1_000;

const nonEmptyText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

const ProviderProbeCommon = {
  observedAt: z.string().datetime({ offset: true }),
  providerRequestId: nonEmptyText(500).nullable(),
  remoteScopeRef: nonEmptyText(2_048),
  facts: z.record(z.string().trim().min(1).max(200), z.unknown()),
} as const;

const PublicationProviderPlan = z.discriminatedUnion("providerKind", [
  z
    .object({
      providerKind: z.literal("github"),
      probeKind: z.literal("github_publication_target"),
      ...ProviderProbeCommon,
    })
    .strict(),
  z
    .object({
      providerKind: z.literal("wordpress"),
      probeKind: z.literal("wordpress_publication_target"),
      ...ProviderProbeCommon,
    })
    .strict(),
]);

type PublicationProviderPlanDto = z.infer<
  typeof PublicationProviderPlan
>;

export interface PublicationPreviewPlannerInput {
  readonly providerKind: "github" | "wordpress";
  readonly destinationId: string;
  readonly destinationRef: string;
  readonly destinationRevision: number;
  readonly siteId: string;
  readonly targetRef: string;
  readonly providerScope: PublicationDestinationScopeDto;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly artifactRevision: number;
  readonly artifactContentHash: string;
  readonly artifactContentText: string;
}

export interface PublicationRollbackPreviewPlannerInput
  extends PublicationPreviewPlannerInput {
  readonly sourcePublicationAttemptId: string;
  readonly sourceChangeReceiptId: string;
  readonly sourceRemoteRevision: string;
  readonly sourceContentChecksum: string;
}

export interface PublicationPreviewPlannerResult {
  readonly providerPlan: PublicationProviderPlanDto;
  readonly remotePrecondition: PublicationRemotePreconditionDto;
  readonly rollbackPlan: PublicationRollbackPlanDto;
}

export interface PublicationPreviewPlanner {
  resolvePublish(
    input: PublicationPreviewPlannerInput,
  ): Promise<PublicationPreviewPlannerResult>;
  resolveRollback(
    input: PublicationRollbackPreviewPlannerInput,
  ): Promise<PublicationPreviewPlannerResult>;
}

interface ProjectRepositoryPort {
  findByIdForUpdate(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectRow | null>;
}

interface DeliveryConnectionsRepositoryPort {
  findLatest(
    scope: ProjectScope,
    destinationRef: string,
    lock?: boolean,
  ): Promise<PublicationDestinationRow | null>;
}

interface ArtifactApprovalsRepositoryPort {
  findCurrentApproval(
    scope: ProjectScope,
    approvalEventId: string,
  ): Promise<ArtifactApprovalEventRow | null>;
  findHistoricalApproval(
    scope: ProjectScope,
    approvalEventId: string,
  ): Promise<ArtifactApprovalEventRow | null>;
}

interface ExecutionArtifactsRepositoryPort {
  findByIdForUpdate(
    scope: ProjectScope,
    artifactId: string,
  ): Promise<ArtifactRow | null>;
  findById(
    scope: ProjectScope,
    artifactId: string,
  ): Promise<ArtifactRow | null>;
  findRevision(
    scope: ProjectScope,
    artifactId: string,
    revision: number,
  ): Promise<ArtifactRevisionRow | null>;
}

interface ActionsRepositoryPort {
  findById(
    scope: ProjectScope,
    actionId: string,
  ): Promise<ActionRow | null>;
}

interface FindingTargetsRepositoryPort {
  listForFindings(
    scope: ProjectScope,
    diagnosticRunId: string,
    findingIds: readonly string[],
  ): Promise<FindingTargetRow[]>;
}

interface PublicationsRepositoryPort {
  findAttemptById(
    scope: ProjectScope,
    attemptId: string,
    options?: { readonly lock?: boolean },
  ): Promise<PublicationAttemptRow | null>;
  requireRollbackSource(
    scope: ProjectScope,
    values: {
      sourcePublicationAttemptId: string;
      sourceChangeReceiptId: string;
      destinationRef: string;
      providerKind: "github" | "wordpress";
      targetRef: string;
    },
  ): Promise<{
    readonly attempt: PublicationAttemptRow;
    readonly changeReceipt: PublicationReceiptRow;
  }>;
  findCurrentIssuedPreview(
    scope: ProjectScope,
    values: {
      readonly previewRef: string;
      readonly previewEventId?: string;
    },
    options?: { readonly lock?: boolean },
  ): ReturnType<PublicationsRepository["findCurrentIssuedPreview"]>;
  issuePreview(
    values: Parameters<PublicationsRepository["issuePreview"]>[0],
  ): ReturnType<PublicationsRepository["issuePreview"]>;
  appendTerminalPreviewEvent(
    scope: ProjectScope,
    values: Parameters<
      PublicationsRepository["appendTerminalPreviewEvent"]
    >[1],
  ): ReturnType<PublicationsRepository["appendTerminalPreviewEvent"]>;
}

export interface PublicationPreviewRepositories {
  readonly projects: ProjectRepositoryPort;
  readonly connections: DeliveryConnectionsRepositoryPort;
  readonly approvals: ArtifactApprovalsRepositoryPort;
  readonly artifacts: ExecutionArtifactsRepositoryPort;
  readonly actions: ActionsRepositoryPort;
  readonly targets: FindingTargetsRepositoryPort;
  readonly publications: PublicationsRepositoryPort;
}

export interface PublicationPreviewPersistence {
  transaction<T>(
    operation: (
      repositories: PublicationPreviewRepositories,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface PublicationPreviewServiceDependencies {
  readonly persistence: PublicationPreviewPersistence;
  readonly planner: PublicationPreviewPlanner;
  readonly now: () => Date;
  readonly previewTtlMs?: number;
}

function assertIdempotencyMatches(
  headerValue: string,
  bodyValue: string,
): void {
  if (headerValue === bodyValue) return;
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

function assertActiveProject(project: ProjectRow | null): ProjectRow {
  if (!project) throw new ProblemError("NOT_FOUND", "项目不存在。");
  if (project.archived_at !== null) {
    throw new ProblemError("PROJECT_ARCHIVED", "项目已归档。");
  }
  return project;
}

function stalePreview(detail: string): never {
  throw new ProblemError("STALE_REVISION", detail);
}

function unavailablePreview(detail: string): never {
  throw new ProblemError("DEPENDENCY_UNAVAILABLE", detail);
}

function exactContentChecksum(revision: ArtifactRevisionRow): string {
  if (
    typeof revision.content_text !== "string" ||
    revision.content_text.length < 1
  ) {
    return unavailablePreview("交付物缺少可发布的精确内容。");
  }
  return sha256Hex(revision.content_text);
}

function assertDestination(
  row: PublicationDestinationRow | null,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly destinationRef: string;
    readonly expectedRevision: number;
  },
): {
  readonly destination: PublicationDestinationRow;
  readonly providerScope: PublicationDestinationScopeDto;
} {
  if (!row) throw new ProblemError("NOT_FOUND", "发布目标不存在。");
  if (
    row.workspace_id !== input.workspaceId ||
    row.project_id !== input.projectId ||
    row.destination_ref !== input.destinationRef ||
    row.revision !== input.expectedRevision ||
    row.state !== "ready"
  ) {
    return stalePreview("发布目标版本已变化或当前不可用。");
  }
  const providerScope = PublicationDestinationScope.safeParse(
    row.provider_scope,
  );
  if (
    !providerScope.success ||
    providerScope.data.providerKind !== row.provider_kind
  ) {
    return unavailablePreview("发布目标的 provider scope 不完整。");
  }
  return { destination: row, providerScope: providerScope.data };
}

function assertApproval(
  row: ArtifactApprovalEventRow | null,
  approvalEventId: string,
): ArtifactApprovalEventRow {
  if (
    !row ||
    row.id !== approvalEventId ||
    row.event_kind !== "approved"
  ) {
    return stalePreview("已批准的交付物版本已不可用于本次预览。");
  }
  return row;
}

function assertCanonicalTarget(
  targets: readonly FindingTargetRow[],
  destination: PublicationDestinationRow,
): void {
  const resolved = targets.filter(
    (target) => target.resolution_state === "resolved",
  );
  const canonical =
    resolved.find(
      (target) =>
        target.relation === "direct_url" &&
        target.target_kind === "url",
    ) ??
    resolved[0] ??
    targets[0] ??
    null;
  if (
    !canonical ||
    canonical.site_id !== destination.site_id ||
    canonical.target_ref !== destination.target_ref
  ) {
    stalePreview("交付物 Action 已不再对应当前发布目标。");
  }
}

async function resolveAction(
  repositories: PublicationPreviewRepositories,
  scope: ProjectScope,
  actionId: string,
  destination: PublicationDestinationRow,
): Promise<ActionRow> {
  const action = await repositories.actions.findById(scope, actionId);
  if (!action || action.status === "dismissed") {
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "当前 Action 不可生成发布预览。",
    );
  }
  const targets = await repositories.targets.listForFindings(
    scope,
    action.source_diagnostic_run_id,
    [action.source_finding_id],
  );
  assertCanonicalTarget(targets, destination);
  return action;
}

async function resolvePublishArtifact(
  repositories: PublicationPreviewRepositories,
  scope: ProjectScope,
  approval: ArtifactApprovalEventRow,
): Promise<{
  readonly artifact: ArtifactRow;
  readonly revision: ArtifactRevisionRow;
}> {
  const artifact = await repositories.artifacts.findByIdForUpdate(
    scope,
    approval.artifact_id,
  );
  const revision = artifact
    ? await repositories.artifacts.findRevision(
        scope,
        artifact.id,
        approval.artifact_revision,
      )
    : null;
  if (
    !artifact ||
    !revision ||
    artifact.status !== "ready" ||
    artifact.validation_state !== "valid" ||
    artifact.current_revision !== approval.artifact_revision ||
    artifact.content_hash !== approval.artifact_content_hash ||
    revision.id !== approval.artifact_revision_id ||
    revision.content_hash !== approval.artifact_content_hash
  ) {
    return stalePreview("交付物已产生新版本，请重新审核后生成预览。");
  }
  exactContentChecksum(revision);
  return { artifact, revision };
}

function parsePlan(
  raw: PublicationPreviewPlannerResult,
  providerKind: "github" | "wordpress",
  validationNow: Date,
): PublicationPreviewPlannerResult {
  const providerPlan = PublicationProviderPlan.safeParse(
    raw.providerPlan,
  );
  const remotePrecondition =
    PublicationRemotePrecondition.safeParse(raw.remotePrecondition);
  const rollbackPlan = PublicationRollbackPlan.safeParse(
    raw.rollbackPlan,
  );
  if (
    !providerPlan.success ||
    !remotePrecondition.success ||
    !rollbackPlan.success ||
    providerPlan.data.providerKind !== providerKind ||
    rollbackPlan.data.providerKind !== providerKind
  ) {
    return unavailablePreview(
      "Provider probe 未返回完整且同源的发布事实。",
    );
  }
  const observedAt = new Date(
    providerPlan.data.observedAt,
  ).getTime();
  const validationTime = validationNow.getTime();
  if (
    !Number.isFinite(validationTime) ||
    !Number.isFinite(observedAt) ||
    observedAt < validationTime - MAX_PROVIDER_PROBE_AGE_MS ||
    observedAt >
      validationTime + MAX_PROVIDER_PROBE_FUTURE_SKEW_MS
  ) {
    return unavailablePreview(
      "Provider probe 事实已过期或时钟无效，未创建发布权限。",
    );
  }
  return {
    providerPlan: providerPlan.data,
    remotePrecondition: remotePrecondition.data,
    rollbackPlan: rollbackPlan.data,
  };
}

function plannerInput(
  destination: PublicationDestinationRow,
  providerScope: PublicationDestinationScopeDto,
  action: ActionRow,
  artifact: ArtifactRow,
  revision: ArtifactRevisionRow,
): PublicationPreviewPlannerInput {
  if (
    revision.content_text === null ||
    revision.content_text.length < 1
  ) {
    return unavailablePreview("交付物缺少可发布的精确内容。");
  }
  return {
    providerKind: destination.provider_kind,
    destinationId: destination.id,
    destinationRef: destination.destination_ref,
    destinationRevision: destination.revision,
    siteId: destination.site_id,
    targetRef: destination.target_ref,
    providerScope,
    actionId: action.id,
    artifactId: artifact.id,
    artifactRevisionId: revision.id,
    artifactRevision: revision.revision,
    artifactContentHash: revision.content_hash,
    artifactContentText: revision.content_text,
  };
}

function previewRefFor(requestHash: string): string {
  return `prv_${requestHash}`;
}

function expiresAtFor(
  now: Date,
  previewTtlMs: number,
): string {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(previewTtlMs) ||
    previewTtlMs < MIN_PREVIEW_TTL_MS ||
    previewTtlMs > MAX_PREVIEW_TTL_MS
  ) {
    return unavailablePreview("发布预览时钟或有效期配置无效。");
  }
  return new Date(now.getTime() + previewTtlMs).toISOString();
}

function mapIssuedPreview(
  row: Awaited<
    ReturnType<PublicationsRepository["issuePreview"]>
  >,
):
  | IssuePublicationPreviewResponseDto
  | IssuePublicationRollbackPreviewResponseDto {
  const common = {
    previewEventId: row.id,
    previewRef: row.preview_ref,
    eventKind: row.event_kind,
    factsSchemaVersion: row.facts_schema_version,
    previewKind: row.preview_kind,
    siteId: row.site_id,
    destinationId: row.destination_id,
    destinationRef: row.destination_ref,
    destinationRevision: row.destination_revision,
    providerKind: row.provider_kind,
    targetRef: row.target_ref,
    actionId: row.action_id,
    artifactId: row.artifact_id,
    artifactRevisionId: row.artifact_revision_id,
    artifactRevision: row.artifact_revision,
    artifactContentHash: row.artifact_content_hash,
    artifactApprovalEventId: row.artifact_approval_event_id,
    sourcePublicationAttemptId:
      row.source_publication_attempt_id,
    sourceChangeReceiptId: row.source_change_receipt_id,
    remotePrecondition: row.remote_precondition,
    rollbackPlan: row.rollback_plan,
    previewChecksum: row.preview_checksum,
    contentChecksum: row.content_checksum,
    factsHash: row.facts_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
  return row.preview_kind === "publish"
    ? IssuePublicationPreviewResponse.parse(common)
    : IssuePublicationRollbackPreviewResponse.parse(common);
}

function mapPreviewRepositoryError(error: unknown): never {
  if (error instanceof ProblemError) throw error;
  if (error instanceof PublicationIdempotencyConflictError) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key 已被不同的发布预览请求使用。",
    );
  }
  if (error instanceof PublicationInvariantError) {
    const staleCodes = new Set([
      "PUBLICATION_PREVIEW_SCOPE_INVALID",
      "PUBLICATION_PREVIEW_NOT_CURRENT",
      "PUBLICATION_ATTEMPT_PREVIEW_INVALID",
    ]);
    if (staleCodes.has(error.code)) {
      throw new ProblemError(
        "STALE_REVISION",
        "发布预览所依据的目标、批准或远端事实已经变化。",
      );
    }
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "发布预览未通过服务端完整性校验。",
    );
  }
  throw error;
}

function productionRepositories(
  tx: DbTx,
): PublicationPreviewRepositories {
  const publications = new PublicationsRepository(tx, {
    enqueue: () => {
      throw new Error("publication preview path must not enqueue");
    },
  });
  return {
    projects: new ProjectsRepository(tx),
    connections: new DeliveryConnectionsRepository(tx),
    approvals: new ArtifactApprovalsRepository(tx),
    artifacts: new ExecutionArtifactsRepository(tx),
    actions: new ActionsRepository(tx),
    targets: new FindingTargetsRepository(tx),
    publications,
  };
}

export function createUnavailablePublicationPreviewPlanner(): PublicationPreviewPlanner {
  const unavailable = (): never =>
    unavailablePreview(
      "发布 provider probe 与凭据解析设施尚未配置；未创建任何发布权限。",
    );
  return {
    async resolvePublish() {
      return unavailable();
    },
    async resolveRollback() {
      return unavailable();
    },
  };
}

export function createPublicationPreviewService(
  dependencies: PublicationPreviewServiceDependencies,
) {
  const previewTtlMs =
    dependencies.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;

  return {
    async issuePublish(
      scope: WorkspaceScope,
      projectId: string,
      actorId: string,
      idempotencyKey: string,
      request: IssuePublicationPreviewRequestDto,
    ): Promise<IssuePublicationPreviewResponseDto> {
      const body = IssuePublicationPreviewRequest.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const requestHash = publicationRequestHash({
        operation: "issue_publish_preview",
        workspaceId: scope.workspaceId,
        projectId,
        actorId,
        ...body,
      });
      const previewRef = previewRefFor(requestHash);
      const commandNow = dependencies.now();
      const expiresAt = expiresAtFor(commandNow, previewTtlMs);
      try {
        return await dependencies.persistence.transaction(
          async (repositories) => {
            const projectScope = {
              workspaceId: scope.workspaceId,
              projectId,
            };
            assertActiveProject(
              await repositories.projects.findByIdForUpdate(
                scope,
                projectId,
              ),
            );

            const replay =
              await repositories.publications.findCurrentIssuedPreview(
                projectScope,
                { previewRef },
                { lock: true },
              );
            if (replay) {
              if (
                replay.idempotency_key !== idempotencyKey ||
                replay.request_hash !== requestHash ||
                replay.preview_kind !== "publish"
              ) {
                throw new PublicationIdempotencyConflictError(
                  "publication preview idempotency key was reused",
                );
              }
              return IssuePublicationPreviewResponse.parse(
                mapIssuedPreview(replay),
              );
            }

            const { destination, providerScope } = assertDestination(
              await repositories.connections.findLatest(
                projectScope,
                body.destinationRef,
                true,
              ),
              {
                ...projectScope,
                destinationRef: body.destinationRef,
                expectedRevision: body.expectedDestinationRevision,
              },
            );
            const approval = assertApproval(
              await repositories.approvals.findCurrentApproval(
                projectScope,
                body.approvalEventId,
              ),
              body.approvalEventId,
            );
            const { artifact, revision } =
              await resolvePublishArtifact(
                repositories,
                projectScope,
                approval,
              );
            const action = await resolveAction(
              repositories,
              projectScope,
              artifact.action_id,
              destination,
            );
            const plan = parsePlan(
              await dependencies.planner.resolvePublish(
                plannerInput(
                  destination,
                  providerScope,
                  action,
                  artifact,
                  revision,
                ),
              ),
              destination.provider_kind,
              dependencies.now(),
            );
            const row = await repositories.publications.issuePreview({
              previewRef,
              previewKind: "publish",
              factsSchemaVersion: PREVIEW_FACTS_SCHEMA_VERSION,
              ...projectScope,
              siteId: destination.site_id,
              destination,
              actionId: action.id,
              artifactId: artifact.id,
              artifactRevisionId: revision.id,
              artifactRevision: revision.revision,
              artifactContentHash: revision.content_hash,
              artifactApprovalEventId: approval.id,
              sourcePublicationAttemptId: null,
              sourceChangeReceiptId: null,
              providerPlan: plan.providerPlan,
              remotePrecondition: plan.remotePrecondition,
              rollbackPlan: plan.rollbackPlan,
              previewChecksum: revision.content_hash,
              contentChecksum: exactContentChecksum(revision),
              expiresAt,
              eventActorId: actorId,
              idempotencyKey,
              requestHash,
            });
            return IssuePublicationPreviewResponse.parse(
              mapIssuedPreview(row),
            );
          },
        );
      } catch (error) {
        mapPreviewRepositoryError(error);
      }
    },

    async issueRollback(
      scope: WorkspaceScope,
      projectId: string,
      actorId: string,
      idempotencyKey: string,
      request: IssuePublicationRollbackPreviewRequestDto,
    ): Promise<IssuePublicationRollbackPreviewResponseDto> {
      const body =
        IssuePublicationRollbackPreviewRequest.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const requestHash = publicationRequestHash({
        operation: "issue_rollback_preview",
        workspaceId: scope.workspaceId,
        projectId,
        actorId,
        ...body,
      });
      const previewRef = previewRefFor(requestHash);
      const commandNow = dependencies.now();
      const expiresAt = expiresAtFor(commandNow, previewTtlMs);
      try {
        return await dependencies.persistence.transaction(
          async (repositories) => {
            const projectScope = {
              workspaceId: scope.workspaceId,
              projectId,
            };
            assertActiveProject(
              await repositories.projects.findByIdForUpdate(
                scope,
                projectId,
              ),
            );

            const replay =
              await repositories.publications.findCurrentIssuedPreview(
                projectScope,
                { previewRef },
                { lock: true },
              );
            if (replay) {
              if (
                replay.idempotency_key !== idempotencyKey ||
                replay.request_hash !== requestHash ||
                replay.preview_kind !== "rollback"
              ) {
                throw new PublicationIdempotencyConflictError(
                  "publication preview idempotency key was reused",
                );
              }
              return IssuePublicationRollbackPreviewResponse.parse(
                mapIssuedPreview(replay),
              );
            }

            const { destination, providerScope } = assertDestination(
              await repositories.connections.findLatest(
                projectScope,
                body.destinationRef,
                true,
              ),
              {
                ...projectScope,
                destinationRef: body.destinationRef,
                expectedRevision: body.expectedDestinationRevision,
              },
            );
            const sourceAttempt =
              await repositories.publications.findAttemptById(
                projectScope,
                body.sourcePublicationAttemptId,
                { lock: true },
              );
            if (!sourceAttempt) {
              throw new ProblemError(
                "NOT_FOUND",
                "源发布记录不存在。",
              );
            }
            if (
              sourceAttempt.site_id !== destination.site_id ||
              sourceAttempt.destination_ref !==
                destination.destination_ref ||
              sourceAttempt.provider_kind !==
                destination.provider_kind ||
              sourceAttempt.target_ref !== destination.target_ref
            ) {
              return stalePreview("源发布记录与当前发布目标不一致。");
            }
            const source =
              await repositories.publications.requireRollbackSource(
                projectScope,
                {
                  sourcePublicationAttemptId: sourceAttempt.id,
                  sourceChangeReceiptId: body.sourceChangeReceiptId,
                  destinationRef: destination.destination_ref,
                  providerKind: destination.provider_kind,
                  targetRef: destination.target_ref,
                },
              );
            const sourceApprovalId =
              sourceAttempt.publication_approval_event_id ??
              sourceAttempt.source_approval_event_id;
            if (!sourceApprovalId) {
              return unavailablePreview(
                "源发布记录缺少批准谱系。",
              );
            }
            const approval = assertApproval(
              await repositories.approvals.findHistoricalApproval(
                projectScope,
                sourceApprovalId,
              ),
              sourceApprovalId,
            );
            const artifact = await repositories.artifacts.findById(
              projectScope,
              sourceAttempt.artifact_id,
            );
            const revision = artifact
              ? await repositories.artifacts.findRevision(
                  projectScope,
                  artifact.id,
                  sourceAttempt.approved_artifact_revision,
                )
              : null;
            if (
              !artifact ||
              !revision ||
              artifact.action_id !== sourceAttempt.action_id ||
              revision.id !== sourceAttempt.artifact_revision_id ||
              revision.content_hash !==
                sourceAttempt.approved_artifact_content_hash ||
              approval.artifact_id !== artifact.id ||
              approval.artifact_revision_id !== revision.id ||
              approval.artifact_revision !== revision.revision ||
              approval.artifact_content_hash !== revision.content_hash ||
              source.changeReceipt.remote_revision.length < 1 ||
              source.changeReceipt.artifact_content_hash !==
                sourceAttempt.approved_artifact_content_hash ||
              source.changeReceipt.content_checksum !==
                sourceAttempt.content_checksum ||
              exactContentChecksum(revision) !==
                sourceAttempt.content_checksum
            ) {
              return unavailablePreview(
                "源发布交付物或 verified Change Receipt 谱系不完整。",
              );
            }
            const action = await resolveAction(
              repositories,
              projectScope,
              artifact.action_id,
              destination,
            );
            const plan = parsePlan(
              await dependencies.planner.resolveRollback({
                ...plannerInput(
                  destination,
                  providerScope,
                  action,
                  artifact,
                  revision,
                ),
                sourcePublicationAttemptId: sourceAttempt.id,
                sourceChangeReceiptId: source.changeReceipt.id,
                sourceRemoteRevision:
                  source.changeReceipt.remote_revision,
                sourceContentChecksum:
                  source.changeReceipt.content_checksum,
              }),
              destination.provider_kind,
              dependencies.now(),
            );
            if (
              plan.remotePrecondition.kind !== "must_match" ||
              plan.remotePrecondition.revision !==
                source.changeReceipt.remote_revision ||
              plan.rollbackPlan.expectedCurrentRemoteRevision !==
                source.changeReceipt.remote_revision
            ) {
              return stalePreview(
                "Provider probe 显示远端版本已变化，不能签发回滚预览。",
              );
            }
            const row = await repositories.publications.issuePreview({
              previewRef,
              previewKind: "rollback",
              factsSchemaVersion: PREVIEW_FACTS_SCHEMA_VERSION,
              ...projectScope,
              siteId: destination.site_id,
              destination,
              actionId: action.id,
              artifactId: artifact.id,
              artifactRevisionId: revision.id,
              artifactRevision: revision.revision,
              artifactContentHash: revision.content_hash,
              artifactApprovalEventId: approval.id,
              sourcePublicationAttemptId: sourceAttempt.id,
              sourceChangeReceiptId: source.changeReceipt.id,
              providerPlan: plan.providerPlan,
              remotePrecondition: plan.remotePrecondition,
              rollbackPlan: plan.rollbackPlan,
              previewChecksum: revision.content_hash,
              contentChecksum: sourceAttempt.content_checksum,
              expiresAt,
              eventActorId: actorId,
              idempotencyKey,
              requestHash,
            });
            return IssuePublicationRollbackPreviewResponse.parse(
              mapIssuedPreview(row),
            );
          },
        );
      } catch (error) {
        mapPreviewRepositoryError(error);
      }
    },

    async revoke(
      scope: WorkspaceScope,
      projectId: string,
      previewEventId: string,
      previewRef: string,
      actorId: string,
      idempotencyKey: string,
      request: RevokePublicationPreviewRequestDto,
    ): Promise<RevokePublicationPreviewResponseDto> {
      const body = RevokePublicationPreviewRequest.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const requestHash = publicationRequestHash({
        operation: "revoke_publication_preview",
        workspaceId: scope.workspaceId,
        projectId,
        previewEventId,
        previewRef,
        actorId,
        ...body,
      });
      try {
        return await dependencies.persistence.transaction(
          async (repositories) => {
            const row =
              await repositories.publications.appendTerminalPreviewEvent(
                {
                  workspaceId: scope.workspaceId,
                  projectId,
                },
                {
                  sourcePreviewEventId: previewEventId,
                  previewRef,
                  eventKind: "revoked",
                  eventActorId: actorId,
                  idempotencyKey,
                  requestHash,
                  reason: body.reason,
                },
              );
            return RevokePublicationPreviewResponse.parse({
              terminalEventId: row.id,
              eventKind: row.event_kind,
              supersededPreviewEventId:
                row.supersedes_preview_event_id,
              previewRef: row.preview_ref,
              createdAt: row.created_at,
            });
          },
        );
      } catch (error) {
        mapPreviewRepositoryError(error);
      }
    },
  };
}

function productionDependencies(): PublicationPreviewServiceDependencies {
  const { db } = getDb();
  return {
    persistence: {
      transaction: (operation) =>
        db.transaction(
          (tx) => operation(productionRepositories(tx)),
          { isolationLevel: "repeatable read" },
        ),
    },
    planner: createUnavailablePublicationPreviewPlanner(),
    now: () => new Date(),
  };
}

export async function issuePublicationPreview(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  request: IssuePublicationPreviewRequestDto,
): Promise<IssuePublicationPreviewResponseDto> {
  return createPublicationPreviewService(
    productionDependencies(),
  ).issuePublish(scope, projectId, actorId, idempotencyKey, request);
}

export async function issuePublicationRollbackPreview(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  request: IssuePublicationRollbackPreviewRequestDto,
): Promise<IssuePublicationRollbackPreviewResponseDto> {
  return createPublicationPreviewService(
    productionDependencies(),
  ).issueRollback(scope, projectId, actorId, idempotencyKey, request);
}

export async function revokePublicationPreview(
  scope: WorkspaceScope,
  projectId: string,
  previewEventId: string,
  previewRef: string,
  actorId: string,
  idempotencyKey: string,
  request: RevokePublicationPreviewRequestDto,
): Promise<RevokePublicationPreviewResponseDto> {
  return createPublicationPreviewService(
    productionDependencies(),
  ).revoke(
    scope,
    projectId,
    previewEventId,
    previewRef,
    actorId,
    idempotencyKey,
    request,
  );
}
