import { describe, expect, it } from "vitest";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  resetPublicToolSlots,
} from "./public-tool-request.ts";

describe("readPublicToolJson", () => {
  it("accepts a bounded JSON request", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/example", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ url: "https://acme.com" }),
    });

    await expect(readPublicToolJson(request, 4_096)).resolves.toEqual({
      ok: true,
      value: { url: "https://acme.com" },
    });
  });

  it("rejects a non-JSON content type before reading the body", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/example", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });

    await expect(readPublicToolJson(request, 4_096)).resolves.toEqual({
      ok: false,
      code: "unsupported_media_type",
    });
  });

  it("stream-limits a request even when Content-Length is absent", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(5_000) }),
    });
    request.headers.delete("content-length");

    await expect(readPublicToolJson(request, 512)).resolves.toEqual({
      ok: false,
      code: "payload_too_large",
    });
  });
});

describe("acquirePublicToolSlot", () => {
  it("allows only one in-flight run per key and releases idempotently", () => {
    resetPublicToolSlots();
    const first = acquirePublicToolSlot("seo-audit:203.0.113.1");
    const blocked = acquirePublicToolSlot("seo-audit:203.0.113.1");

    expect(first.acquired).toBe(true);
    expect(blocked).toEqual({ acquired: false });
    if (!first.acquired) throw new Error("fixture expected a slot");
    first.release();
    first.release();

    const next = acquirePublicToolSlot("seo-audit:203.0.113.1");
    expect(next.acquired).toBe(true);
    if (next.acquired) next.release();
  });
});
