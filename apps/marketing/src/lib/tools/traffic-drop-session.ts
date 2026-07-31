// @input  -- request cookies and the marketing site's Google grant configuration
// @output -- whether a Search Console grant is in place, and which properties it covers
// @pos    -- the single seam between the traffic-drop tool and the Google authorization layer
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import { open } from "../auth/sealed-cookie.ts";

export interface TrafficDropSession {
  /**
   * Properties the visitor granted read access to.
   *
   * `null` means no grant is in place. It never means "zero properties": a
   * visitor who granted access to nothing would be an empty array, and the
   * page says different things about the two.
   */
  readonly properties: readonly string[] | null;
  /**
   * Whether the Google grant flow is open in this environment.
   *
   * The `webmasters.readonly` scope is a Google-sensitive scope and cannot ship
   * until the consent screen passes verification. Until then the page says so
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
 * - `unverified` — published, but Google has not finished verifying the
 *   sensitive scope, so every visitor passes an "app isn't verified"
 *   interstitial they must click through.
 * - `none` — published and verified; the flow is unremarkable.
 */
export type GoogleConsentNotice = "invite_only" | "unverified" | "none";

/** Server-side flag; there is deliberately no NEXT_PUBLIC_ variant of this. */
export function isGoogleConnectEnabled(): boolean {
  return process.env.MARKETING_GSC_CONNECT_ENABLED === "true";
}

/**
 * Defaults to the most restrictive notice.
 *
 * The safe direction is to over-warn: a visitor who reads a warning that did
 * not apply loses a few seconds, while a visitor sent unprepared into Google's
 * block page cannot recover at all. Both `unverified` and `none` therefore
 * have to be set deliberately, as the consent screen actually advances.
 */
export function readGoogleConsentNotice(): GoogleConsentNotice {
  const value = process.env.MARKETING_GSC_CONSENT_NOTICE;
  return value === "none" || value === "unverified" ? value : "invite_only";
}

/**
 * The grant itself, including the access token.
 *
 * Deliberately separate from `readTrafficDropSession`: the token is only ever
 * needed under `/api`, and keeping it out of the page-level call means it
 * cannot reach a server component — and therefore cannot be serialized into
 * the RSC payload that ships to the browser.
 */
export interface TrafficDropGrant {
  readonly properties: readonly string[];
  readonly accessToken: string;
}

/**
 * The page-level view of the visitor's grant: which properties, and nothing else.
 *
 * Reads the property list out of the sealed cookie without ever touching the
 * token, so a server component cannot accidentally carry one into the RSC
 * payload.
 */
export async function readTrafficDropSession(): Promise<TrafficDropSession> {
  return {
    properties: await readGrantedProperties(),
    connectEnabled: isGoogleConnectEnabled(),
    consentNotice: readGoogleConsentNotice(),
  };
}

/** API-only. Never call this from a server component. */
export async function readTrafficDropGrant(): Promise<TrafficDropGrant | null> {
  if (!isGoogleConnectEnabled()) return null;
  const jar = await cookies();
  const token = open<{ accessToken?: unknown }>("gg_gsc", jar.get("gg_gsc")?.value);
  if (!token || typeof token.accessToken !== "string" || token.accessToken.trim() === "") {
    return null;
  }
  const properties = await readGrantedProperties();
  return { accessToken: token.accessToken, properties: properties ?? [] };
}

/**
 * The page-visible half of the grant: which properties, never the token.
 *
 * Reads `gg_sites` (scoped to `/`), because a page request never carries the
 * `/api`-scoped token cookie. This split is what lets the page know a grant
 * exists without the token ever being readable from a server component.
 */
async function readGrantedProperties(): Promise<readonly string[] | null> {
  if (!isGoogleConnectEnabled()) return null;
  const jar = await cookies();
  const sites = open<{ properties?: unknown }>(
    "gg_sites",
    jar.get("gg_sites")?.value,
  );
  if (!sites) return null;

  // An empty list is a real state — the visitor authorized but owns no verified
  // property — and is not the same as having no grant at all.
  return Array.isArray(sites.properties)
    ? sites.properties.filter((entry): entry is string => typeof entry === "string")
    : [];
}

