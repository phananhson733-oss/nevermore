// @input  -- a cookie jar, a clock, and a way to refresh and re-list a Google grant
// @output -- the grant to use now, or the reason there is none, with cookies brought up to date
// @pos    -- the only place a stored Search Console grant is renewed, kept, or dropped
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { RefreshResult } from "./google-oauth.ts";
import {
  cookieAttributes,
  cookieSecretFailure,
  MAX_SEALED_VALUE_BYTES,
  open,
  seal,
  sealedByteLength,
  type CookieAttributes,
  type SealedCookiePurpose,
} from "./sealed-cookie.ts";

/**
 * How long the grant cookies live, and therefore how long a visitor stays
 * connected without seeing Google again.
 *
 * Sliding: every silent refresh re-seals both cookies, which re-stamps the
 * envelope expiry and the Max-Age. Matched to the identity cookie's own 30 days
 * so the two cannot disagree about who is connected.
 *
 * No visitor-facing copy names this number. Google expires refresh tokens after
 * 7 days while the consent screen is in Testing, so the grant a visitor
 * actually has may be far shorter than the cookie holding it — promising 30
 * days would be a claim we do not control.
 */
export const GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The outer limit, measured from the original authorization.
 *
 * Sliding renewal alone has no end: a stolen cookie replayed once a month would
 * stay alive indefinitely. Measuring against `grantedAt` — which a refresh
 * never re-stamps — is what makes the leash finite.
 */
export const GRANT_ABSOLUTE_MAX_SECONDS = 90 * 24 * 60 * 60;

/**
 * How long the identity cookie lives.
 *
 * CONSTRAINT: this must never be shorter than the longest life a grant can
 * have, measured from the same instant. The callback stamps `grantedAt` and
 * writes `gg_id` in one request, and no refresh may carry a grant past
 * `grantedAt + GRANT_ABSOLUTE_MAX_SECONDS` — so an identity that lives exactly
 * that long cannot expire while a usable grant remains.
 *
 * That coupling is what makes the account binding below load-bearing. Without
 * it, "grant present, identity absent" is a case the binding has to skip,
 * because a 30-day identity behind a 90-day grant would otherwise sign out
 * every connected visitor on day 31 — and skipping it is what left the binding
 * firing only after a second account completed a full OAuth round trip, which
 * the callback already handles on its own.
 *
 * The cookie carries a subject and an email, never a credential.
 */
export const IDENTITY_TTL_SECONDS = GRANT_ABSOLUTE_MAX_SECONDS;

/**
 * Refresh this long before the access token actually expires.
 *
 * Not 60 seconds: the tool routes budget tens of seconds of Search Console
 * paging, so a token with a minute left dies mid-run — after the visitor's
 * per-IP quota has already been spent on the attempt.
 */
export const REFRESH_SKEW_SECONDS = 300;

/**
 * A jar this module can read, write and clear, without knowing it is Next's.
 *
 * Injected rather than imported so the whole renewal decision is testable
 * without a `next/headers` mock, and so nothing here can accidentally depend on
 * request scope.
 */
export interface GrantCookieJar {
  read(name: SealedCookiePurpose): string | undefined;
  write(
    name: SealedCookiePurpose,
    value: string,
    attributes: CookieAttributes,
  ): void;
  /**
   * Clearing needs the path the cookie was written at.
   *
   * A `Set-Cookie` at `/` does not match a cookie stored at `/api`, and the
   * browser reports nothing — so a delete that omits the path silently leaves
   * the credential in place.
   */
  clear(name: SealedCookiePurpose, path: string): void;
}

/**
 * What `gg_gsc` carries.
 *
 * Everything but `accessToken` is optional because Google's answer is not
 * uniform: it withholds the refresh token whenever the user was not actually
 * re-prompted, and a cookie sealed by an earlier build carries only the access
 * token. A grant with no refresh token is read and honoured for the life of
 * its envelope and never renewed. A grant with no `sub` is refused outright —
 * see the binding in `resolveGrant`.
 */
export interface StoredGrant {
  readonly accessToken: string;
  /** Unix seconds. */
  readonly accessTokenExpiresAt?: number;
  readonly refreshToken?: string;
  /** Unix seconds, from the original authorization. Never re-stamped. */
  readonly grantedAt?: number;
  /**
   * Google's stable subject id for the account that authorized.
   *
   * Roughly thirty bytes, and the only thing that ties this credential to a
   * person: without it, the browser holds a live refresh token that any later
   * identity in the same browser inherits. `gg_id` names who is signed in and
   * this names whose grant is held; the grant is used only when both are
   * present and name the same account.
   */
  readonly sub?: string;
}

export type GrantResolution =
  | {
      readonly kind: "grant";
      readonly accessToken: string;
      readonly properties: readonly string[];
      readonly propertyTotal: number;
    }
  /** No cookie, or nothing usable in it. */
  | { readonly kind: "none" }
  /**
   * The grant cannot be used again and both cookies have been cleared.
   *
   * Covers a revocation at Google, the absolute cap, and a grant that cannot
   * be bound to the account signed in. The visitor's route back is the consent
   * screen in every case, which is what separates this from `unavailable`.
   */
  | { readonly kind: "revoked" }
  /** A refresh failed for a reason that says nothing about the grant. */
  | { readonly kind: "unavailable" };

/**
 * The Google subject in the identity cookie, or null.
 *
 * Exported because the callback needs the same reading: it decides there
 * whether the grant already in the browser belongs to the account now
 * authorizing, and two readings of one cookie would be two places to drift.
 */
export function identitySubFrom(
  value: string | undefined,
  now: () => number = Date.now,
): string | null {
  const identity = open<{ sub?: unknown }>("gg_id", value, now);
  return typeof identity?.sub === "string" && identity.sub !== ""
    ? identity.sub
    : null;
}

/**
 * Seal a grant, or answer null when the browser would silently drop it.
 *
 * `gg_gsc` has no trimming loop — an access token and a refresh token are not
 * a list, and there is nothing in them to shorten. So an over-budget cookie is
 * not a degraded cookie, it is no cookie: the browser discards the whole
 * `Set-Cookie` line without telling the server or the page, and the visitor
 * who just authorized comes back to the connect button. Answering null lets
 * the caller say so instead of appearing to have stored something.
 */
export function sealGrantWithinBudget(
  grant: StoredGrant,
  ttlSeconds: number,
  now: () => number = Date.now,
): string | null {
  const value = seal("gg_gsc", grant, ttlSeconds, now);
  return sealedByteLength(value) > MAX_SEALED_VALUE_BYTES ? null : value;
}

/**
 * Seal as many properties as fit in one cookie, and record how many there were.
 *
 * An account with a hundred Search Console properties seals to well over the
 * ~4096 bytes a browser will store, and the browser discards the whole cookie
 * without telling anyone — so the visitor authorizes, comes back, and is shown
 * the connect button again. A truncated list the page knows is truncated can be
 * described honestly; one that claims to be complete cannot.
 */
export function sealGrantProperties(
  properties: readonly string[],
  ttlSeconds: number,
  now: () => number = Date.now,
): { readonly value: string; readonly shown: number } {
  let fitted = properties;
  let value = seal(
    "gg_sites",
    { properties: fitted, total: properties.length },
    ttlSeconds,
    now,
  );

  // Drop from the end until it fits. Linear rather than clever: the list is at
  // most a few hundred entries and this runs once per authorization or refresh.
  while (
    fitted.length > 0 &&
    sealedByteLength(value) > MAX_SEALED_VALUE_BYTES
  ) {
    fitted = fitted.slice(0, fitted.length - 1);
    value = seal(
      "gg_sites",
      { properties: fitted, total: properties.length },
      ttlSeconds,
      now,
    );
  }

  return { value, shown: fitted.length };
}

/** The stored property list, or nothing. Never invents a total. */
function readProperties(
  jar: GrantCookieJar,
  now: () => number,
): { readonly properties: readonly string[]; readonly total: number } {
  const sites = open<{ properties?: unknown; total?: unknown }>(
    "gg_sites",
    jar.read("gg_sites"),
    now,
  );
  const properties = Array.isArray(sites?.properties)
    ? sites.properties.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const total =
    typeof sites?.total === "number" && sites.total >= properties.length
      ? sites.total
      : properties.length;
  return { properties, total };
}

/**
 * Cookie work is best-effort.
 *
 * Next throws `ReadonlyRequestCookiesError` if a cookie is written during a
 * server-component render. This module is API-only by convention and nothing
 * enforces it, so a stray caller must degrade to "could not persist" rather
 * than fail the read the visitor actually asked for.
 */
function tryCookie(action: () => void): void {
  try {
    action();
  } catch {
    // Nothing to report: the request still has a usable token in hand.
  }
}

/**
 * Drop both grant cookies at the paths they were written at.
 *
 * Exported because the callback clears the same pair when the account
 * authorizing is not the account whose grant the browser is holding, and a
 * second copy of the name/path pairing is a second place for them to drift.
 */
export function clearGrantCookies(jar: Pick<GrantCookieJar, "clear">): void {
  for (const name of ["gg_gsc", "gg_sites"] as const) {
    // The path comes from the same function that wrote it, so the two can
    // never drift apart.
    tryCookie(() => jar.clear(name, cookieAttributes(name, 0).path));
  }
  // `gg_id` is deliberately left: it holds a subject and an email, no
  // credential, and clearing it would sign the visitor out of nothing.
}

/**
 * Decide what grant this request gets, and bring the cookies up to date.
 *
 * There is no lock around the refresh. The shared Search Console gate already
 * answers a second simultaneous run from the same IP with `scan_in_progress`,
 * so a race is rare; when it happens both refreshes succeed — Google does not
 * rotate the refresh token — and the last `Set-Cookie` wins.
 */
export async function resolveGrant(input: {
  readonly jar: GrantCookieJar;
  /** Milliseconds, like `Date.now`. */
  readonly now: () => number;
  readonly refresh: (refreshToken: string) => Promise<RefreshResult>;
  /** Best-effort re-listing, so a long-lived grant's picker does not go stale. */
  readonly listProperties?: (accessToken: string) => Promise<readonly string[]>;
}): Promise<GrantResolution> {
  const { jar, now } = input;

  // A key that cannot be BUILT is not a fact about this visitor's cookie, and
  // `open` throws for it so the authorization routes can answer 503. Here it
  // must not: this runs behind a tool route the visitor is waiting on, and a
  // 500 tells them nothing they can act on. Nothing is cleared either — these
  // cookies are still openable by a deployment holding the right key, and
  // deleting them would turn a fixable environment variable into a refresh
  // token stranded at Google.
  const failure = cookieSecretFailure();
  if (failure !== null) {
    console.error(
      "[grant-cookie] cookie secret unusable; every grant reads as absent:",
      failure,
    );
    return { kind: "none" };
  }

  const raw = jar.read("gg_gsc");
  const stored = open<StoredGrant>("gg_gsc", raw, now);
  if (
    !stored ||
    typeof stored.accessToken !== "string" ||
    stored.accessToken.trim() === ""
  ) {
    // A cookie we cannot open is not the same as no cookie. `open` answers
    // null for a rotated root key too, and leaving that one in place would
    // orphan the visitor for the cookie's full life: the page offers "connect"
    // while disconnect finds nothing to revoke, and the grant stays live at
    // Google with no path from here to it.
    if (raw) clearGrantCookies(jar);
    return { kind: "none" };
  }

  // Before the clocks and before any network call: a grant that cannot be
  // shown to belong to the account signed in is not a grant to renew, and
  // renewing it would spend a token-endpoint call on a credential about to be
  // thrown away.
  //
  // The rule is equality, with no exemption: the grant must name a subject and
  // the identity cookie must name the same one. Undefined matches nothing —
  // "cannot prove it belongs to the visitor in front of it" and "does belong
  // to them" are different answers, and only one is safe to read Search
  // Console with. An ABSENT identity is refused for the same reason, and it is
  // `IDENTITY_TTL_SECONDS` that earns the right to refuse it: the identity
  // outlives every grant it binds, so it cannot have expired on its own while
  // a usable grant is still here.
  //
  // CONSTRAINT: the refusal stays LOCAL. Clearing costs the visitor a consent
  // screen and nothing else, while revoking at Google is per client+user and
  // permanent — and a grant that fails this test is exactly one we cannot
  // attribute, so it must never grow a revoke call here. Same rule as the
  // callback's account switch; see `decideSupersededGrant`.
  const identitySub = identitySubFrom(jar.read("gg_id"), now);
  if (stored.sub !== identitySub) {
    clearGrantCookies(jar);
    return { kind: "revoked" };
  }

  const nowSeconds = Math.floor(now() / 1000);
  const held = readProperties(jar, now);

  const refreshToken = stored.refreshToken;
  const expiresAt = stored.accessTokenExpiresAt;
  const grantedAt = stored.grantedAt;
  if (
    typeof refreshToken !== "string" ||
    refreshToken === "" ||
    typeof expiresAt !== "number" ||
    typeof grantedAt !== "number"
  ) {
    // Sealed before offline access, or malformed. Either way there is nothing
    // to renew with, so it behaves exactly as it did before this existed.
    return {
      kind: "grant",
      accessToken: stored.accessToken,
      properties: held.properties,
      propertyTotal: held.total,
    };
  }

  // Checked before the token clock: an access token with an hour left is not a
  // reason to keep a grant that is past its outer limit.
  if (nowSeconds - grantedAt > GRANT_ABSOLUTE_MAX_SECONDS) {
    clearGrantCookies(jar);
    return { kind: "revoked" };
  }

  if (expiresAt - nowSeconds > REFRESH_SKEW_SECONDS) {
    return {
      kind: "grant",
      accessToken: stored.accessToken,
      properties: held.properties,
      propertyTotal: held.total,
    };
  }

  const refreshed = await tryRefresh(input.refresh, refreshToken);
  if (refreshed.kind === "invalid_grant") {
    clearGrantCookies(jar);
    return { kind: "revoked" };
  }
  if (refreshed.kind === "transient") {
    // Touch nothing. A Google blip must not cost a visitor their consent screen.
    return { kind: "unavailable" };
  }

  const renewed: StoredGrant = {
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: nowSeconds + refreshed.expiresInSeconds,
    refreshToken,
    grantedAt,
    // Carried, never re-derived: the renewed cookie has to stay bindable or
    // the next request refuses the grant this one just renewed.
    ...(typeof stored.sub === "string" ? { sub: stored.sub } : {}),
  };
  const sealed = sealGrantWithinBudget(renewed, GRANT_TTL_SECONDS, now);
  if (sealed === null) {
    // Logged because nothing else can see this: the alternative is a
    // Set-Cookie the browser discards in silence, which the visitor reads as
    // never having authorized and no log records at all.
    console.error(
      "[grant-cookie] renewed grant exceeds the cookie budget; clearing it",
    );
    clearGrantCookies(jar);
    return { kind: "revoked" };
  }
  tryCookie(() =>
    jar.write("gg_gsc", sealed, cookieAttributes("gg_gsc", GRANT_TTL_SECONDS)),
  );

  // The property list would otherwise be a month-old snapshot, and the page
  // decides "connected" from this cookie alone — so it is re-stamped on every
  // refresh whether or not the re-list succeeds.
  const listed = await listOrKeep(input.listProperties, refreshed.accessToken);
  const properties = listed ?? held.properties;
  const total = listed ? listed.length : held.total;
  tryCookie(() =>
    jar.write(
      "gg_sites",
      sealGrantProperties(properties, GRANT_TTL_SECONDS, now).value,
      cookieAttributes("gg_sites", GRANT_TTL_SECONDS),
    ),
  );

  return {
    kind: "grant",
    accessToken: refreshed.accessToken,
    properties,
    propertyTotal: total,
  };
}

/**
 * A thrown refresh is not a revoked grant.
 *
 * `readGoogleOAuthConfig()` throws on an unconfigured deployment and is read
 * while building the refresh call, so the failure arrives synchronously and a
 * `.catch()` on the returned promise would never see it. Either way it must
 * degrade like any other transient failure rather than delete every visitor's
 * grant — or fail the request outright.
 */
async function tryRefresh(
  refresh: (refreshToken: string) => Promise<RefreshResult>,
  refreshToken: string,
): Promise<RefreshResult> {
  try {
    return await refresh(refreshToken);
  } catch {
    return { kind: "transient" };
  }
}

/** A failed re-list is not a failed refresh; the previous list is still true. */
async function listOrKeep(
  listProperties:
    | ((accessToken: string) => Promise<readonly string[]>)
    | undefined,
  accessToken: string,
): Promise<readonly string[] | null> {
  if (!listProperties) return null;
  try {
    return await listProperties(accessToken);
  } catch {
    return null;
  }
}
