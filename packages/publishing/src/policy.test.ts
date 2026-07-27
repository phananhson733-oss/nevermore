import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUBLICATION_POLICY,
  assertReceiptLineage,
  buildGitHubDeliveryPlan,
  buildGitHubRollbackPreview,
  buildWordPressDeliveryPlan,
  buildWordPressRollbackPreview,
} from "./policy";

describe("pure publication policy", () => {
  it("keeps GitHub auto-merge and WordPress direct publish disabled by default", () => {
    expect(DEFAULT_PUBLICATION_POLICY).toEqual({
      githubAutoMerge: false,
      wordpressDirectPublish: false,
    });

    expect(
      buildGitHubDeliveryPlan({
        baseBranch: "main",
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
        expectedBaseSha: "base-123",
        expectedRemoteRevision: { kind: "must_not_exist" },
      }),
    ).toEqual({
      provider: "github",
      mode: "delivery",
      steps: [
        "probe_installation_and_repository",
        "verify_remote_revision",
        "create_or_update_branch",
        "commit_exact_content",
        "create_or_update_pull_request",
      ],
      autoMerge: false,
      mergeMode: "external_human",
    });

    expect(
      buildWordPressDeliveryPlan({
        status: "draft",
        expectedRemoteRevision: { kind: "must_not_exist" },
      }),
    ).toEqual({
      provider: "wordpress",
      mode: "delivery",
      steps: [
        "probe_site_and_capabilities",
        "verify_remote_revision",
        "create_or_update_post",
      ],
      directPublish: false,
      requiresExplicitPublishApproval: true,
    });
  });

  it("rejects direct publish from the delivery plan", () => {
    expect(() =>
      buildWordPressDeliveryPlan({
        status: "publish",
        expectedRemoteRevision: {
          kind: "match",
          revision: '"post-revision-4"',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DIRECT_PUBLISH_FORBIDDEN",
        provider: "wordpress",
      }),
    );
  });

  it("builds deterministic, mutation-free rollback previews", () => {
    expect(
      buildGitHubRollbackPreview({
        repositoryId: 991,
        owner: "relayops",
        repository: "website",
        sourcePullRequestNumber: 42,
        sourceMergedSha: "merged-456",
        baseSha: "base-123",
        path: "content/customer-onboarding.md",
        preChangeBlobSha: "blob-000",
        expectedCurrentRemoteRevision: "merged-456",
        revertBranchName: "gengrowth-revert/artifact-42",
      }),
    ).toEqual({
      provider: "github",
      mode: "rollback_preview",
      mutatesRemote: false,
      source: {
        repositoryId: 991,
        pullRequestNumber: 42,
        mergedSha: "merged-456",
      },
      remotePrecondition: {
        expectedCurrentRevision: "merged-456",
      },
      proposed: {
        baseSha: "base-123",
        path: "content/customer-onboarding.md",
        restoreBlobSha: "blob-000",
        branchName: "gengrowth-revert/artifact-42",
        delivery: "new_pull_request",
      },
    });

    expect(
      buildWordPressRollbackPreview({
        siteOrigin: "https://content.example.com",
        postId: 84,
        priorRevision: '"wp-revision-3"',
        priorContentChecksum: "a".repeat(64),
        priorStatus: "draft",
        authorId: 7,
        slug: "customer-onboarding",
        expectedCurrentRemoteRevision: '"wp-revision-4"',
      }),
    ).toEqual({
      provider: "wordpress",
      mode: "rollback_preview",
      mutatesRemote: false,
      source: {
        siteOrigin: "https://content.example.com",
        postId: 84,
      },
      remotePrecondition: {
        expectedCurrentRevision: '"wp-revision-4"',
      },
      proposed: {
        restoreRevision: '"wp-revision-3"',
        restoreContentChecksum: "a".repeat(64),
        status: "draft",
        authorId: 7,
        slug: "customer-onboarding",
      },
    });
  });

  it("requires delivery/change lineage to match exactly", () => {
    expect(() =>
      assertReceiptLineage({
        delivery: {
          id: "delivery-1",
          provider: "github",
          contentChecksum: "a".repeat(64),
          remoteScopeRef: "github:repository:991:pull:42",
          observedAt: "2026-07-27T08:00:00.000Z",
        },
        change: {
          predecessorDeliveryReceiptId: "delivery-1",
          provider: "github",
          contentChecksum: "b".repeat(64),
          remoteScopeRef: "github:repository:991:pull:42",
          observedAt: "2026-07-27T08:01:00.000Z",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "LINEAGE_MISMATCH",
      }),
    );

    expect(() =>
      assertReceiptLineage({
        delivery: {
          id: "delivery-1",
          provider: "github",
          contentChecksum: "a".repeat(64),
          remoteScopeRef: "github:repository:991:pull:42",
          observedAt: "2026-07-27T08:00:00.000Z",
        },
        change: {
          predecessorDeliveryReceiptId: "delivery-1",
          provider: "github",
          contentChecksum: "a".repeat(64),
          remoteScopeRef: "github:repository:991:pull:42",
          observedAt: "2026-07-27T08:01:00.000Z",
        },
      }),
    ).not.toThrow();
  });

  it("does not import a network module into the pure policy layer", () => {
    const source = readFileSync(new URL("./policy.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(
      /(?:from|import\()\s*["'](?:node:(?:dns|http|https|net|tls)|undici|\.\/http)/,
    );
  });

  it("rejects malformed rollback identifiers before producing a preview", () => {
    expect(() =>
      buildGitHubRollbackPreview({
        repositoryId: 0,
        owner: "relayops",
        repository: "website",
        sourcePullRequestNumber: 42,
        sourceMergedSha: "merged",
        baseSha: "base",
        path: "content/page.md",
        preChangeBlobSha: "blob",
        expectedCurrentRemoteRevision: "merged",
        revertBranchName: "gengrowth-revert/42",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

    expect(() =>
      buildWordPressRollbackPreview({
        siteOrigin: "https://content.example.com",
        postId: 84,
        priorRevision: '"revision-1"',
        priorContentChecksum: "a".repeat(64),
        priorStatus: "draft",
        authorId: 0,
        slug: "page",
        expectedCurrentRemoteRevision: '"revision-2"',
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
