// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { V2_CANDIDATE_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { parseGeoKbEditorViewV2, type GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import { GEO_KB_V2_AUTOSAVE_MS, useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
import { editorFixture, sourceFixture } from "./geo-kb-v2-ui.test-fixtures.ts";
import { createGeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT } from "../../lib/geo-tools/kb-synthesis-fixtures.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
let host: HTMLDivElement, root: Root, editor: ReturnType<typeof useGeoKbV2Editor>;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); window.sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function Harness({ view, revision }: { readonly view: GeoKbEditorViewV2; readonly revision: number }) { editor = useGeoKbV2Editor({ initialView: view, locale: "en", confirmedProfileRevision: revision }); return <span>{editor.dirty ? "dirty" : "saved"}</span>; }
async function mount(view = editorFixture(), revision = 1) { await act(async () => root.render(<Harness view={view} revision={revision} />)); }
function later<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const response = (data: unknown) => Response.json({ data });

it("a save acknowledges only its submitted edit and never overwrites later typing", async () => {
  await mount(); await act(async () => editor.change({ ...editor.payload, officialName: "Submitted name" }));
  const reply = later<Response>(); vi.mocked(fetch).mockReturnValueOnce(reply.promise);
  let saving!: Promise<void>; await act(async () => { saving = editor.save(); });
  await act(async () => editor.change({ ...editor.payload, officialName: "Typed while saving " }));
  await act(async () => { reply.resolve(response({ draftVersion: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await saving; });
  expect(editor.payload.officialName).toBe("Typed while saving "); expect(editor.dirty).toBe(true); expect(editor.view.draftVersion).toBe(2);
  expect(editor.status.kind).not.toBe("saved");
});
it("conflict adopts only the version and keeps every local field", async () => {
  await mount(); await act(async () => editor.change({ ...editor.payload, officialName: "Local name" }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "conflict" }, draftVersion: 4 }, { status: 409 }));
  await act(async () => editor.save()); expect(editor.view.draftVersion).toBe(4); expect(editor.payload.officialName).toBe("Local name"); expect(editor.dirty).toBe(true);
});
it("Profile A-B-A transitions invalidate the retained candidate and reviewed copy", async () => {
  const view = editorFixture(); await mount(view, 1); await act(async () => editor.confirmReview(true));
  await mount(view, 2); await mount(view, 1);
  expect(editor.copyStale).toBe(true); expect(editor.candidateStale).toBe(true); expect(editor.view.prepared?.candidateId).toBe(V2_CANDIDATE_ID); expect(editor.canFreeze).toBe(false);
});
it("unsaved data cannot dispatch sources or either model operation and registers unload protection", async () => {
  await mount(); await act(async () => editor.change({ ...editor.payload, officialName: "Unsaved" }));
  await act(async () => { await editor.generate("roles"); await editor.generate("questions"); await editor.refreshSources(); });
  expect(fetch).not.toHaveBeenCalled(); const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it("ambiguous generation keeps its key across remount and only reads on recovery", async () => {
  const view = editorFixture(); await mount(view); vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
  await act(async () => editor.generate("roles")); const key = editor.pending.roles?.idempotencyKey; expect(key).toBeTruthy();
  await act(async () => editor.generate("roles")); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); root = createRoot(host); await mount(view); expect(editor.pending.roles?.idempotencyKey).toBe(key);
  vi.mocked(fetch).mockResolvedValueOnce(response(view)); await act(async () => editor.reload());
  expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain("/v2/load"); expect(editor.pending.roles?.idempotencyKey).toBe(key);
});
it("freeze requires exact candidate review and sends only ID/hash then reloads frozen content", async () => {
  const view = editorFixture(); await mount(view); await act(async () => editor.freeze()); expect(fetch).not.toHaveBeenCalled();
  await act(async () => editor.confirmReview(true));
  vi.mocked(fetch).mockResolvedValueOnce(response({ snapshotId: V2_CANDIDATE_ID, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: view.draftHash, questionSetHash: view.prepared!.context.questionSetHash, questionCount: 1, reusedExisting: false })).mockResolvedValueOnce(response(view));
  await act(async () => editor.freeze());
  const init = vi.mocked(fetch).mock.calls[0]?.[1]; expect(JSON.parse(String(init?.body))).toEqual({ kbId: view.kbId, candidateId: view.prepared!.candidateId, candidateHash: view.prepared!.candidateHash });
  expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain("/v2/load");
});
it("reading a newer Profile is only a proposal; adoption is explicit and must be saved", async () => {
  const view = editorFixture(); await mount(view); const newer = { ...structuredClone(view), profile: { ...view.profile!, reference: { ...view.profile!.reference, snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 2 } } };
  vi.mocked(fetch).mockResolvedValueOnce(response(newer)); await act(async () => editor.reviewProfileCopy());
  expect(editor.payload.profileCopy.snapshotId).toBe(view.payload.profileCopy.snapshotId); expect(editor.copyProposal?.snapshotRevision).toBe("2");
  await act(async () => editor.adoptProfileCopy()); expect(editor.payload.profileCopy.snapshotRevision).toBe("2"); expect(editor.dirty).toBe(true); expect(editor.canGenerate).toBe(false);
  expect(editor.payload.roles).toEqual(view.payload.roles.map(role => ({ ...role, review: "pending" })));
  expect(editor.payload.facts).toEqual(view.payload.facts.map(fact => ({ ...fact, review: "pending" })));
  const savedPayload = editor.payload;
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })).mockResolvedValueOnce(response({ ...newer, payload: savedPayload, draftVersion: 2, draftHash: "c".repeat(64), profileCopyHash: geoV2Digest(savedPayload.profileCopy) }));
  await act(async () => editor.save()); expect(editor.canGenerate).toBe(true); expect(editor.canPrepare).toBe(false);
  expect(editor.view.profileCopyHash).toBe(geoV2Digest(savedPayload.profileCopy)); expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain("/v2/load");
});
it("recovers an unknown delivery by its original key and reuses that key for an explicit same-input retry", async () => {
  const view = editorFixture(); await mount(view); vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
  await act(async () => editor.generate("roles")); const key = editor.pending.roles!.idempotencyKey;
  const generation = { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "b".repeat(64), state: "failed", result: null, errorReason: "provider_rejected", attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: 1 } };
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation })); await act(async () => editor.readGeneration("roles"));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({ kbId: view.kbId, kind: "roles", idempotencyKey: key });
  expect(editor.pending.roles).toBeNull(); vi.mocked(fetch).mockResolvedValueOnce(response({ generation, reused: true }));
  await act(async () => editor.generate("roles")); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).idempotencyKey).toBe(key);
});
it("a candidate arriving after a Profile ABA remains stale even after the unchanged current copy is rechecked", async () => {
  const full = editorFixture(), view = { ...full, prepared: null }; await mount(view);
  const reply = later<Response>(); vi.mocked(fetch).mockReturnValueOnce(reply.promise); let generating!: Promise<void>;
  await act(async () => { generating = editor.generate("questions"); }); await mount(view, 2); await mount(view, 1);
  await act(async () => { reply.resolve(response({ generation: { generationId: V2_CANDIDATE_ID, kbId: view.kbId, kind: "questions", inputHash: "a".repeat(64), state: "succeeded", result: full.prepared, errorReason: null, attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: 1, outputTokens: 1, requestCount: 1 } }, reused: false })); await generating; });
  vi.mocked(fetch).mockResolvedValueOnce(response(view)); await act(async () => editor.reviewProfileCopy());
  expect(editor.copyStale).toBe(false); expect(editor.view.prepared?.candidateId).toBe(V2_CANDIDATE_ID); expect(editor.candidateStale).toBe(true);
});
it("only explicit replacement adopts a colliding model role and preserves unrelated roles", async () => {
  const view = editorFixture(), id = "44444444-4444-4444-8444-444444444444";
  const proposal = createGeoRoleProposal({ generationId: id, kbId: view.kbId, baseDraftVersion: "1", baseDraftHash: view.draftHash!, profileCopyHash: geoV2Digest(view.payload.profileCopy), input: { ...ROLE_SYNTHESIS_INPUT, questionLanguage: "en" }, output: { ...ROLE_SYNTHESIS_OUTPUT, roles: [{ ...ROLE_SYNTHESIS_OUTPUT.roles[0]!, id: "r1" }] }, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 } });
  await mount({ ...view, generations: { ...view.generations, roles: { generationId: id, kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "succeeded", result: proposal, errorReason: null, attempt: null } } });
  await act(async () => editor.adoptRoles(proposal, ["r1"])); expect(editor.payload.roles).toEqual(view.payload.roles);
  await act(async () => editor.adoptRoles(proposal, ["r1"], "replace_selected"));
  expect(editor.payload.roles[0]).toMatchObject({ label: "财务经理", review: "pending", source: { kind: "model", generationId: id, itemId: "r1", evidenceRefs: ["P1", "G1"] } }); expect(editor.dirty).toBe(true);
});
it("a reload with a new selected source keeps the old candidate visible but stale", async () => {
  const view = editorFixture(); await mount(view);
  const sourceReceipt = sourceFixture(view);
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...view, sourceReceipt })); await act(async () => editor.reload());
  expect(editor.view.prepared?.candidateId).toBe(view.prepared!.candidateId); expect(editor.candidateStale).toBe(true);
});
it("a changed source selection gets a distinct key rather than reusing another input identity", async () => {
  const view = editorFixture(); await mount(view);
  const generation = { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "b".repeat(64), state: "failed", result: null, errorReason: "provider_rejected", attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: 1 } };
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation, reused: false })); await act(async () => editor.generate("roles")); const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  const source = sourceFixture(view);
  vi.mocked(fetch).mockResolvedValueOnce(response(source)); await act(async () => editor.refreshSources());
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation, reused: false })); await act(async () => editor.generate("roles"));
  const last = JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)); expect(last.idempotencyKey).not.toBe(first.idempotencyKey); expect(last.sourceReceiptRefs).toHaveLength(1);
});
it("does not read browser recovery state during SSR, so hydration starts from the same DTO", () => {
  const get = vi.spyOn(Storage.prototype, "getItem");
  try { renderToString(<Harness view={editorFixture()} revision={1} />); expect(get).not.toHaveBeenCalled(); } finally { get.mockRestore(); }
});
it("latest generation with matching draft metadata is not proof of an unknown request's key", async () => {
  const view = editorFixture(); await mount(view); vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await act(async () => editor.generate("roles"));
  const key = editor.pending.roles!.idempotencyKey, id = "44444444-4444-4444-8444-444444444444";
  const proposal = createGeoRoleProposal({ generationId: id, kbId: view.kbId, baseDraftVersion: "1", baseDraftHash: view.draftHash!, profileCopyHash: geoV2Digest(view.payload.profileCopy), input: ROLE_SYNTHESIS_INPUT, output: ROLE_SYNTHESIS_OUTPUT, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 } });
  const loaded = { ...view, generations: { ...view.generations, roles: { generationId: id, kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "succeeded", result: proposal, errorReason: null, attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: 1, outputTokens: 1, requestCount: 1 } } } };
  expect(parseGeoKbEditorViewV2(loaded)).not.toBeNull(); vi.mocked(fetch).mockResolvedValueOnce(response(loaded));
  await act(async () => editor.reload()); expect(editor.pending.roles?.idempotencyKey).toBe(key);
});
it("partial role adoption remains available after saving the first accepted proposal", async () => {
  const view = editorFixture(), id = "44444444-4444-4444-8444-444444444444";
  const proposal = createGeoRoleProposal({ generationId: id, kbId: view.kbId, baseDraftVersion: "1", baseDraftHash: view.draftHash!, profileCopyHash: view.profileCopyHash, input: { ...ROLE_SYNTHESIS_INPUT, questionLanguage: "en" }, output: { ...ROLE_SYNTHESIS_OUTPUT, roles: ["r2", "r3"].map(roleId => ({ ...ROLE_SYNTHESIS_OUTPUT.roles[0]!, id: roleId, label: roleId === "r2" ? "财务经理" : "应收账款经理", questionLabel: roleId === "r2" ? "finance managers" : "receivables managers" })) }, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 } });
  await mount({ ...view, generations: { ...view.generations, roles: { generationId: id, kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "succeeded", result: proposal, errorReason: null, attempt: null } } });
  await act(async () => editor.adoptRoles(proposal, ["r2"]));
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save());
  await act(async () => editor.adoptRoles(proposal, ["r3"])); expect(editor.payload.roles.map(role => role.id)).toEqual(["r1", "r2", "r3"]);
});
it("old Profile receipts remain readable but are excluded from Profile-only generation and candidate staleness", async () => {
  const view = editorFixture(), current = sourceFixture(view); const old = { ...current, profileReference: { ...current.profileReference!, snapshotId: "77777777-7777-4777-8777-777777777777" } };
  await mount({ ...view, sourceReceipt: old }); expect(editor.candidateStale).toBe(false);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "model_unavailable" } }, { status: 503 })); await act(async () => editor.generate("roles"));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).sourceReceiptRefs).toEqual([]); expect(editor.view.sourceReceipt).toEqual(old);
});
it("editing back after a successful save stays dirty and removes the saved message", async () => {
  await mount(); vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save());
  expect(editor.status.kind).toBe("saved"); const original = editor.payload;
  await act(async () => editor.change({ ...editor.payload, officialName: "Changed" })); await act(async () => editor.change(original));
  expect(editor.dirty).toBe(true); expect(editor.status.kind).not.toBe("saved");
});
it("a real uncertain record locks its original input, not an explicitly changed and saved new input", async () => {
  const view = editorFixture(), oldId = "44444444-4444-4444-8444-444444444444", newId = "55555555-5555-4555-8555-555555555555"; await mount(view);
  const uncertain = { generationId: oldId, kbId: view.kbId, kind: "roles", inputHash: "b".repeat(64), state: "uncertain", result: null, errorReason: "outcome_unknown", attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: null } };
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation: uncertain, reused: false })); await act(async () => editor.generate("roles")); const oldKey = editor.pending.roles!.idempotencyKey;
  await act(async () => editor.generate("roles", "new_input")); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => editor.change({ ...editor.payload, officialName: "New saved identity" }));
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save());
  expect(editor.generationAction("roles")).toBe("new_input"); await act(async () => editor.generate("roles")); expect(fetch).toHaveBeenCalledTimes(2);
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation: { ...uncertain, generationId: newId, state: "failed", errorReason: "provider_rejected", attempt: { ...uncertain.attempt, delivery: "response_received" } }, reused: false }));
  await act(async () => editor.generate("roles", "new_input")); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).idempotencyKey).not.toBe(oldKey);
  expect(editor.retainedRequests[0]).toMatchObject({ generationId: oldId, idempotencyKey: oldKey });
  vi.mocked(fetch).mockResolvedValueOnce(response({ generation: uncertain })); await act(async () => editor.readRetainedRequest(editor.retainedRequests[0]!));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body))).toEqual({ kbId: view.kbId, generationId: oldId }); expect(editor.view.generations.roles?.generationId).toBe(newId);
});
it("an exact-key 404 permits only explicit same-key same-input resend, never automatic dispatch", async () => {
  const view = editorFixture(); await mount(view); vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await act(async () => editor.generate("roles"));
  const original = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "not_found" } }, { status: 404 })); await act(async () => editor.readGeneration("roles"));
  expect(editor.generationAction("roles")).toBe("resend_same"); await act(async () => editor.generate("roles")); expect(fetch).toHaveBeenCalledTimes(2);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await act(async () => editor.generate("roles", "resend_same"));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body))).toEqual(original);
});
it("legacy uncertain metadata requires a genuinely changed saved draft before an explicit new input", async () => {
  const view = editorFixture(); await mount({ ...view, generations: { ...view.generations, roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "uncertain", result: null, errorReason: "outcome_unknown", attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: null } } } });
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: view.draftHash, updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save()); expect(editor.generationAction("roles")).toBe("read_only");
  await act(async () => editor.change({ ...editor.payload, officialName: "Actual new input" }));
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 3, contentHash: "e".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save()); expect(editor.generationAction("roles")).toBe("new_input");
});
it("request identity does not treat JSON key ordering as a new input", async () => {
  const view = editorFixture(); window.sessionStorage.setItem(`gg:geo-kb-generation:${view.kbId}:roles`, JSON.stringify({ idempotencyKey: "old-key-123", draftHash: view.draftHash, baseVersion: 1, generationId: null, inputIdentity: JSON.stringify({ kbId: view.kbId, kind: "roles", baseVersion: 1, draftHash: view.draftHash, sourceReceiptRefs: [], displayLocale: "en" }) }));
  await mount(view); expect(editor.generationAction("roles")).toBe("read_only");
});
it("advancing only the CAS version does not turn the same unknown generation basis into a new call", async () => {
  const view = editorFixture(); await mount(view); vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await act(async () => editor.generate("roles"));
  vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: view.draftHash, updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); await act(async () => editor.save());
  expect(editor.generationAction("roles")).toBe("read_only"); await act(async () => editor.generate("roles", "new_input")); expect(fetch).toHaveBeenCalledTimes(2);
});

it("writes an edit without anyone pressing save, and only after typing settles", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    vi.mocked(fetch).mockResolvedValue(response({ draftVersion: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => editor.change({ ...editor.payload, officialName: "First" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS - 100); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => editor.change({ ...editor.payload, officialName: "Second" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS - 100); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).payload.officialName).toBe("Second");
    expect(editor.dirty).toBe(false);
    expect(editor.view.draftVersion).toBe(2);
  } finally { vi.useRealTimers(); }
});
it("waits for an operation already in flight rather than dropping the write", async () => {
  vi.useFakeTimers();
  try {
    await mount({ ...editorFixture(), sourceReceipt: null });
    const reply = later<Response>();
    vi.mocked(fetch).mockReturnValueOnce(reply.promise);
    let refreshing!: Promise<void>;
    await act(async () => { refreshing = editor.refreshSources(); });
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed during a refresh" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValue(response({ draftVersion: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => { reply.resolve(Response.json({ error: { code: "rate_limited" } }, { status: 429 })); await refreshing; });
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editor.dirty).toBe(false);
  } finally { vi.useRealTimers(); }
});
it("never writes a draft the visitor has not edited", async () => {
  vi.useFakeTimers();
  try {
    await mount({ ...editorFixture(), requiresSave: true });
    expect(editor.dirty).toBe(true);
    expect(editor.edited).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 5); });
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
