import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONTACT_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("Contact page access boundary", () => {
  it("keeps direct email and routes product access interest to the marketing waitlist", () => {
    const source = readFileSync(CONTACT_PAGE, "utf8");

    expect(source).toContain("mailto:");
    expect(source).toContain('localePath(locale, "/waitlist")');
    expect(source).not.toContain("siteConfig.appUrl");
    expect(source).not.toContain("Open GenGrowth");
  });
});
