import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  agentsMenuGroups,
  footerResourceLinks,
  headerNavItems,
  menuItemPath,
  resourcesMenuGroups,
} from "./navigation.ts";

/** The header submenus against the exact catalogue boundaries they promote. */

const AGENTS_ROUTE_DIR = fileURLToPath(
  new URL("../app/[locale]/agents", import.meta.url),
);
const LOCALE_APP_DIR = fileURLToPath(
  new URL("../app/[locale]", import.meta.url),
);
const MESSAGES_DIR = fileURLToPath(
  new URL("../i18n/messages", import.meta.url),
);

function menuSlugs(): string[] {
  return agentsMenuGroups.flatMap((group) =>
    group.items.map((item) => item.slug),
  );
}

/** The concrete App Router page a locale-relative navigation href resolves to. */
function routePage(href: string): string {
  return `${LOCALE_APP_DIR}${href}/page.tsx`;
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

describe("Website audits submenu", () => {
  it("promotes exactly the two Agents", () => {
    expect(
      agentsMenuGroups.flatMap((group) =>
        group.items.map((item) => ({
          slug: item.slug,
          href: menuItemPath("/agents", item),
        })),
      ),
    ).toEqual([
      { slug: "seo", href: "/agents/seo" },
      { slug: "geo", href: "/agents/geo" },
    ]);
    expect(
      agentsMenuGroups.flatMap((group) =>
        group.items.map((item) => menuItemPath("/agents", item)),
      ),
    ).not.toContain("/tools/internal-link-audit");
  });

  it("keeps the Tech Agent compatibility route without promoting it", () => {
    expect(existsSync(`${AGENTS_ROUTE_DIR}/tech/page.tsx`)).toBe(true);
    expect(menuSlugs()).not.toContain("tech");
  });

  it("points every promoted audit destination at a concrete route", () => {
    for (const item of agentsMenuGroups.flatMap((group) => group.items)) {
      const href = menuItemPath("/agents", item);
      expect(existsSync(routePage(href)), href).toBe(true);
    }
  });

  it("does not repeat a destination across groups", () => {
    const slugs = menuSlugs();
    expect(slugs).toHaveLength(new Set(slugs).size);
  });

  it("links the Agents directory from its primary submenu", () => {
    const withMenu = headerNavItems.filter((item) => item.menu);
    const agents = withMenu.find((item) => item.href === "/agents");

    expect(agents?.menu).toBe(agentsMenuGroups);
    expect(agents?.menuViewAllLabelKey).toBe("nav.agentsMenu.viewAll");
  });

  it("keeps the exact primary IA and does not promote Tools", () => {
    expect(
      headerNavItems.map(({ labelKey, href }) => ({ labelKey, href })),
    ).toEqual([
      { labelKey: "common.home", href: "/" },
      { labelKey: "nav.agents", href: "/agents" },
      { labelKey: "nav.blog", href: "/blog" },
      { labelKey: "nav.resources", href: "/resources" },
      { labelKey: "nav.pricing", href: "/pricing" },
    ]);
    expect(headerNavItems.some((item) => item.href === "/tools")).toBe(false);
    expect(headerNavItems.some((item) => item.labelKey === "nav.tools")).toBe(
      false,
    );
  });
});

describe("Resources submenu", () => {
  it("is the second primary submenu and links the Resources directory", () => {
    const withMenu = headerNavItems.filter((item) => item.menu);

    expect(withMenu.map((item) => item.href)).toEqual([
      "/agents",
      "/resources",
    ]);
    expect(withMenu[1]?.menu).toBe(resourcesMenuGroups);
    expect(withMenu[1]?.menuViewAllLabelKey).toBe("nav.resourcesMenu.viewAll");
  });

  it("keeps Prompts, Tools, Skills, and Docs at their exact destinations", () => {
    expect(
      resourcesMenuGroups.flatMap((group) =>
        group.items.map(({ slug, href }) => ({ slug, href })),
      ),
    ).toEqual([
      // Prompts, Tools and Skills have their own hubs; Docs is still an anchor
      // on the Resources page because no Docs route exists yet.
      { slug: "prompts", href: "/prompts" },
      { slug: "tools", href: "/tools" },
      { slug: "skills", href: "/skills" },
      { slug: "docs", href: "/resources#docs" },
    ]);
  });

  it("uses explicit destinations for the Resources catalogues", () => {
    expect(menuItemPath("/agents", { slug: "seo" })).toBe("/agents/seo");
    expect(
      menuItemPath("/resources", {
        slug: "prompts",
        href: "/resources#prompts",
      }),
    ).toBe("/resources#prompts");
    expect(menuItemPath("/resources", { slug: "tools", href: "/tools" })).toBe(
      "/tools",
    );
  });

  it("uses the same Resources IA in the footer", () => {
    expect(footerResourceLinks).toEqual([
      { labelKey: "nav.resourcesMenu.prompts.label", href: "/prompts" },
      { labelKey: "nav.resourcesMenu.tools.label", href: "/tools" },
      { labelKey: "nav.resourcesMenu.skills.label", href: "/skills" },
      {
        labelKey: "nav.resourcesMenu.docs.label",
        href: "/resources#docs",
      },
    ]);
  });
});

describe("Navigation copy", () => {
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
      ...resourcesMenuGroups.map((group) => group.labelKey),
      ...resourcesMenuGroups.flatMap((group) =>
        group.items.flatMap((item) => [item.labelKey, item.descriptionKey]),
      ),
      "nav.resourcesMenu.viewAll",
      ...footerResourceLinks.map((item) => item.labelKey),
    ];

    for (const key of keys) {
      const value = lookup(messages, key);
      expect(typeof value, `${locale}: ${key} is not a string`).toBe("string");
      expect(value, `${locale}: ${key} is empty`).not.toBe("");
    }
  });

  it("keeps Internal Link Audit copy in Tools rather than Agents", () => {
    const en = readMessages("en");
    const zh = readMessages("zh");

    expect(lookup(en, "nav.agentsMenu.group")).toBe("Website audits");
    expect(lookup(zh, "nav.agentsMenu.group")).toBe("网站审查");
    expect(lookup(en, "nav.agentsMenu.internalLinkAudit")).toBeUndefined();
    expect(lookup(zh, "nav.agentsMenu.internalLinkAudit")).toBeUndefined();
    expect(lookup(en, "nav.toolsMenu.internalLinkAudit.label")).toBe(
      "Internal Link Audit",
    );
    expect(lookup(zh, "nav.toolsMenu.internalLinkAudit.label")).toBe(
      "内链审计",
    );
  });
});
