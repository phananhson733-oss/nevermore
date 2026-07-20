import { describe, expect, it, vi } from "vitest";
import { createSiteOriginProbe } from "./site-origin-probe.ts";

describe("createSiteOriginProbe", () => {
  it("uses one pinned, redirect-free, bounded-byte HTTPS request", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response("reachable", { status: 403 }),
    );
    const probe = createSiteOriginProbe({ fetch: fetch as never });

    await expect(
      probe({
        origin: "https://example.com",
        pinnedIp: "93.184.216.34",
      }),
    ).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: expect.objectContaining({ Range: "bytes=0-0" }),
      dispatcher: expect.any(Object),
    });
  });

  it("fails closed on timeout and never reflects the transport error", async () => {
    const fetch = vi.fn(
      async (_url: string, init: RequestInit): Promise<Response> =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("customer-secret transport failure"));
          });
        }),
    );
    const probe = createSiteOriginProbe({
      fetch: fetch as never,
      timeoutMs: 5,
    });

    await expect(
      probe({
        origin: "https://example.com",
        pinnedIp: "93.184.216.34",
      }),
    ).resolves.toBe(false);
  });

  it("rejects non-HTTPS/non-origin inputs before any network call", async () => {
    const fetch = vi.fn();
    const probe = createSiteOriginProbe({ fetch: fetch as never });

    await expect(
      probe({ origin: "http://example.com", pinnedIp: "93.184.216.34" }),
    ).resolves.toBe(false);
    await expect(
      probe({
        origin: "https://example.com/path",
        pinnedIp: "93.184.216.34",
      }),
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
