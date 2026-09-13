import { describe, expect, it } from "vitest";
import {
  CONTENT_ASSETS,
  ENUM_GROUPS,
  KB_CATEGORIES,
  LINK_TYPES,
  PROMPT_KINDS,
} from "./enums.ts";

describe("workbench enum id lists", () => {
  it("exposes exactly the sixteen label groups", () => {
    expect(Object.keys(ENUM_GROUPS).sort()).toEqual(
      [
        "artifactType",
        "contentAsset",
        "engine",
        "gscStatus",
        "intent",
        "kbCategory",
        "kbOrigin",
        "keywordSource",
        "level",
        "linkType",
        "module",
        "pageType",
        "promptKind",
        "savedSource",
        "severity",
        "stage",
      ].sort(),
    );
  });

  for (const [group, ids] of Object.entries(ENUM_GROUPS)) {
    it(`${group} has at least one id and no duplicates`, () => {
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("orders knowledge-base categories the way kbMarkdown sections them", () => {
    expect(KB_CATEGORIES).toEqual([
      "definition",
      "capability",
      "boundary",
      "pricing",
      "comparison",
      "data",
      "faq",
    ]);
  });

  it("orders prompt kinds for the visibility prompt set", () => {
    expect(PROMPT_KINDS).toEqual([
      "discover",
      "compare",
      "verify",
      "alternative",
      "scenario",
    ]);
  });

  it("orders link types for the link target list", () => {
    expect(LINK_TYPES).toEqual(["dir", "agg", "comm", "rev", "media", "swap"]);
  });

  it("lists the content assets", () => {
    expect(CONTENT_ASSETS).toEqual([
      "blog",
      "landing",
      "tool",
      "comparison",
      "image",
      "video",
    ]);
  });
});
