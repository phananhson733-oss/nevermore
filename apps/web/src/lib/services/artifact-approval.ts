import {
  ArtifactApprovalConflictError,
  ArtifactApprovalsRepository,
  contentHash,
  ExecutionArtifactsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowRunsRepository,
  IdempotencyRepository,
  ProjectsRepository,
  type ArtifactApprovalEventRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  ArtifactApprovalEvent,
  type AppendArtifactApprovalEventRequest,
  type ArtifactApprovalEvent as ArtifactApprovalEventDto,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { isPostgresUniqueViolation } from "./db-errors";

const IDEMPOTENCY_SCOPE = "appendArtifactApprovalEvent";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CONTENT_SHADOW_DRAFT_ARTIFACT_TYPE = "english_blog_draft";

/**
 * Version of the server-owned gate used by Artifact types whose canonical QA
 * authority is their immutable revision validation record.
 *
 * Content Shadow drafts use their pinned Flow adapter version instead; this
 * constant therefore never pretends that the richer SEO/GEO gate ran.
 */
export const ARTIFACT_VALIDATION_QA_GATE_VERSION =
  "artifact-validation.1" as const;

interface QaGateAuthority {
  readonly version: string;
  readonly snapshot: Record<string, unknown>;
}

interface IdempotencyReplayRow {
  readonly request_hash: string;
  readonly status: string;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
}

function dependencyUnavailable(detail: string): ProblemError {
  return new ProblemError("DEPENDENCY_UNAVAILABLE", detail);
}

function staleRevision(detail: string): ProblemError {
  return new ProblemError("STALE_REVISION", detail);
}

function artifactNotReady(): ProblemError {
  return new ProblemError(
    "ARTIFACT_VALIDATION_FAILED",
    "Only the exact current ready and valid Artifact Revision can be approved.",
  );
}

function qaVersionConflict(currentVersion: string): ProblemError {
  return new ProblemError(
    "VERSION_CONFLICT",
    "The Artifact quality gate changed; refetch it and review the current gate.",
    { current: { qaGateVersion: currentVersion } },
  );
}

function requestHashFor(
  projectId: string,
  artifactId: string,
  actorId: string,
  body: AppendArtifactApprovalEventRequest,
): string {
  return contentHash({
    projectId,
    artifactId,
    // Approval authority belongs to the authenticated reviewer. A key first
    // used by reviewer A may not replay as reviewer B's command.
    actorId,
    command: body,
  });
}

function canonicalRecordedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw dependencyUnavailable(
      "The stored Artifact approval timestamp is unreadable.",
    );
  }
  return parsed.toISOString();
}

function toArtifactApprovalEvent(
  row: ArtifactApprovalEventRow,
): ArtifactApprovalEventDto {
  const candidate = {
    approvalEventId: row.id,
    eventKind: row.event_kind,
    supersedesApprovalEventId: row.supersedes_approval_event_id,
    eventActorId: row.event_actor_id,
    artifactId: row.artifact_id,
    artifactRevisionId: row.artifact_revision_id,
    artifactRevision: row.artifact_revision,
    artifactContentHash: row.artifact_content_hash,
    reviewerActorId: row.reviewer_actor_id,
    qaGateVersion: row.qa_gate_version,
    qaGateSnapshot: row.qa_gate_snapshot,
    qaGateSnapshotHash: row.qa_gate_snapshot_hash,
    customerAcknowledgement: row.customer_acknowledgement,
    reason: row.reason,
    recordedAt: canonicalRecordedAt(row.created_at),
  };
  const parsed = ArtifactApprovalEvent.safeParse(candidate);
  if (!parsed.success) {
    throw dependencyUnavailable(
      "The stored Artifact approval event is unreadable.",
    );
  }
  return parsed.data;
}

function replayOrConflict(
  row: IdempotencyReplayRow,
  requestHash: string,
): ArtifactApprovalEventDto {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different Artifact approval command.",
    );
  }
  if (row.status !== "completed") {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Artifact approval command is already being processed.",
    );
  }
  const parsed = ArtifactApprovalEvent.safeParse(row.response_body);
  if (
    !parsed.success ||
    row.response_status !== 201 ||
    row.resource_type !== "artifact_approval_event" ||
    row.resource_id !== parsed.data.approvalEventId
  ) {
    throw dependencyUnavailable(
      "The stored Artifact approval replay is unreadable.",
    );
  }
  return parsed.data;
}

function assertExactReadyRevision(
  artifact: ArtifactRow,
  revision: ArtifactRevisionRow,
  body: Extract<
    AppendArtifactApprovalEventRequest,
    { eventKind: "approved" }
  >,
): void {
  if (
    artifact.current_revision !== body.expectedArtifactRevision ||
    revision.revision !== body.expectedArtifactRevision ||
    artifact.content_hash !== revision.content_hash
  ) {
    throw staleRevision(
      "The Artifact changed after it was reviewed; refetch the current revision.",
    );
  }
  if (
    artifact.status !== "ready" ||
    artifact.validation_state !== "valid" ||
    revision.validation_errors.length > 0
  ) {
    throw artifactNotReady();
  }
}

async function resolveQaGate(
  exec: Executor,
  scope: ProjectScope,
  artifact: ArtifactRow,
  revision: ArtifactRevisionRow,
): Promise<QaGateAuthority> {
  if (artifact.artifact_type !== CONTENT_SHADOW_DRAFT_ARTIFACT_TYPE) {
    return {
      version: ARTIFACT_VALIDATION_QA_GATE_VERSION,
      snapshot: {
        authority: "artifact_revision_validation",
        artifactId: artifact.id,
        artifactRevisionId: revision.id,
        artifactRevision: revision.revision,
        artifactContentHash: revision.content_hash,
        artifactType: artifact.artifact_type,
        artifactStatus: artifact.status,
        validationState: artifact.validation_state,
        validationErrors: [...revision.validation_errors],
      },
    };
  }

  const gate = await new FlowShadowQaGatesRepository(
    exec,
  ).findLatestByArtifact(scope, artifact.id);
  if (!gate) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "This English Blog draft has no automated QA judgement to approve.",
    );
  }
  if (
    gate.evaluated_artifact_id !== artifact.id ||
    gate.evaluated_revision !== revision.revision
  ) {
    throw staleRevision(
      "The latest Content Shadow QA judgement does not describe the current Artifact Revision.",
    );
  }
  if (gate.verdict === "blocked") {
    throw artifactNotReady();
  }

  const shadowRun = await new FlowShadowRunsRepository(exec).findById(
    scope,
    gate.flow_shadow_run_id,
  );
  if (!shadowRun) {
    throw dependencyUnavailable(
      "The Content Shadow QA authority is temporarily unavailable.",
    );
  }

  return {
    // The Flow adapter owns the QA rules. Its pinned version is the optimistic
    // value a reviewer sees and echoes; projection/input lineage is frozen in
    // the snapshot below.
    version: shadowRun.flow_adapter_version,
    snapshot: {
      authority: "content_shadow_qa_gate",
      gateId: gate.id,
      flowShadowRunId: shadowRun.id,
      evaluatedArtifactId: gate.evaluated_artifact_id,
      evaluatedRevision: gate.evaluated_revision,
      verdict: gate.verdict,
      claims: [...gate.claims],
      evaluatedAt: canonicalRecordedAt(gate.created_at),
      analysisInvocationId: gate.analysis_invocation_id,
      flowAdapterVersion: shadowRun.flow_adapter_version,
      projectionVersion: shadowRun.projection_version,
      frozenInputHash: shadowRun.content_hash,
    },
  };
}

function mapRepositoryConflict(
  error: ArtifactApprovalConflictError,
): ProblemError {
  switch (error.code) {
    case "ARTIFACT_REVISION_NOT_FOUND":
    case "APPROVAL_NOT_FOUND":
      return new ProblemError("NOT_FOUND", "Artifact approval not found.");
    case "ARTIFACT_REVISION_STALE":
      return staleRevision(
        "The Artifact changed while approval was being recorded; refetch and retry.",
      );
    case "ARTIFACT_REVISION_NOT_READY":
      return artifactNotReady();
    case "QA_GATE_VERSION_STALE":
      return new ProblemError(
        "VERSION_CONFLICT",
        "The Artifact quality gate changed; refetch and retry.",
      );
    case "CUSTOMER_ACKNOWLEDGEMENT_REQUIRED":
      return new ProblemError(
        "VALIDATION_ERROR",
        "Explicit acknowledgement of this exact Artifact Revision is required.",
      );
    case "APPROVAL_ALREADY_TERMINAL":
      return new ProblemError(
        "VERSION_CONFLICT",
        "This Artifact approval already has a terminal event.",
      );
  }
}

async function appendApprovedEvent(
  exec: Executor,
  projectScope: ProjectScope,
  artifactId: string,
  actorId: string,
  body: Extract<
    AppendArtifactApprovalEventRequest,
    { eventKind: "approved" }
  >,
): Promise<ArtifactApprovalEventRow> {
  const artifacts = new ExecutionArtifactsRepository(exec);
  // Lock the Artifact before resolving its QA authority. This orders approval
  // with edits/regeneration, so the gate cannot be read for revision N and
  // then attached after a concurrent writer has advanced the Artifact to N+1.
  const artifact = await artifacts.findByIdForUpdate(
    projectScope,
    artifactId,
  );
  if (!artifact) {
    throw new ProblemError("NOT_FOUND", "Artifact not found.");
  }
  const revision = await artifacts.findRevision(
    projectScope,
    artifactId,
    body.expectedArtifactRevision,
  );
  // Revision identity is client input, so an id belonging to another Artifact
  // or workspace is reported absent rather than exposing its owner.
  if (!revision || revision.id !== body.artifactRevisionId) {
    throw new ProblemError("NOT_FOUND", "Artifact Revision not found.");
  }
  assertExactReadyRevision(artifact, revision, body);

  const qaGate = await resolveQaGate(
    exec,
    projectScope,
    artifact,
    revision,
  );
  if (qaGate.version !== body.expectedQaGateVersion) {
    throw qaVersionConflict(qaGate.version);
  }

  return new ArtifactApprovalsRepository(exec).approveExactRevision({
    ...projectScope,
    artifactRevisionId: revision.id,
    expectedArtifactRevision: body.expectedArtifactRevision,
    expectedQaGateVersion: body.expectedQaGateVersion,
    actorId,
    qaGate,
    customerAcknowledgementInput: body.customerAcknowledgementInput,
  });
}

async function appendTerminalEvent(
  exec: Executor,
  projectScope: ProjectScope,
  artifactId: string,
  actorId: string,
  body: Extract<
    AppendArtifactApprovalEventRequest,
    { eventKind: "revoked" | "superseded" }
  >,
): Promise<ArtifactApprovalEventRow> {
  const approvals = new ArtifactApprovalsRepository(exec);
  const source = await approvals.findHistoricalApproval(
    projectScope,
    body.supersedesApprovalEventId,
  );
  if (!source || source.artifact_id !== artifactId) {
    throw new ProblemError("NOT_FOUND", "Artifact approval not found.");
  }
  return approvals.invalidateApproval({
    ...projectScope,
    sourceApprovalEventId: body.supersedesApprovalEventId,
    eventKind: body.eventKind,
    actorId,
    reason: body.reason,
  });
}

/**
 * Append one approval timeline event to the Artifact named by the existing
 * four-module Execution route.
 *
 * All authority is resolved inside one transaction: project lifecycle, exact
 * Artifact/Revision identity, content hash, QA gate, reviewer, acknowledgement
 * and the idempotency receipt. Browser input contains no reviewer, hash,
 * snapshot, acknowledgement id, or timestamps.
 */
export async function appendArtifactApprovalEvent(
  scope: WorkspaceScope,
  projectId: string,
  artifactId: string,
  actorId: string,
  idempotencyKey: string,
  body: AppendArtifactApprovalEventRequest,
): Promise<ArtifactApprovalEventDto> {
  const { db } = getDb();
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const requestHash = requestHashFor(
    projectId,
    artifactId,
    actorId,
    body,
  );
  const idempotency = new IdempotencyRepository(db);
  const existing = await idempotency.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existing) return replayOrConflict(existing, requestHash);

  const expiresAt = new Date(
    Date.now() + IDEMPOTENCY_TTL_MS,
  ).toISOString();

  try {
    return await db.transaction(async (tx) => {
      const txIdempotency = new IdempotencyRepository(tx);
      const reserved = await txIdempotency.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const winner = await txIdempotency.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        if (winner) return replayOrConflict(winner, requestHash);
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Artifact approval command is already being processed.",
        );
      }

      const project = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (!project) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (project.archived_at) {
        throw new ProblemError(
          "PROJECT_ARCHIVED",
          "Project is archived.",
        );
      }

      let row: ArtifactApprovalEventRow;
      try {
        row =
          body.eventKind === "approved"
            ? await appendApprovedEvent(
                tx,
                projectScope,
                artifactId,
                actorId,
                body,
              )
            : await appendTerminalEvent(
                tx,
                projectScope,
                artifactId,
                actorId,
                body,
              );
      } catch (error) {
        if (error instanceof ArtifactApprovalConflictError) {
          throw mapRepositoryConflict(error);
        }
        throw error;
      }

      const event = toArtifactApprovalEvent(row);
      await txIdempotency.complete(reserved.id, {
        responseStatus: 201,
        responseBody: event,
        resourceType: "artifact_approval_event",
        resourceId: event.approvalEventId,
      });
      return event;
    });
  } catch (error) {
    const knownApprovalConstraint =
      isPostgresUniqueViolation(error, [
        "artifact_approval_events_one_approval_per_revision_idx",
        "artifact_approval_events_one_terminal_per_event_idx",
      ]);
    if (!knownApprovalConstraint) throw error;

    // If this was the same command racing us, its completed key is the
    // authoritative replay. A different-key attempt remains an optimistic
    // conflict and never guesses which existing approval the caller meant.
    const winner = await idempotency.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    if (winner) return replayOrConflict(winner, requestHash);
    throw new ProblemError(
      "VERSION_CONFLICT",
      body.eventKind === "approved"
        ? "This exact Artifact Revision already has an approval event."
        : "This Artifact approval already has a terminal event.",
    );
  }
}
