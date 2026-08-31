import { describe, expect, it, vi } from "vitest";
import { measureCitabilityRender, requestCitabilityRender } from "./citability-render.ts";

const input = { url: "https://citability.test/guide", rawHtml: "<body>raw text</body>", bodyComplete: true };
const now = () => new Date("2026-08-31T10:00:00.000Z");

describe("paired raw/render evidence", () => {
  it("measures the two captured bodies and derives the ratio rather than assuming parity", () => {
    const result = measureCitabilityRender(input, "<body>raw text and more text</body>", { now });
    expect(result.status).toBe("measured");
    expect(result.raw.textChars).toBe(7);
    expect(result.rendered?.textChars).toBe(18);
    expect(result.rawToRenderedRatio).toBe(7 / 18);
    expect(result.measuredAt).toBe(now().toISOString());
  });
  it("has zero ratio for a real empty shell, but null for an empty rendered denominator", () => {
    expect(measureCitabilityRender({ ...input, rawHtml: "<body></body>" }, "<body>hydrated</body>", { now }).rawToRenderedRatio).toBe(0);
    expect(measureCitabilityRender(input, "<body></body>", { now }).rawToRenderedRatio).toBeNull();
  });
  it("does not infer parity from truncated raw or rendered captures", () => {
    const result = measureCitabilityRender({ ...input, bodyComplete: false }, "<body>more</body>", { now });
    expect(result.status).toBe("partial");
    expect(result.rawToRenderedRatio).toBeNull();
    const large = measureCitabilityRender(input, `<body>${"x".repeat(100_001)}</body>`, { now });
    expect(large.status).toBe("partial");
    expect(large.rendered?.text.length).toBeLessThanOrEqual(100_000);
    expect(large.rawToRenderedRatio).toBeNull();
  });
});

describe("HTTP renderer adapter", () => {
  it("reports missing service as unavailable and does no network request", async () => {
    const fetcher = vi.fn();
    const result = await requestCitabilityRender(input, { env: {}, fetcher, now });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("not_configured");
    expect(result.rawToRenderedRatio).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts only measurement bound to the exact supplied raw document and URL", async () => {
    const captured = measureCitabilityRender(input, "<body>raw text and more text</body>", { now });
    const fetcher = vi.fn(async () => Response.json(captured));
    const env = { CITABILITY_RENDERER_URL: "https://renderer.gengrowth.test/render", CITABILITY_RENDERER_TOKEN: "test-only-service-token" };
    const result = await requestCitabilityRender(input, { env, fetcher, now });
    expect(result).toEqual(captured);
    const wrong = await requestCitabilityRender(input, { env, fetcher: async () => Response.json({ ...captured, finalUrl: "https://other.test/" }), now });
    expect(wrong.status).toBe("unavailable");
    expect(wrong.reason).toBe("invalid_response");
  });
  it("rejects forged ratios and does not follow service redirects with credentials", async () => {
    const env = { CITABILITY_RENDERER_URL: "https://renderer.gengrowth.test/render", CITABILITY_RENDERER_TOKEN: "test-only-service-token" };
    const captured = measureCitabilityRender(input, "<body>more text</body>", { now });
    const fetcher = vi.fn(async (_url, options) => {
      expect(options.redirect).toBe("error");
      return Response.json({ ...captured, rawToRenderedRatio: 99 });
    });
    expect((await requestCitabilityRender(input, { env, fetcher, now })).reason).toBe("invalid_response");
  });
});
