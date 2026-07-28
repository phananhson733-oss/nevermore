import {
  CreateMeasurementWindowRequest as CreateMeasurementWindowRequestSchema,
  MeasurementWindowAccepted as MeasurementWindowAcceptedSchema,
  MeasurementTarget as MeasurementTargetSchema,
  MeasurementWindowHistoryResponse as MeasurementWindowHistoryResponseSchema,
  MeasurementWindowRecentResponse as MeasurementWindowRecentResponseSchema,
  type CreateMeasurementWindowRequest,
  type MeasurementWindowAccepted,
  type MeasurementTarget,
  type MeasurementWindowHistoryResponse,
  type MeasurementWindowRecentResponse,
} from "@sf/contracts";
import {
  ActionsRepository,
  contentHash,
  enqueueRunInTx,
  ExecutionArtifactsRepository,
  MAX_MEASUREMENT_WINDOW_HISTORY,
  MeasurementRunAlreadyActiveError,
  MeasurementRunAlreadyCompletedError,
  MeasurementRunIdempotencyConflictError,
  MeasurementWindowInvariantError,
  MeasurementWindowsRepository,
  ProjectsRepository,
  SitePagesRepository,
  type CanonicalValue,
  type DbTx,
  type Executor,
  type CreateMeasurementRunTransaction,
  type ProjectScope,
  type ResolvedMeasurementRunFacts,
  type RunJobPayload,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { runStatusUrl } from "./runs";

export const MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT =
  MAX_MEASUREMENT_WINDOW_HISTORY;
export const DEFAULT_MEASUREMENT_WINDOW_HISTORY_LIMIT = 50;
export const MAX_MEASUREMENT_WINDOW_RECENT_LIMIT =
  MAX_MEASUREMENT_WINDOW_HISTORY;
export const DEFAULT_MEASUREMENT_WINDOW_RECENT_LIMIT = 50;
export const MEASUREMENT_CONTRACT_VERSION = "measurement.0.1.0";
export const MEASUREMENT_WINDOW_DAYS = 28;
export const MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1_000;

interface MeasurementReceiptAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly publication_attempt_id: string;
  readonly receipt_kind: string;
  readonly predecessor_delivery_receipt_id: string | null;
  readonly provider_kind: string;
  readonly remote_scope_ref: string;
  readonly artifact_content_hash: string;
  readonly content_checksum: string;
  readonly verification_state: string;
  readonly live_canonical_url: string | null;
  readonly observed_at: string;
}

interface MeasurementAttemptAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly async_run_id: string;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly artifact_revision_id: string;
  readonly approved_artifact_revision: number;
  readonly approved_artifact_content_hash: string;
  readonly content_checksum: string;
}

interface MeasurementRunAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly status: string;
  readonly result_type: string | null;
  readonly result_id: string | null;
}

interface MeasurementActionAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
}

interface MeasurementArtifactAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly action_id: string;
}

interface MeasurementArtifactRevisionAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly artifact_id: string;
  readonly revision: number;
  readonly content_hash: string;
}

interface MeasurementSiteAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
}

interface MeasurementSitePageAuthorityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly normalized_url: string;
}

export interface MeasurementCurrentAuthorityFacts {
  readonly receipt: MeasurementReceiptAuthorityRow;
  readonly deliveryReceipt: MeasurementReceiptAuthorityRow;
  readonly attempt: MeasurementAttemptAuthorityRow;
  readonly run: MeasurementRunAuthorityRow;
  readonly action: MeasurementActionAuthorityRow;
  readonly artifact: MeasurementArtifactAuthorityRow;
  readonly artifactRevision: MeasurementArtifactRevisionAuthorityRow;
  readonly site: MeasurementSiteAuthorityRow;
  readonly sitePage: MeasurementSitePageAuthorityRow;
}

export type MeasurementWindowFrozenFacts = ResolvedMeasurementRunFacts;

export interface MeasurementWindowAuthority {
  loadCurrentFacts(
    exec: Executor,
    input: ProjectScope & {
      readonly changeReceiptId: string;
      readonly lock: true;
    },
  ): Promise<MeasurementCurrentAuthorityFacts | null>;
}

interface MeasurementRunCreateResult {
  readonly run: { readonly id: string };
  readonly measurementWindowId: string;
  readonly replayed: boolean;
}

export interface MeasurementWindowCreateStore {
  createRunAtomically(
    command: CreateMeasurementRunTransaction,
  ): Promise<MeasurementRunCreateResult>;
}

export interface MeasurementWindowCreateServiceDependencies {
  readonly db: Executor;
  readonly authority: MeasurementWindowAuthority;
  readonly createStore: (exec: Executor) => MeasurementWindowCreateStore;
  readonly contractVersion: string;
}

export type MeasurementWindowAcceptedResult = MeasurementWindowAccepted & {
  readonly location: string;
};

function measurementSourceNotFound(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "Verified publication Change Receipt not found.",
  );
}

function corruptMeasurementAuthority(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The publication evidence failed its Measurement Window integrity checks.",
  );
}

function sameProjectScope(
  row: { readonly workspace_id: string; readonly project_id: string },
  scope: ProjectScope,
): boolean {
  return (
    row.workspace_id === scope.workspaceId &&
    row.project_id === scope.projectId
  );
}

function parseAuthorityInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) corruptMeasurementAuthority();
  return parsed;
}

function checkedInstant(value: number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) corruptMeasurementAuthority();
  return date;
}

function freezeMeasurementFacts(
  scope: ProjectScope,
  changeReceiptId: string,
  facts: MeasurementCurrentAuthorityFacts | null,
): MeasurementWindowFrozenFacts {
  if (!facts) measurementSourceNotFound();

  const {
    receipt,
    deliveryReceipt,
    attempt,
    run,
    action,
    artifact,
    artifactRevision,
    site,
    sitePage,
  } = facts;

  // A Delivery Receipt is timeline evidence only. Even a broken dependency
  // returning one for this lookup cannot let it start the outcome clock.
  if (
    receipt.id !== changeReceiptId ||
    receipt.receipt_kind !== "change_receipt" ||
    receipt.verification_state !== "verified_live"
  ) {
    measurementSourceNotFound();
  }

  const canonicalUrl = receipt.live_canonical_url;
  if (
    !canonicalUrl ||
    ![
      receipt,
      deliveryReceipt,
      attempt,
      run,
      action,
      artifact,
      artifactRevision,
      site,
      sitePage,
    ].every((row) => sameProjectScope(row, scope)) ||
    receipt.site_id !== site.id ||
    attempt.id !== receipt.publication_attempt_id ||
    attempt.site_id !== site.id ||
    run.id !== attempt.async_run_id ||
    run.kind !== "publication" ||
    !["completed", "partial"].includes(run.status) ||
    run.result_type !== "publication_attempt" ||
    run.result_id !== attempt.id ||
    action.id !== attempt.action_id ||
    artifact.id !== attempt.artifact_id ||
    artifact.action_id !== action.id ||
    artifactRevision.id !== attempt.artifact_revision_id ||
    artifactRevision.artifact_id !== artifact.id ||
    artifactRevision.revision !== attempt.approved_artifact_revision ||
    artifactRevision.content_hash !==
      attempt.approved_artifact_content_hash ||
    receipt.artifact_content_hash !==
      attempt.approved_artifact_content_hash ||
    receipt.content_checksum !== attempt.content_checksum ||
    deliveryReceipt.id !== receipt.predecessor_delivery_receipt_id ||
    deliveryReceipt.receipt_kind !== "delivery_receipt" ||
    deliveryReceipt.predecessor_delivery_receipt_id !== null ||
    deliveryReceipt.publication_attempt_id !== attempt.id ||
    deliveryReceipt.site_id !== site.id ||
    deliveryReceipt.provider_kind !== receipt.provider_kind ||
    deliveryReceipt.remote_scope_ref !== receipt.remote_scope_ref ||
    deliveryReceipt.artifact_content_hash !==
      receipt.artifact_content_hash ||
    deliveryReceipt.content_checksum !== receipt.content_checksum ||
    sitePage.site_id !== site.id ||
    sitePage.normalized_url !== canonicalUrl
  ) {
    corruptMeasurementAuthority();
  }

  const changeAt = parseAuthorityInstant(receipt.observed_at);
  const deliveryAt = parseAuthorityInstant(deliveryReceipt.observed_at);
  if (deliveryAt >= changeAt) corruptMeasurementAuthority();

  const beforeStart = checkedInstant(
    changeAt - MEASUREMENT_WINDOW_DAYS * DAY_MS,
  );
  const changeInstant = checkedInstant(changeAt);
  const afterEnd = checkedInstant(
    changeAt + MEASUREMENT_WINDOW_DAYS * DAY_MS,
  );
  const startAfter = checkedInstant(
    afterEnd.getTime() +
      MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_DAYS * DAY_MS,
  );
  const target = MeasurementTargetSchema.safeParse({
    kind: "url",
    targetRef: `site-page://${sitePage.id}`,
    sitePageId: sitePage.id,
  });
  if (!target.success) corruptMeasurementAuthority();

  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    changeReceiptId: receipt.id,
    publicationAttemptId: attempt.id,
    siteId: site.id,
    sitePageId: sitePage.id,
    target: target.data,
    actionId: action.id,
    artifactId: artifact.id,
    artifactRevisionId: artifactRevision.id,
    artifactRevision: artifactRevision.revision,
    artifactContentHash: artifactRevision.content_hash,
    contentChecksum: receipt.content_checksum,
    timelineDeliveryReceiptId: deliveryReceipt.id,
    url: sitePage.normalized_url,
    canonicalUrl,
    beforeWindow: {
      startAt: beforeStart.toISOString(),
      endAt: changeInstant.toISOString(),
    },
    afterWindow: {
      startAt: changeInstant.toISOString(),
      endAt: afterEnd.toISOString(),
    },
    timezone: "UTC",
    interpretation: "observational_non_causal",
    startAfter: startAfter.toISOString(),
  };
}

function assertIdempotencyMatches(
  headerValue: string,
  bodyValue: string,
): void {
  if (headerValue === bodyValue) return;
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Request body idempotencyKey must match the Idempotency-Key header.",
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

function measurementRequestHash(
  scope: ProjectScope,
  actorId: string,
  request: CreateMeasurementWindowRequest,
): string {
  return contentHash({
    operation: "measurement_window.create",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actorId,
    request,
  } as CanonicalValue);
}

function mapMeasurementCreateError(
  error: unknown,
  projectId: string,
): never {
  if (error instanceof ProblemError) throw error;
  if (error instanceof MeasurementRunIdempotencyConflictError) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key 已被不同的 Measurement Window 请求使用。",
    );
  }
  if (error instanceof MeasurementRunAlreadyActiveError) {
    const location = error.activeRunId
      ? runStatusUrl(projectId, error.activeRunId)
      : null;
    throw new ProblemError(
      "RUN_ALREADY_ACTIVE",
      "该 Change Receipt 已有进行中的效果追踪任务。",
      {
        ...(location ? { headers: { Location: location } } : {}),
        current: error.activeRunId
          ? {
              runId: error.activeRunId,
              statusUrl: location,
            }
          : null,
      },
    );
  }
  if (error instanceof MeasurementRunAlreadyCompletedError) {
    const location = runStatusUrl(projectId, error.existingRunId);
    throw new ProblemError(
      "RUN_ALREADY_ACTIVE",
      "该 Change Receipt 已完成效果追踪，请查看已有结果。",
      {
        headers: { Location: location },
        current: {
          runId: error.existingRunId,
          statusUrl: location,
          measurementWindowId: error.measurementWindowId,
          state: "completed",
        },
      },
    );
  }
  if (error instanceof MeasurementWindowInvariantError) {
    const code: string = error.code;
    if (
      code === "MEASUREMENT_REPLAY_CONFLICT" ||
      code === "MEASUREMENT_IDEMPOTENCY_CONFLICT"
    ) {
      throw new ProblemError(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key reused with a different Measurement Window command.",
      );
    }
    if (
      code === "MEASUREMENT_SCOPE_INVALID" ||
      code === "MEASUREMENT_CHANGE_RECEIPT_INVALID"
    ) {
      measurementSourceNotFound();
    }
    corruptMeasurementAuthority();
  }
  throw error;
}

/**
 * Load all mutable authority again inside the repository's transaction. The
 * first and only accepted clock is the verified Change Receipt observedAt.
 */
export class DefaultMeasurementWindowAuthority
  implements MeasurementWindowAuthority
{
  async loadCurrentFacts(
    exec: Executor,
    input: ProjectScope & {
      readonly changeReceiptId: string;
      readonly lock: true;
    },
  ): Promise<MeasurementCurrentAuthorityFacts | null> {
    const scope = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    };
    const source = await new MeasurementWindowsRepository(
      exec,
    ).findChangeReceiptForMeasurement(
      scope,
      input.changeReceiptId,
      { lock: true },
    );
    if (!source) return null;

    // Action and Artifact are mutable customer-facing rows. Lock both while the
    // immutable publication revision is checked and the run payload is frozen.
    const action = await new ActionsRepository(exec).findByIdForUpdate(
      scope,
      source.attempt.action_id,
    );
    if (!action) return null;
    const artifacts = new ExecutionArtifactsRepository(exec);
    const artifact = await artifacts.findByIdForUpdate(
      scope,
      source.attempt.artifact_id,
    );
    if (!artifact) return null;
    const artifactRevision = await artifacts.findRevision(
      scope,
      source.attempt.artifact_id,
      source.attempt.approved_artifact_revision,
    );
    if (!artifactRevision) return null;

    return {
      ...source,
      action,
      artifact,
      artifactRevision,
    };
  }
}

export function createMeasurementWindowService(
  dependencies: MeasurementWindowCreateServiceDependencies,
) {
  return {
    async create(
      scope: WorkspaceScope,
      projectId: string,
      actorId: string,
      idempotencyKey: string,
      request: CreateMeasurementWindowRequest,
    ): Promise<MeasurementWindowAcceptedResult> {
      const body = CreateMeasurementWindowRequestSchema.parse(request);
      assertIdempotencyMatches(idempotencyKey, body.idempotencyKey);
      const projectScope = {
        workspaceId: scope.workspaceId,
        projectId,
      };
      const requestHash = measurementRequestHash(
        projectScope,
        actorId,
        body,
      );
      const store = dependencies.createStore(dependencies.db);

      try {
        const result = await store.createRunAtomically({
          ...projectScope,
          changeReceiptId: body.changeReceiptId,
          idempotencyKey,
          requestHash,
          requestedBy: actorId,
          contractVersion: dependencies.contractVersion,
          resolveCurrentFacts: async (tx) => {
            const current = await dependencies.authority.loadCurrentFacts(
              tx,
              {
                ...projectScope,
                changeReceiptId: body.changeReceiptId,
                lock: true,
              },
            );
            return freezeMeasurementFacts(
              projectScope,
              body.changeReceiptId,
              current,
            );
          },
        });
        const accepted = MeasurementWindowAcceptedSchema.parse({
          measurementWindowId: result.measurementWindowId,
          asyncRunId: result.run.id,
          state: "pending",
          replayed: result.replayed,
        });
        return {
          ...accepted,
          location: runStatusUrl(projectId, accepted.asyncRunId),
        };
      } catch (error) {
        mapMeasurementCreateError(error, projectId);
      }
    },
  };
}

function productionMeasurementCreateDependencies(): MeasurementWindowCreateServiceDependencies {
  const { db } = getDb();
  return {
    db,
    authority: new DefaultMeasurementWindowAuthority(),
    contractVersion: MEASUREMENT_CONTRACT_VERSION,
    createStore: (exec) =>
      new MeasurementWindowsRepository(exec, {
        enqueue: async (
          tx: DbTx,
          payload: RunJobPayload,
          options: { readonly startAfter: Date },
        ) =>
          enqueueRunInTx(
            await getBoss(),
            tx,
            "measurement",
            payload,
            options,
          ),
      }),
  };
}

export async function createMeasurementWindow(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  request: CreateMeasurementWindowRequest,
): Promise<MeasurementWindowAcceptedResult> {
  return createMeasurementWindowService(
    productionMeasurementCreateDependencies(),
  ).create(scope, projectId, actorId, idempotencyKey, request);
}

export interface MeasurementWindowHistoryReadOptions {
  readonly limit: number;
  /** Test/SSR clock seam. The value is captured once for the whole projection. */
  readonly generatedAt?: Date;
}

export interface MeasurementWindowRecentReadOptions {
  readonly limit: number;
  /** Test/SSR clock seam. The value is captured once for the whole projection. */
  readonly generatedAt?: Date;
}

interface ValidatedMeasurementHistoryRead {
  readonly target: MeasurementTarget;
  readonly limit: number;
  readonly generatedAt: string | null;
}

interface ValidatedMeasurementRecentRead {
  readonly limit: number;
  readonly generatedAt: string | null;
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function targetNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Measurement target not found.");
}

function corruptMeasurementHistory(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Measurement Window history failed its scope or integrity checks.",
  );
}

function sameTarget(
  left: MeasurementTarget,
  right: MeasurementTarget,
): boolean {
  return (
    left.kind === right.kind &&
    left.targetRef === right.targetRef &&
    left.sitePageId === right.sitePageId
  );
}

function validateRead(
  target: MeasurementTarget,
  options: MeasurementWindowHistoryReadOptions,
): ValidatedMeasurementHistoryRead {
  const parsedTarget = MeasurementTargetSchema.safeParse(target);
  if (!parsedTarget.success) {
    throw new RangeError("Invalid Measurement Window target");
  }
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT
  ) {
    throw new RangeError(
      `limit must be between 1 and ${MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT}`,
    );
  }
  const clock = options.generatedAt;
  if (clock !== undefined && !Number.isFinite(clock.getTime())) {
    throw new RangeError("generatedAt must be a valid Date");
  }
  return {
    target: parsedTarget.data,
    limit: options.limit,
    generatedAt: clock?.toISOString() ?? null,
  };
}

function validateRecentRead(
  options: MeasurementWindowRecentReadOptions,
): ValidatedMeasurementRecentRead {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_MEASUREMENT_WINDOW_RECENT_LIMIT
  ) {
    throw new RangeError(
      `limit must be between 1 and ${MAX_MEASUREMENT_WINDOW_RECENT_LIMIT}`,
    );
  }
  const clock = options.generatedAt;
  if (clock !== undefined && !Number.isFinite(clock.getTime())) {
    throw new RangeError("generatedAt must be a valid Date");
  }
  return {
    limit: options.limit,
    generatedAt: clock?.toISOString() ?? null,
  };
}

async function listHistoryInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  read: ValidatedMeasurementHistoryRead,
): Promise<MeasurementWindowHistoryResponse> {
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (
    !project ||
    project.id !== projectId ||
    project.workspace_id !== scope.workspaceId
  ) {
    projectNotFound();
  }

  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const page = await new SitePagesRepository(exec).findById(
    projectScope,
    read.target.sitePageId,
  );
  if (
    !page ||
    page.id !== read.target.sitePageId ||
    page.workspace_id !== scope.workspaceId ||
    page.project_id !== projectId ||
    read.target.targetRef !== `site-page://${page.id}`
  ) {
    targetNotFound();
  }

  let windows;
  try {
    windows = await new MeasurementWindowsRepository(exec).listByTarget(
      projectScope,
      read.target,
      { limit: read.limit },
    );
  } catch (error) {
    if (error instanceof MeasurementWindowInvariantError) {
      corruptMeasurementHistory();
    }
    throw error;
  }

  if (
    windows.some(
      (window) =>
        window.projectId !== projectId ||
        window.siteId !== page.site_id ||
        !sameTarget(window.target, read.target),
    )
  ) {
    corruptMeasurementHistory();
  }

  // With a production repeatable-read transaction, the first scoped read above
  // establishes the snapshot. Sampling after all rows have been read guarantees
  // that a later commit cannot appear with recordedAt after this generatedAt.
  const generatedAt = read.generatedAt ?? new Date().toISOString();
  const response = MeasurementWindowHistoryResponseSchema.safeParse({
    projectId,
    target: read.target,
    windows,
    generatedAt,
  });
  if (!response.success) corruptMeasurementHistory();
  return response.data;
}

/**
 * Read immutable Measurement Windows for one exact URL target, newest first.
 * An existing scoped target with no finalized windows is a successful empty
 * history; missing/foreign projects and SitePages remain non-enumerating 404s.
 */
export async function listProjectMeasurementWindowHistory(
  scope: WorkspaceScope,
  projectId: string,
  target: MeasurementTarget,
  options: MeasurementWindowHistoryReadOptions,
  exec?: Executor,
): Promise<MeasurementWindowHistoryResponse> {
  const read = validateRead(target, options);
  if (exec) return listHistoryInSnapshot(exec, scope, projectId, read);
  return getDb().db.transaction(
    (tx) => listHistoryInSnapshot(tx, scope, projectId, read),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function listRecentInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  read: ValidatedMeasurementRecentRead,
): Promise<MeasurementWindowRecentResponse> {
  const project = await new ProjectsRepository(exec).findById(
    scope,
    projectId,
  );
  if (
    !project ||
    project.id !== projectId ||
    project.workspace_id !== scope.workspaceId
  ) {
    projectNotFound();
  }

  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  let windows;
  try {
    windows = await new MeasurementWindowsRepository(exec).listRecent(
      projectScope,
      { limit: read.limit },
    );
  } catch (error) {
    if (error instanceof MeasurementWindowInvariantError) {
      corruptMeasurementHistory();
    }
    throw error;
  }

  if (windows.some((window) => window.projectId !== projectId)) {
    corruptMeasurementHistory();
  }

  // The read transaction establishes one project-scoped snapshot. Capture the
  // projection clock only after all canonical windows have been hydrated.
  const generatedAt = read.generatedAt ?? new Date().toISOString();
  const response = MeasurementWindowRecentResponseSchema.safeParse({
    projectId,
    windows,
    generatedAt,
  });
  if (!response.success) corruptMeasurementHistory();
  return response.data;
}

/**
 * Read complete immutable Measurement Windows across every URL target in one
 * project, newest first. This is a source projection for Results, not an
 * aggregate and not a claim of Action- or Artifact-attributed lift.
 */
export async function listProjectRecentMeasurementWindows(
  scope: WorkspaceScope,
  projectId: string,
  options: MeasurementWindowRecentReadOptions,
  exec?: Executor,
): Promise<MeasurementWindowRecentResponse> {
  const read = validateRecentRead(options);
  if (exec) return listRecentInSnapshot(exec, scope, projectId, read);
  return getDb().db.transaction(
    (tx) => listRecentInSnapshot(tx, scope, projectId, read),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
