import { describe, expect, it } from "vitest";
import { privateGeoEditorJson } from "./kb-editor-response.ts";

describe("bounded complete editor JSON streaming", () => {
  it("round-trips a greater-than-4.5MB response in bounded UTF-8 chunks without changing content", async () => {
    const body = { data: { declared: "A".repeat(65_519) + "😀中文".repeat(500_000), unknown: null, roles: [] } };
    const response = privateGeoEditorJson(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.has("content-length")).toBe(false);
    const reader = response.body!.getReader(), chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      expect(part.value.byteLength).toBeLessThanOrEqual(65_536);
      chunks.push(part.value);
    }
    const received = Buffer.concat(chunks);
    expect(received.byteLength).toBeGreaterThan(4_718_592);
    expect(chunks.length).toBeGreaterThan(1);
    expect(JSON.parse(received.toString("utf8"))).toEqual(body);
  });
  it("remains ordinary JSON to standard browser readers", async () => {
    expect(await privateGeoEditorJson({ data: { candidate: null, state: "unavailable" } }).json()).toEqual({ data: { candidate: null, state: "unavailable" } });
  });
  it("rejects unbounded or non-JSON output before returning any successful body", async () => {
    const large = privateGeoEditorJson({ text: "x".repeat(8_400_001) });
    expect(large.status).toBe(503);
    expect(await large.json()).toEqual({ error: { code: "response_too_large" } });
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(privateGeoEditorJson(circular).status).toBe(503);
  });
});
