/**
 * Structured redaction for logs and telemetry (spec §14.3, §15.2).
 * Sensitive keys are replaced with a fixed marker; log payloads must never
 * carry OAuth tokens, credentials, cookies, or API keys.
 */

const REDACTED = "[redacted]";

/** Case-insensitive key names that must never appear in log output. */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "password",
  "secret",
  "encrypted_payload",
  "pkce_verifier_cipher",
  "token_cipher",
  "state_hash",
  "credential_encryption_key",
]);

/** Query-string parameters whose values are redacted before a URL is logged. */
const REDACT_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "token",
  "access_token",
  "refresh_token",
  "password",
  "state",
  "code",
  "client_secret",
  "api_key",
  "apikey",
  "key",
]);

/**
 * Normalize a key for matching: lowercase and drop `_`/`-` so the snake, kebab,
 * and camelCase spellings of one secret (`access_token` / `access-token` /
 * `accessToken`) all collapse to a single comparable form. The domain speaks
 * camelCase in JSON, so matching only the snake_case spelling would leak a field
 * literally named `accessToken` / `refreshToken` / `clientSecret`.
 */
const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[_-]/g, "");

/** `REDACT_KEYS` collapsed to the normalized form used for case/-/_-insensitive matching. */
const REDACT_KEYS_NORMALIZED: ReadonlySet<string> = new Set(
  [...REDACT_KEYS].map(normalizeKey),
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Redact a URL string: keep origin + path, strip obvious token/password/state
 * query parameters (spec §14.2 "URL logging first redaction").
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    let mutated = false;
    for (const name of [...url.searchParams.keys()]) {
      if (REDACT_QUERY_PARAMS.has(name.toLowerCase())) {
        url.searchParams.set(name, REDACTED);
        mutated = true;
      }
    }
    return mutated ? url.toString() : raw;
  } catch {
    return raw;
  }
}

/**
 * Deep-redact an arbitrary value for logging. Objects are copied (never mutated);
 * sensitive keys are masked; cycles are guarded.
 */
export function redact(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = REDACT_KEYS_NORMALIZED.has(normalizeKey(key))
        ? REDACTED
        : redact(val, seen);
    }
    return out;
  }
  return value;
}
