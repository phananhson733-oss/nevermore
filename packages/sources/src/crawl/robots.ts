/**
 * robots.txt parsing for the crawl adapter (spec §7.3). Vendor-copied and
 * reshaped from the old `packages/crawler/src/robots.ts` + `ai-bots.ts`
 * (commit 72af9300…), reshaped to `CrawlRobotsProjection`. The old repo's
 * `@signalframe/core` `CrawlerAccessRule` type and the monitored-bot report are
 * dropped; the projection records raw per-user-agent allow/disallow groups so a
 * later WP3 rule can inspect AI-crawler access itself.
 *
 * Two consumers:
 *  - `parseRobots` → the `CrawlRobotsProjection` persisted as an observation.
 *  - `isPathAllowed` → the engine's own-crawler gate (longest-match, Allow wins
 *    a specificity tie), applied to every BFS URL before it is fetched.
 */

import type { CrawlRobotsProjection } from "../observations.ts";

/**
 * AI-crawler user agents that MUST always be represented in the projection so a
 * later rule can inspect their access (spec §7.3). Source: old `ai-bots.ts`.
 */
export const AI_BOT_USER_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
] as const;

/** One parsed robots.txt group. Agent tokens are lowercased for matching. */
export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly allow: readonly string[];
  readonly disallow: readonly string[];
}

interface MutableGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

function parseGroups(content: string): readonly RobotsGroup[] {
  const groups: MutableGroup[] = [];
  let current: MutableGroup | undefined;
  let sawDirective = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (!current || sawDirective) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        sawDirective = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((name === "allow" || name === "disallow") && current) {
      sawDirective = true;
      if (value) current[name].push(value);
    }
  }
  return groups;
}

/** Product token used for matching: the part before "/" in a UA string. */
function productToken(userAgent: string): string {
  const slash = userAgent.indexOf("/");
  return (slash >= 0 ? userAgent.slice(0, slash) : userAgent).trim().toLowerCase();
}

function groupForUserAgent(groups: readonly RobotsGroup[], userAgent: string): RobotsGroup | undefined {
  const token = productToken(userAgent);
  return (
    groups.find((group) => group.agents.includes(token)) ??
    groups.find((group) => group.agents.includes("*"))
  );
}

function globMatches(path: string, pattern: string): boolean {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\$$/, "$");
  return new RegExp(`^${expression}`).test(path);
}

/**
 * Applies the RFC-style longest matching robots directive to one path. An
 * equally specific Allow wins over Disallow. Empty content = fully allowed.
 * Governs SignalFrame's own crawler only.
 */
export function isPathAllowed(groups: readonly RobotsGroup[], userAgent: string, path: string): boolean {
  const group = groupForUserAgent(groups, userAgent);
  if (!group) return true;
  const matches = [
    ...group.disallow.filter(Boolean).filter((pattern) => globMatches(path, pattern)).map((pattern) => ({ pattern, allowed: false })),
    ...group.allow.filter(Boolean).filter((pattern) => globMatches(path, pattern)).map((pattern) => ({ pattern, allowed: true })),
  ];
  if (matches.length === 0) return true;
  matches.sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allowed) - Number(a.allowed));
  return matches[0]?.allowed ?? true;
}

function projectionGroup(group: RobotsGroup, userAgent: string): CrawlRobotsProjection["groups"][number] {
  return {
    userAgent,
    disallow: [...group.disallow],
    allow: [...group.allow],
  };
}

function collectSitemapUrls(content: string, origin: string): readonly string[] {
  return [
    ...new Set(
      [...content.matchAll(/^\s*sitemap\s*:\s*(.+?)\s*$/gim)]
        .map((match) => match[1]?.trim())
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => {
          try {
            return [new URL(value, origin).href];
          } catch {
            return [];
          }
        }),
    ),
  ];
}

/**
 * Parse robots.txt into a `CrawlRobotsProjection` plus the parsed groups the
 * engine uses for its own-crawler gate. The projection groups preserve every
 * user-agent token found in the file (first-appearance order) and additionally
 * guarantee an entry for each required AI-crawler UA (resolved from its
 * dedicated group, else the `*` group), so a rule can always inspect them.
 */
export function parseRobots(
  content: string,
  origin: string,
  fetched: boolean,
): { readonly projection: CrawlRobotsProjection; readonly groups: readonly RobotsGroup[] } {
  const groups = parseGroups(content);
  const projectionGroups: CrawlRobotsProjection["groups"][number][] = [];
  const seenAgents = new Set<string>();

  for (const group of groups) {
    for (const agent of group.agents) {
      if (seenAgents.has(agent)) continue;
      seenAgents.add(agent);
      projectionGroups.push(projectionGroup(group, agent));
    }
  }

  const wildcard = groups.find((group) => group.agents.includes("*"));
  for (const bot of AI_BOT_USER_AGENTS) {
    const token = bot.toLowerCase();
    if (seenAgents.has(token)) continue;
    const dedicated = groups.find((group) => group.agents.includes(token));
    const source = dedicated ?? wildcard;
    seenAgents.add(token);
    projectionGroups.push({
      userAgent: bot,
      disallow: source ? [...source.disallow] : [],
      allow: source ? [...source.allow] : [],
    });
  }

  return {
    projection: {
      fetched,
      groups: projectionGroups,
      sitemaps: collectSitemapUrls(content, origin),
    },
    groups,
  };
}

/** The projection for a robots.txt that was never successfully fetched. */
export function emptyRobots(): { readonly projection: CrawlRobotsProjection; readonly groups: readonly RobotsGroup[] } {
  return parseRobots("", "", false);
}
