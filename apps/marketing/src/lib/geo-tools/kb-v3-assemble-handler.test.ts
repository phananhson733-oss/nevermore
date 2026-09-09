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
  TARGET_URL,
} from "./kb-knowledge-assemble.test-fixtures.ts";
import type { GeoEvidenceObservation } from "./kb-evidence-observations.ts";
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

const WEBSITE_ID = "55555555-5555-8555-8555-555555555555";
const RIVAL_URL = "https://rival.example/";
/** Six hours after the observations below, so both are still inside their TTL. */
const OBSERVED_NOW = new Date("2026-09-05T06:00:00.000Z");
const OWN_OBSERVED_AT = "2026-09-05T00:00:00.000Z";
const RIVAL_OBSERVED_AT = "2026-09-05T01:00:00.000Z";

/**
 * One row of the website evidence observation ledger, as a fetch operation of
 * the run wrote it. The default is the shape every knowledge base collected
 * before the run began reading machine resources still has: excerpts and a body
 * hash, with an empty `structured` -- no JSON-LD types, no hreflang locales, no
 * FAQ pairs -- and no `robots`/`sitemap`/`llms` row beside it.
 */
function observation(overrides: Partial<GeoEvidenceObservation> = {}): GeoEvidenceObservation {
  return {
    schemaVersion: "marketing-website-evidence-observation.v1",
    observationId: "66666666-6666-8666-8666-666666666666",
    websiteId: WEBSITE_ID,
    kind: "own_page",
    url: TARGET_URL,
    observedAt: OWN_OBSERVED_AT,
    status: {
      kind: "ok",
      bodyHash: "b".repeat(64),
      excerpts: ["Pine Cloud is project software for teams of 2. It requires human approval."],
      structured: {},
    },
    independence: null,
    ...overrides,
  };
}

function observationLibrary(rows: readonly GeoEvidenceObservation[]) {
  const byTarget = new Map<string, GeoEvidenceObservation>(rows.map((row) => [`${row.kind} ${row.url}`, row]));
  return {
    resolveWebsiteId: vi.fn(async () => ({ kind: "ok", websiteId: WEBSITE_ID }) as const),
    readLatestObservation: vi.fn(async (input: { readonly kind: string; readonly url: string }) =>
      ({ kind: "ok", value: byTarget.get(`${input.kind} ${input.url}`) ?? null }) as never),
    now: () => OBSERVED_NOW,
  };
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
  readonly observations?: GeoKbV3AssembleDependencies["observations"];
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
    ...(options.observations === undefined ? {} : { observations: options.observations }),
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

  it("says there is nothing to assemble when the knowledge step never ran and nothing was observed either", async () => {
    // No observation library wired, so there is no collection to fall back on
    // and the refusal is the one this route has always given.
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

/**
 * Section 4.2's other half: the modules that need no model.
 *
 * These are the states in which a v3 draft has a paid collection and no
 * narrative -- the model step has not run yet, or it ran and failed -- and the
 * question each case answers is whether the owner sees what was collected or an
 * empty card.
 */
describe("assembling the deterministic half from the collection alone", () => {
  function observed(options: StubOptions = {}) {
    return stub({
      generation: null,
      observations: observationLibrary([
        observation(),
        observation({
          observationId: "77777777-7777-8777-8777-777777777777",
          kind: "competitor_page",
          url: RIVAL_URL,
          observedAt: RIVAL_OBSERVED_AT,
          status: {
            kind: "ok",
            bodyHash: "c".repeat(64),
            excerpts: ["Rival supports teams of 5."],
            structured: {},
          },
        }),
      ]),
      ...options,
    });
  }

  /**
   * The three machine-readable resources, addressed at the site's own origin
   * exactly as the run's own-page operation addresses them, and the structure
   * that operation stores on the page's own row.
   */
  const ROBOTS_URL = `${TARGET_URL}robots.txt`;
  const SITEMAP_URL = `${TARGET_URL}sitemap.xml`;
  const LLMS_URL = `${TARGET_URL}llms.txt`;
  /** Later than the page and the competitor, so the newest row is a machine one. */
  const MACHINE_OBSERVED_AT = "2026-09-05T02:00:00.000Z";
  const SITEMAP_LOCATIONS = [TARGET_URL, `${TARGET_URL}pricing`];
  const OWN_STRUCTURED = {
    jsonLdTypes: ["Organization", "SoftwareApplication"],
    // Both spellings of the alternates, the way the collect executor writes
    // them: the bare list for anything that counts them, and the pairs because
    // the evidence contract's page shape refuses a locale with no URL.
    hreflangLocales: ["en", "zh-Hans"],
    hreflang: [
      { locale: "en", url: `${TARGET_URL}en` },
      { locale: "zh-Hans", url: `${TARGET_URL}zh-hans` },
    ],
    faqPairs: [{ question: "Does Pine Cloud require human approval?", answer: "Yes, every change waits for a person." }],
  };

  type ObservationStatus = GeoEvidenceObservation["status"];

  function observedWithMachine(options: StubOptions & {
    readonly structured?: Record<string, unknown>;
    readonly robots?: ObservationStatus;
    readonly sitemap?: ObservationStatus;
    readonly llms?: ObservationStatus;
    /** Which machine rows the run left behind. `[]` is a run that wrote none. */
    readonly machine?: readonly ("robots" | "sitemap" | "llms")[];
  } = {}) {
    const status: Readonly<Record<"robots" | "sitemap" | "llms", ObservationStatus>> = {
      robots: options.robots ?? { kind: "ok", bodyHash: "1".repeat(64), excerpts: ["User-agent: *", "Allow: /"], structured: {} },
      sitemap: options.sitemap
        ?? { kind: "ok", bodyHash: "5".repeat(64), excerpts: SITEMAP_LOCATIONS, structured: { sitemapUrlCount: "2" } },
      llms: options.llms ?? { kind: "unavailable", reason: "not_found" },
    };
    const address = { robots: ROBOTS_URL, sitemap: SITEMAP_URL, llms: LLMS_URL } as const;
    const kinds = options.machine ?? (["robots", "sitemap", "llms"] as const);
    return stub({
      generation: null,
      observations: observationLibrary([
        observation({ status: { kind: "ok", bodyHash: "b".repeat(64),
          excerpts: ["Pine Cloud is project software for teams of 2. It requires human approval."],
          structured: options.structured ?? OWN_STRUCTURED } }),
        observation({
          observationId: "77777777-7777-8777-8777-777777777777",
          kind: "competitor_page",
          url: RIVAL_URL,
          observedAt: RIVAL_OBSERVED_AT,
          status: { kind: "ok", bodyHash: "c".repeat(64), excerpts: ["Rival supports teams of 5."], structured: {} },
        }),
        ...kinds.map((kind, index) => observation({
          observationId: `9${index}999999-9999-8999-8999-999999999999`,
          kind,
          url: address[kind],
          observedAt: MACHINE_OBSERVED_AT,
          status: status[kind],
        })),
      ]),
      ...options,
    });
  }

  it("writes a body as soon as the collection is done, without waiting for the model", async () => {
    const harness = observed();
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(200);
    expect(harness.saveDraft).toHaveBeenCalledTimes(1);
    const saved = harness.saveDraft.mock.calls[0]![0]!.payload;
    // The condition publish refuses on, and the condition the card renders an
    // empty page for, are both `knowledge === null`. Neither holds any more.
    expect(saved.knowledge).not.toBeNull();
    const knowledge = saved.knowledge!;
    // What was actually read, quoted from the observation the run paid for.
    expect(knowledge.evidence.status).not.toBe("unavailable");
    const evidence = knowledge.evidence.status === "unavailable" ? null : knowledge.evidence.value;
    expect(evidence!.proof.map((item) => item.url)).toContain(TARGET_URL);
    expect(evidence!.proof[0]!.summary).toContain("Pine Cloud is project software");
    // The coverage skeleton: seven rows, one per module, saying which are here.
    expect(knowledge.coverage.status).toBe("partial");
    const coverage = knowledge.coverage.status === "unavailable" ? [] : knowledge.coverage.value;
    expect(coverage.map((row) => row.id)).toEqual([
      "coverage:entity", "coverage:facts", "coverage:qa", "coverage:comparisons",
      "coverage:scope", "coverage:evidence", "coverage:machine",
    ]);
    expect(coverage.find((row) => row.id === "coverage:evidence")?.status).not.toBe("missing");
    // No record was reused, so the draft names none -- and the save RPC's
    // generation-input lock, which the first non-null id arms, stays unarmed.
    expect(saved.runRef.knowledgeGenerationId).toBeNull();
    expect(body.data).toMatchObject({
      basis: "observed",
      knowledgeGenerationId: null,
      // The newest observation the bundle rests on, not a clock.
      assembledAt: RIVAL_OBSERVED_AT,
      changed: true,
    });
    // Both times in the body are that same recorded instant. A clock in either
    // would give two assemblies of one collection two different digests, and
    // the run assembles more than once.
    expect(knowledge.generatedAt).toBe(RIVAL_OBSERVED_AT);
    expect(knowledge.collectedAt).toBe(RIVAL_OBSERVED_AT);
  });

  it("reads the collection instead of the site: no fetch, no crawl allowance", async () => {
    /**
     * The guarantee is structural rather than a promise. The only reader this
     * path hands `collectGeoKnowledgeEvidenceV1` refuses every request, and that
     * function reaches the network through nothing else -- so the sources it
     * ends up with are exactly the observation rows below, and the machine
     * resources it would otherwise fetch come back as never looked at.
     */
    const harness = observed();
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const fetched = knowledge.sourceCatalogue.filter((source) => source.availability !== "unavailable");
    expect(fetched.map((source) => source.url).sort()).toEqual([TARGET_URL, RIVAL_URL].sort());
    // Every source that is not one of those two observations is recorded as not
    // collected -- never as absent, and never as unreachable.
    for (const source of knowledge.sourceCatalogue.filter((entry) => entry.availability === "unavailable")) {
      expect(source.reason).toBe("not_collected");
    }
  });

  it("says the machine-readable signals were not collected rather than that they are absent", async () => {
    /**
     * These rows are a collection that wrote none of it: no `robots`,
     * `sitemap` or `llms` row, and an own-page row whose `structured` is empty,
     * which is what every knowledge base collected before the run started
     * reading them looks like. The evidence contract can only say
     * `present | absent | unreachable` about a machine signal, so the module
     * built from this bundle would render "Not detected" about markup nothing
     * stored and "Could not be reached" about a file nothing requested. Both
     * are "we never looked" told as "we looked", so the module is withheld.
     */
    const harness = observed();
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "not_collected" });
    const coverage = knowledge.coverage.status === "unavailable" ? [] : knowledge.coverage.value;
    const row = coverage.find((entry) => entry.id === "coverage:machine")!;
    // And the coverage table agrees, with no basis to point at.
    expect(row.status).toBe("missing");
    expect(row.sourceRefs).toEqual([]);
  });

  it("keeps the deterministic modules when the model step then fails", async () => {
    const harness = observed({ generation: terminalRecord("failed") });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ basis: "observed", knowledgeGenerationId: null });
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    // The pages the run read are still on the card, quoted, after the model
    // step that would have interpreted them failed.
    const evidence = knowledge.evidence.status === "unavailable" ? null : knowledge.evidence.value;
    expect(evidence?.proof.map((item) => item.url)).toContain(TARGET_URL);
    expect(evidence?.proof[0]!.summary).toContain("Pine Cloud is project software");
    expect(knowledge.coverage.status).toBe("partial");
    /**
     * The modules that needed the narrative say so, with the reason section 4.2
     * names, and nothing is invented in their place.
     *
     * `facts` is `unavailable` here, not `partial`. The design (line 151) asks
     * for `partial` carrying owner-declared facts and observed FAQ pairs, and
     * `assembleGeoKnowledgeBodyV3` does not do that: with `narrative: null`
     * `factsModule` returns `unavailable` whatever the bundle holds. That gap
     * lives in a file this change does not own; asserting the truth here rather
     * than the design keeps the test from claiming a behaviour the product does
     * not have.
     *
     * `qa` is `unavailable` for a different reason, and only for these rows:
     * this fixture's own-page row stores no FAQ pairs. A row that carries them
     * puts the site's own questions in `qa` as `observed_own` items -- see
     * "asks the site's own questions, from the markup the run stored".
     */
    for (const module of [knowledge.entity, knowledge.facts, knowledge.qa, knowledge.comparisons, knowledge.scope]) {
      expect(module).toEqual({ status: "unavailable", reason: "generation_unavailable" });
    }
  });

  it("does not report a group nothing could have looked for as collected and empty", async () => {
    /**
     * A changelog item exists only where one of the pages the run READ carried a
     * link naming it, and a bundle whose sources all came out of the observation
     * ledger has no parsed page at all. Listed as collected, the card renders
     * the group as "Collected · nothing found" -- we looked, there is none --
     * about a group this mode cannot fill. Same rule as the machine module one
     * function above, applied where it also bites.
     */
    const harness = observed();
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const evidence = knowledge.evidence.status === "unavailable" ? null : knowledge.evidence.value;
    expect(evidence!.collected).toEqual(["proof"]);
    expect(knowledge.evidence.status).toBe("partial");
    const limitation = knowledge.evidence.status === "partial" ? knowledge.evidence.limitation : "";
    expect(limitation).toContain("changelog");
  });

  it("credits no competitor the run had no allowance to fetch", async () => {
    /**
     * Two declared competitors can sit behind one crawl allowance: the gate key
     * is the host with `www.` stripped, so `rival.example` and
     * `www.rival.example` are one budget and `planGeoRunCollection` admits only
     * the first. The second is never fetched by any operation of this run, so an
     * observation of it -- left over from another update, or written under the
     * other spelling -- is one this update has no right to claim. (The same
     * filter covers a competitor past the plan's five-per-run cap; the payload
     * contract happens to stop at five too, so that one is unreachable from a
     * draft today.)
     */
    const input = {
      ...generationInput(),
      competitors: [
        { domain: "rival.example", brandName: "Rival", confirmed: true },
        { domain: "www.rival.example", brandName: "Rival WWW", confirmed: true },
      ],
    };
    const base = emptyDraft();
    const payload = parseGeoKbPayloadV3({
      ...base,
      generationInput: input,
      runRef: { ...base.runRef, generationInputHash: geoV2Digest(input) },
    });
    const harness = stub({
      payload,
      generation: null,
      observations: observationLibrary([
        observation(),
        observation({
          observationId: "88888888-8888-8888-8888-888888888888",
          kind: "competitor_page",
          url: "https://www.rival.example/",
          observedAt: RIVAL_OBSERVED_AT,
          status: { kind: "ok", bodyHash: "d".repeat(64), excerpts: ["Rival WWW supports teams of 5."], structured: {} },
        }),
      ]),
    });

    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const read = knowledge.sourceCatalogue.filter((source) => source.availability !== "unavailable").map((source) => source.url);
    expect(read).toContain(TARGET_URL);
    expect(read).not.toContain("https://www.rival.example/");
    // And the row is not quietly asked for either: an unplanned target is never
    // looked up in the ledger at all.
    const asked = harness.dependencies.observations!.readLatestObservation as unknown as { readonly mock: { readonly calls: readonly (readonly [{ readonly url: string }])[] } };
    expect(asked.mock.calls.map(([call]) => call.url)).not.toContain("https://www.rival.example/");
  });

  it("lets no clock turn a resource nobody asked for into one that timed out", async () => {
    /**
     * The collector carries its own 70-second deadline, and the assembly pins
     * the clock it reads. Unpinned, a slow assembly can cross that deadline
     * mid-bundle and the resources this pass never requested come back as
     * `timeout` instead of `not_collected` -- "we asked and it took too long"
     * about a file nothing asked for, and two assemblies of one collection
     * disagreeing about it, which is a clock leaking into a content hash.
     */
    const clock = vi.spyOn(Date, "now");
    // Any real call jumps a full deadline past the first, so an unpinned
    // collector is over budget from its second read onwards.
    let reads = 0;
    clock.mockImplementation(() => { reads += 1; return reads === 1 ? 0 : 600_000; });
    try {
      const harness = observed();
      await assemble(harness);
      const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
      const missed = knowledge.sourceCatalogue.filter((source) => source.availability === "unavailable");
      expect(missed.length).toBeGreaterThan(0);
      for (const source of missed) expect(source.reason).toBe("not_collected");
    } finally {
      clock.mockRestore();
    }
  });

  it("still refuses to assemble an outcome nobody saw", async () => {
    // `uncertain` is a charge we cannot see. Filing a body for it would report
    // a run that may yet have an answer as one that produced this.
    const harness = observed({ generation: terminalRecord("uncertain") });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(422);
    expect(body.error).toEqual({ code: "outcome_unknown" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("writes exactly one version: a second call finds the half already there and refuses", async () => {
    /**
     * The observed body is written once. Asking again is the state above -- a
     * draft that already has a body and still has no narrative -- so the answer
     * is the refusal that names what is missing, and no second version is
     * written. A poller cannot churn the draft, and neither can a resumed run
     * whose model step has not produced a record yet.
     */
    const first = observed();
    await assemble(first);
    const saved = first.saveDraft.mock.calls[0]![0]!.payload;

    const second = observed({ payload: saved, draftVersion: 2 });
    const { response, body } = await assemble(second);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_missing" });
    expect(second.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses rather than replacing a body the owner has already decided on", async () => {
    /**
     * The observed body carries none of the items a narrative produces, and
     * `mergeGeoDraftV3` files a decision whose item is gone as `dropped` --
     * without carrying the record forward. Writing this body over an assembled
     * one would therefore delete every acceptance the owner had made, and the
     * next narrative assembly could not bring them back, because by then the
     * draft it merges over is the one whose review was already emptied.
     */
    const assembledHarness = stub();
    await assemble(assembledHarness);
    const assembled = assembledHarness.saveDraft.mock.calls[0]![0]!.payload;
    const keys = geoV3ItemKeys(assembled.knowledge);
    const hashes = geoV3ItemContentHashes(assembled.knowledge);
    const reviewed = parseGeoKbPayloadV3({
      ...assembled,
      review: {
        decisions: [{
          itemKey: keys[0]!,
          decision: "accepted",
          override: null,
          baseContentHash: hashes.get(keys[0]!)!,
          decidedAt: "2026-09-05T02:00:00.000Z",
          baseDraftVersion: "2",
        }],
        suppressions: [],
      },
    });

    for (const [generation, status, code] of [
      [null, 409, "generation_missing"],
      [terminalRecord("failed"), 422, "generation_failed"],
    ] as const) {
      const harness = observed({ payload: reviewed, draftVersion: 2, generation });
      const { response, body } = await assemble(harness);

      expect(response.status).toBe(status);
      expect(body.error).toEqual({ code });
      expect(harness.saveDraft).not.toHaveBeenCalled();
    }
  });

  it("refuses when no observation is fresh enough to stand in for a fetch", async () => {
    // Freshness is the same criterion the collection itself uses. An expired
    // row is the one a fetch was meant to supersede, and building a body on it
    // would date this update by evidence it had already replaced.
    const harness = observed({
      observations: observationLibrary([observation({ observedAt: "2026-09-01T00:00:00.000Z" })]),
    });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_missing" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses when the site's own page was never observed, competitors or not", async () => {
    // An update with no evidence about its own subject is not an update.
    const harness = observed({
      observations: observationLibrary([
        observation({
          observationId: "77777777-7777-8777-8777-777777777777",
          kind: "competitor_page",
          url: RIVAL_URL,
          observedAt: RIVAL_OBSERVED_AT,
          status: { kind: "ok", bodyHash: "c".repeat(64), excerpts: ["Rival supports teams of 5."], structured: {} },
        }),
      ]),
    });
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ code: "generation_missing" });
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("reports the machine-readable resources the run read, and the page structure it stored", async () => {
    /**
     * The run's own-page fetch operation reads `/robots.txt`, `/sitemap.xml`
     * and `/llms.txt` at the site's own origin and files one row each, and
     * stores what the page itself carries -- JSON-LD types, hreflang locales,
     * FAQ pairs -- on the page's own row. All of that is what the module below
     * is made of; none of it is fetched here.
     */
    const harness = observedWithMachine();
    const { response, body } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    // Partial, not available: `snippets` has no producer in this deployment and
    // the module says so rather than reporting six measured signals as seven.
    expect(knowledge.machine.status).toBe("partial");
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    expect(machine!.robots.status).toBe("present");
    // A 404 is the only way a machine file becomes "absent", and this one is one.
    expect(machine!.llms.status).toBe("absent");
    expect(machine!.sitemap).toMatchObject({ status: "present", urlCount: "2", knowledgePagesListed: true });
    expect(machine!.jsonLd).toMatchObject({ status: "present", types: ["Organization", "SoftwareApplication"] });
    // Reported from the pairs the row stored. This read `absent` for every site
    // with alternates until 2026-09-09, because the ledger kept the locales
    // without the URLs the page shape pairs them with and the only honest
    // reconstruction was an empty list.
    expect(machine!.hreflang).toMatchObject({ status: "present", locales: ["en", "zh-Hans"] });
    // Read out of the robots file the run stored, by the parser the crawler
    // gates its own fetches on.
    expect(machine!.aiCrawlers.search.map((row) => row.access)).toEqual(["allowed", "allowed", "allowed"]);
    // And the coverage table stops calling the section missing.
    const coverage = knowledge.coverage.status === "unavailable" ? [] : knowledge.coverage.value;
    const row = coverage.find((entry) => entry.id === "coverage:machine")!;
    expect(row.status).toBe("partial");
    expect(row.sourceRefs.length).toBeGreaterThan(0);
    expect(body.data).toMatchObject({ basis: "observed", knowledgeGenerationId: null });
  });

  it("asks the site's own questions, from the markup the run stored", async () => {
    // `qa` used to be `unavailable` here for a reason that has gone: the ledger
    // stored excerpts and no page structure, so there were no FAQ pairs to
    // carry. There are now, and they are the site's own words, not a model's.
    const harness = observedWithMachine();
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;

    expect(knowledge.qa.status).toBe("partial");
    const qa = knowledge.qa.status === "unavailable" ? [] : knowledge.qa.value;
    expect(qa.map((item) => item.question)).toEqual(["Does Pine Cloud require human approval?"]);
    expect(qa[0]!.origin).toBe("observed_own");
    expect(qa[0]!.directAnswer).toBe("Yes, every change waits for a person.");
    // The limitation says what is missing rather than implying the model ran.
    const limitation = knowledge.qa.status === "partial" ? knowledge.qa.limitation : "";
    expect(limitation).toContain("Model-synthesized");
  });

  it("still looks for no changelog it cannot have found", async () => {
    /**
     * The page this mode carries is rebuilt from a ledger row, and the row
     * stores no links -- so nothing here read the page's links, and the group
     * must stay off the collected list even though the bundle now has a page in
     * it. `collected` is what the card turns into "Collected, nothing found".
     */
    const harness = observedWithMachine();
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const evidence = knowledge.evidence.status === "unavailable" ? null : knowledge.evidence.value;
    expect(evidence!.collected).toEqual(["proof"]);
    const limitation = knowledge.evidence.status === "partial" ? knowledge.evidence.limitation : "";
    expect(limitation).toContain("changelog");
  });

  it("dates the body by the newest row it rests on, machine rows included", async () => {
    // The evidence contract refuses a source observed after the collection it
    // belongs to, so a machine row newer than the page is not only a reporting
    // detail: leaving it out of this maximum throws the bundle away.
    const harness = observedWithMachine();
    const { body } = await assemble(harness);
    expect(body.data).toMatchObject({ assembledAt: MACHINE_OBSERVED_AT });
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.collectedAt).toBe(MACHINE_OBSERVED_AT);
    expect(knowledge.generatedAt).toBe(MACHINE_OBSERVED_AT);
  });

  it("assembles the same rows into the same bytes, twice", async () => {
    // Content-idempotence, with the machine rows in: a second call finds the
    // body already there and refuses, and nothing about the first depended on a
    // clock this route read.
    const first = observedWithMachine();
    const one = await assemble(first);
    const saved = first.saveDraft.mock.calls[0]![0]!.payload;

    const second = observedWithMachine({ payload: saved, draftVersion: 2 });
    const two = await assemble(second);

    expect(two.response.status).toBe(409);
    expect(two.body.error).toEqual({ code: "generation_missing" });
    expect(second.saveDraft).not.toHaveBeenCalled();
    // The same rows, assembled again by a fresh handler, are the same bytes.
    const again = observedWithMachine();
    await assemble(again);
    expect(geoV2Digest(again.saveDraft.mock.calls[0]![0]!.payload)).toBe(geoV2Digest(saved));
    expect(one.body.data).toMatchObject({ changed: true });
  });

  it("opens no socket to read any of them", async () => {
    /**
     * The machine rows do not loosen the no-fetch guarantee. Two things hold it:
     * the collector reaches the network only through the reader it is handed,
     * and the reader this path hands it answers every address from the ledger or
     * refuses it. Nothing here builds a gated reader, so there is nothing to
     * spend a crawl allowance with -- and if that ever changed, the global fetch
     * below is the first thing it would reach for.
     */
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("the observed assembly must not fetch");
    });
    try {
      const harness = observedWithMachine();
      const { response } = await assemble(harness);
      expect(response.status).toBe(200);
      expect(fetched).not.toHaveBeenCalled();
      // And again with no machine row at all, which is the case that actually
      // reaches the reader: with all three rows credited or answered from the
      // ledger the collector asks it for nothing, so a reader that fetched
      // would go unnoticed here.
      const unread = observedWithMachine({ machine: [] });
      expect((await assemble(unread)).response.status).toBe(200);
      expect(fetched).not.toHaveBeenCalled();
      // Every address it asked the LEDGER for, and nothing else. The three
      // machine URLs are the site's own origin, spelled as the plan spells it.
      const asked = harness.dependencies.observations!.readLatestObservation as unknown as {
        readonly mock: { readonly calls: readonly (readonly [{ readonly kind: string; readonly url: string }])[] };
      };
      expect(asked.mock.calls.map(([call]) => `${call.kind} ${call.url}`)).toEqual([
        `own_page ${TARGET_URL}`,
        `competitor_page ${RIVAL_URL}`,
        `robots ${ROBOTS_URL}`,
        `sitemap ${SITEMAP_URL}`,
        `llms ${LLMS_URL}`,
      ]);
    } finally {
      fetched.mockRestore();
    }
  });

  it("keeps withholding the module when a resource has no row at all", async () => {
    /**
     * The rows ride the own page's 24 h reuse: an update that re-used a fresh
     * own-page observation sends no traffic and therefore writes no machine row,
     * and every knowledge base collected before the run started reading these
     * three is in that state until its own-page row expires. A missing row is
     * "we did not look", which is neither absent nor unreachable, so the module
     * is withheld whole rather than published with three unreachable signals.
     */
    const harness = observedWithMachine({ machine: [] });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "not_collected" });
    const coverage = knowledge.coverage.status === "unavailable" ? [] : knowledge.coverage.value;
    expect(coverage.find((entry) => entry.id === "coverage:machine")).toMatchObject({ status: "missing", sourceRefs: [] });
    // The page structure still lands: the two are separate observations.
    expect(knowledge.qa.status).toBe("partial");
  });

  it.each([
    ["robots", ["sitemap", "llms"]],
    ["sitemap", ["robots", "llms"]],
    ["llms", ["robots", "sitemap"]],
  ] as const)("withholds the whole module when the %s row alone is missing", async (_missing, present) => {
    /**
     * "Every signal rests on a row this run observed" has to hold per resource,
     * not just for the all-missing case. A resource with no row reaches the
     * collector's never-fetch reader, comes back `not_collected`, and
     * `machineStatus()` renders that as "Could not be reached" -- a sentence
     * about a file nobody asked for, published beside two that were read.
     */
    const harness = observedWithMachine({ machine: present });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "not_collected" });
  });

  it("refuses a robots.txt whose stored sample it cannot read back whole", async () => {
    /**
     * robots.txt is parsed, not quoted: the assembler reads per-agent
     * allow/disallow claims out of these lines, and its only guard against
     * claiming from a partial file is that a full sample (eight lines) is
     * treated as possibly truncated. Silently dropping one unreadable line
     * shortens the sample below that threshold, so the file looks complete with
     * a rule missing -- and "this site does not mention GPTBot" becomes a
     * sentence about a line we threw away.
     */
    const harness = observedWithMachine({
      robots: { kind: "ok", bodyHash: "1".repeat(64), structured: {},
        excerpts: ["User-agent: *", "Disallow: /private\u0007", "Allow: /"] },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "not_collected" });
  });

  /**
   * The production defect of 2026-09-09: EVERY owner was told "AI crawler
   * permissions were not determined: robots.txt was not read in full".
   *
   * The ledger caps excerpts at eight and the assembler correctly refuses to
   * answer a permission question from a sample it must assume is truncated --
   * and every real robots.txt has more than eight lines. astrologywiki.com's
   * has fifty. `robotsRules` existed for exactly this, with a schema and a
   * 256-rule cap, and had no producer at all.
   */
  it("answers crawler permissions from the whole robots.txt the run stored", async () => {
    const rules = [
      "User-agent: *", "Allow: /", "Allow: /wiki", "Allow: /wiki/classics",
      "Allow: /privacy", "Allow: /terms", "Allow: /cookies", "Allow: /about",
      "User-agent: GPTBot", "Disallow: /",
    ];
    const harness = observedWithMachine({
      robots: { kind: "ok", bodyHash: "1".repeat(64), structured: { robotsRules: rules },
        excerpts: rules.slice(0, 8) },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    // Read past the eighth line: the GPTBot group is the ninth and tenth.
    const gptbot = machine!.aiCrawlers.training.concat(machine!.aiCrawlers.search)
      .find((row) => row.agent === "GPTBot");
    expect(gptbot?.access).toBe("disallowed");
    expect(machine!.aiCrawlers.search.some((row) => row.access === "allowed")).toBe(true);
  });

  it("still says nothing about crawlers when the run kept only a sample", async () => {
    // A row from before `robotsRules` had a producer, or one whose file the
    // ledger could not take whole. Eight excerpts and no rules is exactly the
    // truncated sample the refusal exists for, and it must keep refusing.
    const harness = observedWithMachine({
      robots: { kind: "ok", bodyHash: "1".repeat(64), structured: {},
        excerpts: ["User-agent: *", "Allow: /", "Allow: /a", "Allow: /b", "Allow: /c", "Allow: /d", "Allow: /e", "Allow: /f"] },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    expect(machine!.aiCrawlers.search).toEqual([]);
    expect(machine!.aiCrawlers.training).toEqual([]);
  });

  it("keeps the deterministic half for a page with more FAQ pairs than the shape carries", async () => {
    /**
     * The bundle's page shape holds 32 FAQ pairs. Handing it more makes
     * `buildGeoKnowledgeEvidenceV1` throw, and the catch around it turns that
     * into no deterministic half at all -- an FAQ-rich site losing its whole
     * card to a cap nobody mentions. Bounded instead: the owner sees the pairs
     * that fit.
     */
    const harness = observedWithMachine({
      structured: {
        ...OWN_STRUCTURED,
        faqPairs: Array.from({ length: 40 }, (_value, index) => ({
          question: `Question number ${index}?`,
          answer: `Answer number ${index}.`,
        })),
      },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.qa.status).toBe("partial");
    const qa = knowledge.qa.status === "unavailable" ? [] : knowledge.qa.value;
    expect(qa.length).toBeGreaterThan(0);
    expect(qa.length).toBeLessThanOrEqual(32);
  });

  it("withholds the module rather than publishing a page structure it never stored", async () => {
    // A row written before the run recorded page structure carries no
    // `jsonLdTypes` key. An empty list would say "this page publishes no
    // JSON-LD"; the absence of the key says nothing at all, and so does the card.
    const harness = observedWithMachine({
      structured: { faqPairs: [{ question: "Is it audited?", answer: "Yes, by a person." }] },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "not_collected" });
  });

  it("publishes the sitemap's own total beside the sample, never the sample as the total", async () => {
    /**
     * The ledger keeps at most eight `<loc>` values and the document's own
     * total beside them. This used to withhold the whole machine module,
     * because the evidence contract tied the published count to the list of
     * locations carried and "2 URLs" about a sitemap of 900 is the sentence
     * this route exists to refuse -- so a site with a large sitemap lost every
     * machine signal, not just the count.
     *
     * The count and the sample are separate facts now: `truncated` says the
     * locations are a sample, and the count is the one the run measured off
     * the whole document.
     */
    const harness = observedWithMachine({
      sitemap: { kind: "ok", bodyHash: "5".repeat(64), excerpts: SITEMAP_LOCATIONS, structured: { sitemapUrlCount: "900" } },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    expect(machine!.sitemap).toMatchObject({ status: "present", urlCount: "900" });
  });

  /**
   * The assembler rebuilds `knowledgePagesListed` itself and the contract
   * recomputes it; if the two disagree the builder throws and the catch around
   * it returns null -- the whole deterministic half lost, silently. They
   * disagreed the moment the collector started accepting the site's other
   * spelling of its own host, because this side still compared raw strings.
   */
  it("agrees with the contract about a sitemap that lists the site's www spelling", async () => {
    const harness = observedWithMachine({
      sitemap: { kind: "ok", bodyHash: "5".repeat(64),
        excerpts: [`https://www.product.example/`, `https://www.product.example/pricing`],
        structured: { sitemapUrlCount: "2" } },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    expect(machine).not.toBeNull();
    expect(machine!.sitemap).toMatchObject({ status: "present", urlCount: "2", knowledgePagesListed: true });
  });

  it("withholds rather than reporting a sitemap index as a page count", async () => {
    // A `<sitemapindex>` lists sitemaps, not pages, so the run stores no total
    // for it. There is nothing to publish a count from and nothing is invented.
    const harness = observedWithMachine({
      sitemap: { kind: "ok", bodyHash: "5".repeat(64), excerpts: SITEMAP_LOCATIONS, structured: {} },
    });
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "insufficient_evidence" });
  });

  it("withholds rather than reporting hreflang it cannot carry as absent", async () => {
    /**
     * A row written before the alternates were stored as PAIRS: it kept the
     * locale list and no URLs, and the evidence contract's page shape pairs
     * every locale with the URL it points at. Carrying the page without them
     * would report `hreflang` absent about a site publishing two alternates,
     * so the module is withheld instead.
     *
     * Every row written from 2026-09-09 on carries `hreflang`, so this is the
     * legacy shape and it self-heals the next time the page is read -- but for
     * as long as such a row can be credited, the withholding is what stops it
     * from becoming a false negative.
     */
    const harness = observedWithMachine({
      structured: { jsonLdTypes: ["Organization"], hreflangLocales: ["en", "zh-Hans"], faqPairs: [] },
    });
    const { response } = await assemble(harness);

    expect(response.status).toBe(200);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    expect(knowledge.machine).toEqual({ status: "unavailable", reason: "insufficient_evidence" });
  });

  it("tells a file it could not read from one that is not there", async () => {
    /**
     * `not_found` and `not_published` are the only two reasons that may render
     * as absent. A fetch that failed is `unreachable` -- "we could not read it"
     * -- and the module still publishes, because the reader is looking at a row
     * this run really wrote rather than at a resource nobody asked for.
     */
    const harness = observedWithMachine({
      robots: { kind: "unavailable", reason: "fetch_failed" },
      llms: { kind: "unavailable", reason: "not_published" },
    });
    await assemble(harness);
    const knowledge = harness.saveDraft.mock.calls[0]![0]!.payload.knowledge!;
    const machine = knowledge.machine.status === "unavailable" ? null : knowledge.machine.value;
    expect(machine!.robots.status).toBe("unreachable");
    expect(machine!.llms.status).toBe("absent");
    // Nothing was determined about the crawlers, and the module says which one
    // of the three possible reasons it was.
    expect(machine!.aiCrawlers.search.map((row) => row.access)).toEqual([]);
    const limitation = knowledge.machine.status === "partial" ? knowledge.machine.limitation : "";
    expect(limitation).toContain("robots.txt could not be read");
  });

  it("hands the narrative assembly a draft the merge can still complete", async () => {
    // The observed body is an intermediate state, not a wall: the model step
    // that follows assembles over it and leaves exactly the draft a run whose
    // deterministic half had never been written would have produced.
    const first = observed();
    await assemble(first);
    const half = first.saveDraft.mock.calls[0]![0]!.payload;

    const second = observed({ payload: half, draftVersion: 2, generation: succeededRecord() });
    const { response, body } = await assemble(second);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ basis: "generation", knowledgeGenerationId: GENERATION_ID });
    const full = second.saveDraft.mock.calls[0]![0]!.payload;
    expect(full.knowledge).toEqual(expectedKnowledge());
    expect(full.runRef.knowledgeGenerationId).toBe(GENERATION_ID);

    // And re-running that assembly writes nothing.
    const third = observed({ payload: full, draftVersion: 3, generation: succeededRecord() });
    const again = await assemble(third);
    expect(again.response.status).toBe(200);
    expect(third.saveDraft).not.toHaveBeenCalled();
    expect(again.body.data).toMatchObject({ draftVersion: 3, changed: false });
  });
});
