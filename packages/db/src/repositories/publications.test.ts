import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { contentHash } from "../hash.ts";
import {
  DeliveryConnectionConflictError,
  DeliveryAuthorizationGrantConflictError,
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionsRepository,
  PublicationIdempotencyConflictError,
  PublicationInvariantError,
  PublicationsRepository,
  publicationActiveKey,
  publicationPreviewFactsHash,
  publicationRequestHash,
} from "./publications.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}
class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}
  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }
  from(...args: unknown[]): this { return this.chain("from", args); }
  innerJoin(...args: unknown[]): this { return this.chain("innerJoin", args); }
  where(...args: unknown[]): this { return this.chain("where", args); }
  limit(...args: unknown[]): this { return this.chain("limit", args); }
  orderBy(...args: unknown[]): this { return this.chain("orderBy", args); }
  for(...args: unknown[]): this { return this.chain("for", args); }
  values(...args: unknown[]): this { return this.chain("values", args); }
  set(...args: unknown[]): this { return this.chain("set", args); }
  onConflictDoNothing(...args: unknown[]): this {
    return this.chain("onConflictDoNothing", args);
  }
  onConflictDoUpdate(...args: unknown[]): this {
    return this.chain("onConflictDoUpdate", args);
  }
  returning(...args: unknown[]): this { return this.chain("returning", args); }
  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}
class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];
  enqueue(...results: unknown[]): void { this.results.push(...results); }
  take(): unknown { return this.results.length > 0 ? this.results.shift() : []; }
  private query(method: string, args: readonly unknown[]): FakeQuery {
    this.calls.push({ method, args });
    return new FakeQuery(this);
  }
  select(...args: unknown[]): FakeQuery { return this.query("select", args); }
  insert(...args: unknown[]): FakeQuery { return this.query("insert", args); }
  update(...args: unknown[]): FakeQuery { return this.query("update", args); }
  transaction<T>(
    run: (tx: FakeExecutor) => Promise<T>,
    config?: { readonly isolationLevel?: string },
  ): Promise<T> {
    this.calls.push({ method: "transaction", args: [config] });
    return run(this);
  }
  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call`);
    return call;
  }
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const authorizationCheckedAt = new Date(
  "2026-07-27T09:30:00.000Z",
);
const githubScope = {
  providerKind: "github" as const,
  installationId: 201,
  repositoryId: 101,
  repositoryOwner: "gengrowth",
  repositoryName: "website",
  baseBranch: "main",
  branchPrefix: "gengrowth/",
  contentPath: "content/blog/customer-onboarding.md",
  grantedPermissions: [
    "metadata_read",
    "contents_read",
    "contents_write",
    "pull_requests_write",
  ],
};
const githubAuthorization = {
  authorizationId: "authorization-1",
  actorId: "actor-1",
  grantedAt: "2026-07-27T09:00:00.000Z",
  expiresAt: null,
  scopes: ["contents_read", "contents_write"],
  destinationRef: "destination-1",
  destinationRevision: 1,
  purpose: "connector_configuration",
  customerAcknowledgement: {
    customerAcknowledgementId: "ack-1",
    actorId: "actor-1",
    acknowledgedAt: "2026-07-27T08:59:00.000Z",
    acknowledgementScope: "connector_configuration",
  },
};

const previewDestination = {
  id: "destination-row-1",
  destination_ref: "destination-1",
  revision: 1,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  site_id: "site-1",
  provider_kind: "github" as const,
  target_ref: "/blog/customer-onboarding/",
  state: "ready" as const,
};

function publishPreviewInput() {
  return {
    id: "preview-event-1",
    previewRef: "prv_preview_000000000000000000000001",
    previewKind: "publish" as const,
    factsSchemaVersion: "publication-preview-facts.v1",
    ...scope,
    siteId: "site-1",
    destination: previewDestination,
    actionId: "action-1",
    artifactId: "artifact-1",
    artifactRevisionId: "revision-3",
    artifactRevision: 3,
    artifactContentHash: "a".repeat(64),
    artifactApprovalEventId: "approval-1",
    sourcePublicationAttemptId: null,
    sourceChangeReceiptId: null,
    providerPlan: {
      providerKind: "github",
      operation: "create_pull_request",
    },
    remotePrecondition: {
      kind: "must_match",
      revision: "base-sha",
    },
    rollbackPlan: {
      providerKind: "github",
      strategy: "github_revert_pr",
    },
    previewChecksum: "a".repeat(64),
    contentChecksum: "b".repeat(64),
    expiresAt: "2026-07-28T10:00:00.000Z",
    eventActorId: "actor-1",
    idempotencyKey: "preview-key-1",
    requestHash: "c".repeat(64),
  };
}

describe("DeliveryAuthorizationGrantsRepository", () => {
  it("locks only the exact active-project consumed grant for execution", async () => {
    const db = new FakeExecutor();
    const grant = {
      id: "grant-1",
      state: "consumed",
      consumed_at: "2026-07-27T09:59:00.000Z",
      expires_at: "2026-07-27T10:00:00.000Z",
    };
    db.enqueue([grant]);
    const repo = new DeliveryAuthorizationGrantsRepository(db as never);

    await expect(
      repo.findExactForExecution(
        scope,
        {
          grantId: "grant-1",
          siteId: "site-1",
          providerKind: "github",
          purpose: "publish",
          destinationRef: "destination-1",
          destinationRevision: 1,
          targetRef: "/blog/customer-onboarding/",
          authorizationSnapshotHash: "a".repeat(64),
        },
        { lock: true },
      ),
    ).resolves.toBe(grant);
    expect(db.last("for").args).toEqual(["share"]);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain(
      "active_project.archived_at is null",
    );
    expect(predicate.sql).toContain('"consumed_at" is not null');
    expect(predicate.sql).toContain(
      '"consumed_at" <= "app"."delivery_authorization_grants"."expires_at"',
    );
    expect(predicate.sql).not.toContain('"expires_at" > now()');
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        "grant-1",
        "consumed",
        "destination-1",
        "a".repeat(64),
      ]),
    );
  });

  it("persists encrypted WordPress material without a dangling vault ref", async () => {
    const db = new FakeExecutor();
    const created = {
      id: "grant-1",
      provider_kind: "wordpress",
      purpose: "connector_configuration",
      state: "ready",
    };
    db.enqueue([created]);
    const repo = new DeliveryAuthorizationGrantsRepository(db as never);
    const requestedScope = {
      providerKind: "wordpress",
      siteBaseUrl: "https://example.com",
      postType: "post",
      authorAllowlist: [7],
      statusAllowlist: ["draft"],
    };
    const snapshot = {
      authorizationId: "authorization-1",
      actorId: "actor-1",
      grantedAt: "2026-07-27T09:00:00.000Z",
      expiresAt: null,
      scopes: ["edit_posts"],
      destinationRef: "destination-1",
      destinationRevision: 1,
      purpose: "connector_configuration",
      customerAcknowledgement: {
        customerAcknowledgementId: "ack-1",
        actorId: "actor-1",
        acknowledgedAt: "2026-07-27T08:59:00.000Z",
        acknowledgementScope: "connector_configuration",
      },
    };

    await expect(
      repo.create({
        ...scope,
        siteId: "site-1",
        providerKind: "wordpress",
        purpose: "connector_configuration",
        destinationRef: "destination-1",
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        requestedScope,
        authorizationSnapshot: snapshot,
        encryptedPayload: Buffer.alloc(48, 7),
        cipherVersion: 1,
        keyVersion: "kms-key-v1",
        secretMetadata: { algorithm: "AES-256-GCM" },
        expiresAt: null,
        createdBy: "actor-1",
      }),
    ).resolves.toBe(created);

    expect(db.last("values").args[0]).toMatchObject({
      provider_kind: "wordpress",
      requested_scope_hash: contentHash(requestedScope),
      authorization_snapshot_hash: contentHash(snapshot),
      encrypted_payload: Buffer.alloc(48, 7),
      cipher_version: 1,
      key_version: "kms-key-v1",
    });
    expect(db.last("values").args[0]).not.toHaveProperty(
      "encrypted_secret_ref",
    );
  });

  it("refuses cross-purpose, revoked and expired grant consumption", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        id: "grant-1",
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        site_id: "site-1",
        provider_kind: "github",
        purpose: "publish",
        state: "ready",
        destination_ref: "destination-1",
        destination_revision: 1,
        target_ref: "/blog/customer-onboarding/",
        expires_at: null,
      },
    ]);
    const repo = new DeliveryAuthorizationGrantsRepository(db as never);

    await expect(
      repo.consume({
        ...scope,
        grantId: "grant-1",
        siteId: "site-1",
        providerKind: "github",
        purpose: "rollback",
        destinationRef: "destination-1",
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
      }),
    ).rejects.toBeInstanceOf(DeliveryAuthorizationGrantConflictError);
    expect(db.calls.some((call) => call.method === "update")).toBe(false);
  });

  it.each(["publish", "rollback"] as const)(
    "rejects a %s grant without a future server-authored expiry before insert",
    async (purpose) => {
      const db = new FakeExecutor();
      const repo = new DeliveryAuthorizationGrantsRepository(db as never);
      const destinationRef = "destination-1";
      const authorizationSnapshot = {
        ...githubAuthorization,
        purpose,
        destinationRef,
        destinationRevision: 1,
        expiresAt: null,
      };

      await expect(
        repo.create({
          ...scope,
          siteId: "site-1",
          providerKind: "github",
          purpose,
          destinationRef,
          destinationRevision: 1,
          targetRef: "/blog/customer-onboarding/",
          requestedScope: githubScope,
          authorizationSnapshot,
          encryptedPayload: null,
          cipherVersion: null,
          keyVersion: null,
          secretMetadata: {},
          expiresAt: null,
          createdBy: "actor-1",
        }),
      ).rejects.toMatchObject({ code: "GRANT_EXPIRED" });

      expect(db.calls.some((call) => call.method === "insert")).toBe(false);
    },
  );

  it("rejects an already-expired grant before insert", async () => {
    const db = new FakeExecutor();
    const repo = new DeliveryAuthorizationGrantsRepository(db as never);
    const expiresAt = "2000-01-01T00:00:00.000Z";

    await expect(
      repo.create({
        ...scope,
        siteId: "site-1",
        providerKind: "github",
        purpose: "publish",
        destinationRef: "destination-1",
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        requestedScope: githubScope,
        authorizationSnapshot: {
          ...githubAuthorization,
          purpose: "publish",
          expiresAt,
        },
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        secretMetadata: {},
        expiresAt,
        createdBy: "actor-1",
      }),
    ).rejects.toMatchObject({ code: "GRANT_EXPIRED" });

    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("uses an injected clock for deterministic grant expiry", async () => {
    const db = new FakeExecutor();
    const repo = new DeliveryAuthorizationGrantsRepository(
      db as never,
      {
        now: () => new Date("2100-01-01T00:00:00.000Z"),
      },
    );
    const expiresAt = "2099-01-01T00:00:00.000Z";

    await expect(
      repo.create({
        ...scope,
        siteId: "site-1",
        providerKind: "github",
        purpose: "publish",
        destinationRef: "destination-1",
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        requestedScope: githubScope,
        authorizationSnapshot: {
          ...githubAuthorization,
          purpose: "publish",
          expiresAt,
        },
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        secretMetadata: {},
        expiresAt,
        createdBy: "actor-1",
      }),
    ).rejects.toMatchObject({ code: "GRANT_EXPIRED" });

    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("uses one caller-frozen clock for current-grant reads instead of database now()", async () => {
    const db = new FakeExecutor();
    const grant = {
      id: "grant-1",
      state: "ready",
      expires_at: "2026-07-27T10:00:00.000Z",
    };
    db.enqueue([grant], [grant]);
    const repo = new DeliveryAuthorizationGrantsRepository(db as never);

    await expect(
      repo.readCurrent(
        scope,
        "grant-1",
        new Date("2026-07-27T09:59:59.000Z"),
      ),
    ).resolves.toBe(grant);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).not.toContain("now()");

    await expect(
      repo.readCurrent(
        scope,
        "grant-1",
        new Date("2026-07-27T10:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });
});

describe("DeliveryConnectionsRepository", () => {
  it("lists one active-project head per destination with bounded keyset pagination", async () => {
    const db = new FakeExecutor();
    const first = {
      id: "00000000-0000-4000-8000-000000000101",
      destination_ref: "00000000-0000-4000-8000-000000000201",
      revision: 3,
      created_at: "2026-07-27T10:00:00.000Z",
    };
    const second = {
      id: "00000000-0000-4000-8000-000000000102",
      destination_ref: "00000000-0000-4000-8000-000000000202",
      revision: 2,
      created_at: "2026-07-27T09:00:00.000Z",
    };
    db.enqueue([first, second]);
    const repo = new DeliveryConnectionsRepository(db as never);

    const page = await repo.listHeads(scope, { limit: 1 });

    expect(page.rows).toEqual([first]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(db.last("limit").args).toEqual([2]);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.sql).toContain("select max(head.revision)");
    expect(predicate.sql).toContain(
      "head.destination_ref = \"app\".\"publication_destinations\".\"destination_ref\"",
    );

    db.enqueue([second]);
    await expect(
      repo.listHeads(scope, {
        limit: 1,
        cursor: page.nextCursor,
      }),
    ).resolves.toEqual({ rows: [second], nextCursor: null });
  });

  it("lists bounded active-project destination history newest-first", async () => {
    const db = new FakeExecutor();
    const rows = [
      { id: "revision-3", revision: 3 },
      { id: "revision-2", revision: 2 },
    ];
    db.enqueue(rows);
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.listRevisions(scope, "destination-1", { limit: 2 }),
    ).resolves.toEqual(rows);
    expect(db.last("limit").args).toEqual([2]);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain("destination-1");
    expect(db.last("orderBy").args).toHaveLength(2);
  });

  it("rejects invalid delivery read bounds or cursors before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.listHeads(scope, { limit: 101 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      repo.listRevisions(scope, "destination-1", { limit: 1_001 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      repo.listHeads(scope, { limit: 10, cursor: "not-a-cursor" }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    expect(db.calls).toEqual([]);
  });

  it("locks only the exact latest ready destination for execution", async () => {
    const db = new FakeExecutor();
    const destination = { id: "destination-row-1", revision: 2 };
    db.enqueue([destination]);
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.findExactForExecution(
        scope,
        {
          id: "destination-row-1",
          destinationRef: "destination-1",
          revision: 2,
          siteId: "site-1",
          providerKind: "github",
          targetRef: "/blog/customer-onboarding/",
        },
        { lock: true },
      ),
    ).resolves.toBe(destination);
    expect(db.last("for").args).toEqual(["share"]);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain(
      "active_project.archived_at is null",
    );
    expect(predicate.sql).toContain("not exists");
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        "destination-row-1",
        "destination-1",
        "ready",
      ]),
    );
  });

  it("rejects an unavailable destination without a non-empty limitation before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "github",
        authorizationGrantId: "grant-1",
        providerScope: githubScope,
        readinessObservation: {},
        state: "unavailable",
        limitation: null,
        createdBy: "actor-1",
        authorizationCheckedAt,
      }),
    ).rejects.toMatchObject({
      code: "DESTINATION_LIMITATION_INVALID",
    });
    expect(db.calls).toEqual([]);
  });

  it("rejects a revoked append even with a limitation before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "github",
        authorizationGrantId: "grant-1",
        providerScope: githubScope,
        readinessObservation: {},
        state: "revoked",
        limitation: "Customer disconnected GitHub.",
        createdBy: "actor-1",
        authorizationCheckedAt,
      } as never),
    ).rejects.toMatchObject({
      code: "DESTINATION_STATE_INVALID",
    });
    expect(db.calls).toEqual([]);
  });

  it("uses an injected clock for the frozen destination revocation fact", async () => {
    const db = new FakeExecutor();
    const latest = {
      id: "destination-row-1",
      destination_ref: "destination-1",
      revision: 1,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      provider_kind: "github",
      target_ref: "/blog/customer-onboarding/",
      state: "ready",
      authorization_grant_id: "grant-1",
      provider_scope: githubScope,
      provider_scope_hash: "a".repeat(64),
      authorization_snapshot: {},
      authorization_snapshot_hash: "b".repeat(64),
    };
    const revoked = { id: "destination-row-2", revision: 2 };
    db.enqueue([latest], [revoked]);
    const repo = new DeliveryConnectionsRepository(db as never, {
      now: () => new Date("2026-07-27T13:14:15.000Z"),
    });

    await expect(
      repo.revoke({
        ...scope,
        destinationRef: "destination-1",
        baseRevision: 1,
        actorId: "actor-1",
        reason: "Customer disconnected GitHub.",
      }),
    ).resolves.toBe(revoked);

    expect(db.last("values").args[0]).toMatchObject({
      readiness_observation: {
        revokedBy: "actor-1",
        revokedAt: "2026-07-27T13:14:15.000Z",
      },
    });
  });

  it("appends a project-scoped GitHub destination revision with a durable grant ref", async () => {
    const db = new FakeExecutor();
    const inserted = { id: "destination-row-1", revision: 1 };
    db.enqueue(
      [],
      [
        {
          id: "grant-1",
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          site_id: "site-1",
          provider_kind: "github",
          purpose: "connector_configuration",
          state: "ready",
          destination_ref: "destination-1",
          destination_revision: 1,
          target_ref: "/blog/customer-onboarding/",
          requested_scope: githubScope,
          authorization_snapshot: githubAuthorization,
          authorization_snapshot_hash: contentHash(githubAuthorization),
          expires_at: null,
        },
      ],
      [inserted],
      [{ id: "grant-1" }],
    );
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "github",
        authorizationGrantId: "grant-1",
        providerScope: githubScope,
        readinessObservation: { permissionProbe: "passed" },
        state: "ready",
        limitation: null,
        createdBy: "actor-1",
        authorizationCheckedAt,
      }),
    ).resolves.toBe(inserted);

    expect(db.last("values").args[0]).toMatchObject({
      destination_ref: "destination-1",
      revision: 1,
      supersedes_id: null,
      provider_kind: "github",
      authorization_grant_id: "grant-1",
      provider_scope_hash: contentHash(githubScope),
      authorization_snapshot_hash: contentHash(githubAuthorization),
    });
  });

  it("requires exact base revision and matching authorization destination revision", async () => {
    const db = new FakeExecutor();
    db.enqueue([{ id: "row-2", revision: 2 }]);
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "github",
        authorizationGrantId: "grant-2",
        providerScope: githubScope,
        readinessObservation: { permissionProbe: "passed" },
        state: "ready",
        limitation: null,
        createdBy: "actor-1",
        authorizationCheckedAt,
      }),
    ).rejects.toBeInstanceOf(DeliveryConnectionConflictError);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rejects a resolved destination outside the authorization grant scope", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [
        {
          id: "grant-1",
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          site_id: "site-1",
          provider_kind: "github",
          purpose: "connector_configuration",
          state: "ready",
          destination_ref: "destination-1",
          destination_revision: 1,
          target_ref: "/blog/customer-onboarding/",
          requested_scope: {
            ...githubScope,
            repositoryId: 999,
          },
          authorization_snapshot: githubAuthorization,
          authorization_snapshot_hash: contentHash(githubAuthorization),
          expires_at: null,
        },
      ],
    );
    const repo = new DeliveryConnectionsRepository(db as never);

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "github",
        authorizationGrantId: "grant-1",
        providerScope: githubScope,
        readinessObservation: { permissionProbe: "passed" },
        state: "ready",
        limitation: null,
        createdBy: "actor-1",
        authorizationCheckedAt,
      }),
    ).rejects.toMatchObject({
      code: "DESTINATION_PROVIDER_SCOPE_INVALID",
    });
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("fails closed when a WordPress authorization grant cannot be resolved", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new DeliveryConnectionsRepository(db as never);
    const providerScope = {
      providerKind: "wordpress" as const,
      siteBaseUrl: "https://example.com",
      authenticatedUserId: 7,
      postType: "post",
      authorAllowlist: [7],
      statusAllowlist: ["draft"],
      capabilities: ["edit_posts"],
    };

    await expect(
      repo.appendRevision({
        ...scope,
        siteId: "site-1",
        destinationRef: "destination-1",
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "wordpress",
        authorizationGrantId: "grant-1",
        providerScope,
        readinessObservation: { capabilityProbe: "passed" },
        state: "ready",
        limitation: null,
        createdBy: "actor-1",
        authorizationCheckedAt,
      }),
    ).rejects.toBeInstanceOf(PublicationInvariantError);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });
});

describe("PublicationsRepository", () => {
  it("issues a server-owned publish preview with permanent idempotency and no destination observation authority", async () => {
    const db = new FakeExecutor();
    const input = publishPreviewInput();
    const inserted = {
      id: input.id,
      event_kind: "issued",
      preview_kind: "publish",
    };
    db.enqueue([], [inserted]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
      clock: {
        now: () => new Date("2026-07-28T09:00:00.000Z"),
      },
    });

    await expect(repo.issuePreview(input)).resolves.toBe(inserted);

    const persisted = db.last("values").args[0] as Record<string, unknown>;
    expect(persisted).toMatchObject({
      id: "preview-event-1",
      preview_ref: input.previewRef,
      event_kind: "issued",
      preview_kind: "publish",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      destination_id: previewDestination.id,
      artifact_revision_id: "revision-3",
      source_publication_attempt_id: null,
      source_change_receipt_id: null,
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
      idempotency_key: "preview-key-1",
      request_hash: "c".repeat(64),
    });
    expect(persisted.facts_hash).toBe(
      publicationPreviewFactsHash({
        eventId: input.id,
        ...input,
      }),
    );
    expect(persisted).not.toHaveProperty("readiness_observation");
    expect(
      db.calls.filter((call) => call.method === "onConflictDoNothing"),
    ).toHaveLength(1);
  });

  it("issues rollback preview lineage and rejects a cross-project destination before SQL", async () => {
    const db = new FakeExecutor();
    const publish = publishPreviewInput();
    const rollback = {
      ...publish,
      id: "preview-event-rollback",
      previewRef: "prv_rollback_000000000000000000000001",
      previewKind: "rollback" as const,
      sourcePublicationAttemptId: "attempt-source",
      sourceChangeReceiptId: "change-source",
      idempotencyKey: "preview-key-rollback",
    };
    const inserted = {
      id: rollback.id,
      event_kind: "issued",
      preview_kind: "rollback",
    };
    db.enqueue([], [inserted]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
      clock: {
        now: () => new Date("2026-07-28T09:00:00.000Z"),
      },
    });

    await expect(repo.issuePreview(rollback)).resolves.toBe(inserted);
    expect(db.last("values").args[0]).toMatchObject({
      preview_kind: "rollback",
      source_publication_attempt_id: "attempt-source",
      source_change_receipt_id: "change-source",
    });

    const rejectedDb = new FakeExecutor();
    const rejectedRepo = new PublicationsRepository(
      rejectedDb as never,
      { enqueue: vi.fn() },
    );
    await expect(
      rejectedRepo.issuePreview({
        ...publish,
        destination: {
          ...previewDestination,
          project_id: "another-project",
        },
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_PREVIEW_SCOPE_INVALID" });
    expect(rejectedDb.calls).toEqual([]);
  });

  it("replays an issued preview permanently and rejects changed facts under the same key", async () => {
    const input = publishPreviewInput();
    const existing = {
      id: input.id,
      preview_ref: input.previewRef,
      event_kind: "issued",
      preview_kind: input.previewKind,
      request_hash: input.requestHash,
      facts_hash: publicationPreviewFactsHash({
        ...input,
        eventId: input.id,
      }),
    };
    const replayDb = new FakeExecutor();
    replayDb.enqueue([existing]);
    const replayRepo = new PublicationsRepository(replayDb as never, {
      enqueue: vi.fn(),
      clock: {
        now: () => new Date("2026-07-28T09:00:00.000Z"),
      },
    });

    await expect(replayRepo.issuePreview(input)).resolves.toBe(existing);
    expect(
      replayDb.calls.some((call) => call.method === "insert"),
    ).toBe(false);

    const conflictDb = new FakeExecutor();
    conflictDb.enqueue([existing]);
    const conflictRepo = new PublicationsRepository(
      conflictDb as never,
      {
        enqueue: vi.fn(),
        clock: {
          now: () => new Date("2026-07-28T09:00:00.000Z"),
        },
      },
    );
    await expect(
      conflictRepo.issuePreview({
        ...input,
        requestHash: "e".repeat(64),
      }),
    ).rejects.toBeInstanceOf(PublicationIdempotencyConflictError);
    expect(
      conflictDb.calls.some((call) => call.method === "insert"),
    ).toBe(false);
  });

  it("reads only a current unconsumed issued preview by opaque ref and optionally locks it", async () => {
    const db = new FakeExecutor();
    const issued = {
      id: "preview-event-1",
      preview_ref: "prv_preview_000000000000000000000001",
      event_kind: "issued",
      expires_at: "2026-07-28T10:00:00.000Z",
    };
    db.enqueue([issued]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
      clock: {
        now: () => new Date("2026-07-28T09:00:00.000Z"),
      },
    });

    await expect(
      repo.findCurrentIssuedPreview(
        scope,
        {
          previewRef: issued.preview_ref,
          previewEventId: issued.id,
        },
        { lock: true },
      ),
    ).resolves.toBe(issued);

    expect(db.last("for").args).toEqual(["update"]);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain("active_project.archived_at is null");
    expect(predicate.sql).toContain("terminal_preview");
    expect(predicate.sql).toContain("consumed_attempt");
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        issued.id,
        issued.preview_ref,
        "issued",
        "2026-07-28T09:00:00.000Z",
      ]),
    );
  });

  it("appends a terminal preview event by copying immutable issued facts", async () => {
    const db = new FakeExecutor();
    const source = {
      id: "preview-event-1",
      preview_ref: "prv_preview_000000000000000000000001",
      event_kind: "issued",
      preview_kind: "publish",
      facts_schema_version: "publication-preview-facts.v1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      destination_id: "destination-row-1",
      destination_ref: "destination-1",
      destination_revision: 1,
      provider_kind: "github",
      target_ref: "/blog/customer-onboarding/",
      action_id: "action-1",
      artifact_id: "artifact-1",
      artifact_revision_id: "revision-3",
      artifact_revision: 3,
      artifact_content_hash: "a".repeat(64),
      artifact_approval_event_id: "approval-1",
      artifact_approval_event_kind: "approved",
      source_publication_attempt_id: null,
      source_change_receipt_id: null,
      provider_plan: { providerKind: "github" },
      remote_precondition: { kind: "must_match", revision: "base-sha" },
      rollback_plan: {
        providerKind: "github",
        strategy: "github_revert_pr",
      },
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
      facts_hash: "d".repeat(64),
      expires_at: "2026-07-28T10:00:00.000Z",
    };
    const terminal = {
      id: "preview-terminal-1",
      event_kind: "revoked",
      supersedes_preview_event_id: source.id,
    };
    db.enqueue([], [source], [terminal]);
    const ids = ["preview-terminal-1"];
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
      newId: () => ids.shift()!,
      clock: {
        now: () => new Date("2026-07-28T09:00:00.000Z"),
      },
    });

    await expect(
      repo.appendTerminalPreviewEvent(scope, {
        sourcePreviewEventId: source.id,
        previewRef: source.preview_ref,
        eventKind: "revoked",
        eventActorId: "actor-2",
        idempotencyKey: "preview-revoke-key",
        requestHash: "e".repeat(64),
        reason: "Customer cancelled publication.",
      }),
    ).resolves.toBe(terminal);

    expect(db.last("values").args[0]).toMatchObject({
      id: "preview-terminal-1",
      preview_ref: source.preview_ref,
      event_kind: "revoked",
      supersedes_preview_event_id: source.id,
      supersedes_preview_event_kind: "issued",
      preview_kind: source.preview_kind,
      destination_id: source.destination_id,
      artifact_revision_id: source.artifact_revision_id,
      facts_hash: source.facts_hash,
      expires_at: source.expires_at,
      event_actor_id: "actor-2",
      reason: "Customer cancelled publication.",
    });
  });

  it("builds the one canonical active key and deterministic request hash", () => {
    expect(
      publicationActiveKey("destination-1", "/blog/customer-onboarding/"),
    ).toBe("publication:destination-1:/blog/customer-onboarding/");
    const request = {
      attemptKind: "publish" as const,
      destinationRef: "destination-1",
      expectedDestinationRevision: 1,
      approvalEventId: "approval-1",
      previewRef: "preview://artifact/revision/3",
      previewChecksum: "a".repeat(64),
      rollbackPlanRef: "rollback-plan://artifact/revision/3",
      rollbackPlanChecksum: "b".repeat(64),
      remotePrecondition: { kind: "must_match", revision: "base-sha" },
    };
    expect(publicationRequestHash(request)).toBe(contentHash(request));
  });

  it("loads an active-project attempt with exact run lineage and stable bounded receipts", async () => {
    const db = new FakeExecutor();
    const attempt = {
      id: "attempt-1",
      async_run_id: "run-1",
      destination_ref: "destination-1",
      target_ref: "/blog/customer-onboarding/",
      approved_artifact_content_hash: "a".repeat(64),
      content_checksum: "b".repeat(64),
    };
    const run = {
      id: "run-1",
      kind: "publication",
      result_type: "publication_attempt",
      result_id: "attempt-1",
    };
    const receipts = [
      {
        id: "delivery-1",
        receipt_kind: "delivery_receipt",
        predecessor_delivery_receipt_id: null,
        artifact_content_hash: "a".repeat(64),
        content_checksum: "b".repeat(64),
        observed_at: "2026-07-27T09:00:00.000Z",
      },
      {
        id: "change-1",
        receipt_kind: "change_receipt",
        predecessor_delivery_receipt_id: "delivery-1",
        artifact_content_hash: "a".repeat(64),
        content_checksum: "b".repeat(64),
        observed_at: "2026-07-27T09:05:00.000Z",
      },
    ];
    db.enqueue([attempt], [run], receipts);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.loadAttemptForExecution(scope, "attempt-1", {
        lock: true,
      }),
    ).resolves.toEqual({ attempt, run, receipts });
    expect(db.last("limit").args).toEqual([3]);
    expect(
      db.calls.filter((call) => call.method === "for"),
    ).toHaveLength(3);
    const predicates = db.calls
      .filter((call) => call.method === "where")
      .map((call) =>
        new PgDialect().sqlToQuery(call.args[0] as never),
      );
    expect(
      predicates.every((predicate) =>
        predicate.sql.includes(
          "active_project.archived_at is null",
        ),
      ),
    ).toBe(true);
  });

  it("loads immutable publication history after project archival without weakening scope or lineage", async () => {
    const db = new FakeExecutor();
    const attempt = {
      id: "attempt-1",
      async_run_id: "run-1",
      destination_ref: "destination-1",
      target_ref: "/blog/customer-onboarding/",
      approved_artifact_content_hash: "a".repeat(64),
      content_checksum: "b".repeat(64),
    };
    const run = {
      id: "run-1",
      kind: "publication",
      result_type: "publication_attempt",
      result_id: "attempt-1",
    };
    const receipts = [
      {
        id: "delivery-1",
        receipt_kind: "delivery_receipt",
        predecessor_delivery_receipt_id: null,
        artifact_content_hash: "a".repeat(64),
        content_checksum: "b".repeat(64),
      },
    ];
    db.enqueue([attempt], [run], receipts);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.loadAttemptHistory(scope, "attempt-1"),
    ).resolves.toEqual({ attempt, run, receipts });

    const predicates = db.calls
      .filter((call) => call.method === "where")
      .map((call) =>
        new PgDialect().sqlToQuery(call.args[0] as never),
      );
    expect(predicates).toHaveLength(3);
    expect(
      predicates.every(
        (predicate) =>
          predicate.sql.includes('"workspace_id" = $') &&
          predicate.sql.includes('"project_id" = $') &&
          !predicate.sql.includes(
            "active_project.archived_at is null",
          ),
      ),
    ).toBe(true);
    expect(predicates[1]!.params).toEqual(
      expect.arrayContaining([
        "publication",
        "publication_attempt",
        "attempt-1",
      ]),
    );
  });

  it("fails closed when an immutable history receipt diverges from the attempt hashes", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [
        {
          id: "attempt-1",
          async_run_id: "run-1",
          destination_ref: "destination-1",
          target_ref: "/blog/customer-onboarding/",
          approved_artifact_content_hash: "a".repeat(64),
          content_checksum: "b".repeat(64),
        },
      ],
      [
        {
          id: "run-1",
          kind: "publication",
          result_type: "publication_attempt",
          result_id: "attempt-1",
        },
      ],
      [
        {
          id: "delivery-1",
          receipt_kind: "delivery_receipt",
          predecessor_delivery_receipt_id: null,
          artifact_content_hash: "c".repeat(64),
          content_checksum: "b".repeat(64),
        },
      ],
    );
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.loadAttemptHistory(scope, "attempt-1"),
    ).rejects.toMatchObject({
      code: "PUBLICATION_RECEIPT_SET_INVALID",
    });
  });

  it("fails closed when an attempt has no exact publication run lineage", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [
        {
          id: "attempt-1",
          async_run_id: "run-1",
          destination_ref: "destination-1",
          target_ref: "/blog/customer-onboarding/",
        },
      ],
      [],
    );
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.findAttemptById(scope, "attempt-1"),
    ).rejects.toMatchObject({
      code: "PUBLICATION_RUN_MISSING",
    });
  });

  it("fails closed on duplicate receipt kinds in an execution read", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [
        {
          id: "attempt-1",
          async_run_id: "run-1",
          destination_ref: "destination-1",
          target_ref: "/blog/customer-onboarding/",
        },
      ],
      [
        {
          id: "run-1",
          kind: "publication",
          result_type: "publication_attempt",
          result_id: "attempt-1",
        },
      ],
      [
        { id: "delivery-1", receipt_kind: "delivery_receipt" },
        { id: "delivery-2", receipt_kind: "delivery_receipt" },
      ],
    );
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.listReceipts(scope, "attempt-1"),
    ).rejects.toMatchObject({
      code: "PUBLICATION_RECEIPT_SET_INVALID",
    });
  });

  it("same-key/same-hash is a read-only replay even after later revocation", async () => {
    const db = new FakeExecutor();
    const attempt = {
      id: "attempt-1",
      async_run_id: "run-1",
      request_hash: "a".repeat(64),
    };
    const run = { id: "run-1", status: "completed" };
    const receipts = [{ id: "delivery-1" }, { id: "change-1" }];
    db.enqueue([attempt], [run], receipts);
    const enqueue = vi.fn();
    const repo = new PublicationsRepository(db as never, { enqueue });

    await expect(
      repo.replayByPermanentKey(
        scope,
        "publication-key-1",
        "a".repeat(64),
      ),
    ).resolves.toEqual({ attempt, run, receipts, replayed: true });
    expect(enqueue).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("same-key/different-hash conflicts without touching provider state", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        id: "attempt-1",
        async_run_id: "run-1",
        request_hash: "a".repeat(64),
      },
    ]);
    const enqueue = vi.fn();
    const repo = new PublicationsRepository(db as never, { enqueue });

    await expect(
      repo.replayByPermanentKey(
        scope,
        "publication-key-1",
        "b".repeat(64),
      ),
    ).rejects.toBeInstanceOf(PublicationIdempotencyConflictError);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("atomically reserves idempotency, attempt, canonical run, grant and enqueue", async () => {
    const db = new FakeExecutor();
    const requestHash = "d".repeat(64);
    const grant = {
      id: "grant-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      provider_kind: "github" as const,
      purpose: "publish" as const,
      state: "ready" as const,
      destination_ref: "destination-1",
      destination_revision: 1,
      target_ref: "/blog/customer-onboarding/",
      authorization_snapshot: {
        purpose: "publish",
        destinationRef: "destination-1",
        destinationRevision: 1,
      },
      authorization_snapshot_hash: "e".repeat(64),
      expires_at: "2099-07-27T10:00:00.000Z",
    };
    const destination = {
      id: "destination-row-1",
      destination_ref: "destination-1",
      revision: 1,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      provider_kind: "github" as const,
      target_ref: "/blog/customer-onboarding/",
      state: "ready" as const,
    };
    const run = { id: "run-1", status: "queued" };
    const attempt = {
      id: "attempt-1",
      async_run_id: "run-1",
      request_hash: requestHash,
    };
    const issuedPreview = {
      id: "preview-event-atomic",
      preview_ref: "prv_atomic_000000000000000000000001",
      event_kind: "issued",
      preview_kind: "publish",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      destination_id: destination.id,
      destination_ref: destination.destination_ref,
      destination_revision: destination.revision,
      provider_kind: destination.provider_kind,
      target_ref: destination.target_ref,
      action_id: "action-1",
      artifact_id: "artifact-1",
      artifact_revision_id: "revision-3",
      artifact_revision: 3,
      artifact_content_hash: "a".repeat(64),
      artifact_approval_event_id: "approval-1",
      artifact_approval_event_kind: "approved",
      source_publication_attempt_id: null,
      source_change_receipt_id: null,
      provider_plan: { providerKind: "github" },
      remote_precondition: {
        kind: "must_match",
        revision: "base-sha",
      },
      rollback_plan: {
        providerKind: "github",
        strategy: "github_revert_pr",
      },
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
      facts_hash: "f".repeat(64),
      expires_at: "2099-07-28T10:00:00.000Z",
    };
    db.enqueue(
      [],
      [],
      [{ id: "idem-1", request_hash: requestHash }],
      [issuedPreview],
      [run],
      [attempt],
      [grant],
      [{ ...grant, state: "consumed" }],
      [],
    );
    const enqueue = vi.fn(async () => "run-1");
    const ids = ["attempt-1", "run-1"];
    const resolveCurrentFacts = vi.fn(async () => ({
      attemptKind: "publish" as const,
      sourcePublicationAttemptId: null,
      siteId: "site-1",
      destination,
      actionId: "action-1",
      artifactId: "artifact-1",
      artifactRevisionId: "revision-3",
      approvedArtifactRevision: 3,
      approvedArtifactContentHash: "a".repeat(64),
      contentChecksum: "b".repeat(64),
      publicationApprovalEventId: "approval-1",
      sourceApprovalEventId: null,
      authorizationGrant: grant,
      authorizationPurpose: "publish" as const,
      previewEventId: issuedPreview.id,
      previewEventKind: "issued" as const,
      previewFactsHash: issuedPreview.facts_hash,
      previewRef: issuedPreview.preview_ref,
      previewChecksum: "a".repeat(64),
      remotePrecondition: { kind: "must_match", revision: "base-sha" },
      rollbackPlan: { providerKind: "github", strategy: "github_revert_pr" },
    }));
    const repo = new PublicationsRepository(db as never, {
      enqueue,
      newId: () => ids.shift()!,
    });

    await expect(
      repo.createAttemptAtomically({
        ...scope,
        destinationRef: "destination-1",
        targetRef: "/blog/customer-onboarding/",
        idempotencyKey: "publication-key-1",
        requestHash,
        idempotencyExpiresAt: "2026-07-28T09:00:00.000Z",
        requestedBy: "actor-1",
        contractVersion: "2026-07-27",
        resolveCurrentFacts,
      }),
    ).resolves.toMatchObject({
      attempt,
      run,
      replayed: false,
    });

    expect(resolveCurrentFacts).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      }),
    );
    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toHaveLength(1);
    expect(db.last("transaction").args).toEqual([
      { isolationLevel: "repeatable read" },
    ]);
    expect(
      db.calls
        .filter((call) => call.method === "values")
        .map((call) => call.args[0]),
    ).toContainEqual(
      expect.objectContaining({
        approved_artifact_content_hash: "a".repeat(64),
        preview_event_id: issuedPreview.id,
        preview_event_kind: "issued",
        preview_facts_hash: issuedPreview.facts_hash,
        preview_checksum: "a".repeat(64),
        content_checksum: "b".repeat(64),
      }),
    );
  });

  it("rejects a rollback preview whose checksum differs from its approved revision", async () => {
    const db = new FakeExecutor();
    const requestHash = "d".repeat(64);
    db.enqueue(
      [],
      [],
      [{ id: "idem-rollback", request_hash: requestHash }],
    );
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.createAttemptAtomically({
        ...scope,
        destinationRef: "destination-1",
        targetRef: "/blog/customer-onboarding/",
        idempotencyKey: "rollback-key-mismatched-preview",
        requestHash,
        idempotencyExpiresAt: "2099-07-28T09:00:00.000Z",
        requestedBy: "actor-1",
        contractVersion: "2026-07-27",
        sourceChangeReceiptId: "change-1",
        resolveCurrentFacts: async () => ({
          attemptKind: "rollback",
          sourcePublicationAttemptId: "attempt-source",
          siteId: "site-1",
          destination: {
            id: "destination-row-1",
            destination_ref: "destination-1",
            revision: 1,
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: "site-1",
            provider_kind: "github",
            target_ref: "/blog/customer-onboarding/",
            state: "ready",
          },
          actionId: "action-1",
          artifactId: "artifact-1",
          artifactRevisionId: "revision-3",
          approvedArtifactRevision: 3,
          approvedArtifactContentHash: "a".repeat(64),
          contentChecksum: "c".repeat(64),
          publicationApprovalEventId: null,
          sourceApprovalEventId: "approval-1",
          authorizationGrant: {
            id: "grant-rollback",
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: "site-1",
            provider_kind: "github",
            purpose: "rollback",
            state: "ready",
            destination_ref: "destination-1",
            destination_revision: 1,
            target_ref: "/blog/customer-onboarding/",
            authorization_snapshot: { purpose: "rollback" },
            authorization_snapshot_hash: "e".repeat(64),
            expires_at: "2099-07-27T10:00:00.000Z",
          },
          authorizationPurpose: "rollback",
          previewEventId: "preview-event-rollback",
          previewEventKind: "issued",
          previewFactsHash: "f".repeat(64),
          previewRef: "preview://rollback/1",
          previewChecksum: "b".repeat(64),
          remotePrecondition: {
            kind: "must_match",
            revision: "merge-sha",
          },
          rollbackPlan: {
            providerKind: "github",
            strategy: "github_revert_pr",
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "PUBLICATION_ATTEMPT_AUTHORIZATION_INVALID",
    });
  });

  it("rollback source validation requires a same-scope verified change receipt", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.requireRollbackSource(scope, {
        sourcePublicationAttemptId: "attempt-1",
        sourceChangeReceiptId: "receipt-1",
        destinationRef: "destination-1",
        providerKind: "github",
        targetRef: "/blog/customer-onboarding/",
      }),
    ).rejects.toBeInstanceOf(PublicationInvariantError);
  });

  it("persists delivery then change facts idempotently without a second status truth", async () => {
    const db = new FakeExecutor();
    const delivery = { id: "delivery-1", receipt_kind: "delivery_receipt" };
    const change = { id: "change-1", receipt_kind: "change_receipt" };
    const attempt = {
      id: "attempt-1",
      site_id: "site-1",
      provider_kind: "github",
      approved_artifact_content_hash: "a".repeat(64),
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
    };
    db.enqueue([attempt], [delivery], [attempt], [change]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.appendReceipt({
        ...scope,
        siteId: "site-1",
        publicationAttemptId: "attempt-1",
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        providerKind: "github",
        providerRequestId: "request-1",
        remoteScopeRef: "github:repository:101:pull-request:42",
        remoteObjectKind: "github_pull_request",
        remoteObjectId: "42",
        remoteRevision: "head-sha",
        deliveryUrl: "https://github.com/gengrowth/website/pull/42",
        liveCanonicalUrl: null,
        artifactContentHash: "a".repeat(64),
        contentChecksum: "b".repeat(64),
        verificationState: "provider_accepted",
        remoteFacts: { headSha: "head-sha" },
        evidenceRefs: [],
        limitation: null,
        observedAt: "2026-07-27T09:05:00.000Z",
      }),
    ).resolves.toBe(delivery);
    await expect(
      repo.appendReceipt({
        ...scope,
        siteId: "site-1",
        publicationAttemptId: "attempt-1",
        receiptKind: "change_receipt",
        predecessorDeliveryReceiptId: "delivery-1",
        providerKind: "github",
        providerRequestId: "request-2",
        remoteScopeRef: "github:repository:101:pull-request:42",
        remoteObjectKind: "github_merge",
        remoteObjectId: "42",
        remoteRevision: "merge-sha",
        deliveryUrl: "https://github.com/gengrowth/website/pull/42",
        liveCanonicalUrl: "https://example.com/blog/customer-onboarding/",
        artifactContentHash: "a".repeat(64),
        contentChecksum: "b".repeat(64),
        verificationState: "verified_live",
        remoteFacts: { mergedSha: "merge-sha" },
        evidenceRefs: ["evidence://live/page"],
        limitation: null,
        observedAt: "2026-07-27T09:15:00.000Z",
      }),
    ).resolves.toBe(change);

    expect(db.last("values").args[0]).toMatchObject({
      artifact_content_hash: "a".repeat(64),
      content_checksum: "b".repeat(64),
    });
    expect(db.last("values").args[0]).not.toHaveProperty("status");
  });

  it("rejects receipt kinds that contradict provider object facts before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.appendReceipt({
        ...scope,
        siteId: "site-1",
        publicationAttemptId: "attempt-1",
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        providerKind: "github",
        providerRequestId: null,
        remoteScopeRef: "github:repository:101:pull-request:42",
        remoteObjectKind: "github_merge",
        remoteObjectId: "42",
        remoteRevision: "merge-sha",
        deliveryUrl: "https://github.com/gengrowth/website/pull/42",
        liveCanonicalUrl: null,
        artifactContentHash: "a".repeat(64),
        contentChecksum: "a".repeat(64),
        verificationState: "unavailable",
        remoteFacts: {},
        evidenceRefs: [],
        limitation: null,
        observedAt: "2026-07-27T09:05:00.000Z",
      }),
    ).rejects.toBeInstanceOf(PublicationInvariantError);

    expect(db.calls).toEqual([]);
  });

  it("persists the exact verified source Change Receipt on rollback", async () => {
    const db = new FakeExecutor();
    const inserted = {
      id: "attempt-rollback",
      source_change_receipt_id: "change-1",
    };
    db.enqueue([inserted]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.insertAttempt({
        id: "attempt-rollback",
        runId: "run-rollback",
        attemptKind: "rollback",
        sourcePublicationAttemptId: "attempt-source",
        sourceChangeReceiptId: "change-1",
        ...scope,
        siteId: "site-1",
        destination: {
          id: "destination-row-1",
          destination_ref: "destination-1",
          revision: 1,
          provider_kind: "github",
          target_ref: "/blog/customer-onboarding/",
        },
        actionId: "action-1",
        artifactId: "artifact-1",
        artifactRevisionId: "revision-3",
        approvedArtifactRevision: 3,
        approvedArtifactContentHash: "a".repeat(64),
        contentChecksum: "b".repeat(64),
        publicationApprovalEventId: null,
        sourceApprovalEventId: "approval-1",
        authorizationGrant: {
          id: "grant-rollback",
          authorization_snapshot: { purpose: "rollback" },
          authorization_snapshot_hash: "b".repeat(64),
        },
        authorizationPurpose: "rollback",
        previewEventId: "preview-event-rollback",
        previewEventKind: "issued",
        previewFactsHash: "f".repeat(64),
        previewRef: "preview://rollback/1",
        previewChecksum: "a".repeat(64),
        remotePrecondition: { kind: "must_match", revision: "merge-sha" },
        rollbackPlan: {
          providerKind: "github",
          strategy: "github_revert_pr",
        },
        idempotencyKey: "rollback-key-1",
        requestHash: "c".repeat(64),
        requestedBy: "actor-1",
      }),
    ).resolves.toBe(inserted);

    expect(db.last("values").args[0]).toMatchObject({
      source_publication_attempt_id: "attempt-source",
      source_change_receipt_id: "change-1",
      preview_event_id: "preview-event-rollback",
      preview_event_kind: "issued",
      preview_facts_hash: "f".repeat(64),
      approved_artifact_content_hash: "a".repeat(64),
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
    });
  });

  it("rejects a receipt replay when any immutable provider fact changed", async () => {
    const db = new FakeExecutor();
    const attempt = {
      id: "attempt-1",
      site_id: "site-1",
      provider_kind: "github",
      approved_artifact_content_hash: "a".repeat(64),
      preview_checksum: "a".repeat(64),
      content_checksum: "b".repeat(64),
    };
    const conflicting = {
      id: "change-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      publication_attempt_id: "attempt-1",
      receipt_kind: "change_receipt",
      predecessor_delivery_receipt_id: "delivery-1",
      provider_kind: "github",
      provider_request_id: "request-2",
      remote_scope_ref: "github:repository:101:pull-request:42",
      remote_object_kind: "github_merge",
      remote_object_id: "42",
      remote_revision: "different-merge-sha",
      delivery_url: "https://github.com/gengrowth/website/pull/42",
      live_canonical_url:
        "https://example.com/blog/customer-onboarding/",
      artifact_content_hash: "a".repeat(64),
      content_checksum: "b".repeat(64),
      verification_state: "verified_live",
      remote_facts: { mergedSha: "different-merge-sha" },
      evidence_refs: ["evidence://live/page"],
      limitation: null,
      observed_at: "2026-07-27T09:15:00.000Z",
    };
    db.enqueue([attempt], [], [conflicting]);
    const repo = new PublicationsRepository(db as never, {
      enqueue: vi.fn(),
    });

    await expect(
      repo.appendReceipt({
        ...scope,
        siteId: "site-1",
        publicationAttemptId: "attempt-1",
        receiptKind: "change_receipt",
        predecessorDeliveryReceiptId: "delivery-1",
        providerKind: "github",
        providerRequestId: "request-2",
        remoteScopeRef: "github:repository:101:pull-request:42",
        remoteObjectKind: "github_merge",
        remoteObjectId: "42",
        remoteRevision: "merge-sha",
        deliveryUrl: "https://github.com/gengrowth/website/pull/42",
        liveCanonicalUrl:
          "https://example.com/blog/customer-onboarding/",
        artifactContentHash: "a".repeat(64),
        contentChecksum: "b".repeat(64),
        verificationState: "verified_live",
        remoteFacts: { mergedSha: "merge-sha" },
        evidenceRefs: ["evidence://live/page"],
        limitation: null,
        observedAt: "2026-07-27T09:15:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_REPLAY_CONFLICT" });
  });
});
