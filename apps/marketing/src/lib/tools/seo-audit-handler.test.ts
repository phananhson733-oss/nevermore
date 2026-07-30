import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SeoAuditPayload,
  SeoAuditProbe,
  SeoAuditScanErrorCode,
} from "@sf/public-tools";
import { SeoAuditScanError } from "@sf/public-tools";
import {
  handleSeoAuditRequest,
  type SeoAuditHandlerDependencies,
} from "./seo-audit-handler.ts";
import { resetPublicToolSlots } from "./public-tool-request.ts";

function request(body: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/tools/seo-audit", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

const probe = {
  requestedUrl: "https://acme.com/",
  scannedAt: "2026-07-30T09:00:00.000Z",
} as SeoAuditProbe;

const payload = {
  run: {
    tool: "seo_audit",
    schemaVersion: "1.1.0",
    mode: "public_preview",
    scope: "single_raw_page_and_standard_support_files",
    persistence: "none",
    completedAt: "2026-07-30T09:00:00.000Z",
  },
  result: { score: 88 },
} as unknown as SeoAuditPayload;

function dependencies(
  overrides: Partial<SeoAuditHandlerDependencies> = {},
): SeoAuditHandlerDependencies {
  return {
    normalizeUrl: () => ({ ok: true, url: "https://acme.com/" }),
    scan: vi.fn(async () => probe),
    buildPayload: vi.fn(() => payload),
    rateLimit: () => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }),
    extractClientIp: () => "203.0.113.9",
    ...overrides,
  };
}

beforeEach(() => {
  resetPublicToolSlots();
});

describe("handleSeoAuditRequest", () => {
  it("returns the shared success envelope without caching", async () => {
    const deps = dependencies();
    const response = await handleSeoAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("4");
    await expect(response.json()).resolves.toEqual({ data: payload });
    expect(deps.scan).toHaveBeenCalledWith("https://acme.com/");
  });

  it("rejects an oversized request before validation, rate limit, or scan", async () => {
    const scan = vi.fn(async () => probe);
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ scan, rateLimit });
    const response = await handleSeoAuditRequest(
      request({ url: "x".repeat(5_000) }),
      deps,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields before rate limiting or scanning", async () => {
    const scan = vi.fn(async () => probe);
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ scan, rateLimit });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.com", persist: true }),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("applies the IP rate gate before any network scan", async () => {
    const scan = vi.fn(async () => probe);
    const deps = dependencies({
      scan,
      rateLimit: () => ({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 42_000,
        retryAfterSeconds: 42,
      }),
    });
    const response = await handleSeoAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(scan).not.toHaveBeenCalled();
  });

  it("allows only one in-flight scan per IP", async () => {
    let resolveScan: ((value: SeoAuditProbe) => void) | undefined;
    const scan = vi.fn(
      () =>
        new Promise<SeoAuditProbe>((resolve) => {
          resolveScan = resolve;
        }),
    );
    const deps = dependencies({ scan });

    const first = handleSeoAuditRequest(request({ url: "acme.com" }), deps);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = await handleSeoAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });

    resolveScan?.(probe);
    await first;
  });

  it.each([
    ["timeout", 504, "scan_timeout"],
    ["blocked", 400, "invalid_url"],
    ["scan_failed", 502, "scan_failed"],
  ] as const)(
    "maps %s to HTTP %s without returning raw transport details",
    async (
      sourceCode: SeoAuditScanErrorCode,
      expectedStatus: number,
      expectedCode: string,
    ) => {
      const deps = dependencies({
        scan: async () => {
          throw new SeoAuditScanError(sourceCode);
        },
      });

      const response = await handleSeoAuditRequest(
        request({ url: "acme.com" }),
        deps,
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: { code: expectedCode },
      });
    },
  );
});
