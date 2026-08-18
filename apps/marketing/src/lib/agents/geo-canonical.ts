// @input  -- arbitrary confirmed GEO values on their way into a fingerprint
// @output -- one normalization, one canonical serialization, one domain-tagged digest
// @pos    -- the single hashing discipline every GEO fingerprint is required to use

/**
 * Why there is exactly one of each function here.
 *
 * A fingerprint is only worth having if the browser that computes it and the
 * server that recomputes it produce the same bytes. Two implementations of
 * "serialize this object" agree until the day one of them meets a key order,
 * a `-0`, a decomposed accent or a CRLF the other never saw — and the failure
 * is silent: the server simply refuses a payload the client believed it had
 * just confirmed. So normalization, serialization and digesting each exist once
 * and are imported by both sides.
 *
 * The domain prefix is the other half of that discipline. Two different
 * structures can canonicalize to the same JSON — a context projection and a
 * query-set projection with coincidentally identical fields would — and without
 * a prefix their digests would collide and one could be substituted for the
 * other. Prefixing the hashed bytes with `"<domain>\n"` makes every digest
 * answer "identical content in this exact role", which is the only claim the
 * product makes about it.
 */

/** Thrown when a value cannot be canonicalized; never carries the value itself. */
export class GeoCanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoCanonicalError";
  }
}

export type GeoCanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly GeoCanonicalValue[]
  | { readonly [key: string]: GeoCanonicalValue };

/**
 * Whether the string carries an unpaired surrogate code unit.
 *
 * These survive `JSON.stringify` as `\udXXX` escapes and survive a UTF-8
 * encoder as U+FFFD, so a string containing one hashes differently depending on
 * which side encoded it. They cannot arrive from a keyboard; they arrive from a
 * value that was cut in the middle of an astral character, which is exactly the
 * bug a bounded snippet writer makes. Rejected rather than repaired, because
 * repairing changes content the user confirmed.
 */
export function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

/** Length in Unicode code points, which is what every text bound here counts. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

/** Cut to a code-point budget without splitting an astral character in half. */
export function sliceCodePoints(value: string, limit: number): string {
  if (limit <= 0) return "";
  let taken = 0;
  let out = "";
  for (const character of value) {
    if (taken >= limit) break;
    out += character;
    taken += 1;
  }
  return out;
}

/**
 * The documented normalization every confirmed GEO string passes through.
 *
 * Four steps, in this order, and no others:
 *
 * 1. Unicode NFC, so a precomposed "é" and a decomposed "é" — which a
 *    macOS paste and a Windows paste produce respectively for the same visible
 *    word — become the same bytes.
 * 2. CRLF and bare CR to LF, so a value pasted out of a Windows editor matches
 *    the same value typed into the form.
 * 3. Every remaining run of whitespace, newlines included, to one space. Every
 *    field this touches is a bounded noun phrase or a single sentence; a value
 *    that genuinely needed an internal line break would be a value the template
 *    rules already reject.
 * 4. Trim.
 *
 * Deliberately not lowercasing and not stripping punctuation: the values are
 * product names, categories and competitor names, and "U.S. tax software" and
 * "[24]7.ai" are the spellings the customer confirmed.
 */
export function normalizeGeoText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalString(value: string): string {
  if (hasLoneSurrogate(value)) {
    throw new GeoCanonicalError(
      "A string carried an unpaired surrogate and cannot be canonicalized.",
    );
  }
  return JSON.stringify(value);
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new GeoCanonicalError(
      "Only finite numbers can be canonicalized; NaN and Infinity cannot.",
    );
  }
  // `-0` serializes as "0" through `String`, but `Object.is(-0, 0)` is false,
  // so a projection that computed a negative zero on one side and a positive
  // zero on the other would still agree here. Made explicit so it reads as a
  // decision rather than as an accident of the built-in.
  return String(value === 0 ? 0 : value);
}

/**
 * Serialize to the one form both sides of the wire agree on.
 *
 * Object keys sort by UTF-16 code unit, which is what `Array.prototype.sort`
 * does for strings by default and what RFC 8785 specifies. `undefined`,
 * functions, symbols and `BigInt` are refused rather than dropped: silently
 * dropping a key means an object with an accidental `undefined` hashes the same
 * as one without the key at all, and the fingerprint then fails to notice a
 * real difference.
 */
export function canonicalJson(value: GeoCanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);

  if (Array.isArray(value)) {
    const source = value as readonly GeoCanonicalValue[];
    const items: string[] = [];
    // An indexed loop, not `map`: array callbacks skip holes, so `new Array(1)`
    // would serialize as `[]` and hash identically to an empty array. That is a
    // non-injective fingerprint, and it is exactly the kind of collision a
    // content hash exists to make impossible.
    for (let index = 0; index < source.length; index += 1) {
      if (!Object.hasOwn(source, index)) {
        throw new GeoCanonicalError(
          "An array hole cannot be canonicalized.",
        );
      }
      const item = source[index];
      if (item === undefined) {
        throw new GeoCanonicalError(
          "An undefined array element cannot be canonicalized.",
        );
      }
      items.push(canonicalJson(item));
    }
    return `[${items.join(",")}]`;
  }

  if (typeof value !== "object") {
    throw new GeoCanonicalError(
      `A ${typeof value} value cannot be canonicalized.`,
    );
  }

  const record = value as { readonly [key: string]: GeoCanonicalValue };
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => {
    const entry = record[key];
    if (entry === undefined) {
      throw new GeoCanonicalError(
        "An undefined property cannot be canonicalized.",
      );
    }
    return `${canonicalString(key)}:${canonicalJson(entry)}`;
  });
  return `{${parts.join(",")}}`;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * SHA-256 of the UTF-8 bytes of `"<domain>\n" + canonicalJson(value)`.
 *
 * Async because `crypto.subtle` is the only digest available in both a browser
 * bundle and the Node runtime the route handler uses, and it is async in both.
 * A synchronous hand-rolled SHA-256 would be a second implementation of the one
 * thing this module exists to have exactly one of.
 */
export async function geoDomainHash(
  domain: string,
  value: GeoCanonicalValue,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new GeoCanonicalError(
      "Web Crypto is unavailable, so no GEO fingerprint can be computed.",
    );
  }
  const payload = new TextEncoder().encode(`${domain}\n${canonicalJson(value)}`);
  const digest = await subtle.digest("SHA-256", payload);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

/**
 * Whether the array carries a hole.
 *
 * Exported because every strict guard needs it: `every`, `some` and `filter`
 * all skip holes, so a trailing hole slips through validation and then changes
 * meaning the moment the value is serialized to JSON, where it becomes `null`.
 */
export function hasArrayHole(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return true;
  }
  return false;
}

/** Exactly the shape {@link geoDomainHash} produces, and nothing else. */
export function isGeoDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
