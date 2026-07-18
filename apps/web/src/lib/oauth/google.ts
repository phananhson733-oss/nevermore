import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ProblemError } from "@sf/observability";

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
  return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
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
}

export interface GoogleOAuthClient {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleTokenSet>;
  listProperties(provider: GoogleProvider, accessToken: string): Promise<GoogleProperty[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface HttpClientDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: FetchLike;
}

/** Map a Google API failure to a stable product error without leaking bodies. */
function oauthError(status: number, context: string): ProblemError {
  if (status === 401) return new ProblemError("AUTH_REQUIRED", `${context}: authorization expired.`);
  if (status === 403) return new ProblemError("OAUTH_PROPERTY_INVALID", `${context}: permission denied.`);
  if (status === 429) return new ProblemError("RATE_LIMITED", `${context}: rate limited.`);
  return new ProblemError("DEPENDENCY_UNAVAILABLE", `${context}: provider error.`);
}

export class HttpGoogleOAuthClient implements GoogleOAuthClient {
  private readonly fetchImpl: FetchLike;
  constructor(private readonly deps: HttpClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((i, init) => fetch(i, init));
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
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw oauthError(res.status, "token exchange");
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw new ProblemError("DEPENDENCY_UNAVAILABLE", "token exchange: malformed response.");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      scope: json.scope ?? "",
    };
  }

  async listProperties(provider: GoogleProvider, accessToken: string): Promise<GoogleProperty[]> {
    return provider === "gsc"
      ? this.listGscSites(accessToken)
      : this.listGa4Properties(accessToken);
  }

  private async listGscSites(accessToken: string): Promise<GoogleProperty[]> {
    const res = await this.fetchImpl(GSC_SITES_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw oauthError(res.status, "list GSC sites");
    const json = (await res.json()) as {
      siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
    };
    const entries = json.siteEntry ?? [];
    return entries
      .filter((e) => e.siteUrl && e.permissionLevel !== "siteUnverifiedUser")
      .map((e) => ({ externalPropertyId: e.siteUrl as string, displayName: e.siteUrl as string }));
  }

  private async listGa4Properties(accessToken: string): Promise<GoogleProperty[]> {
    const res = await this.fetchImpl(GA4_ACCOUNT_SUMMARIES, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw oauthError(res.status, "list GA4 properties");
    const json = (await res.json()) as {
      accountSummaries?: {
        propertySummaries?: { property?: string; displayName?: string }[];
      }[];
    };
    const out: GoogleProperty[] = [];
    for (const account of json.accountSummaries ?? []) {
      for (const prop of account.propertySummaries ?? []) {
        if (!prop.property) continue;
        const id = prop.property.replace(/^properties\//, "");
        out.push({ externalPropertyId: id, displayName: prop.displayName ?? prop.property });
      }
    }
    return out;
  }
}

/** The callback redirect URI, derived from the app origin (spec §3.4). */
export function googleRedirectUri(appOrigin: string): string {
  return new URL("/api/mvp/oauth/google/callback", appOrigin).toString();
}
