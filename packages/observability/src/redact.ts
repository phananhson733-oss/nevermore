/**
 * Structured redaction for logs and telemetry (spec §14.3, §15.2).
 * Sensitive keys are replaced with a fixed marker; log payloads must never
 * carry OAuth tokens, credentials, cookies, or API keys.
 */

const REDACTED = "[redacted]";

/**
 * Credential-shaped values that must be removed even when a caller places them
 * under an innocuous key such as `message`, `summary`, or `body`.
 *
 * Key-only redaction is insufficient for upstream exceptions: provider clients
 * can interpolate credentials, Cookie headers, or encrypted payloads into an
 * `Error.message`. These patterns target credential formats and labelled
 * assignments rather than arbitrary long strings, so ordinary copy, hashes,
 * and correlation identifiers survive unchanged.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = [
  {
    pattern:
      /\b(authorization|token|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|apikey|password|cookie|set[_-]?cookie|session(?:[_-]?cookie)?|sf[_-]?session|encrypted[_-]?payload|pkce[_-]?verifier[_-]?cipher|token[_-]?cipher|ciphertext|credential[_-]?encryption[_-]?key)\b(\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
    replacement: "$1$2[redacted]",
  },
  {
    pattern: /([?&](?:state|code)=)[^&#\s]+/gi,
    replacement: "$1[redacted]",
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
    replacement: "Bearer [redacted]",
  },
  {
    pattern: /\bBasic\s+[A-Za-z0-9+/]{8,}=*/gi,
    replacement: "Basic [redacted]",
  },
  {
    pattern: /\bya29\.[0-9A-Za-z_-]{20,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b1\/\/[0-9A-Za-z_-]{20,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bGOCSPX-[0-9A-Za-z_-]{10,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
];

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

/** Redact credential-shaped values embedded in arbitrary text. */
export function redactText(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

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
  return typeof value === "string" ? redactText(value) : value;
}
