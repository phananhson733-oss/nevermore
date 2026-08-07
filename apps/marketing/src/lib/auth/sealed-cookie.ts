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
  | "gg_onetap";

export class SealedCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedCookieError";
  }
}

/**
 * Root key material.
 *
 * `TOKEN_ENCRYPTION_KEY` is the key this Vercel project has always carried
 * (hex, from the previous codebase's token encryption). It is reused rather
 * than replaced — but never used directly: every cookie purpose gets its own
 * HKDF-derived subkey below, so a cookie key and a stored-token key are
 * different keys even though they share a root. `MARKETING_COOKIE_SECRET`
 * (base64) overrides it when the two should not share a root at all.
 */
function rootSecret(): Buffer {
  const override = process.env.MARKETING_COOKIE_SECRET;
  if (override) {
    const secret = Buffer.from(override, "base64");
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
  const secret = Buffer.from(existing, "hex");
  if (secret.length < MIN_SECRET_BYTES) {
    throw new SealedCookieError(
      "TOKEN_ENCRYPTION_KEY must decode to at least 32 bytes.",
    );
  }
  return secret;
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
 */
export function open<T>(
  purpose: SealedCookiePurpose,
  value: string | undefined,
  now: () => number = Date.now,
): T | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, deriveKey(purpose), iv);
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
