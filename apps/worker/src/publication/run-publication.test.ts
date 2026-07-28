import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  GitHubDeliveryObservation,
  GitHubPublishingAdapter,
  WordPressDeliveryObservation,
  WordPressPublishingAdapter,
} from "@sf/publishing";
import {
  runPublication,
  type PublicationExecutionAuthority,
  type PublicationExecutionFacts,
  type PublicationProviderRuntime,
} from "./run-publication.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  run: "00000000-0000-4000-8000-000000000003",
  attempt: "00000000-0000-4000-8000-000000000004",
  site: "00000000-0000-4000-8000-000000000005",
  destination: "00000000-0000-4000-8000-000000000006",
  destinationRow: "00000000-0000-4000-8000-000000000007",
  action: "00000000-0000-4000-8000-000000000008",
  artifact: "00000000-0000-4000-8000-000000000009",
  revision: "00000000-0000-4000-8000-00000000000a",
  approval: "00000000-0000-4000-8000-00000000000b",
  grant: "00000000-0000-4000-8000-00000000000c",
  actor: "00000000-0000-4000-8000-00000000000d",
  acknowledgement: "00000000-0000-4000-8000-00000000000e",
  delivery: "00000000-0000-4000-8000-00000000000f",
} as const;

const CONTENT = "# Customer onboarding\n\nApproved English blog.";
const ARTIFACT_HASH = "a".repeat(64);
const CONTENT_CHECKSUM = createHash("sha256")
  .update(CONTENT, "utf8")
  .digest("hex");
const NOW = "2026-07-27T08:00:00.000Z";
const EXPIRES_AT = "2026-07-27T09:00:00.000Z";

function commonFacts(): Omit<PublicationExecutionFacts, "plan"> {
  return {
    schemaVersion: "publication-execution.1",
    run: {
      id: IDS.run,
      attemptCount: 1,
    },
    attempt: {
      id: IDS.attempt,
      attemptKind: "publish",
      runId: IDS.run,
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      siteId: IDS.site,
      destinationId: IDS.destinationRow,
      destinationRef: IDS.destination,
      destinationRevision: 3,
      providerKind: "github",
      targetRef: "https://relayops.example/customer-onboarding/",
      actionId: IDS.action,
      artifactId: IDS.artifact,
      artifactRevisionId: IDS.revision,
      approvedArtifactRevision: 2,
      approvedArtifactContentHash: ARTIFACT_HASH,
      contentChecksum: CONTENT_CHECKSUM,
      approvalEventId: IDS.approval,
      authorizationGrantId: IDS.grant,
      authorizationPurpose: "publish",
      previewChecksum: ARTIFACT_HASH,
      remotePrecondition: {
        kind: "must_not_exist",
        revision: null,
      },
    },
    destination: {
      id: IDS.destinationRow,
      destinationRef: IDS.destination,
      revision: 3,
      siteId: IDS.site,
      providerKind: "github",
      targetRef: "https://relayops.example/customer-onboarding/",
      state: "ready",
    },
    authorization: {
      id: IDS.grant,
      state: "consumed",
      siteId: IDS.site,
      providerKind: "github",
      purpose: "publish",
      destinationRef: IDS.destination,
      destinationRevision: 3,
      targetRef: "https://relayops.example/customer-onboarding/",
      expiresAt: EXPIRES_AT,
      consumedAt: "2026-07-27T07:59:00.000Z",
      snapshot: {
        authorizationId: IDS.grant,
        actorId: IDS.actor,
        grantedAt: "2026-07-27T07:55:00.000Z",
        expiresAt: EXPIRES_AT,
        scopes: [
          "metadata_read",
          "contents_read",
          "contents_write",
          "pull_requests_write",
        ],
        destinationRef: IDS.destination,
        destinationRevision: 3,
        purpose: "publish",
        customerAcknowledgement: {
          customerAcknowledgementId: IDS.acknowledgement,
          actorId: IDS.actor,
          acknowledgementScope:
            "exact_artifact_revision_for_publication",
          acknowledgedAt: "2026-07-27T07:55:00.000Z",
        },
      },
    },
    approval: {
      id: IDS.approval,
      eventKind: "approved",
      artifactId: IDS.artifact,
      artifactRevisionId: IDS.revision,
      artifactRevision: 2,
      artifactContentHash: ARTIFACT_HASH,
    },
    artifact: {
      id: IDS.artifact,
      revisionId: IDS.revision,
      revision: 2,
      contentHash: ARTIFACT_HASH,
      contentText: CONTENT,
    },
  };
}

function githubFacts(): PublicationExecutionFacts {
  return {
    ...commonFacts(),
    plan: {
      providerKind: "github",
      phase: "deliver",
      scope: {
        installationId: 41,
        repositoryId: 99,
        owner: "gengrowth",
        repository: "relayops",
        baseBranch: "main",
        allowedBranchPrefix: "gengrowth/",
        contentPath: "content/customer-onboarding.md",
      },
      branchName: `gengrowth/${IDS.attempt}`,
      path: "content/customer-onboarding.md",
      content: CONTENT,
      commitMessage: "Publish approved customer onboarding artifact",
      pullRequest: {
        title: "Publish customer onboarding",
        body: `Publication attempt ${IDS.attempt}`,
      },
      remotePrecondition: {
        kind: "must_not_exist",
      },
    },
  };
}

function wordpressFacts(explicitPublish: boolean): PublicationExecutionFacts {
  const base = commonFacts();
  return {
    ...base,
    attempt: {
      ...base.attempt,
      providerKind: "wordpress",
    },
    destination: {
      ...base.destination,
      providerKind: "wordpress",
    },
    authorization: {
      ...base.authorization,
      providerKind: "wordpress",
    },
    plan: {
      providerKind: "wordpress",
      phase: "deliver",
      scope: {
        siteOrigin: "https://relayops.example",
        authenticatedUserId: 7,
        allowedAuthorIds: [7],
        allowedStatuses: ["draft", "future"],
        allowedPostTypes: ["posts"],
      },
      postType: "posts",
      title: "Customer onboarding",
      slug: "customer-onboarding",
      content: CONTENT,
      authorId: 7,
      status: "draft",
      canonicalExpectation:
        "https://relayops.example/customer-onboarding/",
      remotePrecondition: {
        kind: "must_not_exist",
      },
      explicitPublish: explicitPublish
        ? {
            expectedCanonicalUrl:
              "https://relayops.example/customer-onboarding/",
          }
        : null,
    },
  };
}

function authority(facts: unknown) {
  const load = vi.fn(async () => facts);
  const recordDelivery = vi.fn(async () => ({
    receiptId: IDS.delivery,
  }));
  const recordChange = vi.fn(async () => undefined);
  const recordUnavailable = vi.fn(async () => undefined);
  return {
    value: {
      load,
      recordDelivery,
      recordChange,
      recordUnavailable,
    } satisfies PublicationExecutionAuthority,
    load,
    recordDelivery,
    recordChange,
    recordUnavailable,
  };
}

function githubDelivery(): GitHubDeliveryObservation {
  return {
    kind: "delivery",
    provider: "github",
    state: "pending",
    observedAt: NOW,
    providerRequestId: "github-request-1",
    contentChecksum: CONTENT_CHECKSUM,
    remoteScopeRef: "github:repository:99:pull:17",
    remote: {
      repositoryId: 99,
      pullRequestNumber: 17,
      pullRequestUrl: "https://github.com/gengrowth/relayops/pull/17",
      headSha: "head-sha",
      baseSha: "base-sha",
      branchName: `gengrowth/${IDS.attempt}`,
      path: "content/customer-onboarding.md",
    },
  };
}

function wordpressDelivery(): WordPressDeliveryObservation {
  return {
    kind: "delivery",
    provider: "wordpress",
    state: "pending",
    observedAt: NOW,
    providerRequestId: "wordpress-request-1",
    contentChecksum: CONTENT_CHECKSUM,
    remoteScopeRef: "wordpress:site:https://relayops.example",
    remote: {
      siteOrigin: "https://relayops.example",
      postId: 81,
      postType: "posts",
      status: "draft",
      revision: '"wp-revision-1"',
      editUrl:
        "https://relayops.example/wp-admin/post.php?post=81&action=edit",
      previewUrl: "https://relayops.example/?p=81&preview=true",
    },
  };
}

describe("runPublication", () => {
  it("creates only a pending GitHub PR delivery and terminalizes without auto-merge", async () => {
    const store = authority(githubFacts());
    const createOrUpdateDelivery = vi.fn(async () => githubDelivery());
    const reconcileMergedChange = vi.fn();
    const issueToken = vi.fn(async () => ({
      installationId: 41,
      value: "obviously-fake-test-token",
      expiresAt: EXPIRES_AT,
    }));
    const runtime: PublicationProviderRuntime = {
      github: {
        issueToken,
        adapter: {
          probeScope: vi.fn(),
          createOrUpdateDelivery,
          reconcileMergedChange,
        } as unknown as GitHubPublishingAdapter,
      },
    };

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        contractVersion: "publication.0.4.0",
      },
      { authority: store.value, runtime, now: () => new Date(NOW) },
    );

    expect(issueToken).toHaveBeenCalledWith({
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      authorizationGrantId: IDS.grant,
      installationId: 41,
      destinationRef: IDS.destination,
      destinationRevision: 3,
    });
    expect(createOrUpdateDelivery).toHaveBeenCalledWith({
      token: expect.objectContaining({ installationId: 41 }),
      scope: githubFacts().plan.scope,
      branchName: `gengrowth/${IDS.attempt}`,
      path: "content/customer-onboarding.md",
      content: CONTENT,
      commitMessage: "Publish approved customer onboarding artifact",
      pullRequest: {
        title: "Publish customer onboarding",
        body: `Publication attempt ${IDS.attempt}`,
      },
      remotePrecondition: { kind: "must_not_exist" },
    });
    expect(reconcileMergedChange).not.toHaveBeenCalled();
    expect(store.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: true,
        receipt: expect.objectContaining({
          receiptKind: "delivery_receipt",
          providerKind: "github",
          remoteObjectKind: "github_pull_request",
          remoteObjectId: "17",
          remoteRevision: "head-sha",
          verificationState: "pending",
          contentChecksum: CONTENT_CHECKSUM,
          artifactContentHash: ARTIFACT_HASH,
          liveCanonicalUrl: null,
        }),
      }),
    );
    expect(store.recordChange).not.toHaveBeenCalled();
    expect(store.recordUnavailable).not.toHaveBeenCalled();
  });

  it("stages WordPress as draft, persists lineage, then explicitly publishes and records only verified live change", async () => {
    const store = authority(wordpressFacts(true));
    const createOrUpdateDelivery = vi.fn(async () => wordpressDelivery());
    const publishAndReconcile = vi.fn(async () => ({
      kind: "change" as const,
      provider: "wordpress" as const,
      state: "verified" as const,
      observedAt: "2026-07-27T08:00:10.000Z",
      predecessorDeliveryReceiptId: IDS.delivery,
      contentChecksum: CONTENT_CHECKSUM,
      remoteScopeRef: "wordpress:site:https://relayops.example",
      providerRequestId: "wordpress-request-2",
      liveCanonicalUrl:
        "https://relayops.example/customer-onboarding/",
      remoteRevision: '"wp-revision-2"',
      evidence: {
        postId: 81,
        status: "publish" as const,
        liveProviderRequestId: "wordpress-live-request-1",
      },
    }));
    const issueCredential = vi.fn(async () => ({
      authorizationValue: "Basic obviously-fake-test-credential",
    }));
    const runtime: PublicationProviderRuntime = {
      wordpress: {
        issueCredential,
        adapter: {
          probeScope: vi.fn(),
          createOrUpdateDelivery,
          publishAndReconcile,
        } as unknown as WordPressPublishingAdapter,
      },
    };

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        contractVersion: "publication.0.4.0",
      },
      { authority: store.value, runtime, now: () => new Date(NOW) },
    );

    expect(createOrUpdateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    );
    expect(store.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: false,
        receipt: expect.objectContaining({
          receiptKind: "delivery_receipt",
          remoteObjectKind: "wordpress_post",
          remoteObjectId: "81",
          verificationState: "pending",
        }),
      }),
    );
    expect(publishAndReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        predecessorDeliveryReceiptId: IDS.delivery,
        delivery: wordpressDelivery(),
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://relayops.example/customer-onboarding/",
        publishAuthorization: {
          authorizationGrantRef: IDS.grant,
          purpose: "publish",
          predecessorDeliveryReceiptId: IDS.delivery,
          contentChecksum: CONTENT_CHECKSUM,
          remoteScopeRef: "wordpress:site:https://relayops.example",
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T07:55:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: EXPIRES_AT,
        },
      }),
    );
    expect(store.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        predecessorDeliveryReceiptId: IDS.delivery,
        receipt: expect.objectContaining({
          receiptKind: "change_receipt",
          verificationState: "verified_live",
          liveCanonicalUrl:
            "https://relayops.example/customer-onboarding/",
          contentChecksum: CONTENT_CHECKSUM,
          artifactContentHash: ARTIFACT_HASH,
          evidenceRefs: [
            "https://relayops.example/customer-onboarding/",
          ],
        }),
      }),
    );
    expect(store.recordUnavailable).not.toHaveBeenCalled();
  });

  it("keeps WordPress draft/future delivery pending when no explicit publish fact was frozen", async () => {
    const store = authority(wordpressFacts(false));
    const createOrUpdateDelivery = vi.fn(async () => wordpressDelivery());
    const publishAndReconcile = vi.fn();
    const runtime: PublicationProviderRuntime = {
      wordpress: {
        issueCredential: vi.fn(async () => ({
          authorizationValue: "Basic obviously-fake-test-credential",
        })),
        adapter: {
          probeScope: vi.fn(),
          createOrUpdateDelivery,
          publishAndReconcile,
        } as unknown as WordPressPublishingAdapter,
      },
    };

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      { authority: store.value, runtime, now: () => new Date(NOW) },
    );

    expect(publishAndReconcile).not.toHaveBeenCalled();
    expect(store.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true }),
    );
    expect(store.recordChange).not.toHaveBeenCalled();
  });

  it("records honest unavailable without any provider call when pinned runtime or credential issuer is absent", async () => {
    const store = authority(githubFacts());

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {},
        now: () => new Date(NOW),
      },
    );

    expect(store.recordDelivery).not.toHaveBeenCalled();
    expect(store.recordChange).not.toHaveBeenCalled();
    expect(store.recordUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PUBLICATION_RUNTIME_UNAVAILABLE",
        limitation:
          "Socket-pinned provider transport or credential issuer is unavailable.",
        predecessorDeliveryReceiptId: null,
      }),
    );
  });

  it("does not let queue latency invalidate a grant that was consumed before its frozen expiry", async () => {
    const facts = githubFacts();
    const delayed: PublicationExecutionFacts = {
      ...facts,
      authorization: {
        ...facts.authorization,
        expiresAt: "2026-07-27T07:59:30.000Z",
        consumedAt: "2026-07-27T07:59:00.000Z",
        snapshot: {
          ...facts.authorization.snapshot,
          expiresAt: "2026-07-27T07:59:30.000Z",
        },
      },
    };
    const store = authority(delayed);
    const createOrUpdateDelivery = vi.fn(async () => githubDelivery());

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {
          github: {
            issueToken: vi.fn(async () => ({
              installationId: 41,
              value: "obviously-fake-test-token",
              expiresAt: "2026-07-27T09:00:00.000Z",
            })),
            adapter: {
              createOrUpdateDelivery,
            } as unknown as GitHubPublishingAdapter,
          },
        },
        now: () => new Date(NOW),
      },
    );

    expect(createOrUpdateDelivery).toHaveBeenCalledTimes(1);
    expect(store.recordDelivery).toHaveBeenCalledTimes(1);
    expect(store.recordUnavailable).not.toHaveBeenCalled();
  });

  it("cancels an accepted run with an explicit archive limitation before any provider access", async () => {
    const store = authority({
      schemaVersion: "publication-execution-unavailable.1",
      code: "PUBLICATION_PROJECT_ARCHIVED",
      limitation:
        "Project was archived after publication acceptance; no provider write was attempted.",
    });
    const createOrUpdateDelivery = vi.fn();

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {
          github: {
            issueToken: vi.fn(),
            adapter: {
              createOrUpdateDelivery,
            } as unknown as GitHubPublishingAdapter,
          },
        },
        now: () => new Date(NOW),
      },
    );

    expect(createOrUpdateDelivery).not.toHaveBeenCalled();
    expect(store.recordDelivery).not.toHaveBeenCalled();
    expect(store.recordChange).not.toHaveBeenCalled();
    expect(store.recordUnavailable).toHaveBeenCalledWith({
      payload: {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      execution: null,
      predecessorDeliveryReceiptId: null,
      code: "PUBLICATION_PROJECT_ARCHIVED",
      limitation:
        "Project was archived after publication acceptance; no provider write was attempted.",
      observedAt: NOW,
    });
  });

  it("fails rollback closed with stable terminal limitation and never calls a publish adapter", async () => {
    const publishFacts = githubFacts();
    const facts: PublicationExecutionFacts = {
      ...publishFacts,
      attempt: {
        ...publishFacts.attempt,
        attemptKind: "rollback",
        authorizationPurpose: "rollback",
      },
      authorization: {
        ...publishFacts.authorization,
        purpose: "rollback",
        snapshot: {
          ...publishFacts.authorization.snapshot,
          purpose: "rollback",
          customerAcknowledgement: {
            ...publishFacts.authorization.snapshot
              .customerAcknowledgement,
            acknowledgementScope: "rollback_preview",
          },
        },
      },
    };
    const store = authority(facts);
    const createOrUpdateDelivery = vi.fn();

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {
          github: {
            issueToken: vi.fn(),
            adapter: {
              createOrUpdateDelivery,
            } as unknown as GitHubPublishingAdapter,
          },
        },
        now: () => new Date(NOW),
      },
    );

    expect(createOrUpdateDelivery).not.toHaveBeenCalled();
    expect(store.recordDelivery).not.toHaveBeenCalled();
    expect(store.recordChange).not.toHaveBeenCalled();
    expect(store.recordUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PUBLICATION_PROVIDER_UNAVAILABLE",
        limitation:
          "The frozen rollback strategy is not executable by the installed provider adapter.",
        predecessorDeliveryReceiptId: null,
      }),
    );
  });

  it("fails closed before provider access when frozen destination, grant, approval, checksum, or plan lineage drifts", async () => {
    const facts = githubFacts();
    const store = authority({
      ...facts,
      artifact: {
        ...facts.artifact,
        contentHash: "b".repeat(64),
      },
    });
    const createOrUpdateDelivery = vi.fn();

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {
          github: {
            issueToken: vi.fn(),
            adapter: {
              createOrUpdateDelivery,
            } as unknown as GitHubPublishingAdapter,
          },
        },
        now: () => new Date(NOW),
      },
    );

    expect(createOrUpdateDelivery).not.toHaveBeenCalled();
    expect(store.recordUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PUBLICATION_FROZEN_FACTS_INVALID",
        predecessorDeliveryReceiptId: null,
      }),
    );
  });

  it("never promotes an adapter observation whose checksum differs from the approved artifact", async () => {
    const store = authority(githubFacts());
    const observation = {
      ...githubDelivery(),
      contentChecksum: "b".repeat(64),
    };

    await runPublication(
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        authority: store.value,
        runtime: {
          github: {
            issueToken: vi.fn(async () => ({
              installationId: 41,
              value: "obviously-fake-test-token",
              expiresAt: EXPIRES_AT,
            })),
            adapter: {
              createOrUpdateDelivery: vi.fn(async () => observation),
            } as unknown as GitHubPublishingAdapter,
          },
        },
        now: () => new Date(NOW),
      },
    );

    expect(store.recordDelivery).not.toHaveBeenCalled();
    expect(store.recordChange).not.toHaveBeenCalled();
    expect(store.recordUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PUBLICATION_CHECKSUM_MISMATCH",
        predecessorDeliveryReceiptId: null,
      }),
    );
  });
});
