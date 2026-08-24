// @input  -- one POST request at each audit API boundary
// @output -- proof that SEO stays Agent-backed while Internal Link Audit stays public
// @pos    -- route wiring guards for the split authenticated/public audit contracts

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAgentAudit: vi.fn(),
  handleInternalLinkAudit: vi.fn(),
}));

vi.mock("../../../lib/agents/audit-handler.ts", () => ({
  handleAgentAuditRequest: mocks.handleAgentAudit,
}));

vi.mock("../../../lib/tools/internal-link-audit-handler.ts", () => ({
  handleInternalLinkAuditRequest: mocks.handleInternalLinkAudit,
}));

const { POST: postSeoAudit } = await import("./seo-audit/route.ts");
const { POST: postInternalLinkAudit } = await import(
  "./internal-link-audit/route.ts"
);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST legacy SEO Audit route", () => {
  it("delegates directly to the shared SEO Agent boundary", async () => {
    const delegated = new Response("delegated", { status: 207 });
    mocks.handleAgentAudit.mockResolvedValue(delegated);
    const request = new Request("https://gengrowth.ai/api/tools/seo-audit", {
      method: "POST",
      body: JSON.stringify({ url: "example.com" }),
    });

    const response = await postSeoAudit(request);

    expect(response).toBe(delegated);
    expect(mocks.handleAgentAudit).toHaveBeenCalledOnce();
    expect(mocks.handleAgentAudit).toHaveBeenCalledWith(request, "seo");
    expect(mocks.handleInternalLinkAudit).not.toHaveBeenCalled();
  });
});

describe("POST Internal Link Audit route", () => {
  it("delegates directly to the public Internal Link Audit handler", async () => {
    const delegated = new Response("delegated", { status: 207 });
    mocks.handleInternalLinkAudit.mockResolvedValue(delegated);
    const request = new Request(
      "https://gengrowth.ai/api/tools/internal-link-audit",
      {
        method: "POST",
        body: JSON.stringify({ url: "example.com" }),
      },
    );

    const response = await postInternalLinkAudit(request);

    expect(response).toBe(delegated);
    expect(mocks.handleInternalLinkAudit).toHaveBeenCalledOnce();
    expect(mocks.handleInternalLinkAudit).toHaveBeenCalledWith(request);
    expect(mocks.handleAgentAudit).not.toHaveBeenCalled();
  });
});
