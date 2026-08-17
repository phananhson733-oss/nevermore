// @input  -- the Agents hub card list, the route directories, and both catalogs
// @output -- a failing test when an Agent ships without a card on its own hub
// @pos    -- the guard against a routed Agent nobody can find from /agents

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Why this exists.
 *
 * The hub page hard-codes its cards, and nothing used to check them against
 * the routes. The GEO Agent shipped with a page, a menu entry and a sitemap
 * entry, and was still absent from /agents — the one page whose entire job is
 * to list the Agents. The whole suite stayed green, and the gap was only found
 * by reading production HTML. The route directories are the authority here,
 * exactly as they are for the header menu.
 */

const AGENTS_ROUTE_DIR = fileURLToPath(new URL(".", import.meta.url));
const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));
const MESSAGES_DIR = fileURLToPath(
  new URL("../../../i18n/messages", import.meta.url),
);

function routedAgentSlugs(): string[] {
  return readdirSync(AGENTS_ROUTE_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(fileURLToPath(new URL(`./${entry.name}/page.tsx`, import.meta.url))),
    )
    .map((entry) => entry.name)
    .sort();
}

function cardSlugs(): string[] {
  const source = readFileSync(HUB_PAGE, "utf8");
  const block = /const cards = \[(.*?)\] as const;/su.exec(source);
  if (block === null) throw new Error("hub page no longer declares `cards`");
  return [...block[1]!.matchAll(/id:\s*"([a-z-]+)"/gu)]
    .map((match) => match[1]!)
    .sort();
}

function catalog(locale: string): Record<string, unknown> {
  const messages = JSON.parse(
    readFileSync(`${MESSAGES_DIR}/${locale}.json`, "utf8"),
  ) as { agents: { hub: Record<string, unknown> } };
  return messages.agents.hub;
}

describe("Agents hub cards", () => {
  it("offers a card for every routed Agent, and only for routed Agents", () => {
    expect(cardSlugs()).toEqual(routedAgentSlugs());
  });

  it("links each card at the Agent's own path", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    for (const slug of cardSlugs()) {
      expect(source).toContain(`path: "/agents/${slug}"`);
    }
  });

  it.each(["en", "zh"])("has %s copy for every card", (locale) => {
    const hub = catalog(locale);
    for (const slug of cardSlugs()) {
      const card = hub[slug] as Record<string, string> | undefined;
      expect(card, `agents.hub.${slug} missing in ${locale}`).toBeDefined();
      for (const field of ["title", "description", "scope", "cta"]) {
        expect(card?.[field], `agents.hub.${slug}.${field}`).toBeTruthy();
      }
    }
  });
});
