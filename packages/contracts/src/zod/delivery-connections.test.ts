import { describe, expect, it } from "vitest";
import {
  AppendPublicationDestinationRevisionRequest,
  ConnectGitHubDeliveryAuthorizationGrantRequest,
  ConnectWordPressDeliveryAuthorizationGrantRequest,
  ConsumeDeliveryAuthorizationGrantResponse,
  DeliveryAuthorizationGrant,
  DeliveryAuthorizationGrantProviderScope,
  DeliveryAuthorizationGrantPurpose,
  DeliveryAuthorizationGrantState,
  GitHubPublicationDestinationScope,
  GitHubPublicationDestinationSelection,
  GitHubAuthorizationProbeIntent,
  GitHubInstallationCallbackRequest,
  IssuePublicationAuthorizationGrantRequest,
  PublicationAuthorizationSnapshot,
  PublicationDestination,
  PublicationDestinationScope,
  PublicationDestinationSelection,
  RevokeDeliveryAuthorizationGrantRequest,
  RevokeDeliveryAuthorizationGrantResponse,
  RevokePublicationDestinationRequest,
  WordPressOneTimeCredentialInput,
  WordPressPublicationDestinationScope,
  WordPressPublicationDestinationSelection,
} from "./delivery-connections.ts";

const ids = {
  acknowledgement: "00000000-0000-4000-8000-000000000101",
  actor: "00000000-0000-4000-8000-000000000102",
  authorization: "00000000-0000-4000-8000-000000000103",
  destination: "00000000-0000-4000-8000-000000000104",
  destinationRow: "00000000-0000-4000-8000-000000000105",
  grant: "00000000-0000-4000-8000-000000000106",
  site: "00000000-0000-4000-8000-000000000107",
  sourceAttempt: "00000000-0000-4000-8000-000000000108",
  sourceReceipt: "00000000-0000-4000-8000-000000000109",
};

const githubSelection = {
  providerKind: "github" as const,
  repositoryId: 101,
  baseBranch: "main",
  branchPrefix: "gengrowth/",
  contentPath: "content/blog/customer-onboarding.md",
};
const wordpressSelection = {
  providerKind: "wordpress" as const,
  postType: "post",
  authorAllowlist: [7],
  statusAllowlist: ["draft", "future"] as const,
};

describe("closed publication destination unions", () => {
  it("accepts strict GitHub and WordPress selections", () => {
    expect(
      GitHubPublicationDestinationSelection.parse(githubSelection),
    ).toEqual(githubSelection);
    expect(
      WordPressPublicationDestinationSelection.parse(wordpressSelection),
    ).toEqual(wordpressSelection);
    expect(PublicationDestinationSelection.parse(githubSelection)).toEqual(
      githubSelection,
    );
    expect(PublicationDestinationSelection.parse(wordpressSelection)).toEqual(
      wordpressSelection,
    );
  });

  it("rejects mixed-provider and unknown selection fields", () => {
    expect(
      PublicationDestinationSelection.safeParse({
        ...githubSelection,
        postType: "post",
      }).success,
    ).toBe(false);
    expect(
      PublicationDestinationSelection.safeParse({
        ...wordpressSelection,
        repositoryId: 101,
      }).success,
    ).toBe(false);
    expect(
      PublicationDestinationSelection.safeParse({
        ...githubSelection,
        providerKind: "ftp",
      }).success,
    ).toBe(false);
  });

  it("accepts strict server-resolved scopes and rejects provider leakage", () => {
    const github = {
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
    const wordpress = {
      providerKind: "wordpress" as const,
      siteBaseUrl: "https://example.com",
      authenticatedUserId: 7,
      postType: "post",
      authorAllowlist: [7],
      statusAllowlist: ["draft", "future"] as const,
      capabilities: ["edit_posts", "publish_posts"],
    };

    expect(GitHubPublicationDestinationScope.parse(github)).toEqual(github);
    expect(WordPressPublicationDestinationScope.parse(wordpress)).toEqual(
      wordpress,
    );
    expect(PublicationDestinationScope.parse(github)).toEqual(github);
    expect(PublicationDestinationScope.parse(wordpress)).toEqual(wordpress);
    expect(
      GitHubPublicationDestinationScope.safeParse({
        ...github,
        grantedPermissions: [
          "metadata_read",
          "contents_read",
          "contents_write",
        ],
      }).success,
    ).toBe(false);
    expect(
      PublicationDestinationScope.safeParse({
        ...wordpress,
        encryptedSecretRef: "vault://publication/wordpress/example",
      }).success,
    ).toBe(false);
    expect(
      WordPressPublicationDestinationScope.safeParse({
        ...wordpress,
        siteBaseUrl: "https://user:password@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("delivery authorization grant lifecycle", () => {
  const canonicalGitHubPermissions = [
    "metadata_read",
    "contents_read",
    "contents_write",
    "pull_requests_write",
  ] as const;
  const githubProviderScope = {
    providerKind: "github" as const,
    installationId: 201,
    githubAccountId: 301,
    repositoryId: 101,
    repositoryOwner: "gengrowth",
    repositoryName: "website",
    baseBranch: "main",
    branchPrefix: "gengrowth/",
    contentPath: "content/blog/customer-onboarding.md",
    grantedPermissions: canonicalGitHubPermissions,
  };
  const wordpressProviderScope = {
    providerKind: "wordpress" as const,
    siteBaseUrl: "https://example.com",
    authenticatedUserId: 7,
    postType: "post",
    authorAllowlist: [7],
    statusAllowlist: ["draft", "future"] as const,
    capabilities: ["edit_posts", "publish_posts"],
  };
  const acknowledgementInput = {
    acknowledged: true as const,
    acknowledgementScope: "connector_configuration" as const,
  };
  const readyGrant = {
    authorizationGrantRef: ids.grant,
    siteId: ids.site,
    providerKind: "github" as const,
    purpose: "connector_configuration" as const,
    state: "ready" as const,
    providerScope: githubProviderScope,
    destinationRef: ids.destination,
    destinationRevision: 1,
    targetRef: "/blog/customer-onboarding/",
    expiresAt: "2026-07-27T10:00:00Z",
    consumedAt: null,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    createdBy: ids.actor,
    createdAt: "2026-07-27T09:00:00Z",
  };

  it("uses the canonical purpose and one-time lifecycle states", () => {
    for (const purpose of [
      "connector_configuration",
      "publish",
      "rollback",
    ]) {
      expect(DeliveryAuthorizationGrantPurpose.parse(purpose)).toBe(purpose);
    }
    for (const state of ["ready", "consumed", "revoked", "expired"]) {
      expect(DeliveryAuthorizationGrantState.parse(state)).toBe(state);
    }
    expect(
      DeliveryAuthorizationGrantState.safeParse("pending").success,
    ).toBe(false);
    expect(
      DeliveryAuthorizationGrantState.safeParse("unavailable").success,
    ).toBe(false);
  });

  it("exposes closed, redacted provider scopes with canonical GitHub permissions", () => {
    expect(
      DeliveryAuthorizationGrantProviderScope.parse(githubProviderScope),
    ).toEqual(githubProviderScope);
    expect(
      DeliveryAuthorizationGrantProviderScope.parse(wordpressProviderScope),
    ).toEqual(wordpressProviderScope);
    expect(
      DeliveryAuthorizationGrantProviderScope.safeParse({
        ...githubProviderScope,
        grantedPermissions: canonicalGitHubPermissions.slice(0, 3),
      }).success,
    ).toBe(false);
    expect(
      DeliveryAuthorizationGrantProviderScope.safeParse({
        ...wordpressProviderScope,
        encryptedPayload: "ciphertext",
      }).success,
    ).toBe(false);
  });

  it("accepts GitHub callback and probe intent without accepting probe facts", () => {
    const callback = {
      providerKind: "github" as const,
      installationId: 201,
      setupAction: "install" as const,
      callbackState: "opaque-callback-state",
    };
    const probeIntent = {
      providerKind: "github" as const,
      installationId: 201,
      requestedScope: githubSelection,
    };
    const request = {
      purpose: "connector_configuration" as const,
      siteId: ids.site,
      destinationRef: ids.destination,
      destinationRevision: 1,
      targetRef: "/blog/customer-onboarding/",
      callback,
      probeIntent,
      customerAcknowledgementInput: acknowledgementInput,
    };

    expect(GitHubInstallationCallbackRequest.parse(callback)).toEqual(
      callback,
    );
    expect(GitHubAuthorizationProbeIntent.parse(probeIntent)).toEqual(
      probeIntent,
    );
    expect(
      ConnectGitHubDeliveryAuthorizationGrantRequest.parse(request),
    ).toEqual(request);
    expect(
      GitHubAuthorizationProbeIntent.safeParse({
        ...probeIntent,
        grantedPermissions: canonicalGitHubPermissions,
      }).success,
    ).toBe(false);
    expect(
      ConnectGitHubDeliveryAuthorizationGrantRequest.safeParse({
        ...request,
        probeIntent: { ...probeIntent, installationId: 202 },
      }).success,
    ).toBe(false);
  });

  it("accepts WordPress credentials only on the dedicated one-time connect request", () => {
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
        providerKind: "wordpress" as const,
        siteBaseUrl: "https://example.com",
        postType: "post",
        authorAllowlist: [7],
        statusAllowlist: ["draft", "future"] as const,
      },
      credentialInput,
      customerAcknowledgementInput: acknowledgementInput,
    };

    expect(WordPressOneTimeCredentialInput.parse(credentialInput)).toEqual(
      credentialInput,
    );
    expect(
      ConnectWordPressDeliveryAuthorizationGrantRequest.parse(request),
    ).toEqual(request);
    expect(
      AppendPublicationDestinationRevisionRequest.safeParse({
        siteId: ids.site,
        destinationRef: ids.destination,
        baseRevision: 0,
        targetRef: "/blog/customer-onboarding/",
        providerKind: "wordpress",
        requestedScope: wordpressSelection,
        authorizationGrantRef: ids.grant,
        credentialInput,
      }).success,
    ).toBe(false);
    expect(
      DeliveryAuthorizationGrant.safeParse({
        ...readyGrant,
        username: credentialInput.username,
        applicationPassword: credentialInput.applicationPassword,
      }).success,
    ).toBe(false);
  });

  it("issues publish and rollback grants only with their exact acknowledgement scopes", () => {
    const common = {
      siteId: ids.site,
      destinationRef: ids.destination,
      expectedDestinationRevision: 1,
      targetRef: "/blog/customer-onboarding/",
    };
    const publish = {
      ...common,
      purpose: "publish" as const,
      approvalEventId: ids.authorization,
      customerAcknowledgementInput: {
        acknowledged: true as const,
        acknowledgementScope:
          "exact_artifact_revision_for_publication" as const,
      },
    };
    const rollback = {
      ...common,
      purpose: "rollback" as const,
      sourcePublicationAttemptId: ids.sourceAttempt,
      sourceChangeReceiptId: ids.sourceReceipt,
      customerAcknowledgementInput: {
        acknowledged: true as const,
        acknowledgementScope: "rollback_preview" as const,
      },
    };

    expect(IssuePublicationAuthorizationGrantRequest.parse(publish)).toEqual(
      publish,
    );
    expect(IssuePublicationAuthorizationGrantRequest.parse(rollback)).toEqual(
      rollback,
    );
    expect(
      IssuePublicationAuthorizationGrantRequest.safeParse({
        ...publish,
        expiresAt: "2026-07-27T10:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationAuthorizationGrantRequest.safeParse({
        ...rollback,
        expiresAt: "2026-07-27T10:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationAuthorizationGrantRequest.safeParse({
        ...publish,
        customerAcknowledgementInput:
          rollback.customerAcknowledgementInput,
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationAuthorizationGrantRequest.safeParse({
        ...rollback,
        customerAcknowledgementInput: publish.customerAcknowledgementInput,
      }).success,
    ).toBe(false);
    expect(
      IssuePublicationAuthorizationGrantRequest.safeParse({
        ...publish,
        credentialInput: {
          username: "editor",
          applicationPassword: "abcd efgh ijkl mnop",
        },
      }).success,
    ).toBe(false);
  });

  it("returns a redacted grant DTO with state-consistent lifecycle facts", () => {
    expect(DeliveryAuthorizationGrant.parse(readyGrant)).toEqual(readyGrant);
    expect(
      DeliveryAuthorizationGrant.parse({
        ...readyGrant,
        expiresAt: null,
      }),
    ).toEqual({
      ...readyGrant,
      expiresAt: null,
    });
    expect(
      DeliveryAuthorizationGrant.parse({
        ...readyGrant,
        state: "consumed",
        consumedAt: "2026-07-27T09:10:00Z",
      }),
    ).toEqual({
      ...readyGrant,
      state: "consumed",
      consumedAt: "2026-07-27T09:10:00Z",
    });
    expect(
      DeliveryAuthorizationGrant.parse({
        ...readyGrant,
        state: "revoked",
        consumedAt: "2026-07-27T09:10:00Z",
        revokedAt: "2026-07-27T09:20:00Z",
        revokedBy: ids.actor,
        revocationReason: "Customer revoked access.",
      }),
    ).toEqual({
      ...readyGrant,
      state: "revoked",
      consumedAt: "2026-07-27T09:10:00Z",
      revokedAt: "2026-07-27T09:20:00Z",
      revokedBy: ids.actor,
      revocationReason: "Customer revoked access.",
    });
    expect(
      DeliveryAuthorizationGrant.parse({
        ...readyGrant,
        state: "expired",
        expiresAt: "2026-07-27T09:30:00Z",
      }),
    ).toEqual({
      ...readyGrant,
      state: "expired",
      expiresAt: "2026-07-27T09:30:00Z",
    });

    for (const invalid of [
      { ...readyGrant, consumedAt: "2026-07-27T09:10:00Z" },
      { ...readyGrant, state: "consumed", consumedAt: null },
      {
        ...readyGrant,
        state: "revoked",
        revokedAt: "2026-07-27T09:20:00Z",
        revokedBy: ids.actor,
        revocationReason: null,
      },
      { ...readyGrant, state: "expired", expiresAt: null },
      {
        ...readyGrant,
        purpose: "publish",
        expiresAt: null,
      },
      {
        ...readyGrant,
        purpose: "rollback",
        expiresAt: null,
      },
      { ...readyGrant, destinationRevision: null },
      {
        ...readyGrant,
        providerKind: "wordpress",
      },
      {
        ...readyGrant,
        encryptedPayload: "ciphertext",
      },
      {
        ...readyGrant,
        authorizationSnapshot: { actorId: ids.actor },
      },
      {
        ...readyGrant,
        authorizationSnapshotHash: "a".repeat(64),
      },
    ]) {
      expect(DeliveryAuthorizationGrant.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("returns strict consume and revoke facts without secret material", () => {
    const consumed = {
      authorizationGrantRef: ids.grant,
      providerKind: "github" as const,
      purpose: "publish" as const,
      state: "consumed" as const,
      destinationRef: ids.destination,
      destinationRevision: 1,
      targetRef: "/blog/customer-onboarding/",
      consumedAt: "2026-07-27T09:10:00Z",
    };
    const revokeRequest = {
      authorizationGrantRef: ids.grant,
      reason: "Customer revoked delivery access.",
    };
    const revoked = {
      authorizationGrantRef: ids.grant,
      providerKind: "github" as const,
      purpose: "publish" as const,
      state: "revoked" as const,
      consumedAt: "2026-07-27T09:10:00Z",
      revokedAt: "2026-07-27T09:20:00Z",
      revokedBy: ids.actor,
      revocationReason: revokeRequest.reason,
    };

    expect(ConsumeDeliveryAuthorizationGrantResponse.parse(consumed)).toEqual(
      consumed,
    );
    expect(RevokeDeliveryAuthorizationGrantRequest.parse(revokeRequest)).toEqual(
      revokeRequest,
    );
    expect(RevokeDeliveryAuthorizationGrantResponse.parse(revoked)).toEqual(
      revoked,
    );
    expect(
      ConsumeDeliveryAuthorizationGrantResponse.safeParse({
        ...consumed,
        encryptedPayload: "ciphertext",
      }).success,
    ).toBe(false);
    expect(
      RevokeDeliveryAuthorizationGrantResponse.safeParse({
        ...revoked,
        applicationPassword: "abcd efgh ijkl mnop",
      }).success,
    ).toBe(false);
  });
});

describe("publication destination client/server contracts", () => {
  it("accepts only a server-issued grant ref and matching requested scope", () => {
    const request = {
      siteId: ids.site,
      destinationRef: ids.destination,
      baseRevision: 0,
      targetRef: "/blog/customer-onboarding/",
      providerKind: "github",
      requestedScope: githubSelection,
      authorizationGrantRef: ids.grant,
    };

    expect(AppendPublicationDestinationRevisionRequest.parse(request)).toEqual(
      request,
    );
    expect(
      AppendPublicationDestinationRevisionRequest.safeParse({
        ...request,
        providerKind: "wordpress",
      }).success,
    ).toBe(false);
    expect(
      AppendPublicationDestinationRevisionRequest.safeParse({
        ...request,
        authorizationSnapshot: { scopes: ["contents_write"] },
      }).success,
    ).toBe(false);
    expect(
      AppendPublicationDestinationRevisionRequest.safeParse({
        ...request,
        capabilityProbe: { contentsWrite: true },
      }).success,
    ).toBe(false);
    for (const [field, value] of [
      ["encryptedSecretRef", "vault://publication/wordpress/example"],
      ["actorId", ids.actor],
      ["reviewerActorId", ids.actor],
      ["contentHash", "a".repeat(64)],
      ["probeFacts", { contentsWrite: true }],
    ] as const) {
      expect(
        AppendPublicationDestinationRevisionRequest.safeParse({
          ...request,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it("binds authorization purpose to acknowledgement scope", () => {
    const authorization = {
      authorizationId: ids.authorization,
      actorId: ids.actor,
      grantedAt: "2026-07-27T09:00:00Z",
      expiresAt: null,
      scopes: ["contents_read", "contents_write"],
      destinationRef: ids.destination,
      destinationRevision: 1,
      purpose: "connector_configuration",
      customerAcknowledgement: {
        customerAcknowledgementId: ids.acknowledgement,
        actorId: ids.actor,
        acknowledgedAt: "2026-07-27T08:59:59Z",
        acknowledgementScope: "connector_configuration",
      },
    };

    expect(PublicationAuthorizationSnapshot.parse(authorization)).toEqual(
      authorization,
    );
    expect(
      PublicationAuthorizationSnapshot.safeParse({
        ...authorization,
        purpose: "rollback",
      }).success,
    ).toBe(false);
    expect(
      PublicationAuthorizationSnapshot.safeParse({
        ...authorization,
        scopes: ["contents_read", "contents_read"],
      }).success,
    ).toBe(false);
  });

  it("returns a strict server destination with provider-consistent scope", () => {
    const authorization = {
      authorizationId: ids.authorization,
      actorId: ids.actor,
      grantedAt: "2026-07-27T09:00:00Z",
      expiresAt: null,
      scopes: ["contents_read", "contents_write"],
      destinationRef: ids.destination,
      destinationRevision: 1,
      purpose: "connector_configuration" as const,
      customerAcknowledgement: {
        customerAcknowledgementId: ids.acknowledgement,
        actorId: ids.actor,
        acknowledgedAt: "2026-07-27T08:59:59Z",
        acknowledgementScope: "connector_configuration" as const,
      },
    };
    const destination = {
      id: ids.destinationRow,
      destinationRef: ids.destination,
      revision: 1,
      siteId: ids.site,
      providerKind: "github" as const,
      targetRef: "/blog/customer-onboarding/",
      state: "ready" as const,
      providerScope: {
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
      },
      authorizationSnapshot: authorization,
      readinessObservation: { permissionProbe: "passed" },
      limitation: null,
      createdAt: "2026-07-27T09:00:01Z",
    };

    expect(PublicationDestination.parse(destination)).toEqual(destination);
    expect(
      PublicationDestination.safeParse({
        ...destination,
        providerKind: "wordpress",
      }).success,
    ).toBe(false);
    expect(
      PublicationDestination.safeParse({
        ...destination,
        authorizationSnapshot: {
          ...authorization,
          destinationRevision: 2,
        },
      }).success,
    ).toBe(false);

    const revoked = {
      ...destination,
      revision: 2,
      state: "revoked" as const,
      authorizationSnapshot: authorization,
      readinessObservation: {
        revokedBy: ids.actor,
        revokedAt: "2026-07-27T09:20:00Z",
      },
      limitation: "Customer revoked delivery access.",
    };
    expect(PublicationDestination.parse(revoked)).toEqual(revoked);
    expect(
      PublicationDestination.safeParse({
        ...revoked,
        authorizationSnapshot: {
          ...authorization,
          destinationRevision: 2,
        },
      }).success,
    ).toBe(false);
    expect(
      PublicationDestination.safeParse({
        ...revoked,
        revision: 1,
      }).success,
    ).toBe(false);
    expect(
      PublicationDestination.safeParse({
        ...revoked,
        limitation: null,
      }).success,
    ).toBe(false);
    const unavailable = {
      ...destination,
      state: "unavailable" as const,
      limitation: "Provider capability probe is unavailable.",
    };
    expect(PublicationDestination.parse(unavailable)).toEqual(unavailable);
    expect(
      PublicationDestination.safeParse({
        ...unavailable,
        limitation: null,
      }).success,
    ).toBe(false);
    expect(
      PublicationDestination.safeParse({
        ...destination,
        secret: "plaintext",
      }).success,
    ).toBe(false);
    expect(
      PublicationDestination.safeParse({
        ...destination,
        providerKind: "wordpress",
        providerScope: {
          providerKind: "wordpress",
          siteBaseUrl: "https://example.com",
          encryptedSecretRef: "vault://publication/wordpress/example",
          authenticatedUserId: 7,
          postType: "post",
          authorAllowlist: [7],
          statusAllowlist: ["draft"],
          capabilities: ["edit_posts"],
        },
      }).success,
    ).toBe(false);
  });

  it("bounds refs, URLs, lists and revocation input", () => {
    expect(
      AppendPublicationDestinationRevisionRequest.safeParse({
        siteId: ids.site,
        destinationRef: ids.destination,
        baseRevision: 0,
        targetRef: "x".repeat(2049),
        providerKind: "github",
        requestedScope: githubSelection,
        authorizationGrantRef: ids.grant,
      }).success,
    ).toBe(false);
    expect(
      WordPressPublicationDestinationSelection.safeParse({
        ...wordpressSelection,
        authorAllowlist: [7, 7],
      }).success,
    ).toBe(false);
    expect(
      RevokePublicationDestinationRequest.parse({
        baseRevision: 1,
        reason: "Customer revoked repository access.",
      }),
    ).toEqual({
      baseRevision: 1,
      reason: "Customer revoked repository access.",
    });
    expect(
      RevokePublicationDestinationRequest.safeParse({
        baseRevision: 1,
        reason: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});
