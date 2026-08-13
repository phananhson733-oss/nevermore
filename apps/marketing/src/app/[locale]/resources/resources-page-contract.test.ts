// @input  -- Resources hub source
// @output -- resource IA, availability, and link-boundary regression guard
// @pos    -- keeps Tools available while planned resource examples remain non-links

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RESOURCES_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("Resources hub contract", () => {
  it("exposes the four resource anchors and only routes to the real Tools hub", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");
    const typeIndex = source.slice(
      source.indexOf("const RESOURCE_TYPES"),
      source.indexOf("const PLANNED_RESOURCES"),
    );
    const ids = [...typeIndex.matchAll(/id: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    const routedPaths = [
      ...source.matchAll(/localePath\(locale, "([^"]+)"\)/g),
    ].map((match) => match[1]);

    expect(ids).toEqual(["prompts", "tools", "skills", "docs"]);
    expect(source).toContain("href={`#${type.id}`}");
    expect(source).toContain('id="tools"');
    expect(source).toContain("id={resource.id}");
    expect(routedPaths).toEqual(["/tools", "/tools"]);
  });

  it("does not claim anonymous access or add an application-site handoff", () => {
    const source = readFileSync(RESOURCES_PAGE, "utf8");

    expect(source).not.toMatch(/\banonymous\b|\bfree\b|app\.gengrowth\.ai/i);
  });
});
