// @input  -- one POST at the On-Page Checker's own API boundary
// @output -- proof it reaches the shared handler under the checker's credit identity
// @pos    -- the wiring test for the route that separates the two ledger labels
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAgentAudit: vi.fn(),
}));

/**
 * Only the entry point is replaced. `ON_PAGE_CHECK_DEPENDENCIES` stays real,
 * because the whole point of this test is which dependency object the route
 * hands over — a mocked stand-in would prove nothing about the ledger label.
 */
vi.mock("../../../../lib/agents/audit-handler.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../lib/agents/audit-handler.ts")>();
  return {
    ...actual,
    handleAgentAuditRequest: mocks.handleAgentAudit,
  };
});

const { ON_PAGE_CHECK_DEPENDENCIES } = await import(
  "../../../../lib/agents/audit-handler.ts"
);
const { POST } = await import("./route.ts");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/tools/on-page-seo-check", () => {
  it("delegates to the seo Agent boundary under the checker's own identity", async () => {
    const delegated = new Response("delegated", { status: 207 });
    mocks.handleAgentAudit.mockResolvedValue(delegated);
    const request = new Request(
      "https://gengrowth.ai/api/tools/on-page-seo-check",
      {
        method: "POST",
        body: JSON.stringify({ url: "example.com" }),
      },
    );

    const response = await POST(request);

    expect(response).toBe(delegated);
    expect(mocks.handleAgentAudit).toHaveBeenCalledOnce();
    expect(mocks.handleAgentAudit).toHaveBeenCalledWith(
      request,
      "seo",
      ON_PAGE_CHECK_DEPENDENCIES,
    );
    expect(ON_PAGE_CHECK_DEPENDENCIES.reportAs).toBe("on-page-seo-check");
  });

  it("is the boundary that pays for a results-page lookup", async () => {
    // Both entry points now use the same bounded reader. The On-Page boundary
    // remains distinct because its server-owned reporting identity differs.
    const { DEFAULT_DEPENDENCIES } = await import(
      "../../../../lib/agents/audit-handler.ts"
    );
    expect(ON_PAGE_CHECK_DEPENDENCIES.readSerpLandscape).toBeTypeOf("function");
    expect(DEFAULT_DEPENDENCIES.readSerpLandscape).toBeTypeOf("function");
    expect(ON_PAGE_CHECK_DEPENDENCIES.reportAs).toBe("on-page-seo-check");
  });
});
