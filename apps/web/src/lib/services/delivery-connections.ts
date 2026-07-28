import { randomUUID } from "node:crypto";
import {
  DeliveryAuthorizationGrant,
  DeliveryAuthorizationGrantProviderScope,
  GitHubDeliveryAuthorizationGrantProviderScope,
  GitHubPublicationDestinationScope,
  PublicationDestination,
  PublicationDestinationScope,
  RevokeDeliveryAuthorizationGrantResponse,
  WordPressDeliveryAuthorizationGrantProviderScope,
  WordPressPublicationDestinationScope,
  type AppendPublicationDestinationRevisionRequest,
  type ConnectGitHubDeliveryAuthorizationGrantRequest,
  type ConnectWordPressDeliveryAuthorizationGrantRequest,
  type DeliveryAuthorizationGrant as DeliveryAuthorizationGrantDto,
  type GitHubAuthorizationProbeIntent,
  type GitHubInstallationCallbackRequest,
  type GitHubPublicationDestinationScope as GitHubDestinationScopeDto,
  type PublicationDestination as PublicationDestinationDto,
  type PublicationDestinationSelection,
  type RevokeDeliveryAuthorizationGrantRequest,
  type RevokeDeliveryAuthorizationGrantResponse as RevokeGrantDto,
  type RevokePublicationDestinationRequest,
  type WordPressAuthorizationProbeIntent,
  type WordPressOneTimeCredentialInput,
  type WordPressPublicationDestinationScope as WordPressDestinationScopeDto,
} from "@sf/contracts";
import {
  contentHash,
  DeliveryAuthorizationGrantConflictError,
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionConflictError,
  DeliveryConnectionsRepository,
  IdempotencyRepository,
  ProjectsRepository,
  PublicationInvariantError,
  SitesRepository,
  type Db,
  type DbTx,
  type DeliveryAuthorizationGrantRow,
  type IdempotencyRow,
  type ProjectRow,
  type ProjectScope,
  type PublicationDestinationRow,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { z } from "zod";
import { getDb } from "@/lib/db";

const DESTINATION_HEAD_LIMIT = 100;
const DESTINATION_REVISION_LIMIT = 1_000;
const DEFAULT_GRANT_TTL_MS = 10 * 60 * 1_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/u;

const IDEMPOTENCY_SCOPES = {
  githubGrant: "deliveryConnection.githubGrant",
  wordpressGrant: "deliveryConnection.wordpressGrant",
  append: "deliveryConnection.appendRevision",
  revoke: "deliveryConnection.revoke",
  revokeGrant: "deliveryConnection.revokeGrant",
} as const;

const ReadinessObservation = z
  .object({
    observedAt: z.string().datetime({ offset: true }),
    probe: z.enum([
      "github_installation_permissions",
      "wordpress_capabilities",
      "revocation",
    ]),
    status: z.enum(["passed", "revoked"]),
    providerRequestId: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

type ReadinessObservation = z.infer<typeof ReadinessObservation>;

interface ProjectRepositoryPort {
  findById(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectRow | null>;
  findByIdForUpdate(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectRow | null>;
}

interface SitesRepositoryPort {
  findById(scope: ProjectScope, siteId: string): Promise<SiteRow | null>;
}

interface DeliveryConnectionsRepositoryPort {
  listHeads(
    scope: ProjectScope,
    limit: number,
  ): Promise<PublicationDestinationRow[]>;
  listRevisions(
    scope: ProjectScope,
    destinationRef: string,
    limit: number,
  ): Promise<PublicationDestinationRow[]>;
  findLatest(
    scope: ProjectScope,
    destinationRef: string,
    lock?: boolean,
  ): Promise<PublicationDestinationRow | null>;
  appendRevision(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    destinationRef: string;
    baseRevision: number;
    targetRef: string;
    providerKind: "github" | "wordpress";
    authorizationGrantId: string;
    providerScope: Record<string, unknown>;
    readinessObservation: Record<string, unknown>;
    state: "ready";
    limitation: null;
    createdBy: string;
    authorizationCheckedAt: Date;
  }): Promise<PublicationDestinationRow>;
  revoke(values: {
    workspaceId: string;
    projectId: string;
    destinationRef: string;
    baseRevision: number;
    actorId: string;
    reason: string;
  }): Promise<PublicationDestinationRow>;
}

interface DeliveryAuthorizationGrantsRepositoryPort {
  create(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    providerKind: "github" | "wordpress";
    purpose: "connector_configuration";
    destinationRef: string;
    destinationRevision: number;
    targetRef: string;
    requestedScope: Record<string, unknown>;
    authorizationSnapshot: Record<string, unknown>;
    encryptedPayload: Buffer | null;
    cipherVersion: number | null;
    keyVersion: string | null;
    secretMetadata: Record<string, unknown>;
    expiresAt: string;
    createdBy: string;
  }): Promise<DeliveryAuthorizationGrantRow>;
  readCurrent(
    scope: ProjectScope,
    grantId: string,
    now: Date,
  ): Promise<DeliveryAuthorizationGrantRow | null>;
  revoke(values: {
    workspaceId: string;
    projectId: string;
    grantId: string;
    actorId: string;
    reason: string;
  }): Promise<DeliveryAuthorizationGrantRow>;
}

interface IdempotencyRepositoryPort {
  find(
    workspaceId: string,
    scope: string,
    key: string,
  ): Promise<IdempotencyRow | null>;
  begin(values: {
    workspaceId: string;
    scope: string;
    key: string;
    requestHash: string;
    expiresAt: string;
  }): Promise<IdempotencyRow | null>;
  complete(
    id: string,
    values: {
      responseStatus: number;
      responseBody: unknown;
      resourceType: string;
      resourceId: string;
    },
  ): Promise<void>;
}

export interface DeliveryConnectionRepositories {
  readonly projects: ProjectRepositoryPort;
  readonly sites: SitesRepositoryPort;
  readonly connections: DeliveryConnectionsRepositoryPort;
  readonly grants: DeliveryAuthorizationGrantsRepositoryPort;
  readonly idempotency: IdempotencyRepositoryPort;
}

export interface DeliveryConnectionPersistence {
  read<T>(
    operation: (repositories: DeliveryConnectionRepositories) => Promise<T>,
  ): Promise<T>;
  transaction<T>(
    operation: (repositories: DeliveryConnectionRepositories) => Promise<T>,
  ): Promise<T>;
}

export interface GitHubConnectorAuthorizationResolution {
  readonly requestFingerprint: string;
  readonly grantProviderScope: z.infer<
    typeof GitHubDeliveryAuthorizationGrantProviderScope
  >;
  readonly destinationScope: GitHubDestinationScopeDto;
  readonly readinessObservation: ReadinessObservation;
}

export interface GitHubConnectorAuthorizationIssuer {
  /**
   * Returns a keyed, non-reversible SHA-256 fingerprint. Implementations must
   * not use a raw digest for callback state or other low-entropy credentials.
   */
  fingerprint(input: {
    readonly projectId: string;
    readonly siteId: string;
    readonly callback: GitHubInstallationCallbackRequest;
    readonly probeIntent: GitHubAuthorizationProbeIntent;
  }): Promise<string>;
  authorize(input: {
    readonly projectId: string;
    readonly siteId: string;
    readonly callback: GitHubInstallationCallbackRequest;
    readonly probeIntent: GitHubAuthorizationProbeIntent;
  }): Promise<GitHubConnectorAuthorizationResolution>;
}

export interface WordPressConnectorAuthorizationResolution {
  readonly requestFingerprint: string;
  readonly grantProviderScope: z.infer<
    typeof WordPressDeliveryAuthorizationGrantProviderScope
  >;
  readonly destinationScope: WordPressDestinationScopeDto;
  readonly readinessObservation: ReadinessObservation;
  readonly encryptedPayload: Buffer;
  readonly cipherVersion: number;
  readonly keyVersion: string;
  readonly encryptionAlgorithm: "AES-256-GCM";
}

export interface WordPressConnectorAuthorizationIssuer {
  /**
   * Returns a keyed, non-reversible SHA-256 fingerprint. Implementations must
   * not use a raw digest for usernames or application passwords.
   */
  fingerprint(input: {
    readonly projectId: string;
    readonly siteId: string;
    readonly requestedScope: WordPressAuthorizationProbeIntent;
    readonly credentialInput: WordPressOneTimeCredentialInput;
  }): Promise<string>;
  authorizeAndEncrypt(input: {
    readonly projectId: string;
    readonly siteId: string;
    readonly requestedScope: WordPressAuthorizationProbeIntent;
    readonly credentialInput: WordPressOneTimeCredentialInput;
  }): Promise<WordPressConnectorAuthorizationResolution>;
}

export interface DeliveryConnectionServiceRuntime {
  readonly persistence?: DeliveryConnectionPersistence;
  readonly githubIssuer?: GitHubConnectorAuthorizationIssuer;
  readonly wordpressIssuer?: WordPressConnectorAuthorizationIssuer;
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
  readonly grantTtlMs?: number;
}

export interface DeliveryConnectorReadiness {
  readonly github: {
    readonly providerKind: "github";
    readonly state: "available" | "unavailable";
    readonly limitation: string | null;
  };
  readonly wordpress: {
    readonly providerKind: "wordpress";
    readonly state: "available" | "unavailable";
    readonly limitation: string | null;
  };
}

export interface DeliveryConnectionDetail {
  readonly current: PublicationDestinationDto;
  readonly revisions: readonly PublicationDestinationDto[];
  readonly readiness: {
    readonly destinationRef: string;
    readonly revision: number;
    readonly providerKind: "github" | "wordpress";
    readonly state: "pending" | "ready" | "unavailable" | "revoked";
    readonly ready: boolean;
    readonly observedAt: string;
    readonly limitation: string | null;
  };
}

export interface DeliveryGrantCommandResult {
  readonly status: 201;
  readonly replayed: boolean;
  readonly grant: DeliveryAuthorizationGrantDto;
}

export interface DeliveryConnectionCommandResult {
  readonly status: 201;
  readonly replayed: boolean;
  readonly destination: PublicationDestinationDto;
}

export interface RevokeDeliveryGrantCommandResult {
  readonly status: 200;
  readonly replayed: boolean;
  readonly grant: RevokeGrantDto;
}

interface Runtime {
  readonly persistence: DeliveryConnectionPersistence;
  readonly githubIssuer?: GitHubConnectorAuthorizationIssuer;
  readonly wordpressIssuer?: WordPressConnectorAuthorizationIssuer;
  readonly now: () => Date;
  readonly randomUuid: () => string;
  readonly grantTtlMs: number;
}

function repositoriesFor(
  executor: Db | DbTx,
): DeliveryConnectionRepositories {
  const rawConnections = new DeliveryConnectionsRepository(executor);
  return {
    projects: new ProjectsRepository(executor),
    sites: new SitesRepository(executor),
    connections: {
      async listHeads(scope, limit) {
        const result = await rawConnections.listHeads(scope, {
          limit,
          cursor: null,
        });
        return result.rows;
      },
      async listRevisions(scope, destinationRef, limit) {
        return rawConnections.listRevisions(scope, destinationRef, {
          limit,
        });
      },
      findLatest: rawConnections.findLatest.bind(rawConnections),
      appendRevision: rawConnections.appendRevision.bind(rawConnections),
      revoke: rawConnections.revoke.bind(rawConnections),
    },
    grants: new DeliveryAuthorizationGrantsRepository(executor),
    idempotency: new IdempotencyRepository(executor),
  };
}

function defaultPersistence(): DeliveryConnectionPersistence {
  const { db } = getDb();
  return {
    read: (operation) => operation(repositoriesFor(db)),
    transaction: (operation) =>
      db.transaction((tx) => operation(repositoriesFor(tx))),
  };
}

function resolveRuntime(
  runtime: DeliveryConnectionServiceRuntime = {},
): Runtime {
  const grantTtlMs = runtime.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
  if (
    !Number.isSafeInteger(grantTtlMs) ||
    grantTtlMs < 60_000 ||
    grantTtlMs > 30 * 60_000
  ) {
    throw new RangeError(
      "Delivery authorization grant TTL must be between 1 and 30 minutes.",
    );
  }
  return {
    persistence: runtime.persistence ?? defaultPersistence(),
    ...(runtime.githubIssuer
      ? { githubIssuer: runtime.githubIssuer }
      : {}),
    ...(runtime.wordpressIssuer
      ? { wordpressIssuer: runtime.wordpressIssuer }
      : {}),
    now: runtime.now ?? (() => new Date()),
    randomUuid: runtime.randomUuid ?? randomUUID,
    grantTtlMs,
  };
}

function dependencyUnavailable(detail: string): ProblemError {
  return new ProblemError("DEPENDENCY_UNAVAILABLE", detail);
}

function staleRevision(detail: string): ProblemError {
  return new ProblemError("STALE_REVISION", detail);
}

function validateInstant(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw dependencyUnavailable(
      "Delivery connection server time is unavailable.",
    );
  }
  return now.toISOString();
}

function nextInstant(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function assertActiveProject(project: ProjectRow | null): asserts project {
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError(
      "PROJECT_ARCHIVED",
      "Project is archived and read-only.",
    );
  }
}

async function assertProjectAndSite(
  repositories: DeliveryConnectionRepositories,
  scope: WorkspaceScope,
  projectId: string,
  siteId: string,
  lock: boolean,
): Promise<ProjectScope> {
  const project = lock
    ? await repositories.projects.findByIdForUpdate(scope, projectId)
    : await repositories.projects.findById(scope, projectId);
  assertActiveProject(project);
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const site = await repositories.sites.findById(projectScope, siteId);
  if (!site) {
    throw new ProblemError("NOT_FOUND", "Project site not found.");
  }
  return projectScope;
}

function normalizeSafeReadiness(
  row: PublicationDestinationRow,
): ReadinessObservation {
  const raw = row.readiness_observation;
  const parsed = ReadinessObservation.safeParse({
    observedAt: raw["observedAt"],
    probe: raw["probe"],
    status: raw["status"],
    providerRequestId: raw["providerRequestId"] ?? null,
  });
  if (parsed.success) return parsed.data;
  if (row.state === "revoked") {
    const revokedAt = row.readiness_observation["revokedAt"];
    const observedAt =
      typeof revokedAt === "string" &&
      Number.isFinite(Date.parse(revokedAt))
        ? new Date(revokedAt).toISOString()
        : row.created_at;
    return {
      observedAt,
      probe: "revocation",
      status: "revoked",
      providerRequestId: null,
    };
  }
  throw dependencyUnavailable(
    "Delivery connection readiness evidence is unavailable.",
  );
}

function toDestinationDto(
  row: PublicationDestinationRow,
): PublicationDestinationDto {
  const parsed = PublicationDestination.safeParse({
    id: row.id,
    destinationRef: row.destination_ref,
    revision: row.revision,
    siteId: row.site_id,
    providerKind: row.provider_kind,
    targetRef: row.target_ref,
    state: row.state,
    providerScope: row.provider_scope,
    authorizationSnapshot: row.authorization_snapshot,
    readinessObservation: normalizeSafeReadiness(row),
    limitation: row.limitation,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    throw dependencyUnavailable(
      "Delivery connection persistence failed integrity validation.",
    );
  }
  return parsed.data;
}

function assertDestinationRowsInScope(
  rows: readonly PublicationDestinationRow[],
  scope: ProjectScope,
  destinationRef?: string,
): void {
  if (
    rows.some(
      (row) =>
        row.workspace_id !== scope.workspaceId ||
        row.project_id !== scope.projectId ||
        (destinationRef !== undefined &&
          row.destination_ref !== destinationRef),
    )
  ) {
    throw dependencyUnavailable(
      "Delivery connection persistence returned an invalid project scope.",
    );
  }
}

function grantProviderScopeFromRow(
  row: DeliveryAuthorizationGrantRow,
): z.infer<typeof DeliveryAuthorizationGrantProviderScope> {
  const parsed = DeliveryAuthorizationGrantProviderScope.safeParse(
    row.secret_metadata["grantProviderScope"],
  );
  if (!parsed.success || parsed.data.providerKind !== row.provider_kind) {
    throw dependencyUnavailable(
      "Delivery authorization scope failed integrity validation.",
    );
  }
  return parsed.data;
}

function toGrantDto(
  row: DeliveryAuthorizationGrantRow,
): DeliveryAuthorizationGrantDto {
  const parsed = DeliveryAuthorizationGrant.safeParse({
    authorizationGrantRef: row.id,
    siteId: row.site_id,
    providerKind: row.provider_kind,
    purpose: row.purpose,
    state: row.state,
    providerScope: grantProviderScopeFromRow(row),
    destinationRef: row.destination_ref,
    destinationRevision: row.destination_revision,
    targetRef: row.target_ref,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    throw dependencyUnavailable(
      "Delivery authorization persistence failed integrity validation.",
    );
  }
  return parsed.data;
}

function toRevokedGrantDto(
  row: DeliveryAuthorizationGrantRow,
): RevokeGrantDto {
  const parsed = RevokeDeliveryAuthorizationGrantResponse.safeParse({
    authorizationGrantRef: row.id,
    providerKind: row.provider_kind,
    purpose: row.purpose,
    state: row.state,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
  });
  if (!parsed.success) {
    throw dependencyUnavailable(
      "Delivery authorization revocation failed integrity validation.",
    );
  }
  return parsed.data;
}

function ensureNextDestinationRevision(
  latest: PublicationDestinationRow | null,
  expected: {
    siteId: string;
    providerKind: "github" | "wordpress";
    targetRef: string;
    destinationRevision: number;
  },
): void {
  const nextRevision = (latest?.revision ?? 0) + 1;
  if (expected.destinationRevision !== nextRevision) {
    throw staleRevision(
      "Delivery destination changed; refetch before authorizing it.",
    );
  }
  if (
    latest &&
    (latest.site_id !== expected.siteId ||
      latest.provider_kind !== expected.providerKind ||
      latest.target_ref !== expected.targetRef)
  ) {
    throw staleRevision(
      "Delivery destination identity cannot change across revisions.",
    );
  }
}

async function assertDestinationGrantScope(
  repositories: DeliveryConnectionRepositories,
  projectScope: ProjectScope,
  destinationRef: string,
  expected: {
    siteId: string;
    providerKind: "github" | "wordpress";
    targetRef: string;
    destinationRevision: number;
  },
): Promise<void> {
  const latest = await repositories.connections.findLatest(
    projectScope,
    destinationRef,
  );
  ensureNextDestinationRevision(latest, expected);
}

function githubSelectionFromScope(
  scope: GitHubDestinationScopeDto,
): PublicationDestinationSelection {
  return {
    providerKind: "github",
    repositoryId: scope.repositoryId,
    baseBranch: scope.baseBranch,
    branchPrefix: scope.branchPrefix,
    contentPath: scope.contentPath,
  };
}

function wordpressSelectionFromScope(
  scope: WordPressDestinationScopeDto,
): PublicationDestinationSelection {
  return {
    providerKind: "wordpress",
    postType: scope.postType,
    authorAllowlist: [...scope.authorAllowlist],
    statusAllowlist: [...scope.statusAllowlist],
  };
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return contentHash(left as never) === contentHash(right as never);
  } catch {
    return false;
  }
}

function assertGitHubResolution(
  request: ConnectGitHubDeliveryAuthorizationGrantRequest,
  raw: GitHubConnectorAuthorizationResolution,
  observedAt: string,
): GitHubConnectorAuthorizationResolution {
  if (!SHA256.test(raw.requestFingerprint)) {
    throw dependencyUnavailable(
      "GitHub authorization issuer returned an invalid fingerprint.",
    );
  }
  const destinationScope =
    GitHubPublicationDestinationScope.safeParse(raw.destinationScope);
  const grantScope =
    GitHubDeliveryAuthorizationGrantProviderScope.safeParse(
      raw.grantProviderScope,
    );
  const readiness = ReadinessObservation.safeParse({
    ...raw.readinessObservation,
    observedAt,
  });
  if (
    !SHA256.test(raw.requestFingerprint) ||
    !destinationScope.success ||
    !grantScope.success ||
    !readiness.success ||
    readiness.data.probe !== "github_installation_permissions" ||
    readiness.data.status !== "passed"
  ) {
    throw dependencyUnavailable(
      "GitHub authorization issuer returned invalid readiness facts.",
    );
  }
  const {
    githubAccountId: _githubAccountId,
    ...grantDestinationScope
  } = grantScope.data;
  if (
    destinationScope.data.installationId !==
      request.callback.installationId ||
    grantScope.data.installationId !==
      destinationScope.data.installationId ||
    !sameCanonicalValue(
      githubSelectionFromScope(destinationScope.data),
      request.probeIntent.requestedScope,
    ) ||
    !sameCanonicalValue(grantDestinationScope, destinationScope.data)
  ) {
    throw dependencyUnavailable(
      "GitHub authorization scope did not match the requested destination.",
    );
  }
  return {
    requestFingerprint: raw.requestFingerprint,
    grantProviderScope: grantScope.data,
    destinationScope: destinationScope.data,
    readinessObservation: readiness.data,
  };
}

function canonicalWordPressUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.href;
  } catch {
    return null;
  }
}

function assertWordPressResolution(
  request: ConnectWordPressDeliveryAuthorizationGrantRequest,
  raw: WordPressConnectorAuthorizationResolution,
  observedAt: string,
): WordPressConnectorAuthorizationResolution {
  const destinationScope =
    WordPressPublicationDestinationScope.safeParse(raw.destinationScope);
  const grantScope =
    WordPressDeliveryAuthorizationGrantProviderScope.safeParse(
      raw.grantProviderScope,
    );
  const readiness = ReadinessObservation.safeParse({
    ...raw.readinessObservation,
    observedAt,
  });
  if (
    !SHA256.test(raw.requestFingerprint) ||
    !destinationScope.success ||
    !grantScope.success ||
    !readiness.success ||
    readiness.data.probe !== "wordpress_capabilities" ||
    readiness.data.status !== "passed" ||
    !Buffer.isBuffer(raw.encryptedPayload) ||
    raw.encryptedPayload.length < 32 ||
    !Number.isSafeInteger(raw.cipherVersion) ||
    raw.cipherVersion < 1 ||
    typeof raw.keyVersion !== "string" ||
    raw.keyVersion.trim().length === 0 ||
    raw.keyVersion.length > 200 ||
    raw.encryptionAlgorithm !== "AES-256-GCM" ||
    canonicalWordPressUrl(destinationScope.data.siteBaseUrl) !==
      canonicalWordPressUrl(request.requestedScope.siteBaseUrl) ||
    !sameCanonicalValue(
      wordpressSelectionFromScope(destinationScope.data),
      {
        providerKind: request.requestedScope.providerKind,
        postType: request.requestedScope.postType,
        authorAllowlist: request.requestedScope.authorAllowlist,
        statusAllowlist: request.requestedScope.statusAllowlist,
      },
    ) ||
    !sameCanonicalValue(grantScope.data, destinationScope.data)
  ) {
    throw dependencyUnavailable(
      "WordPress authorization scope did not match the requested destination.",
    );
  }
  if (
    !destinationScope.data.capabilities.includes("edit_posts") ||
    (destinationScope.data.statusAllowlist.includes("publish") &&
      !destinationScope.data.capabilities.includes("publish_posts"))
  ) {
    throw dependencyUnavailable(
      "WordPress credential does not have the requested capabilities.",
    );
  }
  return {
    requestFingerprint: raw.requestFingerprint,
    grantProviderScope: grantScope.data,
    destinationScope: destinationScope.data,
    readinessObservation: readiness.data,
    encryptedPayload: raw.encryptedPayload,
    cipherVersion: raw.cipherVersion,
    keyVersion: raw.keyVersion,
    encryptionAlgorithm: raw.encryptionAlgorithm,
  };
}

function idempotencyExpiry(now: Date): string {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
}

function replayConflict(): ProblemError {
  return new ProblemError(
    "IDEMPOTENCY_KEY_REUSED",
    "Idempotency key is already in use.",
  );
}

function completedReplay<T>(
  row: IdempotencyRow,
  requestHash: string,
  parse: (value: unknown) => T | null,
): T | null {
  if (row.request_hash !== requestHash) throw replayConflict();
  if (row.status !== "completed") throw replayConflict();
  return parse(row.response_body);
}

async function beginCommand<T>(
  repositories: DeliveryConnectionRepositories,
  input: {
    workspaceId: string;
    scope: string;
    key: string;
    requestHash: string;
    now: Date;
    parseReplay: (value: unknown) => T | null;
  },
): Promise<{ reservation: IdempotencyRow } | { replay: T }> {
  const reservation = await repositories.idempotency.begin({
    workspaceId: input.workspaceId,
    scope: input.scope,
    key: input.key,
    requestHash: input.requestHash,
    expiresAt: idempotencyExpiry(input.now),
  });
  if (reservation) return { reservation };
  const existing = await repositories.idempotency.find(
    input.workspaceId,
    input.scope,
    input.key,
  );
  if (!existing) throw replayConflict();
  const replay = completedReplay(
    existing,
    input.requestHash,
    input.parseReplay,
  );
  if (replay === null) {
    throw dependencyUnavailable(
      "Stored delivery connection replay failed integrity validation.",
    );
  }
  return { replay };
}

async function replayBeforeMutableState<T>(
  persistence: DeliveryConnectionPersistence,
  input: {
    workspaceId: string;
    scope: string;
    key: string;
    requestHash: string;
    parseReplay: (value: unknown) => T | null;
  },
): Promise<T | null> {
  return persistence.read(async (repositories) => {
    const existing = await repositories.idempotency.find(
      input.workspaceId,
      input.scope,
      input.key,
    );
    if (!existing) return null;
    const replay = completedReplay(
      existing,
      input.requestHash,
      input.parseReplay,
    );
    if (replay === null) {
      throw dependencyUnavailable(
        "Stored delivery connection replay failed integrity validation.",
      );
    }
    return replay;
  });
}

function parseGrantReplay(value: unknown): DeliveryGrantCommandResult | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { status?: unknown }).status !== 201
  ) {
    return null;
  }
  const parsed = DeliveryAuthorizationGrant.safeParse(
    (value as { grant?: unknown }).grant,
  );
  return parsed.success
    ? { status: 201, replayed: true, grant: parsed.data }
    : null;
}

function parseDestinationReplay(
  value: unknown,
): DeliveryConnectionCommandResult | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { status?: unknown }).status !== 201
  ) {
    return null;
  }
  const parsed = PublicationDestination.safeParse(
    (value as { destination?: unknown }).destination,
  );
  return parsed.success
    ? { status: 201, replayed: true, destination: parsed.data }
    : null;
}

function parseRevokeGrantReplay(
  value: unknown,
): RevokeDeliveryGrantCommandResult | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { status?: unknown }).status !== 200
  ) {
    return null;
  }
  const parsed = RevokeDeliveryAuthorizationGrantResponse.safeParse(
    (value as { grant?: unknown }).grant,
  );
  return parsed.success
    ? { status: 200, replayed: true, grant: parsed.data }
    : null;
}

async function completeCommand(
  repositories: DeliveryConnectionRepositories,
  reservation: IdempotencyRow,
  input: {
    status: number;
    responseBody: unknown;
    resourceType: string;
    resourceId: string;
  },
): Promise<void> {
  await repositories.idempotency.complete(reservation.id, {
    responseStatus: input.status,
    responseBody: input.responseBody,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
}

function mapPersistenceError(error: unknown): never {
  if (error instanceof ProblemError) throw error;
  if (
    error instanceof DeliveryConnectionConflictError ||
    error instanceof DeliveryAuthorizationGrantConflictError
  ) {
    throw staleRevision(
      "Delivery connection authorization or revision is no longer current.",
    );
  }
  if (error instanceof PublicationInvariantError) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Delivery connection authorization did not match the requested scope.",
    );
  }
  throw error;
}

/** Current customer-visible connection heads; historical revisions stay in detail. */
export async function listDeliveryConnections(
  scope: WorkspaceScope,
  projectId: string,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<PublicationDestinationDto[]> {
  const runtime = resolveRuntime(runtimeInput);
  return runtime.persistence.read(async (repositories) => {
    const project = await repositories.projects.findById(scope, projectId);
    assertActiveProject(project);
    const rows = await repositories.connections.listHeads(
      { workspaceId: scope.workspaceId, projectId },
      DESTINATION_HEAD_LIMIT,
    );
    assertDestinationRowsInScope(rows, {
      workspaceId: scope.workspaceId,
      projectId,
    });
    return rows.map(toDestinationDto);
  });
}

/** One exact project-scoped connection with a bounded append-only history. */
export async function getDeliveryConnection(
  scope: WorkspaceScope,
  projectId: string,
  destinationRef: string,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryConnectionDetail> {
  const runtime = resolveRuntime(runtimeInput);
  return runtime.persistence.read(async (repositories) => {
    const project = await repositories.projects.findById(scope, projectId);
    assertActiveProject(project);
    const rows = await repositories.connections.listRevisions(
      { workspaceId: scope.workspaceId, projectId },
      destinationRef,
      DESTINATION_REVISION_LIMIT,
    );
    if (rows.length === 0) {
      throw new ProblemError("NOT_FOUND", "Delivery connection not found.");
    }
    assertDestinationRowsInScope(
      rows,
      { workspaceId: scope.workspaceId, projectId },
      destinationRef,
    );
    const revisions = rows.map(toDestinationDto);
    const current = revisions[0]!;
    const readiness = normalizeSafeReadiness(rows[0]!);
    return {
      current,
      revisions,
      readiness: {
        destinationRef: current.destinationRef,
        revision: current.revision,
        providerKind: current.providerKind,
        state: current.state,
        ready: current.state === "ready",
        observedAt: readiness.observedAt,
        limitation: current.limitation,
      },
    };
  });
}

/** Server deployment capability only; it never claims a provider selection is ready. */
export function getDeliveryConnectorReadiness(
  runtime: DeliveryConnectionServiceRuntime = {},
): DeliveryConnectorReadiness {
  return {
    github: runtime.githubIssuer
      ? { providerKind: "github", state: "available", limitation: null }
      : {
          providerKind: "github",
          state: "unavailable",
          limitation:
            "GitHub App credential issuance is not configured on this server.",
        },
    wordpress: runtime.wordpressIssuer
      ? { providerKind: "wordpress", state: "available", limitation: null }
      : {
          providerKind: "wordpress",
          state: "unavailable",
          limitation:
            "WordPress credential encryption is not configured on this server.",
        },
  };
}

/** Project-scoped route projection for the server's configured connector seams. */
export async function getProjectDeliveryConnectorReadiness(
  scope: WorkspaceScope,
  projectId: string,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryConnectorReadiness> {
  const runtime = resolveRuntime(runtimeInput);
  await runtime.persistence.read(async (repositories) => {
    const project = await repositories.projects.findById(scope, projectId);
    assertActiveProject(project);
  });
  return getDeliveryConnectorReadiness(runtimeInput);
}

export async function authorizeGitHubDeliveryConnection(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: ConnectGitHubDeliveryAuthorizationGrantRequest,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryGrantCommandResult> {
  const runtime = resolveRuntime(runtimeInput);
  if (!runtime.githubIssuer) {
    throw dependencyUnavailable(
      "GitHub App credential issuance is not configured.",
    );
  }

  const issuerInput = {
    projectId,
    siteId: body.siteId,
    callback: body.callback,
    probeIntent: body.probeIntent,
  };
  let issuerFingerprint: string;
  try {
    issuerFingerprint =
      await runtime.githubIssuer.fingerprint(issuerInput);
  } catch {
    throw dependencyUnavailable(
      "GitHub authorization request could not be fingerprinted safely.",
    );
  }
  if (!SHA256.test(issuerFingerprint)) {
    throw dependencyUnavailable(
      "GitHub authorization issuer returned an invalid fingerprint.",
    );
  }
  const requestHash = contentHash({
    command: "github_delivery_connection_grant",
    projectId,
    actorId,
    siteId: body.siteId,
    destinationRef: body.destinationRef,
    destinationRevision: body.destinationRevision,
    targetRef: body.targetRef,
    callback: {
      providerKind: body.callback.providerKind,
      installationId: body.callback.installationId,
      setupAction: body.callback.setupAction,
    },
    probeIntent: body.probeIntent,
    acknowledgementScope:
      body.customerAcknowledgementInput.acknowledgementScope,
    issuerFingerprint,
  } as never);
  const replay = await replayBeforeMutableState(runtime.persistence, {
    workspaceId: scope.workspaceId,
    scope: IDEMPOTENCY_SCOPES.githubGrant,
    key: idempotencyKey,
    requestHash,
    parseReplay: parseGrantReplay,
  });
  if (replay) return replay;

  await runtime.persistence.read(async (repositories) => {
    const projectScope = await assertProjectAndSite(
      repositories,
      scope,
      projectId,
      body.siteId,
      false,
    );
    await assertDestinationGrantScope(
      repositories,
      projectScope,
      body.destinationRef,
      {
        siteId: body.siteId,
        providerKind: "github",
        targetRef: body.targetRef,
        destinationRevision: body.destinationRevision,
      },
    );
  });

  let rawResolution: GitHubConnectorAuthorizationResolution;
  try {
    rawResolution = await runtime.githubIssuer.authorize(issuerInput);
  } catch {
    throw dependencyUnavailable(
      "GitHub installation authorization could not be verified.",
    );
  }
  const clock = runtime.now();
  const grantedAt = validateInstant(clock);
  let resolution: GitHubConnectorAuthorizationResolution;
  try {
    resolution = assertGitHubResolution(
      body,
      rawResolution,
      grantedAt,
    );
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    throw dependencyUnavailable(
      "GitHub authorization issuer returned invalid readiness facts.",
    );
  }
  if (resolution.requestFingerprint !== issuerFingerprint) {
    throw dependencyUnavailable(
      "GitHub authorization fingerprint changed during verification.",
    );
  }
  const expiresAt = nextInstant(clock, runtime.grantTtlMs);

  try {
    return await runtime.persistence.transaction(async (repositories) => {
      const command = await beginCommand(repositories, {
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPES.githubGrant,
        key: idempotencyKey,
        requestHash,
        now: clock,
        parseReplay: parseGrantReplay,
      });
      if ("replay" in command) return command.replay;
      const projectScope = await assertProjectAndSite(
        repositories,
        scope,
        projectId,
        body.siteId,
        true,
      );
      await assertDestinationGrantScope(
        repositories,
        projectScope,
        body.destinationRef,
        {
          siteId: body.siteId,
          providerKind: "github",
          targetRef: body.targetRef,
          destinationRevision: body.destinationRevision,
        },
      );
      const acknowledgementId = runtime.randomUuid();
      const authorizationId = runtime.randomUuid();
      const authorizationSnapshot = {
        authorizationId,
        actorId,
        grantedAt,
        expiresAt,
        scopes: [...resolution.destinationScope.grantedPermissions],
        destinationRef: body.destinationRef,
        destinationRevision: body.destinationRevision,
        purpose: "connector_configuration" as const,
        customerAcknowledgement: {
          customerAcknowledgementId: acknowledgementId,
          actorId,
          acknowledgedAt: grantedAt,
          acknowledgementScope: "connector_configuration" as const,
        },
      };
      const row = await repositories.grants.create({
        ...projectScope,
        siteId: body.siteId,
        providerKind: "github",
        purpose: "connector_configuration",
        destinationRef: body.destinationRef,
        destinationRevision: body.destinationRevision,
        targetRef: body.targetRef,
        requestedScope: resolution.destinationScope,
        authorizationSnapshot,
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        secretMetadata: {
          grantProviderScope: resolution.grantProviderScope,
          destinationScope: resolution.destinationScope,
          readinessObservation: resolution.readinessObservation,
        },
        expiresAt,
        createdBy: actorId,
      });
      const result: DeliveryGrantCommandResult = {
        status: 201,
        replayed: false,
        grant: toGrantDto(row),
      };
      await completeCommand(repositories, command.reservation, {
        status: 201,
        responseBody: result,
        resourceType: "delivery_authorization_grant",
        resourceId: row.id,
      });
      return result;
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}

export async function authorizeWordPressDeliveryConnection(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: ConnectWordPressDeliveryAuthorizationGrantRequest,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryGrantCommandResult> {
  const runtime = resolveRuntime(runtimeInput);
  if (!runtime.wordpressIssuer) {
    throw dependencyUnavailable(
      "WordPress credential encryption is not configured.",
    );
  }

  const issuerInput = {
    projectId,
    siteId: body.siteId,
    requestedScope: body.requestedScope,
    credentialInput: body.credentialInput,
  };
  let issuerFingerprint: string;
  try {
    issuerFingerprint =
      await runtime.wordpressIssuer.fingerprint(issuerInput);
  } catch {
    throw dependencyUnavailable(
      "WordPress authorization request could not be fingerprinted safely.",
    );
  }
  if (!SHA256.test(issuerFingerprint)) {
    throw dependencyUnavailable(
      "WordPress authorization issuer returned an invalid fingerprint.",
    );
  }
  const requestHash = contentHash({
    command: "wordpress_delivery_connection_grant",
    projectId,
    actorId,
    siteId: body.siteId,
    destinationRef: body.destinationRef,
    destinationRevision: body.destinationRevision,
    targetRef: body.targetRef,
    requestedScope: body.requestedScope,
    acknowledgementScope:
      body.customerAcknowledgementInput.acknowledgementScope,
    issuerFingerprint,
  } as never);
  const replay = await replayBeforeMutableState(runtime.persistence, {
    workspaceId: scope.workspaceId,
    scope: IDEMPOTENCY_SCOPES.wordpressGrant,
    key: idempotencyKey,
    requestHash,
    parseReplay: parseGrantReplay,
  });
  if (replay) return replay;

  await runtime.persistence.read(async (repositories) => {
    const projectScope = await assertProjectAndSite(
      repositories,
      scope,
      projectId,
      body.siteId,
      false,
    );
    await assertDestinationGrantScope(
      repositories,
      projectScope,
      body.destinationRef,
      {
        siteId: body.siteId,
        providerKind: "wordpress",
        targetRef: body.targetRef,
        destinationRevision: body.destinationRevision,
      },
    );
  });

  let rawResolution: WordPressConnectorAuthorizationResolution;
  try {
    rawResolution =
      await runtime.wordpressIssuer.authorizeAndEncrypt(issuerInput);
  } catch {
    throw dependencyUnavailable(
      "WordPress credential could not be encrypted and verified.",
    );
  }
  const clock = runtime.now();
  const grantedAt = validateInstant(clock);
  let resolution: WordPressConnectorAuthorizationResolution;
  try {
    resolution = assertWordPressResolution(
      body,
      rawResolution,
      grantedAt,
    );
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    throw dependencyUnavailable(
      "WordPress authorization issuer returned invalid readiness facts.",
    );
  }
  if (resolution.requestFingerprint !== issuerFingerprint) {
    throw dependencyUnavailable(
      "WordPress authorization fingerprint changed during verification.",
    );
  }
  const expiresAt = nextInstant(clock, runtime.grantTtlMs);

  try {
    return await runtime.persistence.transaction(async (repositories) => {
      const command = await beginCommand(repositories, {
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPES.wordpressGrant,
        key: idempotencyKey,
        requestHash,
        now: clock,
        parseReplay: parseGrantReplay,
      });
      if ("replay" in command) return command.replay;
      const projectScope = await assertProjectAndSite(
        repositories,
        scope,
        projectId,
        body.siteId,
        true,
      );
      await assertDestinationGrantScope(
        repositories,
        projectScope,
        body.destinationRef,
        {
          siteId: body.siteId,
          providerKind: "wordpress",
          targetRef: body.targetRef,
          destinationRevision: body.destinationRevision,
        },
      );
      const acknowledgementId = runtime.randomUuid();
      const authorizationId = runtime.randomUuid();
      const authorizationSnapshot = {
        authorizationId,
        actorId,
        grantedAt,
        expiresAt,
        scopes: [...resolution.destinationScope.capabilities],
        destinationRef: body.destinationRef,
        destinationRevision: body.destinationRevision,
        purpose: "connector_configuration" as const,
        customerAcknowledgement: {
          customerAcknowledgementId: acknowledgementId,
          actorId,
          acknowledgedAt: grantedAt,
          acknowledgementScope: "connector_configuration" as const,
        },
      };
      const row = await repositories.grants.create({
        ...projectScope,
        siteId: body.siteId,
        providerKind: "wordpress",
        purpose: "connector_configuration",
        destinationRef: body.destinationRef,
        destinationRevision: body.destinationRevision,
        targetRef: body.targetRef,
        requestedScope: resolution.destinationScope,
        authorizationSnapshot,
        encryptedPayload: resolution.encryptedPayload,
        cipherVersion: resolution.cipherVersion,
        keyVersion: resolution.keyVersion,
        secretMetadata: {
          grantProviderScope: resolution.grantProviderScope,
          destinationScope: resolution.destinationScope,
          readinessObservation: resolution.readinessObservation,
          encryptionAlgorithm: resolution.encryptionAlgorithm,
        },
        expiresAt,
        createdBy: actorId,
      });
      const result: DeliveryGrantCommandResult = {
        status: 201,
        replayed: false,
        grant: toGrantDto(row),
      };
      await completeCommand(repositories, command.reservation, {
        status: 201,
        responseBody: result,
        resourceType: "delivery_authorization_grant",
        resourceId: row.id,
      });
      return result;
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}

function destinationScopeFromGrant(
  grant: DeliveryAuthorizationGrantRow,
): z.infer<typeof PublicationDestinationScope> {
  const parsed = PublicationDestinationScope.safeParse(
    grant.secret_metadata["destinationScope"],
  );
  if (!parsed.success || parsed.data.providerKind !== grant.provider_kind) {
    throw staleRevision(
      "Delivery authorization no longer has a valid destination scope.",
    );
  }
  return parsed.data;
}

function readinessFromGrant(
  grant: DeliveryAuthorizationGrantRow,
): ReadinessObservation {
  const parsed = ReadinessObservation.safeParse(
    grant.secret_metadata["readinessObservation"],
  );
  if (!parsed.success || parsed.data.status !== "passed") {
    throw staleRevision(
      "Delivery authorization readiness is no longer valid.",
    );
  }
  return parsed.data;
}

function exactGrantBindingForAppend(
  grant: DeliveryAuthorizationGrantRow,
  body: AppendPublicationDestinationRevisionRequest,
): void {
  if (
    grant.site_id !== body.siteId ||
    grant.provider_kind !== body.providerKind ||
    grant.purpose !== "connector_configuration" ||
    grant.destination_ref !== body.destinationRef ||
    grant.destination_revision !== body.baseRevision + 1 ||
    grant.target_ref !== body.targetRef
  ) {
    throw staleRevision(
      "Delivery authorization does not match this destination revision.",
    );
  }
}

export async function appendDeliveryConnectionRevision(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: AppendPublicationDestinationRevisionRequest,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryConnectionCommandResult> {
  const runtime = resolveRuntime(runtimeInput);
  const clock = runtime.now();
  validateInstant(clock);
  const requestHash = contentHash({
    command: "append_delivery_connection_revision",
    projectId,
    actorId,
    body,
  } as never);
  try {
    return await runtime.persistence.transaction(async (repositories) => {
      const command = await beginCommand(repositories, {
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPES.append,
        key: idempotencyKey,
        requestHash,
        now: clock,
        parseReplay: parseDestinationReplay,
      });
      if ("replay" in command) return command.replay;
      const projectScope = await assertProjectAndSite(
        repositories,
        scope,
        projectId,
        body.siteId,
        true,
      );
      const grant = await repositories.grants.readCurrent(
        projectScope,
        body.authorizationGrantRef,
        clock,
      );
      if (!grant) {
        throw staleRevision(
          "Delivery authorization is missing, expired, consumed, or revoked.",
        );
      }
      exactGrantBindingForAppend(grant, body);
      const providerScope = destinationScopeFromGrant(grant);
      const requestedSelection =
        providerScope.providerKind === "github"
          ? githubSelectionFromScope(providerScope)
          : wordpressSelectionFromScope(providerScope);
      if (!sameCanonicalValue(requestedSelection, body.requestedScope)) {
        throw staleRevision(
          "Requested delivery scope changed after authorization.",
        );
      }
      const readinessObservation = readinessFromGrant(grant);
      const row = await repositories.connections.appendRevision({
        ...projectScope,
        siteId: body.siteId,
        destinationRef: body.destinationRef,
        baseRevision: body.baseRevision,
        targetRef: body.targetRef,
        providerKind: body.providerKind,
        authorizationGrantId: body.authorizationGrantRef,
        providerScope,
        readinessObservation,
        state: "ready",
        limitation: null,
        createdBy: actorId,
        authorizationCheckedAt: clock,
      });
      const result: DeliveryConnectionCommandResult = {
        status: 201,
        replayed: false,
        destination: toDestinationDto(row),
      };
      await completeCommand(repositories, command.reservation, {
        status: 201,
        responseBody: result,
        resourceType: "delivery_connection",
        resourceId: row.id,
      });
      return result;
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}

export async function revokeDeliveryConnection(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  destinationRef: string,
  idempotencyKey: string,
  body: RevokePublicationDestinationRequest,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<DeliveryConnectionCommandResult> {
  const runtime = resolveRuntime(runtimeInput);
  const clock = runtime.now();
  validateInstant(clock);
  const requestHash = contentHash({
    command: "revoke_delivery_connection",
    projectId,
    actorId,
    destinationRef,
    body,
  } as never);
  try {
    return await runtime.persistence.transaction(async (repositories) => {
      const command = await beginCommand(repositories, {
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPES.revoke,
        key: idempotencyKey,
        requestHash,
        now: clock,
        parseReplay: parseDestinationReplay,
      });
      if ("replay" in command) return command.replay;
      const project = await repositories.projects.findByIdForUpdate(
        scope,
        projectId,
      );
      assertActiveProject(project);
      const projectScope = { workspaceId: scope.workspaceId, projectId };
      const row = await repositories.connections.revoke({
        ...projectScope,
        destinationRef,
        baseRevision: body.baseRevision,
        actorId,
        reason: body.reason,
      });
      const result: DeliveryConnectionCommandResult = {
        status: 201,
        replayed: false,
        destination: toDestinationDto(row),
      };
      await completeCommand(repositories, command.reservation, {
        status: 201,
        responseBody: result,
        resourceType: "delivery_connection",
        resourceId: row.id,
      });
      return result;
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}

export async function revokeDeliveryAuthorizationGrant(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: RevokeDeliveryAuthorizationGrantRequest,
  runtimeInput: DeliveryConnectionServiceRuntime = {},
): Promise<RevokeDeliveryGrantCommandResult> {
  const runtime = resolveRuntime(runtimeInput);
  const clock = runtime.now();
  validateInstant(clock);
  const requestHash = contentHash({
    command: "revoke_delivery_authorization_grant",
    projectId,
    actorId,
    authorizationGrantRef: body.authorizationGrantRef,
    reason: body.reason,
  } as never);
  try {
    return await runtime.persistence.transaction(async (repositories) => {
      const command = await beginCommand(repositories, {
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPES.revokeGrant,
        key: idempotencyKey,
        requestHash,
        now: clock,
        parseReplay: parseRevokeGrantReplay,
      });
      if ("replay" in command) return command.replay;
      const project = await repositories.projects.findByIdForUpdate(
        scope,
        projectId,
      );
      assertActiveProject(project);
      const row = await repositories.grants.revoke({
        workspaceId: scope.workspaceId,
        projectId,
        grantId: body.authorizationGrantRef,
        actorId,
        reason: body.reason,
      });
      const result: RevokeDeliveryGrantCommandResult = {
        status: 200,
        replayed: false,
        grant: toRevokedGrantDto(row),
      };
      await completeCommand(repositories, command.reservation, {
        status: 200,
        responseBody: result,
        resourceType: "delivery_authorization_grant",
        resourceId: row.id,
      });
      return result;
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}
