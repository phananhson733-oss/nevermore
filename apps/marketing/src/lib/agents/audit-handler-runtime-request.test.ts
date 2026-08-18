// @input  -- authenticated Next runtime request at the default Agent boundary
// @output -- proof that production delegation preserves the request brand and buffers JSON
// @pos    -- regression for the Vercel private-Request-state production crash

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn<() => Promise<"authenticated">>(),
  delegate: vi.fn<
    (
      request: Request,
      dependencies?: unknown,
      options?: unknown,
    ) => Promise<Response>
  >(),
}));

vi.mock("../auth/server-auth-status.ts", () => ({
  getServerAuthenticationStatus: mocks.authenticate,
}));

vi.mock("../tools/seo-audit-handler.ts", () => ({
  handleSeoAuditRequest: mocks.delegate,
}));

const { handleAgentAuditRequest } = await import("./audit-handler.ts");

describe("default Agent audit request delegation", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset().mockResolvedValue("authenticated");
    mocks.delegate.mockReset().mockResolvedValue(
      Response.json(
        { error: { code: "scan_failed" } },
        { status: 502 },
      ),
    );
  });

  it("passes a Next request through by identity and forces buffered JSON internally", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "acme.test" }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "seo");

    expect(response.status).toBe(502);
    expect(mocks.delegate).toHaveBeenCalledWith(incoming, undefined, {
      forceBufferedJson: true,
      input: {
        url: "acme.test",
        targetQueries: null,
        pageRole: null,
        market: null,
        language: null,
      },
    });
  });
});
