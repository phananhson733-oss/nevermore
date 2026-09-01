import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical website GEO page", () => {
  it("keeps old bookmarks as a noindex redirect to the inline GEO anchor", () => {
    let source = "";
    try { source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8"); } catch { /* missing page */ }
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("noIndex: true");
    expect(source).toContain("redirect(");
    expect(source).toContain("#geo");
    expect(source).not.toContain("<WebsiteGeoEditor");
    expect(source).not.toContain("messages={messages}");
  });
});
