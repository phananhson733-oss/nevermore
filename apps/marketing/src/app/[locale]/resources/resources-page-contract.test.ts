// @input  -- Resources hub source
// @output -- resource IA, availability, and link-boundary regression guard
// @pos    -- keeps availability claims tied to routes that actually exist

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RESOURCES_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));
const MESSAGES_DIR = fileURLToPath(
  new URL("../../../i18n/messages", import.meta.url),
);

interface ResourceType {
  readonly id: string;
  readonly status: string;
  readonly path: string | null;
}

function readResourceTypes(source: string): readonly ResourceType[] {
  const block = source.slice(
    source.indexOf("const RESOURCE_TYPES"),
    source.indexOf("const AVAILABLE_RESOURCES"),
  );

  return [
    ...block.matchAll(
      /id: "([^"]+)",\s*sequence: "[^"]+",\s*status: "([^"]+)",\s*path: (?:"([^"]+)"|null)/g,
    ),
  ].map((match) => ({
    id: match[1] ?? "",
    status: match[2] ?? "",
    path: match[3] ?? null,
  }));
}

/** The cards rendered in the available section, with the route each links to. */
function readAvailableResources(
  source: string,
): readonly { readonly id: string; readonly path: string }[] {
  const block = source.slice(
    source.indexOf("const AVAILABLE_RESOURCES"),
    source.indexOf("const PLANNED_RESOURCES"),
  );

  return [
    ...block.matchAll(/id: "([^"]+)",\s*icon: \w+,\s*path: "([^"]+)"/g),
  ].map((match) => ({ id: match[1] ?? "", path: match[2] ?? "" }));
}

describe("Resources hub contract", () => {
  it("keeps the four resource anchors in order", () => {
    const types = readResourceTypes(readFileSync(RESOURCES_PAGE, "utf8"));

    expect(types.map((type) => type.id)).toEqual([
      "prompts",
      "tools",
      "skills",
      "docs",
    ]);
  });

  it("only calls a resource available when it carries a real route", () => {
    const types = readResourceTypes(readFileSync(RESOURCES_PAGE, "utf8"));

    for (const type of types) {
      if (type.status === "available") {
        expect(type.path).toBe(`/${type.id}`);
      } else {
        // A planned type must not carry a route. Giving it one would promise a
        // page that does not exist.
        expect(type.path).toBeNull();
      }
    }
  });

  it("renders an available card for exactly the available types", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");
    const availableTypes = readResourceTypes(source).filter(
      (type) => type.status === "available",
    );
    const cards = readAvailableResources(source);

    expect(cards.map((card) => card.id)).toEqual(
      availableTypes.map((type) => type.id),
    );
    // The nav tile and the section card must agree on where a type lives; two
    // sources of truth for one route is how one of them goes stale.
    expect(cards.map((card) => card.path)).toEqual(
      availableTypes.map((type) => type.path),
    );
  });

  it("renders the declared paths as links rather than leaving them unused", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");

    // Asserting the data alone would pass on a page that declared a path and
    // then rendered every tile as an anchor. These are the two expressions that
    // actually turn a declared path into a link.
    expect(source).toContain("localePath(locale, type.path)");
    expect(source).toContain("localePath(locale, resource.path)");
    // And the available branch has to be a real navigation, not an anchor.
    expect(source).toMatch(/type\.path \?\s*\(\s*<Link/);
  });

  it("reaches planned types by anchor and routes only through declared paths", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");
    const declared = new Set([
      ...readResourceTypes(source)
        .filter((type) => type.path)
        .map((type) => type.path as string),
      ...readAvailableResources(source).map((card) => card.path),
    ]);
    const hardcodedRoutes = [
      ...source.matchAll(/localePath\(locale, "([^"]+)"\)/g),
    ].map((match) => match[1] as string);

    // Planned cards are reached by same-page anchor only.
    expect(source).toContain("href={`#${type.id}`}");
    // Routes come from the declarations above, so any literal path written
    // straight into a link has to be one of them.
    for (const route of hardcodedRoutes) {
      expect(declared).toContain(route);
    }
  });

  it("does not claim anonymous access or add an application-site handoff", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");

    expect(source).not.toMatch(/\banonymous\b|\bfree\b|app\.gengrowth\.ai/i);
  });

  it.each([
    { locale: "en", expected: "Agent-backed audit entry cards" },
    { locale: "zh", expected: "由 Agent 执行的 SEO 与技术审计入口卡片" },
  ])(
    "describes the restored audit cards accurately in $locale",
    ({ locale, expected }) => {
      const messages = JSON.parse(
        readFileSync(`${MESSAGES_DIR}/${locale}.json`, "utf8"),
      ) as {
        resources: { sections: { available: { body: string } } };
      };
      const body = messages.resources.sections.available.body;

      expect(body).toContain(expected);
      expect(body).not.toMatch(/rather than Tool cards|不是 Tool 卡片/);
    },
  );
});
