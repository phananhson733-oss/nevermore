// @input  -- both locale message bundles
// @output -- a failing test when a tool's formal name drifts from the naming table
// @pos    -- pins the 2026-08-06 naming decision for the P0-1 product card

import { describe, expect, it } from "vitest";

import en from "./en.json";
import zh from "./zh.json";

/**
 * The 2026-08-06 naming decision splits each tool's name into three layers.
 * The formal name lives on product cards and internal documents and is the
 * same English string in both locales; the search-phrase Title/H1 live on the
 * tool page and are allowed to differ. This test pins the formal-name layer.
 */
describe("tool formal names", () => {
  it("keeps the P0-1 formal name GSC Opportunity Finder in both locales", () => {
    expect(en.tools.quickWins.title).toBe("GSC Opportunity Finder");
    expect(zh.tools.quickWins.title).toBe("GSC Opportunity Finder");
  });

  // Handoff 2026-08-28 §1: the content chain's first tool carries the same
  // English formal name in both locales, like the P0-1 card above.
  it("keeps the formal name Content Brief Builder in both locales", () => {
    expect(en.tools.contentBrief.title).toBe("Content Brief Builder");
    expect(zh.tools.contentBrief.title).toBe("Content Brief Builder");
  });

  // Handoff 2026-08-28 §1: the chain's second tool, same rule.
  it("keeps the formal name Content Draft Writer in both locales", () => {
    expect(en.tools.contentDraft.title).toBe("Content Draft Writer");
    expect(zh.tools.contentDraft.title).toBe("Content Draft Writer");
  });
});
