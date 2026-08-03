// @input  -- POST body { url: string }; fetchPublicResource from @sf/sources/public-http
// @output -- handleUrlCheckRequest(): { reachable, statusCode, error, errorKey }
// @pos    -- URL reachability check, used by product/trial wizards before submission
// Once this file is updated, update the header comment and the folder _DIR.md
import dns from "node:dns/promises";
import {
  fetchPublicResource,
  type PublicResourceErrorCode,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "@sf/sources/public-http";
import { validateUrlPattern } from "../url-validation.ts";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/**
 * The caller only needs reachability and a status code, so the body is bounded
 * to a single byte. `fetchPublicResource` issues a GET rather than a HEAD; that
 * is deliberate. The previous implementation fell back to GET whenever a server
 * answered 405 to HEAD, and that fallback used `redirect: "follow"`, handing the
 * entire redirect chain to undici with no guard on any hop.
 */
const FETCH_OPTIONS: PublicResourceFetchOptions = {
  timeoutMs: TIMEOUT_MS,
  maxRedirects: MAX_REDIRECTS,
  maxBodyBytes: 1,
};

const SERVER_ERROR_STATUS = 500;

export interface UrlCheckResult {
  readonly reachable: boolean;
  readonly statusCode: number | null;
  readonly error: string | null;
  readonly errorKey: string | null;
}

export type UrlCheckOutcome =
  | { readonly kind: "result"; readonly value: UrlCheckResult }
  | {
      readonly kind: "bad_request";
      readonly code: string;
      readonly message: string;
    };

export interface UrlCheckDependencies {
  /** Resolves a hostname. Used only to phrase a typo'd domain, never to decide safety. */
  readonly resolveDns: (hostname: string) => Promise<unknown>;
  readonly fetchResource: (
    url: string,
    options: PublicResourceFetchOptions,
  ) => Promise<PublicResourceResult>;
}

export const DEFAULT_URL_CHECK_DEPENDENCIES: UrlCheckDependencies = {
  resolveDns: (hostname) => dns.resolve(hostname),
  fetchResource: (url, options) => fetchPublicResource(url, options),
};

function result(value: UrlCheckResult): UrlCheckOutcome {
  return { kind: "result", value };
}

function unreachable(error: string, errorKey: string): UrlCheckOutcome {
  return result({ reachable: false, statusCode: null, error, errorKey });
}

/**
 * Every address the guard refuses collapses into one indistinguishable answer.
 *
 * The previous implementation returned `NETWORK_ERROR` for a refused connection
 * and `TIMEOUT` for a dropped packet, which is exactly the primitive an
 * anonymous caller needs to map an internal network one host at a time. A
 * blocked target must therefore never reveal whether anything was listening —
 * and because the guard rejects before any socket is opened, there is nothing
 * to reveal.
 */
function blocked(): UrlCheckOutcome {
  return unreachable("SSRF_BLOCKED", "urlPrivateIp");
}

function mapFailure(code: PublicResourceErrorCode): UrlCheckOutcome {
  switch (code) {
    case "blocked":
      return blocked();
    case "timeout":
      return unreachable("TIMEOUT", "urlTimeout");
    // A redirect that leaves the allowed set, a malformed Location, or a chain
    // longer than the cap are all "we did not complete this check", not
    // evidence about the target's internals.
    case "cross_origin":
    case "invalid_redirect":
    case "redirect_limit":
    case "network":
    default:
      return unreachable("NETWORK_ERROR", "urlUnreachable");
  }
}

export async function handleUrlCheck(
  rawUrl: unknown,
  dependencies: UrlCheckDependencies = DEFAULT_URL_CHECK_DEPENDENCIES,
): Promise<UrlCheckOutcome> {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      kind: "bad_request",
      code: "MISSING_FIELD",
      message: "url is required",
    };
  }

  const pattern = validateUrlPattern(rawUrl);
  if (!pattern.valid) {
    return result({
      reachable: false,
      statusCode: null,
      error: "PATTERN_INVALID",
      errorKey: pattern.errorKey,
    });
  }

  // A name that does not resolve at all is a typo, not an internal target: an
  // internal host resolves fine and is stopped by the guard below. Reporting it
  // separately keeps the wizard's error message useful without opening an
  // oracle.
  const hostname = new URL(rawUrl).hostname;
  try {
    await dependencies.resolveDns(hostname);
  } catch {
    return unreachable("DNS_FAILED", "urlDnsError");
  }

  const response = await dependencies.fetchResource(rawUrl, FETCH_OPTIONS);
  if (response.kind === "error") {
    return mapFailure(response.code);
  }

  if (response.finalStatus >= SERVER_ERROR_STATUS) {
    return result({
      reachable: false,
      statusCode: response.finalStatus,
      error: "HTTP_ERROR",
      errorKey: "urlHttpError",
    });
  }

  return result({
    reachable: true,
    statusCode: response.finalStatus,
    error: null,
    errorKey: null,
  });
}
