// @input  -- GEO agent page source
// @output -- regression guard for the shared website-profile message subset
// @pos    -- server-page contract for the GEO agent client boundary

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./geo-agent-page.tsx", import.meta.url), "utf8");

describe("GEO agent page message scope", () => {
  it("passes GEO, shared website-profile, and auth copy to the client boundary", () => {
    expect(SOURCE).toMatch(
      /messages=\{\{\s*agents:\s*\{\s*geo:\s*messages\.agents\.geo,\s*workbench:\s*\{\s*websiteProfile:\s*messages\.agents\.workbench\.websiteProfile,\s*\},\s*\},\s*auth:\s*messages\.auth,\s*\}\}/s,
    );
    expect(SOURCE).not.toContain("messages={messages}");
  });
});
