import type {
  DeliveryAuthorizationGrantRow,
  IdempotencyRow,
  ProjectRow,
  PublicationDestinationRow,
  SiteRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeliveryConnectionPersistence,
  DeliveryConnectionServiceRuntime,
} from "./delivery-connections.ts";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  appendDeliveryConnectionRevision,
  authorizeGitHubDeliveryConnection,
  authorizeWordPressDeliveryConnection,
  getDeliveryConnection,
  getDeliveryConnectorReadiness,
  getProjectDeliveryConnectorReadiness,
  listDeliveryConnections,
  revokeDeliveryAuthorizationGrant,
  revokeDeliveryConnection,
} = await import("./delivery-connections.ts");

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  site: "10000000-0000-4000-8000-000000000003",
  actor: "10000000-0000-4000-8000-000000000004",
  actorB: "10000000-0000-4000-8000-000000000012",
  destination: "10000000-0000-4000-8000-000000000005",
  destinationRow: "10000000-0000-4000-8000-000000000006",
  grant: "10000000-0000-4000-8000-000000000007",
  acknowledgement: "10000000-0000-4000-8000-000000000008",
  authorization: "10000000-0000-4000-8000-000000000009",
  idempotency: "10000000-0000-4000-8000-000000000010",
} as const;

const scope = { workspaceId: ids.workspace };
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const now = "2026-07-27T10:00:00.000Z";
const expiresAt = "2026-07-27T10:10:00.000Z";

const project: ProjectRow = {
  id: ids.project,
  workspace_id: ids.workspace,
  client_name: "RelayOps",
  project_name: "RelayOps",
  stage: "executing",
  default_delivery_locale: "en-US",
  current_icp_profile_id: null,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: ids.actor,
  created_at: now,
  updated_at: now,
};

const site: SiteRow = {
  id: ids.site,
  workspace_id: ids.workspace,
  project_id: ids.project,
  origin: "https://relayops.example",
  host: "relayops.example",
  market_codes: ["US"],
  language_codes: ["en"],
  is_primary: true,
  created_at: now,
  updated_at: now,
};

const githubSelection = {
  providerKind: "github" as const,
  repositoryId: 101,
  baseBranch: "main",
  branchPrefix: "gengrowth/",
  contentPath: "content/blog/customer-onboarding.md",
};

const githubDestinationScope = {
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
  ] as const,
};

const githubGrantScope = {
  ...githubDestinationScope,
  githubAccountId: 301,
};

const wordpressSelection = {
  providerKind: "wordpress" as const,
  postType: "post",
  authorAllowlist: [7],
  statusAllowlist: ["draft"] as const,
};

const wordpressDestinationScope = {
  providerKind: "wordpress" as const,
  siteBaseUrl: "https://cms.relayops.example",
  authenticatedUserId: 7,
  postType: "post",
  authorAllowlist: [7],
  statusAllowlist: ["draft"] as const,
  capabilities: ["edit_posts"],
};

const authorizationSnapshot = {
  authorizationId: ids.authorization,
  actorId: ids.actor,
  grantedAt: now,
  expiresAt,
  scopes: [
    "metadata_read",
    "contents_read",
    "contents_write",
    "pull_requests_write",
  ],
  destinationRef: ids.destination,
  destinationRevision: 1,
  purpose: "connector_configuration",
  customerAcknowledgement: {
    customerAcknowledgementId: ids.acknowledgement,
    actorId: ids.actor,
    acknowledgedAt: now,
    acknowledgementScope: "connector_configuration",
  },
};

function destinationRow(
  overrides: Partial<PublicationDestinationRow> = {},
): PublicationDestinationRow {
  return {
    id: ids.destinationRow,
    destination_ref: ids.destination,
    revision: 1,
    supersedes_id: null,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    provider_kind: "github",
    target_ref: "/blog/customer-onboarding/",
    state: "ready",
    authorization_grant_id: ids.grant,
    provider_scope: githubDestinationScope,
    provider_scope_hash: "a".repeat(64),
    authorization_snapshot: authorizationSnapshot,
    authorization_snapshot_hash: "b".repeat(64),
    readiness_observation: {
      observedAt: now,
      probe: "github_installation_permissions",
      status: "passed",
      providerRequestId: "safe-request-id",
      accessToken: "must-never-leave-persistence",
      rawProviderBody: { secret: true },
    },
    limitation: null,
    created_by: ids.actor,
    created_at: now,
    ...overrides,
  };
}

function grantRow(
  overrides: Partial<DeliveryAuthorizationGrantRow> = {},
): DeliveryAuthorizationGrantRow {
  return {
    id: ids.grant,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    provider_kind: "github",
    purpose: "connector_configuration",
    state: "ready",
    destination_ref: ids.destination,
    destination_revision: 1,
    target_ref: "/blog/customer-onboarding/",
    requested_scope: githubDestinationScope,
    requested_scope_hash: "c".repeat(64),
    authorization_snapshot: authorizationSnapshot,
    authorization_snapshot_hash: "d".repeat(64),
    encrypted_payload: null,
    cipher_version: null,
    key_version: null,
    secret_metadata: {
      grantProviderScope: githubGrantScope,
      destinationScope: githubDestinationScope,
      readinessObservation: {
        observedAt: now,
        probe: "github_installation_permissions",
        status: "passed",
        providerRequestId: "safe-request-id",
      },
    },
    expires_at: expiresAt,
    consumed_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    created_by: ids.actor,
    created_at: now,
    ...overrides,
  };
}

function idempotencyRow(
  overrides: Partial<IdempotencyRow> = {},
): IdempotencyRow {
  return {
    id: ids.idempotency,
    workspace_id: ids.workspace,
    scope: "delivery_connection",
    idempotency_key: "idem-1",
    request_hash: "e".repeat(64),
    status: "in_progress",
    response_status: null,
    response_body: null,
    resource_type: null,
    resource_id: null,
    expires_at: "2026-07-28T10:00:00.000Z",
    ...overrides,
  };
}

interface FakeRepositories {
  projects: {
    findById: ReturnType<typeof vi.fn>;
    findByIdForUpdate: ReturnType<typeof vi.fn>;
  };
  sites: {
    findById: ReturnType<typeof vi.fn>;
  };
  connections: {
    listHeads: ReturnType<typeof vi.fn>;
    listRevisions: ReturnType<typeof vi.fn>;
    findLatest: ReturnType<typeof vi.fn>;
    appendRevision: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  grants: {
    create: ReturnType<typeof vi.fn>;
    readCurrent: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  idempotency: {
    find: ReturnType<typeof vi.fn>;
    begin: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
}

function createRepositories(): FakeRepositories {
  return {
    projects: {
      findById: vi.fn().mockResolvedValue(project),
      findByIdForUpdate: vi.fn().mockResolvedValue(project),
    },
    sites: {
      findById: vi.fn().mockResolvedValue(site),
    },
    connections: {
      listHeads: vi.fn().mockResolvedValue([destinationRow()]),
      listRevisions: vi.fn().mockResolvedValue([destinationRow()]),
      findLatest: vi.fn().mockResolvedValue(null),
      appendRevision: vi.fn().mockResolvedValue(destinationRow()),
      revoke: vi.fn().mockResolvedValue(
        destinationRow({
          id: "10000000-0000-4000-8000-000000000011",
          revision: 2,
          supersedes_id: ids.destinationRow,
          state: "revoked",
          readiness_observation: {
            revokedBy: ids.actor,
            revokedAt: now,
          },
          limitation: "Customer revoked delivery access.",
        }),
      ),
    },
    grants: {
      create: vi.fn().mockResolvedValue(grantRow()),
      readCurrent: vi.fn().mockResolvedValue(grantRow()),
      revoke: vi.fn().mockResolvedValue(
        grantRow({
          state: "revoked",
          revoked_at: now,
          revoked_by: ids.actor,
          revocation_reason: "Customer revoked the one-time grant.",
        }),
      ),
    },
    idempotency: {
      find: vi.fn().mockResolvedValue(null),
      begin: vi.fn().mockResolvedValue(idempotencyRow()),
      complete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createPersistence(repositories: FakeRepositories) {
  return {
    read: vi.fn(async (operation: (repos: FakeRepositories) => unknown) =>
      operation(repositories),
    ),
    transaction: vi.fn(
      async (operation: (repos: FakeRepositories) => unknown) =>
        operation(repositories),
    ),
  } as unknown as DeliveryConnectionPersistence;
}

function runtime(
  repositories = createRepositories(),
  overrides: Record<string, unknown> = {},
): DeliveryConnectionServiceRuntime {
  return {
    persistence: createPersistence(repositories),
    now: () => new Date(now),
    randomUuid: vi
      .fn()
      .mockReturnValueOnce(ids.acknowledgement)
      .mockReturnValueOnce(ids.authorization),
    grantTtlMs: 10 * 60 * 1000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("customer-readable delivery connection reads", () => {
  it("lists only project-scoped heads and allowlists readiness facts", async () => {
    const repositories = createRepositories();

    const result = await listDeliveryConnections(
      scope,
      ids.project,
      runtime(repositories),
    );

    expect(repositories.projects.findById).toHaveBeenCalledWith(
      scope,
      ids.project,
    );
    expect(repositories.connections.listHeads).toHaveBeenCalledWith(
      projectScope,
      100,
    );
    expect(result).toEqual([
      expect.objectContaining({
        destinationRef: ids.destination,
        state: "ready",
        readinessObservation: {
          observedAt: now,
          probe: "github_installation_permissions",
          status: "passed",
          providerRequestId: "safe-request-id",
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("accessToken");
    expect(JSON.stringify(result)).not.toContain("rawProviderBody");
    expect(JSON.stringify(result)).not.toContain(ids.grant);
  });

  it("returns current + bounded history and never probes a foreign project", async () => {
    const repositories = createRepositories();
    repositories.projects.findById.mockResolvedValueOnce(null);

    await expect(
      getDeliveryConnection(
        scope,
        ids.project,
        ids.destination,
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(repositories.connections.listRevisions).not.toHaveBeenCalled();
  });

  it("reports archived projects explicitly instead of disguising them as unconfigured", async () => {
    const repositories = createRepositories();
    repositories.projects.findById.mockResolvedValue({
      ...project,
      archived_at: now,
    });

    await expect(
      listDeliveryConnections(scope, ids.project, runtime(repositories)),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
    await expect(
      getDeliveryConnection(
        scope,
        ids.project,
        ids.destination,
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });

    expect(repositories.connections.listHeads).not.toHaveBeenCalled();
    expect(repositories.connections.listRevisions).not.toHaveBeenCalled();
  });

  it("rejects a persisted unavailable destination without an honest limitation", async () => {
    const repositories = createRepositories();
    repositories.connections.listHeads.mockResolvedValueOnce([
      destinationRow({ state: "unavailable", limitation: null }),
    ]);

    await expect(
      listDeliveryConnections(scope, ids.project, runtime(repositories)),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("reports absent provider issuers as honestly unavailable", () => {
    expect(getDeliveryConnectorReadiness()).toEqual({
      github: {
        providerKind: "github",
        state: "unavailable",
        limitation:
          "GitHub App credential issuance is not configured on this server.",
      },
      wordpress: {
        providerKind: "wordpress",
        state: "unavailable",
        limitation:
          "WordPress credential encryption is not configured on this server.",
      },
    });
  });

  it("does not expose connector deployment readiness for a foreign project", async () => {
    const repositories = createRepositories();
    repositories.projects.findById.mockResolvedValueOnce(null);

    await expect(
      getProjectDeliveryConnectorReadiness(
        scope,
        ids.project,
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not report connector readiness as available for an archived project", async () => {
    const repositories = createRepositories();
    repositories.projects.findById.mockResolvedValueOnce({
      ...project,
      archived_at: now,
    });

    await expect(
      getProjectDeliveryConnectorReadiness(
        scope,
        ids.project,
        runtime(repositories, {
          githubIssuer: {
            fingerprint: vi.fn(),
            authorize: vi.fn(),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
  });
});

describe("server-owned connector authorization grants", () => {
  const acknowledgementInput = {
    acknowledged: true as const,
    acknowledgementScope: "connector_configuration" as const,
  };

  const githubRequest = {
    purpose: "connector_configuration" as const,
    siteId: ids.site,
    destinationRef: ids.destination,
    destinationRevision: 1,
    targetRef: "/blog/customer-onboarding/",
    callback: {
      providerKind: "github" as const,
      installationId: 201,
      setupAction: "install" as const,
      callbackState: "opaque-callback-state-never-persisted",
    },
    probeIntent: {
      providerKind: "github" as const,
      installationId: 201,
      requestedScope: githubSelection,
    },
    customerAcknowledgementInput: acknowledgementInput,
  };

  it("fails closed before persistence when the GitHub issuer is absent", async () => {
    const repositories = createRepositories();

    await expect(
      authorizeGitHubDeliveryConnection(
        scope,
        ids.project,
        ids.actor,
        "github-idem-1",
        githubRequest,
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });

    expect(repositories.grants.create).not.toHaveBeenCalled();
  });

  it("persists only resolved GitHub installation/permission lineage and returns a redacted short grant", async () => {
    const repositories = createRepositories();
    const githubIssuer = {
      fingerprint: vi.fn().mockResolvedValue("f".repeat(64)),
      authorize: vi.fn().mockResolvedValue({
        requestFingerprint: "f".repeat(64),
        grantProviderScope: githubGrantScope,
        destinationScope: githubDestinationScope,
        readinessObservation: {
          observedAt: now,
          probe: "github_installation_permissions",
          status: "passed",
          providerRequestId: "safe-request-id",
        },
      }),
    };

    const result = await authorizeGitHubDeliveryConnection(
      scope,
      ids.project,
      ids.actor,
      "github-idem-1",
      githubRequest,
      runtime(repositories, { githubIssuer }),
    );

    expect(githubIssuer.authorize).toHaveBeenCalledWith({
      projectId: ids.project,
      siteId: ids.site,
      callback: githubRequest.callback,
      probeIntent: githubRequest.probeIntent,
    });
    expect(repositories.grants.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...projectScope,
        siteId: ids.site,
        providerKind: "github",
        purpose: "connector_configuration",
        destinationRef: ids.destination,
        destinationRevision: 1,
        targetRef: githubRequest.targetRef,
        requestedScope: githubDestinationScope,
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        expiresAt,
        createdBy: ids.actor,
        authorizationSnapshot: expect.objectContaining({
          actorId: ids.actor,
          grantedAt: now,
          expiresAt,
          destinationRef: ids.destination,
          destinationRevision: 1,
        }),
      }),
    );
    const persisted = repositories.grants.create.mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain(
      githubRequest.callback.callbackState,
    );
    expect(JSON.stringify(persisted)).not.toContain("token");
    expect(result).toMatchObject({
      status: 201,
      replayed: false,
      grant: {
        authorizationGrantRef: ids.grant,
        createdBy: ids.actor,
        expiresAt,
        providerScope: githubGrantScope,
      },
    });
    expect(JSON.stringify(result)).not.toContain(
      githubRequest.callback.callbackState,
    );
    expect(JSON.stringify(result)).not.toContain("authorizationSnapshot");
  });

  it("replays a completed grant before mutable destination checks or another provider probe", async () => {
    const repositories = createRepositories();
    const githubIssuer = {
      fingerprint: vi.fn().mockResolvedValue("f".repeat(64)),
      authorize: vi.fn().mockResolvedValue({
        requestFingerprint: "f".repeat(64),
        grantProviderScope: githubGrantScope,
        destinationScope: githubDestinationScope,
        readinessObservation: {
          observedAt: now,
          probe: "github_installation_permissions",
          status: "passed",
          providerRequestId: "safe-request-id",
        },
      }),
    };
    const serviceRuntime = runtime(repositories, { githubIssuer });
    const first = await authorizeGitHubDeliveryConnection(
      scope,
      ids.project,
      ids.actor,
      "github-idem-replay",
      githubRequest,
      serviceRuntime,
    );
    const requestHash =
      repositories.idempotency.begin.mock.calls[0]?.[0]?.requestHash;
    repositories.idempotency.find.mockResolvedValue(
      idempotencyRow({
        scope: "deliveryConnection.githubGrant",
        idempotency_key: "github-idem-replay",
        request_hash: requestHash,
        status: "completed",
        response_status: 201,
        response_body: first,
        resource_type: "delivery_authorization_grant",
        resource_id: ids.grant,
      }),
    );
    repositories.connections.findLatest.mockResolvedValue(
      destinationRow({ revision: 1 }),
    );

    const replayed = await authorizeGitHubDeliveryConnection(
      scope,
      ids.project,
      ids.actor,
      "github-idem-replay",
      githubRequest,
      serviceRuntime,
    );

    expect(replayed).toEqual({ ...first, replayed: true });
    await expect(
      authorizeGitHubDeliveryConnection(
        scope,
        ids.project,
        ids.actorB,
        "github-idem-replay",
        githubRequest,
        serviceRuntime,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(githubIssuer.authorize).toHaveBeenCalledTimes(1);
    expect(repositories.grants.create).toHaveBeenCalledTimes(1);
    expect(repositories.connections.findLatest).toHaveBeenCalledTimes(2);
  });

  it("accepts WordPress plaintext only at the injected encrypt+probe seam and persists ciphertext", async () => {
    const repositories = createRepositories();
    repositories.grants.create.mockResolvedValueOnce(
      grantRow({
        provider_kind: "wordpress",
        requested_scope: wordpressDestinationScope,
        encrypted_payload: Buffer.alloc(64, 7),
        cipher_version: 1,
        key_version: "kms-v1",
        secret_metadata: {
          grantProviderScope: wordpressDestinationScope,
          destinationScope: wordpressDestinationScope,
          readinessObservation: {
            observedAt: now,
            probe: "wordpress_capabilities",
            status: "passed",
            providerRequestId: null,
          },
          encryptionAlgorithm: "AES-256-GCM",
        },
      }),
    );
    const wordpressIssuer = {
      fingerprint: vi.fn().mockResolvedValue("1".repeat(64)),
      authorizeAndEncrypt: vi.fn().mockResolvedValue({
        requestFingerprint: "1".repeat(64),
        grantProviderScope: wordpressDestinationScope,
        destinationScope: wordpressDestinationScope,
        readinessObservation: {
          observedAt: now,
          probe: "wordpress_capabilities",
          status: "passed",
          providerRequestId: null,
        },
        encryptedPayload: Buffer.alloc(64, 7),
        cipherVersion: 1,
        keyVersion: "kms-v1",
        encryptionAlgorithm: "AES-256-GCM",
      }),
    };
    const credentialInput = {
      username: "editor@example.com",
      applicationPassword: "abcd efgh ijkl mnop",
    };
    const request = {
      purpose: "connector_configuration" as const,
      siteId: ids.site,
      destinationRef: ids.destination,
      destinationRevision: 1,
      targetRef: "/blog/customer-onboarding/",
      requestedScope: {
        siteBaseUrl: "https://cms.relayops.example",
        providerKind: "wordpress" as const,
        postType: wordpressSelection.postType,
        authorAllowlist: [...wordpressSelection.authorAllowlist],
        statusAllowlist: [...wordpressSelection.statusAllowlist],
      },
      credentialInput,
      customerAcknowledgementInput: acknowledgementInput,
    };

    const result = await authorizeWordPressDeliveryConnection(
      scope,
      ids.project,
      ids.actor,
      "wordpress-idem-1",
      request,
      runtime(repositories, { wordpressIssuer }),
    );

    expect(wordpressIssuer.authorizeAndEncrypt).toHaveBeenCalledWith({
      projectId: ids.project,
      siteId: ids.site,
      requestedScope: request.requestedScope,
      credentialInput,
    });
    const persisted = repositories.grants.create.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      providerKind: "wordpress",
      encryptedPayload: Buffer.alloc(64, 7),
      cipherVersion: 1,
      keyVersion: "kms-v1",
    });
    expect(JSON.stringify(persisted)).not.toContain(credentialInput.username);
    expect(JSON.stringify(persisted)).not.toContain(
      credentialInput.applicationPassword,
    );
    expect(JSON.stringify(result)).not.toContain(credentialInput.username);
    expect(JSON.stringify(result)).not.toContain(
      credentialInput.applicationPassword,
    );

    const requestHash =
      repositories.idempotency.begin.mock.calls[0]?.[0]?.requestHash;
    repositories.idempotency.find.mockResolvedValue(
      idempotencyRow({
        scope: "deliveryConnection.wordpressGrant",
        idempotency_key: "wordpress-idem-1",
        request_hash: requestHash,
        status: "completed",
        response_status: 201,
        response_body: result,
        resource_type: "delivery_authorization_grant",
        resource_id: ids.grant,
      }),
    );
    await expect(
      authorizeWordPressDeliveryConnection(
        scope,
        ids.project,
        ids.actorB,
        "wordpress-idem-1",
        request,
        runtime(repositories, { wordpressIssuer }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(wordpressIssuer.authorizeAndEncrypt).toHaveBeenCalledTimes(1);
  });

  it("rejects provider-resolved scope drift before a grant write", async () => {
    const repositories = createRepositories();
    const githubIssuer = {
      fingerprint: vi.fn().mockResolvedValue("f".repeat(64)),
      authorize: vi.fn().mockResolvedValue({
        requestFingerprint: "f".repeat(64),
        grantProviderScope: {
          ...githubGrantScope,
          repositoryId: 999,
        },
        destinationScope: {
          ...githubDestinationScope,
          repositoryId: 999,
        },
        readinessObservation: {
          observedAt: now,
          probe: "github_installation_permissions",
          status: "passed",
          providerRequestId: null,
        },
      }),
    };

    await expect(
      authorizeGitHubDeliveryConnection(
        scope,
        ids.project,
        ids.actor,
        "github-idem-1",
        githubRequest,
        runtime(repositories, { githubIssuer }),
      ),
    ).rejects.toBeInstanceOf(ProblemError);
    expect(repositories.grants.create).not.toHaveBeenCalled();
  });
});

describe("append-only connection mutations", () => {
  it("consumes only an exact current grant and appends a server-resolved ready revision", async () => {
    const repositories = createRepositories();
    const request = {
      siteId: ids.site,
      destinationRef: ids.destination,
      baseRevision: 0,
      targetRef: "/blog/customer-onboarding/",
      providerKind: "github" as const,
      requestedScope: githubSelection,
      authorizationGrantRef: ids.grant,
    };

    const result = await appendDeliveryConnectionRevision(
      scope,
      ids.project,
      ids.actor,
      "append-idem-1",
      request,
      runtime(repositories),
    );

    expect(repositories.grants.readCurrent).toHaveBeenCalledWith(
      projectScope,
      ids.grant,
      new Date(now),
    );
    expect(repositories.connections.appendRevision).toHaveBeenCalledWith({
      ...projectScope,
      siteId: ids.site,
      destinationRef: ids.destination,
      baseRevision: 0,
      targetRef: request.targetRef,
      providerKind: "github",
      authorizationGrantId: ids.grant,
      providerScope: githubDestinationScope,
      readinessObservation: {
        observedAt: now,
        probe: "github_installation_permissions",
        status: "passed",
        providerRequestId: "safe-request-id",
      },
      state: "ready",
      limitation: null,
      createdBy: ids.actor,
      authorizationCheckedAt: new Date(now),
    });
    expect(result).toMatchObject({
      status: 201,
      replayed: false,
      destination: {
        destinationRef: ids.destination,
        revision: 1,
        state: "ready",
      },
    });

    const requestHash =
      repositories.idempotency.begin.mock.calls[0]?.[0]?.requestHash;
    repositories.idempotency.begin.mockResolvedValue(null);
    repositories.idempotency.find.mockResolvedValue(
      idempotencyRow({
        scope: "deliveryConnection.appendRevision",
        idempotency_key: "append-idem-1",
        request_hash: requestHash,
        status: "completed",
        response_status: 201,
        response_body: result,
        resource_type: "delivery_connection",
        resource_id: ids.destinationRow,
      }),
    );
    await expect(
      appendDeliveryConnectionRevision(
        scope,
        ids.project,
        ids.actorB,
        "append-idem-1",
        request,
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(repositories.connections.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing/stale grant without appending a destination", async () => {
    const repositories = createRepositories();
    repositories.grants.readCurrent.mockResolvedValueOnce(null);

    await expect(
      appendDeliveryConnectionRevision(
        scope,
        ids.project,
        ids.actor,
        "append-idem-1",
        {
          siteId: ids.site,
          destinationRef: ids.destination,
          baseRevision: 0,
          targetRef: "/blog/customer-onboarding/",
          providerKind: "github",
          requestedScope: githubSelection,
          authorizationGrantRef: ids.grant,
        },
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });

    expect(repositories.connections.appendRevision).not.toHaveBeenCalled();
  });

  it("appends revocation with the authenticated actor and exact base revision", async () => {
    const repositories = createRepositories();
    const result = await revokeDeliveryConnection(
      scope,
      ids.project,
      ids.actor,
      ids.destination,
      "revoke-idem-1",
      {
        baseRevision: 1,
        reason: "Customer revoked delivery access.",
      },
      runtime(repositories),
    );

    expect(repositories.connections.revoke).toHaveBeenCalledWith({
      ...projectScope,
      destinationRef: ids.destination,
      baseRevision: 1,
      actorId: ids.actor,
      reason: "Customer revoked delivery access.",
    });
    expect(result.destination).toMatchObject({
      revision: 2,
      state: "revoked",
      limitation: "Customer revoked delivery access.",
    });

    const requestHash =
      repositories.idempotency.begin.mock.calls[0]?.[0]?.requestHash;
    repositories.idempotency.begin.mockResolvedValue(null);
    repositories.idempotency.find.mockResolvedValue(
      idempotencyRow({
        scope: "deliveryConnection.revoke",
        idempotency_key: "revoke-idem-1",
        request_hash: requestHash,
        status: "completed",
        response_status: 201,
        response_body: result,
        resource_type: "delivery_connection",
        resource_id: ids.destinationRow,
      }),
    );
    await expect(
      revokeDeliveryConnection(
        scope,
        ids.project,
        ids.actorB,
        ids.destination,
        "revoke-idem-1",
        {
          baseRevision: 1,
          reason: "Customer revoked delivery access.",
        },
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(repositories.connections.revoke).toHaveBeenCalledTimes(1);
  });

  it("revokes a one-time grant without accepting client actor/time facts", async () => {
    const repositories = createRepositories();

    const result = await revokeDeliveryAuthorizationGrant(
      scope,
      ids.project,
      ids.actor,
      "grant-revoke-idem-1",
      {
        authorizationGrantRef: ids.grant,
        reason: "Customer revoked the one-time grant.",
      },
      runtime(repositories),
    );

    expect(repositories.grants.revoke).toHaveBeenCalledWith({
      ...projectScope,
      grantId: ids.grant,
      actorId: ids.actor,
      reason: "Customer revoked the one-time grant.",
    });
    expect(result).toEqual({
      status: 200,
      replayed: false,
      grant: {
        authorizationGrantRef: ids.grant,
        providerKind: "github",
        purpose: "connector_configuration",
        state: "revoked",
        consumedAt: null,
        revokedAt: now,
        revokedBy: ids.actor,
        revocationReason: "Customer revoked the one-time grant.",
      },
    });

    const requestHash =
      repositories.idempotency.begin.mock.calls[0]?.[0]?.requestHash;
    repositories.idempotency.begin.mockResolvedValue(null);
    repositories.idempotency.find.mockResolvedValue(
      idempotencyRow({
        scope: "deliveryConnection.revokeGrant",
        idempotency_key: "grant-revoke-idem-1",
        request_hash: requestHash,
        status: "completed",
        response_status: 200,
        response_body: result,
        resource_type: "delivery_authorization_grant",
        resource_id: ids.grant,
      }),
    );
    await expect(
      revokeDeliveryAuthorizationGrant(
        scope,
        ids.project,
        ids.actorB,
        "grant-revoke-idem-1",
        {
          authorizationGrantRef: ids.grant,
          reason: "Customer revoked the one-time grant.",
        },
        runtime(repositories),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(repositories.grants.revoke).toHaveBeenCalledTimes(1);
  });
});
