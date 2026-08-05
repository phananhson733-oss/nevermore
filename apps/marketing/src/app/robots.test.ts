import { describe, expect, it } from "vitest";

import robots from "./robots.ts";

describe("robots", () => {
  it("blocks faceted blog filters for every crawler group but leaves pagination crawlable", () => {
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(true);

    for (const rule of Array.isArray(rules) ? rules : [rules]) {
      const disallow = Array.isArray(rule.disallow)
        ? rule.disallow
        : [rule.disallow];
      expect(disallow).toContain("/*?*category=");
      expect(disallow).toContain("/*?*pillar=");
      expect(disallow).not.toContain("/*?*page=");
    }
  });
});
