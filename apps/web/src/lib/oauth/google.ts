import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ProblemError } from "@sf/observability";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Google OAuth client for the GSC/GA4 connect flow (spec §7.4). Read-only scopes
 * only. PKCE (S256) + a 256-bit state are generated here; the DB stores only the
 * state HASH and an encrypted verifier. Live token exchange + property listing go
 * through `GoogleOAuthClient` (injectable so the connect flow is testable offline).
 */

export type GoogleProvider = "gsc" | "ga4";

export const GOOGLE_SCOPES: Record<GoogleProvider, string> = {
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
};

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GSC_SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";
const GA4_ACCOUNT_SUMMARIES =
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const GA4_ACCOUNT_PAGE_SIZE = 200;

/** Every OAuth/Admin API request is bounded so a provider stall cannot pin a web request. */
export const GOOGLE_OAUTH_HTTP_TIMEOUT_MS = 10_000;

/** Cap decoded Google JSON before parsing; provider bodies are never logged or echoed. */
export const GOOGLE_OAUTH_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

/** Bound the complete property-discovery chain, not merely each individual fetch. */
export const GOOGLE_OAUTH_OPERATION_TIMEOUT_MS = 30_000;

/** Maximum picker/intent payload for either provider. */
export const GOOGLE_OAUTH_MAX_CANDIDATES = 500;

/** Parallelize GA4 timezone reads without an unbounded provider fan-out. */
export const GA4_PROPERTY_DETAIL_CONCURRENCY = 8;

const GA4_ACCOUNT_PAGE_LIMIT = Math.ceil(
  GOOGLE_OAUTH_MAX_CANDIDATES / GA4_ACCOUNT_PAGE_SIZE,
);

// ---------------------------------------------------------------------------
// PKCE + state (pure).
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** A high-entropy PKCE code verifier (RFC 7636: 43–128 chars). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(48));
}

/** The S256 challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** A 256-bit random state value (opaque, returned in the auth URL). */
export function generateState(): string {
  return base64url(randomBytes(32));
}

/** sha256 of the state value — this is what the DB stores (never the raw state). */
export function hashState(state: string): Buffer {
  return createHash("sha256").update(state).digest();
}

/** Constant-time comparison of a candidate state against a stored hash. */
export function stateMatchesHash(state: string, storedHash: Buffer): boolean {
  const candidate = hashState(state);
  return (
    candidate.length === storedHash.length &&
    timingSafeEqual(candidate, storedHash)
  );
}

// ---------------------------------------------------------------------------
// Auth URL.
// ---------------------------------------------------------------------------

export function buildAuthUrl(input: {
  provider: GoogleProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES[input.provider]);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Client (token exchange + property listing).
// ---------------------------------------------------------------------------

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string; // RFC3339
  readonly scope: string;
}

export interface GoogleProperty {
  /** GSC siteUrl or GA4 numeric propertyId. */
  readonly externalPropertyId: string;
  readonly displayName: string;
  /** Present for GA4 and sourced from the Admin API property resource. */
  readonly propertyTimeZone?: string;
}

export interface GoogleOAuthClient {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleTokenSet>;
  listProperties(
    provider: GoogleProvider,
    accessToken: string,
  ): Promise<GoogleProperty[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface HttpClientDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/** Map a Google API failure to a stable product error without leaking bodies. */
function oauthError(status: number, context: string): ProblemError {
  if (status === 401)
    return new ProblemError(
      "AUTH_REQUIRED",
      `${context}: authorization expired.`,
    );
  if (status === 403)
    return new ProblemError(
      "OAUTH_PROPERTY_INVALID",
      `${context}: permission denied.`,
    );
  if (status === 429)
    return new ProblemError("RATE_LIMITED", `${context}: rate limited.`);
  return new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    `${context}: provider error.`,
  );
}

function abortLike(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("name" in error))
    return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function cancelResponseBody(response: Response): void {
  if (!response.body) return;
  try {
    void Promise.resolve(response.body.cancel()).catch(() => undefined);
  } catch {
    // Cancellation is resource cleanup only; the stable provider error wins.
  }
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("Google request aborted.", "AbortError")
  );
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof reader.read>>> {
  if (signal.aborted) throw abortReason(signal);

  return new Promise<Awaited<ReturnType<typeof reader.read>>>(
    (resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };
      const resolveOnce = (
        value: Awaited<ReturnType<typeof reader.read>>,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => rejectOnce(abortReason(signal));

      signal.addEventListener("abort", onAbort, { once: true });
      try {
        void reader.read().then(resolveOnce, rejectOnce);
      } catch (error) {
        rejectOnce(error);
      }
    },
  );
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void Promise.resolve(reader.cancel()).catch(() => undefined);
  } catch {
    // Cancellation cannot replace the stable timeout/size/transport problem.
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    const released: unknown = reader.releaseLock();
    void Promise.resolve(released).catch(() => undefined);
  } catch {
    // Releasing a broken provider stream must not replace the stable problem.
  }
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  context: string,
  signal: AbortSignal,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelResponseBody(response);
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      `${context}: response exceeded the size limit.`,
    );
  }
  if (!response.body) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      `${context}: malformed response.`,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          `${context}: response exceeded the size limit.`,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    releaseReader(reader);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      `${context}: malformed response.`,
    );
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await map(values[index]!);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () =>
      worker(),
    ),
  );
  return results;
}

function candidateLimitError(context: string): ProblemError {
  return new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    `${context}: provider candidate limit exceeded.`,
  );
}

export class HttpGoogleOAuthClient implements GoogleOAuthClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly deps: HttpClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((i, init) => fetch(i, init));
    this.timeoutMs = deps.timeoutMs ?? GOOGLE_OAUTH_HTTP_TIMEOUT_MS;
    this.operationTimeoutMs =
      deps.operationTimeoutMs ?? GOOGLE_OAUTH_OPERATION_TIMEOUT_MS;
    this.maxResponseBytes =
      deps.maxResponseBytes ?? GOOGLE_OAUTH_MAX_RESPONSE_BYTES;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Google OAuth HTTP timeout is misconfigured.",
      );
    }
    if (!Number.isFinite(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Google OAuth response limit is misconfigured.",
      );
    }
    if (
      !Number.isFinite(this.operationTimeoutMs) ||
      this.operationTimeoutMs <= 0
    ) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Google OAuth operation timeout is misconfigured.",
      );
    }
  }

  private async requestJson<T>(
    input: string,
    init: RequestInit,
    context: string,
    operationSignal?: AbortSignal,
  ): Promise<T> {
    const requestSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = operationSignal
      ? AbortSignal.any([requestSignal, operationSignal])
      : requestSignal;
    try {
      const response = await this.fetchImpl(input, {
        ...init,
        redirect: init.redirect ?? "error",
        signal,
      });
      if (!response.ok) {
        cancelResponseBody(response);
        throw oauthError(response.status, context);
      }
      return (await readBoundedJson(
        response,
        this.maxResponseBytes,
        context,
        signal,
      )) as T;
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      if (signal.aborted || abortLike(error)) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          `${context}: provider request timed out.`,
        );
      }
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        `${context}: provider request failed.`,
      );
    }
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleTokenSet> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
      code_verifier: input.codeVerifier,
    });
    const json = await this.requestJson<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>(
      TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      "token exchange",
    );
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "token exchange: malformed response.",
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      scope: json.scope ?? "",
    };
  }

  async listProperties(
    provider: GoogleProvider,
    accessToken: string,
  ): Promise<GoogleProperty[]> {
    const operationSignal = AbortSignal.timeout(this.operationTimeoutMs);
    return provider === "gsc"
      ? this.listGscSites(accessToken, operationSignal)
      : this.listGa4Properties(accessToken, operationSignal);
  }

  private async listGscSites(
    accessToken: string,
    operationSignal: AbortSignal,
  ): Promise<GoogleProperty[]> {
    const json = await this.requestJson<{
      siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
    }>(
      GSC_SITES_ENDPOINT,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      },
      "list GSC sites",
      operationSignal,
    );
    const entries = json.siteEntry ?? [];
    const candidates = entries
      .filter((e) => e.siteUrl && e.permissionLevel !== "siteUnverifiedUser")
      .map((e) => ({
        externalPropertyId: e.siteUrl as string,
        displayName: e.siteUrl as string,
      }));
    if (candidates.length > GOOGLE_OAUTH_MAX_CANDIDATES) {
      throw candidateLimitError("list GSC sites");
    }
    return candidates;
  }

  private async listGa4Properties(
    accessToken: string,
    operationSignal: AbortSignal,
  ): Promise<GoogleProperty[]> {
    const summaries = new Map<string, string>();
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;

    for (let page = 0; page < GA4_ACCOUNT_PAGE_LIMIT; page += 1) {
      const url = new URL(GA4_ACCOUNT_SUMMARIES);
      url.searchParams.set("pageSize", String(GA4_ACCOUNT_PAGE_SIZE));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await this.requestJson<{
        accountSummaries?: {
          propertySummaries?: { property?: string; displayName?: string }[];
        }[];
        nextPageToken?: string;
      }>(
        url.toString(),
        {
          headers: { authorization: `Bearer ${accessToken}` },
        },
        "list GA4 properties",
        operationSignal,
      );
      for (const account of json.accountSummaries ?? []) {
        for (const prop of account.propertySummaries ?? []) {
          if (!prop.property) continue;
          if (!/^properties\/\d+$/.test(prop.property)) {
            throw new ProblemError(
              "DEPENDENCY_UNAVAILABLE",
              "list GA4 properties: malformed property resource.",
            );
          }
          summaries.set(prop.property, prop.displayName ?? prop.property);
          if (summaries.size > GOOGLE_OAUTH_MAX_CANDIDATES) {
            throw candidateLimitError("list GA4 properties");
          }
        }
      }

      const next = json.nextPageToken;
      if (!next) break;
      if (seenPageTokens.has(next) || page === GA4_ACCOUNT_PAGE_LIMIT - 1) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "list GA4 properties: pagination did not terminate.",
        );
      }
      seenPageTokens.add(next);
      pageToken = next;
    }

    return mapWithConcurrency(
      [...summaries.entries()],
      GA4_PROPERTY_DETAIL_CONCURRENCY,
      async ([resourceName, displayName]) => {
        const detail = await this.requestJson<{ timeZone?: unknown }>(
          `${GA4_ADMIN_BASE}/${resourceName}`,
          { headers: { authorization: `Bearer ${accessToken}` } },
          "read GA4 property metadata",
          operationSignal,
        );
        const propertyTimeZone = detail.timeZone;
        if (
          typeof propertyTimeZone !== "string" ||
          !isSupportedTimeZone(propertyTimeZone)
        ) {
          throw new ProblemError(
            "DEPENDENCY_UNAVAILABLE",
            "read GA4 property metadata: timezone unavailable.",
          );
        }
        return {
          externalPropertyId: resourceName.replace(/^properties\//, ""),
          displayName,
          propertyTimeZone,
        };
      },
    );
  }
}

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** The callback redirect URI, derived from the app origin (spec §3.4). Carries the
 *  deployment base path so it matches the route when the app is mounted under a
 *  sub-path (e.g. `/app`); this exact URI must be registered in Google Cloud Console. */
export function googleRedirectUri(appOrigin: string): string {
  return new URL(
    `${BASE_PATH}/api/mvp/oauth/google/callback`,
    appOrigin,
  ).toString();
}
