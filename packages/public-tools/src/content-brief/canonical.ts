// @input  -- any JSON-shaped value; a ContentBrief or DraftResult for the two fingerprints
// @output -- one stable canonical string and its sha256 hex
// @pos    -- the single serialisation the brief producer and the draft parser both hash
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { ContentBrief, DraftResult } from "./contract.ts";

/**
 * Canonical form (contract.ts BriefRunMeta.fingerprint):
 *   - object keys sorted by UTF-16 code unit, undefined-valued keys dropped
 *   - arrays keep their order; a hole / undefined element becomes null (as JSON does)
 *   - numbers and strings exactly as JSON.stringify prints them
 *   - no whitespace anywhere
 *
 * Anything that JSON.stringify would silently reshape (Date, Map, class
 * instances) is refused: a fingerprint over "{}" would validate nothing.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      throw new TypeError("canonicalize: bigint is not JSON-serialisable");
    case "object":
      return Array.isArray(value)
        ? canonicalizeArray(value)
        : canonicalizeObject(value);
    default:
      // undefined / function / symbol standing alone or inside an array.
      return "null";
  }
}

/**
 * Array.from walks the array iterator, which yields undefined for holes, so a
 * sparse array serialises hole-for-hole like JSON.stringify. `.map` would skip
 * the holes and make `Array(1)` fingerprint identical to `[]`.
 */
function canonicalizeArray(items: readonly unknown[]): string {
  return `[${Array.from(items, (item) => canonicalize(item)).join(",")}]`;
}

function canonicalizeObject(value: object): string {
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "canonicalize: only plain objects and arrays are supported",
    );
  }
  const record = value as Record<string, unknown>;
  // Default sort compares UTF-16 code units, which is the contract's key order.
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

/* ------------------------------------------------------------------ */
/* sha256                                                              */
/* ------------------------------------------------------------------ */

/** The one WebCrypto method we need; injectable so both paths are testable. */
export type Sha256Digest = Pick<SubtleCrypto, "digest">;

function defaultDigest(): Sha256Digest | null {
  const holder = globalThis as {
    readonly crypto?: { readonly subtle?: Sha256Digest };
  };
  return holder.crypto?.subtle ?? null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * sha256 over the UTF-8 bytes of `text`. WebCrypto first (browser and Node
 * both expose it); `node:crypto` only when no SubtleCrypto is available. The
 * fallback is a dynamic import so a browser bundle never resolves node:crypto.
 */
export async function sha256Hex(
  text: string,
  digest: Sha256Digest | null = defaultDigest(),
): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (digest !== null) {
    return toHex(new Uint8Array(await digest.digest("SHA-256", bytes)));
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fingerprintCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

/* ------------------------------------------------------------------ */
/* brief / draft fingerprints                                          */
/* ------------------------------------------------------------------ */

interface VolatileRun {
  readonly fingerprint: string;
  readonly elapsed_ms: number;
}

/**
 * New object with run.fingerprint and run.elapsed_ms removed; the input is
 * never touched. Typed loosely on purpose: the only consumer is canonicalize,
 * which takes unknown, and a precise Omit<> here buys nothing but friction.
 */
function withoutVolatileRun(value: {
  readonly run: VolatileRun;
}): Record<string, unknown> {
  const {
    fingerprint: _fingerprint,
    elapsed_ms: _elapsed_ms,
    ...run
  } = value.run;
  return { ...value, run };
}

/** sha256(canonicalize(brief without run.fingerprint and run.elapsed_ms)). */
export async function briefFingerprint(brief: ContentBrief): Promise<string> {
  return fingerprintCanonical(withoutVolatileRun(brief));
}

/** sha256(canonicalize(draft without run.fingerprint and run.elapsed_ms)). */
export async function draftFingerprint(result: DraftResult): Promise<string> {
  return fingerprintCanonical(withoutVolatileRun(result));
}
