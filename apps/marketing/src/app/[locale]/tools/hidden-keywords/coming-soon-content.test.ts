// @input  -- both locales of the hidden-keywords coming-soon copy
// @output -- a failing test when the copy overstates availability or leaks gated naming
// @pos    -- honesty guard for the P0-5 waitlist page

import { describe, expect, it } from "vitest";

import {
  getHiddenKeywordsComingSoonContent,
  type HiddenKeywordsComingSoonContent,
} from "./coming-soon-content";

const en = getHiddenKeywordsComingSoonContent("en");
const zh = getHiddenKeywordsComingSoonContent("zh");

function allStrings(
  content: HiddenKeywordsComingSoonContent,
): readonly string[] {
  return Object.values(content);
}

describe("hidden-keywords coming-soon copy", () => {
  it("carries the same keys in both locales, all non-empty", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const content of [en, zh]) {
      for (const [key, value] of Object.entries(content)) {
        expect(typeof value, key).toBe("string");
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the page title Keyword Opportunity Map without Prompt wording", () => {
    // Naming table: `+ Prompt` joins the formal name only after that
    // capability ships. Until then no surface may advertise it.
    expect(en.metaTitle).toBe("Keyword Opportunity Map");
    expect(zh.metaTitle).toBe("Keyword Opportunity Map");
    for (const value of [...allStrings(en), ...allStrings(zh)]) {
      expect(value.toLowerCase()).not.toContain("prompt");
    }
  });

  it("states plainly that the tool is not available yet", () => {
    expect(en.statusLabel).toBe("Coming soon");
    expect(zh.statusLabel).toBe("即将上线");
    expect(en.availabilityTitle.toLowerCase()).toContain("not available");
    expect(zh.availabilityTitle).toContain("尚未开放");
  });

  it("does not send visitors to the product app as a stand-in CTA", () => {
    for (const value of [...allStrings(en), ...allStrings(zh)]) {
      expect(value).not.toContain("app.gengrowth.ai");
    }
  });

  it("promises only a notification email, not access or results", () => {
    for (const content of [en, zh]) {
      expect(content.successDesc).not.toMatch(/trial|排名|ranking|guarantee/i);
    }
  });
});
