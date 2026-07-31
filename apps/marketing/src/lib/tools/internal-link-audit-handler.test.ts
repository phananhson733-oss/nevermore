import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InternalLinkAuditPayload,
  InternalLinkAuditRaw,
  InternalLinkAuditScanErrorCode,
} from "@sf/public-tools";
import { InternalLinkAuditScanError } from "@sf/public-tools";
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
  run: { tool: "internal_link_audit", schemaVersion: "internal_link_audit.v1", mode: "public_preview", scope: "bounded_same_origin_static_html_crawl", persistence: "none", completedAt: "2026-07-30T09:00:00.000Z" },
  result: { availability: "partial", pagesCrawled: 25 },
} as unknown as InternalLinkAuditPayload;

function dependencies(overrides: Partial<InternalLinkAuditHandlerDependencies> = {}): InternalLinkAuditHandlerDependencies {
  return {
    normalizeUrl: () => ({ ok: true, url: "https://acme.com/" }),
    scan: vi.fn(async () => raw),
    buildPayload: vi.fn(() => payload),
    extractClientIp: () => "203.0.113.9",
    ...overrides,
  };
}

beforeEach(() => resetPublicToolSlots());

describe("handleInternalLinkAuditRequest", () => {
  it("returns a real partial report as a successful non-cacheable response", async () => {
    const deps = dependencies();
    const response = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: payload });
    expect(deps.scan).toHaveBeenCalledWith("https://acme.com/");
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

    let resolveScan: ((value: InternalLinkAuditRaw) => void) | undefined;
    const scan = vi.fn(() => new Promise<InternalLinkAuditRaw>((resolve) => { resolveScan = resolve; }));
    const deps = dependencies({ scan });
    const first = handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = await handleInternalLinkAuditRequest(request({ url: "acme.com" }), deps);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: { code: "scan_in_progress" } });
    resolveScan?.(raw);
    await first;
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
