// @input  -- complete English and Chinese marketing message catalogs
// @output -- exact leaf-shape parity for the Agent-specific message tree
// @pos    -- locale guard for all three Agent routes and shared workbench

import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("Agent message catalogs", () => {
  it("keeps every English and Chinese Agent leaf aligned", () => {
    expect([...leafPaths(en.agents)].sort()).toEqual(
      [...leafPaths(zh.agents)].sort(),
    );
  });

  it("keeps implementation previews free of ICU and rich-text control syntax", () => {
    for (const messages of [en, zh]) {
      for (const category of [
        "metadata",
        "structure",
        "structured_data",
        "crawl",
        "indexability",
        "links",
      ] as const) {
        const template = messages.agents.workbench.categories[category].implementation;
        expect(template).not.toMatch(/[{}<]/);
      }
    }
  });
});
