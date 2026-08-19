// @input  -- the robots projection this crawl already collected
// @output -- whether a search crawler may fetch a given path, and why
// @pos    -- pure; the crawl made the requests, this only re-reads the rules
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isPathAllowed } from "@sf/sources/crawl-robots";

/**
 * The crawler these checks ask about.
 *
 * Deliberately not our own product token. Our crawler already obeyed robots.txt
 * before this ran, so every page in the report is one we were allowed to fetch
 * and "is this page blocked" would be a permanent no. The interesting case is a
 * file that lets us through and stops Google — a `User-agent: Googlebot` group
 * with its own Disallow, which is invisible to a run that only asks about
 * itself and is exactly the mistake worth reporting.
 */
export const SEARCH_CRAWLER_USER_AGENT = "Googlebot";

/**
 * The parsed-group shape `isPathAllowed` expects.
 *
 * The crawl's projection flattens each group to one user agent, because that is
 * all the crawl needed. The matcher wants the parser's own shape, so the two
 * are bridged here rather than by loosening either side: the projection is part
 * of a cached, hash-pinned payload and the parser is shared with the engine.
 */
interface ProjectedRobotsGroup {
  readonly userAgent: string;
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
}

export interface RobotsAllowanceInput {
  readonly fetched: boolean;
  readonly groups: readonly ProjectedRobotsGroup[];
}

/**
 * Reads one URL's robots allowance for the search crawler.
 *
 * Null when there is nothing to read — robots.txt was never fetched, or the URL
 * is not parseable. Never `true`: an unfetched robots.txt is not permission,
 * and reporting it as permission is how a check that cannot run becomes a pass.
 */
export function searchCrawlerMayFetch(
  robots: RobotsAllowanceInput,
  url: string,
): boolean | null {
  if (!robots.fetched) return null;
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
  // An empty file allows everything, which the matcher already returns; the
  // distinction that matters is fetched-and-empty versus never fetched, and
  // that one is handled above.
  return isPathAllowed(
    robots.groups.map((group) => ({
      agents: [group.userAgent.trim().toLowerCase()],
      allow: group.allow,
      disallow: group.disallow,
      crawlDelaySeconds: null,
    })),
    SEARCH_CRAWLER_USER_AGENT,
    path,
  );
}
