import { describe, expect, it, vi } from "vitest";

import type { FetchLike, ResolveHostname } from "./http";
import {
  createWordPressPublishingAdapter,
  type WordPressCredential,
  type WordPressDestinationScope,
} from "./wordpress";

const NOW = "2026-07-27T08:00:00.000Z";
const CREDENTIAL: WordPressCredential = {
  authorizationValue: "Basic dXNlcjphcHBsaWNhdGlvbi1wYXNzd29yZA==",
};
const SCOPE: WordPressDestinationScope = {
  siteOrigin: "https://content.example.com",
  authenticatedUserId: 7,
  allowedAuthorIds: [7],
  allowedStatuses: ["draft", "future"],
  allowedPostTypes: ["posts"],
};
const PUBLIC_RESOLVER: ResolveHostname = async () => ["93.184.216.34"];

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

function probeResponses(): Response[] {
  return [
    json(
      {
        name: "RelayOps Content",
        url: "https://content.example.com",
        home: "https://content.example.com",
      },
      200,
      { "x-request-id": "wp-root-1" },
    ),
    json(
      {
        id: 7,
        capabilities: {
          edit_posts: true,
          publish_posts: true,
        },
      },
      200,
      { "x-wp-request-id": "wp-user-1" },
    ),
    json(
      {
        slug: "post",
        rest_base: "posts",
        capabilities: {
          edit_posts: "edit_posts",
          publish_posts: "publish_posts",
        },
      },
      200,
      { "x-wp-request-id": "wp-type-1" },
    ),
  ];
}

function createAdapter(fetch: FetchLike) {
  return createWordPressPublishingAdapter({
    fetch,
    now: () => new Date(NOW),
    sleep: async () => undefined,
    resolveHostname: PUBLIC_RESOLVER,
    requestTimeoutMs: 25,
    maxResponseBytes: 16_384,
    maxAttempts: 1,
  });
}

describe("WordPress REST publishing adapter", () => {
  it("probes site identity, user, post type and capabilities without returning credential", async () => {
    const fake = queuedFetch(probeResponses());

    const result = await createAdapter(fake.fetch).probeScope({
      credential: CREDENTIAL,
      scope: SCOPE,
    });

    expect(result).toEqual({
      provider: "wordpress",
      ready: true,
      observedAt: NOW,
      providerRequestId: "wp-type-1",
      remoteScopeRef: "wordpress:https://content.example.com",
      site: {
        origin: "https://content.example.com",
        name: "RelayOps Content",
      },
      authenticatedUserId: 7,
      capabilities: {
        postsCreate: true,
        postsEdit: true,
        postsPublish: true,
      },
      allowedPostTypes: ["posts"],
      allowedAuthorIds: [7],
      allowedStatuses: ["draft", "future"],
      limitations: [],
    });
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL.authorizationValue);
    expect(fake.calls[1]?.init?.headers).toMatchObject({
      authorization: CREDENTIAL.authorizationValue,
    });
  });

  it("maps the built-in pages REST base to the page type slug", async () => {
    const pageScope: WordPressDestinationScope = {
      ...SCOPE,
      allowedPostTypes: ["pages"],
    };
    const fake = queuedFetch([
      probeResponses()[0] as Response,
      probeResponses()[1] as Response,
      json(
        {
          slug: "page",
          rest_base: "pages",
          capabilities: { edit_posts: "edit_pages" },
        },
        200,
        { "x-wp-request-id": "wp-page-type-1" },
      ),
    ]);

    const result = await createAdapter(fake.fetch).probeScope({
      credential: CREDENTIAL,
      scope: pageScope,
    });

    expect(fake.calls[2]?.url).toBe(
      "https://content.example.com/wp-json/wp/v2/types/page?context=edit",
    );
    expect(result.allowedPostTypes).toEqual(["pages"]);
    expect(result.providerRequestId).toBe("wp-page-type-1");
  });

  it("discovers a custom REST base from type capabilities and rejects an unknown one without guessing a slug", async () => {
    const collection = {
      book: {
        slug: "book",
        rest_base: "library",
        capabilities: { edit_posts: "edit_books" },
      },
    };
    const customScope: WordPressDestinationScope = {
      ...SCOPE,
      allowedPostTypes: ["library"],
    };
    const custom = queuedFetch([
      probeResponses()[0] as Response,
      probeResponses()[1] as Response,
      json(collection, 200, { "x-wp-request-id": "wp-types-1" }),
    ]);

    await expect(
      createAdapter(custom.fetch).probeScope({
        credential: CREDENTIAL,
        scope: customScope,
      }),
    ).resolves.toMatchObject({ allowedPostTypes: ["library"] });
    expect(custom.calls[2]?.url).toBe(
      "https://content.example.com/wp-json/wp/v2/types?context=edit",
    );

    const unknownScope: WordPressDestinationScope = {
      ...SCOPE,
      allowedPostTypes: ["missing-rest-base"],
    };
    const unknown = queuedFetch([
      probeResponses()[0] as Response,
      probeResponses()[1] as Response,
      json(collection, 200, { "x-wp-request-id": "wp-types-2" }),
    ]);
    await expect(
      createAdapter(unknown.fetch).probeScope({
        credential: CREDENTIAL,
        scope: unknownScope,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "probe_post_type",
    });
    expect(unknown.calls[2]?.url).toBe(
      "https://content.example.com/wp-json/wp/v2/types?context=edit",
    );
    expect(unknown.calls).toHaveLength(3);
  });

  it("fails closed when site identity, edit capability, or post type drifts", async () => {
    const identityDrift = queuedFetch([
      json({
        name: "Other Site",
        url: "https://other.example.com",
        home: "https://other.example.com",
      }),
    ]);
    await expect(
      createAdapter(identityDrift.fetch).probeScope({
        credential: CREDENTIAL,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_REVOKED",
      operation: "probe_site",
    });

    const noEdit = queuedFetch([
      probeResponses()[0] as Response,
      json({ id: 7, capabilities: { edit_posts: false } }),
    ]);
    await expect(
      createAdapter(noEdit.fetch).probeScope({
        credential: CREDENTIAL,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "probe_identity",
    });

    const userDrift = queuedFetch([
      probeResponses()[0] as Response,
      json({
        id: 8,
        capabilities: { edit_posts: true, publish_posts: true },
      }),
    ]);
    await expect(
      createAdapter(userDrift.fetch).probeScope({
        credential: CREDENTIAL,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_REVOKED",
      operation: "probe_identity",
    });

    const typeDrift = queuedFetch([
      probeResponses()[0] as Response,
      probeResponses()[1] as Response,
      json({ slug: "page", rest_base: "pages", capabilities: {} }),
    ]);
    await expect(
      createAdapter(typeDrift.fetch).probeScope({
        credential: CREDENTIAL,
        scope: SCOPE,
      }),
    ).rejects.toMatchObject({
      code: "SCOPE_DENIED",
      operation: "probe_post_type",
    });
  });

  it("reports unavailable publish capability without weakening draft readiness", async () => {
    const fake = queuedFetch([
      probeResponses()[0] as Response,
      json({
        id: 7,
        capabilities: { edit_posts: true, publish_posts: false },
      }),
      probeResponses()[2] as Response,
    ]);

    const result = await createAdapter(fake.fetch).probeScope({
      credential: CREDENTIAL,
      scope: SCOPE,
    });

    expect(result.ready).toBe(true);
    expect(result.capabilities.postsPublish).toBe(false);
    expect(result.limitations).toEqual(["publish_capability_unavailable"]);
  });

  it("creates a draft as a pending delivery and never publishes directly", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 84,
          status: "draft",
          slug: "customer-onboarding",
          author: 7,
          modified_gmt: "2026-07-27T08:00:01",
          link: "https://content.example.com/customer-onboarding/",
          _links: {
            "wp:preview": [
              {
                href: "https://content.example.com/?p=84&preview=true",
              },
            ],
          },
        },
        201,
        {
          etag: '"wp-revision-1"',
          "x-wp-request-id": "wp-create-1",
        },
      ),
    ]);

    const result = await createAdapter(fake.fetch).createOrUpdateDelivery({
      credential: CREDENTIAL,
      scope: SCOPE,
      postType: "posts",
      title: "How to automate customer onboarding",
      slug: "customer-onboarding",
      content: "<h1>Customer onboarding</h1>",
      excerpt: "A practical guide.",
      authorId: 7,
      status: "draft",
      canonicalExpectation:
        "https://content.example.com/customer-onboarding/",
      remotePrecondition: { kind: "must_not_exist" },
    });

    expect(result).toMatchObject({
      kind: "delivery",
      provider: "wordpress",
      state: "pending",
      observedAt: NOW,
      providerRequestId: "wp-create-1",
      remoteScopeRef:
        "wordpress:https://content.example.com:post:84",
      remote: {
        siteOrigin: "https://content.example.com",
        postId: 84,
        postType: "posts",
        status: "draft",
        revision: '"wp-revision-1"',
        editUrl:
          "https://content.example.com/wp-admin/post.php?post=84&action=edit",
        previewUrl: "https://content.example.com/?p=84&preview=true",
      },
    });
    expect(result.contentChecksum).toMatch(/^[a-f0-9]{64}$/);
    const createCall = fake.calls.at(-1);
    expect(createCall?.init?.method).toBe("POST");
    expect(JSON.parse(String(createCall?.init?.body))).toMatchObject({
      status: "draft",
      author: 7,
    });
    expect(JSON.stringify(createCall?.init?.body)).not.toContain(
      '"status":"publish"',
    );
  });

  it("rejects an off-origin WordPress preview URL", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 84,
          status: "draft",
          slug: "customer-onboarding",
          author: 7,
          modified_gmt: "2026-07-27T08:00:01",
          link: "https://content.example.com/customer-onboarding/",
          _links: {
            "wp:preview": [
              { href: "https://evil.example/credential-phishing" },
            ],
          },
        },
        201,
        { etag: '"wp-revision-1"' },
      ),
    ]);

    await expect(
      createAdapter(fake.fetch).createOrUpdateDelivery({
        credential: CREDENTIAL,
        scope: SCOPE,
        postType: "posts",
        title: "How to automate customer onboarding",
        slug: "customer-onboarding",
        content: "<h1>Customer onboarding</h1>",
        authorId: 7,
        status: "draft",
        canonicalExpectation:
          "https://content.example.com/customer-onboarding/",
        remotePrecondition: { kind: "must_not_exist" },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      operation: "validate_preview_url",
    });
  });

  it("creates an allowed scheduled post but rejects invalid author and direct publish before fetch", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 85,
          status: "future",
          slug: "scheduled-onboarding",
          author: 7,
          modified_gmt: "2026-07-28T08:00:00",
          link: "https://content.example.com/scheduled-onboarding/",
        },
        201,
        { etag: '"wp-revision-future"', "x-wp-request-id": "wp-future-1" },
      ),
    ]);
    const adapter = createAdapter(fake.fetch);

    const scheduled = await adapter.createOrUpdateDelivery({
      credential: CREDENTIAL,
      scope: SCOPE,
      postType: "posts",
      title: "Scheduled",
      slug: "scheduled-onboarding",
      content: "<p>Scheduled</p>",
      authorId: 7,
      status: "future",
      scheduledAt: "2026-07-28T08:00:00.000Z",
      canonicalExpectation:
        "https://content.example.com/scheduled-onboarding/",
      remotePrecondition: { kind: "must_not_exist" },
    });
    expect(scheduled.remote.status).toBe("future");

    const blockedFetch = vi.fn<FetchLike>();
    await expect(
      createAdapter(blockedFetch).createOrUpdateDelivery({
        credential: CREDENTIAL,
        scope: SCOPE,
        postType: "posts",
        title: "Forbidden author",
        slug: "forbidden",
        content: "<p>Forbidden</p>",
        authorId: 999,
        status: "draft",
        canonicalExpectation: "https://content.example.com/forbidden/",
        remotePrecondition: { kind: "must_not_exist" },
      }),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });

    await expect(
      createAdapter(blockedFetch).createOrUpdateDelivery({
        credential: CREDENTIAL,
        scope: SCOPE,
        postType: "posts",
        title: "Direct publish",
        slug: "direct",
        content: "<p>Direct</p>",
        authorId: 7,
        status: "publish",
        canonicalExpectation: "https://content.example.com/direct/",
        remotePrecondition: { kind: "must_not_exist" },
      }),
    ).rejects.toMatchObject({ code: "DIRECT_PUBLISH_FORBIDDEN" });
    expect(blockedFetch).not.toHaveBeenCalled();
  });

  it("enforces the exact REST revision before updating", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 84,
          status: "draft",
          author: 7,
          modified_gmt: "2026-07-27T08:00:01",
        },
        200,
        { etag: '"wp-revision-newer"' },
      ),
    ]);

    await expect(
      createAdapter(fake.fetch).createOrUpdateDelivery({
        credential: CREDENTIAL,
        scope: SCOPE,
        postId: 84,
        postType: "posts",
        title: "Update",
        slug: "customer-onboarding",
        content: "<p>Approved update</p>",
        authorId: 7,
        status: "draft",
        canonicalExpectation:
          "https://content.example.com/customer-onboarding/",
        remotePrecondition: {
          kind: "match",
          revision: '"wp-revision-older"',
        },
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_STALE",
      provider: "wordpress",
      operation: "verify_remote_revision",
    });
    expect(
      fake.calls.filter(({ init }) => init?.method?.toUpperCase() === "POST"),
    ).toHaveLength(0);
  });

  it("updates an existing draft with If-Match and returns the new revision", async () => {
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 84,
          status: "draft",
          author: 7,
          slug: "customer-onboarding",
          modified_gmt: "2026-07-27T08:00:01",
        },
        200,
        { etag: '"wp-revision-1"' },
      ),
      json(
        {
          id: 84,
          status: "draft",
          slug: "customer-onboarding",
          author: 7,
          modified_gmt: "2026-07-27T08:02:00",
          link: "https://content.example.com/customer-onboarding/",
        },
        200,
        {
          etag: '"wp-revision-2"',
          "x-wp-request-id": "wp-update-2",
        },
      ),
    ]);

    const result = await createAdapter(fake.fetch).createOrUpdateDelivery({
      credential: CREDENTIAL,
      scope: SCOPE,
      postId: 84,
      postType: "posts",
      title: "Updated",
      slug: "customer-onboarding",
      content: "<p>Approved update</p>",
      authorId: 7,
      status: "draft",
      canonicalExpectation:
        "https://content.example.com/customer-onboarding/",
      remotePrecondition: {
        kind: "match",
        revision: '"wp-revision-1"',
      },
    });

    expect(result.remote.revision).toBe('"wp-revision-2"');
    const update = fake.calls.at(-1);
    expect(update?.url).toMatch(/\/wp-json\/wp\/v2\/posts\/84$/u);
    expect(update?.init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "if-match": '"wp-revision-1"',
      }),
    });
  });

  it("treats revoked credentials as revoked and never leaks provider prose", async () => {
    const fake = queuedFetch([
      json(
        {
          code: "rest_not_logged_in",
          message: `Credential ${CREDENTIAL.authorizationValue} is invalid`,
        },
        401,
        { "x-wp-request-id": "wp-auth-revoked-1" },
      ),
    ]);

    const error = await createAdapter(fake.fetch)
      .probeScope({ credential: CREDENTIAL, scope: SCOPE })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "AUTH_REVOKED",
      provider: "wordpress",
      operation: "probe_site",
      providerRequestId: "wp-auth-revoked-1",
    });
    expect(JSON.stringify(error)).not.toContain(CREDENTIAL.authorizationValue);
    expect(JSON.stringify(error)).not.toContain("Credential");
  });

  it("accepts a grant consumed before expiry despite queue delay and verifies the exact live revision", async () => {
    const delivery = {
      kind: "delivery" as const,
      provider: "wordpress" as const,
      state: "pending" as const,
      observedAt: NOW,
      providerRequestId: "wp-create-1",
      contentChecksum:
        "61f90e5f9f0ac44b8043a6182933967087a54c73fac9c5b96699116171a7f9bc",
      remoteScopeRef:
        "wordpress:https://content.example.com:post:84",
      remote: {
        siteOrigin: "https://content.example.com",
        postId: 84,
        postType: "posts",
        status: "draft" as const,
        revision: '"wp-revision-1"',
        editUrl:
          "https://content.example.com/wp-admin/post.php?post=84&action=edit",
        previewUrl: "https://content.example.com/?p=84&preview=true",
      },
    };
    const noApprovalFetch = vi.fn<FetchLike>();

    await expect(
      createAdapter(noApprovalFetch).publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: null,
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
    });
    expect(noApprovalFetch).not.toHaveBeenCalled();

    const fake = queuedFetch([
      ...probeResponses(),
      json(
        {
          id: 84,
          status: "draft",
          author: 7,
          modified_gmt: "2026-07-27T08:00:01",
        },
        200,
        { etag: '"wp-revision-1"' },
      ),
      json(
        {
          id: 84,
          status: "publish",
          author: 7,
          modified_gmt: "2026-07-27T08:01:00",
          link: "https://content.example.com/customer-onboarding/",
        },
        200,
        {
          etag: '"wp-revision-published"',
          "x-wp-request-id": "wp-publish-1",
        },
      ),
      json(
        {
          id: 84,
          status: "publish",
          author: 7,
          modified_gmt: "2026-07-27T08:01:00",
          link: "https://content.example.com/customer-onboarding/",
        },
        200,
        { etag: '"wp-revision-published"' },
      ),
      new Response(
        '<html><head><link rel="canonical" href="https://content.example.com/customer-onboarding/"></head></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html",
            "x-request-id": "wp-live-1",
          },
        },
      ),
    ]);

    const result = await createAdapter(fake.fetch).publishAndReconcile({
      credential: CREDENTIAL,
      scope: SCOPE,
      predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
      delivery,
      publishAuthorization: {
        authorizationGrantRef: "00000000-0000-4000-8000-000000000501",
        purpose: "publish",
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        contentChecksum: delivery.contentChecksum,
        remoteScopeRef: delivery.remoteScopeRef,
        expectedRemoteRevision: '"wp-revision-1"',
        authorizedAt: "2026-07-27T07:50:00.000Z",
        consumedAt: "2026-07-27T07:59:00.000Z",
        expiresAt: "2026-07-27T07:59:30.000Z",
      },
      expectedRemoteRevision: '"wp-revision-1"',
      expectedCanonicalUrl:
        "https://content.example.com/customer-onboarding/",
    });

    expect(result).toEqual({
      kind: "change",
      provider: "wordpress",
      state: "verified",
      observedAt: NOW,
      predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
      contentChecksum: delivery.contentChecksum,
      remoteScopeRef: delivery.remoteScopeRef,
      providerRequestId: "wp-publish-1",
      liveCanonicalUrl:
        "https://content.example.com/customer-onboarding/",
      remoteRevision: '"wp-revision-published"',
      evidence: {
        postId: 84,
        status: "publish",
        liveProviderRequestId: "wp-live-1",
      },
    });
  });

  it("does not produce a change observation when the live canonical mismatches", async () => {
    const delivery = {
      kind: "delivery" as const,
      provider: "wordpress" as const,
      state: "pending" as const,
      observedAt: NOW,
      providerRequestId: "wp-create-1",
      contentChecksum:
        "61f90e5f9f0ac44b8043a6182933967087a54c73fac9c5b96699116171a7f9bc",
      remoteScopeRef:
        "wordpress:https://content.example.com:post:84",
      remote: {
        siteOrigin: "https://content.example.com",
        postId: 84,
        postType: "posts",
        status: "draft" as const,
        revision: '"wp-revision-1"',
        editUrl:
          "https://content.example.com/wp-admin/post.php?post=84&action=edit",
        previewUrl: "https://content.example.com/?p=84&preview=true",
      },
    };
    const fake = queuedFetch([
      ...probeResponses(),
      json(
        { id: 84, status: "draft", author: 7 },
        200,
        { etag: '"wp-revision-1"' },
      ),
      json(
        {
          id: 84,
          status: "publish",
          author: 7,
          link: "https://content.example.com/customer-onboarding/",
        },
        200,
        {
          etag: '"wp-revision-published"',
          "x-wp-request-id": "wp-publish-mismatch",
        },
      ),
      json(
        {
          id: 84,
          status: "publish",
          author: 7,
          link: "https://content.example.com/customer-onboarding/",
        },
        200,
        { etag: '"wp-revision-published"' },
      ),
      new Response(
        '<html><head><link rel="canonical" href="https://content.example.com/wrong/"></head></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      ),
    ]);

    await expect(
      createAdapter(fake.fetch).publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000501",
          purpose: "publish",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: delivery.contentChecksum,
          remoteScopeRef: delivery.remoteScopeRef,
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T07:50:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: "2026-07-27T08:10:00.000Z",
        },
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "LIVE_VERIFICATION_FAILED",
      operation: "reconcile_live_canonical",
      safeDetails: { reason: "canonical_mismatch" },
    });
  });

  it("rejects stale or cross-lineage publish authorization before fetch", async () => {
    const delivery = {
      kind: "delivery" as const,
      provider: "wordpress" as const,
      state: "pending" as const,
      observedAt: NOW,
      providerRequestId: "wp-create-1",
      contentChecksum:
        "61f90e5f9f0ac44b8043a6182933967087a54c73fac9c5b96699116171a7f9bc",
      remoteScopeRef:
        "wordpress:https://content.example.com:post:84",
      remote: {
        siteOrigin: "https://content.example.com",
        postId: 84,
        postType: "posts",
        status: "draft" as const,
        revision: '"wp-revision-1"',
        editUrl:
          "https://content.example.com/wp-admin/post.php?post=84&action=edit",
        previewUrl: "https://content.example.com/?p=84&preview=true",
      },
    };
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = createAdapter(fetchImpl);

    await expect(
      adapter.publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000506",
          purpose: "publish",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: delivery.contentChecksum,
          remoteScopeRef: delivery.remoteScopeRef,
          expectedRemoteRevision: '"wp-revision-2"',
          authorizedAt: "2026-07-27T07:50:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: "2026-07-27T08:10:00.000Z",
        },
        expectedRemoteRevision: '"wp-revision-2"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
      safeDetails: { reason: "authorization_lineage_mismatch" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      adapter.publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000502",
          purpose: "publish",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: delivery.contentChecksum,
          remoteScopeRef: delivery.remoteScopeRef,
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T07:50:00.000Z",
          consumedAt: "2026-07-27T08:00:00.000Z",
          expiresAt: "2026-07-27T07:59:59.000Z",
        },
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
      safeDetails: { reason: "authorization_expired" },
    });

    await expect(
      adapter.publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000503",
          purpose: "publish",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: "b".repeat(64),
          remoteScopeRef:
            "wordpress:https://content.example.com:post:999",
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T07:50:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: "2026-07-27T08:10:00.000Z",
        },
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
      safeDetails: { reason: "authorization_lineage_mismatch" },
    });

    await expect(
      adapter.publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000504",
          purpose: "rollback",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: delivery.contentChecksum,
          remoteScopeRef: delivery.remoteScopeRef,
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T07:50:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: "2026-07-27T08:10:00.000Z",
        },
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
      safeDetails: { reason: "authorization_purpose_mismatch" },
    });

    await expect(
      adapter.publishAndReconcile({
        credential: CREDENTIAL,
        scope: SCOPE,
        predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
        delivery,
        publishAuthorization: {
          authorizationGrantRef: "00000000-0000-4000-8000-000000000505",
          purpose: "publish",
          predecessorDeliveryReceiptId: "delivery-receipt-wp-1",
          contentChecksum: delivery.contentChecksum,
          remoteScopeRef: delivery.remoteScopeRef,
          expectedRemoteRevision: '"wp-revision-1"',
          authorizedAt: "2026-07-27T08:00:00.000Z",
          consumedAt: "2026-07-27T07:59:00.000Z",
          expiresAt: "2026-07-27T08:10:00.000Z",
        },
        expectedRemoteRevision: '"wp-revision-1"',
        expectedCanonicalUrl:
          "https://content.example.com/customer-onboarding/",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_APPROVAL_REQUIRED",
      safeDetails: { reason: "authorization_lineage_mismatch" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
