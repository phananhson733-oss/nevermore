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
}

/** Server-side flag; there is deliberately no NEXT_PUBLIC_ variant of this. */
export function isGoogleConnectEnabled(): boolean {
  return process.env.MARKETING_GSC_CONNECT_ENABLED === "true";
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
  const grant = await readSealedGrant();
  return {
    properties: grant?.properties ?? null,
    connectEnabled: isGoogleConnectEnabled(),
  };
}

/** API-only. Never call this from a server component. */
export async function readTrafficDropGrant(): Promise<TrafficDropGrant | null> {
  const grant = await readSealedGrant();
  if (!grant || grant.accessToken.trim() === "") return null;
  return grant;
}

async function readSealedGrant(): Promise<TrafficDropGrant | null> {
  if (!isGoogleConnectEnabled()) return null;
  const jar = await cookies();
  const grant = open<{ accessToken?: unknown; properties?: unknown }>(
    "gg_gsc",
    jar.get("gg_gsc")?.value,
  );
  if (!grant) return null;

  const properties = Array.isArray(grant.properties)
    ? grant.properties.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  if (typeof grant.accessToken !== "string") return null;

  // An empty property list is a real state — the visitor authorised us but owns
  // no verified property — and is not the same as having no grant at all.
  return { accessToken: grant.accessToken, properties };
}
