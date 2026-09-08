import { describe, expect, it, vi } from "vitest";

import { handleGeoKbV3Review, type GeoKbV3ReviewDependencies } from "./kb-v3-review-handler.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3, type GeoReviewV3 } from "./kb-v3-contract.ts";
import { geoV3DecisionStates } from "./kb-v3-review.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";
import {
  stalePayloadV3,
  completePayloadV3,
  FACT_KEY_PRO,
  FACT_KEY_TEAM,
  QA_KEY,
  V3_KB_ID,
} from "./kb-v3.test-fixtures.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const NOW = new Date("2026-09-07T12:00:00.000Z");

/** A draft whose runRef names the digest of its own generation input, as a run locks it. */
function lockedPayload(review?: GeoReviewV3): GeoKbPayloadV3 {
  const base = completePayloadV3();
  return parseGeoKbPayloadV3({
    ...base,
    ...(review === undefined ? {} : { review }),
    runRef: { ...base.runRef, generationInputHash: geoV2Digest(base.generationInput) },
  });
}

function request(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/review", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

interface Harness {
  readonly dependencies: GeoKbV3ReviewDependencies;
  readonly saved: { current: GeoKbPayloadV3 | null };
  readonly saveDraft: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<GeoKbV3ReviewDependencies> = {}, payload: GeoKbPayloadV3 = lockedPayload()): Harness {
  const saved: { current: GeoKbPayloadV3 | null } = { current: null };
  const saveDraft = vi.fn(async (input: { readonly payload: GeoKbPayloadV3; readonly baseVersion: number }): Promise<GeoKbV3SaveOutcome> => {
    saved.current = input.payload;
    return { kind: "ok", value: { draftVersion: input.baseVersion + 1, contentHash: geoV2Digest(input.payload), updatedAt: NOW.toISOString() } };
  });
  const dependencies: GeoKbV3ReviewDependencies = {
    authenticate: async () => ({ status: "authenticated", userId: USER_ID }) as never,
    readDetails: async () => ({ kind: "ok", value: {
      kbId: V3_KB_ID,
      draft: { draftVersion: 4, contentHash: geoV2Digest(payload), updatedAt: NOW.toISOString(), payload },
    } }) as never,
    saveDraft: saveDraft as never,
    now: () => NOW,
    ...overrides,
  };
  return { dependencies, saved, saveDraft };
}

const base = (extra: Record<string, unknown> = {}) => ({
  kbId: V3_KB_ID, baseVersion: 4, expectedGenerationInputHash: geoV2Digest(completePayloadV3().generationInput), ...extra,
});

describe("handleGeoKbV3Review", () => {
  it("records a one-by-one acceptance and returns the saved review", async () => {
    const { dependencies, saved } = harness();
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.draftVersion).toBe(5);
    expect(body.data.review.decisions).toEqual([expect.objectContaining({ itemKey: FACT_KEY_PRO, decision: "accepted", baseDraftVersion: "4", decidedAt: NOW.toISOString() })]);
    expect(body.data.counts).toMatchObject({ accepted: 1, acceptedInBulk: 0 });
    expect(saved.current?.review.decisions[0]?.decision).toBe("accepted");
  });

  it("writes accepted_in_bulk for 全部接受 and never accepted", async () => {
    const payload = lockedPayload();
    const { dependencies, saved } = harness({}, payload);
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept_all", itemKeys: geoV3ItemKeys(payload.knowledge) }] })), dependencies);
    expect(response.status).toBe(200);
    const body = await response.json();
    // The route is the second place this could go wrong, so it is asserted
    // here too rather than being taken on trust from the pure layer.
    expect(body.data.review.decisions.map((record: { decision: string }) => record.decision))
      .toEqual(geoV3ItemKeys(payload.knowledge).map(() => "accepted_in_bulk"));
    expect(body.data.review.decisions.some((record: { decision: string }) => record.decision === "accepted")).toBe(false);
    expect(saved.current?.review.decisions.every((record) => record.decision === "accepted_in_bulk")).toBe(true);
  });

  it("leaves the locked halves of the draft exactly as they were", async () => {
    const payload = lockedPayload();
    const { dependencies, saved } = harness({}, payload);
    await handleGeoKbV3Review(request(base({ actions: [{ kind: "exclude", itemKey: QA_KEY }] })), dependencies);
    // The request has no field for either half, and the save proves the server
    // did not derive a change to one from a review gesture.
    expect(geoV2Digest(saved.current?.generationInput)).toBe(geoV2Digest(payload.generationInput));
    expect(geoV2Digest(saved.current?.knowledge)).toBe(geoV2Digest(payload.knowledge));
    expect(saved.current?.runRef).toEqual(payload.runRef);
  });

  it("refuses a save whose base version is not the stored one, and says which won", async () => {
    const { dependencies, saveDraft } = harness();
    const response = await handleGeoKbV3Review(request(base({ baseVersion: 3, actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" }, draftVersion: 4 });
    // Never overwrite: nothing reached the store.
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("passes a conflict raised by the store through without rewriting it", async () => {
    const { dependencies } = harness({ saveDraft: async () => ({ kind: "conflict", currentDraftVersion: 9 }) });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" }, draftVersion: 9 });
  });

  /**
   * An unknown version is never a number.
   *
   * `saveGeoKbDraftV3` answers `currentDraftVersion: null` when the database
   * handed back no usable version, and this route used to turn that into `-1` --
   * a value the client accepts as a safe integer and files as the version it
   * lost to. The test above pins the known half; this one pins the unknown one.
   */
  it("reports an unknown current draft version as null rather than a sentinel", async () => {
    const { dependencies } = harness({ saveDraft: async () => ({ kind: "conflict", currentDraftVersion: null }) });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" }, draftVersion: null });
  });

  it("refuses when a run relocked the generation input under the review", async () => {
    const { dependencies, saveDraft } = harness();
    const response = await handleGeoKbV3Review(request(base({ expectedGenerationInputHash: "c".repeat(64), actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("input_changed");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a stored draft whose generation input no longer digests to its locked hash", async () => {
    // The stored hash and the stored input are checked against each other as
    // well as against the client, so a payload edited in transit cannot inherit
    // an identity a paid run established.
    const forged = stalePayloadV3();
    const { dependencies, saveDraft } = harness({}, forged);
    const response = await handleGeoKbV3Review(request(base({ expectedGenerationInputHash: forged.runRef.generationInputHash, actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("input_changed");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses while a run is writing this draft", async () => {
    const { dependencies, saveDraft } = harness({ generationRunning: async () => true });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("generation_running");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("still saves when the running check cannot answer", async () => {
    // Failing open is deliberate: the run keeps executing at the provider
    // whether or not this read works, and refusing would freeze every review.
    const { dependencies, saveDraft } = harness({ generationRunning: async () => "unavailable" });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(200);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the gestures change nothing", async () => {
    const payload = lockedPayload();
    const already = geoV3DecisionStates(payload.review, geoV3ItemKeys(payload.knowledge));
    expect(already.get(FACT_KEY_TEAM)?.decision).toBe("pending");
    const { dependencies, saveDraft } = harness({}, payload);
    // Accepting, then un-accepting, in one batch: the review is what it was.
    const response = await handleGeoKbV3Review(request(base({ actions: [
      { kind: "accept", itemKey: FACT_KEY_TEAM }, { kind: "accept", itemKey: FACT_KEY_TEAM },
    ] })), dependencies);
    expect(response.status).toBe(200);
    expect((await response.json()).data.draftVersion).toBe(4);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a correction aimed at another module", async () => {
    const { dependencies, saveDraft } = harness();
    const response = await handleGeoKbV3Review(request(base({ actions: [{
      kind: "correct", itemKey: FACT_KEY_PRO, override: { module: "scope", text: "Not about a price at all." },
    }] })), dependencies);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_review");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("rejects a request that tries to carry a payload of its own", async () => {
    const { dependencies } = harness();
    const response = await handleGeoKbV3Review(request(base({
      actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }], payload: completePayloadV3(),
    })), dependencies);
    // The strict schema is the enforcement of "only review may change": there is
    // no field in which a client can send another half of the draft.
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("reports a knowledge base with no v3 draft as not found", async () => {
    const { dependencies } = harness({ readDetails: async () => ({ kind: "ok", value: { kbId: V3_KB_ID, draft: null } }) as never });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(404);
  });

  it("refuses an unauthenticated caller before reading anything", async () => {
    const readDetails = vi.fn();
    const { dependencies } = harness({ authenticate: async () => ({ status: "unauthenticated" }) as never, readDetails: readDetails as never });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(401);
    expect(readDetails).not.toHaveBeenCalled();
  });

  it("stops on a spent quota rather than writing", async () => {
    const { dependencies, saveDraft } = harness({ consumeQuota: async () => "limited" });
    const response = await handleGeoKbV3Review(request(base({ actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] })), dependencies);
    expect(response.status).toBe(429);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
