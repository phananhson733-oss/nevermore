export type RuntimeEnvironment = string | undefined;

export interface RuntimeHttpUrlPolicy {
  /** Require a bare origin: no path, query, fragment, or URL userinfo. */
  readonly originOnly?: boolean;
}

const NON_PRODUCTION_ENVIRONMENTS = new Set(["development", "test"]);
const CANONICAL_LOOPBACK_HTTP_URL =
  /^http:\/\/(?:localhost|127(?:\.(?:0|[1-9]\d{0,2})){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const SUPABASE_SUPAVISOR_HOST = /\.pooler\.supabase\.com$/i;
const SUPABASE_DB_HOST = /^db\..+\.supabase\.co$/i;
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function hasCanonicalLoopbackAuthority(value: string, url: URL): boolean {
  // WHATWG URL parsing normalizes legacy octal/hex/integer IPv4 spellings.
  // Check the original authority too so the allowlist cannot grow implicitly.
  return (
    isLoopbackHostname(url.hostname) && CANONICAL_LOOPBACK_HTTP_URL.test(value)
  );
}

/** Return a fixed validation issue, never the URL or any embedded credentials. */
export function runtimeHttpUrlIssue(
  value: string,
  environment: RuntimeEnvironment,
  policy: RuntimeHttpUrlPolicy = {},
): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an absolute HTTP(S) URL";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "must use the http: or https: protocol";
  }
  if (url.username !== "" || url.password !== "") {
    return "must not include URL userinfo";
  }
  if (policy.originOnly) {
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      return "must be a bare origin without a path, query, or fragment";
    }
  } else if (url.hash !== "") {
    return "must not include a URL fragment";
  }

  if (url.protocol === "http:") {
    const explicitNonProduction = NON_PRODUCTION_ENVIRONMENTS.has(
      environment ?? "",
    );
    if (!explicitNonProduction || !hasCanonicalLoopbackAuthority(value, url)) {
      return "must use HTTPS; HTTP is allowed only for loopback development/test endpoints";
    }
  }
  return null;
}

/** Validate only the database transport; errors never include connection contents. */
export function postgresUrlIssue(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an absolute PostgreSQL URL";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return "must use the postgres: or postgresql: protocol";
  }
  if (
    url.port === SUPABASE_TRANSACTION_POOLER_PORT &&
    (SUPABASE_SUPAVISOR_HOST.test(url.hostname) ||
      SUPABASE_DB_HOST.test(url.hostname))
  ) {
    return "must not use a Supabase transaction-pooler URL; use a direct connection or Supavisor session mode instead";
  }
  return null;
}
