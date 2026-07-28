import { randomUUID } from "node:crypto";
import { and, eq, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  artifactApprovalEvents,
  artifactRevisions,
  executionArtifacts,
} from "../schema.ts";
import {
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import {
  Repository,
  projectPredicate,
  type Executor,
  type ProjectScope,
} from "./base.ts";

export type ArtifactApprovalEventKind =
  | "approved"
  | "revoked"
  | "superseded";

export interface ArtifactApprovalEventRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly artifact_id: string;
  readonly artifact_revision_id: string;
  readonly artifact_revision: number;
  readonly artifact_content_hash: string;
  readonly event_kind: ArtifactApprovalEventKind;
  readonly supersedes_approval_event_id: string | null;
  readonly supersedes_approval_event_kind: "approved" | null;
  readonly event_actor_id: string;
  readonly reviewer_actor_id: string | null;
  readonly qa_gate_version: string;
  readonly qa_gate_snapshot: Record<string, unknown>;
  readonly qa_gate_snapshot_hash: string;
  readonly customer_acknowledgement: Record<string, unknown>;
  readonly customer_acknowledgement_hash: string;
  readonly reason: string | null;
  readonly created_at: string;
}

export type ArtifactApprovalErrorCode =
  | "ARTIFACT_REVISION_NOT_FOUND"
  | "ARTIFACT_REVISION_STALE"
  | "ARTIFACT_REVISION_NOT_READY"
  | "QA_GATE_VERSION_STALE"
  | "CUSTOMER_ACKNOWLEDGEMENT_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_ALREADY_TERMINAL";

export class ArtifactApprovalConflictError extends Error {
  override readonly name = "ArtifactApprovalConflictError";

  constructor(readonly code: ArtifactApprovalErrorCode) {
    super(code);
  }
}

export interface ArtifactApprovalClock {
  readonly newId: () => string;
  readonly now: () => string;
}

const DEFAULT_CLOCK: ArtifactApprovalClock = {
  newId: randomUUID,
  now: () => new Date().toISOString(),
};

interface CanonicalArtifactRevision {
  readonly artifact_id: string;
  readonly artifact_status: string;
  readonly artifact_validation_state: string;
  readonly artifact_current_revision: number;
  readonly artifact_content_hash: string | null;
  readonly artifact_revision_id: string;
  readonly artifact_revision: number;
  readonly revision_content_hash: string;
}

function hashJson(value: Record<string, unknown>): string {
  return contentHash(value as CanonicalValue);
}

/**
 * Append-only customer approval ledger. Public API request types intentionally
 * do not fit these methods: the service must first authenticate the actor and
 * resolve the canonical QA gate. The repository then re-reads and locks the
 * exact Artifact Revision so client-authored hashes/reviewer facts cannot enter
 * the ledger.
 */
export class ArtifactApprovalsRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: ArtifactApprovalClock = DEFAULT_CLOCK,
  ) {
    super(exec);
  }

  async approveExactRevision(values: {
    workspaceId: string;
    projectId: string;
    artifactRevisionId: string;
    expectedArtifactRevision: number;
    expectedQaGateVersion: string;
    actorId: string;
    qaGate: {
      readonly version: string;
      readonly snapshot: Record<string, unknown>;
    };
    customerAcknowledgementInput: {
      readonly acknowledged: true;
      readonly acknowledgementScope:
        "exact_artifact_revision_for_publication";
    };
  }): Promise<ArtifactApprovalEventRow> {
    if (
      values.customerAcknowledgementInput.acknowledged !== true ||
      values.customerAcknowledgementInput.acknowledgementScope !==
        "exact_artifact_revision_for_publication"
    ) {
      throw new ArtifactApprovalConflictError(
        "CUSTOMER_ACKNOWLEDGEMENT_REQUIRED",
      );
    }
    if (
      values.qaGate.version !== values.expectedQaGateVersion ||
      values.expectedQaGateVersion.length < 1 ||
      values.expectedQaGateVersion.length > 100
    ) {
      throw new ArtifactApprovalConflictError("QA_GATE_VERSION_STALE");
    }

    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const rows = await this.exec
      .select({
        artifact_id: executionArtifacts.id,
        artifact_status: executionArtifacts.status,
        artifact_validation_state: executionArtifacts.validation_state,
        artifact_current_revision: executionArtifacts.current_revision,
        artifact_content_hash: executionArtifacts.content_hash,
        artifact_revision_id: artifactRevisions.id,
        artifact_revision: artifactRevisions.revision,
        revision_content_hash: artifactRevisions.content_hash,
      })
      .from(artifactRevisions)
      .innerJoin(
        executionArtifacts,
        and(
          eq(executionArtifacts.id, artifactRevisions.artifact_id),
          projectPredicate(executionArtifacts, scope),
        ),
      )
      .where(
        and(
          projectPredicate(artifactRevisions, scope),
          eq(artifactRevisions.id, values.artifactRevisionId),
        ),
      )
      .limit(1)
      .for("update");
    const canonical = rows[0] as CanonicalArtifactRevision | undefined;
    if (!canonical) {
      throw new ArtifactApprovalConflictError("ARTIFACT_REVISION_NOT_FOUND");
    }
    if (
      canonical.artifact_revision !== values.expectedArtifactRevision ||
      canonical.artifact_current_revision !== values.expectedArtifactRevision ||
      canonical.artifact_content_hash !== canonical.revision_content_hash
    ) {
      throw new ArtifactApprovalConflictError("ARTIFACT_REVISION_STALE");
    }
    if (
      canonical.artifact_status !== "ready" ||
      canonical.artifact_validation_state !== "valid"
    ) {
      throw new ArtifactApprovalConflictError("ARTIFACT_REVISION_NOT_READY");
    }

    const customerAcknowledgement = {
      customerAcknowledgementId: this.clock.newId(),
      actorId: values.actorId,
      acknowledgedAt: this.clock.now(),
      acknowledgementScope:
        values.customerAcknowledgementInput.acknowledgementScope,
    };
    const [inserted] = await this.exec
      .insert(artifactApprovalEvents)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        artifact_id: canonical.artifact_id,
        artifact_revision_id: canonical.artifact_revision_id,
        artifact_revision: canonical.artifact_revision,
        artifact_content_hash: canonical.revision_content_hash,
        event_kind: "approved",
        supersedes_approval_event_id: null,
        supersedes_approval_event_kind: null,
        event_actor_id: values.actorId,
        reviewer_actor_id: values.actorId,
        qa_gate_version: values.qaGate.version,
        qa_gate_snapshot: values.qaGate.snapshot,
        qa_gate_snapshot_hash: hashJson(values.qaGate.snapshot),
        customer_acknowledgement: customerAcknowledgement,
        customer_acknowledgement_hash: hashJson(customerAcknowledgement),
        reason: null,
      })
      .returning();
    if (!inserted) {
      throw new ArtifactApprovalConflictError("ARTIFACT_REVISION_STALE");
    }
    return inserted as ArtifactApprovalEventRow;
  }

  async invalidateApproval(values: {
    workspaceId: string;
    projectId: string;
    sourceApprovalEventId: string;
    eventKind: "revoked" | "superseded";
    actorId: string;
    reason: string;
  }): Promise<ArtifactApprovalEventRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const sourceRows = await this.exec
      .select()
      .from(artifactApprovalEvents)
      .where(
        and(
          projectPredicate(artifactApprovalEvents, scope),
          eq(artifactApprovalEvents.id, values.sourceApprovalEventId),
          eq(artifactApprovalEvents.event_kind, "approved"),
        ),
      )
      .limit(1)
      .for("update");
    const source = sourceRows[0] as ArtifactApprovalEventRow | undefined;
    if (!source) {
      throw new ArtifactApprovalConflictError("APPROVAL_NOT_FOUND");
    }

    const terminalRows = await this.exec
      .select({ id: artifactApprovalEvents.id })
      .from(artifactApprovalEvents)
      .where(
        and(
          projectPredicate(artifactApprovalEvents, scope),
          eq(
            artifactApprovalEvents.supersedes_approval_event_id,
            values.sourceApprovalEventId,
          ),
        ),
      )
      .limit(1);
    if (terminalRows[0]) {
      throw new ArtifactApprovalConflictError("APPROVAL_ALREADY_TERMINAL");
    }

    const [inserted] = await this.exec
      .insert(artifactApprovalEvents)
      .values({
        workspace_id: source.workspace_id,
        project_id: source.project_id,
        artifact_id: source.artifact_id,
        artifact_revision_id: source.artifact_revision_id,
        artifact_revision: source.artifact_revision,
        artifact_content_hash: source.artifact_content_hash,
        event_kind: values.eventKind,
        supersedes_approval_event_id: source.id,
        supersedes_approval_event_kind: "approved",
        event_actor_id: values.actorId,
        reviewer_actor_id: null,
        qa_gate_version: source.qa_gate_version,
        qa_gate_snapshot: source.qa_gate_snapshot,
        qa_gate_snapshot_hash: source.qa_gate_snapshot_hash,
        customer_acknowledgement: source.customer_acknowledgement,
        customer_acknowledgement_hash:
          source.customer_acknowledgement_hash,
        reason: values.reason,
      })
      .returning();
    if (!inserted) {
      throw new ArtifactApprovalConflictError("APPROVAL_ALREADY_TERMINAL");
    }
    return inserted as ArtifactApprovalEventRow;
  }

  async findCurrentApproval(
    scope: ProjectScope,
    approvalEventId: string,
  ): Promise<ArtifactApprovalEventRow | null> {
    const terminal = alias(
      artifactApprovalEvents,
      "terminal_approval_events",
    );
    const rows = await this.exec
      .select()
      .from(artifactApprovalEvents)
      .where(
        and(
          projectPredicate(artifactApprovalEvents, scope),
          eq(artifactApprovalEvents.id, approvalEventId),
          eq(artifactApprovalEvents.event_kind, "approved"),
          notExists(
            this.exec
              .select({ id: terminal.id })
              .from(terminal)
              .where(
                and(
                  projectPredicate(terminal, scope),
                  eq(terminal.supersedes_approval_event_id, approvalEventId),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactApprovalEventRow | undefined) ?? null;
  }

  async findHistoricalApproval(
    scope: ProjectScope,
    approvalEventId: string,
  ): Promise<ArtifactApprovalEventRow | null> {
    const rows = await this.exec
      .select()
      .from(artifactApprovalEvents)
      .where(
        and(
          projectPredicate(artifactApprovalEvents, scope),
          eq(artifactApprovalEvents.id, approvalEventId),
          eq(artifactApprovalEvents.event_kind, "approved"),
        ),
      )
      .limit(1);
    return (rows[0] as ArtifactApprovalEventRow | undefined) ?? null;
  }
}
