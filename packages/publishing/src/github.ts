import { computeContentChecksum } from "./checksum";
import {
  PublishingProviderError,
  isPublishingProviderError,
} from "./errors";
import {
  createBoundedJsonTransport,
  type BoundedTransportOptions,
} from "./http";
import { verifyLiveCanonical } from "./live";
import type { ChangeObservation, DeliveryObservation } from "./types";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_INSTALLATION_TOKEN_LIFETIME_MS = 65 * 60 * 1000;
const MAX_INSTALLATION_REPOSITORY_PAGES = 10;
const INSTALLATION_REPOSITORIES_PER_PAGE = 100;

export interface GitHubInstallationToken {
  /**
   * A short-lived installation token minted by the upstream GitHub App token
   * provider together with its provider-attested installation ID. This
   * package does not implement App callback/JWT exchange and never persists
   * or returns the token value.
   */
  readonly installationId: number;
  readonly value: string;
  readonly expiresAt: string;
}

export interface GitHubDestinationScope {
  readonly installationId: number;
  readonly repositoryId: number;
  readonly owner: string;
  readonly repository: string;
  readonly baseBranch: string;
  readonly allowedBranchPrefix: string;
  readonly contentPath: string;
}

export interface GitHubScopeProbe {
  readonly provider: "github";
  readonly ready: true;
  readonly observedAt: string;
  readonly providerRequestId: string | null;
  readonly remoteScopeRef: string;
  readonly repository: {
    readonly id: number;
    readonly owner: string;
    readonly name: string;
    readonly baseBranch: string;
  };
  readonly capabilities: {
    readonly metadataRead: true;
    readonly contentsRead: true;
    readonly contentsWrite: true;
    readonly pullRequestsWrite: true;
  };
  readonly limitations: readonly string[];
}

export type GitHubRemotePrecondition =
  | {
      readonly kind: "must_not_exist";
    }
  | {
      readonly kind: "match";
      readonly branchHeadSha: string;
      readonly contentSha: string;
    };

export interface GitHubDeliveryRemote {
  readonly repositoryId: number;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly branchName: string;
  readonly path: string;
}

export type GitHubDeliveryObservation =
  DeliveryObservation<GitHubDeliveryRemote> & {
    readonly provider: "github";
  };

export interface GitHubChangeEvidence {
  readonly mergedSha: string;
  readonly pullRequestNumber: number;
  readonly liveProviderRequestId: string | null;
}

export type GitHubChangeObservation =
  ChangeObservation<GitHubChangeEvidence> & {
    readonly provider: "github";
  };

export type GitHubAdapterOptions = BoundedTransportOptions;

export interface GitHubPublishingAdapter {
  probeScope(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
  }): Promise<GitHubScopeProbe>;
  createOrUpdateDelivery(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
    readonly branchName: string;
    readonly path: string;
    readonly content: string | Uint8Array;
    readonly commitMessage: string;
    readonly pullRequest: {
      readonly title: string;
      readonly body: string;
    };
    readonly remotePrecondition: GitHubRemotePrecondition;
  }): Promise<GitHubDeliveryObservation>;
  reconcileMergedChange(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
    readonly predecessorDeliveryReceiptId: string;
    readonly delivery: GitHubDeliveryObservation;
    readonly expectedHeadSha: string;
    readonly deployment: {
      readonly liveUrl: string;
      readonly expectedCanonicalUrl: string;
      readonly revisionHeader: string;
    };
  }): Promise<GitHubChangeObservation>;
}

interface GitHubRepositoryList {
  readonly repositories: readonly {
    readonly id?: number;
    readonly full_name?: string;
  }[];
}

interface GitHubRepository {
  readonly id?: number;
  readonly full_name?: string;
  readonly archived?: boolean;
  readonly disabled?: boolean;
  readonly default_branch?: string;
  readonly permissions?: {
    readonly pull?: boolean;
    readonly push?: boolean;
  };
}

interface GitReference {
  readonly object?: {
    readonly sha?: string;
  };
}

interface GitHubContent {
  readonly sha?: string;
}

interface GitHubContentWrite {
  readonly content?: {
    readonly sha?: string;
  };
  readonly commit?: {
    readonly sha?: string;
  };
}

interface GitHubPullRequest {
  readonly number?: number;
  readonly html_url?: string;
  readonly state?: string;
  readonly merged?: boolean;
  readonly merge_commit_sha?: string | null;
  readonly head?: {
    readonly sha?: string;
  };
  readonly base?: {
    readonly sha?: string;
  };
}

export function createGitHubPublishingAdapter(
  options: GitHubAdapterOptions,
): GitHubPublishingAdapter {
  const transport = createBoundedJsonTransport(options);

  async function probeScope(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
  }): Promise<GitHubScopeProbe> {
    validateScope(input.scope);
    validateToken(input.token, input.scope.installationId, options.now());
    const headers = githubHeaders(input.token);

    let selected = false;
    let installationProviderRequestId: string | null = null;
    for (
      let page = 1;
      page <= MAX_INSTALLATION_REPOSITORY_PAGES;
      page += 1
    ) {
      const installation = await transport.request<GitHubRepositoryList>({
        provider: "github",
        operation: "probe_installation",
        method: "GET",
        url:
          `${GITHUB_API_ORIGIN}/installation/repositories` +
          `?per_page=${INSTALLATION_REPOSITORIES_PER_PAGE}&page=${page}`,
        allowedOrigins: [GITHUB_API_ORIGIN],
        headers,
        secrets: [input.token.value],
        retry: "safe_read",
      });
      installationProviderRequestId = installation.providerRequestId;
      const repositories = requireInstallationRepositoryPage(
        installation.body,
        installation.providerRequestId,
      );
      selected = repositories.some(
        ({ id, full_name: fullName }) =>
          id === input.scope.repositoryId &&
          fullName?.toLowerCase() ===
            `${input.scope.owner}/${input.scope.repository}`.toLowerCase(),
      );
      if (selected) {
        break;
      }

      const hasNextPage = validateInstallationNextPage(
        installation.headers,
        page,
        installation.providerRequestId,
      );
      if (!hasNextPage) {
        break;
      }
      if (page === MAX_INSTALLATION_REPOSITORY_PAGES) {
        throw new PublishingProviderError({
          code: "REMOTE_UNAVAILABLE",
          provider: "github",
          operation: "probe_installation",
          message: "GitHub installation repository pagination exceeded its limit.",
          retryable: true,
          providerRequestId: installation.providerRequestId,
          remoteScopeRef: installationScopeRef(input.scope),
          safeDetails: { state: "pagination_cap" },
        });
      }
    }
    if (!selected) {
      throw new PublishingProviderError({
        code: "SCOPE_REVOKED",
        provider: "github",
        operation: "probe_installation",
        message: "Selected repository is no longer in the installation scope.",
        providerRequestId: installationProviderRequestId,
        remoteScopeRef: installationScopeRef(input.scope),
      });
    }

    const repository = await transport.request<GitHubRepository>({
      provider: "github",
      operation: "probe_repository",
      method: "GET",
      url: repositoryApiUrl(input.scope),
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      retry: "safe_read",
    });
    const expectedFullName =
      `${input.scope.owner}/${input.scope.repository}`.toLowerCase();
    const repositoryMatches =
      repository.body.id === input.scope.repositoryId &&
      repository.body.full_name?.toLowerCase() === expectedFullName &&
      repository.body.default_branch === input.scope.baseBranch &&
      repository.body.archived !== true &&
      repository.body.disabled !== true;
    const canRead = repository.body.permissions?.pull === true;
    const canWrite = repository.body.permissions?.push === true;
    if (!repositoryMatches || !canRead || !canWrite) {
      throw new PublishingProviderError({
        code: "SCOPE_DENIED",
        provider: "github",
        operation: "probe_repository",
        message: "Repository identity or required permissions are unavailable.",
        providerRequestId: repository.providerRequestId,
        remoteScopeRef: installationScopeRef(input.scope),
      });
    }

    return {
      provider: "github",
      ready: true,
      observedAt: options.now().toISOString(),
      providerRequestId: repository.providerRequestId,
      remoteScopeRef: installationScopeRef(input.scope),
      repository: {
        id: input.scope.repositoryId,
        owner: input.scope.owner,
        name: input.scope.repository,
        baseBranch: input.scope.baseBranch,
      },
      capabilities: {
        metadataRead: true,
        contentsRead: true,
        contentsWrite: true,
        pullRequestsWrite: true,
      },
      limitations: [],
    };
  }

  async function createOrUpdateDelivery(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
    readonly branchName: string;
    readonly path: string;
    readonly content: string | Uint8Array;
    readonly commitMessage: string;
    readonly pullRequest: {
      readonly title: string;
      readonly body: string;
    };
    readonly remotePrecondition: GitHubRemotePrecondition;
  }): Promise<GitHubDeliveryObservation> {
    validateDeliveryInput(input);
    await probeScope({ token: input.token, scope: input.scope });
    const headers = githubHeaders(input.token);
    const repositoryUrl = repositoryApiUrl(input.scope);

    const base = await transport.request<GitReference>({
      provider: "github",
      operation: "read_base_revision",
      method: "GET",
      url: `${repositoryUrl}/git/ref/heads/${encodePath(input.scope.baseBranch)}`,
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      retry: "safe_read",
    });
    const baseSha = requireString(
      base.body.object?.sha,
      "github",
      "read_base_revision",
      base.providerRequestId,
    );

    const branch = await transport.request<GitReference>({
      provider: "github",
      operation: "read_delivery_branch",
      method: "GET",
      url: `${repositoryUrl}/git/ref/heads/${encodePath(input.branchName)}`,
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      retry: "safe_read",
      acceptedStatuses: [404],
    });
    let branchHeadSha: string;
    if (branch.status === 404) {
      const created = await transport.request<GitReference>({
        provider: "github",
        operation: "create_delivery_branch",
        method: "POST",
        url: `${repositoryUrl}/git/refs`,
        allowedOrigins: [GITHUB_API_ORIGIN],
        headers,
        secrets: [input.token.value],
        body: {
          ref: `refs/heads/${input.branchName}`,
          sha: baseSha,
        },
        retry: "never",
      });
      branchHeadSha = requireString(
        created.body.object?.sha,
        "github",
        "create_delivery_branch",
        created.providerRequestId,
      );
    } else {
      branchHeadSha = requireString(
        branch.body.object?.sha,
        "github",
        "read_delivery_branch",
        branch.providerRequestId,
      );
    }

    const contentUrl =
      `${repositoryUrl}/contents/${encodePath(input.path)}` +
      `?ref=${encodeURIComponent(input.branchName)}`;
    const remoteContent = await transport.request<GitHubContent>({
      provider: "github",
      operation: "verify_remote_revision",
      method: "GET",
      url: contentUrl,
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      retry: "safe_read",
      acceptedStatuses: [404],
    });
    assertGitHubRemotePrecondition(
      input.remotePrecondition,
      branchHeadSha,
      remoteContent,
    );

    const bytes =
      typeof input.content === "string"
        ? Buffer.from(input.content, "utf8")
        : Buffer.from(input.content);
    const writeBody: Record<string, unknown> = {
      message: input.commitMessage,
      content: bytes.toString("base64"),
      branch: input.branchName,
    };
    if (remoteContent.status !== 404) {
      writeBody.sha = remoteContent.body.sha;
    }
    const committed = await transport.request<GitHubContentWrite>({
      provider: "github",
      operation: "commit_exact_content",
      method: "PUT",
      url: `${repositoryUrl}/contents/${encodePath(input.path)}`,
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      body: writeBody,
      retry: "never",
    });
    const commitSha = requireString(
      committed.body.commit?.sha,
      "github",
      "commit_exact_content",
      committed.providerRequestId,
    );

    let pull: {
      readonly value: GitHubPullRequest;
      readonly providerRequestId: string | null;
    };
    try {
      const pullList =
        await transport.request<readonly GitHubPullRequest[]>({
          provider: "github",
          operation: "find_pull_request",
          method: "GET",
          url:
            `${repositoryUrl}/pulls?state=open` +
            `&head=${encodeURIComponent(`${input.scope.owner}:${input.branchName}`)}` +
            `&base=${encodeURIComponent(input.scope.baseBranch)}`,
          allowedOrigins: [GITHUB_API_ORIGIN],
          headers,
          secrets: [input.token.value],
          retry: "safe_read",
        });
      const existing = pullList.body[0];
      if (existing === undefined) {
        const createdPull = await transport.request<GitHubPullRequest>({
          provider: "github",
          operation: "create_or_update_pull_request",
          method: "POST",
          url: `${repositoryUrl}/pulls`,
          allowedOrigins: [GITHUB_API_ORIGIN],
          headers,
          secrets: [input.token.value],
          body: {
            title: input.pullRequest.title,
            body: input.pullRequest.body,
            head: input.branchName,
            base: input.scope.baseBranch,
          },
          retry: "never",
        });
        pull = {
          value: createdPull.body,
          providerRequestId: createdPull.providerRequestId,
        };
      } else {
        const pullNumber = requirePositiveInteger(
          existing.number,
          "github",
          "find_pull_request",
          pullList.providerRequestId,
        );
        const updatedPull = await transport.request<GitHubPullRequest>({
          provider: "github",
          operation: "create_or_update_pull_request",
          method: "PATCH",
          url: `${repositoryUrl}/pulls/${pullNumber}`,
          allowedOrigins: [GITHUB_API_ORIGIN],
          headers,
          secrets: [input.token.value],
          body: {
            title: input.pullRequest.title,
            body: input.pullRequest.body,
            base: input.scope.baseBranch,
          },
          retry: "never",
        });
        pull = {
          value: updatedPull.body,
          providerRequestId: updatedPull.providerRequestId,
        };
      }
    } catch (error) {
      if (!isPublishingProviderError(error)) {
        throw error;
      }
      throw new PublishingProviderError({
        code: "PARTIAL_DELIVERY",
        provider: "github",
        operation: "create_or_update_pull_request",
        message:
          "Content commit succeeded but Pull Request state is not confirmed.",
        retryable: true,
        providerRequestId: error.providerRequestId,
        remoteScopeRef: `github:repository:${input.scope.repositoryId}:branch:${input.branchName}`,
        safeDetails: {
          stage: "pull_request",
          repositoryId: input.scope.repositoryId,
          branchName: input.branchName,
          committedRevision: commitSha,
        },
      });
    }

    const pullNumber = requirePositiveInteger(
      pull.value.number,
      "github",
      "create_or_update_pull_request",
      pull.providerRequestId,
    );
    const pullRequestUrl = requireGitHubPullRequestUrl(
      pull.value.html_url,
      input.scope,
      pullNumber,
      pull.providerRequestId,
    );
    if (
      pull.value.state !== "open" ||
      pull.value.head?.sha !== commitSha ||
      pull.value.base?.sha !== baseSha
    ) {
      throw invalidResponse(
        "github",
        "create_or_update_pull_request",
        pull.providerRequestId,
      );
    }

    return {
      kind: "delivery",
      provider: "github",
      state: "pending",
      observedAt: options.now().toISOString(),
      providerRequestId: pull.providerRequestId,
      contentChecksum: computeContentChecksum(bytes),
      remoteScopeRef: `github:repository:${input.scope.repositoryId}:pull:${pullNumber}`,
      remote: {
        repositoryId: input.scope.repositoryId,
        pullRequestNumber: pullNumber,
        pullRequestUrl,
        headSha: commitSha,
        baseSha,
        branchName: input.branchName,
        path: input.path,
      },
    };
  }

  async function reconcileMergedChange(input: {
    readonly token: GitHubInstallationToken;
    readonly scope: GitHubDestinationScope;
    readonly predecessorDeliveryReceiptId: string;
    readonly delivery: GitHubDeliveryObservation;
    readonly expectedHeadSha: string;
    readonly deployment: {
      readonly liveUrl: string;
      readonly expectedCanonicalUrl: string;
      readonly revisionHeader: string;
    };
  }): Promise<GitHubChangeObservation> {
    validateChangeInput(input);
    await probeScope({ token: input.token, scope: input.scope });
    const headers = githubHeaders(input.token);
    const repositoryUrl = repositoryApiUrl(input.scope);
    const pullUrl =
      `${repositoryUrl}/pulls/${input.delivery.remote.pullRequestNumber}`;
    const pull = await transport.request<GitHubPullRequest>({
      provider: "github",
      operation: "reconcile_pull_request",
      method: "GET",
      url: pullUrl,
      allowedOrigins: [GITHUB_API_ORIGIN],
      headers,
      secrets: [input.token.value],
      retry: "safe_read",
    });
    if (
      pull.body.number !==
        input.delivery.remote.pullRequestNumber ||
      pull.body.head?.sha !== input.expectedHeadSha
    ) {
      throw remoteStale(
        "github",
        "reconcile_pull_request",
        pull.providerRequestId,
        input.delivery.remoteScopeRef,
      );
    }
    if (
      pull.body.merged !== true ||
      typeof pull.body.merge_commit_sha !== "string" ||
      pull.body.merge_commit_sha.length === 0
    ) {
      throw new PublishingProviderError({
        code: "REMOTE_UNAVAILABLE",
        provider: "github",
        operation: "reconcile_pull_request",
        message: "Pull Request is pending a human merge.",
        retryable: true,
        providerRequestId: pull.providerRequestId,
        remoteScopeRef: input.delivery.remoteScopeRef,
        safeDetails: { state: "pending_merge" },
      });
    }
    const mergedSha = pull.body.merge_commit_sha;

    const live = await verifyLiveCanonical({
      transport,
      provider: "github",
      operation: "reconcile_live_deployment",
      liveUrl: input.deployment.liveUrl,
      expectedCanonicalUrl: input.deployment.expectedCanonicalUrl,
      expectedRevision: mergedSha,
      revisionHeader: input.deployment.revisionHeader,
    });

    return {
      kind: "change",
      provider: "github",
      state: "verified",
      observedAt: options.now().toISOString(),
      predecessorDeliveryReceiptId:
        input.predecessorDeliveryReceiptId,
      contentChecksum: input.delivery.contentChecksum,
      remoteScopeRef: input.delivery.remoteScopeRef,
      providerRequestId: pull.providerRequestId,
      liveCanonicalUrl: live.canonicalUrl,
      remoteRevision: mergedSha,
      evidence: {
        mergedSha,
        pullRequestNumber: input.delivery.remote.pullRequestNumber,
        liveProviderRequestId: live.providerRequestId,
      },
    };
  }

  return {
    probeScope,
    createOrUpdateDelivery,
    reconcileMergedChange,
  };
}

function requireInstallationRepositoryPage(
  body: GitHubRepositoryList,
  providerRequestId: string | null,
): GitHubRepositoryList["repositories"] {
  const repositories = body.repositories;
  if (
    !Array.isArray(repositories) ||
    repositories.length > INSTALLATION_REPOSITORIES_PER_PAGE ||
    repositories.some(
      ({ id, full_name: fullName }) =>
        !Number.isSafeInteger(id) ||
        (id ?? 0) <= 0 ||
        typeof fullName !== "string" ||
        fullName.length === 0 ||
        fullName.length > 256 ||
        !/^[^/\s]+\/[^/\s]+$/u.test(fullName),
    )
  ) {
    throw invalidInstallationResponse(providerRequestId);
  }
  return repositories;
}

function validateInstallationNextPage(
  headers: Headers,
  currentPage: number,
  providerRequestId: string | null,
): boolean {
  const link = headers.get("link");
  if (link === null) {
    return false;
  }

  const entries = link.split(",").map((entry) => entry.trim());
  let nextUrl: string | null = null;
  for (const entry of entries) {
    const match = entry.match(
      /^<([^<>]+)>\s*;\s*rel="([^"]+)"(?:\s*;\s*[A-Za-z0-9_-]+=(?:"[^"]*"|[^,\s;]+))*$/u,
    );
    if (match === null) {
      throw invalidInstallationResponse(providerRequestId);
    }
    const relations = (match[2] ?? "").split(/\s+/u);
    if (!relations.includes("next")) {
      continue;
    }
    if (nextUrl !== null) {
      throw invalidInstallationResponse(providerRequestId);
    }
    nextUrl = match[1] ?? null;
  }
  if (nextUrl === null) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(nextUrl);
  } catch {
    throw invalidInstallationResponse(providerRequestId);
  }
  const perPage = parsed.searchParams.getAll("per_page");
  const page = parsed.searchParams.getAll("page");
  if (
    parsed.origin !== GITHUB_API_ORIGIN ||
    parsed.pathname !== "/installation/repositories" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0 ||
    [...parsed.searchParams.keys()].length !== 2 ||
    perPage.length !== 1 ||
    perPage[0] !== String(INSTALLATION_REPOSITORIES_PER_PAGE) ||
    page.length !== 1 ||
    page[0] !== String(currentPage + 1)
  ) {
    throw invalidInstallationResponse(providerRequestId);
  }
  return true;
}

function invalidInstallationResponse(
  providerRequestId: string | null,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "INVALID_RESPONSE",
    provider: "github",
    operation: "probe_installation",
    message: "GitHub installation repository pagination was invalid.",
    providerRequestId,
  });
}

function validateToken(
  token: GitHubInstallationToken,
  expectedInstallationId: number,
  now: Date,
): void {
  const expiresAt = Date.parse(token.expiresAt);
  if (
    token.value.length === 0 ||
    !Number.isSafeInteger(token.installationId) ||
    token.installationId <= 0 ||
    !Number.isFinite(expiresAt)
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "github",
      operation: "validate_installation_token",
      message: "GitHub installation token input is invalid.",
    });
  }
  if (token.installationId !== expectedInstallationId) {
    throw new PublishingProviderError({
      code: "SCOPE_DENIED",
      provider: "github",
      operation: "validate_installation_token",
      message: "GitHub installation token does not match the destination.",
      remoteScopeRef:
        `github:installation:${expectedInstallationId}:repository:unknown`,
    });
  }
  const remainingMs = expiresAt - now.getTime();
  if (remainingMs <= 0) {
    throw new PublishingProviderError({
      code: "TOKEN_EXPIRED",
      provider: "github",
      operation: "validate_installation_token",
      message: "GitHub installation token has expired.",
    });
  }
  if (remainingMs > MAX_INSTALLATION_TOKEN_LIFETIME_MS) {
    throw new PublishingProviderError({
      code: "TOKEN_LIFETIME_INVALID",
      provider: "github",
      operation: "validate_installation_token",
      message: "GitHub installation token is not short-lived.",
    });
  }
}

function validateScope(scope: GitHubDestinationScope): void {
  const segment = /^[A-Za-z0-9_.-]+$/u;
  if (
    !Number.isSafeInteger(scope.installationId) ||
    scope.installationId <= 0 ||
    !Number.isSafeInteger(scope.repositoryId) ||
    scope.repositoryId <= 0 ||
    !segment.test(scope.owner) ||
    !segment.test(scope.repository) ||
    scope.baseBranch.length === 0 ||
    scope.allowedBranchPrefix.length === 0 ||
    !isCanonicalContentPath(scope.contentPath)
  ) {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: "github",
      operation: "validate_destination_scope",
      message: "GitHub destination scope is invalid.",
    });
  }
}

function validateDeliveryInput(input: {
  readonly scope: GitHubDestinationScope;
  readonly branchName: string;
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly commitMessage: string;
  readonly pullRequest: {
    readonly title: string;
    readonly body: string;
  };
}): void {
  validateScope(input.scope);
  if (
    !input.branchName.startsWith(input.scope.allowedBranchPrefix) ||
    input.branchName.includes("..") ||
    input.path !== input.scope.contentPath ||
    input.content.length === 0 ||
    input.commitMessage.trim().length === 0 ||
    input.pullRequest.title.trim().length === 0
  ) {
    throw new PublishingProviderError({
      code: "SCOPE_DENIED",
      provider: "github",
      operation: "validate_delivery_scope",
      message: "GitHub delivery target is outside the destination scope.",
    });
  }
}

function isCanonicalContentPath(path: string): boolean {
  const segments = path.split("/");
  return (
    path.length > 0 &&
    path.length <= 1_024 &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("\\") &&
    !hasAsciiControlCharacter(path) &&
    segments.every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? -1;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function validateChangeInput(input: {
  readonly scope: GitHubDestinationScope;
  readonly predecessorDeliveryReceiptId: string;
  readonly delivery: GitHubDeliveryObservation;
  readonly expectedHeadSha: string;
}): void {
  validateScope(input.scope);
  const expectedScope =
    `github:repository:${input.scope.repositoryId}:pull:` +
    `${input.delivery.remote.pullRequestNumber}`;
  if (
    input.predecessorDeliveryReceiptId.length === 0 ||
    input.delivery.provider !== "github" ||
    input.delivery.remote.repositoryId !== input.scope.repositoryId ||
    input.delivery.remote.path !== input.scope.contentPath ||
    input.delivery.remoteScopeRef !== expectedScope ||
    input.delivery.remote.headSha !== input.expectedHeadSha
  ) {
    throw new PublishingProviderError({
      code: "LINEAGE_MISMATCH",
      provider: "github",
      operation: "validate_change_lineage",
      message: "GitHub delivery lineage does not match this change.",
    });
  }
}

function assertGitHubRemotePrecondition(
  precondition: GitHubRemotePrecondition,
  branchHeadSha: string,
  remote: { readonly status: number; readonly body: GitHubContent },
): void {
  if (
    precondition.kind === "must_not_exist"
      ? remote.status !== 404
      : remote.status === 404 ||
        precondition.branchHeadSha !== branchHeadSha ||
        precondition.contentSha !== remote.body.sha
  ) {
    throw remoteStale(
      "github",
      "verify_remote_revision",
      null,
      null,
    );
  }
}

function githubHeaders(
  token: GitHubInstallationToken,
): Readonly<Record<string, string>> {
  return {
    authorization: `Bearer ${token.value}`,
    "user-agent": "Nevermore-Publishing/0.4",
    "x-github-api-version": "2022-11-28",
  };
}

function installationScopeRef(scope: GitHubDestinationScope): string {
  return (
    `github:installation:${scope.installationId}:repository:` +
    `${scope.repositoryId}`
  );
}

function repositoryApiUrl(scope: GitHubDestinationScope): string {
  return (
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(scope.owner)}/` +
    encodeURIComponent(scope.repository)
  );
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function requireString(
  value: string | null | undefined,
  provider: "github",
  operation: string,
  providerRequestId: string | null,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidResponse(provider, operation, providerRequestId);
  }
  return value;
}

function requirePositiveInteger(
  value: number | undefined,
  provider: "github",
  operation: string,
  providerRequestId: string | null,
): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) {
    throw invalidResponse(provider, operation, providerRequestId);
  }
  return value as number;
}

function requireGitHubPullRequestUrl(
  value: string | undefined,
  scope: GitHubDestinationScope,
  pullRequestNumber: number,
  providerRequestId: string | null,
): string {
  if (typeof value !== "string") {
    throw invalidResponse(
      "github",
      "create_or_update_pull_request",
      providerRequestId,
    );
  }
  try {
    const url = new URL(value);
    const expectedPath =
      `/${scope.owner}/${scope.repository}/pull/${pullRequestNumber}`;
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://github.com" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      url.pathname.toLowerCase() !== expectedPath.toLowerCase()
    ) {
      throw new Error("invalid");
    }
    return url.href;
  } catch {
    throw invalidResponse(
      "github",
      "create_or_update_pull_request",
      providerRequestId,
    );
  }
}

function invalidResponse(
  provider: "github",
  operation: string,
  providerRequestId: string | null,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "INVALID_RESPONSE",
    provider,
    operation,
    message: "GitHub returned incomplete or inconsistent provider facts.",
    providerRequestId,
  });
}

function remoteStale(
  provider: "github",
  operation: string,
  providerRequestId: string | null,
  remoteScopeRef: string | null,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "REMOTE_STALE",
    provider,
    operation,
    message: "GitHub remote revision no longer matches the preview.",
    providerRequestId,
    remoteScopeRef,
  });
}
