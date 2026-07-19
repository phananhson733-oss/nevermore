import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultCrawlFetcher } from "./engine.ts";
import type { CrawlFetcher } from "./types.ts";

const transportState = vi.hoisted(() => ({
  calls: [] as Array<{ input: unknown; init: unknown }>,
}));

vi.mock("undici", () => ({
  Agent: class FakeAgent {},
  fetch: vi.fn(async (input: unknown, init: unknown) => {
    transportState.calls.push({ input, init });
    return new Response("ok", { status: 200 });
  }),
}));

type PinnedFetcher = (
  url: string,
  init: {
    readonly signal: AbortSignal;
    readonly pinnedIp: string;
    readonly dispatcher: object;
  },
) => Promise<Response>;

describe("createDefaultCrawlFetcher", () => {
  beforeEach(() => {
    transportState.calls.length = 0;
  });

  it("keeps the hostname URL for Host/certificate identity and uses the pinned dispatcher", async () => {
    const dispatcher = { kind: "guard-pinned" };
    const controller = new AbortController();
    const fetcher = createDefaultCrawlFetcher("SignalFrameBot/test");

    const response = await (fetcher.fetch as PinnedFetcher)(
      "https://secure.example/private/path",
      {
        signal: controller.signal,
        pinnedIp: "93.184.216.34",
        dispatcher,
      },
    );

    expect(response.status).toBe(200);
    expect(transportState.calls).toHaveLength(1);
    const call = transportState.calls[0];
    expect(new URL(String(call?.input)).hostname).toBe("secure.example");
    expect(call?.input).not.toContain("93.184.216.34");
    expect(call?.init).toMatchObject({
      redirect: "manual",
      signal: controller.signal,
      dispatcher,
      headers: { "user-agent": "SignalFrameBot/test" },
    });
  });

  it("fails closed when called without a guard-pinned dispatcher", async () => {
    const fetcher: CrawlFetcher = createDefaultCrawlFetcher("SignalFrameBot/test");

    await expect(
      fetcher.fetch("https://secure.example/", {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("guard-pinned dispatcher");
    expect(transportState.calls).toHaveLength(0);
  });
});
