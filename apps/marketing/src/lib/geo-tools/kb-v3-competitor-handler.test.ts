import { describe, expect, it, vi } from "vitest";

import { handleGeoKbV3Competitors, type GeoKbV3CompetitorDependencies } from "./kb-v3-competitor-handler.ts";
import type { GeoKbV3CompetitorIdentity } from "./kb-v3-competitor-identity.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";
import { completePayloadV3, V3_KB_ID } from "./kb-v3.test-fixtures.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const KNOWLEDGE_GENERATION_ID = "11111111-1111-8111-8111-111111111120";
const NOW = new Date("2026-09-11T08:00:00.000Z");
const ENDPOINT = "https://gengrowth.ai/api/tools/geo-knowledge-base/v3/competitors";

/** A draft as the product stores it: unnamed, unconfirmed rivals and a paid knowledge body. */
function storedPayload(): GeoKbPayloadV3 {
  const base = completePayloadV3();
  const generationInput = {
    ...base.generationInput,
    competitors: [
      { domain: "astro.example", brandName: "", confirmed: false },
      { domain: "rival.example", brandName: "Rival", confirmed: true },
      { domain: "", brandName: "Named Only", confirmed: false },
    ],
  };
  return parseGeoKbPayloadV3({
    ...base,
    generationInput,
    runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput), knowledgeGenerationId: KNOWLEDGE_GENERATION_ID },
  });
}

const IDENTITY: GeoKbV3CompetitorIdentity = {
  status: "available", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  method: "json_ld", sourceUrl: "https://astro.example/", observedAt: "2026-09-11T07:00:00.000Z", cached: false,
};

function request(body: unknown): Request {
  return new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function harness(overrides: Partial<GeoKbV3CompetitorDependencies> = {}, payload: GeoKbPayloadV3 = storedPayload()) {
  const saved: { current: GeoKbPayloadV3 | null } = { current: null };
  const saveDraft = vi.fn(async (input: { readonly payload: GeoKbPayloadV3; readonly baseVersion: number }): Promise<GeoKbV3SaveOutcome> => {
    saved.current = input.payload;
    return { kind: "ok", value: { draftVersion: input.baseVersion + 1, contentHash: geoV2Digest(input.payload), updatedAt: NOW.toISOString() } };
  });
  const identify = vi.fn(async () => IDENTITY);
  const dependencies: GeoKbV3CompetitorDependencies = {
    authenticate: async () => ({ status: "authenticated", userId: USER_ID }) as never,
    readDetails: async () => ({ kind: "ok", value: {
      kbId: V3_KB_ID,
      draft: { draftVersion: 4, contentHash: geoV2Digest(payload), updatedAt: NOW.toISOString(), payload },
    } }) as never,
    saveDraft: saveDraft as never,
    identify: identify as never,
    now: () => NOW,
    ...overrides,
  };
  return { dependencies, saved, saveDraft, identify };
}

const locked = () => storedPayload().runRef.generationInputHash;
const confirm = (extra: Record<string, unknown> = {}) => ({
  kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: locked(),
  domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"], ...extra,
});

describe("handleGeoKbV3Competitors", () => {
  it("refuses an unauthenticated caller before reading anything", async () => {
    const { dependencies, identify } = harness({ authenticate: async () => ({ status: "unauthenticated" }) as never });
    const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
    expect(response.status).toBe(401);
    expect(identify).not.toHaveBeenCalled();
  });

  it("refuses a body that names no intent this route has", async () => {
    const { dependencies } = harness();
    const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "rename", domain: "astro.example" }), dependencies);
    expect(response.status).toBe(400);
  });

  describe("identify", () => {
    it("looks a rival up for the owner that asked and writes nothing", async () => {
      const { dependencies, identify, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: { kbId: V3_KB_ID, identity: IDENTITY } });
      expect(identify).toHaveBeenCalledWith({ userId: USER_ID, domain: "astro.example" });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    /**
     * The domain is the one thing a caller supplies, and it is checked against
     * the owner's own draft: this route must not be a way to spend the crawl
     * allowance on a host of the caller's choosing.
     */
    it("reads only a domain the locked input names", async () => {
      const { dependencies, identify } = harness();
      for (const domain of ["nobody.example", "Astro.example", "www.astro.example"]) {
        const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain }), dependencies);
        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({ error: { code: "unknown_competitor" } });
      }
      expect(identify).not.toHaveBeenCalled();
    });

    it("carries the lookup's own unavailability through as an answer, not a failure", async () => {
      const unavailable: GeoKbV3CompetitorIdentity = { status: "unavailable", domain: "astro.example", reason: "blocked" };
      const { dependencies } = harness({ identify: async () => unavailable });
      const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: { kbId: V3_KB_ID, identity: unavailable } });
    });

    it("reports a lookup that throws as an outage", async () => {
      const { dependencies } = harness({ identify: async () => { throw new Error("reader down"); } });
      const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
      expect(response.status).toBe(503);
    });
  });

  describe("confirm", () => {
    it("writes the confirmation into the locked input and answers with the re-locked draft", async () => {
      const { dependencies, saved } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm()), dependencies);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(saved.current?.generationInput.competitors[0]).toEqual({ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] });
      expect(saved.current?.runRef.knowledgeGenerationId).toBeNull();
      expect(body.data).toEqual({
        kbId: V3_KB_ID,
        draftVersion: 5,
        contentHash: geoV2Digest(saved.current!),
        updatedAt: NOW.toISOString(),
        generationInputHash: saved.current!.runRef.generationInputHash,
        competitors: saved.current!.generationInput.competitors,
        released: ["knowledgeGenerationId"],
        changed: true,
      });
      expect(body.data.generationInputHash).not.toBe(locked());
    });

    it("withdraws a confirmation", async () => {
      const { dependencies, saved } = harness();
      const response = await handleGeoKbV3Competitors(request({
        kbId: V3_KB_ID, intent: "unconfirm", baseVersion: 4, expectedGenerationInputHash: locked(), domain: "rival.example",
      }), dependencies);
      expect(response.status).toBe(200);
      expect(saved.current?.generationInput.competitors[1]).toEqual({ domain: "rival.example", brandName: "Rival", confirmed: false });
    });

    it("writes nothing when the rival already holds that state, and says so", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request({
        kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: locked(), domain: "rival.example", brandName: "Rival",
      }), dependencies);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(saveDraft).not.toHaveBeenCalled();
      expect(body.data).toMatchObject({ draftVersion: 4, contentHash: geoV2Digest(storedPayload()), generationInputHash: locked(), released: [], changed: false });
    });

    it("refuses a stale draft version without writing", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm({ baseVersion: 3 })), dependencies);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "conflict" }, draftVersion: 4 });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    /** The row on screen was drawn under one locked input; a gesture about it must name that input. */
    it("refuses a gesture made against a different locked input", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm({ expectedGenerationInputHash: "f".repeat(64) })), dependencies);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "input_changed" } });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("refuses a domain the locked input does not name", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm({ domain: "nobody.example" })), dependencies);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: { code: "unknown_competitor" } });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("refuses a confirmation with no name", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm({ brandName: "   " })), dependencies);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: { code: "invalid_competitor" } });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    /** A dispatched generation is bound to the hash this write would move. */
    it("refuses while a paid generation is in flight", async () => {
      const { dependencies, saveDraft } = harness({ generationRunning: async () => true });
      const response = await handleGeoKbV3Competitors(request(confirm()), dependencies);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "generation_running" } });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    /**
     * Unlike a review write, this one moves the hash a dispatched generation is
     * bound to, so "cannot tell" is not good enough to write on: a request paid
     * for under the old hash would be left with no draft that can admit it.
     */
    it("refuses to move the hash when the generation read cannot answer", async () => {
      for (const generationRunning of [async () => "unavailable" as const, async () => { throw new Error("down"); }]) {
        const { dependencies, saveDraft } = harness({ generationRunning });
        const response = await handleGeoKbV3Competitors(request(confirm()), dependencies);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: { code: "store_unavailable" } });
        expect(saveDraft).not.toHaveBeenCalled();
      }
    });

    it("still answers a repeated gesture while that read is down, because it writes nothing", async () => {
      const { dependencies, saveDraft } = harness({ generationRunning: async () => "unavailable" });
      const response = await handleGeoKbV3Competitors(request({
        kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: locked(), domain: "rival.example", brandName: "Rival",
      }), dependencies);
      expect(response.status).toBe(200);
      expect((await response.json()).data.changed).toBe(false);
      expect(saveDraft).not.toHaveBeenCalled();
    });

    /**
     * The longest legal body, in its longest serialization: a name and
     * thirty-two aliases, each two hundred code units, every code unit written
     * as a six-byte JSON escape rather than as UTF-8. Two serializations of one
     * object must both be admitted; the byte limit is about transport, not
     * about which escaping a client chose.
     */
    it("admits the largest body the wire allows, however it is escaped", async () => {
      const wide = "\u4e00".repeat(200);
      const { dependencies, saved } = harness();
      const body = confirm({ brandName: wide, aliases: Array.from({ length: 32 }, (_, index) => `${wide.slice(0, 198)}${index.toString().padStart(2, "0")}`) });
      const escaped = JSON.stringify(body).replace(/[^\x20-\x7e]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
      expect(escaped.length).toBeGreaterThan(32_768);
      const response = await handleGeoKbV3Competitors(new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: escaped }), dependencies);
      expect(response.status).toBe(200);
      expect(saved.current?.generationInput.competitors[0]?.aliases).toHaveLength(12);
    });

    /** NFC can lengthen a string past the stored bound; that is a refusal, not an outage. */
    it("answers invalid_competitor, not an outage, for a name the contract cannot hold once normalized", async () => {
      const { dependencies, saveDraft } = harness();
      const response = await handleGeoKbV3Competitors(request(confirm({ brandName: "\u0344".repeat(101) })), dependencies);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: { code: "invalid_competitor" } });
      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("passes the store's own refusals through by their status", async () => {
      const cases: readonly [GeoKbV3SaveOutcome, number, string][] = [
        [{ kind: "conflict", currentDraftVersion: 6 }, 409, "conflict"],
        [{ kind: "input_locked" }, 409, "input_changed"],
        [{ kind: "missing" }, 404, "not_found"],
        [{ kind: "unavailable", reason: "store_unavailable" }, 503, "store_unavailable"],
      ];
      for (const [outcome, status, code] of cases) {
        const { dependencies } = harness({ saveDraft: async () => outcome });
        const response = await handleGeoKbV3Competitors(request(confirm()), dependencies);
        expect(response.status).toBe(status);
        expect((await response.json()).error.code).toBe(code);
      }
    });
  });

  it("answers not_found for a knowledge base with no v3 draft", async () => {
    const { dependencies } = harness({ readDetails: async () => ({ kind: "ok", value: { kbId: V3_KB_ID, draft: null } }) as never });
    const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
    expect(response.status).toBe(404);
  });

  it("counts against the route's own quota before reading", async () => {
    const { dependencies, identify } = harness({ consumeQuota: async () => "limited" });
    const response = await handleGeoKbV3Competitors(request({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" }), dependencies);
    expect(response.status).toBe(429);
    expect(identify).not.toHaveBeenCalled();
  });
});
