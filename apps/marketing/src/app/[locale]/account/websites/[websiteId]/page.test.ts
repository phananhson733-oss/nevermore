import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(): string {
  try {
    return readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  } catch {
    return "";
  }
}

describe("/account/websites/[websiteId] page contract", () => {
  it("is request-rendered, noindex, and awaits Next 16 params", () => {
    const page = source();
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("noIndex: true");
    expect(page).toContain("await Promise.all([");
    expect(page).toContain("params,");
    expect(page).toContain("searchParams,");
  });

  it("mounts the combined Profile and bottom GEO with only their required messages", () => {
    const page = source();
    expect(page).toMatch(
      /account: messages\.account,/u,
    );
    expect(page).toContain("<WebsiteProfileWithGeo");
    expect(page).toContain("geoKnowledgeBase: messages.tools.geoKnowledgeBase");
    expect(page).toContain("search: messages.agents.workbench.profile.search");
    expect(page).toContain("websiteId={websiteId}");
    expect(page).toContain('autoGenerate={generate === "1"}');
    expect(page).not.toContain("messages={messages}");
    expect(page).not.toContain("agents: messages.agents");
    expect(page).not.toContain("workbench: messages.agents.workbench");
    expect(page).not.toContain("profile: messages.agents.workbench.profile");
  });
});
