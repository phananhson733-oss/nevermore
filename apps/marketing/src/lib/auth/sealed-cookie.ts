// @input  -- a cookie purpose, a JSON-serializable payload, and the site's root key
// @output -- an AEAD-sealed cookie value, and the verified payload on the way back
// @pos    -- the only place cookie contents are encrypted or trusted
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Rejects a secret short enough to be brute-forced. */
const MIN_SECRET_BYTES = 32;

/**
 * Cookie purposes.
 *
 * Each gets its own derived key, so a value sealed for one purpose can never be
 * replayed as another — an OAuth transaction cookie cannot be presented as a
 * Search Console grant even by someone who obtained both.
 */
export type SealedCookiePurpose =
  | "gg_oauth_tx"
  | "gg_id"
  | "gg_gsc"
  | "gg_sites"
  | "gg_onetap"
  /**
   * The Keyword Opportunity Map's stage-one carry-over, which travels in a
   * response body rather than a cookie.
   *
   * It gets its own purpose rather than borrowing one: the purpose is both the
   * HKDF info and the GCM additional data, so sharing it with a grant would
   * make a carry-over token presentable as authorization and a grant
   * presentable as crawl context. The cookie byte budget does not apply to it
   * — nothing sets it as a cookie — but every other rule here does.
   */
  | "gg_kw_context";

export class SealedCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedCookieError";
  }
}

/** 64 hex characters: the exact shape of `TOKEN_ENCRYPTION_KEY`. */
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Root key material.
 *
 * `TOKEN_ENCRYPTION_KEY` is the key this Vercel project has always carried
 * (hex, from the previous codebase's token encryption). It is reused rather
 * than replaced — but never used directly: every cookie purpose gets its own
 * HKDF-derived subkey below, so a cookie key and a stored-token key are
 * different keys even though they share a root. `MARKETING_COOKIE_SECRET`
 * (base64) overrides it when the two should not share a root at all.
 *
 * Every rejection below names the variable that is wrong. Node's decoders are
 * lenient in both directions — base64 silently skips characters outside its
 * alphabet, hex silently stops at the first character outside its own — so a
 * bad paste does not fail, it produces a DIFFERENT key. The visible symptom is
 * then "every visitor is signed out", weeks later, with nothing pointing at an
 * environment variable. A wrong key is unrecoverable rather than merely broken:
 * the cookies sealed under the right one can never be opened again.
 */
function rootSecret(): Buffer {
  const override = process.env.MARKETING_COOKIE_SECRET;
  if (override) {
    // Checked before base64, because the two alphabets overlap: 64 hex
    // characters are also valid base64 and decode to 48 bytes, which clears
    // every length check while being the wrong key entirely.
    if (HEX_KEY_PATTERN.test(override)) {
      throw new SealedCookieError(
        "MARKETING_COOKIE_SECRET is 64 hex characters, which is the shape of " +
          "TOKEN_ENCRYPTION_KEY. It must be base64. Either set base64 key " +
          "material here, or unset it to reuse TOKEN_ENCRYPTION_KEY.",
      );
    }
    const secret = Buffer.from(override, "base64");
    if (
      secret.toString("base64").replace(/=+$/, "") !==
      override.replace(/=+$/, "")
    ) {
      throw new SealedCookieError(
        "MARKETING_COOKIE_SECRET is not valid base64. Node decodes around " +
          "stray characters instead of failing, which yields a different key.",
      );
    }
    if (secret.length < MIN_SECRET_BYTES) {
      throw new SealedCookieError(
        "MARKETING_COOKIE_SECRET must decode to at least 32 bytes.",
      );
    }
    return secret;
  }

  const existing = process.env.TOKEN_ENCRYPTION_KEY;
  if (!existing) {
    throw new SealedCookieError(
      "Neither MARKETING_COOKIE_SECRET nor TOKEN_ENCRYPTION_KEY is configured.",
    );
  }
  if (!HEX_PATTERN.test(existing) || existing.length % 2 !== 0) {
    throw new SealedCookieError(
      "TOKEN_ENCRYPTION_KEY must be an even number of hex characters. " +
        "Node's hex decoder stops at the first character outside the " +
        "alphabet, so a base64 value here silently becomes a shorter key.",
    );
  }
  const secret = Buffer.from(existing, "hex");
  if (secret.length < MIN_SECRET_BYTES) {
    throw new SealedCookieError(
      "TOKEN_ENCRYPTION_KEY must decode to at least 32 bytes.",
    );
  }
  return secret;
}

/**
 * Build the root key and throw if it cannot be built, sealing nothing.
 *
 * Called at the entry of every authorization route, which is the earliest
 * point this deployment does cookie work. Without it the key is only ever read
 * inside `seal`/`open`, where a wrong-but-decodable value produces cookies
 * nobody can open rather than an error anybody can see.
 */
export function assertCookieSecretConfigured(): void {
  rootSecret();
}

/**
 * The same diagnosis as a value: the reason the root key cannot be built, or
 * null when it can.
 *
 * Throwing is right where an operator is the only possible audience — the two
 * authorization routes catch it and answer 503. It is wrong on a READ path: a
 * page render that throws takes down the connected tool pages, and the
 * disconnect control lives on them, so the visitors holding a credential they
 * can no longer use are exactly the ones a throw locks out.
 *
 * So readers ask this first and degrade to "this visitor has no cookie" — in
 * what the VISITOR sees only. In the log the two must stay distinguishable:
 * every caller that degrades logs this message, because a configuration
 * failure that reads as an ordinary absent cookie is how a bad paste signs out
 * a whole site in silence.
 */
export function cookieSecretFailure(): string | null {
  try {
    rootSecret();
    return null;
  } catch (error) {
    if (error instanceof SealedCookieError) return error.message;
    throw error;
  }
}

/** Per-purpose key. The purpose is the HKDF info, which is what separates them. */
function deriveKey(purpose: SealedCookiePurpose): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      rootSecret(),
      "gengrowth.marketing.v1",
      purpose,
      KEY_BYTES,
    ),
  );
}

interface SealedEnvelope {
  /** Unix seconds. Checked on open; an expired value is treated as absent. */
  readonly exp: number;
  readonly data: unknown;
}

export function seal(
  purpose: SealedCookiePurpose,
  data: unknown,
  ttlSeconds: number,
  now: () => number = Date.now,
): string {
  const envelope: SealedEnvelope = {
    exp: Math.floor(now() / 1000) + ttlSeconds,
    data,
  };
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(purpose), iv);
  // The purpose is authenticated but not transmitted: a value moved to another
  // cookie name fails the tag check rather than decrypting into the wrong slot.
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(envelope), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/**
 * Open a sealed value, or return null.
 *
 * Every failure — tampering, wrong purpose, expiry, a secret that has been
 * rotated — returns null rather than throwing. A visitor holding a cookie we
 * cannot verify is simply a visitor without one; there is nothing for them to
 * fix and nothing useful to tell them.
 *
 * A root key that cannot be BUILT is the one exception and is thrown. That is
 * not a fact about this visitor's cookie: it is a deployment that will read
 * every cookie as absent, and swallowing it is how a bad paste signs out
 * everyone in silence.
 */
export function open<T>(
  purpose: SealedCookiePurpose,
  value: string | undefined,
  now: () => number = Date.now,
): T | null {
  if (!value) return null;
  // Derived outside the try: a configuration failure must escape while a
  // cookie failure must not.
  const key = deriveKey(purpose);
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");

    const envelope = JSON.parse(plain) as SealedEnvelope;
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.exp !== "number" ||
      envelope.exp * 1000 <= now()
    ) {
      return null;
    }
    return envelope.data as T;
  } catch {
    return null;
  }
}

/**
 * Budget for one sealed cookie VALUE, in bytes.
 *
 * Browsers drop a cookie whose whole `name=value; attributes` line exceeds
 * about 4096 bytes, and they drop it silently — no error reaches the server or
 * the page. A caller that seals an unbounded list therefore does not fail
 * loudly, it just stops having a cookie, which is indistinguishable from never
 * having authorized. 3_600 leaves room for the name and the attribute string.
 */
export const MAX_SEALED_VALUE_BYTES = 3_600;

/** Byte length of a sealed value, for callers that must fit inside the budget. */
export function sealedByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: string;
  readonly maxAge: number;
}

/**
 * Attributes for a purpose.
 *
 * `gg_gsc` is scoped to `/api` on purpose: the access token is only ever needed
 * by a route handler, and a token that is not attached to page requests cannot
 * be serialized into an RSC payload.
 *
 * That scoping is exactly why the granted property list lives in its own
 * `gg_sites` cookie at `/`: the page has to know which properties to offer, and
 * a page cannot read a cookie scoped to `/api`. Splitting them keeps the token
 * out of page requests without making the page blind — the earlier shape put
 * both in `gg_gsc`, so a visitor who authorized successfully still saw the
 * connect button, because their own property list was unreachable from the page
 * that needed it.
 *
 * Nothing is set on `.gengrowth.ai` — a domain-wide cookie would hand the SaaS
 * app's XSS blast radius to the marketing site and back.
 */
export function cookieAttributes(
  purpose: SealedCookiePurpose,
  maxAge: number,
): CookieAttributes {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Only the token is confined to /api. Everything else must be readable by
    // the pages that render from it.
    path: purpose === "gg_gsc" ? "/api" : "/",
    maxAge,
  };
}
