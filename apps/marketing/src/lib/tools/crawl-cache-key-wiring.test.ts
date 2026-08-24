import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  internalPayload: { tool: "internal-link-fixture" },
  seoPayload: { tool: "seo-fixture" },
  openCrawlGate: vi.fn(async () => ({
    ok: true as const,
    kind: "crawl" as const,
    release: vi.fn(),
  })),
  writeCrawlCache: vi.fn(async () => undefined),
  scanInternalLinkAuditSite: vi.fn(async () => ({ stopReason: null })),
  scanSeoAuditSite: vi.fn(async () => ({ stopReason: null })),
}));

vi.mock("@sf/public-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/public-tools")>();
  return {
    ...actual,
    scanInternalLinkAuditSite: mocks.scanInternalLinkAuditSite,
    buildInternalLinkAuditPayload: () => mocks.internalPayload,
    scanSeoAuditSite: mocks.scanSeoAuditSite,
    buildSeoAuditPayload: () => mocks.seoPayload,
  };
});

vi.mock("./crawl-gate.ts", () => ({
  DEFAULT_CRAWL_GATE_DEPENDENCIES: {},
  openCrawlGate: mocks.openCrawlGate,
}));

vi.mock("./crawl-cache.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crawl-cache.ts")>();
  return { ...actual, writeCrawlCache: mocks.writeCrawlCache };
});

import { handleInternalLinkAuditRequest } from "./internal-link-audit-handler.ts";
import { handleSeoAuditRequest } from "./seo-audit-handler.ts";

function request(path: string): Request {
  return new Request(`https://gengrowth.ai${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify({ url: "WWW.AcMe.com" }),
  });
}

beforeEach(() => {
  mocks.openCrawlGate.mockClear();
  mocks.writeCrawlCache.mockClear();
  mocks.scanInternalLinkAuditSite.mockClear();
  mocks.scanSeoAuditSite.mockClear();
});

describe("default public crawl cache wiring", () => {
  it("writes an Internal Link Audit result under the exact target host", async () => {
    const response = await handleInternalLinkAuditRequest(
      request("/api/tools/internal-link-audit"),
    );

    expect(response.status).toBe(200);
    expect(mocks.writeCrawlCache).toHaveBeenCalledWith(
      "internal_link_audit.v3",
      "www.acme.com",
      mocks.internalPayload,
    );
  });

  it("writes an SEO Audit result under the exact target host", async () => {
    const response = await handleSeoAuditRequest(request("/api/tools/seo-audit"));

    expect(response.status).toBe(200);
    expect(mocks.writeCrawlCache).toHaveBeenCalledWith(
      "seo_audit",
      "www.acme.com",
      mocks.seoPayload,
    );
  });
});
