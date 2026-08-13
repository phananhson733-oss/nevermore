import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentsMenuGroups, headerNavItems } from "./navigation.ts";

/**
 * The header Agents submenu against the route directories it can drift from.
 *
 * A menu is a second copy of a route catalogue, and second copies rot. The
 * route directories are therefore the authority and the two lists are checked
 * in both directions.
 */

const AGENTS_ROUTE_DIR = fileURLToPath(
  new URL("../app/[locale]/agents", import.meta.url),
);
const MESSAGES_DIR = fileURLToPath(new URL("../i18n/messages", import.meta.url));

function routedAgentSlugs(): string[] {
  if (!existsSync(AGENTS_ROUTE_DIR)) return [];
  return readdirSync(AGENTS_ROUTE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function menuSlugs(): string[] {
  return agentsMenuGroups.flatMap((group) =>
    group.items.map((item) => item.slug),
  );
}

function readMessages(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(`${MESSAGES_DIR}/${locale}.json`, "utf8"),
  ) as Record<string, unknown>;
}

/** Resolve a dotted next-intl key, or undefined if any segment is missing. */
function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      messages,
    );
}

describe("Agents submenu", () => {
  it("matches the routed Agent pages exactly", () => {
    expect(menuSlugs().sort()).toEqual(routedAgentSlugs());
    expect(menuSlugs().sort()).toEqual(["seo", "tech"]);
  });

  it("does not repeat an Agent across groups", () => {
    const slugs = menuSlugs();
    expect(slugs).toHaveLength(new Set(slugs).size);
  });

  it("is the only primary submenu and links the Agents directory", () => {
    const withMenu = headerNavItems.filter((item) => item.menu);
    expect(withMenu.map((item) => item.href)).toEqual(["/agents"]);
    expect(withMenu[0]?.menu).toBe(agentsMenuGroups);
  });

  it("keeps the primary IA to Agents, Blog, and Pricing", () => {
    expect(headerNavItems.map((item) => item.href)).toEqual([
      "/agents",
      "/blog",
      "/pricing",
    ]);
  });
});

describe("Agents submenu copy", () => {
  const locales = ["en", "zh"];

  it.each(locales)("translates every label and description in %s", (locale) => {
    const messages = readMessages(locale);
    const keys = [
      ...headerNavItems.map((item) => item.labelKey),
      ...agentsMenuGroups.map((group) => group.labelKey),
      ...agentsMenuGroups.flatMap((group) =>
        group.items.flatMap((item) => [item.labelKey, item.descriptionKey]),
      ),
      "nav.agentsMenu.viewAll",
    ];

    for (const key of keys) {
      const value = lookup(messages, key);
      expect(typeof value, `${locale}: ${key} is not a string`).toBe("string");
      expect(value, `${locale}: ${key} is empty`).not.toBe("");
    }
  });
});
