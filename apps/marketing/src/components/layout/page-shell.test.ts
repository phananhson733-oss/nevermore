// @input  -- PageShell source
// @output -- regression guard for the in-site waitlist closure
// @pos    -- keeps legacy waitlist/trial intents on gengrowth.ai rather than the app handoff

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json" with { type: "json" };

const PAGE_SHELL = fileURLToPath(new URL("./page-shell.tsx", import.meta.url));

describe("PageShell waitlist closure", () => {
  it("routes access intent to the in-site waitlist instead of the app", () => {
    const source = readFileSync(PAGE_SHELL, "utf8");

    expect(source).toContain('localePath(locale, "/waitlist")');
    expect(source).not.toContain(
      "openWaitlist: () => window.location.assign(siteConfig.appUrl)",
    );
    expect(source).not.toContain(
      "openTrial: () => window.location.assign(siteConfig.appUrl)",
    );
  });

  it("routes both legacy waitlist and legacy trial intents into the same waitlist copy", () => {
    const source = readFileSync(PAGE_SHELL, "utf8");

    expect(source).toContain("openWaitlist: openAccessWaitlist");
    expect(source).toContain("openTrial: openAccessWaitlist");
    expect(en.waitlist.submit).toBe("Email me when access opens");
    expect(en.waitlist.successDesc).not.toMatch(/free trial|237/iu);
  });
});
