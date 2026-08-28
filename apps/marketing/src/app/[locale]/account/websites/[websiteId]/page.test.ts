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

  it("mounts the editor with one account namespace and explicit generation intent", () => {
    const page = source();
    expect(page).toContain("messages={{ account: messages.account }}");
    expect(page).toContain("<WebsiteProfileEditor");
    expect(page).toContain("websiteId={websiteId}");
    expect(page).toContain('autoGenerate={generate === "1"}');
    expect(page).not.toContain("messages={messages}");
  });
});
