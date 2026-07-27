import { describe, expect, it, vi } from "vitest";

import {
  createGitHubPublishingAdapter,
  type GitHubDestinationScope,
  type GitHubInstallationToken,
} from "./github";
import type { FetchLike, ResolveHostname } from "./http";

const NOW = "2026-07-27T08:00:00.000Z";
const TOKEN: GitHubInstallationToken = {
  installationId: 77,
  value: "ghs_short_lived_secret",
  expiresAt: "2026-07-27T08:45:00.000Z",
};
const SCOPE: GitHubDestinationScope = {
  installationId: 77,
  repositoryId: 991,
  owner: "relayops",
  repository: "website",
  baseBranch: "main",
  allowedBranchPrefix: "gengrowth/",
  contentPath: "content/customer-onboarding.md",
};
const PUBLIC_RESOLVER: ResolveHostname = async () => ["140.82.112.6"];

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function queuedFetch(responses: readonly Response[]): {
  readonly fetch: FetchLike;
  readonly calls: FetchCall[];
} {
  const queue = [...responses];
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      const response = queue.shift();
      if (response === undefined) {
        throw new Error("Unexpected fetch call");
      }
      return response;
    },
  };
}

function createAdapter(fetch: FetchLike) {
  return createGitHubPublishingAdapter({
    fetch,
    now: () => new Date(NOW),
    sleep: async () => undefined,
    resolveHostname: PUBLIC_RESOLVER,
    requestTimeoutMs: 25,
    maxResponseBytes: 16_384,
    maxAttempts: 1,
  });
}

function probeResponses(): Response[] {
  return [
    json(
      {
        repository_selection: "selected",
        repositories: [{ id: 991, full_name: "relayops/website" }],
      },
      200,
      { "x-github-request-id": "probe-installation-1" },
    ),
    json(
      {
        id: 991,
        full_name: "relayops/website",
        archived: false,
        disabled: false,
        default_branch: "main",
        permissions: { pull: true, push: true },
      },
      200,
      { "x-github-request-id": "probe-repository-1" },
    ),
  ];
}

describe("GitHub App publishing adapter", () => {
  it("probes the selected installation/repository scope without returning the token", async () => {
    const fake = queuedFetch(probeResponses());

    const result = await createAdapter(fake.fetch).probeScope({
      token: TOKEN,
      scope: SCOPE,
    });

    expect(result).toEqual({
      provider: "github",
      ready: true,
      observedAt: NOW,
      providerRequestId: "probe-repository-1",
      remoteScopeRef: "github:installation:77:repository:991",
      repository: {
        id: 991,
        owner: "relayops",
        name: "website",
        baseBranch: "main",
      },
      capabilities: {
        metadataRead: true,
        contentsRead: true,
        contentsWrite: true,
        pullRequestsWrite: true,
      },
      limitations: [],
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN.value);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.init?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN.value}`,
    });
  });

  it("rejects a token minted for a different installation before fetch", async () => {
    const fetchImpl = vi.fn<FetchLike>();

    await expect(
      createAdapter(fetchImpl).probeScope({
        token: { ...TOKEN, installationId: 88 },
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "validate_installation_token",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when repository selection or write permission is removed", async () => {
    const removed = queuedFetch([
      json({ repository_selection: "selected", repositories: [] }),
    ]);
    await expect(
      createAdapter(removed.fetch).probeScope({
        token: TOKEN,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_REVOKED",
      operation: "probe_installation",
    });

    const readOnly = queuedFetch([
      probeResponses()[0] as Response,
      json({
        id: 991,
        full_name: "relayops/website",
        archived: false,
        disabled: false,
        default_branch: "main",
        permissions: { pull: true, push: false },
      }),
    ]);
    await expect(
      createAdapter(readOnly.fetch).probeScope({
        token: TOKEN,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "probe_repository",
    });
  });

  it("uses bounded installation pagination until the exact repository is found", async () => {
    const fake = queuedFetch([
      json(
        {
          repository_selection: "selected",
          repositories: [{ id: 100, full_name: "other/one" }],
        },
        200,
        {
          link:
            '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
          "x-github-request-id": "installation-page-1",
        },
      ),
      json(
        {
          repository_selection: "selected",
          repositories: [{ id: 991, full_name: "relayops/website" }],
        },
        200,
        { "x-github-request-id": "installation-page-2" },
      ),
      probeResponses()[1] as Response,
    ]);

    await expect(
      createAdapter(fake.fetch).probeScope({
        token: TOKEN,
        scope: SCOPE,
      }),
    ).resolves.toMatchObject({ ready: true, provider: "github" });
    expect(fake.calls[0]?.url).toContain("per_page=100&page=1");
    expect(fake.calls[1]?.url).toContain("per_page=100&page=2");
    expect(fake.calls).toHaveLength(3);
  });

  it("rejects an unsafe or malformed GitHub next-page link", async () => {
    const fake = queuedFetch([
      json(
        {
          repository_selection: "selected",
          repositories: [{ id: 100, full_name: "other/one" }],
        },
        200,
        {
          link:
            '<http://127.0.0.1/installation/repositories?page=2>; rel="next"',
          "x-github-request-id": "installation-bad-link",
        },
      ),
    ]);

    await expect(
      createAdapter(fake.fetch).probeScope({
        token: TOKEN,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      operation: "probe_installation",
      providerRequestId: "installation-bad-link",
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("stops at the hard installation pagination cap", async () => {
    const pages = Array.from({ length: 10 }, (_, index) =>
      json(
        {
          repository_selection: "selected",
          repositories: [
            { id: index + 1, full_name: `other/repository-${index + 1}` },
          ],
        },
        200,
        {
          link:
            `<https://api.github.com/installation/repositories?per_page=100&page=${index + 2}>; rel="next"`,
          "x-github-request-id": `installation-page-${index + 1}`,
        },
      ),
    );
    const fake = queuedFetch(pages);

    await expect(
      createAdapter(fake.fetch).probeScope({
        token: TOKEN,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_UNAVAILABLE",
      operation: "probe_installation",
      safeDetails: { state: "pagination_cap" },
    });
    expect(fake.calls).toHaveLength(10);
  });

  it("creates branch, exact commit and PR as delivery only, never auto-merging", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        { ref: "refs/heads/main", object: { sha: "base-sha-1" } },
        200,
        { "x-github-request-id": "base-ref-1" },
      ),
      json({ message: "Not Found" }, 404, {
        "x-github-request-id": "branch-missing-1",
      }),
      json(
        {
          ref: "refs/heads/gengrowth/artifact-42",
          object: { sha: "base-sha-1" },
        },
        201,
        { "x-github-request-id": "branch-created-1" },
      ),
      json({ message: "Not Found" }, 404, {
        "x-github-request-id": "content-missing-1",
      }),
      json(
        {
          content: {
            path: "content/customer-onboarding.md",
            sha: "blob-sha-1",
          },
          commit: { sha: "commit-sha-1" },
        },
        201,
        { "x-github-request-id": "commit-created-1" },
      ),
      json([], 200, { "x-github-request-id": "pull-list-1" }),
      json(
        {
          number: 42,
          html_url: "https://github.com/relayops/website/pull/42",
          state: "open",
          head: { sha: "commit-sha-1" },
          base: { sha: "base-sha-1" },
        },
        201,
        { "x-github-request-id": "pull-created-1" },
      ),
    ]);

    const result = await createAdapter(fake.fetch).createOrUpdateDelivery({
      token: TOKEN,
      scope: SCOPE,
      branchName: "gengrowth/artifact-42",
      path: "content/customer-onboarding.md",
      content: "# Customer onboarding\n",
      commitMessage: "Publish approved artifact 42",
      pullRequest: {
        title: "Publish customer onboarding artifact",
        body: "Exact approved revision.",
      },
      remotePrecondition: { kind: "must_not_exist" },
    });

    expect(result).toMatchObject({
      kind: "delivery",
      provider: "github",
      state: "pending",
      observedAt: NOW,
      providerRequestId: "pull-created-1",
      remoteScopeRef: "github:repository:991:pull:42",
      remote: {
        repositoryId: 991,
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.com/relayops/website/pull/42",
        headSha: "commit-sha-1",
        baseSha: "base-sha-1",
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
      },
    });
    expect(result.contentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(TOKEN.value);
    expect(
      fake.calls.some(
        ({ url }) => url.includes("/merge") || url.includes("auto_merge"),
      ),
    ).toBe(false);

    const branchCreate = fake.calls.find(
      ({ url, init }) =>
        url.endsWith("/git/refs") && init?.method?.toUpperCase() === "POST",
    );
    expect(JSON.parse(String(branchCreate?.init?.body))).toEqual({
      ref: "refs/heads/gengrowth/artifact-42",
      sha: "base-sha-1",
    });

    const commit = fake.calls.find(
      ({ url, init }) =>
        url.includes("/contents/content/customer-onboarding.md") &&
        init?.method?.toUpperCase() === "PUT",
    );
    expect(JSON.parse(String(commit?.init?.body))).toMatchObject({
      branch: "gengrowth/artifact-42",
      content: Buffer.from("# Customer onboarding\n", "utf8").toString("base64"),
    });
  });

  it("fails closed on stale remote content before any write", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json({ object: { sha: "base-sha-1" } }),
      json({ object: { sha: "branch-head-2" } }),
      json({ sha: "remote-blob-newer" }),
    ]);

    await expect(
      createAdapter(fake.fetch).createOrUpdateDelivery({
        token: TOKEN,
        scope: SCOPE,
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
        content: "# Approved content\n",
        commitMessage: "Update approved artifact",
        pullRequest: { title: "Update", body: "Update" },
        remotePrecondition: {
          kind: "match",
          branchHeadSha: "branch-head-2",
          contentSha: "remote-blob-older",
        },
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_STALE",
      provider: "github",
      operation: "verify_remote_revision",
    });

    expect(
      fake.calls.filter(({ init }) =>
        ["POST", "PUT", "PATCH"].includes(init?.method?.toUpperCase() ?? ""),
      ),
    ).toHaveLength(0);
  });

  it.each([
    "content/customer-onboarding.md.bak",
    "content/../content/customer-onboarding.md",
  ])("rejects path outside the one exact frozen contentPath: %s", async (path) => {
    const fetchImpl = vi.fn<FetchLike>();

    await expect(
      createAdapter(fetchImpl).createOrUpdateDelivery({
        token: TOKEN,
        scope: SCOPE,
        branchName: "gengrowth/artifact-42",
        path,
        content: "# Approved content\n",
        commitMessage: "Publish approved artifact",
        pullRequest: { title: "Publish", body: "Publish" },
        remotePrecondition: { kind: "must_not_exist" },
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "validate_delivery_scope",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates an existing branch, content revision, and open PR", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json({ object: { sha: "base-sha-2" } }),
      json({ object: { sha: "branch-head-2" } }),
      json({ sha: "blob-sha-old" }),
      json(
        {
          content: { sha: "blob-sha-new" },
          commit: { sha: "commit-sha-2" },
        },
        200,
        { "x-github-request-id": "commit-updated-2" },
      ),
      json([
        {
          number: 42,
          html_url: "https://github.com/relayops/website/pull/42",
          state: "open",
          head: { sha: "branch-head-2" },
          base: { sha: "base-sha-2" },
        },
      ]),
      json(
        {
          number: 42,
          html_url: "https://github.com/relayops/website/pull/42",
          state: "open",
          head: { sha: "commit-sha-2" },
          base: { sha: "base-sha-2" },
        },
        200,
        { "x-github-request-id": "pull-updated-2" },
      ),
    ]);

    const result = await createAdapter(fake.fetch).createOrUpdateDelivery({
      token: TOKEN,
      scope: SCOPE,
      branchName: "gengrowth/artifact-42",
      path: "content/customer-onboarding.md",
      content: "# Updated approved content\n",
      commitMessage: "Update approved artifact",
      pullRequest: { title: "Updated title", body: "Updated body" },
      remotePrecondition: {
        kind: "match",
        branchHeadSha: "branch-head-2",
        contentSha: "blob-sha-old",
      },
    });

    expect(result.remote).toMatchObject({
      pullRequestNumber: 42,
      headSha: "commit-sha-2",
      baseSha: "base-sha-2",
    });
    expect(
      fake.calls.some(
        ({ url, init }) =>
          url.endsWith("/pulls/42") &&
          init?.method?.toUpperCase() === "PATCH",
      ),
    ).toBe(true);
    const updateContent = fake.calls.find(
      ({ url, init }) =>
        url.includes("/contents/content/customer-onboarding.md") &&
        init?.method?.toUpperCase() === "PUT",
    );
    expect(JSON.parse(String(updateContent?.init?.body))).toMatchObject({
      sha: "blob-sha-old",
      branch: "gengrowth/artifact-42",
    });
  });

  it("maps revoked installation authorization to a structured redacted error", async () => {
    const fake = queuedFetch([
      json(
        { message: `Bad credentials ${TOKEN.value}` },
        401,
        { "x-github-request-id": "auth-revoked-1" },
      ),
    ]);

    const error = await createAdapter(fake.fetch)
      .probeScope({ token: TOKEN, scope: SCOPE })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "AUTH_REVOKED",
      provider: "github",
      operation: "probe_installation",
      providerRequestId: "auth-revoked-1",
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain(TOKEN.value);
    expect(JSON.stringify(error)).not.toContain("Bad credentials");
  });

  it("rejects a provider Pull Request URL outside the fixed GitHub origin/path", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json({ object: { sha: "base-sha-2" } }),
      json({ object: { sha: "branch-head-2" } }),
      json({ sha: "blob-sha-old" }),
      json({
        content: { sha: "blob-sha-new" },
        commit: { sha: "commit-sha-2" },
      }),
      json([
        {
          number: 42,
          html_url: "https://github.com/relayops/website/pull/42",
          state: "open",
          head: { sha: "branch-head-2" },
          base: { sha: "base-sha-2" },
        },
      ]),
      json({
        number: 42,
        html_url: "https://evil.example/pull/42",
        state: "open",
        head: { sha: "commit-sha-2" },
        base: { sha: "base-sha-2" },
      }),
    ]);

    await expect(
      createAdapter(fake.fetch).createOrUpdateDelivery({
        token: TOKEN,
        scope: SCOPE,
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
        content: "# Updated approved content\n",
        commitMessage: "Update approved artifact",
        pullRequest: { title: "Updated", body: "Updated" },
        remotePrecondition: {
          kind: "match",
          branchHeadSha: "branch-head-2",
          contentSha: "blob-sha-old",
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      operation: "create_or_update_pull_request",
    });
  });

  it("rejects expired or non-short-lived installation tokens before fetch", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = createAdapter(fetchImpl);

    await expect(
      adapter.probeScope({
        token: {
          installationId: 77,
          value: "expired-secret",
          expiresAt: "2026-07-27T07:59:59.000Z",
        },
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    await expect(
      adapter.probeScope({
        token: {
          installationId: 77,
          value: "long-lived-secret",
          expiresAt: "2026-07-28T08:00:00.000Z",
        },
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_LIFETIME_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a safe partial delivery if commit succeeds but PR creation is unknown", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json({ object: { sha: "base-sha-1" } }),
      json({ message: "Not Found" }, 404),
      json({ object: { sha: "base-sha-1" } }, 201),
      json({ message: "Not Found" }, 404),
      json(
        {
          content: { sha: "blob-sha-1" },
          commit: { sha: "commit-sha-1" },
        },
        201,
      ),
      json([]),
      json({ message: "Service Unavailable" }, 503, {
        "x-github-request-id": "pull-unknown-1",
      }),
    ]);

    await expect(
      createAdapter(fake.fetch).createOrUpdateDelivery({
        token: TOKEN,
        scope: SCOPE,
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
        content: "# Approved content\n",
        commitMessage: "Publish approved artifact",
        pullRequest: { title: "Publish", body: "Publish" },
        remotePrecondition: { kind: "must_not_exist" },
      }),
    ).rejects.toMatchObject({
      code: "PARTIAL_DELIVERY",
      provider: "github",
      operation: "create_or_update_pull_request",
      retryable: true,
      providerRequestId: "pull-unknown-1",
      safeDetails: {
        stage: "pull_request",
        repositoryId: 991,
        branchName: "gengrowth/artifact-42",
        committedRevision: "commit-sha-1",
      },
    });
  });

  it("never merges and only reconciles a Pull Request already merged by a human", async () => {
    const delivery = {
      kind: "delivery" as const,
      provider: "github" as const,
      state: "pending" as const,
      observedAt: NOW,
      providerRequestId: "pull-created-1",
      contentChecksum:
        "61f90e5f9f0ac44b8043a6182933967087a54c73fac9c5b96699116171a7f9bc",
      remoteScopeRef: "github:repository:991:pull:42",
      remote: {
        repositoryId: 991,
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.com/relayops/website/pull/42",
        headSha: "commit-sha-1",
        baseSha: "base-sha-1",
        branchName: "gengrowth/artifact-42",
        path: "content/customer-onboarding.md",
      },
    };
    const noFetch = vi.fn<FetchLike>();
    await expect(
      createAdapter(noFetch).reconcileMergedChange({
        token: TOKEN,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-1",
        delivery: {
          ...delivery,
          remote: {
            ...delivery.remote,
            path: "content/other.md",
          },
        },
        expectedHeadSha: "commit-sha-1",
        deployment: {
          liveUrl: "https://www.example.com/customer-onboarding/",
          expectedCanonicalUrl:
            "https://www.example.com/customer-onboarding/",
          revisionHeader: "x-gengrowth-revision",
        },
      }),
    ).rejects.toMatchObject({
      code: "LINEAGE_MISMATCH",
      operation: "validate_change_lineage",
    });
    expect(noFetch).not.toHaveBeenCalled();

    const pending = queuedFetch([
      ...probeResponses(),
      json(
        {
          number: 42,
          state: "open",
          merged: false,
          head: { sha: "commit-sha-1" },
          base: { sha: "base-sha-1" },
        },
        200,
        { "x-github-request-id": "pull-pending-1" },
      ),
    ]);
    await expect(
      createAdapter(pending.fetch).reconcileMergedChange({
        token: TOKEN,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-1",
        delivery,
        expectedHeadSha: "commit-sha-1",
        deployment: {
          liveUrl: "https://www.example.com/customer-onboarding/",
          expectedCanonicalUrl:
            "https://www.example.com/customer-onboarding/",
          revisionHeader: "x-gengrowth-revision",
        },
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_UNAVAILABLE",
      operation: "reconcile_pull_request",
      retryable: true,
      safeDetails: { state: "pending_merge" },
    });
    expect(
      pending.calls.some(
        ({ url, init }) =>
          url.includes("/merge") ||
          url.includes("auto_merge") ||
          ["POST", "PUT", "PATCH", "DELETE"].includes(
            init?.method?.toUpperCase() ?? "",
          ),
      ),
    ).toBe(false);

    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          number: 42,
          state: "closed",
          merged: true,
          merge_commit_sha: "merged-sha-9",
          head: { sha: "commit-sha-1" },
          base: { sha: "base-sha-1" },
        },
        200,
        { "x-github-request-id": "pull-merged-1" },
      ),
      new Response(
        '<html><head><link rel="canonical" href="https://www.example.com/customer-onboarding/"></head></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-gengrowth-revision": "merged-sha-9",
            "x-request-id": "live-verify-1",
          },
        },
      ),
    ]);

    const result = await createAdapter(fake.fetch).reconcileMergedChange({
      token: TOKEN,
      scope: SCOPE,
      predecessorDeliveryReceiptId: "delivery-receipt-1",
      delivery,
      expectedHeadSha: "commit-sha-1",
      deployment: {
        liveUrl: "https://www.example.com/customer-onboarding/",
        expectedCanonicalUrl: "https://www.example.com/customer-onboarding/",
        revisionHeader: "x-gengrowth-revision",
      },
    });

    expect(result).toEqual({
      kind: "change",
      provider: "github",
      state: "verified",
      observedAt: NOW,
      predecessorDeliveryReceiptId: "delivery-receipt-1",
      contentChecksum: delivery.contentChecksum,
      remoteScopeRef: delivery.remoteScopeRef,
      providerRequestId: "pull-merged-1",
      liveCanonicalUrl: "https://www.example.com/customer-onboarding/",
      remoteRevision: "merged-sha-9",
      evidence: {
        mergedSha: "merged-sha-9",
        pullRequestNumber: 42,
        liveProviderRequestId: "live-verify-1",
      },
    });
    expect(
      fake.calls.some(
        ({ url, init }) =>
          url.includes("/merge") ||
          url.includes("auto_merge") ||
          ["POST", "PUT", "PATCH", "DELETE"].includes(
            init?.method?.toUpperCase() ?? "",
          ),
      ),
    ).toBe(false);
  });
});
