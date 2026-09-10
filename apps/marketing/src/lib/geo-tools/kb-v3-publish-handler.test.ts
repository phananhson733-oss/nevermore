import { describe, expect, it, vi } from "vitest";

import {
  handleGeoKbV3Publish,
  type GeoKbV3PublishDependencies,
} from "./kb-v3-publish-handler.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import {
  geoV3ItemKeys,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import {
  geoV3DecisionStates,
  materializeGeoV3Review,
  applyGeoV3ReviewAction,
} from "./kb-v3-review.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { GEO_ABSENT_QUESTION_SET_HASH } from "./snapshot-context-v3.ts";
import {
  buildGeoQuestionGenerationResultV1,
  geoQuestionGenerationResultHash,
} from "./kb-question-generation-contract.ts";
import { questionSetV2 } from "./kb-v2.test-fixtures.ts";
import type { GeoPreparedCandidateV3 } from "./kb-prepared-v3-contract.ts";
import type {
  GeoKbV3PublishResult,
  GeoKbV3SaveOutcome,
} from "./kb-v3-store.ts";
import {
  stalePayloadV3,
  completePayloadV3,
  FACT_KEY_PRO,
  V3_KB_ID,
} from "./kb-v3.test-fixtures.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-8222-8222-222222222222";
const QUESTIONS_ID = "33333333-3333-8333-8333-333333333333";
const NOW = new Date("2026-09-07T12:00:00.000Z");

/**
 * A publishable draft whose runRef names the digest of its own generation
 * input, as a run locks it.
 */
function lockedPayload(
  overrides: Partial<GeoKbPayloadV3> = {},
): GeoKbPayloadV3 {
  const base = completePayloadV3();
  return parseGeoKbPayloadV3({
    ...base,
    ...overrides,
    runRef: {
      ...base.runRef,
      ...(overrides.runRef ?? {}),
      generationInputHash: geoV2Digest(base.generationInput),
    },
  });
}


/** A draft whose runRef names a completed question generation. */
function withQuestionRun(): GeoKbPayloadV3 {
  return lockedPayload({
    runRef: {
      runId: null,
      generationInputHash: "",
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: QUESTIONS_ID,
    },
  });
}

/**
 * The record such a run leaves behind, built by the shipped contract rather
 * than hand-written -- a hand-written one proves only that the handler accepts
 * hand-written JSON.
 */
function questionResult(
  payload: GeoKbPayloadV3,
  overrides: Record<string, unknown> = {},
) {
  return buildGeoQuestionGenerationResultV1({
    schemaVersion: "marketing-geo-question-generation-result.v1",
    generationId: QUESTIONS_ID,
    kbId: V3_KB_ID,
    baseDraftVersion: "4",
    baseDraftHash: geoV2Digest(payload),
    generationInputHash: geoV2Digest(payload.generationInput),
    sourceReceiptRefs: [],
    questionSet: questionSetV2(),
    ...overrides,
  });
}

/** The draft as it looks once every item has already been decided in bulk. */
function sweptPayload(): GeoKbPayloadV3 {
  const payload = lockedPayload();
  const keys = geoV3ItemKeys(payload.knowledge);
  const review = materializeGeoV3Review(
    payload.review,
    applyGeoV3ReviewAction(geoV3DecisionStates(payload.review, keys), {
      kind: "accept_all",
      itemKeys: keys,
    }),
    {
      contentHash: geoV3ItemContentHashes(payload.knowledge),
      decidedAt: NOW.toISOString(),
      baseDraftVersion: "4",
    },
  );
  return parseGeoKbPayloadV3({ ...payload, review });
}

function request(body: unknown): Request {
  return new Request(
    "https://gengrowth.ai/api/tools/geo-knowledge-base/v3/publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

interface Harness {
  readonly dependencies: GeoKbV3PublishDependencies;
  readonly saveDraft: ReturnType<typeof vi.fn>;
  readonly published: { current: GeoPreparedCandidateV3 | null };
}

function harness(
  payload: GeoKbPayloadV3 = lockedPayload(),
  overrides: Partial<GeoKbV3PublishDependencies> = {},
): Harness {
  const published: { current: GeoPreparedCandidateV3 | null } = {
    current: null,
  };
  const saveDraft = vi.fn(
    async (input: {
      readonly payload: GeoKbPayloadV3;
      readonly baseVersion: number;
    }): Promise<GeoKbV3SaveOutcome> => ({
      kind: "ok",
      value: {
        draftVersion: input.baseVersion + 1,
        contentHash: geoV2Digest(input.payload),
        updatedAt: NOW.toISOString(),
      },
    }),
  );
  const dependencies: GeoKbV3PublishDependencies = {
    authenticate: async () =>
      ({ status: "authenticated", userId: USER_ID }) as never,
    readDetails: async () =>
      ({
        kind: "ok",
        value: {
          kbId: V3_KB_ID,
          draft: {
            draftVersion: 4,
            contentHash: geoV2Digest(payload),
            updatedAt: NOW.toISOString(),
            payload,
          },
        },
      }) as never,
    saveDraft: saveDraft as never,
    readGeneration: async () => ({ kind: "unavailable" }),
    publish: async (input): Promise<GeoKbV3PublishResult> => {
      published.current = input.candidate;
      return {
        kind: "ok",
        value: {
          snapshotId: "44444444-4444-8444-8444-444444444444",
          revision: 4,
          contentHash: input.candidate.baseDraftHash,
          frozenAt: NOW.toISOString(),
          reusedExisting: false,
        },
      };
    },
    newCandidateId: () => CANDIDATE_ID,
    now: () => NOW,
    ...overrides,
  };
  return { dependencies, saveDraft, published };
}

const body = (
  extra: Record<string, unknown> = {},
  payload: GeoKbPayloadV3 = lockedPayload(),
) => ({
  kbId: V3_KB_ID,
  baseVersion: 4,
  draftHash: geoV2Digest(payload),
  ...extra,
});

describe("handleGeoKbV3Publish", () => {
  it("writes the remaining pending items back as accepted before freezing", async () => {
    const payload = lockedPayload();
    const { dependencies, saveDraft, published } = harness(payload);
    const response = await handleGeoKbV3Publish(
      request(body({}, payload)),
      dependencies,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    // `bulkAccepted` still counts the sweep -- how many items the owner never
    // touched -- which is a different question from what they are labelled.
    expect(data.bulkAccepted).toBe(geoV3ItemKeys(payload.knowledge).length);
    expect(data.counts).toMatchObject({
      accepted: geoV3ItemKeys(payload.knowledge).length,
      acceptedInBulk: 0,
      pending: 0,
    });
    // The draft is advanced first, so it agrees with the version afterwards.
    expect(saveDraft).toHaveBeenCalledTimes(1);
    const written = saveDraft.mock.calls[0]![0].payload as GeoKbPayloadV3;
    expect(written.review.decisions.map((record) => record.decision)).toEqual(
      geoV3ItemKeys(payload.knowledge).map(() => "accepted"),
    );
    // The retired label must not come back through the publish-time sweep,
    // which is the one place that still writes decisions nobody pressed.
    expect(
      written.review.decisions.some(
        (record) => record.decision === "accepted_in_bulk",
      ),
    ).toBe(false);
    expect(data.draftVersion).toBe(5);
    expect(published.current?.baseDraftVersion).toBe("5");
    expect(published.current?.baseDraftHash).toBe(geoV2Digest(written));
  });

  it("publishes the pack the reviewed draft assembles to, with the decision carried per item", async () => {
    const payload = lockedPayload();
    const { dependencies, published } = harness(payload);
    await handleGeoKbV3Publish(request(body({}, payload)), dependencies);
    const pack = published.current?.knowledgePack;
    expect(pack?.meta.counts).toMatchObject({
      accepted: geoV3ItemKeys(payload.knowledge).length,
      acceptedInBulk: 0,
    });
    expect(pack?.facts.status).toBe("available");
    const facts = pack?.facts.status === "available" ? pack.facts.value : [];
    expect(facts.map((fact) => fact.decision)).toEqual(
      [FACT_KEY_PRO, expect.anything()].map(() => "accepted"),
    );
  });

  it("keeps a one-by-one acceptance out of the sweep", async () => {
    const payload = lockedPayload();
    const keys = geoV3ItemKeys(payload.knowledge);
    const review = materializeGeoV3Review(
      payload.review,
      applyGeoV3ReviewAction(geoV3DecisionStates(payload.review, keys), {
        kind: "accept",
        itemKey: FACT_KEY_PRO,
      }),
      {
        contentHash: geoV3ItemContentHashes(payload.knowledge),
        decidedAt: NOW.toISOString(),
        baseDraftVersion: "4",
      },
    );
    const decided = parseGeoKbPayloadV3({ ...payload, review });
    const { dependencies, saveDraft } = harness(decided);
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(decided) })),
      dependencies,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    // One item was decided before publishing, so the sweep reaches the rest.
    expect(data.bulkAccepted).toBe(keys.length - 1);
    expect(data.counts).toMatchObject({
      accepted: keys.length,
      acceptedInBulk: 0,
    });
    const written = saveDraft.mock.calls[0]![0].payload as GeoKbPayloadV3;
    expect(
      written.review.decisions.find((record) => record.itemKey === FACT_KEY_PRO)
        ?.decision,
    ).toBe("accepted");
  });

  it("writes nothing to the draft when a second publish finds nothing pending", async () => {
    const payload = sweptPayload();
    const { dependencies, saveDraft, published } = harness(payload);
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.bulkAccepted).toBe(0);
    expect(data.draftVersion).toBe(4);
    // Same bytes as the first publish produced, which is what makes republishing
    // return the existing version instead of minting a second one.
    expect(saveDraft).not.toHaveBeenCalled();
    expect(published.current?.baseDraftHash).toBe(geoV2Digest(payload));
  });

  it("publishes a version with no question set and says why", async () => {
    const payload = lockedPayload();
    const { dependencies, published } = harness(payload);
    const response = await handleGeoKbV3Publish(
      request(body({}, payload)),
      dependencies,
    );
    const data = (await response.json()).data;
    expect(data.questionSet).toEqual({
      status: "unavailable",
      reason: "not_attempted",
    });
    expect(published.current?.questionSet).toEqual({
      status: "unavailable",
      reason: "not_attempted",
      failedGenerationId: null,
    });
    // The documented sentinel, not the digest of any real set.
    expect(published.current?.context.questionSetHash).toBe(
      GEO_ABSENT_QUESTION_SET_HASH,
    );
  });

  /**
   * D8's other half, and the reason the language gate could be removed from the
   * update: a site whose language the question registry has no templates for
   * publishes its knowledge and says the question set is missing FOR THAT
   * REASON. `not_attempted` would be true of the mechanics and misleading about
   * the site -- it reads as "nobody got round to it", when nothing ever will.
   */
  it("names the language as the reason a non-English site has no question set", async () => {
    const base = completePayloadV3();
    const generationInput = {
      ...base.generationInput,
      identity: { ...base.generationInput.identity, market: { country: "CN", language: "zh-CN" } },
    };
    // Re-locked against the changed input: `lockedPayload` stamps the digest of
    // the FIXTURE's input, which a market override no longer matches, and the
    // publish path answers 409 rather than reaching the question set at all.
    const payload = parseGeoKbPayloadV3({
      ...base,
      generationInput,
      runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) },
    });
    const { dependencies, published } = harness(payload);

    const response = await handleGeoKbV3Publish(request(body({}, payload)), dependencies);

    expect(response.status).toBe(200);
    expect((await response.json()).data.questionSet).toEqual({
      status: "unavailable",
      reason: "unsupported_language",
    });
    expect(published.current?.questionSet).toEqual({
      status: "unavailable",
      reason: "unsupported_language",
      failedGenerationId: null,
    });
    // The knowledge itself published: the language is a reason the question set
    // is absent, never a reason to refuse the version.
    expect(published.current?.knowledgePack?.facts.status).toBe("available");
    expect(published.current?.context.questionSetHash).toBe(GEO_ABSENT_QUESTION_SET_HASH);
  });

  it("reports a failed question generation as unavailable and names the record", async () => {
    const payload = lockedPayload({
      runRef: {
        runId: null,
        generationInputHash: "",
        rolesGenerationId: null,
        knowledgeGenerationId: null,
        questionsGenerationId: QUESTIONS_ID,
      },
    });
    const { dependencies, published } = harness(payload, {
      readGeneration: async () => ({
        kind: "ok",
        generation: {
          generationId: QUESTIONS_ID,
          kind: "questions",
          state: "failed",
          result: null,
        },
      }),
    });
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.questionSet).toEqual({
      status: "unavailable",
      reason: "generation_unavailable",
    });
    expect(published.current?.questionSet).toMatchObject({
      reason: "generation_unavailable",
      failedGenerationId: QUESTIONS_ID,
    });
  });

  it("keeps an unknown outcome distinct from a failure", async () => {
    const payload = lockedPayload({
      runRef: {
        runId: null,
        generationInputHash: "",
        rolesGenerationId: null,
        knowledgeGenerationId: null,
        questionsGenerationId: QUESTIONS_ID,
      },
    });
    const { dependencies } = harness(payload, {
      readGeneration: async () => ({
        kind: "ok",
        generation: {
          generationId: QUESTIONS_ID,
          kind: "questions",
          state: "uncertain",
          result: null,
        },
      }),
    });
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    // A call that may have been billed must never be recorded as one that failed.
    expect((await response.json()).data.questionSet).toEqual({
      status: "unavailable",
      reason: "outcome_unknown",
    });
  });

  it("publishes the question set a succeeded run recorded", async () => {
    const payload = withQuestionRun();
    const { dependencies, published } = harness(payload, {
      readGeneration: async () => ({
        kind: "ok",
        generation: {
          generationId: QUESTIONS_ID,
          kind: "questions",
          state: "succeeded",
          result: questionResult(payload),
        },
      }),
    });
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.questionSet).toEqual({
      status: "available",
    });
    expect(published.current?.questionSet).toEqual({
      status: "available",
      value: questionSetV2(),
    });
    // The version is hashed over the set itself, never over the slot carrying it.
    expect(published.current?.context.questionSetHash).toBe(
      geoV2Digest(questionSetV2()),
    );
  });

  it("refuses a question set bound to a different generation input", async () => {
    const payload = withQuestionRun();
    const { dependencies, saveDraft } = harness(payload, {
      readGeneration: async () => ({
        kind: "ok",
        generation: {
          generationId: QUESTIONS_ID,
          kind: "questions",
          state: "succeeded",
          // A complete, self-consistent record -- only the locked input differs.
          result: questionResult(payload, { generationInputHash: "e".repeat(64) }),
        },
      }),
    });
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("input_changed");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a stored question result the contract cannot parse", async () => {
    const payload = withQuestionRun();
    const valid = questionResult(payload);
    // The set SQL would have accepted on its `schemaVersion` alone. Publishing
    // it would freeze a version whose questions no reader can parse.
    //
    // Re-hashed on purpose. Swapping the set without re-hashing leaves the
    // record self-inconsistent as well as ungrammatical, and the hash
    // comparison then stands behind the grammar as a second reason to refuse --
    // so the case passed identically with the question grammar switched off
    // altogether. Re-hashing removes the fallback, leaving `parseGeoQuestionSetV2`
    // as the only thing that can refuse this.
    const { contentHash: _rehashed, ...resultBody } = valid;
    const bareSet = { ...resultBody, questionSet: { schemaVersion: "marketing-geo-question-set.v2" } };
    for (const result of [
      { ...bareSet, contentHash: geoQuestionGenerationResultHash(bareSet) },
      { ...valid, contentHash: "f".repeat(64) },
      { schemaVersion: "marketing-geo-question-generation-result.v1" },
      null,
    ]) {
      const { dependencies, saveDraft, published } = harness(payload, {
        readGeneration: async () => ({
          kind: "ok",
          generation: {
            generationId: QUESTIONS_ID,
            kind: "questions",
            state: "succeeded",
            result,
          },
        }),
      });
      const response = await handleGeoKbV3Publish(
        request(body({ draftHash: geoV2Digest(payload) })),
        dependencies,
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("store_unavailable");
      expect(saveDraft).not.toHaveBeenCalled();
      expect(published.current).toBeNull();
    }
  });

  it("refuses a question result that names another knowledge base or record", async () => {
    const payload = withQuestionRun();
    for (const overrides of [
      { kbId: "99999999-9999-8999-8999-999999999999" },
      { generationId: "88888888-8888-8888-8888-888888888888" },
    ]) {
      const { dependencies, published } = harness(payload, {
        readGeneration: async () => ({
          kind: "ok",
          generation: {
            generationId: QUESTIONS_ID,
            kind: "questions",
            state: "succeeded",
            result: questionResult(payload, overrides),
          },
        }),
      });
      const response = await handleGeoKbV3Publish(
        request(body({ draftHash: geoV2Digest(payload) })),
        dependencies,
      );
      expect(response.status).toBe(503);
      expect(published.current).toBeNull();
    }
  });

  it("refuses a knowledge generation bound to a different generation input", async () => {
    const payload = lockedPayload({
      runRef: {
        runId: null,
        generationInputHash: "",
        rolesGenerationId: null,
        knowledgeGenerationId: QUESTIONS_ID,
        questionsGenerationId: null,
      },
    });
    const { dependencies, saveDraft } = harness(payload, {
      readGeneration: async () => ({
        kind: "ok",
        generation: {
          generationId: QUESTIONS_ID,
          kind: "knowledge_pack",
          state: "succeeded",
          result: {
            schemaVersion: "marketing-geo-knowledge-generation-result.v2",
            manifest: { generationInputHash: "e".repeat(64) },
          },
        },
      }),
    });
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("input_changed");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses when the draft moved under the owner, by version or by content", async () => {
    const payload = lockedPayload();
    for (const change of [{ baseVersion: 3 }, { draftHash: "d".repeat(64) }]) {
      const { dependencies, saveDraft, published } = harness(payload);
      const response = await handleGeoKbV3Publish(
        request(body(change, payload)),
        dependencies,
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("conflict");
      expect(saveDraft).not.toHaveBeenCalled();
      expect(published.current).toBeNull();
    }
  });

  /**
   * An unknown version is never a number.
   *
   * `saveGeoKbDraftV3` answers `currentDraftVersion: null` when the database
   * handed back no usable version, and this route used to turn that into `-1`.
   * The client accepts `-1` as a safe integer and files it as the version it
   * lost to, so the sentinel would travel as a version. Both outcomes are
   * asserted against literals: a route that hard-codes either one fails.
   */
  it("reports an unknown current draft version as null and a known one as itself", async () => {
    const conflicting = async (
      currentDraftVersion: number | null,
    ): Promise<Response> => {
      const payload = lockedPayload();
      const { dependencies, published } = harness(payload, {
        saveDraft: async () => ({ kind: "conflict", currentDraftVersion }),
      });
      const response = await handleGeoKbV3Publish(
        request(body({}, payload)),
        dependencies,
      );
      // Nothing was frozen: the conflict is refused before the version is made.
      expect(published.current).toBeNull();
      return response;
    };

    const unknown = await conflicting(null);
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toEqual({
      error: { code: "conflict" },
      draftVersion: null,
    });

    const known = await conflicting(9);
    expect(known.status).toBe(409);
    expect(await known.json()).toEqual({
      error: { code: "conflict" },
      draftVersion: 9,
    });
  });

  it("refuses while a run is writing this draft", async () => {
    const payload = lockedPayload();
    const { dependencies, published } = harness(payload, {
      generationRunning: async () => true,
    });
    const response = await handleGeoKbV3Publish(
      request(body({}, payload)),
      dependencies,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("generation_running");
    expect(published.current).toBeNull();
  });

  it("refuses a draft whose stored generation input no longer digests to its locked hash", async () => {
    const stale = stalePayloadV3();
    const { dependencies, published } = harness(stale);
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(stale) })),
      dependencies,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("input_changed");
    expect(published.current).toBeNull();
  });

  it("refuses to publish a draft with neither knowledge nor a question set", async () => {
    const payload = lockedPayload({ knowledge: null });
    const { dependencies, published } = harness(payload);
    const response = await handleGeoKbV3Publish(
      request(body({ draftHash: geoV2Digest(payload) })),
      dependencies,
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("nothing_to_publish");
    expect(published.current).toBeNull();
  });

  it("makes no model call and spends no crawl budget", async () => {
    // Publishing is free by construction: the handler's whole dependency set is
    // a store read, a store write and the publish RPC.
    const payload = lockedPayload();
    const { dependencies } = harness(payload);
    expect(Object.keys(dependencies).sort()).toEqual([
      "authenticate",
      "newCandidateId",
      "now",
      "publish",
      "readDetails",
      "readGeneration",
      "saveDraft",
    ]);
  });
});
