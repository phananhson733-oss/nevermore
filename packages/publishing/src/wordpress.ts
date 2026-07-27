import { computeContentChecksum } from "./checksum";
import { PublishingProviderError } from "./errors";
import {
  createBoundedJsonTransport,
  type BoundedTransportOptions,
} from "./http";
import {
  normalizeCanonicalUrl,
  verifyLiveCanonical,
} from "./live";
import type { ChangeObservation, DeliveryObservation } from "./types";

export interface WordPressCredential {
  /**
   * Plaintext resolved immediately before a provider call from an upstream
   * encrypted-secret reference. The adapter never persists, returns, or logs
   * this value.
   */
  readonly authorizationValue: string;
}

/**
 * Server-issued, expiring authorization bound to one immutable delivery
 * lineage. Client-provided booleans are intentionally insufficient.
 */
export interface WordPressWriteAuthorization {
  readonly authorizationGrantRef: string;
  readonly purpose: "publish" | "rollback";
  readonly predecessorDeliveryReceiptId: string;
  readonly contentChecksum: string;
  readonly remoteScopeRef: string;
  readonly expectedRemoteRevision: string;
  /** Server time at which this exact immutable grant was issued. */
  readonly authorizedAt: string;
  /** Server time at which attempt acceptance atomically consumed the grant. */
  readonly consumedAt: string;
  /**
   * Grant-consumption deadline, not credential freshness. The credential or
   * provider token may independently expire and must be resolved at execution.
   */
  readonly expiresAt: string;
}

export type WordPressDeliveryStatus = "draft" | "future";

export interface WordPressDestinationScope {
  readonly siteOrigin: string;
  readonly authenticatedUserId: number;
  readonly allowedAuthorIds: readonly number[];
  readonly allowedStatuses: readonly WordPressDeliveryStatus[];
  /** WordPress REST collection bases, for example `posts` or `pages`. */
  readonly allowedPostTypes: readonly string[];
}

export interface WordPressScopeProbe {
  readonly provider: "wordpress";
  readonly ready: true;
  readonly observedAt: string;
  readonly providerRequestId: string | null;
  readonly remoteScopeRef: string;
  readonly site: {
    readonly origin: string;
    readonly name: string;
  };
  readonly authenticatedUserId: number;
  readonly capabilities: {
    readonly postsCreate: true;
    readonly postsEdit: true;
    readonly postsPublish: boolean;
  };
  readonly allowedPostTypes: readonly string[];
  readonly allowedAuthorIds: readonly number[];
  readonly allowedStatuses: readonly WordPressDeliveryStatus[];
  readonly limitations: readonly string[];
}

export type WordPressRemotePrecondition =
  | {
      readonly kind: "must_not_exist";
    }
  | {
      readonly kind: "match";
      readonly revision: string;
    };

export interface WordPressDeliveryRemote {
  readonly siteOrigin: string;
  readonly postId: number;
  readonly postType: string;
  readonly status: WordPressDeliveryStatus;
  readonly revision: string;
  readonly editUrl: string;
  readonly previewUrl: string;
}

export type WordPressDeliveryObservation =
  DeliveryObservation<WordPressDeliveryRemote> & {
    readonly provider: "wordpress";
  };

export interface WordPressChangeEvidence {
  readonly postId: number;
  readonly status: "publish";
  readonly liveProviderRequestId: string | null;
}

export type WordPressChangeObservation =
  ChangeObservation<WordPressChangeEvidence> & {
    readonly provider: "wordpress";
  };

export type WordPressAdapterOptions = BoundedTransportOptions;

export interface WordPressPublishingAdapter {
  probeScope(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
  }): Promise<WordPressScopeProbe>;
  createOrUpdateDelivery(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
    readonly postId?: number;
    readonly postType: string;
    readonly title: string;
    readonly slug: string;
    readonly content: string;
    readonly excerpt?: string;
    readonly authorId: number;
    readonly status: WordPressDeliveryStatus | "publish";
    readonly scheduledAt?: string;
    readonly canonicalExpectation: string;
    readonly remotePrecondition: WordPressRemotePrecondition;
  }): Promise<WordPressDeliveryObservation>;
  publishAndReconcile(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
    readonly predecessorDeliveryReceiptId: string;
    readonly delivery: WordPressDeliveryObservation;
    readonly publishAuthorization: WordPressWriteAuthorization | null;
    readonly expectedRemoteRevision: string;
    readonly expectedCanonicalUrl: string;
  }): Promise<WordPressChangeObservation>;
}

interface WordPressRoot {
  readonly name?: string;
  readonly url?: string;
  readonly home?: string;
}

interface WordPressUser {
  readonly id?: number;
  readonly capabilities?: Readonly<Record<string, boolean>>;
}

interface WordPressType {
  readonly slug?: string;
  readonly rest_base?: string;
  readonly capabilities?: Readonly<Record<string, string>>;
}

type WordPressTypeCollection = Readonly<
  Record<string, WordPressType>
>;

interface WordPressPost {
  readonly id?: number;
  readonly status?: string;
  readonly slug?: string;
  readonly author?: number;
  readonly modified_gmt?: string;
  readonly link?: string;
  readonly _links?: {
    readonly "wp:preview"?: readonly {
      readonly href?: string;
    }[];
  };
}

export function createWordPressPublishingAdapter(
  options: WordPressAdapterOptions,
): WordPressPublishingAdapter {
  const transport = createBoundedJsonTransport(options);

  async function probeScope(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
  }): Promise<WordPressScopeProbe> {
    const siteOrigin = validateScope(input.scope);
    validateCredential(input.credential);
    const headers = wordpressHeaders(input.credential);

    const root = await transport.request<WordPressRoot>({
      provider: "wordpress",
      operation: "probe_site",
      method: "GET",
      url: `${siteOrigin}/wp-json/`,
      allowedOrigins: [siteOrigin],
      headers,
      secrets: [input.credential.authorizationValue],
      retry: "safe_read",
    });
    if (
      originOf(root.body.url) !== siteOrigin ||
      originOf(root.body.home) !== siteOrigin
    ) {
      throw new PublishingProviderError({
        code: "SCOPE_REVOKED",
        provider: "wordpress",
        operation: "probe_site",
        message: "WordPress site identity no longer matches the destination.",
        providerRequestId: root.providerRequestId,
        remoteScopeRef: wordpressSiteScopeRef(siteOrigin),
      });
    }
    const siteName = requireString(
      root.body.name,
      "probe_site",
      root.providerRequestId,
    );

    const user = await transport.request<WordPressUser>({
      provider: "wordpress",
      operation: "probe_identity",
      method: "GET",
      url: `${siteOrigin}/wp-json/wp/v2/users/me?context=edit`,
      allowedOrigins: [siteOrigin],
      headers,
      secrets: [input.credential.authorizationValue],
      retry: "safe_read",
    });
    const authenticatedUserId = requirePositiveInteger(
      user.body.id,
      "probe_identity",
      user.providerRequestId,
    );
    if (authenticatedUserId !== input.scope.authenticatedUserId) {
      throw new PublishingProviderError({
        code: "SCOPE_REVOKED",
        provider: "wordpress",
        operation: "probe_identity",
        message: "WordPress authenticated user no longer matches the destination.",
        providerRequestId: user.providerRequestId,
        remoteScopeRef: wordpressSiteScopeRef(siteOrigin),
      });
    }
    const canEdit = user.body.capabilities?.edit_posts === true;
    const canPublish = user.body.capabilities?.publish_posts === true;
    if (!canEdit) {
      throw new PublishingProviderError({
        code: "SCOPE_DENIED",
        provider: "wordpress",
        operation: "probe_identity",
        message: "WordPress credential cannot create or edit posts.",
        providerRequestId: user.providerRequestId,
        remoteScopeRef: wordpressSiteScopeRef(siteOrigin),
      });
    }

    let finalRequestId = user.providerRequestId;
    let customTypes:
      | {
          readonly body: WordPressTypeCollection;
          readonly providerRequestId: string | null;
        }
      | null = null;
    for (const restBase of input.scope.allowedPostTypes) {
      const builtInSlug = typeSlugForRestBase(restBase);
      let type: WordPressType | null;
      let providerRequestId: string | null;
      if (builtInSlug !== null) {
        const response = await transport.request<WordPressType>({
          provider: "wordpress",
          operation: "probe_post_type",
          method: "GET",
          url:
            `${siteOrigin}/wp-json/wp/v2/types/` +
            encodeURIComponent(builtInSlug) +
            "?context=edit",
          allowedOrigins: [siteOrigin],
          headers,
          secrets: [input.credential.authorizationValue],
          retry: "safe_read",
        });
        type = isWordPressTypeCapability(
          response.body,
          restBase,
          builtInSlug,
        )
          ? response.body
          : null;
        providerRequestId = response.providerRequestId;
      } else {
        customTypes ??=
          await transport.request<WordPressTypeCollection>({
            provider: "wordpress",
            operation: "probe_post_type",
            method: "GET",
            url: `${siteOrigin}/wp-json/wp/v2/types?context=edit`,
            allowedOrigins: [siteOrigin],
            headers,
            secrets: [input.credential.authorizationValue],
            retry: "safe_read",
          });
        type = findCustomWordPressType(customTypes.body, restBase);
        providerRequestId = customTypes.providerRequestId;
      }
      if (type === null) {
        throw new PublishingProviderError({
          code: "SCOPE_DENIED",
          provider: "wordpress",
          operation: "probe_post_type",
          message: "WordPress post type is not available in this destination.",
          providerRequestId,
          remoteScopeRef: wordpressSiteScopeRef(siteOrigin),
        });
      }
      finalRequestId = providerRequestId;
    }

    return {
      provider: "wordpress",
      ready: true,
      observedAt: options.now().toISOString(),
      providerRequestId: finalRequestId,
      remoteScopeRef: wordpressSiteScopeRef(siteOrigin),
      site: {
        origin: siteOrigin,
        name: siteName,
      },
      authenticatedUserId,
      capabilities: {
        postsCreate: true,
        postsEdit: true,
        postsPublish: canPublish,
      },
      allowedPostTypes: [...input.scope.allowedPostTypes],
      allowedAuthorIds: [...input.scope.allowedAuthorIds],
      allowedStatuses: [...input.scope.allowedStatuses],
      limitations: canPublish ? [] : ["publish_capability_unavailable"],
    };
  }

  async function createOrUpdateDelivery(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
    readonly postId?: number;
    readonly postType: string;
    readonly title: string;
    readonly slug: string;
    readonly content: string;
    readonly excerpt?: string;
    readonly authorId: number;
    readonly status: WordPressDeliveryStatus | "publish";
    readonly scheduledAt?: string;
    readonly canonicalExpectation: string;
    readonly remotePrecondition: WordPressRemotePrecondition;
  }): Promise<WordPressDeliveryObservation> {
    const siteOrigin = validateDeliveryInput(input, options.now());
    const deliveryStatus = input.status as WordPressDeliveryStatus;
    await probeScope({ credential: input.credential, scope: input.scope });
    const headers = wordpressHeaders(input.credential);
    const endpoint =
      `${siteOrigin}/wp-json/wp/v2/${encodeURIComponent(input.postType)}`;

    let current: {
      readonly status: number;
      readonly body: WordPressPost;
      readonly revision: string;
    } | null = null;
    if (input.postId !== undefined) {
      const existing = await transport.request<WordPressPost>({
        provider: "wordpress",
        operation: "verify_remote_revision",
        method: "GET",
        url: `${endpoint}/${input.postId}?context=edit`,
        allowedOrigins: [siteOrigin],
        headers,
        secrets: [input.credential.authorizationValue],
        retry: "safe_read",
      });
      current = {
        status: existing.status,
        body: existing.body,
        revision: extractRevision(existing.headers, existing.body),
      };
    }
    assertWordPressRemotePrecondition(
      input.remotePrecondition,
      input.postId,
      current,
    );

    const writeHeaders: Record<string, string> = { ...headers };
    if (current !== null) {
      writeHeaders["if-match"] = current.revision;
    }
    const writeBody: Record<string, unknown> = {
      title: input.title,
      slug: input.slug,
      content: input.content,
      author: input.authorId,
      status: deliveryStatus,
    };
    if (input.excerpt !== undefined) {
      writeBody.excerpt = input.excerpt;
    }
    if (deliveryStatus === "future") {
      writeBody.date_gmt = input.scheduledAt;
    }

    const written = await transport.request<WordPressPost>({
      provider: "wordpress",
      operation:
        input.postId === undefined ? "create_post" : "update_post",
      method: "POST",
      url:
        input.postId === undefined
          ? endpoint
          : `${endpoint}/${input.postId}`,
      allowedOrigins: [siteOrigin],
      headers: writeHeaders,
      secrets: [input.credential.authorizationValue],
      body: writeBody,
      retry: "never",
    });
    const postId = requirePositiveInteger(
      written.body.id,
      input.postId === undefined ? "create_post" : "update_post",
      written.providerRequestId,
    );
    if (
      written.body.status !== deliveryStatus ||
      written.body.author !== input.authorId ||
      written.body.slug !== input.slug
    ) {
      throw invalidWordPressResponse(
        input.postId === undefined ? "create_post" : "update_post",
        written.providerRequestId,
      );
    }
    const revision = extractRevision(written.headers, written.body);
    const liveLink = requireString(
      written.body.link,
      input.postId === undefined ? "create_post" : "update_post",
      written.providerRequestId,
    );
    const expectedCanonical = normalizeCanonicalUrl(
      input.canonicalExpectation,
      "wordpress",
      "validate_canonical_expectation",
    );
    if (
      normalizeCanonicalUrl(
        liveLink,
        "wordpress",
        "validate_canonical_expectation",
      ) !== expectedCanonical
    ) {
      throw new PublishingProviderError({
        code: "INVALID_RESPONSE",
        provider: "wordpress",
        operation: "validate_canonical_expectation",
        message: "WordPress post URL does not match the frozen expectation.",
        providerRequestId: written.providerRequestId,
      });
    }
    const previewUrl = requireScopedWordPressUrl(
      written.body._links?.["wp:preview"]?.[0]?.href ??
        withPreviewQuery(liveLink),
      siteOrigin,
      "validate_preview_url",
      written.providerRequestId,
    );

    return {
      kind: "delivery",
      provider: "wordpress",
      state: "pending",
      observedAt: options.now().toISOString(),
      providerRequestId: written.providerRequestId,
      contentChecksum: computeContentChecksum(input.content),
      remoteScopeRef: `${wordpressSiteScopeRef(siteOrigin)}:post:${postId}`,
      remote: {
        siteOrigin,
        postId,
        postType: input.postType,
        status: deliveryStatus,
        revision,
        editUrl:
          `${siteOrigin}/wp-admin/post.php?post=${postId}` +
          "&action=edit",
        previewUrl,
      },
    };
  }

  async function publishAndReconcile(input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
    readonly predecessorDeliveryReceiptId: string;
    readonly delivery: WordPressDeliveryObservation;
    readonly publishAuthorization: WordPressWriteAuthorization | null;
    readonly expectedRemoteRevision: string;
    readonly expectedCanonicalUrl: string;
  }): Promise<WordPressChangeObservation> {
    validatePublishAuthorization(input);
    const siteOrigin = validateChangeInput(input);
    const probe = await probeScope({
      credential: input.credential,
      scope: input.scope,
    });
    if (!probe.capabilities.postsPublish) {
      throw new PublishingProviderError({
        code: "SCOPE_DENIED",
        provider: "wordpress",
        operation: "publish_post",
        message: "WordPress credential does not have publish capability.",
        providerRequestId: probe.providerRequestId,
        remoteScopeRef: input.delivery.remoteScopeRef,
      });
    }
    const headers = wordpressHeaders(input.credential);
    const postUrl =
      `${siteOrigin}/wp-json/wp/v2/` +
      `${encodeURIComponent(input.delivery.remote.postType)}/` +
      `${input.delivery.remote.postId}`;
    const beforePublish = await transport.request<WordPressPost>({
      provider: "wordpress",
      operation: "verify_remote_revision",
      method: "GET",
      url: `${postUrl}?context=edit`,
      allowedOrigins: [siteOrigin],
      headers,
      secrets: [input.credential.authorizationValue],
      retry: "safe_read",
    });
    const currentRevision = extractRevision(
      beforePublish.headers,
      beforePublish.body,
    );
    if (
      currentRevision !== input.expectedRemoteRevision ||
      beforePublish.body.id !== input.delivery.remote.postId
    ) {
      throw new PublishingProviderError({
        code: "REMOTE_STALE",
        provider: "wordpress",
        operation: "verify_remote_revision",
        message: "WordPress post revision no longer matches the preview.",
        providerRequestId: beforePublish.providerRequestId,
        remoteScopeRef: input.delivery.remoteScopeRef,
      });
    }

    const published = await transport.request<WordPressPost>({
      provider: "wordpress",
      operation: "publish_post",
      method: "POST",
      url: postUrl,
      allowedOrigins: [siteOrigin],
      headers: {
        ...headers,
        "if-match": input.expectedRemoteRevision,
      },
      secrets: [input.credential.authorizationValue],
      body: { status: "publish" },
      retry: "never",
    });
    if (
      published.body.id !== input.delivery.remote.postId ||
      published.body.status !== "publish"
    ) {
      throw invalidWordPressResponse(
        "publish_post",
        published.providerRequestId,
      );
    }
    const publishedRevision = extractRevision(
      published.headers,
      published.body,
    );

    const reconciled = await transport.request<WordPressPost>({
      provider: "wordpress",
      operation: "reconcile_published_post",
      method: "GET",
      url: `${postUrl}?context=edit`,
      allowedOrigins: [siteOrigin],
      headers,
      secrets: [input.credential.authorizationValue],
      retry: "safe_read",
    });
    const reconciledRevision = extractRevision(
      reconciled.headers,
      reconciled.body,
    );
    const expectedCanonical = normalizeCanonicalUrl(
      input.expectedCanonicalUrl,
      "wordpress",
      "reconcile_published_post",
    );
    if (
      reconciled.body.id !== input.delivery.remote.postId ||
      reconciled.body.status !== "publish" ||
      reconciledRevision !== publishedRevision ||
      normalizeCanonicalUrl(
        requireString(
          reconciled.body.link,
          "reconcile_published_post",
          reconciled.providerRequestId,
        ),
        "wordpress",
        "reconcile_published_post",
      ) !== expectedCanonical
    ) {
      throw new PublishingProviderError({
        code: "REMOTE_UNAVAILABLE",
        provider: "wordpress",
        operation: "reconcile_published_post",
        message: "Published WordPress revision is not yet reconcilable.",
        retryable: true,
        providerRequestId: reconciled.providerRequestId,
        remoteScopeRef: input.delivery.remoteScopeRef,
      });
    }

    const live = await verifyLiveCanonical({
      transport,
      provider: "wordpress",
      operation: "reconcile_live_canonical",
      liveUrl: expectedCanonical,
      expectedCanonicalUrl: expectedCanonical,
    });

    return {
      kind: "change",
      provider: "wordpress",
      state: "verified",
      observedAt: options.now().toISOString(),
      predecessorDeliveryReceiptId:
        input.predecessorDeliveryReceiptId,
      contentChecksum: input.delivery.contentChecksum,
      remoteScopeRef: input.delivery.remoteScopeRef,
      providerRequestId: published.providerRequestId,
      liveCanonicalUrl: live.canonicalUrl,
      remoteRevision: publishedRevision,
      evidence: {
        postId: input.delivery.remote.postId,
        status: "publish",
        liveProviderRequestId: live.providerRequestId,
      },
    };
  }

  return {
    probeScope,
    createOrUpdateDelivery,
    publishAndReconcile,
  };
}

function validatePublishAuthorization(
  input: {
    readonly predecessorDeliveryReceiptId: string;
    readonly delivery: WordPressDeliveryObservation;
    readonly publishAuthorization: WordPressWriteAuthorization | null;
    readonly expectedRemoteRevision: string;
  },
): void {
  const authorization = input.publishAuthorization;
  if (authorization === null) {
    throw publishAuthorizationError("authorization_missing");
  }
  const authorizedAt = Date.parse(authorization.authorizedAt);
  const consumedAt = Date.parse(authorization.consumedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (
    !Number.isFinite(authorizedAt) ||
    !Number.isFinite(consumedAt) ||
    !Number.isFinite(expiresAt) ||
    consumedAt < authorizedAt
  ) {
    throw publishAuthorizationError("authorization_lineage_mismatch");
  }
  if (consumedAt > expiresAt) {
    throw publishAuthorizationError("authorization_expired");
  }
  if (authorization.purpose !== "publish") {
    throw publishAuthorizationError("authorization_purpose_mismatch");
  }
  if (
    !isUuid(authorization.authorizationGrantRef) ||
    authorization.predecessorDeliveryReceiptId !==
      input.predecessorDeliveryReceiptId ||
    !/^[a-f0-9]{64}$/u.test(authorization.contentChecksum) ||
    authorization.contentChecksum !== input.delivery.contentChecksum ||
    authorization.remoteScopeRef !== input.delivery.remoteScopeRef ||
    authorization.expectedRemoteRevision !==
      input.expectedRemoteRevision ||
    input.delivery.remote.revision !== input.expectedRemoteRevision
  ) {
    throw publishAuthorizationError("authorization_lineage_mismatch");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function publishAuthorizationError(reason: string): PublishingProviderError {
  return new PublishingProviderError({
    code: "PUBLISH_APPROVAL_REQUIRED",
    provider: "wordpress",
    operation: "publish_post",
    message: "A valid server-issued WordPress publish authorization is required.",
    safeDetails: { reason },
  });
}

function validateCredential(credential: WordPressCredential): void {
  if (
    credential.authorizationValue.trim().length === 0 ||
    /[\r\n]/u.test(credential.authorizationValue)
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "wordpress",
      operation: "validate_credential",
      message: "WordPress credential input is invalid.",
    });
  }
}

function validateScope(scope: WordPressDestinationScope): string {
  let origin: string;
  try {
    const parsed = new URL(scope.siteOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      throw new Error("invalid");
    }
    origin = parsed.origin;
  } catch {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "wordpress",
      operation: "validate_destination_scope",
      message: "WordPress destination origin is invalid.",
    });
  }
  if (
    !Number.isSafeInteger(scope.authenticatedUserId) ||
    scope.authenticatedUserId <= 0 ||
    scope.allowedAuthorIds.length === 0 ||
    scope.allowedAuthorIds.some(
      (authorId) => !Number.isSafeInteger(authorId) || authorId <= 0,
    ) ||
    scope.allowedStatuses.length === 0 ||
    scope.allowedPostTypes.length === 0 ||
    scope.allowedPostTypes.some(
      (postType) => !/^[a-z][a-z0-9_-]*$/u.test(postType),
    )
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "wordpress",
      operation: "validate_destination_scope",
      message: "WordPress destination scope is invalid.",
    });
  }
  return origin;
}

function validateDeliveryInput(
  input: {
    readonly credential: WordPressCredential;
    readonly scope: WordPressDestinationScope;
    readonly postId?: number;
    readonly postType: string;
    readonly title: string;
    readonly slug: string;
    readonly content: string;
    readonly authorId: number;
    readonly status: WordPressDeliveryStatus | "publish";
    readonly scheduledAt?: string;
    readonly canonicalExpectation: string;
    readonly remotePrecondition: WordPressRemotePrecondition;
  },
  now: Date,
): string {
  const origin = validateScope(input.scope);
  validateCredential(input.credential);
  if (input.status === "publish") {
    throw new PublishingProviderError({
      code: "DIRECT_PUBLISH_FORBIDDEN",
      provider: "wordpress",
      operation: "create_or_update_delivery",
      message:
        "Direct publish is forbidden; use a separate publish approval.",
    });
  }
  if (
    !input.scope.allowedAuthorIds.includes(input.authorId) ||
    !input.scope.allowedStatuses.includes(input.status) ||
    !input.scope.allowedPostTypes.includes(input.postType)
  ) {
    throw new PublishingProviderError({
      code: "SCOPE_DENIED",
      provider: "wordpress",
      operation: "validate_delivery_scope",
      message: "WordPress delivery target is outside destination scope.",
    });
  }
  if (
    input.title.trim().length === 0 ||
    input.slug.trim().length === 0 ||
    input.content.length === 0 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.slug) ||
    (input.postId !== undefined &&
      (!Number.isSafeInteger(input.postId) || input.postId <= 0)) ||
    (input.postId === undefined &&
      input.remotePrecondition.kind !== "must_not_exist") ||
    (input.postId !== undefined &&
      input.remotePrecondition.kind !== "match")
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "wordpress",
      operation: "validate_delivery_input",
      message: "WordPress delivery input is invalid.",
    });
  }
  if (
    input.status === "future" &&
    (input.scheduledAt === undefined ||
      !Number.isFinite(Date.parse(input.scheduledAt)) ||
      Date.parse(input.scheduledAt) <= now.getTime())
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "wordpress",
      operation: "validate_schedule",
      message: "Scheduled WordPress delivery must be in the future.",
    });
  }
  const canonical = normalizeCanonicalUrl(
    input.canonicalExpectation,
    "wordpress",
    "validate_canonical_expectation",
  );
  if (new URL(canonical).origin !== origin) {
    throw new PublishingProviderError({
      code: "SCOPE_DENIED",
      provider: "wordpress",
      operation: "validate_canonical_expectation",
      message: "WordPress canonical expectation is outside site scope.",
    });
  }
  return origin;
}

function validateChangeInput(input: {
  readonly scope: WordPressDestinationScope;
  readonly predecessorDeliveryReceiptId: string;
  readonly delivery: WordPressDeliveryObservation;
  readonly expectedRemoteRevision: string;
  readonly expectedCanonicalUrl: string;
}): string {
  const siteOrigin = validateScope(input.scope);
  const expectedScope =
    `${wordpressSiteScopeRef(siteOrigin)}:post:` +
    `${input.delivery.remote.postId}`;
  const canonical = normalizeCanonicalUrl(
    input.expectedCanonicalUrl,
    "wordpress",
    "validate_change_lineage",
  );
  if (
    input.predecessorDeliveryReceiptId.length === 0 ||
    input.expectedRemoteRevision.length === 0 ||
    input.delivery.provider !== "wordpress" ||
    input.delivery.remote.siteOrigin !== siteOrigin ||
    input.delivery.remoteScopeRef !== expectedScope ||
    new URL(canonical).origin !== siteOrigin
  ) {
    throw new PublishingProviderError({
      code: "LINEAGE_MISMATCH",
      provider: "wordpress",
      operation: "validate_change_lineage",
      message: "WordPress delivery lineage does not match this change.",
    });
  }
  return siteOrigin;
}

function assertWordPressRemotePrecondition(
  precondition: WordPressRemotePrecondition,
  postId: number | undefined,
  current: {
    readonly revision: string;
  } | null,
): void {
  if (
    precondition.kind === "must_not_exist"
      ? postId !== undefined || current !== null
      : current === null || current.revision !== precondition.revision
  ) {
    throw new PublishingProviderError({
      code: "REMOTE_STALE",
      provider: "wordpress",
      operation: "verify_remote_revision",
      message: "WordPress remote revision no longer matches the preview.",
    });
  }
}

function extractRevision(headers: Headers, post: WordPressPost): string {
  const revision = headers.get("etag") ?? post.modified_gmt;
  return requireString(revision, "read_remote_revision", null);
}

function wordpressHeaders(
  credential: WordPressCredential,
): Readonly<Record<string, string>> {
  return {
    authorization: credential.authorizationValue,
    "user-agent": "Nevermore-Publishing/0.4",
  };
}

function wordpressSiteScopeRef(siteOrigin: string): string {
  return `wordpress:${siteOrigin}`;
}

function typeSlugForRestBase(restBase: string): string | null {
  if (restBase === "posts") {
    return "post";
  }
  if (restBase === "pages") {
    return "page";
  }
  return null;
}

function isWordPressTypeCapability(
  value: unknown,
  restBase: string,
  expectedSlug?: string,
): value is WordPressType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = value as WordPressType;
  return (
    type.rest_base === restBase &&
    typeof type.slug === "string" &&
    /^[a-z][a-z0-9_-]*$/u.test(type.slug) &&
    (expectedSlug === undefined || type.slug === expectedSlug) &&
    typeof type.capabilities?.edit_posts === "string" &&
    /^[a-z][a-z0-9_]*$/u.test(type.capabilities.edit_posts)
  );
}

function findCustomWordPressType(
  collection: unknown,
  restBase: string,
): WordPressType | null {
  if (
    typeof collection !== "object" ||
    collection === null ||
    Array.isArray(collection)
  ) {
    return null;
  }
  const matches = Object.entries(collection).filter(
    ([slug, type]) =>
      isWordPressTypeCapability(type, restBase) &&
      type.slug === slug,
  );
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

function originOf(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function withPreviewQuery(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("preview", "true");
  return url.href;
}

function requireScopedWordPressUrl(
  value: string,
  siteOrigin: string,
  operation: string,
  providerRequestId: string | null,
): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== siteOrigin ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error("invalid");
    }
    return url.href;
  } catch {
    throw invalidWordPressResponse(operation, providerRequestId);
  }
}

function requireString(
  value: string | undefined,
  operation: string,
  providerRequestId: string | null,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidWordPressResponse(operation, providerRequestId);
  }
  return value;
}

function requirePositiveInteger(
  value: number | undefined,
  operation: string,
  providerRequestId: string | null,
): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) {
    throw invalidWordPressResponse(operation, providerRequestId);
  }
  return value as number;
}

function invalidWordPressResponse(
  operation: string,
  providerRequestId: string | null,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "INVALID_RESPONSE",
    provider: "wordpress",
    operation,
    message: "WordPress returned incomplete or inconsistent provider facts.",
    providerRequestId,
  });
}
