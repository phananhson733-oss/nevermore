// @input  -- request cookies, Google grant configuration, and optional explicit property refresh
// @output -- page-safe grant presence or API-only resolved grant with refreshed properties when requested
// @pos    -- the single seam between the traffic-drop tool and the Google authorization layer
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import {
  listSearchConsoleProperties,
  readGoogleOAuthConfig,
  refreshAccessToken,
} from "../auth/google-oauth.ts";
import {
  identitySubFrom,
  resolveGrant,
  type GrantCookieJar,
  type GrantResolution,
} from "../auth/grant-cookie.ts";
import { cookieSecretFailure, open } from "../auth/sealed-cookie.ts";

export interface TrafficDropSession {
  /**
   * Properties the visitor granted read access to.
   *
   * `null` means there is no grant this page can act on — none at all, or one
   * the tool routes would refuse. It never means "zero properties": a
   * visitor who granted access to nothing would be an empty array, and the
   * page says different things about the two.
   */
  readonly properties: readonly string[] | null;
  /**
   * How many properties the grant actually covers.
   *
   * Usually equal to `properties.length`. It is larger when the list had to be
   * trimmed to fit inside one cookie — the page says so rather than presenting
   * a shortened list as if it were everything.
   */
  readonly propertyTotal: number;
  /**
   * Whether the Google grant flow is open in this environment.
   *
   * Off by default so an environment without working OAuth credentials says so
   * plainly rather than offering a button that leads nowhere.
   */
  readonly connectEnabled: boolean;
  /**
   * What Google will do to the visitor on the way through, if anything.
   *
   * Whatever the consent screen is going to show, saying it first is the whole
   * point: a visitor who was told what to expect has learned something, while
   * a visitor who is stopped by Google unprepared has learned to distrust the
   * site.
   */
  readonly consentNotice: GoogleConsentNotice;
}

/**
 * - `invite_only` — the consent screen is in Testing, so only accounts on its
 *   tester list can authorize and everyone else is hard-blocked.
 * - `none` — nothing unusual happens on the way through.
 *
 * There used to be an `unverified` state for the "Google hasn't verified this
 * app" interstitial. It was removed because the condition that produces that
 * screen does not hold here: Google shows it when a request carries a
 * sensitive or restricted scope that has not been approved, and this flow asks
 * only for `openid email profile webmasters.readonly` — all of which this
 * project's consent screen lists as non-sensitive. Describing a screen the
 * visitor will never meet is worse than saying nothing: it also hands them
 * click-by-click instructions for buttons that are not there.
 *
 * Re-add the state, do not repurpose this one, if the flow ever requests a
 * scope Google does classify as sensitive.
 */
export type GoogleConsentNotice = "invite_only" | "none";

/** Server-side flag; there is deliberately no NEXT_PUBLIC_ variant of this. */
export function isGoogleConnectEnabled(): boolean {
  return process.env.MARKETING_GSC_CONNECT_ENABLED === "true";
}

/** The values this reader still recognizes from a previous release. */
const RETIRED_CONSENT_VALUES = new Set(["unverified"]);

/**
 * Reads the declared consent-screen state. Three cases, not two.
 *
 * `unverified` is the value production is known to carry today, and it maps to
 * `none`: the screen it described only appears for unapproved sensitive scopes,
 * and this flow requests none. Treating it conservatively instead would bring
 * back the invite-only copy this change exists to remove, including its
 * demoted authorize link.
 *
 * Anything else unrecognized is a different situation. A typo, or a value from
 * some future state, says nothing about the consent screen, and answering
 * "nothing unusual" to it is a guess made in the visitor's name. Those fall
 * back to the cautious notice, so a misconfiguration costs a few seconds of
 * reading rather than sending someone into a block page unprepared.
 *
 * Absent is the ordinary case and means `none`, which is what this consent
 * screen actually does. `invite_only` has to be set deliberately, and must be
 * the moment the screen goes back to Testing — an operational contract this
 * code cannot verify on its own.
 */
export function readGoogleConsentNotice(): GoogleConsentNotice {
  const raw = process.env.MARKETING_GSC_CONSENT_NOTICE?.trim();
  if (!raw) return "none";
  if (raw === "invite_only") return "invite_only";
  if (raw === "none") return "none";
  if (RETIRED_CONSENT_VALUES.has(raw)) return "none";
  return "invite_only";
}

/**
 * The page-level view of the visitor's grant: which properties, and nothing else.
 *
 * Reads the property list out of the sealed cookie without ever touching the
 * token, so a server component cannot accidentally carry one into the RSC
 * payload.
 */
export async function readTrafficDropSession(): Promise<TrafficDropSession> {
  const grant = await readGrantedProperties();
  return {
    properties: grant?.properties ?? null,
    propertyTotal: grant?.total ?? 0,
    connectEnabled: isGoogleConnectEnabled(),
    consentNotice: readGoogleConsentNotice(),
  };
}

/**
 * Resolve the grant, renewing it silently if this is the moment it needs it.
 *
 * API-only, and called only AFTER admission control: the renewal spends a
 * token-endpoint call and a Search Console site-list call on a shared OAuth
 * client and a per-project quota, so a caller that resolves before its rate
 * limiter has answered has no rate limiter at all. Both handlers therefore
 * take this as a thunk rather than a value.
 *
 * Never call this from a server component: it writes cookies, which Next
 * forbids during an RSC render. The write failure is caught rather than
 * thrown — an unwritable cookie must not fail a read the visitor asked for —
 * but the renewal would then be lost on every request.
 *
 * The Set-Cookie reaches the response without any plumbing here: Next copies
 * the route handler's mutable cookies onto whatever the handler returned.
 */
export async function resolveTrafficDropGrant(
  options: { readonly refreshProperties?: boolean } = {},
): Promise<GrantResolution> {
  if (!isGoogleConnectEnabled()) return { kind: "none" };
  const jar = await cookies();
  const cookieJar: GrantCookieJar = {
    read: (name) => jar.get(name)?.value,
    write: (name, value, attributes) => jar.set(name, value, attributes),
    // The explicit path matters: `gg_gsc` is stored at /api and a Set-Cookie
    // at / does not match it.
    clear: (name, path) => jar.delete({ name, path }),
  };

  return resolveGrant({
    ...options,
    jar: cookieJar,
    now: Date.now,
    refresh: (refreshToken) =>
      refreshAccessToken({ config: readGoogleOAuthConfig(), refreshToken }),
    listProperties: (accessToken) =>
      listSearchConsoleProperties({ accessToken }),
  });
}

/**
 * The page-visible half of the grant: which properties, never the token.
 *
 * Reads `gg_sites` (scoped to `/`), because a page request never carries the
 * `/api`-scoped token cookie. This split is what lets the page know a grant
 * exists without the token ever being readable from a server component.
 */
async function readGrantedProperties(): Promise<{
  readonly properties: readonly string[];
  readonly total: number;
} | null> {
  if (!isGoogleConnectEnabled()) return null;

  // A root key that cannot be built makes every sealed cookie unreadable, and
  // `open` throws for it — right at the authorization entry point, wrong here.
  // This is a page render: throwing would 500 the connected tool pages for
  // every visitor who has authorized, and take the disconnect control on them
  // down too. So the visitor sees what someone with no cookie sees, and the
  // operator — the only one who can act on it — gets the variable named.
  const failure = cookieSecretFailure();
  if (failure !== null) {
    console.error(
      "[traffic-drop-session] cookie secret unusable; every visitor reads as not connected:",
      failure,
    );
    return null;
  }

  const jar = await cookies();

  // The page cannot check the account binding itself — the grant cookie is
  // scoped to `/api`, and `gg_sites` names no account — but it can check the
  // half it can see, and it has to. `resolveGrant` refuses a grant with no
  // identity cookie beside it, so calling this state "connected" would render
  // a property picker for a run the route is about to refuse.
  if (identitySubFrom(jar.get("gg_id")?.value) === null) return null;

  const sites = open<{ properties?: unknown; total?: unknown }>(
    "gg_sites",
    jar.get("gg_sites")?.value,
  );
  if (!sites) return null;

  // An empty list is a real state — the visitor authorized but owns no verified
  // property — and is not the same as having no grant at all.
  const properties = Array.isArray(sites.properties)
    ? sites.properties.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  // `total` is what the grant covered before the list was fitted to the cookie
  // budget. A cookie sealed by an earlier build carries no `total`, and for
  // those the list IS the whole grant — so the fallback is its length, never
  // zero, which would claim the visitor has no properties at all.
  const total =
    typeof sites.total === "number" && sites.total >= properties.length
      ? sites.total
      : properties.length;

  return { properties, total };
}
