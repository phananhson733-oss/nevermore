// @input  -- one POST at the On-Page Checker's own API boundary
// @output -- proof it reaches the strict buffered handler under the checker's credit identity
// @pos    -- wiring test for the route that separates ledger and entry-page policy
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAgentAudit: vi.fn(),
  handleSeoAudit: vi.fn(),
}));

vi.mock("../../../../lib/tools/seo-audit-handler.ts", () => ({
  handleSeoAuditRequest: mocks.handleSeoAudit,
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

  it("uses the buffered strict-entry delegate behind the production route", async () => {
    const delegated = new Response("delegated", { status: 207 });
    mocks.handleSeoAudit.mockResolvedValue(delegated);
    const request = new Request(
      "https://gengrowth.ai/api/tools/on-page-seo-check",
      { method: "POST" },
    );
    const input = {
      url: "example.com/replaced",
      targetQueries: null,
      pageRole: null,
      market: null,
      language: null,
      tier: "full-site",
      extraKeyPages: [],
    } as const;

    const response = await ON_PAGE_CHECK_DEPENDENCIES.delegate(request, input);

    expect(response).toBe(delegated);
    expect(mocks.handleSeoAudit).toHaveBeenCalledWith(request, undefined, {
      forceBufferedJson: true,
      input,
      requireSameEntrySubject: true,
    });
  });

  it("is the boundary that pays for a results-page lookup", async () => {
    // Attached here and deliberately not on the shared default: the SEO Agent
    // runs through the same handler, and a seam on the default object would
    // have spent a provider call on every Agent run without anyone asking.
    const { DEFAULT_DEPENDENCIES } = await import(
      "../../../../lib/agents/audit-handler.ts"
    );
    expect(ON_PAGE_CHECK_DEPENDENCIES.readSerpLandscape).toBeTypeOf("function");
    expect(DEFAULT_DEPENDENCIES.readSerpLandscape).toBeUndefined();
  });
});
