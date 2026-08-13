// @input  -- active Tools hub source
// @output -- regression guard that retired URL audits are not advertised as standalone tools
// @pos    -- keeps the supporting-tools hub separate from account-gated Agents

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("Tools hub Agent boundary", () => {
  it("does not render cards for the retired URL audit routes", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    const slugs = [...source.matchAll(/slug: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(slugs).toEqual([
      "seo-quick-wins",
      "traffic-drop-diagnosis",
      "low-competition-keywords",
    ]);
    expect(slugs).not.toContain("seo-audit");
    expect(slugs).not.toContain("internal-link-audit");
  });

  it("keeps the full-product CTA on the marketing waitlist rather than the app", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    expect(source).toContain('localePath(locale, "/waitlist")');
    expect(source).not.toContain("siteConfig.appUrl");
  });
});
