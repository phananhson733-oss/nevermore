// @input  -- low-competition keywords page source
// @output -- regression guard for the shared website-profile message subset
// @pos    -- server-page contract for the signed-in keyword/context Tool consumer

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Low Competition Keywords page message scope", () => {
  it("loads the Search Console grant and messages together", () => {
    expect(SOURCE).toMatch(
      /const \[session, messages\] = await Promise\.all\(\[\s*readTrafficDropSession\(\),\s*getMessages\(\),?\s*\]\)/,
    );
  });

  it("passes the shared website-profile copy with the keyword tool namespace", () => {
    expect(SOURCE).toContain("websiteProfile: messages.agents.workbench.websiteProfile");
    expect(SOURCE).toContain("tools: { keywordMap: messages.tools.keywordMap }");
    expect(SOURCE).not.toContain("messages={messages}");
  });
});
