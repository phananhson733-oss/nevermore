import { createHash } from "node:crypto";

/**
 * Canonical JSON + sha256 primitives (spec §6.2, §7.6, §8.6, §10.5).
 *
 * Content addressing is used across the system for stable identity: ICP profile
 * `contentHash`, cross-run `findingKey`, `actionKey`, artifact `contentHash`, and
 * export manifest hashes. All of them must produce the SAME hash for semantically
 * identical input regardless of key order, so we canonicalize before hashing.
 *
 * `canonicalize` implements RFC 8785 (JCS) semantics for the value shapes this
 * product persists (strings, finite numbers, booleans, null, arrays, plain
 * objects): object keys are sorted by UTF-16 code unit, arrays keep order, and
 * `undefined`/functions are not representable. It intentionally rejects values
 * JCS cannot canonicalize (non-finite numbers, bigint) so an unstable hash can
 * never be produced silently.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function encode(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("canonicalize: non-finite number is not representable");
    }
    // ECMAScript number serialization matches RFC 8785 for our integer/decimal use.
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") {
    throw new Error("canonicalize: bigint is not representable; pass a string");
  }
  if (Array.isArray(value)) {
    return `[${value.map(encode).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      // JCS drops nothing implicitly; `undefined` means the caller built a
      // non-representable object. Skip it to mirror JSON.stringify semantics,
      // which never emits `undefined` object members.
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encode(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${t}`);
}

/** Serialize a value to canonical JSON (RFC 8785 semantics), sorted keys. */
export function canonicalize(value: CanonicalValue): string {
  return encode(value);
}

/** Lowercase hex sha256 of an arbitrary string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Canonicalize then sha256 — the standard content hash for versioned objects. */
export function contentHash(value: CanonicalValue): string {
  return sha256Hex(canonicalize(value));
}
