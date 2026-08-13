// @input  -- waitlist page source
// @output -- regression guard for the direct-link waitlist route and no-trial promise
// @pos    -- keeps /waitlist aligned with the in-site waitlist closure

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../../../i18n/messages/en.json" with { type: "json" };

const WAITLIST_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("/waitlist page contract", () => {
  it("reuses WaitlistForm with access-open copy instead of trial copy", () => {
    const source = readFileSync(WAITLIST_PAGE, "utf8");

    expect(source).toContain("WaitlistForm");
    expect(source).toContain("messages={{ waitlist: messages.waitlist }}");
    expect(source).toContain("Email me when access opens");
    expect(en.waitlist.successDesc).toMatch(/email you when access opens/i);
    expect(source).not.toContain("free trial");
    expect(source).not.toContain("trial invitation");
  });

  it("stays on the marketing domain rather than handing the route to the app", () => {
    const source = readFileSync(WAITLIST_PAGE, "utf8");

    expect(source).not.toContain("app.gengrowth.ai");
    expect(source).not.toContain("siteConfig.appUrl");
  });
});
