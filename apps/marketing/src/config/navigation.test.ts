import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { headerNavItems, toolsMenuGroups } from "./navigation.ts";

/**
 * The header tools submenu against the two things it can drift from.
 *
 * A menu is a second copy of a catalogue, and second copies rot: a tool ships
 * with a route and a hub card, nobody remembers the header, and the menu
 * quietly claims the catalogue is smaller than it is. So the route directory —
 * the only place a tool must exist to be reachable at all — is the authority
 * here, and every entry is checked against it in both directions.
 */

const TOOLS_ROUTE_DIR = fileURLToPath(
  new URL("../app/[locale]/tools", import.meta.url),
);
const MESSAGES_DIR = fileURLToPath(new URL("../i18n/messages", import.meta.url));

/**
 * Tools that exist as routes but are deliberately not in the menu.
 *
 * Both are supporting calculators reached from within a workflow rather than
 * entry points a visitor browses to, and the /tools hub omits them for the same
 * reason. Listing them explicitly means adding a tool without a decision fails
 * this test instead of silently joining the exclusions.
 */
const NOT_IN_MENU = new Set(["ab-test-calculator", "growth-roi-calculator"]);

function routedToolSlugs(): string[] {
  return readdirSync(TOOLS_ROUTE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function menuSlugs(): string[] {
  return toolsMenuGroups.flatMap((group) =>
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

describe("tools submenu", () => {
  it("points every entry at a route that exists", () => {
    const routed = new Set(routedToolSlugs());
    for (const slug of menuSlugs()) {
      expect(routed, `/tools/${slug} has no route directory`).toContain(slug);
    }
  });

  it("covers every routed tool except the declared exclusions", () => {
    const listed = new Set(menuSlugs());
    const missing = routedToolSlugs().filter(
      (slug) => !listed.has(slug) && !NOT_IN_MENU.has(slug),
    );
    expect(
      missing,
      "a tool route exists but the header menu does not offer it",
    ).toEqual([]);
  });

  it("does not repeat a tool across groups", () => {
    const slugs = menuSlugs();
    expect(slugs).toHaveLength(new Set(slugs).size);
  });

  it("hangs the submenu off the Free Tools item only", () => {
    const withMenu = headerNavItems.filter((item) => item.menu);
    expect(withMenu.map((item) => item.href)).toEqual(["/tools"]);
    expect(withMenu[0]?.menu).toBe(toolsMenuGroups);
  });
});

describe("tools submenu copy", () => {
  const locales = ["en", "zh"];

  it.each(locales)("translates every label and description in %s", (locale) => {
    const messages = readMessages(locale);
    const keys = [
      ...toolsMenuGroups.map((group) => group.labelKey),
      ...toolsMenuGroups.flatMap((group) =>
        group.items.flatMap((item) => [item.labelKey, item.descriptionKey]),
      ),
      "nav.toolsMenu.viewAll",
    ];

    for (const key of keys) {
      const value = lookup(messages, key);
      expect(typeof value, `${locale}: ${key} is not a string`).toBe("string");
      expect(value, `${locale}: ${key} is empty`).not.toBe("");
    }
  });
});
