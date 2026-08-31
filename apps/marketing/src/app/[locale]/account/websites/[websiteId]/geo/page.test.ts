import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical website GEO page", () => {
  it("is request-rendered and noindex, with only the required editor messages", () => {
    let source = "";
    try { source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8"); } catch { /* missing page */ }
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("noIndex: true");
    expect(source).toContain("<WebsiteGeoEditor websiteId={websiteId}");
    expect(source).toContain("geoKnowledgeBase: messages.tools.geoKnowledgeBase");
    expect(source).not.toContain("messages={messages}");
  });
});
