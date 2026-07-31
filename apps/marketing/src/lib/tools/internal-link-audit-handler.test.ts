import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InternalLinkAuditPayload,
  InternalLinkAuditRaw,
  InternalLinkAuditScanErrorCode,
} from "@sf/public-tools";
import { InternalLinkAuditScanError } from "@sf/public-tools";
import {
  checkRateLimit,
  resetRateLimitStore,
} from "../rate-limit.ts";
import {
  handleInternalLinkAuditRequest,
  type InternalLinkAuditHandlerDependencies,
} from "./internal-link-audit-handler.ts";
import { resetPublicToolSlots } from "./public-tool-request.ts";

function request(body: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/tools/internal-link-audit", {
    method: "POST",
    headers: { "content-type": contentType, "x-real-ip": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

const raw = { availability: "partial", stopReason: "max_urls" } as InternalLinkAuditRaw;
const payload = {
  run: { tool: "internal_link_audit", schemaVersion: "internal_link_audit.v2", mode: "public_preview", scope: "bounded_same_origin_static_html_crawl", persistence: "none", completedAt: "2026-07-30T09:00:00.000Z" },
  result: { availability: "partial", pagesCrawled: 25 },
} as unknown as InternalLinkAuditPayload;

function dependencies(overrides: Partial<InternalLinkAuditHandlerDependencies> = {}): InternalLinkAuditHandlerDependencies {
  return {
    normalizeUrl: () => ({ ok: true, url: "https://acme.com/" }),
    scan: vi.fn(async () => raw),
    buildPayload: vi.fn(() => payload),
    rateLimit: () => ({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000, retryAfterSeconds: 0 }),
    extractClientIp: () => "203.0.113.9",
    ...overrides,
  };
}

beforeEach(() => {
  resetPublicToolSlots();
  resetRateLimitStore();
});

describe("handleInternalLinkAuditRequest", () => {
  it("returns a real partial report as a successful non-cacheable response", async () => {
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ rateLimit });
    const response = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: payload });
    expect(deps.scan).toHaveBeenCalledWith("https://acme.com/");
    expect(rateLimit).toHaveBeenCalledWith(
      "tools:internal-link-audit:abuse:ip:203.0.113.9",
      30,
      10 * 60 * 1_000,
    );
  });

  it("allows more than two sequential normal scans from one network identity", async () => {
    const deps = dependencies({ rateLimit: checkRateLimit });

    const responses: Response[] = [];
    for (let index = 0; index < 3; index += 1) {
      responses.push(
        await handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps),
      );
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    for (const response of responses) {
      expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
    }
  });

  it("rejects oversized and unknown request bodies before crawling", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });
    const oversized = await handleInternalLinkAuditRequest(request({ url: "x".repeat(5_000) }), deps);
    expect(oversized.status).toBe(413);
    expect(scan).not.toHaveBeenCalled();
    const unknown = await handleInternalLinkAuditRequest(request({ url: "acme.com", persist: true }), deps);
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: { code: "invalid_request" } });
  });

  it("allows sequential scans but keeps the one-in-flight gate", async () => {
    const sequentialScan = vi.fn(async () => raw);
    const sequential = dependencies({ scan: sequentialScan });
    for (let run = 0; run < 4; run += 1) {
      const response = await handleInternalLinkAuditRequest(
        request({ url: "acme.com" }),
        sequential,
      );
      expect(response.status).toBe(200);
    }
    expect(sequentialScan).toHaveBeenCalledTimes(4);
  });

  it("keeps an exceptional abuse fuse before any network scan", async () => {
    const blocked = dependencies({ rateLimit: () => ({ allowed: false, remaining: 0, resetAt: Date.now(), retryAfterSeconds: 42 }) });
    const limited = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), blocked);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("42");
    expect(blocked.scan).not.toHaveBeenCalled();
  });

  it("rejects a duplicate in-flight scan before touching the abuse counter", async () => {
    let resolveScan: ((value: InternalLinkAuditRaw) => void) | undefined;
    const scan = vi.fn(() => new Promise<InternalLinkAuditRaw>((resolve) => { resolveScan = resolve; }));
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ scan, rateLimit });
    const first = handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: { code: "scan_in_progress" } });
    expect(second.headers.get("retry-after")).toBe("5");
    expect(second.headers.get("x-ratelimit-remaining")).toBeNull();
    expect(rateLimit).toHaveBeenCalledOnce();
    resolveScan?.(raw);
    await first;
  });

  it("releases the in-flight slot when the abuse fuse rejects a request", async () => {
    const rateLimit = vi
      .fn()
      .mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 42_000,
        retryAfterSeconds: 42,
      })
      .mockReturnValue({
        allowed: true,
        remaining: 29,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 0,
      });
    const deps = dependencies({ rateLimit });

    const rejected = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    const accepted = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );

    expect(rejected.status).toBe(429);
    expect(accepted.status).toBe(200);
    expect(deps.scan).toHaveBeenCalledOnce();
  });

  it.each([
    ["timeout", 504, "scan_timeout"],
    ["blocked", 400, "invalid_url"],
    ["scan_failed", 502, "scan_failed"],
  ] as const)("maps %s without leaking transport detail", async (sourceCode: InternalLinkAuditScanErrorCode, status: number, code: string) => {
    const response = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), dependencies({ scan: async () => { throw new InternalLinkAuditScanError(sourceCode); } }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });
});
