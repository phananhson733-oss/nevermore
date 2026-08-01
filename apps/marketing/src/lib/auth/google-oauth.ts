// @input  -- marketing-site Google OAuth env, an authorization code, an access token
// @output -- PKCE material, an auth URL, an exchanged token set, granted GSC properties
// @pos    -- the marketing site's own Google client, independent of apps/web
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The marketing site runs its OWN OAuth client.
 *
 * Same GCP project and consent screen as the product app, different client and
 * different secret: the two sites are meant to be independent, and sharing a
 * client secret would mean a compromise of either one is a compromise of both.
 */
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GSC_SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

/** Read-only, and the only sensitive scope this site ever asks for. */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Identity only. Non-sensitive, so One Tap can ship before consent-screen review. */
export const IDENTITY_SCOPES = "openid email profile";

const HTTP_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
/** Google returns at most a few hundred properties; a cap keeps a reply bounded. */
export const MAX_PROPERTIES = 500;

export class GoogleOAuthError extends Error {
  readonly code: "config" | "exchange" | "provider" | "denied";

  constructor(code: GoogleOAuthError["code"], message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/**
 * Read the marketing site's credentials.
 *
 * These are the variables the gengrowth.ai Vercel project has carried since the
 * previous codebase — the OAuth client was created for this domain, and its
 * redirect URI is already registered as
 * `https://gengrowth.ai/api/auth/google/callback`. There is nothing to create;
 * reusing them is correct and keeps this site's client distinct from the
 * product app's, which lives on a different project with its own credentials.
 */
export function readGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthError(
      "config",
      "Google OAuth is not configured for this site.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// ---------------------------------------------------------------------------
// PKCE + state (pure)
// ---------------------------------------------------------------------------

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** A high-entropy PKCE code verifier (RFC 7636: 43–128 chars). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(48));
}

export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(32));
}

/** Constant-time state comparison; a timing signal here is a CSRF oracle. */
export function stateMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildAuthUrl(input: {
  readonly config: GoogleOAuthConfig;
  readonly state: string;
  readonly codeChallenge: string;
  /** True for the Search Console grant; false for identity-only sign-in. */
  readonly includeSearchConsole: boolean;
  readonly loginHint?: string;
}): string {
  const scopes = input.includeSearchConsole
    ? `${IDENTITY_SCOPES} ${GSC_SCOPE}`
    : IDENTITY_SCOPES;
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Online access only: no refresh token is issued, so there is no long-lived
  // credential to store or leak. A public tool that runs while the visitor is
  // on the page does not need offline access.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("include_granted_scopes", "true");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange + property listing
// ---------------------------------------------------------------------------

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly grantedScopes: readonly string[];
  /** Google's stable subject id. The join key — never the email, which changes. */
  readonly sub: string | null;
  readonly email: string | null;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Read a JSON response, enforcing the cap against bytes as they arrive.
 *
 * The earlier version awaited `response.text()` and then measured the string,
 * which buffers the entire body before the limit can reject anything — a cap
 * that only reports oversize after paying its full cost is not a cap. Reading
 * from the stream and counting as we go makes it a real bound, and the
 * declared length short-circuits the obvious case without reading at all.
 */
async function readJson(response: Response, label: string): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new GoogleOAuthError("provider", `${label} response was too large.`);
  }

  if (!response.body) {
    throw new GoogleOAuthError("provider", `${label} returned no body.`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GoogleOAuthError(
          "provider",
          `${label} response was too large.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleOAuthError("provider", `${label} returned invalid JSON.`);
  }
}

/** Claims we need from the id_token. Signature is not verified here — see below. */
function readIdTokenClaims(idToken: unknown): {
  sub: string | null;
  email: string | null;
} {
  if (typeof idToken !== "string") return { sub: null, email: null };
  const payload = idToken.split(".")[1];
  if (!payload) return { sub: null, email: null };
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: unknown; email?: unknown };
    return {
      sub: typeof claims.sub === "string" ? claims.sub : null,
      email: typeof claims.email === "string" ? claims.email : null,
    };
  } catch {
    return { sub: null, email: null };
  }
}

/**
 * Exchange an authorization code for an access token.
 *
 * The id_token's signature is not verified because it does not need to be: it
 * arrived over TLS directly from Google's token endpoint in response to our
 * own authenticated request, which is exactly the case OpenID Connect permits
 * skipping verification for. An id_token arriving by any other path (One Tap,
 * for instance) MUST be verified before it is trusted.
 */
export async function exchangeCode(input: {
  readonly config: GoogleOAuthConfig;
  readonly code: string;
  readonly codeVerifier: string;
  readonly fetchImpl?: FetchLike;
}): Promise<GoogleTokenSet> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.config.redirectUri,
  });

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    // The provider body may echo the code or client_secret; it is never logged.
    throw new GoogleOAuthError(
      "exchange",
      "Google rejected the authorization code.",
    );
  }

  const payload = (await readJson(response, "Token exchange")) as {
    access_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    id_token?: unknown;
  };
  if (typeof payload.access_token !== "string") {
    throw new GoogleOAuthError("exchange", "Google returned no access token.");
  }

  const claims = readIdTokenClaims(payload.id_token);
  return {
    accessToken: payload.access_token,
    expiresInSeconds:
      typeof payload.expires_in === "number" ? payload.expires_in : 3_600,
    grantedScopes:
      typeof payload.scope === "string" ? payload.scope.split(" ") : [],
    sub: claims.sub,
    email: claims.email,
  };
}

/** Whether the grant actually includes Search Console. Users can uncheck it. */
export function hasSearchConsoleScope(scopes: readonly string[]): boolean {
  return scopes.includes(GSC_SCOPE);
}

/** Properties the visitor granted us read access to. */
export async function listSearchConsoleProperties(input: {
  readonly accessToken: string;
  readonly fetchImpl?: FetchLike;
}): Promise<readonly string[]> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(GSC_SITES_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new GoogleOAuthError(
      "provider",
      `Search Console site list failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await readJson(response, "Site list")) as {
    siteEntry?: unknown;
  };
  if (!Array.isArray(payload.siteEntry)) return [];

  return payload.siteEntry
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { siteUrl, permissionLevel } = entry as {
        siteUrl?: unknown;
        permissionLevel?: unknown;
      };
      if (typeof siteUrl !== "string") return [];
      // siteUnverifiedUser cannot read Search Analytics; offering the property
      // would produce a confusing failure later instead of an honest absence now.
      if (permissionLevel === "siteUnverifiedUser") return [];
      return [siteUrl];
    })
    .slice(0, MAX_PROPERTIES);
}
