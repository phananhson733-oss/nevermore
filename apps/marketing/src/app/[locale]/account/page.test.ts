// @input  -- the account redirect page source
// @output -- a failing test if /account stops redirecting to /account/websites
// @pos    -- keeps the account root pinned to the websites settings module

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const PAGE = read("./page.tsx");

describe("/account page contract", () => {
  it("redirects locale-safely to the websites settings page", () => {
    expect(PAGE).toContain('redirect(localePath(locale, "/account/websites"))');
  });

  it("stays dynamic rather than cacheable", () => {
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
  });
});
