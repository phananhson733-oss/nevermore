// @input  -- one POST request at each legacy audit API boundary
// @output -- proof that both routes delegate to the exact shared Agent boundary
// @pos    -- compatibility-route wiring tests for retired raw audit contracts

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAgentAudit: vi.fn(),
}));

vi.mock("../../../lib/agents/audit-handler.ts", () => ({
  handleAgentAuditRequest: mocks.handleAgentAudit,
}));

const { POST: postSeoAudit } = await import("./seo-audit/route.ts");
const { POST: postInternalLinkAudit } = await import(
  "./internal-link-audit/route.ts"
);

const routes = [
  {
    name: "SEO Audit",
    post: postSeoAudit,
    agent: "seo",
  },
  {
    name: "Internal Link Audit",
    post: postInternalLinkAudit,
    agent: "tech",
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
});

describe.each(routes)("POST legacy $name route", ({ post, agent }) => {
  it(`delegates directly to the shared ${agent} Agent boundary`, async () => {
    const delegated = new Response("delegated", { status: 207 });
    mocks.handleAgentAudit.mockResolvedValue(delegated);
    const request = new Request("https://gengrowth.ai/api/tools/legacy", {
      method: "POST",
      body: JSON.stringify({ url: "example.com" }),
    });

    const response = await post(request);

    expect(response).toBe(delegated);
    expect(mocks.handleAgentAudit).toHaveBeenCalledOnce();
    expect(mocks.handleAgentAudit).toHaveBeenCalledWith(request, agent);
  });
});
