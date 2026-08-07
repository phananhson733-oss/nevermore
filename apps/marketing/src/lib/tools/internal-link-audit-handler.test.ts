import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InternalLinkAuditPayload,
  InternalLinkAuditRaw,
  InternalLinkAuditScanErrorCode,
} from "@sf/public-tools";
import { InternalLinkAuditScanError } from "@sf/public-tools";
import { resetRateLimitStore } from "../rate-limit.ts";
import {
  handleInternalLinkAuditRequest,
  type InternalLinkAuditHandlerDependencies,
} from "./internal-link-audit-handler.ts";
import {
  acquirePublicCrawlSlot,
  resetPublicToolSlots,
} from "./public-tool-request.ts";
import { openCrawlGate } from "./crawl-gate.ts";
import type { SharedQuotaDependencies } from "./shared-rate-limit.ts";

function quota(allowed: boolean): SharedQuotaDependencies {
  return {
    callQuota: async () => ({
      allowed,
      hits: allowed ? 1 : 99,
      reset_at: "2099-01-01T00:00:00.000Z",
    }),
  };
}

function gateWith(allowed: boolean) {
  return (clientIp: string, normalizedUrl: string) =>
    openCrawlGate(clientIp, normalizedUrl, {
      quota: quota(allowed),
      acquireSlot: acquirePublicCrawlSlot,
    });
}

function request(
  body: unknown,
  contentType = "application/json",
  init: { readonly signal?: AbortSignal } = {},
): Request {
  return new Request("https://gengrowth.ai/api/tools/internal-link-audit", {
    method: "POST",
    headers: { "content-type": contentType, "x-real-ip": "203.0.113.9" },
    body: JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

const raw = {
  availability: "partial",
  stopReason: "max_urls",
} as InternalLinkAuditRaw;
const payload = {
  run: {
    tool: "internal_link_audit",
    schemaVersion: "internal_link_audit.v3",
    mode: "public_preview",
    scope: "bounded_same_origin_static_html_crawl",
    persistence: "none",
    completedAt: "2026-07-30T09:00:00.000Z",
  },
  result: { availability: "partial", pagesCrawled: 25 },
} as unknown as InternalLinkAuditPayload;

function dependencies(
  overrides: Partial<InternalLinkAuditHandlerDependencies> = {},
): InternalLinkAuditHandlerDependencies {
  return {
    normalizeUrl: () => ({ ok: true, url: "https://acme.com/" }),
    scan: vi.fn(async () => raw),
    buildPayload: vi.fn(() => payload),
    openGate: gateWith(true),
    cachePayload: vi.fn(async () => {}),
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
    const deps = dependencies();
    const response = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: payload });
    expect(deps.scan).toHaveBeenCalledWith(
      "https://acme.com/",
      expect.any(AbortSignal),
    );
  });

  /**
   * The cache is shared across visitors and is served for an hour without
   * crawling anything, so a run that was cut off must never populate it: every
   * later reader would be handed a graph that silently under-reports the site,
   * and an under-reported graph invents orphans and unreachable pages.
   */
  it("does not cache a crawl that reported its own abort", async () => {
    const deps = dependencies({
      scan: async () =>
        ({
          ...raw,
          availability: "partial",
          stopReason: "aborted",
        }) as InternalLinkAuditRaw,
    });

    const response = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cachePayload).not.toHaveBeenCalled();
  });

  /**
   * The other half of the same question: the reader left, and the crawl
   * happened to return before the engine noticed. The abort state of this
   * request answers it without needing the crawl's own account.
   */
  /**
   * The engine holds the same signal this request does, so a crawl it
   * finished is a whole crawl even when the reader left before the report was
   * built. Only the engine's own stop reason can say a run was cut short.
   */
  it("caches a completed crawl whose reader had already gone", async () => {
    const client = new AbortController();
    const deps = dependencies({
      scan: async () => {
        client.abort();
        return raw;
      },
    });

    const response = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }, "application/json", {
        signal: client.signal,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cachePayload).toHaveBeenCalledTimes(1);
  });

  /**
   * The other direction, and it matters just as much: a completion gate that
   * quietly cached nothing would send every visitor's crawl to the target site
   * again. A budget stop is not truncation — the ceiling is fixed, the next
   * crawl reaches the same place, and the payload states it.
   */
  it("caches a crawl that stopped at one of its own ceilings", async () => {
    const deps = dependencies();

    const response = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cachePayload).toHaveBeenCalledWith(
      "https://acme.com/",
      payload,
    );
  });

  it("allows more than two sequential normal scans from one network identity", async () => {
    const deps = dependencies();

    const responses: Response[] = [];
    for (let index = 0; index < 3; index += 1) {
      responses.push(
        await handleInternalLinkAuditRequest(
          request({ url: "acme.com" }),
          deps,
        ),
      );
    }

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    for (const response of responses) {
      expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
    }
  });

  it("rejects oversized and unknown request bodies before crawling", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });
    const oversized = await handleInternalLinkAuditRequest(
      request({ url: "x".repeat(5_000) }),
      deps,
    );
    expect(oversized.status).toBe(413);
    expect(scan).not.toHaveBeenCalled();
    const unknown = await handleInternalLinkAuditRequest(
      request({ url: "acme.com", persist: true }),
      deps,
    );
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
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
    const blocked = dependencies({ openGate: gateWith(false) });
    const limited = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      blocked,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(blocked.scan).not.toHaveBeenCalled();
  });

  it("rejects a duplicate in-flight scan before touching the abuse counter", async () => {
    let resolveScan: ((value: InternalLinkAuditRaw) => void) | undefined;
    const scan = vi.fn(
      () =>
        new Promise<InternalLinkAuditRaw>((resolve) => {
          resolveScan = resolve;
        }),
    );
    const deps = dependencies({ scan });
    const first = handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });
    expect(second.headers.get("retry-after")).toBe("5");
    expect(second.headers.get("x-ratelimit-remaining")).toBeNull();
    resolveScan?.(raw);
    await first;
  });

  it("releases the in-flight slot when the abuse fuse rejects a request", async () => {
    let allow = false;
    const deps = dependencies({
      openGate: (clientIp, normalizedUrl) =>
        openCrawlGate(clientIp, normalizedUrl, {
          quota: quota(allow),
          acquireSlot: acquirePublicCrawlSlot,
        }),
    });

    const rejected = await handleInternalLinkAuditRequest(
      request({ url: "acme.com" }),
      deps,
    );
    allow = true;
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
  ] as const)(
    "maps %s without leaking transport detail",
    async (
      sourceCode: InternalLinkAuditScanErrorCode,
      status: number,
      code: string,
    ) => {
      const response = await handleInternalLinkAuditRequest(
        request({ url: "acme.com" }),
        dependencies({
          scan: async () => {
            throw new InternalLinkAuditScanError(sourceCode);
          },
        }),
      );
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: { code } });
    },
  );
});
