/**
 * Structured redaction for logs and telemetry (spec §14.3, §15.2).
 * Sensitive keys are replaced with a fixed marker; log payloads must never
 * carry OAuth tokens, credentials, cookies, or API keys.
 */

const REDACTED = "[redacted]";
const UNAVAILABLE = "[unavailable]";
const UNSUPPORTED = "[unsupported]";
const TRUNCATED = "[truncated]";
const MAX_DEPTH = "[max-depth]";
const CIRCULAR = "[circular]";
const ACCESSOR = "[accessor]";
const BINARY = "[binary]";

export interface RedactLimits {
  readonly maxDepth: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
  readonly maxStringBytes: number;
  readonly maxVisitedNodes: number;
  readonly maxKeyBytes: number;
}

/**
 * General-purpose limits retain legitimate export-bundle payloads while still
 * bounding recursion and allocation. Log records use the tighter profile below.
 */
export const REDACT_LIMITS = Object.freeze({
  maxDepth: 32,
  maxObjectKeys: 100_000,
  maxArrayItems: 100_000,
  maxStringBytes: 64 * 1024 * 1024,
  maxVisitedNodes: 2_000_000,
  maxKeyBytes: 4_096,
}) satisfies RedactLimits;

/** Strict limits for values written to process logs. */
export const LOG_REDACT_LIMITS = Object.freeze({
  maxDepth: 8,
  maxObjectKeys: 64,
  maxArrayItems: 64,
  maxStringBytes: 4_096,
  maxVisitedNodes: 512,
  maxKeyBytes: 256,
}) satisfies RedactLimits;

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
      /\b(authorization|token|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|apikey|password|cookie|set[_-]?cookie|session(?:[_-]?cookie)?|sf[_-]?session|encrypted[_-]?payload|pkce[_-]?verifier[_-]?cipher|token[_-]?cipher|ciphertext|credential[_-]?encryption[_-]?key)\b(\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:(?:Bearer|Basic)\s+)?[^\s,;]+)/gi,
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
  "authorization",
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
const REDACT_QUERY_PARAMS_NORMALIZED: ReadonlySet<string> = new Set(
  [...REDACT_QUERY_PARAMS].map(normalizeKey),
);

interface RedactState {
  readonly active: WeakSet<object>;
  readonly limits: RedactLimits;
  remainingNodes: number;
}

function utf8LengthExceeds(value: string, maxBytes: number): boolean {
  if (value.length > maxBytes) return true;

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return true;
  }
  return false;
}

function redactTextWithin(value: string, maxBytes: number): string {
  if (utf8LengthExceeds(value, maxBytes)) return TRUNCATED;

  let redacted = value;
  for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** Redact credential-shaped values embedded in arbitrary text. */
export function redactText(value: string): string {
  return typeof value === "string"
    ? redactTextWithin(value, LOG_REDACT_LIMITS.maxStringBytes)
    : UNSUPPORTED;
}

/**
 * Redact a URL string: keep origin + path, strip obvious token/password/state
 * query parameters (spec §14.2 "URL logging first redaction").
 */
export function redactUrl(raw: string): string {
  if (typeof raw !== "string") return UNSUPPORTED;
  if (utf8LengthExceeds(raw, LOG_REDACT_LIMITS.maxStringBytes)) {
    return TRUNCATED;
  }
  try {
    const url = new URL(raw);
    let mutated = false;
    if (url.username !== "") {
      url.username = REDACTED;
      mutated = true;
    }
    if (url.password !== "") {
      url.password = REDACTED;
      mutated = true;
    }
    for (const name of [...url.searchParams.keys()]) {
      if (REDACT_QUERY_PARAMS_NORMALIZED.has(normalizeKey(name))) {
        url.searchParams.set(name, REDACTED);
        mutated = true;
      }
    }
    return mutated ? url.toString() : raw;
  } catch {
    return redactTextWithin(raw, LOG_REDACT_LIMITS.maxStringBytes);
  }
}

function readLimit(
  candidate: object,
  key: keyof RedactLimits,
  minimum: number,
): number {
  const fallback = REDACT_LIMITS[key];
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(candidate, key);
    const raw: unknown = descriptor?.value;
    return typeof raw === "number" &&
      Number.isSafeInteger(raw) &&
      raw >= minimum
      ? Math.min(raw, fallback)
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLimits(candidate: RedactLimits): RedactLimits {
  if (typeof candidate !== "object" || candidate === null) {
    return REDACT_LIMITS;
  }
  return {
    maxDepth: readLimit(candidate, "maxDepth", 0),
    maxObjectKeys: readLimit(candidate, "maxObjectKeys", 1),
    maxArrayItems: readLimit(candidate, "maxArrayItems", 1),
    maxStringBytes: readLimit(candidate, "maxStringBytes", 1),
    maxVisitedNodes: readLimit(candidate, "maxVisitedNodes", 1),
    maxKeyBytes: readLimit(candidate, "maxKeyBytes", 1),
  };
}

function defineData(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Reflect.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function markObjectTruncated(
  target: Record<string, unknown>,
  emittedKeys: string[],
  maxKeys: number,
): void {
  if (emittedKeys.length >= maxKeys) {
    const removed = emittedKeys.pop();
    if (removed !== undefined) Reflect.deleteProperty(target, removed);
  }
  defineData(target, TRUNCATED, TRUNCATED);
}

function redactArray(
  value: unknown[],
  state: RedactState,
  depth: number,
): unknown {
  if (state.active.has(value)) return CIRCULAR;
  if (depth >= state.limits.maxDepth) return MAX_DEPTH;

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  } catch {
    return UNAVAILABLE;
  }
  const rawLength: unknown = lengthDescriptor?.value;
  if (
    typeof rawLength !== "number" ||
    !Number.isSafeInteger(rawLength) ||
    rawLength < 0
  ) {
    return UNAVAILABLE;
  }

  const isWidthTruncated = rawLength > state.limits.maxArrayItems;
  const itemLimit = isWidthTruncated
    ? state.limits.maxArrayItems - 1
    : rawLength;
  const output: unknown[] = [];
  state.active.add(value);
  try {
    for (let index = 0; index < itemLimit; index += 1) {
      if (state.remainingNodes <= 0) {
        output.push(TRUNCATED);
        return output;
      }

      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      } catch {
        output.push(UNAVAILABLE);
        continue;
      }
      if (descriptor === undefined) {
        output.length += 1;
      } else if (!("value" in descriptor)) {
        output.push(ACCESSOR);
      } else {
        output.push(redactValue(descriptor.value, state, depth + 1));
      }
    }
    if (isWidthTruncated) output.push(TRUNCATED);
    return output;
  } finally {
    state.active.delete(value);
  }
}

function redactObject(
  value: object,
  state: RedactState,
  depth: number,
): unknown {
  if (state.active.has(value)) return CIRCULAR;
  if (depth >= state.limits.maxDepth) return MAX_DEPTH;

  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    return UNAVAILABLE;
  }
  if (prototype !== Object.prototype && prototype !== null) return UNSUPPORTED;

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return UNAVAILABLE;
  }

  const output: Record<string, unknown> = {};
  const emittedKeys: string[] = [];
  state.active.add(value);
  try {
    for (const key of keys) {
      if (typeof key !== "string") continue;
      if (
        state.remainingNodes <= 0 ||
        utf8LengthExceeds(key, state.limits.maxKeyBytes)
      ) {
        markObjectTruncated(
          output,
          emittedKeys,
          state.limits.maxObjectKeys,
        );
        break;
      }

      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        if (emittedKeys.length >= state.limits.maxObjectKeys) {
          markObjectTruncated(
            output,
            emittedKeys,
            state.limits.maxObjectKeys,
          );
          break;
        }
        defineData(output, key, UNAVAILABLE);
        emittedKeys.push(key);
        continue;
      }
      if (descriptor === undefined || descriptor.enumerable !== true) continue;
      if (emittedKeys.length >= state.limits.maxObjectKeys) {
        markObjectTruncated(
          output,
          emittedKeys,
          state.limits.maxObjectKeys,
        );
        break;
      }

      const redactedValue = REDACT_KEYS_NORMALIZED.has(normalizeKey(key))
        ? REDACTED
        : "value" in descriptor
          ? redactValue(descriptor.value, state, depth + 1)
          : ACCESSOR;
      defineData(output, key, redactedValue);
      emittedKeys.push(key);
    }
    return output;
  } finally {
    state.active.delete(value);
  }
}

function redactValue(
  value: unknown,
  state: RedactState,
  depth: number,
): unknown {
  if (state.remainingNodes <= 0) return TRUNCATED;
  state.remainingNodes -= 1;

  try {
    if (value === null || value === undefined) return value;
    switch (typeof value) {
      case "string":
        return redactTextWithin(value, state.limits.maxStringBytes);
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) ? value : UNSUPPORTED;
      case "bigint":
      case "function":
      case "symbol":
        return UNSUPPORTED;
      case "object":
        if (ArrayBuffer.isView(value)) return BINARY;
        if (Array.isArray(value)) return redactArray(value, state, depth);
        return redactObject(value, state, depth);
    }
  } catch {
    return UNAVAILABLE;
  }
  return UNSUPPORTED;
}

/**
 * Deep-redact an arbitrary value. Only own enumerable data properties from plain
 * objects are copied; accessors, hostile reflection traps, cycles, and values
 * that JSON cannot serialize are replaced with fixed markers.
 */
export function redact(
  value: unknown,
  limits: RedactLimits = REDACT_LIMITS,
): unknown {
  const safeLimits = normalizeLimits(limits);
  return redactValue(
    value,
    {
      active: new WeakSet(),
      limits: safeLimits,
      remainingNodes: safeLimits.maxVisitedNodes,
    },
    0,
  );
}
