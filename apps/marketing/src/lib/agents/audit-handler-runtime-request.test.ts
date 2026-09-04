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

const { handleAgentAuditRequest, ON_PAGE_CHECK_DEPENDENCIES } = await import(
  "./audit-handler.ts"
);

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
        tier: "key-pages",
        extraKeyPages: [],
      },
    });
  });

  it("normalizes one manual page set before delegating the Agent request", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.test/main",
          extraKeyPages: [
            "https://acme.test/zeta#fragment",
            "acme.test/alpha",
            "https://ACME.test/zeta",
            "https://acme.test/main",
          ],
        }),
      },
    );

    await handleAgentAuditRequest(incoming, "seo");

    expect(mocks.delegate).toHaveBeenCalledWith(incoming, undefined, {
      forceBufferedJson: true,
      input: expect.objectContaining({
        extraKeyPages: [
          "https://acme.test/alpha",
          "https://acme.test/zeta",
        ],
      }),
    });
  });

  it("rejects a cross-origin manual page before delegation", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.test/",
          extraKeyPages: ["https://other.test/page"],
        }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "seo");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(mocks.delegate).not.toHaveBeenCalled();
  });

  it("leaves an invalid main URL to the existing generic invalid-url path", async () => {
    mocks.delegate.mockResolvedValueOnce(
      Response.json({ error: { code: "invalid_url" } }, { status: 400 }),
    );
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "not a url",
          extraKeyPages: ["https://acme.test/page"],
        }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "seo");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_url" },
    });
    expect(mocks.delegate).toHaveBeenCalledOnce();
  });

  it("preserves an explicit full-site tier for the Agent delegate", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "acme.test", tier: "full-site" }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "seo");

    expect(response.status).toBe(502);
    expect(mocks.delegate).toHaveBeenCalledWith(incoming, undefined, {
      forceBufferedJson: true,
      input: expect.objectContaining({ tier: "full-site" }),
    });
  });

  it("forces Tech to full-site and drops manual pages from a forged request", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/tech/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.test/main",
          tier: "key-pages",
          extraKeyPages: ["https://acme.test/manual"],
        }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "tech");

    expect(response.status).toBe(502);
    expect(mocks.delegate).toHaveBeenCalledWith(incoming, undefined, {
      forceBufferedJson: true,
      input: expect.objectContaining({
        tier: "full-site",
        extraKeyPages: [],
      }),
    });
  });

  it.each(
    [
      [
        "Tech",
        "unsupported tier",
        "tech",
        "https://gengrowth.ai/api/agents/tech/audit",
        undefined,
        { tier: "sitewide" },
      ],
      [
        "Tech",
        "eleven manual pages",
        "tech",
        "https://gengrowth.ai/api/agents/tech/audit",
        undefined,
        {
          extraKeyPages: Array.from(
            { length: 11 },
            (_, index) => `https://acme.test/manual-${index}`,
          ),
        },
      ],
      [
        "Tech",
        "blank manual page",
        "tech",
        "https://gengrowth.ai/api/agents/tech/audit",
        undefined,
        { extraKeyPages: [""] },
      ],
      [
        "On-Page",
        "unsupported tier",
        "seo",
        "https://gengrowth.ai/api/tools/on-page-seo-check",
        ON_PAGE_CHECK_DEPENDENCIES,
        { tier: "sitewide" },
      ],
      [
        "On-Page",
        "eleven manual pages",
        "seo",
        "https://gengrowth.ai/api/tools/on-page-seo-check",
        ON_PAGE_CHECK_DEPENDENCIES,
        {
          extraKeyPages: Array.from(
            { length: 11 },
            (_, index) => `https://acme.test/manual-${index}`,
          ),
        },
      ],
      [
        "On-Page",
        "blank manual page",
        "seo",
        "https://gengrowth.ai/api/tools/on-page-seo-check",
        ON_PAGE_CHECK_DEPENDENCIES,
        { extraKeyPages: [""] },
      ],
    ] as const,
  )(
    "%s ignores the SEO-only %s control before shared parsing",
    async (_surface, _malformation, agent, url, dependencies, controls) => {
      const incoming = new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://acme.test/main", ...controls }),
      });

      const response = await handleAgentAuditRequest(
        incoming,
        agent,
        dependencies,
      );

      expect(response.status).toBe(502);
      expect(mocks.delegate).toHaveBeenCalledWith(
        incoming,
        undefined,
        expect.objectContaining({
          forceBufferedJson: true,
          input: expect.objectContaining({
            tier: "full-site",
            extraKeyPages: [],
          }),
        }),
      );
    },
  );

  it.each([
    [
      "Tech",
      "tech",
      "https://gengrowth.ai/api/agents/tech/audit",
      undefined,
    ],
    [
      "On-Page",
      "seo",
      "https://gengrowth.ai/api/tools/on-page-seo-check",
      ON_PAGE_CHECK_DEPENDENCIES,
    ],
  ] as const)(
    "%s still rejects an unrelated unknown field",
    async (_surface, agent, url, dependencies) => {
      const incoming = new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.test/main",
          tier: "sitewide",
          foo: true,
        }),
      });

      const response = await handleAgentAuditRequest(
        incoming,
        agent,
        dependencies,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request" },
      });
      expect(mocks.delegate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "Tech",
      "tech",
      "https://gengrowth.ai/api/agents/tech/audit",
      undefined,
    ],
    [
      "On-Page",
      "seo",
      "https://gengrowth.ai/api/tools/on-page-seo-check",
      ON_PAGE_CHECK_DEPENDENCIES,
    ],
  ] as const)(
    "%s applies the body limit before ignoring SEO-only controls",
    async (_surface, agent, url, dependencies) => {
      const incoming = new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.test/main",
          tier: "x".repeat(40_000),
        }),
      });

      const response = await handleAgentAuditRequest(
        incoming,
        agent,
        dependencies,
      );

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        error: { code: "payload_too_large" },
      });
      expect(mocks.delegate).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid tier before the crawl delegate", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/agents/seo/audit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "acme.test", tier: "sitewide" }),
      },
    );

    const response = await handleAgentAuditRequest(incoming, "seo");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(mocks.delegate).not.toHaveBeenCalled();
  });

  it("forces the On-Page Checker to full-site with no manual pages", async () => {
    const incoming = new NextRequest(
      "https://gengrowth.ai/api/tools/on-page-seo-check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "acme.test",
          tier: "key-pages",
          extraKeyPages: ["https://acme.test/manual"],
        }),
      },
    );

    const response = await handleAgentAuditRequest(
      incoming,
      "seo",
      ON_PAGE_CHECK_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(mocks.delegate).toHaveBeenCalledWith(incoming, undefined, {
      forceBufferedJson: true,
      input: expect.objectContaining({
        tier: "full-site",
        extraKeyPages: [],
      }),
      requireSameEntrySubject: true,
    });
  });
});
