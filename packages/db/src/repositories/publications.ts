import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DbTx } from "../client.ts";
import {
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import {
  asyncRuns,
  clientProjects,
  deliveryAuthorizationGrants,
  publicationAttempts,
  publicationDestinations,
  publicationPreviewEvents,
  publicationReceipts,
} from "../schema.ts";
import {
  Repository,
  projectPredicate,
  type Executor,
  type ProjectScope,
} from "./base.ts";
import {
  AsyncRunsRepository,
  type AsyncRunRow,
} from "./async-runs.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import { IdempotencyRepository } from "./idempotency.ts";

export type PublicationProviderKind = "github" | "wordpress";
export type DeliveryAuthorizationPurpose =
  | "connector_configuration"
  | "publish"
  | "rollback";
export type DeliveryAuthorizationGrantState =
  | "ready"
  | "consumed"
  | "revoked"
  | "expired";
export type PublicationDestinationState =
  | "pending"
  | "ready"
  | "unavailable"
  | "revoked";
export type PublicationAttemptKind = "publish" | "rollback";
export type PublicationPreviewKind = PublicationAttemptKind;
export type PublicationPreviewEventKind =
  | "issued"
  | "revoked"
  | "superseded";
export type PublicationReceiptKind =
  | "delivery_receipt"
  | "change_receipt";

export interface DeliveryAuthorizationGrantRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly provider_kind: PublicationProviderKind;
  readonly purpose: DeliveryAuthorizationPurpose;
  readonly state: DeliveryAuthorizationGrantState;
  readonly destination_ref: string | null;
  readonly destination_revision: number | null;
  readonly target_ref: string | null;
  readonly requested_scope: Record<string, unknown>;
  readonly requested_scope_hash: string;
  readonly authorization_snapshot: Record<string, unknown>;
  readonly authorization_snapshot_hash: string;
  readonly encrypted_payload: Buffer | null;
  readonly cipher_version: number | null;
  readonly key_version: string | null;
  readonly secret_metadata: Record<string, unknown>;
  readonly expires_at: string | null;
  readonly consumed_at: string | null;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly revocation_reason: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

export interface PublicationDestinationRow {
  readonly id: string;
  readonly destination_ref: string;
  readonly revision: number;
  readonly supersedes_id: string | null;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly provider_kind: PublicationProviderKind;
  readonly target_ref: string;
  readonly state: PublicationDestinationState;
  readonly authorization_grant_id: string;
  readonly provider_scope: Record<string, unknown>;
  readonly provider_scope_hash: string;
  readonly authorization_snapshot: Record<string, unknown>;
  readonly authorization_snapshot_hash: string;
  readonly readiness_observation: Record<string, unknown>;
  readonly limitation: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

export interface PublicationDestinationHeadListOptions {
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface PublicationDestinationHeadListPage {
  readonly rows: PublicationDestinationRow[];
  readonly nextCursor: string | null;
}

export interface PublicationDestinationRevisionListOptions {
  readonly limit: number;
}

export const MAX_PUBLICATION_DESTINATION_HEADS = 100;
export const MAX_PUBLICATION_DESTINATION_REVISIONS = 1_000;

export interface PublicationClock {
  now(): Date;
}

const systemPublicationClock: PublicationClock = {
  now: () => new Date(),
};

const publicationDestinationSelection = {
  id: publicationDestinations.id,
  destination_ref: publicationDestinations.destination_ref,
  revision: publicationDestinations.revision,
  supersedes_id: publicationDestinations.supersedes_id,
  workspace_id: publicationDestinations.workspace_id,
  project_id: publicationDestinations.project_id,
  site_id: publicationDestinations.site_id,
  provider_kind: publicationDestinations.provider_kind,
  target_ref: publicationDestinations.target_ref,
  state: publicationDestinations.state,
  authorization_grant_id: publicationDestinations.authorization_grant_id,
  provider_scope: publicationDestinations.provider_scope,
  provider_scope_hash: publicationDestinations.provider_scope_hash,
  authorization_snapshot: publicationDestinations.authorization_snapshot,
  authorization_snapshot_hash:
    publicationDestinations.authorization_snapshot_hash,
  readiness_observation: publicationDestinations.readiness_observation,
  limitation: publicationDestinations.limitation,
  created_by: publicationDestinations.created_by,
  created_at: publicationDestinations.created_at,
} as const;

export interface PublicationAttemptRow {
  readonly id: string;
  readonly attempt_kind: PublicationAttemptKind;
  readonly source_publication_attempt_id: string | null;
  readonly source_change_receipt_id: string | null;
  readonly preview_event_id: string;
  readonly preview_event_kind: "issued";
  readonly preview_facts_hash: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly async_run_id: string;
  readonly destination_id: string;
  readonly destination_ref: string;
  readonly destination_revision: number;
  readonly provider_kind: PublicationProviderKind;
  readonly target_ref: string;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly artifact_revision_id: string;
  readonly approved_artifact_revision: number;
  readonly approved_artifact_content_hash: string;
  readonly publication_approval_event_id: string | null;
  readonly publication_approval_event_kind: "approved" | null;
  readonly source_approval_event_id: string | null;
  readonly source_approval_event_kind: "approved" | null;
  readonly side_effect_class: "external_write";
  readonly authorization_grant_id: string;
  readonly authorization_purpose: "publish" | "rollback";
  readonly authorization_snapshot: Record<string, unknown>;
  readonly authorization_snapshot_hash: string;
  readonly preview_ref: string;
  readonly preview_checksum: string;
  readonly content_checksum: string;
  readonly remote_precondition: Record<string, unknown>;
  readonly rollback_plan: Record<string, unknown>;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly requested_by: string;
  readonly requested_at: string;
}

export interface PublicationPreviewEventRow {
  readonly id: string;
  readonly preview_ref: string;
  readonly event_kind: PublicationPreviewEventKind;
  readonly supersedes_preview_event_id: string | null;
  readonly supersedes_preview_event_kind: "issued" | null;
  readonly preview_kind: PublicationPreviewKind;
  readonly facts_schema_version: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly destination_id: string;
  readonly destination_ref: string;
  readonly destination_revision: number;
  readonly provider_kind: PublicationProviderKind;
  readonly target_ref: string;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly artifact_revision_id: string;
  readonly artifact_revision: number;
  readonly artifact_content_hash: string;
  readonly artifact_approval_event_id: string;
  readonly artifact_approval_event_kind: "approved";
  readonly source_publication_attempt_id: string | null;
  readonly source_change_receipt_id: string | null;
  readonly provider_plan: Record<string, unknown>;
  readonly remote_precondition: Record<string, unknown>;
  readonly rollback_plan: Record<string, unknown>;
  readonly preview_checksum: string;
  readonly content_checksum: string;
  readonly facts_hash: string;
  readonly expires_at: string;
  readonly event_actor_id: string;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly reason: string | null;
  readonly created_at: string;
}

export interface PublicationReceiptRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly publication_attempt_id: string;
  readonly receipt_kind: PublicationReceiptKind;
  readonly predecessor_delivery_receipt_id: string | null;
  readonly provider_kind: PublicationProviderKind;
  readonly provider_request_id: string | null;
  readonly remote_scope_ref: string;
  readonly remote_object_kind:
    | "github_pull_request"
    | "github_merge"
    | "wordpress_post"
    | "wordpress_revision";
  readonly remote_object_id: string;
  readonly remote_revision: string;
  readonly delivery_url: string | null;
  readonly live_canonical_url: string | null;
  readonly artifact_content_hash: string;
  readonly content_checksum: string;
  readonly verification_state:
    | "provider_accepted"
    | "pending"
    | "verified_live"
    | "unavailable";
  readonly remote_facts: Record<string, unknown>;
  readonly evidence_refs: readonly unknown[];
  readonly limitation: string | null;
  readonly observed_at: string;
  readonly created_at: string;
}

export type DeliveryAuthorizationGrantErrorCode =
  | "GRANT_SCOPE_INVALID"
  | "GRANT_PROVIDER_INVALID"
  | "GRANT_PURPOSE_INVALID"
  | "GRANT_STATE_INVALID"
  | "GRANT_EXPIRED"
  | "GRANT_SECRET_INVALID";

export class DeliveryAuthorizationGrantConflictError extends Error {
  override readonly name = "DeliveryAuthorizationGrantConflictError";

  constructor(readonly code: DeliveryAuthorizationGrantErrorCode) {
    super(code);
  }
}

export class DeliveryConnectionConflictError extends Error {
  override readonly name = "DeliveryConnectionConflictError";
}

export class PublicationIdempotencyConflictError extends Error {
  override readonly name = "PublicationIdempotencyConflictError";
}

export class PublicationInvariantError extends Error {
  override readonly name = "PublicationInvariantError";

  constructor(readonly code: string) {
    super(code);
  }
}

export class PublicationAlreadyActiveError extends Error {
  override readonly name = "PublicationAlreadyActiveError";

  constructor(readonly activeRunId: string | null) {
    super("PUBLICATION_ALREADY_ACTIVE");
  }
}

function hashJson(value: unknown): string {
  return contentHash(value as CanonicalValue);
}

function isExpired(value: string | null, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return true;
  if (value === null) return false;
  const instant = Date.parse(value);
  return !Number.isFinite(instant) || instant <= now.getTime();
}

function isSameInstant(left: string, right: string): boolean {
  const leftInstant = Date.parse(left);
  const rightInstant = Date.parse(right);
  return (
    Number.isFinite(leftInstant) &&
    Number.isFinite(rightInstant) &&
    leftInstant === rightInstant
  );
}

function jsonContains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((expectedItem) =>
        actual.some((actualItem) =>
          jsonContains(actualItem, expectedItem),
        ),
      )
    );
  }
  if (expected !== null && typeof expected === "object") {
    if (
      actual === null ||
      typeof actual !== "object" ||
      Array.isArray(actual)
    ) {
      return false;
    }
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(expected).every(
      ([key, expectedValue]) =>
        Object.hasOwn(actualRecord, key) &&
        jsonContains(actualRecord[key], expectedValue),
    );
  }
  return Object.is(actual, expected);
}

function exactGrantBinding(
  row: DeliveryAuthorizationGrantRow,
  expected: {
    readonly siteId: string;
    readonly providerKind: PublicationProviderKind;
    readonly purpose: DeliveryAuthorizationPurpose;
    readonly destinationRef: string;
    readonly destinationRevision: number;
    readonly targetRef: string;
  },
  now: Date,
): void {
  if (row.site_id !== expected.siteId) {
    throw new DeliveryAuthorizationGrantConflictError(
      "GRANT_SCOPE_INVALID",
    );
  }
  if (row.provider_kind !== expected.providerKind) {
    throw new DeliveryAuthorizationGrantConflictError(
      "GRANT_PROVIDER_INVALID",
    );
  }
  if (row.purpose !== expected.purpose) {
    throw new DeliveryAuthorizationGrantConflictError(
      "GRANT_PURPOSE_INVALID",
    );
  }
  if (
    row.destination_ref !== expected.destinationRef ||
    row.destination_revision !== expected.destinationRevision ||
    row.target_ref !== expected.targetRef
  ) {
    throw new DeliveryAuthorizationGrantConflictError(
      "GRANT_SCOPE_INVALID",
    );
  }
  if (row.state !== "ready") {
    throw new DeliveryAuthorizationGrantConflictError(
      "GRANT_STATE_INVALID",
    );
  }
  if (isExpired(row.expires_at, now)) {
    throw new DeliveryAuthorizationGrantConflictError("GRANT_EXPIRED");
  }
}

/**
 * Server-only authorization/credential ledger. Public callers provide only a
 * grant id; resolved scopes, snapshots and encrypted WordPress material are
 * written by trusted service code and are re-read under a project-scoped row
 * lock immediately before consumption.
 */
export class DeliveryAuthorizationGrantsRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: PublicationClock = systemPublicationClock,
  ) {
    super(exec);
  }

  async findExactForExecution(
    scope: ProjectScope,
    values: {
      grantId: string;
      siteId: string;
      providerKind: PublicationProviderKind;
      purpose: "publish" | "rollback";
      destinationRef: string;
      destinationRevision: number;
      targetRef: string;
      authorizationSnapshotHash: string;
    },
    options: { readonly lock?: boolean } = {},
  ): Promise<DeliveryAuthorizationGrantRow | null> {
    const activeProject = sql`exists (
      select 1
        from app.client_projects active_project
       where active_project.id = ${scope.projectId}
         and active_project.workspace_id = ${scope.workspaceId}
         and active_project.archived_at is null
    )`;
    const query = this.exec
      .select()
      .from(deliveryAuthorizationGrants)
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          activeProject,
          eq(deliveryAuthorizationGrants.id, values.grantId),
          eq(deliveryAuthorizationGrants.site_id, values.siteId),
          eq(
            deliveryAuthorizationGrants.provider_kind,
            values.providerKind,
          ),
          eq(deliveryAuthorizationGrants.purpose, values.purpose),
          eq(deliveryAuthorizationGrants.state, "consumed"),
          eq(
            deliveryAuthorizationGrants.destination_ref,
            values.destinationRef,
          ),
          eq(
            deliveryAuthorizationGrants.destination_revision,
            values.destinationRevision,
          ),
          eq(deliveryAuthorizationGrants.target_ref, values.targetRef),
          eq(
            deliveryAuthorizationGrants.authorization_snapshot_hash,
            values.authorizationSnapshotHash,
          ),
          isNotNull(deliveryAuthorizationGrants.consumed_at),
          or(
            isNull(deliveryAuthorizationGrants.expires_at),
            lte(
              deliveryAuthorizationGrants.consumed_at,
              deliveryAuthorizationGrants.expires_at,
            ),
          ),
        ),
      )
      .limit(1);
    const rows = await (options.lock ? query.for("share") : query);
    return (rows[0] as DeliveryAuthorizationGrantRow | undefined) ?? null;
  }

  async create(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    providerKind: PublicationProviderKind;
    purpose: DeliveryAuthorizationPurpose;
    destinationRef: string | null;
    destinationRevision: number | null;
    targetRef: string | null;
    requestedScope: Record<string, unknown>;
    authorizationSnapshot: Record<string, unknown>;
    encryptedPayload: Buffer | null;
    cipherVersion: number | null;
    keyVersion: string | null;
    secretMetadata: Record<string, unknown>;
    expiresAt: string | null;
    createdBy: string;
  }): Promise<DeliveryAuthorizationGrantRow> {
    const bound = [
      values.destinationRef,
      values.destinationRevision,
      values.targetRef,
    ];
    if (
      bound.some((value) => value === null) &&
      bound.some((value) => value !== null)
    ) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SCOPE_INVALID",
      );
    }
    if (
      values.providerKind === "wordpress" &&
      (!Buffer.isBuffer(values.encryptedPayload) ||
        values.encryptedPayload.length < 32 ||
        values.cipherVersion === null ||
        values.cipherVersion < 1 ||
        !values.keyVersion)
    ) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SECRET_INVALID",
      );
    }
    if (
      values.providerKind === "github" &&
      (values.encryptedPayload !== null ||
        values.cipherVersion !== null ||
        values.keyVersion !== null)
    ) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SECRET_INVALID",
      );
    }
    if (
      (values.purpose !== "connector_configuration" &&
        values.expiresAt === null) ||
      (values.expiresAt !== null &&
        isExpired(values.expiresAt, this.clock.now()))
    ) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_EXPIRED",
      );
    }
    if (values.requestedScope["providerKind"] !== values.providerKind) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_PROVIDER_INVALID",
      );
    }
    if (
      values.authorizationSnapshot["purpose"] !== values.purpose ||
      (values.destinationRef !== null &&
        values.authorizationSnapshot["destinationRef"] !==
          values.destinationRef) ||
      (values.destinationRevision !== null &&
        values.authorizationSnapshot["destinationRevision"] !==
          values.destinationRevision) ||
      values.authorizationSnapshot["expiresAt"] !== values.expiresAt
    ) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SCOPE_INVALID",
      );
    }

    const [row] = await this.exec
      .insert(deliveryAuthorizationGrants)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        provider_kind: values.providerKind,
        purpose: values.purpose,
        state: "ready",
        destination_ref: values.destinationRef,
        destination_revision: values.destinationRevision,
        target_ref: values.targetRef,
        requested_scope: values.requestedScope,
        requested_scope_hash: hashJson(values.requestedScope),
        authorization_snapshot: values.authorizationSnapshot,
        authorization_snapshot_hash: hashJson(
          values.authorizationSnapshot,
        ),
        encrypted_payload: values.encryptedPayload,
        cipher_version: values.cipherVersion,
        key_version: values.keyVersion,
        secret_metadata: values.secretMetadata,
        expires_at: values.expiresAt,
        created_by: values.createdBy,
      })
      .returning();
    if (!row) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SCOPE_INVALID",
      );
    }
    return row as DeliveryAuthorizationGrantRow;
  }

  async findForUpdate(
    scope: ProjectScope,
    grantId: string,
  ): Promise<DeliveryAuthorizationGrantRow | null> {
    const rows = await this.exec
      .select()
      .from(deliveryAuthorizationGrants)
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          eq(deliveryAuthorizationGrants.id, grantId),
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as DeliveryAuthorizationGrantRow | undefined) ?? null;
  }

  async readCurrent(
    scope: ProjectScope,
    grantId: string,
    now: Date,
  ): Promise<DeliveryAuthorizationGrantRow | null> {
    const rows = await this.exec
      .select()
      .from(deliveryAuthorizationGrants)
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          eq(deliveryAuthorizationGrants.id, grantId),
          eq(deliveryAuthorizationGrants.state, "ready"),
        ),
      )
      .limit(1);
    const row =
      (rows[0] as DeliveryAuthorizationGrantRow | undefined) ?? null;
    return row === null || isExpired(row.expires_at, now) ? null : row;
  }

  async consume(values: {
    workspaceId: string;
    projectId: string;
    grantId: string;
    siteId: string;
    providerKind: PublicationProviderKind;
    purpose: DeliveryAuthorizationPurpose;
    destinationRef: string;
    destinationRevision: number;
    targetRef: string;
  }): Promise<DeliveryAuthorizationGrantRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const grant = await this.findForUpdate(scope, values.grantId);
    if (!grant) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_SCOPE_INVALID",
      );
    }
    exactGrantBinding(grant, values, this.clock.now());
    const rows = await this.exec
      .update(deliveryAuthorizationGrants)
      .set({ state: "consumed", consumed_at: sql`now()` })
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          eq(deliveryAuthorizationGrants.id, values.grantId),
          eq(deliveryAuthorizationGrants.state, "ready"),
        ),
      )
      .returning();
    const consumed = rows[0] as DeliveryAuthorizationGrantRow | undefined;
    if (!consumed) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_STATE_INVALID",
      );
    }
    return consumed;
  }

  async revoke(values: {
    workspaceId: string;
    projectId: string;
    grantId: string;
    actorId: string;
    reason: string;
  }): Promise<DeliveryAuthorizationGrantRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const current = await this.findForUpdate(scope, values.grantId);
    if (!current || current.state === "revoked" || current.state === "expired") {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_STATE_INVALID",
      );
    }
    const rows = await this.exec
      .update(deliveryAuthorizationGrants)
      .set({
        state: "revoked",
        revoked_at: sql`now()`,
        revoked_by: values.actorId,
        revocation_reason: values.reason,
      })
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          eq(deliveryAuthorizationGrants.id, values.grantId),
          eq(deliveryAuthorizationGrants.state, current.state),
        ),
      )
      .returning();
    const revoked = rows[0] as DeliveryAuthorizationGrantRow | undefined;
    if (!revoked) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_STATE_INVALID",
      );
    }
    return revoked;
  }
}

/**
 * Append-only delivery connection revisions. The authorization grant is locked,
 * scope-checked and consumed in the caller's transaction; a WordPress secret is
 * never represented by a free-form reference on the destination row.
 */
export class DeliveryConnectionsRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: PublicationClock = systemPublicationClock,
  ) {
    super(exec);
  }

  async listHeads(
    scope: ProjectScope,
    options: PublicationDestinationHeadListOptions,
  ): Promise<PublicationDestinationHeadListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_PUBLICATION_DESTINATION_HEADS
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_PUBLICATION_DESTINATION_HEADS}`,
      );
    }
    const cursor = options.cursor ?? null;
    const decoded = cursor
      ? decodeTimestampUuidCursor(cursor)
      : null;
    if (cursor !== null && !decoded) {
      return { rows: [], nextCursor: null };
    }
    const after = decoded
      ? or(
          lt(publicationDestinations.created_at, decoded.timestamp),
          and(
            eq(publicationDestinations.created_at, decoded.timestamp),
            lt(publicationDestinations.id, decoded.id),
          ),
        )
      : undefined;
    const latestRevision = sql`
      ${publicationDestinations.revision} = (
        select max(head.revision)
          from app.publication_destinations head
         where head.workspace_id = ${publicationDestinations.workspace_id}
           and head.project_id = ${publicationDestinations.project_id}
           and head.destination_ref = ${publicationDestinations.destination_ref}
      )
    `;
    const rows = (await this.exec
      .select(publicationDestinationSelection)
      .from(publicationDestinations)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, publicationDestinations.project_id),
          eq(
            clientProjects.workspace_id,
            publicationDestinations.workspace_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(publicationDestinations, scope),
          eq(clientProjects.id, scope.projectId),
          eq(clientProjects.workspace_id, scope.workspaceId),
          isNull(clientProjects.archived_at),
          latestRevision,
          after,
        ),
      )
      .orderBy(
        desc(publicationDestinations.created_at),
        desc(publicationDestinations.id),
      )
      .limit(options.limit + 1)) as PublicationDestinationRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(last.created_at, last.id)
          : null,
    };
  }

  async listRevisions(
    scope: ProjectScope,
    destinationRef: string,
    options: PublicationDestinationRevisionListOptions,
  ): Promise<PublicationDestinationRow[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_PUBLICATION_DESTINATION_REVISIONS
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_PUBLICATION_DESTINATION_REVISIONS}`,
      );
    }
    return (await this.exec
      .select(publicationDestinationSelection)
      .from(publicationDestinations)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, publicationDestinations.project_id),
          eq(
            clientProjects.workspace_id,
            publicationDestinations.workspace_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(publicationDestinations, scope),
          eq(clientProjects.id, scope.projectId),
          eq(clientProjects.workspace_id, scope.workspaceId),
          isNull(clientProjects.archived_at),
          eq(publicationDestinations.destination_ref, destinationRef),
        ),
      )
      .orderBy(
        desc(publicationDestinations.revision),
        desc(publicationDestinations.id),
      )
      .limit(options.limit)) as PublicationDestinationRow[];
  }

  async findExactForExecution(
    scope: ProjectScope,
    values: {
      id: string;
      destinationRef: string;
      revision: number;
      siteId: string;
      providerKind: PublicationProviderKind;
      targetRef: string;
    },
    options: { readonly lock?: boolean } = {},
  ): Promise<PublicationDestinationRow | null> {
    const activeProject = sql`exists (
      select 1
        from app.client_projects active_project
       where active_project.id = ${scope.projectId}
         and active_project.workspace_id = ${scope.workspaceId}
         and active_project.archived_at is null
    )`;
    const noNewerRevision = sql`not exists (
      select 1
        from app.publication_destinations newer
       where newer.workspace_id = ${publicationDestinations.workspace_id}
         and newer.project_id = ${publicationDestinations.project_id}
         and newer.destination_ref = ${publicationDestinations.destination_ref}
         and newer.revision > ${publicationDestinations.revision}
    )`;
    const query = this.exec
      .select()
      .from(publicationDestinations)
      .where(
        and(
          projectPredicate(publicationDestinations, scope),
          activeProject,
          eq(publicationDestinations.id, values.id),
          eq(
            publicationDestinations.destination_ref,
            values.destinationRef,
          ),
          eq(publicationDestinations.revision, values.revision),
          eq(publicationDestinations.site_id, values.siteId),
          eq(
            publicationDestinations.provider_kind,
            values.providerKind,
          ),
          eq(publicationDestinations.target_ref, values.targetRef),
          eq(publicationDestinations.state, "ready"),
          noNewerRevision,
        ),
      )
      .limit(1);
    const rows = await (options.lock ? query.for("share") : query);
    return (rows[0] as PublicationDestinationRow | undefined) ?? null;
  }

  async findLatest(
    scope: ProjectScope,
    destinationRef: string,
    lock = false,
  ): Promise<PublicationDestinationRow | null> {
    const query = this.exec
      .select()
      .from(publicationDestinations)
      .where(
        and(
          projectPredicate(publicationDestinations, scope),
          eq(publicationDestinations.destination_ref, destinationRef),
        ),
      )
      .orderBy(
        desc(publicationDestinations.revision),
        desc(publicationDestinations.id),
      )
      .limit(1);
    const rows = await (lock ? query.for("update") : query);
    return (rows[0] as PublicationDestinationRow | undefined) ?? null;
  }

  async appendRevision(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    destinationRef: string;
    baseRevision: number;
    targetRef: string;
    providerKind: PublicationProviderKind;
    authorizationGrantId: string;
    providerScope: Record<string, unknown>;
    readinessObservation: Record<string, unknown>;
    state: Exclude<PublicationDestinationState, "revoked">;
    limitation: string | null;
    createdBy: string;
    authorizationCheckedAt: Date;
  }): Promise<PublicationDestinationRow> {
    if ((values.state as PublicationDestinationState) === "revoked") {
      throw new PublicationInvariantError(
        "DESTINATION_STATE_INVALID",
      );
    }
    if (
      (values.state === "ready" && values.limitation !== null) ||
      (values.state === "unavailable" &&
        (values.limitation === null ||
          values.limitation.trim().length === 0))
    ) {
      throw new PublicationInvariantError(
        "DESTINATION_LIMITATION_INVALID",
      );
    }
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const latest = await this.findLatest(scope, values.destinationRef, true);
    if (
      (latest === null && values.baseRevision !== 0) ||
      (latest !== null && latest.revision !== values.baseRevision)
    ) {
      throw new DeliveryConnectionConflictError(
        "destination base revision is stale",
      );
    }
    if (
      latest &&
      (latest.site_id !== values.siteId ||
        latest.provider_kind !== values.providerKind ||
        latest.target_ref !== values.targetRef)
    ) {
      throw new DeliveryConnectionConflictError(
        "destination immutable scope changed",
      );
    }
    const revision = values.baseRevision + 1;
    const grants = new DeliveryAuthorizationGrantsRepository(
      this.exec,
      this.clock,
    );
    const grant = await grants.findForUpdate(
      scope,
      values.authorizationGrantId,
    );
    if (!grant) {
      throw new PublicationInvariantError(
        "DELIVERY_AUTHORIZATION_GRANT_NOT_FOUND",
      );
    }
    exactGrantBinding(
      grant,
      {
        siteId: values.siteId,
        providerKind: values.providerKind,
        purpose: "connector_configuration",
        destinationRef: values.destinationRef,
        destinationRevision: revision,
        targetRef: values.targetRef,
      },
      values.authorizationCheckedAt,
    );
    if (
      values.providerScope["providerKind"] !== values.providerKind ||
      grant.requested_scope["providerKind"] !== values.providerKind ||
      !jsonContains(values.providerScope, grant.requested_scope)
    ) {
      throw new PublicationInvariantError(
        "DESTINATION_PROVIDER_SCOPE_INVALID",
      );
    }
    const [inserted] = await this.exec
      .insert(publicationDestinations)
      .values({
        destination_ref: values.destinationRef,
        revision,
        supersedes_id: latest?.id ?? null,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        provider_kind: values.providerKind,
        target_ref: values.targetRef,
        state: values.state,
        authorization_grant_id: grant.id,
        provider_scope: values.providerScope,
        provider_scope_hash: hashJson(values.providerScope),
        authorization_snapshot: grant.authorization_snapshot,
        authorization_snapshot_hash: grant.authorization_snapshot_hash,
        readiness_observation: values.readinessObservation,
        limitation: values.limitation,
        created_by: values.createdBy,
      })
      .returning();
    if (!inserted) {
      throw new DeliveryConnectionConflictError(
        "destination revision insert failed",
      );
    }

    const consumed = await this.exec
      .update(deliveryAuthorizationGrants)
      .set({ state: "consumed", consumed_at: sql`now()` })
      .where(
        and(
          projectPredicate(deliveryAuthorizationGrants, scope),
          eq(deliveryAuthorizationGrants.id, grant.id),
          eq(deliveryAuthorizationGrants.state, "ready"),
        ),
      )
      .returning({ id: deliveryAuthorizationGrants.id });
    if (consumed.length !== 1) {
      throw new DeliveryAuthorizationGrantConflictError(
        "GRANT_STATE_INVALID",
      );
    }
    return inserted as PublicationDestinationRow;
  }

  async revoke(values: {
    workspaceId: string;
    projectId: string;
    destinationRef: string;
    baseRevision: number;
    actorId: string;
    reason: string;
  }): Promise<PublicationDestinationRow> {
    if (values.reason.trim().length === 0) {
      throw new PublicationInvariantError(
        "DESTINATION_LIMITATION_INVALID",
      );
    }
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const latest = await this.findLatest(scope, values.destinationRef, true);
    if (
      !latest ||
      latest.revision !== values.baseRevision ||
      latest.state === "revoked"
    ) {
      throw new DeliveryConnectionConflictError(
        "destination base revision is stale",
      );
    }
    const [row] = await this.exec
      .insert(publicationDestinations)
      .values({
        destination_ref: latest.destination_ref,
        revision: latest.revision + 1,
        supersedes_id: latest.id,
        workspace_id: latest.workspace_id,
        project_id: latest.project_id,
        site_id: latest.site_id,
        provider_kind: latest.provider_kind,
        target_ref: latest.target_ref,
        state: "revoked",
        authorization_grant_id: latest.authorization_grant_id,
        provider_scope: latest.provider_scope,
        provider_scope_hash: latest.provider_scope_hash,
        authorization_snapshot: latest.authorization_snapshot,
        authorization_snapshot_hash:
          latest.authorization_snapshot_hash,
        readiness_observation: {
          revokedBy: values.actorId,
          revokedAt: this.clock.now().toISOString(),
        },
        limitation: values.reason,
        created_by: values.actorId,
      })
      .returning();
    if (!row) {
      throw new DeliveryConnectionConflictError(
        "destination revocation insert failed",
      );
    }
    return row as PublicationDestinationRow;
  }
}

export interface PublicationReplay {
  readonly attempt: PublicationAttemptRow;
  readonly run: unknown;
  readonly receipts: readonly PublicationReceiptRow[];
  readonly replayed: true;
}

export interface PublicationExecutionReadOptions {
  readonly lock?: boolean;
}

export interface PublicationAttemptExecutionRead {
  readonly attempt: PublicationAttemptRow;
  readonly run: AsyncRunRow;
  readonly receipts: readonly PublicationReceiptRow[];
}

export interface PublicationRepositoryDependencies {
  readonly enqueue: (
    tx: DbTx,
    payload: {
      readonly runId: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly contractVersion: string;
    },
  ) => Promise<unknown> | unknown;
  readonly newId?: () => string;
  readonly clock?: PublicationClock;
}

interface IssuePublicationPreviewBase {
  readonly id?: string;
  readonly previewRef: string;
  readonly factsSchemaVersion: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly destination: Pick<
    PublicationDestinationRow,
    | "id"
    | "destination_ref"
    | "revision"
    | "workspace_id"
    | "project_id"
    | "site_id"
    | "provider_kind"
    | "target_ref"
    | "state"
  >;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly artifactRevision: number;
  readonly artifactContentHash: string;
  readonly artifactApprovalEventId: string;
  readonly providerPlan: Record<string, unknown>;
  readonly remotePrecondition: Record<string, unknown>;
  readonly rollbackPlan: Record<string, unknown>;
  readonly previewChecksum: string;
  readonly contentChecksum: string;
  readonly expiresAt: string;
  readonly eventActorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type IssuePublicationPreviewInput =
  IssuePublicationPreviewBase &
    (
      | {
          readonly previewKind: "publish";
          readonly sourcePublicationAttemptId: null;
          readonly sourceChangeReceiptId: null;
        }
      | {
          readonly previewKind: "rollback";
          readonly sourcePublicationAttemptId: string;
          readonly sourceChangeReceiptId: string;
        }
    );

export interface PublicationPreviewFactsHashInput
  extends IssuePublicationPreviewBase {
  readonly eventId: string;
  readonly previewKind: PublicationPreviewKind;
  readonly sourcePublicationAttemptId: string | null;
  readonly sourceChangeReceiptId: string | null;
}

export function publicationPreviewFactsHash(
  values: PublicationPreviewFactsHashInput,
): string {
  return hashJson({
    eventId: values.eventId,
    previewRef: values.previewRef,
    previewKind: values.previewKind,
    factsSchemaVersion: values.factsSchemaVersion,
    scope: {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
      siteId: values.siteId,
    },
    destination: {
      id: values.destination.id,
      destinationRef: values.destination.destination_ref,
      revision: values.destination.revision,
      providerKind: values.destination.provider_kind,
      targetRef: values.destination.target_ref,
    },
    actionId: values.actionId,
    artifact: {
      id: values.artifactId,
      revisionId: values.artifactRevisionId,
      revision: values.artifactRevision,
      contentHash: values.artifactContentHash,
      approvalEventId: values.artifactApprovalEventId,
    },
    sourcePublicationAttemptId: values.sourcePublicationAttemptId,
    sourceChangeReceiptId: values.sourceChangeReceiptId,
    providerPlan: values.providerPlan,
    remotePrecondition: values.remotePrecondition,
    rollbackPlan: values.rollbackPlan,
    previewChecksum: values.previewChecksum,
    contentChecksum: values.contentChecksum,
    expiresAt: values.expiresAt,
  });
}

export interface AppendTerminalPublicationPreviewInput {
  readonly sourcePreviewEventId: string;
  readonly previewRef: string;
  readonly eventKind: "revoked" | "superseded";
  readonly eventActorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly reason: string;
}

export interface ResolvedPublicationAttemptFacts {
  readonly attemptKind: PublicationAttemptKind;
  readonly sourcePublicationAttemptId: string | null;
  readonly siteId: string;
  readonly destination: Pick<
    PublicationDestinationRow,
    | "id"
    | "destination_ref"
    | "revision"
    | "workspace_id"
    | "project_id"
    | "site_id"
    | "provider_kind"
    | "target_ref"
    | "state"
  >;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly approvedArtifactRevision: number;
  readonly approvedArtifactContentHash: string;
  readonly contentChecksum: string;
  readonly publicationApprovalEventId: string | null;
  readonly sourceApprovalEventId: string | null;
  readonly authorizationGrant: Pick<
    DeliveryAuthorizationGrantRow,
    | "id"
    | "workspace_id"
    | "project_id"
    | "site_id"
    | "provider_kind"
    | "purpose"
    | "state"
    | "destination_ref"
    | "destination_revision"
    | "target_ref"
    | "authorization_snapshot"
    | "authorization_snapshot_hash"
    | "expires_at"
  >;
  readonly authorizationPurpose: "publish" | "rollback";
  readonly previewEventId: string;
  readonly previewEventKind: "issued";
  readonly previewFactsHash: string;
  readonly previewRef: string;
  readonly previewChecksum: string;
  readonly remotePrecondition: Record<string, unknown>;
  readonly rollbackPlan: Record<string, unknown>;
}

export interface CreatePublicationAttemptTransaction {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly destinationRef: string;
  readonly targetRef: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyExpiresAt: string;
  readonly requestedBy: string;
  readonly contractVersion: string;
  readonly sourceChangeReceiptId?: string;
  readonly resolveCurrentFacts: (
    tx: DbTx,
  ) => Promise<ResolvedPublicationAttemptFacts>;
}

export interface PublicationAttemptTransactionResult {
  readonly attempt: PublicationAttemptRow;
  readonly run: unknown;
  readonly receipts: readonly PublicationReceiptRow[];
  readonly replayed: boolean;
}

export function publicationActiveKey(
  destinationRef: string,
  targetRef: string,
): string {
  return `publication:${destinationRef}:${targetRef}`;
}

export function publicationRequestHash(value: unknown): string {
  return hashJson(value);
}

export class PublicationsRepository extends Repository {
  private readonly newId: () => string;
  private readonly clock: PublicationClock;

  constructor(
    exec: Executor,
    private readonly dependencies: PublicationRepositoryDependencies,
  ) {
    super(exec);
    this.newId = dependencies.newId ?? randomUUID;
    this.clock = dependencies.clock ?? systemPublicationClock;
  }

  private async findPreviewByPermanentKey(
    scope: ProjectScope,
    idempotencyKey: string,
    lock = false,
  ): Promise<PublicationPreviewEventRow | null> {
    const query = this.exec
      .select()
      .from(publicationPreviewEvents)
      .where(
        and(
          projectPredicate(publicationPreviewEvents, scope),
          eq(
            publicationPreviewEvents.idempotency_key,
            idempotencyKey,
          ),
        ),
      )
      .limit(1);
    const rows = await (lock ? query.for("update") : query);
    return (rows[0] as PublicationPreviewEventRow | undefined) ?? null;
  }

  async findCurrentIssuedPreview(
    scope: ProjectScope,
    values: {
      readonly previewRef: string;
      readonly previewEventId?: string;
    },
    options: {
      readonly lock?: boolean;
      readonly requireActiveProject?: boolean;
    } = {},
  ): Promise<PublicationPreviewEventRow | null> {
    const activeProject =
      options.requireActiveProject === false
        ? undefined
        : sql`exists (
            select 1
              from app.client_projects active_project
             where active_project.id = ${scope.projectId}
               and active_project.workspace_id = ${scope.workspaceId}
               and active_project.archived_at is null
          )`;
    const query = this.exec
      .select()
      .from(publicationPreviewEvents)
      .where(
        and(
          projectPredicate(publicationPreviewEvents, scope),
          activeProject,
          values.previewEventId === undefined
            ? undefined
            : eq(
                publicationPreviewEvents.id,
                values.previewEventId,
              ),
          eq(
            publicationPreviewEvents.preview_ref,
            values.previewRef,
          ),
          eq(publicationPreviewEvents.event_kind, "issued"),
          gt(
            publicationPreviewEvents.expires_at,
            this.clock.now().toISOString(),
          ),
          sql`not exists (
            select 1
              from app.publication_preview_events terminal_preview
             where terminal_preview.workspace_id = ${scope.workspaceId}
               and terminal_preview.project_id = ${scope.projectId}
               and terminal_preview.supersedes_preview_event_id =
                 ${publicationPreviewEvents.id}
          )`,
          sql`not exists (
            select 1
              from app.publication_attempts consumed_attempt
             where consumed_attempt.workspace_id = ${scope.workspaceId}
               and consumed_attempt.project_id = ${scope.projectId}
               and consumed_attempt.preview_event_id =
                 ${publicationPreviewEvents.id}
          )`,
        ),
      )
      .limit(1);
    const rows = await (options.lock ? query.for("update") : query);
    return (rows[0] as PublicationPreviewEventRow | undefined) ?? null;
  }

  private validateIssuedPreviewInput(
    values: IssuePublicationPreviewInput,
  ): void {
    if (
      values.destination.workspace_id !== values.workspaceId ||
      values.destination.project_id !== values.projectId ||
      values.destination.site_id !== values.siteId ||
      values.destination.state !== "ready"
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_SCOPE_INVALID",
      );
    }
    if (
      values.previewChecksum !== values.artifactContentHash ||
      !/^[a-f0-9]{64}$/u.test(values.artifactContentHash) ||
      !/^[a-f0-9]{64}$/u.test(values.previewChecksum) ||
      !/^[a-f0-9]{64}$/u.test(values.contentChecksum) ||
      !/^[a-f0-9]{64}$/u.test(values.requestHash)
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_HASH_INVALID",
      );
    }
    const isObject = (value: unknown): value is Record<string, unknown> =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
    if (
      values.previewRef.length < 32 ||
      values.previewRef.length > 1_024 ||
      !/^[A-Za-z0-9._~-]+$/u.test(values.previewRef) ||
      values.factsSchemaVersion.trim().length < 1 ||
      values.factsSchemaVersion.trim().length > 100 ||
      values.idempotencyKey.length < 1 ||
      values.idempotencyKey.length > 128 ||
      !/^[ -~]+$/u.test(values.idempotencyKey) ||
      values.destination.revision < 1 ||
      !Number.isInteger(values.destination.revision) ||
      values.artifactRevision < 1 ||
      !Number.isInteger(values.artifactRevision) ||
      values.destination.target_ref.trim().length < 1 ||
      isExpired(values.expiresAt, this.clock.now()) ||
      !isObject(values.providerPlan) ||
      !isObject(values.remotePrecondition) ||
      !isObject(values.rollbackPlan) ||
      typeof values.remotePrecondition.kind !== "string" ||
      values.remotePrecondition.kind.trim().length < 1
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_INPUT_INVALID",
      );
    }
    if (
      values.providerPlan.providerKind !==
        values.destination.provider_kind ||
      values.rollbackPlan.providerKind !==
        values.destination.provider_kind
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_PROVIDER_INVALID",
      );
    }
    if (
      (values.previewKind === "publish" &&
        (values.sourcePublicationAttemptId !== null ||
          values.sourceChangeReceiptId !== null)) ||
      (values.previewKind === "rollback" &&
        (values.sourcePublicationAttemptId.trim().length < 1 ||
          values.sourceChangeReceiptId.trim().length < 1))
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_SOURCE_INVALID",
      );
    }
  }

  private exactIssuedPreviewReplay(
    existing: PublicationPreviewEventRow,
    values: IssuePublicationPreviewInput,
  ): PublicationPreviewEventRow {
    const eventId = values.id ?? existing.id;
    const expectedFactsHash = publicationPreviewFactsHash({
      ...values,
      eventId,
    });
    if (
      existing.id !== eventId ||
      existing.event_kind !== "issued" ||
      existing.preview_ref !== values.previewRef ||
      existing.preview_kind !== values.previewKind ||
      existing.request_hash !== values.requestHash ||
      existing.facts_hash !== expectedFactsHash
    ) {
      throw new PublicationIdempotencyConflictError(
        "publication preview idempotency key was reused",
      );
    }
    return existing;
  }

  async issuePreview(
    values: IssuePublicationPreviewInput,
  ): Promise<PublicationPreviewEventRow> {
    this.validateIssuedPreviewInput(values);
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const existing = await this.findPreviewByPermanentKey(
      scope,
      values.idempotencyKey,
      true,
    );
    if (existing) return this.exactIssuedPreviewReplay(existing, values);

    const id = values.id ?? this.newId();
    const factsHash = publicationPreviewFactsHash({
      ...values,
      eventId: id,
    });
    const [inserted] = await this.exec
      .insert(publicationPreviewEvents)
      .values({
        id,
        preview_ref: values.previewRef,
        event_kind: "issued",
        supersedes_preview_event_id: null,
        supersedes_preview_event_kind: null,
        preview_kind: values.previewKind,
        facts_schema_version: values.factsSchemaVersion,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        destination_id: values.destination.id,
        destination_ref: values.destination.destination_ref,
        destination_revision: values.destination.revision,
        provider_kind: values.destination.provider_kind,
        target_ref: values.destination.target_ref,
        action_id: values.actionId,
        artifact_id: values.artifactId,
        artifact_revision_id: values.artifactRevisionId,
        artifact_revision: values.artifactRevision,
        artifact_content_hash: values.artifactContentHash,
        artifact_approval_event_id:
          values.artifactApprovalEventId,
        artifact_approval_event_kind: "approved",
        source_publication_attempt_id:
          values.sourcePublicationAttemptId,
        source_change_receipt_id: values.sourceChangeReceiptId,
        provider_plan: values.providerPlan,
        remote_precondition: values.remotePrecondition,
        rollback_plan: values.rollbackPlan,
        preview_checksum: values.previewChecksum,
        content_checksum: values.contentChecksum,
        facts_hash: factsHash,
        expires_at: values.expiresAt,
        event_actor_id: values.eventActorId,
        idempotency_key: values.idempotencyKey,
        request_hash: values.requestHash,
        reason: null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as PublicationPreviewEventRow;

    const winner = await this.findPreviewByPermanentKey(
      scope,
      values.idempotencyKey,
      true,
    );
    if (!winner) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_INSERT_FAILED",
      );
    }
    return this.exactIssuedPreviewReplay(winner, values);
  }

  private exactTerminalPreviewReplay(
    existing: PublicationPreviewEventRow,
    values: AppendTerminalPublicationPreviewInput,
  ): PublicationPreviewEventRow {
    if (
      existing.event_kind !== values.eventKind ||
      existing.supersedes_preview_event_id !==
        values.sourcePreviewEventId ||
      existing.supersedes_preview_event_kind !== "issued" ||
      existing.preview_ref !== values.previewRef ||
      existing.request_hash !== values.requestHash ||
      existing.reason !== values.reason
    ) {
      throw new PublicationIdempotencyConflictError(
        "publication preview idempotency key was reused",
      );
    }
    return existing;
  }

  async appendTerminalPreviewEvent(
    scope: ProjectScope,
    values: AppendTerminalPublicationPreviewInput,
  ): Promise<PublicationPreviewEventRow> {
    if (
      values.previewRef.length < 32 ||
      values.previewRef.length > 1_024 ||
      !/^[A-Za-z0-9._~-]+$/u.test(values.previewRef) ||
      values.idempotencyKey.length < 1 ||
      values.idempotencyKey.length > 128 ||
      !/^[ -~]+$/u.test(values.idempotencyKey) ||
      !/^[a-f0-9]{64}$/u.test(values.requestHash) ||
      values.reason.trim().length < 3 ||
      values.reason.trim().length > 2_000
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_TERMINAL_INPUT_INVALID",
      );
    }
    const existing = await this.findPreviewByPermanentKey(
      scope,
      values.idempotencyKey,
      true,
    );
    if (existing) {
      return this.exactTerminalPreviewReplay(existing, values);
    }

    const source = await this.findCurrentIssuedPreview(
      scope,
      {
        previewRef: values.previewRef,
        previewEventId: values.sourcePreviewEventId,
      },
      { lock: true, requireActiveProject: false },
    );
    if (!source) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_NOT_CURRENT",
      );
    }
    const [inserted] = await this.exec
      .insert(publicationPreviewEvents)
      .values({
        id: this.newId(),
        preview_ref: source.preview_ref,
        event_kind: values.eventKind,
        supersedes_preview_event_id: source.id,
        supersedes_preview_event_kind: "issued",
        preview_kind: source.preview_kind,
        facts_schema_version: source.facts_schema_version,
        workspace_id: source.workspace_id,
        project_id: source.project_id,
        site_id: source.site_id,
        destination_id: source.destination_id,
        destination_ref: source.destination_ref,
        destination_revision: source.destination_revision,
        provider_kind: source.provider_kind,
        target_ref: source.target_ref,
        action_id: source.action_id,
        artifact_id: source.artifact_id,
        artifact_revision_id: source.artifact_revision_id,
        artifact_revision: source.artifact_revision,
        artifact_content_hash: source.artifact_content_hash,
        artifact_approval_event_id:
          source.artifact_approval_event_id,
        artifact_approval_event_kind:
          source.artifact_approval_event_kind,
        source_publication_attempt_id:
          source.source_publication_attempt_id,
        source_change_receipt_id: source.source_change_receipt_id,
        provider_plan: source.provider_plan,
        remote_precondition: source.remote_precondition,
        rollback_plan: source.rollback_plan,
        preview_checksum: source.preview_checksum,
        content_checksum: source.content_checksum,
        facts_hash: source.facts_hash,
        expires_at: source.expires_at,
        event_actor_id: values.eventActorId,
        idempotency_key: values.idempotencyKey,
        request_hash: values.requestHash,
        reason: values.reason,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as PublicationPreviewEventRow;

    const winner = await this.findPreviewByPermanentKey(
      scope,
      values.idempotencyKey,
      true,
    );
    if (!winner) {
      throw new PublicationInvariantError(
        "PUBLICATION_PREVIEW_TERMINAL_INSERT_FAILED",
      );
    }
    return this.exactTerminalPreviewReplay(winner, values);
  }

  private async requireExactAttemptPreview(
    scope: ProjectScope,
    facts: ResolvedPublicationAttemptFacts,
    sourceChangeReceiptId: string | null,
  ): Promise<PublicationPreviewEventRow> {
    const preview = await this.findCurrentIssuedPreview(
      scope,
      {
        previewRef: facts.previewRef,
        previewEventId: facts.previewEventId,
      },
      { lock: true },
    );
    const approvalEventId =
      facts.attemptKind === "publish"
        ? facts.publicationApprovalEventId
        : facts.sourceApprovalEventId;
    if (
      !preview ||
      facts.previewEventKind !== "issued" ||
      preview.facts_hash !== facts.previewFactsHash ||
      preview.preview_kind !== facts.attemptKind ||
      preview.workspace_id !== scope.workspaceId ||
      preview.project_id !== scope.projectId ||
      preview.site_id !== facts.siteId ||
      preview.destination_id !== facts.destination.id ||
      preview.destination_ref !== facts.destination.destination_ref ||
      preview.destination_revision !== facts.destination.revision ||
      preview.provider_kind !== facts.destination.provider_kind ||
      preview.target_ref !== facts.destination.target_ref ||
      preview.action_id !== facts.actionId ||
      preview.artifact_id !== facts.artifactId ||
      preview.artifact_revision_id !== facts.artifactRevisionId ||
      preview.artifact_revision !== facts.approvedArtifactRevision ||
      preview.artifact_content_hash !==
        facts.approvedArtifactContentHash ||
      preview.artifact_approval_event_id !== approvalEventId ||
      preview.artifact_approval_event_kind !== "approved" ||
      preview.source_publication_attempt_id !==
        facts.sourcePublicationAttemptId ||
      preview.source_change_receipt_id !== sourceChangeReceiptId ||
      preview.provider_plan.providerKind !==
        facts.destination.provider_kind ||
      preview.preview_checksum !== facts.previewChecksum ||
      preview.content_checksum !== facts.contentChecksum ||
      hashJson(preview.remote_precondition) !==
        hashJson(facts.remotePrecondition) ||
      hashJson(preview.rollback_plan) !== hashJson(facts.rollbackPlan)
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_ATTEMPT_PREVIEW_INVALID",
      );
    }
    return preview;
  }

  private async findAttemptAndRun(
    scope: ProjectScope,
    attemptId: string,
    options: PublicationExecutionReadOptions,
    requireActiveProject = true,
  ): Promise<
    | {
        readonly attempt: PublicationAttemptRow;
        readonly run: AsyncRunRow;
      }
    | null
  > {
    const activeProject = requireActiveProject
      ? sql`exists (
          select 1
            from app.client_projects active_project
           where active_project.id = ${scope.projectId}
             and active_project.workspace_id = ${scope.workspaceId}
             and active_project.archived_at is null
        )`
      : undefined;
    const attemptQuery = this.exec
      .select()
      .from(publicationAttempts)
      .where(
        and(
          projectPredicate(publicationAttempts, scope),
          activeProject,
          eq(publicationAttempts.id, attemptId),
        ),
      )
      .limit(1);
    const attemptRows = await (options.lock
      ? attemptQuery.for("share")
      : attemptQuery);
    const attempt = attemptRows[0] as PublicationAttemptRow | undefined;
    if (!attempt) return null;

    const runQuery = this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          activeProject,
          eq(asyncRuns.id, attempt.async_run_id),
          eq(asyncRuns.kind, "publication"),
          eq(asyncRuns.result_type, "publication_attempt"),
          eq(asyncRuns.result_id, attempt.id),
          eq(
            asyncRuns.active_key,
            publicationActiveKey(
              attempt.destination_ref,
              attempt.target_ref,
            ),
          ),
        ),
      )
      .limit(1);
    const runRows = await (options.lock
      ? runQuery.for("share")
      : runQuery);
    const run = runRows[0] as AsyncRunRow | undefined;
    if (!run) {
      throw new PublicationInvariantError("PUBLICATION_RUN_MISSING");
    }
    return { attempt, run };
  }

  private async listReceiptRows(
    scope: ProjectScope,
    attempt: PublicationAttemptRow,
    options: PublicationExecutionReadOptions,
    requireActiveProject = true,
  ): Promise<PublicationReceiptRow[]> {
    const activeProject = requireActiveProject
      ? sql`exists (
          select 1
            from app.client_projects active_project
           where active_project.id = ${scope.projectId}
             and active_project.workspace_id = ${scope.workspaceId}
             and active_project.archived_at is null
        )`
      : undefined;
    const query = this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          activeProject,
          eq(
            publicationReceipts.publication_attempt_id,
            attempt.id,
          ),
        ),
      )
      .orderBy(
        asc(publicationReceipts.observed_at),
        asc(publicationReceipts.id),
      )
      .limit(3);
    const rows = (await (options.lock ? query.for("share") : query)) as
      PublicationReceiptRow[];
    const kinds = new Set(rows.map((row) => row.receipt_kind));
    if (rows.length > 2 || kinds.size !== rows.length) {
      throw new PublicationInvariantError(
        "PUBLICATION_RECEIPT_SET_INVALID",
      );
    }
    const delivery = rows.find(
      (row) => row.receipt_kind === "delivery_receipt",
    );
    const change = rows.find(
      (row) => row.receipt_kind === "change_receipt",
    );
    if (
      rows.some(
        (row) =>
          row.artifact_content_hash !==
            attempt.approved_artifact_content_hash ||
          row.content_checksum !== attempt.content_checksum,
      ) ||
      (delivery !== undefined &&
        delivery.predecessor_delivery_receipt_id !== null) ||
      (change !== undefined &&
        (delivery === undefined ||
          change.predecessor_delivery_receipt_id !== delivery.id))
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_RECEIPT_SET_INVALID",
      );
    }
    return rows;
  }

  async findAttemptById(
    scope: ProjectScope,
    attemptId: string,
    options: PublicationExecutionReadOptions = {},
  ): Promise<PublicationAttemptRow | null> {
    const found = await this.findAttemptAndRun(
      scope,
      attemptId,
      options,
    );
    return found?.attempt ?? null;
  }

  async listReceipts(
    scope: ProjectScope,
    attemptId: string,
    options: PublicationExecutionReadOptions = {},
  ): Promise<PublicationReceiptRow[]> {
    const found = await this.findAttemptAndRun(
      scope,
      attemptId,
      options,
    );
    if (!found) return [];
    return this.listReceiptRows(scope, found.attempt, options);
  }

  async loadAttemptForExecution(
    scope: ProjectScope,
    attemptId: string,
    options: PublicationExecutionReadOptions = {},
  ): Promise<PublicationAttemptExecutionRead | null> {
    // External writes deliberately retain the active-project fence. Archiving
    // after acceptance stops provider execution; the worker must terminalize
    // that accepted run without performing the write.
    const found = await this.findAttemptAndRun(
      scope,
      attemptId,
      options,
    );
    if (!found) return null;
    const receipts = await this.listReceiptRows(
      scope,
      found.attempt,
      options,
    );
    return { ...found, receipts };
  }

  async loadAttemptHistory(
    scope: ProjectScope,
    attemptId: string,
  ): Promise<PublicationAttemptExecutionRead | null> {
    // Immutable client-visible history remains readable after archival, while
    // preserving exact workspace/project and publication-run lineage.
    const found = await this.findAttemptAndRun(
      scope,
      attemptId,
      {},
      false,
    );
    if (!found) return null;
    const receipts = await this.listReceiptRows(
      scope,
      found.attempt,
      {},
      false,
    );
    return { ...found, receipts };
  }

  async findAttemptByPermanentKey(
    scope: ProjectScope,
    idempotencyKey: string,
    lock = false,
  ): Promise<PublicationAttemptRow | null> {
    const query = this.exec
      .select()
      .from(publicationAttempts)
      .where(
        and(
          projectPredicate(publicationAttempts, scope),
          eq(publicationAttempts.idempotency_key, idempotencyKey),
        ),
      )
      .limit(1);
    const rows = await (lock ? query.for("update") : query);
    return (rows[0] as PublicationAttemptRow | undefined) ?? null;
  }

  async replayByPermanentKey(
    scope: ProjectScope,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PublicationReplay | null> {
    const attempt = await this.findAttemptByPermanentKey(
      scope,
      idempotencyKey,
      true,
    );
    if (!attempt) return null;
    if (attempt.request_hash !== requestHash) {
      throw new PublicationIdempotencyConflictError(
        "publication idempotency key was reused",
      );
    }
    const runRows = await this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, attempt.async_run_id),
        ),
      )
      .limit(1);
    const run = runRows[0];
    if (!run) {
      throw new PublicationInvariantError("PUBLICATION_RUN_MISSING");
    }
    const receipts = (await this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(
            publicationReceipts.publication_attempt_id,
            attempt.id,
          ),
        ),
      )
      .orderBy(
        asc(publicationReceipts.observed_at),
        asc(publicationReceipts.id),
      )) as PublicationReceiptRow[];
    return { attempt, run, receipts, replayed: true };
  }

  async requireRollbackSource(
    scope: ProjectScope,
    values: {
      sourcePublicationAttemptId: string;
      sourceChangeReceiptId: string;
      destinationRef: string;
      providerKind: PublicationProviderKind;
      targetRef: string;
    },
  ): Promise<{
    readonly attempt: PublicationAttemptRow;
    readonly changeReceipt: PublicationReceiptRow;
  }> {
    const attemptRows = await this.exec
      .select()
      .from(publicationAttempts)
      .where(
        and(
          projectPredicate(publicationAttempts, scope),
          eq(
            publicationAttempts.id,
            values.sourcePublicationAttemptId,
          ),
          eq(
            publicationAttempts.destination_ref,
            values.destinationRef,
          ),
          eq(publicationAttempts.provider_kind, values.providerKind),
          eq(publicationAttempts.target_ref, values.targetRef),
        ),
      )
      .limit(1)
      .for("share");
    const attempt = attemptRows[0] as PublicationAttemptRow | undefined;
    if (!attempt) {
      throw new PublicationInvariantError(
        "ROLLBACK_SOURCE_ATTEMPT_INVALID",
      );
    }
    const receiptRows = await this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(publicationReceipts.id, values.sourceChangeReceiptId),
          eq(
            publicationReceipts.publication_attempt_id,
            attempt.id,
          ),
          eq(publicationReceipts.receipt_kind, "change_receipt"),
          eq(publicationReceipts.verification_state, "verified_live"),
        ),
      )
      .limit(1)
      .for("share");
    const changeReceipt = receiptRows[0] as
      | PublicationReceiptRow
      | undefined;
    if (!changeReceipt) {
      throw new PublicationInvariantError(
        "ROLLBACK_SOURCE_CHANGE_NOT_VERIFIED",
      );
    }
    return { attempt, changeReceipt };
  }

  async appendReceipt(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    publicationAttemptId: string;
    receiptKind: PublicationReceiptKind;
    predecessorDeliveryReceiptId: string | null;
    providerKind: PublicationProviderKind;
    providerRequestId: string | null;
    remoteScopeRef: string;
    remoteObjectKind:
      | "github_pull_request"
      | "github_merge"
      | "wordpress_post"
      | "wordpress_revision";
    remoteObjectId: string;
    remoteRevision: string;
    deliveryUrl: string | null;
    liveCanonicalUrl: string | null;
    artifactContentHash: string;
    contentChecksum: string;
    verificationState:
      | "provider_accepted"
      | "pending"
      | "verified_live"
      | "unavailable";
    remoteFacts: Record<string, unknown>;
    evidenceRefs: readonly unknown[];
    limitation: string | null;
    observedAt: string;
  }): Promise<PublicationReceiptRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const deliveryRemoteObjectKind =
      (values.providerKind === "github" &&
        values.remoteObjectKind === "github_pull_request") ||
      (values.providerKind === "wordpress" &&
        values.remoteObjectKind === "wordpress_post");
    const changeRemoteObjectKind =
      (values.providerKind === "github" &&
        values.remoteObjectKind === "github_merge") ||
      (values.providerKind === "wordpress" &&
        values.remoteObjectKind === "wordpress_revision");
    if (
      !/^[a-f0-9]{64}$/u.test(values.artifactContentHash) ||
      !/^[a-f0-9]{64}$/u.test(values.contentChecksum)
    ) {
      throw new PublicationInvariantError("RECEIPT_HASH_INVALID");
    }
    if (
      values.receiptKind === "delivery_receipt" &&
      (values.predecessorDeliveryReceiptId !== null ||
        values.liveCanonicalUrl !== null ||
        values.verificationState === "verified_live" ||
        !deliveryRemoteObjectKind ||
        (values.verificationState === "unavailable" &&
          values.limitation === null))
    ) {
      throw new PublicationInvariantError(
        "DELIVERY_RECEIPT_CANNOT_ASSERT_CHANGE",
      );
    }
    if (
      values.receiptKind === "change_receipt" &&
      (!values.predecessorDeliveryReceiptId ||
        !values.liveCanonicalUrl ||
        values.verificationState !== "verified_live" ||
        values.evidenceRefs.length < 1 ||
        values.limitation !== null ||
        !changeRemoteObjectKind)
    ) {
      throw new PublicationInvariantError(
        "CHANGE_RECEIPT_NOT_VERIFIED",
      );
    }
    const attempts = await this.exec
      .select()
      .from(publicationAttempts)
      .where(
        and(
          projectPredicate(publicationAttempts, scope),
          eq(publicationAttempts.id, values.publicationAttemptId),
          eq(publicationAttempts.site_id, values.siteId),
          eq(publicationAttempts.provider_kind, values.providerKind),
          eq(
            publicationAttempts.approved_artifact_content_hash,
            values.artifactContentHash,
          ),
          eq(
            publicationAttempts.content_checksum,
            values.contentChecksum,
          ),
        ),
      )
      .limit(1);
    if (!attempts[0]) {
      throw new PublicationInvariantError(
        "RECEIPT_ATTEMPT_LINEAGE_INVALID",
      );
    }

    const [inserted] = await this.exec
      .insert(publicationReceipts)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        publication_attempt_id: values.publicationAttemptId,
        receipt_kind: values.receiptKind,
        predecessor_delivery_receipt_id:
          values.predecessorDeliveryReceiptId,
        provider_kind: values.providerKind,
        provider_request_id: values.providerRequestId,
        remote_scope_ref: values.remoteScopeRef,
        remote_object_kind: values.remoteObjectKind,
        remote_object_id: values.remoteObjectId,
        remote_revision: values.remoteRevision,
        delivery_url: values.deliveryUrl,
        live_canonical_url: values.liveCanonicalUrl,
        artifact_content_hash: values.artifactContentHash,
        content_checksum: values.contentChecksum,
        verification_state: values.verificationState,
        remote_facts: values.remoteFacts,
        evidence_refs: [...values.evidenceRefs],
        limitation: values.limitation,
        observed_at: values.observedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as PublicationReceiptRow;

    const existingRows = await this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(
            publicationReceipts.publication_attempt_id,
            values.publicationAttemptId,
          ),
          eq(publicationReceipts.receipt_kind, values.receiptKind),
        ),
      )
      .limit(1);
    const existing = existingRows[0] as PublicationReceiptRow | undefined;
    if (
      !existing ||
      existing.workspace_id !== values.workspaceId ||
      existing.project_id !== values.projectId ||
      existing.site_id !== values.siteId ||
      existing.publication_attempt_id !== values.publicationAttemptId ||
      existing.receipt_kind !== values.receiptKind ||
      existing.predecessor_delivery_receipt_id !==
        values.predecessorDeliveryReceiptId ||
      existing.provider_kind !== values.providerKind ||
      existing.provider_request_id !== values.providerRequestId ||
      existing.remote_scope_ref !== values.remoteScopeRef ||
      existing.remote_object_kind !== values.remoteObjectKind ||
      existing.remote_object_id !== values.remoteObjectId ||
      existing.remote_revision !== values.remoteRevision ||
      existing.delivery_url !== values.deliveryUrl ||
      existing.live_canonical_url !== values.liveCanonicalUrl ||
      existing.artifact_content_hash !== values.artifactContentHash ||
      existing.content_checksum !== values.contentChecksum ||
      existing.verification_state !== values.verificationState ||
      hashJson(existing.remote_facts) !== hashJson(values.remoteFacts) ||
      hashJson(existing.evidence_refs) !== hashJson(values.evidenceRefs) ||
      existing.limitation !== values.limitation ||
      !isSameInstant(existing.observed_at, values.observedAt)
    ) {
      throw new PublicationInvariantError("RECEIPT_REPLAY_CONFLICT");
    }
    return existing;
  }

  /**
   * Low-level immutable attempt insert for an already validated canonical
   * transaction. The coordinator below supplies ids and enqueues in the same
   * transaction; callers cannot use this to manufacture a second status.
   */
  async insertAttempt(values: {
    id?: string;
    runId: string;
    attemptKind: PublicationAttemptKind;
    sourcePublicationAttemptId: string | null;
    sourceChangeReceiptId: string | null;
    workspaceId: string;
    projectId: string;
    siteId: string;
    destination: Pick<
      PublicationDestinationRow,
      "id" | "destination_ref" | "revision" | "provider_kind" | "target_ref"
    >;
    actionId: string;
    artifactId: string;
    artifactRevisionId: string;
    approvedArtifactRevision: number;
    approvedArtifactContentHash: string;
    contentChecksum: string;
    publicationApprovalEventId: string | null;
    sourceApprovalEventId: string | null;
    authorizationGrant: Pick<
      DeliveryAuthorizationGrantRow,
      "id" | "authorization_snapshot" | "authorization_snapshot_hash"
    >;
    authorizationPurpose: "publish" | "rollback";
    previewEventId: string;
    previewEventKind: "issued";
    previewFactsHash: string;
    previewRef: string;
    previewChecksum: string;
    remotePrecondition: Record<string, unknown>;
    rollbackPlan: Record<string, unknown>;
    idempotencyKey: string;
    requestHash: string;
    requestedBy: string;
  }): Promise<PublicationAttemptRow> {
    if (
      values.previewChecksum !== values.approvedArtifactContentHash ||
      !/^[a-f0-9]{64}$/u.test(values.approvedArtifactContentHash) ||
      !/^[a-f0-9]{64}$/u.test(values.contentChecksum) ||
      values.previewEventKind !== "issued" ||
      !/^[a-f0-9]{64}$/u.test(values.previewFactsHash)
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_ATTEMPT_HASH_INVALID",
      );
    }
    const id = values.id ?? this.newId();
    const [row] = await this.exec
      .insert(publicationAttempts)
      .values({
        id,
        attempt_kind: values.attemptKind,
        source_publication_attempt_id:
          values.sourcePublicationAttemptId,
        source_change_receipt_id: values.sourceChangeReceiptId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        async_run_id: values.runId,
        destination_id: values.destination.id,
        destination_ref: values.destination.destination_ref,
        destination_revision: values.destination.revision,
        provider_kind: values.destination.provider_kind,
        target_ref: values.destination.target_ref,
        action_id: values.actionId,
        artifact_id: values.artifactId,
        artifact_revision_id: values.artifactRevisionId,
        approved_artifact_revision: values.approvedArtifactRevision,
        approved_artifact_content_hash:
          values.approvedArtifactContentHash,
        publication_approval_event_id:
          values.publicationApprovalEventId,
        publication_approval_event_kind:
          values.publicationApprovalEventId ? "approved" : null,
        source_approval_event_id: values.sourceApprovalEventId,
        source_approval_event_kind: values.sourceApprovalEventId
          ? "approved"
          : null,
        side_effect_class: "external_write",
        authorization_grant_id: values.authorizationGrant.id,
        authorization_purpose: values.authorizationPurpose,
        authorization_snapshot:
          values.authorizationGrant.authorization_snapshot,
        authorization_snapshot_hash:
          values.authorizationGrant.authorization_snapshot_hash,
        preview_event_id: values.previewEventId,
        preview_event_kind: values.previewEventKind,
        preview_facts_hash: values.previewFactsHash,
        preview_ref: values.previewRef,
        preview_checksum: values.previewChecksum,
        content_checksum: values.contentChecksum,
        remote_precondition: values.remotePrecondition,
        rollback_plan: values.rollbackPlan,
        idempotency_key: values.idempotencyKey,
        request_hash: values.requestHash,
        requested_by: values.requestedBy,
      })
      .returning();
    if (!row) {
      throw new PublicationInvariantError(
        "PUBLICATION_ATTEMPT_INSERT_FAILED",
      );
    }
    return row as PublicationAttemptRow;
  }

  /**
   * Permanent idempotency check, current-fact resolution, canonical run,
   * attempt, grant consumption, shared idempotency response and pg-boss enqueue
   * commit as one transaction. The resolver is deliberately invoked only after
   * both permanent and 24-hour idempotency ledgers prove this is a new command:
   * original-key replay therefore remains read-only even if its old destination
   * or approval has since been revoked, while the same payload under a new key
   * must re-read current facts.
   */
  async createAttemptAtomically(
    command: CreatePublicationAttemptTransaction,
  ): Promise<PublicationAttemptTransactionResult> {
    if (
      command.idempotencyKey.length < 1 ||
      command.idempotencyKey.length > 128 ||
      !/^[ -~]+$/u.test(command.idempotencyKey) ||
      !/^[a-f0-9]{64}$/u.test(command.requestHash)
    ) {
      throw new PublicationInvariantError(
        "PUBLICATION_IDEMPOTENCY_INPUT_INVALID",
      );
    }
    const scope = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
    };
    const historical = await this.replayByPermanentKey(
      scope,
      command.idempotencyKey,
      command.requestHash,
    );
    if (historical) return historical;

    const transactional = this.exec as Executor & {
      transaction?: <T>(
        run: (tx: DbTx) => Promise<T>,
        config?: {
          readonly isolationLevel?: "repeatable read";
        },
      ) => Promise<T>;
    };
    if (typeof transactional.transaction !== "function") {
      throw new PublicationInvariantError(
        "PUBLICATION_ATOMIC_TRANSACTION_REQUIRED",
      );
    }

    try {
      return await transactional.transaction(
        async (tx) => {
          const publications = new PublicationsRepository(
            tx,
            this.dependencies,
          );
          const replay = await publications.replayByPermanentKey(
            scope,
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay) return replay;

          const idempotency = new IdempotencyRepository(tx);
          const reserved = await idempotency.begin({
            workspaceId: command.workspaceId,
            scope: `publicationAttempt:${command.projectId}`,
            key: command.idempotencyKey,
            requestHash: command.requestHash,
            expiresAt: command.idempotencyExpiresAt,
          });
          if (!reserved) {
            const existing = await idempotency.find(
              command.workspaceId,
              `publicationAttempt:${command.projectId}`,
              command.idempotencyKey,
            );
            if (existing?.request_hash !== command.requestHash) {
              throw new PublicationIdempotencyConflictError(
                "publication idempotency key was reused",
              );
            }
            const winner = await publications.replayByPermanentKey(
              scope,
              command.idempotencyKey,
              command.requestHash,
            );
            if (winner) return winner;
            throw new PublicationInvariantError(
              "PUBLICATION_IDEMPOTENCY_IN_PROGRESS",
            );
          }

        const facts = await command.resolveCurrentFacts(tx);
        if (
          facts.destination.workspace_id !== command.workspaceId ||
          facts.destination.project_id !== command.projectId ||
          facts.destination.destination_ref !== command.destinationRef ||
          facts.destination.target_ref !== command.targetRef ||
          facts.destination.site_id !== facts.siteId ||
          facts.destination.state !== "ready"
        ) {
          throw new PublicationInvariantError(
            "PUBLICATION_DESTINATION_STALE",
          );
        }
        exactGrantBinding(
          facts.authorizationGrant as DeliveryAuthorizationGrantRow,
          {
            siteId: facts.siteId,
            providerKind: facts.destination.provider_kind,
            purpose: facts.authorizationPurpose,
            destinationRef: command.destinationRef,
            destinationRevision: facts.destination.revision,
            targetRef: command.targetRef,
          },
          this.clock.now(),
        );
        if (
          facts.previewChecksum !== facts.approvedArtifactContentHash ||
          !/^[a-f0-9]{64}$/u.test(
            facts.approvedArtifactContentHash,
          ) ||
          !/^[a-f0-9]{64}$/u.test(facts.contentChecksum)
        ) {
          throw new PublicationInvariantError(
            "PUBLICATION_ATTEMPT_AUTHORIZATION_INVALID",
          );
        }
        if (
          (facts.attemptKind === "publish" &&
            (facts.authorizationPurpose !== "publish" ||
              facts.sourcePublicationAttemptId !== null ||
              command.sourceChangeReceiptId != null ||
              facts.publicationApprovalEventId === null ||
              facts.sourceApprovalEventId !== null)) ||
          (facts.attemptKind === "rollback" &&
            (facts.authorizationPurpose !== "rollback" ||
              facts.sourcePublicationAttemptId === null ||
              facts.publicationApprovalEventId !== null ||
              facts.sourceApprovalEventId === null))
        ) {
          throw new PublicationInvariantError(
            "PUBLICATION_ATTEMPT_AUTHORIZATION_INVALID",
          );
        }
        await publications.requireExactAttemptPreview(
          scope,
          facts,
          command.sourceChangeReceiptId ?? null,
        );
        if (facts.attemptKind === "rollback") {
          if (!command.sourceChangeReceiptId) {
            throw new PublicationInvariantError(
              "ROLLBACK_SOURCE_CHANGE_NOT_VERIFIED",
            );
          }
          const source = await publications.requireRollbackSource(scope, {
            sourcePublicationAttemptId:
              facts.sourcePublicationAttemptId!,
            sourceChangeReceiptId: command.sourceChangeReceiptId,
            destinationRef: command.destinationRef,
            providerKind: facts.destination.provider_kind,
            targetRef: command.targetRef,
          });
          const historicalApproval =
            source.attempt.publication_approval_event_id ??
            source.attempt.source_approval_event_id;
          if (
            historicalApproval === null ||
            historicalApproval !== facts.sourceApprovalEventId
          ) {
            throw new PublicationInvariantError(
              "ROLLBACK_SOURCE_APPROVAL_LINEAGE_INVALID",
            );
          }
        }

        const attemptId = this.newId();
        const runId = this.newId();
        const runs = new AsyncRunsRepository(tx);
        const run = await runs.insertQueued({
          runId,
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          kind: "publication",
          activeKey: publicationActiveKey(
            command.destinationRef,
            command.targetRef,
          ),
          initiatedBy: command.requestedBy,
          contractVersion: command.contractVersion,
          requestPayload: {
            publicationAttemptId: attemptId,
            destinationRef: command.destinationRef,
          },
          resultType: "publication_attempt",
          resultId: attemptId,
        });
        const attempt = await publications.insertAttempt({
          id: attemptId,
          runId,
          attemptKind: facts.attemptKind,
          sourcePublicationAttemptId:
            facts.sourcePublicationAttemptId,
          sourceChangeReceiptId: command.sourceChangeReceiptId ?? null,
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          siteId: facts.siteId,
          destination: facts.destination,
          actionId: facts.actionId,
          artifactId: facts.artifactId,
          artifactRevisionId: facts.artifactRevisionId,
          approvedArtifactRevision:
            facts.approvedArtifactRevision,
          approvedArtifactContentHash:
            facts.approvedArtifactContentHash,
          contentChecksum: facts.contentChecksum,
          publicationApprovalEventId:
            facts.publicationApprovalEventId,
          sourceApprovalEventId: facts.sourceApprovalEventId,
          authorizationGrant: facts.authorizationGrant,
          authorizationPurpose: facts.authorizationPurpose,
          previewEventId: facts.previewEventId,
          previewEventKind: facts.previewEventKind,
          previewFactsHash: facts.previewFactsHash,
          previewRef: facts.previewRef,
          previewChecksum: facts.previewChecksum,
          remotePrecondition: facts.remotePrecondition,
          rollbackPlan: facts.rollbackPlan,
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
          requestedBy: command.requestedBy,
        });
        await new DeliveryAuthorizationGrantsRepository(
          tx,
          this.clock,
        ).consume({
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          grantId: facts.authorizationGrant.id,
          siteId: facts.siteId,
          providerKind: facts.destination.provider_kind,
          purpose: facts.authorizationPurpose,
          destinationRef: command.destinationRef,
          destinationRevision: facts.destination.revision,
          targetRef: command.targetRef,
        });
        const responseBody = {
          publicationAttemptId: attempt.id,
          asyncRunId: run.id,
          state: "pending",
          replayed: false,
        };
        await idempotency.complete(reserved.id, {
          responseStatus: 202,
          responseBody,
          resourceType: "publication_attempt",
          resourceId: attempt.id,
        });
        await this.dependencies.enqueue(tx, {
          runId: run.id,
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          contractVersion: command.contractVersion,
        });
          return {
            attempt,
            run,
            receipts: [],
            replayed: false,
          };
        },
        { isolationLevel: "repeatable read" },
      );
    } catch (error) {
      if (pgConstraint(error) !== "async_runs_one_active_key_idx") {
        throw error;
      }
      const existing = await new AsyncRunsRepository(this.exec).findActive(
        scope,
        publicationActiveKey(
          command.destinationRef,
          command.targetRef,
        ),
      );
      throw new PublicationAlreadyActiveError(existing?.id ?? null);
    }
  }
}

function pgConstraint(error: unknown): string | null {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const wrapped = candidate as {
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.constraint === "string") {
      return wrapped.constraint;
    }
    candidate = wrapped.cause;
  }
  return null;
}
