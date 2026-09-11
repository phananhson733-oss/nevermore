// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { geoV3ItemContentHashes, geoV3RestatedItemKeys } from "../../lib/geo-tools/kb-v3-item-content.ts";
import {
  applyGeoV3ReviewAction,
  applyGeoV3ReviewActions,
  geoV3DecisionStates,
  materializeGeoV3Review,
  type GeoV3ReviewAction,
} from "../../lib/geo-tools/kb-v3-review.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import {
  completePayloadV3,
  FACT_KEY_PRO,
  FACT_KEY_TEAM,
  QA_KEY,
  V3_KB_ID,
} from "../../lib/geo-tools/kb-v3.test-fixtures.ts";
import type { GeoKbEditorViewV3 } from "./geo-kb-v3-wire.ts";
import { createGeoKbV3Draft, geoKbV3DraftBlockers, GEO_KB_EDITOR_V3_SCHEMA_VERSION, GEO_KB_V3_AUTOSAVE_MS,
  GEO_KB_V3_AUTOSAVE_RETRY_MS, lookupGeoKbV3Competitor, parseGeoKbEditorViewV3, relockGeoKbV3Draft, useGeoKbV3Editor,
  writeGeoKbV3Competitor } from "./use-geo-kb-v3-editor.ts";
import {
  buildGeoKbV3Identity,
  GEO_ABSENT_EVIDENCE_CONTENT_HASH,
  lockGeoKbV3GenerationInput,
} from "../../lib/geo-tools/kb-v3-draft-create.ts";
import {
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../../lib/account-websites/contracts.ts";

const NOW = "2026-09-07T12:00:00.000Z";
let host: HTMLDivElement, root: Root, editor: ReturnType<typeof useGeoKbV3Editor>;

function lockedPayload(): GeoKbPayloadV3 {
  const base = completePayloadV3();
  return parseGeoKbPayloadV3({ ...base, runRef: { ...base.runRef, generationInputHash: geoV2Digest(base.generationInput) } });
}

const PAYLOAD = lockedPayload();
const ITEM_KEYS = geoV3ItemKeys(PAYLOAD.knowledge);

function view(overrides: Partial<GeoKbEditorViewV3> = {}): GeoKbEditorViewV3 {
  return {
    kbId: V3_KB_ID, host: "example.com", draftVersion: 4, draftHash: geoV2Digest(PAYLOAD),
    payload: PAYLOAD, published: null,
    // Derived from the payload rather than hardcoded to [], so a test that
    // builds a restated payload gets the flag the server would have sent.
    restated: geoV3RestatedItemKeys(PAYLOAD.knowledge, PAYLOAD.review), ...overrides,
  };
}

/** The server's own answer, produced by the same pure functions the route uses. */
function savedReview(payload: GeoKbPayloadV3, actions: readonly GeoV3ReviewAction[], draftVersion: number) {
  const states = applyGeoV3ReviewActions(geoV3DecisionStates(payload.review, ITEM_KEYS), actions);
  const review = materializeGeoV3Review(payload.review, states, {
    contentHash: geoV3ItemContentHashes(payload.knowledge), decidedAt: NOW, baseDraftVersion: String(draftVersion),
  });
  const next = parseGeoKbPayloadV3({ ...payload, review });
  return { review, data: { draftVersion: draftVersion + 1, contentHash: geoV2Digest(next), updatedAt: NOW, review,
    restated: geoV3RestatedItemKeys(next.knowledge, review),
    counts: { total: ITEM_KEYS.length, accepted: 0, acceptedInBulk: 0, excluded: 0, pending: 0, corrected: 0 } } };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({ initialView }: { readonly initialView: GeoKbEditorViewV3 }) {
  editor = useGeoKbV3Editor({ initialView });
  return <span>{editor.dirty ? "dirty" : "settled"}</span>;
}
async function mount(initialView = view()) {
  await act(async () => root.render(<Harness initialView={initialView} />));
}
const calls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
const bodyOf = (index: number) => JSON.parse(String((calls()[index]![1] as RequestInit).body));
async function settle(ms = GEO_KB_V3_AUTOSAVE_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

it("waits for the debounce and then sends one write for the whole batch", async () => {
  const saved = savedReview(PAYLOAD, [{ kind: "accept", itemKey: FACT_KEY_PRO }, { kind: "exclude", itemKey: QA_KEY }], 4);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: saved.data }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await act(async () => { editor.exclude(QA_KEY); });
  expect(calls()).toHaveLength(0);
  await settle();
  expect(calls()).toHaveLength(1);
  expect(calls()[0]![0]).toBe("/api/tools/geo-knowledge-base/v3/review");
  expect(bodyOf(0).actions).toEqual([{ kind: "accept", itemKey: FACT_KEY_PRO }, { kind: "exclude", itemKey: QA_KEY }]);
  expect(editor.dirty).toBe(false);
  expect(editor.view.draftVersion).toBe(5);
});

it("sends the version and the locked input hash, and nothing else about the draft", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: savedReview(PAYLOAD, [{ kind: "accept", itemKey: FACT_KEY_PRO }], 4).data }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  // The request has no field for `generationInput` or `knowledge`: an edit
  // cannot change the identity of a paid generation because there is nowhere
  // to say so.
  expect(Object.keys(bodyOf(0)).sort()).toEqual(["actions", "baseVersion", "expectedGenerationInputHash", "kbId"]);
  expect(bodyOf(0).baseVersion).toBe(4);
  expect(bodyOf(0).expectedGenerationInputHash).toBe(PAYLOAD.runRef.generationInputHash);
});

it("shows 全部接受 as accepted before the server answers", async () => {
  const saved = savedReview(PAYLOAD, [{ kind: "accept_all", itemKeys: ITEM_KEYS }], 4);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: saved.data }));
  await mount();
  await act(async () => { editor.acceptAll(ITEM_KEYS); });
  // Optimistic and settled state are produced by the same function, so the row
  // cannot read one way for 900 ms and then change its mind.
  expect([...editor.states.values()].map((state) => state.decision)).toEqual(ITEM_KEYS.map(() => "accepted"));
  await settle();
  expect(bodyOf(0).actions).toEqual([{ kind: "accept_all", itemKeys: ITEM_KEYS }]);
  expect([...editor.states.values()].some((state) => state.decision === "accepted_in_bulk")).toBe(false);
});

it("does not write when a gesture reaches nothing", async () => {
  await mount();
  // Every item is pending, so accepting-all twice is one gesture and one no-op.
  await act(async () => { editor.acceptAll(ITEM_KEYS); });
  const queuedOnce = editor.dirty;
  await act(async () => { editor.acceptAll(ITEM_KEYS); });
  expect(queuedOnce).toBe(true);
  const saved = savedReview(PAYLOAD, [{ kind: "accept_all", itemKeys: ITEM_KEYS }], 4);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: saved.data }));
  await settle();
  expect(bodyOf(0).actions).toHaveLength(1);
});

it("surfaces a conflict, holds every automatic write, and overwrites nothing", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  expect(editor.status).toEqual({ kind: "error", code: "conflict" });
  expect(editor.autosaveHold).toBe("conflict");
  expect(editor.conflictVersion).toBe(9);
  // The gesture is still unsaved and no second write is attempted: the draft on
  // the server belongs to whoever won, and the knowledge under it may have
  // been replaced by a run.
  expect(editor.dirty).toBe(true);
  await act(async () => { editor.accept(FACT_KEY_TEAM); });
  await settle(GEO_KB_V3_AUTOSAVE_MS * 4);
  expect(calls()).toHaveLength(1);
});

it("holds and retries on a slower beat while a run is writing the draft", async () => {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue(Response.json({ error: { code: "generation_running" } }, { status: 409 }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  expect(calls()).toHaveLength(1);
  expect(editor.autosaveHold).toBe("running");
  // Not a failure: the run ends on its own, so the write is retried rather
  // than being marked failed (which would suppress the retry).
  fetchMock.mockResolvedValue(Response.json({ data: savedReview(PAYLOAD, [{ kind: "accept", itemKey: FACT_KEY_PRO }], 4).data }));
  await settle(GEO_KB_V3_AUTOSAVE_RETRY_MS);
  expect(calls()).toHaveLength(2);
  expect(editor.dirty).toBe(false);
});

it("stops retrying a refusal the owner cannot see past until they act again", async () => {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  expect(editor.autosaveHold).toBe("failed");
  await settle(GEO_KB_V3_AUTOSAVE_MS * 5);
  // Autosave runs on a fixed cadence; a self-re-arming failure would spend the
  // owner's own hourly budget for as long as the tab stays open.
  expect(calls()).toHaveLength(1);
  fetchMock.mockResolvedValue(Response.json({ data: savedReview(PAYLOAD, [{ kind: "accept", itemKey: FACT_KEY_PRO }, { kind: "accept", itemKey: FACT_KEY_TEAM }], 4).data }));
  await act(async () => { editor.accept(FACT_KEY_TEAM); });
  await settle();
  expect(calls()).toHaveLength(2);
});

it("refuses to keep writing once a run relocked the generation input", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code: "input_changed" } }, { status: 409 }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  expect(editor.autosaveHold).toBe("inputChanged");
  await act(async () => { editor.exclude(QA_KEY); });
  await settle(GEO_KB_V3_AUTOSAVE_MS * 4);
  expect(calls()).toHaveLength(1);
});

it("flushes unsaved gestures before publishing", async () => {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const saved = savedReview(PAYLOAD, [{ kind: "accept", itemKey: FACT_KEY_PRO }], 4);
  const swept = applyGeoV3ReviewAction(geoV3DecisionStates(saved.review, ITEM_KEYS), { kind: "accept_all", itemKeys: ITEM_KEYS });
  fetchMock.mockResolvedValueOnce(Response.json({ data: saved.data }));
  fetchMock.mockResolvedValueOnce(Response.json({ data: {
    snapshotId: "44444444-4444-8444-8444-444444444444", revision: 4, contentHash: "b".repeat(64), frozenAt: NOW,
    reusedExisting: false, draftVersion: 6, draftHash: "c".repeat(64),
    bulkAccepted: ITEM_KEYS.length - 1,
    counts: { total: ITEM_KEYS.length, accepted: 1, acceptedInBulk: ITEM_KEYS.length - 1, excluded: 0, pending: 0, corrected: 0 },
    questionSet: { status: "unavailable", reason: "not_attempted" },
  } }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await act(async () => { await editor.publish(); });
  // A version assembled from a draft the owner has since changed would publish
  // decisions nobody made, so the queued gesture goes first.
  expect(calls().map((call) => call[0])).toEqual(["/api/tools/geo-knowledge-base/v3/review", "/api/tools/geo-knowledge-base/v3/publish"]);
  expect(bodyOf(1)).toEqual({ kbId: V3_KB_ID, baseVersion: 5, draftHash: saved.data.contentHash });
  expect(editor.published?.revision).toBe(4);
  // The card must stop offering to publish what it just published.
  expect(editor.publishPlan.pendingCount).toBe(0);
  expect([...editor.states].map(([key, state]) => [key, state.decision]))
    .toEqual([...swept].map(([key, state]) => [key, state.decision]));
  // Every item is accepted afterwards: one the owner pressed, the rest swept
  // by publishing on their behalf.
  expect([...editor.states.values()].filter((state) => state.decision === "accepted")).toHaveLength(ITEM_KEYS.length);
});

it("treats a publish that swept a different number of items as a conflict", async () => {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue(Response.json({ data: {
    snapshotId: "44444444-4444-8444-8444-444444444444", revision: 4, contentHash: "b".repeat(64), frozenAt: NOW,
    reusedExisting: false, draftVersion: 5, draftHash: "c".repeat(64),
    // The server swept one item; this view believes every item is pending.
    bulkAccepted: 1,
    counts: { total: ITEM_KEYS.length, accepted: 0, acceptedInBulk: 1, excluded: 0, pending: ITEM_KEYS.length - 1, corrected: 0 },
    questionSet: { status: "available" },
  } }));
  await mount();
  await act(async () => { await editor.publish(); });
  // Replaying the sweep locally is only honest if the two agree; when they do
  // not, this view is not what was published.
  expect(editor.status).toEqual({ kind: "error", code: "conflict" });
  expect(editor.published).toBeNull();
});

it("stops counting changes against the version it has just published", async () => {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue(Response.json({ data: {
    snapshotId: "44444444-4444-8444-8444-444444444444", revision: 1, contentHash: "b".repeat(64), frozenAt: NOW,
    reusedExisting: false, draftVersion: 5, draftHash: "c".repeat(64),
    bulkAccepted: ITEM_KEYS.length,
    counts: { total: ITEM_KEYS.length, accepted: 0, acceptedInBulk: ITEM_KEYS.length, excluded: 0, pending: 0, corrected: 0 },
    questionSet: { status: "available" },
  } }));
  await mount();
  expect(editor.publishPlan).toMatchObject({ nextVersion: "1", previousVersion: null, changeCount: 0 });

  await act(async () => { await editor.publish(); });

  // The box now names kb@v1 as the version to compare against. Reading the
  // baseline from a map captured at mount left the two halves of that sentence
  // describing different versions, so the card announced "N changes compared
  // with kb@v1" the instant kb@v1 came into being.
  expect(editor.publishPlan.previousVersion).toBe("1");
  expect(editor.publishPlan.changeCount).toBe(0);

  // And a decision made afterwards counts again, which is the property the
  // captured baseline was there to protect and did not need to be.
  await act(async () => { editor.exclude(FACT_KEY_PRO); });
  expect(editor.publishPlan.changeCount).toBe(1);
});

/**
 * A v1/v2 predecessor records no per-item decisions. Diffing against an empty
 * map would report every decided item as a change against a version that never
 * recorded any -- the exact sentence the publish box must not say -- so there is
 * no count at all rather than a wrong one.
 */
it("gives no change count at all when the published version records no decisions", async () => {
  await mount(view({ published: { kind: "opaque", revision: 3, frozenAt: NOW, contentHash: "b".repeat(64) } }));

  expect(editor.publishPlan).toMatchObject({ nextVersion: "4", previousVersion: "3", itemCount: ITEM_KEYS.length });
  expect(editor.publishPlan.changeCount).toBeNull();

  // And it stays null after the owner decides something: deciding cannot make
  // an uncomparable version comparable.
  await act(async () => { editor.accept(ITEM_KEYS[0]!); });
  expect(editor.publishPlan.changeCount).toBeNull();
});

it("counts the changes against the published version rather than against this session", async () => {
  await mount(view({
    published: { kind: "comparable", revision: 3, frozenAt: NOW, contentHash: "b".repeat(64), decisions: Object.fromEntries(ITEM_KEYS.map((key) => [key, "accepted_in_bulk" as const])) },
  }));
  expect(editor.publishPlan).toMatchObject({ nextVersion: "4", previousVersion: "3", itemCount: ITEM_KEYS.length, pendingCount: ITEM_KEYS.length });
  // Every item is pending in the draft and accepted in the published version,
  // so every item differs -- and none of that happened in this session.
  expect(editor.publishPlan.changeCount).toBe(ITEM_KEYS.length);
  // kb@v3 was published with the retired `accepted_in_bulk` label, which means
  // exactly what `accepted` means. Accepting the module here therefore changes
  // nothing relative to it; comparing the raw strings would report all five
  // items as changed and the count would never reach zero for such a version.
  await act(async () => { editor.acceptAll(ITEM_KEYS); });
  expect(editor.publishPlan.changeCount).toBe(0);
});

/* ------------------------------------------------------------------ */
/* Creating the first draft, and reading a loaded one                   */
/* ------------------------------------------------------------------ */

const CREATED = {
  kbId: V3_KB_ID, draftVersion: 1, contentHash: "c".repeat(64), updatedAt: NOW,
  generationInputHash: "e".repeat(64), blockers: [],
};

it("asks the create route for a first draft at version zero, naming nothing else", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: CREATED }));
  const result = await createGeoKbV3Draft(V3_KB_ID);
  expect(result).toEqual({ ok: true, draft: CREATED });
  expect(calls()[0]![0]).toBe("/api/tools/geo-knowledge-base/v3/draft");
  // Every value in the locked half is derived on the server. A create that sent
  // a version of its own would be a create that overwrote another tab's draft.
  expect(bodyOf(0)).toEqual({ kbId: V3_KB_ID, baseVersion: 0 });
});

it("keeps an unrecognised blocker rather than reporting a draft with none", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: { ...CREATED, blockers: ["category_terms_missing", "a_reason_this_build_predates"] } }));
  const result = await createGeoKbV3Draft(V3_KB_ID);
  expect(result).toMatchObject({ ok: true, draft: { blockers: ["category_terms_missing", "a_reason_this_build_predates"] } });
});

it("refuses a created draft reported under another knowledge base's id", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: { ...CREATED, kbId: "11111111-1111-8111-8111-1111111111ff" } }));
  expect(await createGeoKbV3Draft(V3_KB_ID)).toEqual({ ok: false, code: "bad_response" });
});

it.each([
  ["draft_exists", 409, 6],
  ["legacy_draft", 409, 2],
])("surfaces %s with the draft version the server holds", async (code, status, draftVersion) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code }, draftVersion }, { status }));
  expect(await createGeoKbV3Draft(V3_KB_ID)).toEqual({ ok: false, code, draftVersion });
});

const WIRE = {
  schemaVersion: GEO_KB_EDITOR_V3_SCHEMA_VERSION, kbId: V3_KB_ID, origin: "https://example.com",
  host: "example.com", draftVersion: 4, draftHash: geoV2Digest(PAYLOAD),
  payload: JSON.parse(JSON.stringify(PAYLOAD)) as unknown, published: null,
  restated: geoV3RestatedItemKeys(PAYLOAD.knowledge, PAYLOAD.review),
};

it("reads a loaded v3 draft off the wire, payload and all", async () => {
  const parsed = parseGeoKbEditorViewV3(WIRE);
  expect(parsed).not.toBeNull();
  expect(parsed?.payload).toEqual(PAYLOAD);
  expect(parsed?.published).toBeNull();
});

it.each([
  ["a draft version of zero, which no compare-and-swap could ever match", { draftVersion: 0 }],
  ["a payload that is not a complete v3 payload", { payload: { ...PAYLOAD, knowledge: { facts: "not a module" } } }],
  ["another editor contract's schema version", { schemaVersion: "marketing-geo-kb-editor.v2" }],
  ["a published block with no decisions at all", { published: { revision: 3, frozenAt: NOW, contentHash: "d".repeat(64) } }],
])("refuses a wire view carrying %s", (_why, overrides) => {
  expect(parseGeoKbEditorViewV3({ ...WIRE, ...overrides })).toBeNull();
});

it("keeps the published decision baseline it was handed", () => {
  const comparable = { kind: "comparable" as const, revision: 3, frozenAt: NOW, contentHash: "d".repeat(64), decisions: { [FACT_KEY_PRO]: "excluded" } };
  expect(parseGeoKbEditorViewV3({ ...WIRE, published: comparable })?.published).toEqual(comparable);

  // The other half of the union: a v1/v2 predecessor, named and dated with no
  // decision map. It has to survive the wire, because refusing it here is the
  // 503 that made the redesign unreachable for every owner who ever published.
  const opaque = { kind: "opaque" as const, revision: 3, frozenAt: NOW, contentHash: "d".repeat(64) };
  expect(parseGeoKbEditorViewV3({ ...WIRE, published: opaque })?.published).toEqual(opaque);
  // Neither shape may borrow the other's fields.
  expect(parseGeoKbEditorViewV3({ ...WIRE, published: { ...opaque, decisions: {} } })).toBeNull();
  expect(parseGeoKbEditorViewV3({ ...WIRE, published: { revision: 3, frozenAt: NOW, contentHash: "d".repeat(64), decisions: {} } })).toBeNull();
});

/* ------------------------------------------------------------------ */
/* Re-locking a draft whose Profile revision moved                      */
/* ------------------------------------------------------------------ */

const RELOCK_SHARED = {
  kbId: V3_KB_ID,
  draftVersion: 9,
  contentHash: "d".repeat(64),
  updatedAt: NOW,
  generationInputHash: "f".repeat(64),
  profileRef: { snapshotId: "22222222-2222-8222-8222-222222222222", snapshotRevision: "7" },
};
const RELOCKED = {
  ...RELOCK_SHARED,
  relocked: true,
  blockers: [],
  discarded: { knowledge: true, decisions: 3, suppressions: 1, roles: 2, released: ["knowledgeGenerationId", "runId"] },
};
const UNCHANGED = { ...RELOCK_SHARED, relocked: false };
const STORED_HASH = "a".repeat(64);

it("names its own intent and the exact draft it is about to discard", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: RELOCKED }));

  await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH });

  expect(calls()[0]![0]).toBe("/api/tools/geo-knowledge-base/v3/draft");
  // `intent` is what tells a destructive re-lock apart from a create, and
  // `draftHash` is the acknowledgement -- only a caller that was shown the
  // draft can produce the digest of the draft it is discarding. A body missing
  // either one is a different request than the owner agreed to.
  expect(bodyOf(0)).toEqual({ kbId: V3_KB_ID, intent: "relock", baseVersion: 9, draftHash: STORED_HASH });
});

it("reads a no-op as a no-op, never as a rebuild that happened to destroy nothing", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: UNCHANGED }));

  const result = await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH });

  expect(result).toEqual({ ok: true, relock: UNCHANGED });
  // The absence is the fact. A `discarded` of zeros on this arm would be
  // indistinguishable from a re-lock that ran and destroyed nothing, and those
  // are different things to tell an owner about their paid work. Likewise an
  // empty `blockers` would say a rebuilt input had been checked and found
  // clear, when nothing was built at all.
  expect(result.ok && Object.hasOwn(result.relock, "discarded")).toBe(false);
  expect(result.ok && Object.hasOwn(result.relock, "blockers")).toBe(false);
});

it("reads the rebuild's own account of what it destroyed", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: RELOCKED }));

  const result = await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH });

  expect(result).toEqual({ ok: true, relock: RELOCKED });
});

it.each([
  ["a rebuild with no account of what it destroyed", { ...RELOCK_SHARED, relocked: true, blockers: [] }],
  ["a rebuild with no blocker list", { ...RELOCK_SHARED, relocked: true, discarded: RELOCKED.discarded }],
  ["a negative count of discarded decisions", { ...RELOCKED, discarded: { ...RELOCKED.discarded, decisions: -1 } }],
  ["a no-op carrying a discard record", { ...UNCHANGED, discarded: RELOCKED.discarded }],
  ["a Profile revision that is not a revision", { ...RELOCKED, profileRef: { ...RELOCK_SHARED.profileRef, snapshotRevision: "0" } }],
  ["a draft version of zero", { ...RELOCKED, draftVersion: 0 }],
])("refuses %s", async (_, data) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data }));

  expect(await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH })).toEqual({
    ok: false,
    code: "bad_response",
  });
});

it("refuses a re-lock reported under another knowledge base's id", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    Response.json({ data: { ...RELOCKED, kbId: "11111111-1111-8111-8111-1111111111ff" } }),
  );

  // Acting on it would tell an owner that this draft was rebuilt when a
  // different one was, and that this draft's paid knowledge is gone when it
  // is not.
  expect(await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH })).toEqual({
    ok: false,
    code: "bad_response",
  });
});

it("keeps an unrecognised blocker rather than reporting a rebuilt draft with none", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    Response.json({ data: { ...RELOCKED, blockers: ["category_terms_missing", "a_reason_this_build_predates"] } }),
  );

  expect(await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH })).toMatchObject({
    ok: true,
    relock: { blockers: ["category_terms_missing", "a_reason_this_build_predates"] },
  });
});

it.each([
  ["conflict", 409, 11],
  ["legacy_draft", 409, 2],
])("surfaces %s with the draft version the server holds", async (code, status, draftVersion) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code }, draftVersion }, { status }));

  expect(await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH })).toEqual({
    ok: false, code, draftVersion,
  });
});

it("carries no version for a refusal that names none", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    Response.json({ error: { code: "generation_running" } }, { status: 409 }),
  );

  expect(await relockGeoKbV3Draft({ kbId: V3_KB_ID, baseVersion: 9, draftHash: STORED_HASH })).toEqual({
    ok: false, code: "generation_running",
  });
});

/* ------------------------------------------------------------------ */
/* Why a draft cannot start a run                                       */
/* ------------------------------------------------------------------ */

/** The locked input this card renders, with one identity field changed. */
const lockedInput = (overrides: Partial<GeoKbPayloadV3["generationInput"]["identity"]>) => ({
  ...PAYLOAD.generationInput,
  identity: { ...PAYLOAD.generationInput.identity, ...overrides },
});

it.each([
  ["a locked input a run can build from", {}, []],
  ["a Profile that confirmed with no categories", { categoryTerms: [] }, ["category_terms_missing"]],
  // D8 again: a market with no question templates is not a blocker, and the
  // missing category next to it still is -- so this row also proves the reader
  // did not simply stop reporting everything.
  ["a market the question registry has no templates for", { market: { country: "CN", language: "zh-cn" } }, []],
  ["a missing category in such a market", { categoryTerms: [], market: { country: "CN", language: "zh-cn" } }, ["category_terms_missing"]],
])("reads %s off the draft", (_, overrides, expected) => {
  expect(geoKbV3DraftBlockers(lockedInput(overrides))).toEqual(expected);
});

/**
 * The two implementations, over one artefact.
 *
 * `geoKbV3DraftBlockers` restates a rule that lives in the create route, and
 * two statements of one rule drift. This drives the route's own builder over a
 * Profile, locks the input exactly as the route does, and asks the browser's
 * copy to read the same answer back off it -- so a change to either side that
 * the other does not follow is a failure here rather than a draft the card
 * calls ready and the run cannot use.
 */
const RELOCK_REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: "website-profile-reference.v1",
  websiteId: "33333333-3333-8333-8333-333333333331",
  snapshotId: "33333333-3333-8333-8333-333333333332",
  snapshotRevision: 3,
  profileSchemaVersion: "marketing-website-profile.v1",
  profileHash: "b".repeat(64),
};

function confirmedProfile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "AstrologyWiki",
    oneLinePositioning: "Charts for astrologers.",
    coreFeatures: ["birth charts"],
    categories: ["astrology software"],
    directCompetitors: ["astro.example"],
    country: "US",
    locale: "en",
    ...overrides,
  };
}

it.each([
  ["a Profile with categories and an English locale", {}, []],
  ["a Profile that confirmed with no categories at all", { categories: [] }, ["category_terms_missing"]],
  // D8: the knowledge body follows the site's own language, so a locale the
  // question registry has no templates for is not a blocker. It shows up at
  // publish time as a version with no question set, and why.
  ["a Profile in a language the question registry has no templates for", { locale: "zh-CN" }, []],
  ["a Profile with no categories in such a language", { categories: [], locale: "zh-CN" }, ["category_terms_missing"]],
])("agrees with the create route's own blockers for %s", (_, overrides, expected) => {
  const built = buildGeoKbV3Identity({
    targetUrl: "https://example.com/",
    reference: RELOCK_REFERENCE,
    profile: confirmedProfile(overrides),
  });
  if (built.kind !== "ok") throw new Error(`expected a usable Profile, got ${built.fields.join(",")}`);
  const locked = lockGeoKbV3GenerationInput(built, GEO_ABSENT_EVIDENCE_CONTENT_HASH);

  // Both sides are asserted against the same written-out expectation as well as
  // against each other: two implementations that had both stopped reporting
  // anything would agree perfectly, and agreement alone would pass.
  expect([...built.blockers]).toEqual(expected);
  expect(geoKbV3DraftBlockers(locked)).toEqual([...built.blockers]);
});

/* ------------------------------------------------------------------ */
/* The competitor gestures                                              */
/* ------------------------------------------------------------------ */

const COMPETITORS_ENDPOINT = "/api/tools/geo-knowledge-base/v3/competitors";
const IDENTITY = {
  status: "available", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  method: "json_ld", sourceUrl: "https://astro.example/", observedAt: NOW, cached: false,
};

it("looks a rival up by its domain and reads the identity back", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } }));
  const result = await lookupGeoKbV3Competitor({ kbId: V3_KB_ID, domain: "astro.example" });
  expect(calls()[0]![0]).toBe(COMPETITORS_ENDPOINT);
  expect(bodyOf(0)).toEqual({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" });
  expect(result).toEqual({ ok: true, identity: IDENTITY });
});

it("refuses a lookup answered for another knowledge base or in a shape it cannot read", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ data: { kbId: "22222222-2222-8222-8222-222222222222", identity: IDENTITY } }));
  await expect(lookupGeoKbV3Competitor({ kbId: V3_KB_ID, domain: "astro.example" })).resolves.toEqual({ ok: false, code: "bad_response" });
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ data: { kbId: V3_KB_ID, identity: { status: "available" } } }));
  await expect(lookupGeoKbV3Competitor({ kbId: V3_KB_ID, domain: "astro.example" })).resolves.toEqual({ ok: false, code: "bad_response" });
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ error: { code: "unknown_competitor" } }, { status: 422 }));
  await expect(lookupGeoKbV3Competitor({ kbId: V3_KB_ID, domain: "astro.example" })).resolves.toEqual({ ok: false, code: "unknown_competitor" });
});

function competitorsSaved(overrides: Record<string, unknown> = {}) {
  const competitors = [{ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] }];
  const generationInput = { ...PAYLOAD.generationInput, competitors };
  const next = parseGeoKbPayloadV3({ ...PAYLOAD, generationInput, runRef: { ...PAYLOAD.runRef, generationInputHash: geoV2Digest(generationInput) } });
  return {
    next,
    data: {
      kbId: V3_KB_ID, draftVersion: 5, contentHash: geoV2Digest(next), updatedAt: NOW,
      generationInputHash: next.runRef.generationInputHash, competitors, released: ["knowledgeGenerationId"], changed: true, ...overrides,
    },
  };
}

it("confirms a rival under the locked input the row was drawn against", async () => {
  const saved = competitorsSaved();
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: saved.data }));
  const result = await writeGeoKbV3Competitor({
    kbId: V3_KB_ID, baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash,
    gesture: { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"] },
  });
  expect(calls()[0]![0]).toBe(COMPETITORS_ENDPOINT);
  expect(bodyOf(0)).toEqual({
    kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash,
    domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  });
  expect(result).toEqual({ ok: true, saved: saved.data });
});

it("withdraws a confirmation with the same coordinates and no name", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: competitorsSaved().data }));
  await writeGeoKbV3Competitor({
    kbId: V3_KB_ID, baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash,
    gesture: { kind: "unconfirm", domain: "astro.example" },
  });
  expect(bodyOf(0)).toEqual({
    kbId: V3_KB_ID, intent: "unconfirm", baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash, domain: "astro.example",
  });
});

it("carries the server's refusal and the version that won a conflict", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 }));
  await expect(writeGeoKbV3Competitor({
    kbId: V3_KB_ID, baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash,
    gesture: { kind: "unconfirm", domain: "astro.example" },
  })).resolves.toEqual({ ok: false, code: "conflict", draftVersion: 9 });
});

/**
 * The hook makes the write itself, under the same lock as a flush and a
 * publish, and names the coordinates it holds -- never ones a component
 * captured a render ago. A confirm moves them (new version, new hash, a
 * re-locked input), so the next review save has to name the new ones or it is
 * refused as stale.
 */
it("writes a competitor gesture from the coordinates it holds and takes the answer into the view", async () => {
  const saved = competitorsSaved();
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ data: saved.data }));
  await mount();
  let result: unknown;
  await act(async () => { result = await editor.writeCompetitor({ kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"] }); });
  expect(result).toEqual({ ok: true, saved: saved.data });
  expect(bodyOf(0)).toEqual({
    kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: PAYLOAD.runRef.generationInputHash,
    domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  });
  expect(editor.view.draftVersion).toBe(5);
  expect(editor.view.draftHash).toBe(saved.data.contentHash);
  expect(editor.payload.generationInput.competitors).toEqual(saved.data.competitors);
  expect(editor.payload.runRef).toEqual({
    runId: null, generationInputHash: saved.data.generationInputHash, rolesGenerationId: null, knowledgeGenerationId: null, questionsGenerationId: null,
  });
  // Knowledge and review are untouched: nothing about an item changed.
  expect(editor.payload.knowledge).toEqual(PAYLOAD.knowledge);
  expect(editor.payload.review).toEqual(PAYLOAD.review);
  expect(editor.busy).toBe(false);
  expect(editor.status).toEqual({ kind: "idle" });

  const review = savedReview(saved.next, [{ kind: "accept", itemKey: FACT_KEY_PRO }], 5);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: review.data }));
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle();
  expect(bodyOf(1)).toMatchObject({ baseVersion: 5, expectedGenerationInputHash: saved.data.generationInputHash });
  expect(editor.view.draftVersion).toBe(6);
});

it("keeps the view where it was after a competitor write that changed nothing", async () => {
  await mount();
  const before = editor.view;
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({
    data: competitorsSaved({ changed: false, draftVersion: 4, contentHash: before.draftHash, generationInputHash: PAYLOAD.runRef.generationInputHash }).data,
  }));
  await act(async () => { await editor.writeCompetitor({ kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] }); });
  expect(editor.view).toBe(before);
});

/**
 * A decision made while the confirm is out must go to the server under the
 * version the confirm produced, not the one the tab had when the owner
 * clicked. The write holds the autosave the way a flush holds a second flush;
 * the queue survives and drains once the new coordinates are in.
 */
it("holds a decision made during a competitor write and sends it against the re-locked draft", async () => {
  const saved = competitorsSaved();
  let release: (response: Response) => void = () => undefined;
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
  await mount();
  let pending: Promise<unknown> = Promise.resolve();
  await act(async () => { pending = editor.writeCompetitor({ kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] }); });
  expect(editor.busy).toBe(true);
  expect(editor.autosaveHold).toBe("busy");
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle(GEO_KB_V3_AUTOSAVE_MS * 2);
  // Nothing but the confirm has gone out: the decision waits.
  expect(calls()).toHaveLength(1);
  expect(editor.dirty).toBe(true);

  const review = savedReview(saved.next, [{ kind: "accept", itemKey: FACT_KEY_PRO }], 5);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ data: review.data }));
  await act(async () => { release(Response.json({ data: saved.data })); await pending; });
  await settle();
  expect(calls()).toHaveLength(2);
  expect(bodyOf(1)).toMatchObject({ baseVersion: 5, expectedGenerationInputHash: saved.data.generationInputHash, actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }] });
  expect(editor.view.draftVersion).toBe(6);
  expect(editor.dirty).toBe(false);
});

it("refuses a competitor write while a flush is out, while decisions wait, or under a hold, attempting nothing", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 }));
  await mount();
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  // Decisions are waiting: the gesture would move the version they are about to name.
  let result: unknown = "unset";
  await act(async () => { result = await editor.writeCompetitor({ kind: "unconfirm", domain: "astro.example" }); });
  expect(result).toBeNull();
  expect(calls()).toHaveLength(0);
  await settle();
  // The flush lost a conflict: the card is held, and the gesture is refused with it.
  expect(editor.autosaveHold).toBe("conflict");
  await act(async () => { result = await editor.writeCompetitor({ kind: "unconfirm", domain: "astro.example" }); });
  expect(result).toBeNull();
  expect(calls()).toHaveLength(1);
});

it("enters the card's own hold when a competitor write loses a conflict or names a stale input", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 }));
  await mount();
  let result: unknown;
  await act(async () => { result = await editor.writeCompetitor({ kind: "unconfirm", domain: "astro.example" }); });
  expect(result).toEqual({ ok: false, code: "conflict", draftVersion: 9 });
  expect(editor.autosaveHold).toBe("conflict");
  expect(editor.conflictVersion).toBe(9);
  expect(editor.busy).toBe(false);
  // Held: a decision made now is not written, because the server already said this tab is behind.
  await act(async () => { editor.accept(FACT_KEY_PRO); });
  await settle(GEO_KB_V3_AUTOSAVE_MS * 4);
  expect(calls()).toHaveLength(1);

  await act(async () => root.unmount());
  root = createRoot(host);
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ error: { code: "input_changed" } }, { status: 409 }));
  await mount();
  await act(async () => { result = await editor.writeCompetitor({ kind: "unconfirm", domain: "astro.example" }); });
  expect(result).toEqual({ ok: false, code: "input_changed" });
  expect(editor.autosaveHold).toBe("inputChanged");
});

it("reports any other refusal to the caller without holding the card", async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await mount();
  let result: unknown;
  await act(async () => { result = await editor.writeCompetitor({ kind: "unconfirm", domain: "astro.example" }); });
  expect(result).toEqual({ ok: false, code: "rate_limited" });
  expect(editor.autosaveHold).toBeNull();
  expect(editor.busy).toBe(false);
});
