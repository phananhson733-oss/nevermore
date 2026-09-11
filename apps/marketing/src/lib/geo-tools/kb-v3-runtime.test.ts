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
    expect(runtime.competitors.saveDraft).toBe(runtime.review.saveDraft);
  });

  /**
   * A generation is "running" for this route while a run is open, not only
   * while a model request is out: a run stopped between its paid step and its
   * assembly holds a record bound to the hash this route would move, and a
   * dispatched-only reading would let the gesture strand it.
   */
  describe("generationRunning", () => {
    const generationStore = (state: "dispatched" | "succeeded" | null) => ({
      readLatest: async () => ({ kind: "ok" as const, generation: state === null ? null : { state } }),
    });
    const readRun = (result: unknown) => vi.fn(async () => result);

    it("says yes while a run is open, even with no model request in flight", async () => {
      const runtime = createGeoKbV3Runtime({
        generationStore: generationStore("succeeded") as never,
        readRun: readRun({ kind: "found", run: { state: "running" }, operations: [] }) as never,
      });
      await expect(runtime.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe(true);
    });

    it("says yes while a model request is out, whatever the run ledger says", async () => {
      const runtime = createGeoKbV3Runtime({
        generationStore: generationStore("dispatched") as never,
        readRun: readRun({ kind: "none" }) as never,
      });
      await expect(runtime.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe(true);
    });

    it("says no once the run is complete and nothing is dispatched", async () => {
      const runtime = createGeoKbV3Runtime({
        generationStore: generationStore("succeeded") as never,
        readRun: readRun({ kind: "found", run: { state: "complete" }, operations: [] }) as never,
      });
      await expect(runtime.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe(false);
      const fresh = createGeoKbV3Runtime({ generationStore: generationStore(null) as never, readRun: readRun({ kind: "none" }) as never });
      await expect(fresh.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe(false);
    });

    it("cannot answer when the run ledger cannot, unless something is known to be dispatched", async () => {
      const down = createGeoKbV3Runtime({
        generationStore: generationStore("succeeded") as never,
        readRun: readRun({ kind: "unavailable" }) as never,
      });
      await expect(down.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe("unavailable");
      const thrown = createGeoKbV3Runtime({
        generationStore: generationStore(null) as never,
        readRun: vi.fn(async () => { throw new Error("down"); }) as never,
      });
      await expect(thrown.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe("unavailable");
      const dispatched = createGeoKbV3Runtime({
        generationStore: generationStore("dispatched") as never,
        readRun: readRun({ kind: "unavailable" }) as never,
      });
      await expect(dispatched.competitors.generationRunning!(USER_ID, "kb")).resolves.toBe(true);
    });

    it("leaves the review route's reading alone: a stopped run does not freeze a review", async () => {
      const runtime = createGeoKbV3Runtime({
        generationStore: generationStore("succeeded") as never,
        readRun: readRun({ kind: "found", run: { state: "running" }, operations: [] }) as never,
      });
      await expect(runtime.review.generationRunning!(USER_ID, "kb")).resolves.toBe(false);
    });
  });
});
