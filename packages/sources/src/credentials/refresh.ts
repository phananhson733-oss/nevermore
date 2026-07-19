import { SourceError } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  isAbortLike,
  readBoundedJson,
} from "../provider-http.ts";
import type { OAuthCredentialEnvelope } from "./envelope.ts";

/** Refresh early enough that an access token cannot expire during collection. */
export const GOOGLE_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;

/** Bound the row-lock transaction while the provider is unavailable. */
export const GOOGLE_TOKEN_REFRESH_TIMEOUT_MS = 10_000;

/** OAuth token payloads are tiny; reject anomalous provider bodies early. */
export const GOOGLE_TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;

/** Google's OAuth token endpoint. Exported so HTTP fixtures can match exactly. */
export const GOOGLE_OAUTH_TOKEN_ENDPOINT =
  "https://oauth2.googleapis.com/token";

export type GoogleTokenFetch = typeof globalThis.fetch;

export interface HttpGoogleTokenRefresherOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Defaults to global fetch in production; tests always inject a mock. */
  readonly fetch?: GoogleTokenFetch;
  /** Injectable clock keeps expiry persistence deterministic in tests. */
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

interface RawRefreshResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
}

/**
 * True only when a real RFC3339 expiry is at or inside the refresh window.
 * Missing/malformed expiries stay unknown; they are refreshed only after a 401.
 */
export function shouldRefreshCredential(
  envelope: OAuthCredentialEnvelope,
  now = new Date(),
  skewMs = GOOGLE_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (envelope.expiresAt === null) return false;
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= now.getTime() + skewMs;
}

function transientTransportError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  if (isAbortLike(error)) {
    return new SourceError("TIMEOUT", "Google token refresh timed out.");
  }
  return new SourceError(
    "NETWORK_ERROR",
    "Google token refresh could not reach the provider.",
  );
}

async function providerErrorCode(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<string | null> {
  const payload = await readBoundedJson(
    response,
    maxResponseBytes,
    "Google token refresh",
    signal,
  );
  if (payload === null || typeof payload !== "object") return null;
  const code = (payload as { readonly error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

async function mapFailedResponse(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<SourceError> {
  const providerCode =
    response.status === 400
      ? await providerErrorCode(response, maxResponseBytes, signal)
      : null;
  if (response.status !== 400) {
    await cancelResponseBody(response);
  }
  if (providerCode === "invalid_grant") {
    return new SourceError(
      "AUTH_REQUIRED",
      "Google authorization must be reconnected.",
    );
  }
  if (
    providerCode === "invalid_client" ||
    providerCode === "unauthorized_client" ||
    response.status === 401
  ) {
    return new SourceError(
      "INVALID_CONFIGURATION",
      "Google token refresh client credentials were rejected.",
    );
  }
  if (
    providerCode === "temporarily_unavailable" ||
    providerCode === "server_error"
  ) {
    return new SourceError(
      "NETWORK_ERROR",
      "Google token refresh is temporarily unavailable.",
    );
  }
  if (response.status === 408) {
    return new SourceError("TIMEOUT", "Google token refresh timed out.");
  }
  if (response.status === 429) {
    return new SourceError(
      "RATE_LIMITED",
      "Google token refresh was rate limited.",
    );
  }
  if (response.status >= 500) {
    return new SourceError(
      "NETWORK_ERROR",
      "Google token refresh is temporarily unavailable.",
    );
  }
  if (response.status === 403) {
    return new SourceError(
      "PERMISSION_DENIED",
      "Google token refresh was denied.",
    );
  }
  if (response.status === 400) {
    return new SourceError(
      "INVALID_CONFIGURATION",
      "Google token refresh request was rejected.",
    );
  }
  return new SourceError(
    "INVALID_RESPONSE",
    "Google token refresh returned an unexpected response.",
  );
}

function parseRefreshResponse(
  payload: unknown,
  previous: OAuthCredentialEnvelope,
  now: Date,
): OAuthCredentialEnvelope {
  if (payload === null || typeof payload !== "object") {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Google token refresh returned a malformed response.",
    );
  }
  const raw = payload as RawRefreshResponse;
  if (
    typeof raw.access_token !== "string" ||
    raw.access_token.trim() === "" ||
    typeof raw.expires_in !== "number" ||
    !Number.isFinite(raw.expires_in) ||
    raw.expires_in <= 0
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Google token refresh returned a malformed response.",
    );
  }

  const expiresAt = new Date(now.getTime() + raw.expires_in * 1_000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Google token refresh returned an invalid expiry.",
    );
  }
  return {
    accessToken: raw.access_token,
    refreshToken:
      typeof raw.refresh_token === "string" && raw.refresh_token !== ""
        ? raw.refresh_token
        : previous.refreshToken,
    expiresAt: expiresAt.toISOString(),
    scope: typeof raw.scope === "string" ? raw.scope : previous.scope,
  };
}

/** Minimal, injectable OAuth refresh-grant client. It never logs response bodies. */
export class HttpGoogleTokenRefresher {
  private readonly fetchImpl: GoogleTokenFetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: HttpGoogleTokenRefresherOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? GOOGLE_TOKEN_REFRESH_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? GOOGLE_TOKEN_RESPONSE_MAX_BYTES;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "Google token refresh timeout must be positive.",
      );
    }
    if (
      !Number.isFinite(this.maxResponseBytes) ||
      this.maxResponseBytes <= 0
    ) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "Google token refresh response size limit must be positive.",
      );
    }
  }

  async refresh(
    previous: OAuthCredentialEnvelope,
  ): Promise<OAuthCredentialEnvelope> {
    if (previous.refreshToken === null || previous.refreshToken.trim() === "") {
      throw new SourceError(
        "AUTH_REQUIRED",
        "Google authorization has no refresh token; reconnect required.",
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: previous.refreshToken,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });
    const abortScope = createRequestAbortScope(this.timeoutMs, []);
    try {
      const response = await this.fetchImpl(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: abortScope.signal,
      });
      if (!response.ok) {
        throw await mapFailedResponse(
          response,
          this.maxResponseBytes,
          abortScope.signal,
        );
      }

      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "Google token refresh",
        abortScope.signal,
      );
      return parseRefreshResponse(payload, previous, this.now());
    } catch (error) {
      throw transientTransportError(error);
    } finally {
      abortScope.cleanup();
    }
  }
}
