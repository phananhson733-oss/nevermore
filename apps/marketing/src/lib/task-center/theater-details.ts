// @input  -- a platform and the drama id 北斗 gave for it; the theater's own site through its reader (theater-*.ts)
// @output -- the drama as the theater itself shows it (TheaterDetails; null when the platform has no reader, the id is not one of its ids, or the site could not be read), and a link to a drama's page there (DramaBox too, whose site refuses the server)
// @pos    -- 查剧's second step: 北斗 (through 选剧台) finds the drama and its id, the theater's site fills it in; the import falls back to 北斗's row field by field
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// Readers, as each site served its dramas on 2026-11-08:
//   reelshort    page, __NEXT_DATA__        tags, 频道 and genre by tag id
//   stardusttv   page, __NUXT_DATA__        labels; 频道 and genre from label levels
//   moboreels    the site's JSON API        types as tags
//   netshort     page, app-router stream    categories as tags
//   yourchannel  the site's JSON API        tags
// Linked, not read: dramabox. Its pages sit behind CloudFront, which answers
// the production server 403 whatever the user agent (200 from a workstation,
// 2026-11-08). Its reader is built and tested (theater-dramabox.ts); giving
// the entry its `read` back turns it on.
// No reader: kalostv and flareflow only answer a signed, encrypted API;
// goodshort's 北斗 id is not the id its site uses; shortmax and flickreels
// had nothing in 北斗 to read.

import type { LookupPlatform } from "./contracts.ts";
import { DRAMABOX_ID, dramaBoxPageUrl } from "./theater-dramabox.ts";
import { theaterGet, type TheaterDetails, type TheaterGet } from "./theater-http.ts";
import { MOBOREELS_ID, moboReelsPageUrl, readMoboReels } from "./theater-moboreels.ts";
import { NETSHORT_ID, netShortPageUrl, readNetShort } from "./theater-netshort.ts";
import { readReelShort, REELSHORT_ID, reelShortPageUrl } from "./theater-reelshort.ts";
import { readStardustTv, STARDUSTTV_ID, stardustTvPageUrl } from "./theater-stardusttv.ts";
import { readYourChannel, YOURCHANNEL_ID, yourChannelPageUrl } from "./theater-yourchannel.ts";

export type { TheaterDetails } from "./theater-http.ts";

interface TheaterReader {
  /** The ids this platform uses; anything else is never sent to its site. */
  readonly id: RegExp;
  readonly pageUrl: (id: string) => string;
  /** Absent: the site is linked for a person but not read by the server. */
  readonly read?: (id: string, get: TheaterGet) => Promise<TheaterDetails | null>;
}

const READERS: Readonly<Partial<Record<LookupPlatform, TheaterReader>>> = {
  reelshort: { id: REELSHORT_ID, pageUrl: reelShortPageUrl, read: readReelShort },
  dramabox: { id: DRAMABOX_ID, pageUrl: dramaBoxPageUrl },
  stardusttv: { id: STARDUSTTV_ID, pageUrl: stardustTvPageUrl, read: readStardustTv },
  moboreels: { id: MOBOREELS_ID, pageUrl: moboReelsPageUrl, read: readMoboReels },
  netshort: { id: NETSHORT_ID, pageUrl: netShortPageUrl, read: readNetShort },
  yourchannel: { id: YOURCHANNEL_ID, pageUrl: yourChannelPageUrl, read: readYourChannel },
};

const SITE_TIMEOUT_MS = 15_000;

function readerFor(platform: string): TheaterReader | null {
  return Object.hasOwn(READERS, platform) ? (READERS[platform as LookupPlatform] ?? null) : null;
}

/** The drama's page on the platform's own site, for a person to open; null where there is none to link. */
export function theaterPageUrl(platform: string, dramaId: string | null): string | null {
  const reader = readerFor(platform);
  return reader !== null && dramaId !== null && reader.id.test(dramaId) ? reader.pageUrl(dramaId) : null;
}

/**
 * The drama on the platform's own site. Null for a platform without a reader,
 * an id that is not the platform's, or a site that could not be read: the
 * import then keeps what 北斗 said. Never throws.
 */
export async function fetchTheaterDetails(
  platform: string,
  dramaId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SITE_TIMEOUT_MS,
): Promise<TheaterDetails | null> {
  const reader = readerFor(platform);
  if (reader?.read === undefined || !reader.id.test(dramaId)) return null;
  const budget = Math.min(timeoutMs, SITE_TIMEOUT_MS);
  const deadline = Date.now() + budget;
  try {
    const details = await reader.read(dramaId, theaterGet(fetchImpl, budget));
    // The fetch is cut off at the deadline; reading the page is not, so a late answer is dropped here.
    return details?.platform === platform && Date.now() <= deadline ? details : null;
  } catch (error) {
    console.error("[drama lookup] theater reader failed", platform, error instanceof Error ? error.name : error);
    return null;
  }
}
