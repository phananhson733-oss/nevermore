import { createHash } from "node:crypto";

/**
 * Canonical JSON + sha256 for stable identity keys (spec §8.6). Mirrors the
 * `@sf/db` hash semantics (RFC 8785 sorted keys) but lives in the engine so the
 * cross-run `findingKey` is computed the same way wherever it is needed.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function encode(value: CanonicalValue): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  const obj = value as { readonly [key: string]: CanonicalValue };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k] as CanonicalValue)}`).join(",")}}`;
}

export function canonicalize(value: CanonicalValue): string {
  return encode(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function contentHash(value: CanonicalValue): string {
  return sha256Hex(canonicalize(value));
}
