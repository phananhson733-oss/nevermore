// @input -- synthetic v3 drafts, synthetic generation records and fake stores
// @output -- what the assemble route writes, what it refuses, and what it never retries
// @pos -- offline unit test; no database, no provider, no clock of its own
import { describe, expect, it, vi } from "vitest";

import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
import type { GeoKbGenerationRecord } from "./kb-generation.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  buildGeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  assemblyEvidence,
  ASSEMBLY_IDENTITY,
} from "./kb-knowledge-assemble.test-fixtures.ts";
import {
  geoV2NarrativeFixture,
  geoV2ProfileRefFixture,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";
import { assembleGeoKnowledgeBodyV3 } from "./kb-knowledge-assemble.ts";
import {
  geoV3ItemKeys,
  geoV3Items,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { applyGeoV3ReviewAction, geoV3DecisionStates, materializeGeoV3Review } from "./kb-v3-review.ts";
import {
  handleGeoKbV3Assemble,
  type GeoKbV3AssembleDependencies,
} from "./kb-v3-assemble-handler.ts";
import { relockGeoKbV3Payload } from "./kb-v3-draft-create.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const KB_ID = "22222222-2222-8222-8222-222222222222";
const GENERATION_ID = "33333333-3333-8333-8333-333333333333";
const OTHER_GENERATION_ID = "44444444-4444-8444-8444-444444444444";
const EVIDENCE_HASH = "e".repeat(64);
const GENERATED_AT = "2026-09-05T00:00:00.000Z";
const UPDATED_AT = "2026-09-05T01:00:00.000Z";
const ATTEMPT = {
  attemptedCalls: 1 as const,
  delivery: "response_received" as const,
  modelRequested: "offline-model",
  inputTokens: 10,
  outputTokens: 20,
  requestCount: 1,
};

type Narrative = ReturnType<typeof geoV2NarrativeFixture>;

function generationInput() {
  return {
    identity: ASSEMBLY_IDENTITY,
    profileRef: geoV2ProfileRefFixture(),
    competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: true }],
    roles: [],
    evidenceContentHash: EVIDENCE_HASH,
  };
}

/** The draft a created-but-never-assembled knowledge base actually holds. */
function emptyDraft(): GeoKbPayloadV3 {
  const input = generationInput();
  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput: input,
    knowledge: null,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      generationInputHash: geoV2Digest(input),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
  });
}

interface ResultOptions {
  readonly generationInputHash?: string;
  readonly generationId?: string;
  readonly narrative?: (value: Narrative) => unknown;
  readonly generatedAt?: string;
}

/** A knowledge generation result built by the shipped v2 builders. */
function knowledgeResult(options: ResultOptions = {}) {
  const evidence = assemblyEvidence();
  const generationInputHash = options.generationInputHash ?? emptyDraft().runRef.generationInputHash;
  const synthesisInput = buildGeoKnowledgeSynthesisInputV2(
    {
      officialName: ASSEMBLY_IDENTITY.officialName,
      aliases: [...ASSEMBLY_IDENTITY.aliases],
      categoryTerms: [...ASSEMBLY_IDENTITY.categoryTerms],
      market: ASSEMBLY_IDENTITY.market.country,
      language: ASSEMBLY_IDENTITY.market.language,
      profileRef: geoV2ProfileRefFixture(),
      generationInputHash,
    },
    evidence,
  );
  const manifest = {
    schemaVersion: "marketing-geo-knowledge-generation-input.v2",
    kbId: KB_ID,
    baseDraftVersion: "1",
    baseDraftHash: "f".repeat(64),
    generationInputHash,
    sourceReceiptRefs: [],
    knowledgeSynthesisInput: synthesisInput,
  };
  const narrative = (options.narrative ?? ((value: unknown) => value))(geoV2NarrativeFixture());
  return {
    manifest,
    result: buildGeoKnowledgeGenerationResultV2({
      schemaVersion: "marketing-geo-knowledge-generation-result.v2",
      generationId: options.generationId ?? GENERATION_ID,
      kbId: KB_ID,
      manifest,
      synthesisInput,
      evidence,
      narrative,
      generatedAt: options.generatedAt ?? GENERATED_AT,
    }),
    synthesisInput,
    evidence,
  };
}

function succeededRecord(options: ResultOptions = {}): GeoKbGenerationRecord {
  const { manifest, result } = knowledgeResult(options);
  return {
    generationId: options.generationId ?? GENERATION_ID,
    userId: USER_ID,
    kbId: KB_ID,
    kind: "knowledge_pack",
    inputHash: geoGenerationInputHash("knowledge_pack", JSON.parse(JSON.stringify(manifest))),
    state: "succeeded",
    result: result as never,
    errorReason: null,
    attempt: ATTEMPT,
  };
}

function terminalRecord(state: "failed" | "uncertain" | "claimed" | "dispatched"): GeoKbGenerationRecord {
  return {
    generationId: GENERATION_ID,
    userId: USER_ID,
    kbId: KB_ID,
    kind: "knowledge_pack",
    inputHash: "a".repeat(64),
    state,
    result: null,
    errorReason: state === "uncertain" ? "outcome_unknown" : state === "failed" ? "invalid_output" : null,
    attempt: state === "claimed" || state === "dispatched" ? null : {
      ...ATTEMPT,
      delivery: state === "uncertain" ? ("outcome_unknown" as const) : ("response_received" as const),
    },
  };
}

/** The body this generation assembles to, derived the way the handler derives it. */
function expectedKnowledge(options: ResultOptions = {}) {
  const { result } = knowledgeResult(options);
  return assembleGeoKnowledgeBodyV3({
    generatedAt: result.generatedAt,
    identity: ASSEMBLY_IDENTITY,
    evidence: result.evidence,
    offsite: null,
    synthesisInput: result.synthesisInput,
    narrative: result.narrative,
    narrativeFailureReason: null,
    robots: null,
    snippetsBlocked: null,
  }).knowledge;
}

interface StubOptions {
  readonly payload?: GeoKbPayloadV3;
  readonly draftVersion?: number;
  readonly contentHash?: string;
  readonly generation?: GeoKbGenerationRecord | null;
  readonly generationRead?: "unavailable";
  readonly save?: Awaited<ReturnType<GeoKbV3AssembleDependencies["saveDraft"]>>;
  readonly quota?: "allowed" | "limited" | "unavailable";
  readonly running?: boolean | "unavailable";
  readonly authenticate?: GeoKbV3AssembleDependencies["authenticate"];
  readonly details?: Awaited<ReturnType<GeoKbV3AssembleDependencies["readDetails"]>>;
}

function stub(options: StubOptions = {}) {
  const payload = options.payload ?? emptyDraft();
  const contentHash = options.contentHash ?? geoV2Digest(payload);
  const draftVersion = options.draftVersion ?? 1;
  const saveDraft = vi.fn(async (input: { readonly payload: GeoKbPayloadV3; readonly baseVersion: number }) =>
    options.save ?? ({
      kind: "ok",
      value: { draftVersion: draftVersion + 1, contentHash: geoV2Digest(input.payload), updatedAt: UPDATED_AT },
    } as Awaited<ReturnType<GeoKbV3AssembleDependencies["saveDraft"]>>));
  const readLatestGeneration = vi.fn(async () =>
    options.generationRead === "unavailable"
      ? ({ kind: "unavailable" } as const)
      : ({ kind: "ok", generation: options.generation === undefined ? succeededRecord() : options.generation } as const));
  const dependencies: GeoKbV3AssembleDependencies = {
    authenticate: options.authenticate ?? (async () => ({ status: "authenticated", userId: USER_ID }) as never),
    readDetails: async () =>
      options.details ?? ({
        kind: "ok",
        value: { kbId: KB_ID, draft: { draftVersion, contentHash, updatedAt: UPDATED_AT, payload } },
      } as never),
    saveDraft: saveDraft as never,
    readLatestGeneration: readLatestGeneration as never,
    generationRunning: async () => options.running ?? false,
    consumeQuota: async () => options.quota ?? "allowed",
  };
  return { dependencies, saveDraft, readLatestGeneration, payload, contentHash, draftVersion };
}

function request(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/assemble", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://gengrowth.ai" },
    body: JSON.stringify(body),
  });
}

async function assemble(harness: ReturnType<typeof stub>, overrides: Record<string, unknown> = {}) {
  const response = await handleGeoKbV3Assemble(
    request({ kbId: KB_ID, baseVersion: harness.draftVersion, draftHash: harness.contentHash, ...overrides }),
    harness.dependencies,
  );
  return { response, body: (await response.json()) as Record<string, never> };
}

describe("assembling a v3 draft's knowledge", () => {
  it("is the only thing that writes payload.knowledge, and it names the run that paid for it", async () => {
    const harness = stub();
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(200);
    expect(harness.saveDraft).toHaveBeenCalledTimes(1);
    const saved = harness.saveDraft.mock.calls[0]![0]!.payload;
    expect(saved.knowledge).not.toBeNull();
    expect(saved.knowledge).toEqual(expectedKnowledge());
    expect(saved.runRef.knowledgeGenerationId).toBe(GENERATION_ID);
    // The locked half is untouched: assembling is not a re-lock.
    expect(saved.generationInput).toEqual(harness.payload.generationInput);
    expect(saved.runRef.generationInputHash).toBe(harness.payload.runRef.generationInputHash);
    expect(harness.saveDraft.mock.calls[0]![0]!.baseVersion).toBe(1);
    expect(body.data).toMatchObject({
      kbId: KB_ID,
      draftVersion: 2,
      knowledgeGenerationId: GENERATION_ID,
      assembledAt: GENERATED_AT,
      changed: true,
    });
    expect(geoV3ItemKeys(saved.knowledge).length).toBeGreaterThan(0);
    expect((body.data as unknown as { readonly items: number }).items).toBe(geoV3ItemKeys(saved.knowledge).length);
  });

  it("makes the draft publishable: the exact condition publish refuses on is gone", async () => {
    const harness = stub();
    await assemble(harness);
    const saved = harness.saveDraft.mock.calls[0]![0]!.payload;
    // kb-v3-publish-handler.ts:199 -- knowledge null AND no question set is the
    // unconditional 422. A v3 draft has no question generation in this
    // deployment, so knowledge is the only half that can lift it.
    expect(saved.knowledge === null && saved.runRef.questionsGenerationId === null).toBe(false);
  });

  it("writes no second version when the same generation is assembled again", async () => {
    const first = stub();
    await assemble(first);
    const saved = first.saveDraft.mock.calls[0]![0]!.payload;

    // The draft as it now stands, assembled from the same record a second time.
    const second = stub({ payload: saved, draftVersion: 2 });
    const { response, body } = await assemble(second);

    expect(response.status).toBe(200);
    expect(second.saveDraft).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ draftVersion: 2, changed: false });
    expect((body.data as unknown as { readonly contentHash: string }).contentHash).toBe(geoV2Digest(saved));
  });

  it("writes no second version after a review either, so a poller cannot churn the draft", async () => {
    const first = stub();
    await assemble(first);
    const assembled = first.saveDraft.mock.calls[0]![0]!.payload;
    const keys = geoV3ItemKeys(assembled.knowledge);
    /**
     * The review is built by the real state machine rather than hand-written,
     * and that matters here: `materializeGeoV3Review` emits decisions in item
     * order (`geoV3DecisionStates` iterates the item keys), and `mergeGeoDraftV3`
     * rebuilds them in item order too. Those two orders agreeing is what makes
     * re-assembling an unchanged run byte-identical. A hand-ordered review would
     * be a state no route can write, and it would fail here -- the ordering
     * coupling is real and undocumented, and it is recorded as a seam.
     */
    const states = geoV3DecisionStates(assembled.review, keys);
    const review = materializeGeoV3Review(
      assembled.review,
      applyGeoV3ReviewAction(states, { kind: "exclude", itemKey: keys[2]! }),
      { contentHash: geoV3ItemContentHashes(assembled.knowledge), decidedAt: "2026-09-05T02:00:00.000Z", baseDraftVersion: "2" },
    );
    const reviewed = parseGeoKbPayloadV3({ ...assembled, review });
    expect(reviewed.review.decisions.length).toBeGreaterThan(0);

    const second = stub({ payload: reviewed, draftVersion: 2 });
    const { response, body } = await assemble(second);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ changed: false });
    expect(second.saveDraft).not.toHaveBeenCalled();
  });

  it("keeps a decision the owner already made when the run changes the body", async () => {
    const first = stub();
    await assemble(first);
    const assembled = first.saveDraft.mock.calls[0]![0]!.payload;
    const keys = geoV3ItemKeys(assembled.knowledge);
    const hashes = geoV3ItemContentHashes(assembled.knowledge);
    const decidedKey = keys[0]!;
    const reviewed = parseGeoKbPayloadV3({
      ...assembled,
      review: {
        decisions: [{
          itemKey: decidedKey,
          decision: "excluded",
          override: null,
          baseContentHash: hashes.get(decidedKey)!,
          decidedAt: "2026-09-05T02:00:00.000Z",
          baseDraftVersion: "2",
        }],
        suppressions: [],
      },
    });

    // A second run that says one more thing: the body changes, so a save happens.
    const grown: ResultOptions = {
      narrative: (value: Narrative) => ({
        ...value,
        scope: {
          ...value.scope,
          doesNot: [{ id: "scope:not", text: "Does not run offline.", sourceRefs: ["source:own"] }],
        },
      }),
      generationId: OTHER_GENERATION_ID,
    };
    const second = stub({
      payload: reviewed,
      draftVersion: 2,
      generation: succeededRecord(grown),
    });
    const { response } = await assemble(second);

    expect(response.status).toBe(200);
    expect(second.saveDraft).toHaveBeenCalledTimes(1);
    const saved = second.saveDraft.mock.calls[0]![0]!.payload;
    expect(geoV3ItemKeys(saved.knowledge).length).toBe(keys.length + 1);
    // The exclusion survived the update rather than being re-asked.
    expect(saved.review.decisions.map((record) => record.itemKey)).toContain(decidedKey);
    expect(saved.review.decisions.find((record) => record.itemKey === decidedKey)?.decision).toBe("excluded");
    expect(saved.runRef.knowledgeGenerationId).toBe(OTHER_GENERATION_ID);
  });

  it("refuses a generation bound to a different locked input", async () => {
    const harness = stub({ generation: succeededRecord({ generationInputHash: "b".repeat(64) }) });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "input_changed" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("reports a failed knowledge run rather than assembling an empty body", async () => {
    const harness = stub({ generation: terminalRecord("failed") });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(422);
    expect(body.error).toEqual({ code: "generation_failed" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("never retries an outcome we did not see, and never calls it a failure", async () => {
    const harness = stub({ generation: terminalRecord("uncertain") });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(422);
    expect(body.error).toEqual({ code: "outcome_unknown" });
    expect(harness.readLatestGeneration).toHaveBeenCalledTimes(1);
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it.each(["claimed", "dispatched"] as const)("waits while the %s run is still open", async (state) => {
    const harness = stub({ generation: terminalRecord(state) });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_running" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses while any generation of this knowledge base is dispatched", async () => {
    const harness = stub({ running: true });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_running" });
    expect(harness.readLatestGeneration).not.toHaveBeenCalled();
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("says there is nothing to assemble when the knowledge step never ran", async () => {
    const harness = stub({ generation: null });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_missing" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("separates a knowledge result it cannot use from a store it cannot read", async () => {
    /**
     * The version is decided before the result is parsed, on purpose, and the
     * two outcomes are different remedies. A v1 knowledge result is bound to a
     * `profileCopy` hash -- a field a v3 draft does not have -- so no comparison
     * could ever tell whether it belongs to this draft's locked input: that is a
     * permanent state whose remedy is running the knowledge step again. A result
     * that claims to be v2 and does not parse is a store inconsistency, which is
     * an outage. Written as stored bytes rather than through the v1 builder
     * because the builder's own integrity checks would decide this test, and the
     * branch under test never reaches a parser at all.
     */
    const legacy = stub({
      generation: {
        generationId: GENERATION_ID, userId: USER_ID, kbId: KB_ID, kind: "knowledge_pack",
        inputHash: "a".repeat(64), state: "succeeded", errorReason: null, attempt: ATTEMPT,
        result: { schemaVersion: "marketing-geo-knowledge-generation-result.v1", generationId: GENERATION_ID, kbId: KB_ID } as never,
      },
    });
    const refused = await assemble(legacy);
    expect(refused.response.status).toBe(422);
    expect(refused.body.error).toEqual({ code: "generation_unusable" });
    expect(legacy.saveDraft).not.toHaveBeenCalled();

    const broken = stub({
      generation: {
        generationId: GENERATION_ID, userId: USER_ID, kbId: KB_ID, kind: "knowledge_pack",
        inputHash: "a".repeat(64), state: "succeeded", errorReason: null, attempt: ATTEMPT,
        result: { schemaVersion: "marketing-geo-knowledge-generation-result.v2" } as never,
      },
    });
    const outage = await assemble(broken);
    expect(outage.response.status).toBe(503);
    expect(outage.body.error).toEqual({ code: "store_unavailable" });
    expect(broken.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a v2 result whose own identity is not the record's", async () => {
    const foreign = knowledgeResult().result;
    const harness = stub({
      generation: {
        generationId: OTHER_GENERATION_ID, userId: USER_ID, kbId: KB_ID, kind: "knowledge_pack",
        inputHash: "a".repeat(64), state: "succeeded", errorReason: null, attempt: ATTEMPT,
        // The record and the result disagree about which generation this is.
        result: foreign as never,
      },
    });
    const { response, body } = await assemble(harness);
    expect(response.status).toBe(503);
    expect(body.error).toEqual({ code: "store_unavailable" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a stale draft version and a stale draft hash, and names the version", async () => {
    const stale = await assemble(stub(), { baseVersion: 9 });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toEqual({ error: { code: "conflict" }, draftVersion: 1 });

    const edited = await assemble(stub(), { draftHash: "0".repeat(64) });
    expect(edited.response.status).toBe(409);
    expect(edited.body).toEqual({ error: { code: "conflict" }, draftVersion: 1 });
  });

  it("refuses a draft whose recorded generation-input hash is not the hash of its input", async () => {
    const base = emptyDraft();
    const payload = { ...base, runRef: { ...base.runRef, generationInputHash: "d".repeat(64) } } as GeoKbPayloadV3;
    const harness = stub({ payload });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "input_changed" });
    expect(harness.readLatestGeneration).not.toHaveBeenCalled();
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("reports a version the store could not name as null, never as a sentinel", async () => {
    // `kb-v3-store.ts` answers `null` when the database handed back nothing
    // usable, and -1 puts a value in the version field that reads as a version
    // and is not one: every real draft version is positive, so a reader cannot
    // tell -1 from an answer. The create route passes the null through too.
    const { response, body } = await assemble(stub({ save: { kind: "conflict", currentDraftVersion: null } }));

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: { code: "conflict" }, draftVersion: null });
  });

  it("cannot absorb the generation a re-lock released", async () => {
    // The guarantee that makes the re-lock safe to offer at all. Re-locking
    // clears `knowledgeGenerationId`, so the paid body has no provenance any
    // more; if this route could put it back the owner would be shown knowledge
    // generated against a Profile revision they have since replaced, with
    // nothing naming where it came from.
    const first = stub();
    const assembled = await assemble(first);
    expect(assembled.response.status).toBe(200);
    const withKnowledge = first.saveDraft.mock.calls[0]![0]!.payload;
    expect(withKnowledge.knowledge).not.toBeNull();
    expect(withKnowledge.runRef.knowledgeGenerationId).toBe(GENERATION_ID);

    // The owner confirms a new Profile revision; the draft is re-locked over it
    // by the real producer, not by a hand-edited payload.
    const relocked = relockGeoKbV3Payload(withKnowledge, {
      kind: "ok",
      identity: ASSEMBLY_IDENTITY,
      profileRef: {
        ...geoV2ProfileRefFixture(),
        snapshotId: OTHER_GENERATION_ID,
        snapshotRevision: "4",
        profileHash: "a".repeat(64),
      },
      competitors: withKnowledge.generationInput.competitors,
      blockers: [],
    }).payload;
    expect(relocked.knowledge).toBeNull();
    expect(relocked.runRef.knowledgeGenerationId).toBeNull();

    // ...and that same generation is still the newest one this knowledge base
    // owns, so nothing but the binding check stands between it and the draft.
    const second = stub({ payload: relocked, draftVersion: 2 });
    const { response, body } = await assemble(second);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "input_changed" });
    expect(second.saveDraft).not.toHaveBeenCalled();
  });

  it("turns the store's own refusals into the remedy each one needs", async () => {
    const locked = await assemble(stub({ save: { kind: "input_locked" } }));
    expect(locked.response.status).toBe(409);
    expect(locked.body.error).toEqual({ code: "input_changed" });

    const conflict = await assemble(stub({ save: { kind: "conflict", currentDraftVersion: 7 } }));
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toEqual({ error: { code: "conflict" }, draftVersion: 7 });

    const gone = await assemble(stub({ save: { kind: "missing" } }));
    expect(gone.response.status).toBe(404);
    expect(gone.body.error).toEqual({ code: "not_found" });

    const down = await assemble(stub({ save: { kind: "unavailable", reason: "store_unavailable" } as never }));
    expect(down.response.status).toBe(503);
    expect(down.body.error).toEqual({ code: "store_unavailable" });
  });

  it("refuses a knowledge base with no v3 draft, and one still on a legacy payload", async () => {
    const none = await assemble(stub({ details: { kind: "ok", value: { kbId: KB_ID, draft: null } } as never }));
    expect(none.response.status).toBe(404);

    const legacy = await assemble(stub({
      details: {
        kind: "ok",
        value: {
          kbId: KB_ID,
          draft: { draftVersion: 1, contentHash: "a".repeat(64), updatedAt: UPDATED_AT, payload: { schemaVersion: "marketing-geo-kb.v2" } },
        },
      } as never,
    }));
    expect(legacy.response.status).toBe(404);
  });

  it("spends the quota before it reads anything, and says which refusal it was", async () => {
    const limited = stub({ quota: "limited" });
    const first = await assemble(limited);
    expect(first.response.status).toBe(429);
    expect(first.body.error).toEqual({ code: "rate_limited" });
    expect(limited.readLatestGeneration).not.toHaveBeenCalled();

    const down = stub({ quota: "unavailable" });
    const second = await assemble(down);
    expect(second.response.status).toBe(503);
    expect(second.body.error).toEqual({ code: "store_unavailable" });
  });

  it("reports an unauthenticated caller without touching the stores", async () => {
    const harness = stub({ authenticate: async () => ({ status: "unauthenticated" }) as never });
    const { response, body } = await assemble(harness);
    expect(response.status).toBe(401);
    expect(body.error).toEqual({ code: "auth_required" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("reports a generation read it could not perform as an outage, not as an absent run", async () => {
    const harness = stub({ generationRead: "unavailable" });
    const { response, body } = await assemble(harness);
    expect(response.status).toBe(503);
    expect(body.error).toEqual({ code: "store_unavailable" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });
  /**
   * The offline half of the disappear/reappear sequence the integration test
   * drives, kept here because it needs no database and it is the shape that
   * broke: `mergeGeoDraftV3` parses `next` as a whole payload, so a stored
   * decision naming an item the fresh run no longer produces made `next`
   * unparseable and turned this route into a permanent 422. Permanent, because
   * the offending generation stays the newest one -- the knowledge base could
   * never be assembled again.
   */
  it("survives a run that stops producing an item the owner already decided on", async () => {
    const grown: ResultOptions = {
      narrative: (value: Narrative) => ({
        ...value,
        scope: { ...value.scope, doesNot: [{ id: "scope:not", text: "Does not run offline.", sourceRefs: ["source:own"] }] },
      }),
      generationId: OTHER_GENERATION_ID,
    };
    const first = stub({ generation: succeededRecord(grown) });
    await assemble(first);
    const assembled = first.saveDraft.mock.calls[0]![0]!.payload;
    const doomed = geoV3Items(assembled.knowledge).find(
      (item) => item.module === "scope" && item.claims.some((claim) => claim.text.includes("Does not run offline")),
    );
    expect(doomed).toBeDefined();
    const itemKey = doomed!.itemKey;
    const reviewed = parseGeoKbPayloadV3({
      ...assembled,
      review: {
        decisions: [{
          itemKey,
          decision: "excluded",
          override: null,
          baseContentHash: geoV3ItemContentHashes(assembled.knowledge).get(itemKey)!,
          decidedAt: "2026-09-05T02:00:00.000Z",
          baseDraftVersion: "2",
        }],
        suppressions: [],
      },
    });

    // The default generation is the ungrown narrative: this run stops saying it.
    const second = stub({ payload: reviewed, draftVersion: 2 });
    const { response } = await assemble(second);

    expect(response.status).toBe(200);
    expect(second.saveDraft).toHaveBeenCalledTimes(1);
    const saved = second.saveDraft.mock.calls[0]![0]!.payload;
    expect(geoV3ItemKeys(saved.knowledge)).not.toContain(itemKey);
    // The decision goes with its item, but the exclusion outlives it -- that is
    // what stops a later run from handing the item back unnoticed.
    expect(saved.review.decisions.map((record) => record.itemKey)).not.toContain(itemKey);
    expect(saved.review.suppressions.map((record) => record.itemKey)).toContain(itemKey);
  });

  it("assembles when it cannot tell whether another kind is running", async () => {
    /**
     * "unavailable" is not "running". The knowledge record is read directly
     * below and refuses on its own claimed/dispatched states, so all this
     * predicate adds is a roles or questions run; an unreadable answer about
     * those must not strand a draft whose knowledge run has finished. The save
     * is compare-and-swap, so a run that lands underneath still loses. This is
     * the same choice `handleGeoKbV3Publish` makes, deliberately.
     */
    const blind = stub({ running: "unavailable" });
    const { response } = await assemble(blind);

    expect(response.status).toBe(200);
    expect(blind.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("refuses when the store reports saving bytes that are not the bytes it was handed", async () => {
    // A store that acknowledges a different content hash has not stored what
    // this response is about to describe, so the response would be a claim
    // about a draft that does not exist.
    const harness = stub({
      save: { kind: "ok", value: { draftVersion: 2, contentHash: "7".repeat(64), updatedAt: UPDATED_AT } },
    });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(503);
    expect(body.error).toEqual({ code: "store_unavailable" });
  });
});
