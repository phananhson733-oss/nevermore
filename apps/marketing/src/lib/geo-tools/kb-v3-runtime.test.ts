import { describe, expect, it, vi } from "vitest";

import type { GeoKnowledgeResourceResult } from "./kb-knowledge-evidence.ts";
import { createGeoKbV3Runtime } from "./kb-v3-runtime.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const HTML = `<html><head><meta property="og:site_name" content="Astro"></head><body></body></html>`;

describe("createGeoKbV3Runtime competitors", () => {
  /**
   * The lookup reads through a reader built for the owner that asked, so the
   * admission it opens is charged to that owner's hourly allowance -- the same
   * key the run's collect step uses -- and never to a shared one.
   */
  it("builds the gated reader per owner and reads the rival's homepage through it", async () => {
    const read = vi.fn(async (): Promise<GeoKnowledgeResourceResult> => ({
      kind: "ok", url: "https://astro.example/", body: HTML, contentType: "text/html", observedAt: "2026-09-11T07:00:00.000Z",
    }));
    const createCompetitorReader = vi.fn(() => read);
    const writeCache = vi.fn(async () => undefined);
    const runtime = createGeoKbV3Runtime({
      createCompetitorReader,
      competitorIdentityCache: { readCache: async () => null, writeCache },
    });
    const identity = await runtime.competitors.identify({ userId: USER_ID, domain: "astro.example" });
    expect(createCompetitorReader).toHaveBeenCalledWith(USER_ID);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ url: "https://astro.example/", expected: "html" }));
    expect(identity).toMatchObject({ status: "available", brandName: "Astro", method: "og_site_name" });
    expect(writeCache).toHaveBeenCalledWith(expect.objectContaining({ domain: "astro.example", brandName: "Astro" }));
  });

  it("answers from the shared cache without building a reader", async () => {
    const createCompetitorReader = vi.fn(() => async (): Promise<GeoKnowledgeResourceResult> => { throw new Error("must not read"); });
    const runtime = createGeoKbV3Runtime({
      createCompetitorReader,
      competitorIdentityCache: {
        readCache: async () => ({ domain: "astro.example", brandName: "Astro", aliases: [], observedAt: "2026-09-11T01:00:00.000Z" }),
        writeCache: async () => undefined,
      },
    });
    const identity = await runtime.competitors.identify({ userId: USER_ID, domain: "astro.example" });
    expect(identity).toMatchObject({ status: "available", cached: true });
    expect(createCompetitorReader).not.toHaveBeenCalled();
  });

  it("gives the competitor route the shared owner-scoped halves and its own quota bucket", async () => {
    const quota = vi.fn(async () => ({ kind: "allowed" as const }));
    const runtime = createGeoKbV3Runtime({ quota: quota as never });
    await expect(runtime.competitors.consumeQuota!(USER_ID, "kb")).resolves.toBe("allowed");
    expect(quota.mock.calls.map((call) => (call as unknown[])[0])).toEqual([`geo-kb-v3:competitors:owner:${USER_ID}`, "geo-kb-v3:competitors:kb:kb"]);
    expect(runtime.competitors.generationRunning).toBe(runtime.review.generationRunning);
    expect(runtime.competitors.saveDraft).toBe(runtime.review.saveDraft);
  });
});
