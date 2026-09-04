// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { V2_CANDIDATE_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { parseGeoKbEditorViewV2, type GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import { GEO_KB_V2_AUTOSAVE_MS, GEO_KB_V2_AUTOSAVE_RETRY_MS, useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
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
  let saving!: Promise<boolean>; await act(async () => { saving = editor.save(); });
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
it("does not call a save that succeeded a save that failed after the Profile copy changed", async () => {
  // The build saves, and a save that carries a new Profile copy reloads the
  // editor. The gates read a ref; if that ref were only refreshed on the next
  // render, the very next line would read a hold that no longer applies and
  // the visitor would be told the draft did not save when it did.
  const view = editorFixture(); await mount(view);
  const newer = { ...structuredClone(view), profile: { ...view.profile!, reference: { ...view.profile!.reference, snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 2 } } };
  vi.mocked(fetch).mockResolvedValueOnce(response(newer));
  await act(async () => editor.reviewProfileCopy());
  await act(async () => editor.adoptProfileCopy());
  const adopted = editor.payload;
  vi.mocked(fetch)
    .mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }))
    .mockResolvedValueOnce(response({ ...newer, payload: adopted, draftVersion: 2, draftHash: "c".repeat(64), profileCopyHash: geoV2Digest(adopted.profileCopy) }))
    .mockResolvedValueOnce(response(sourceFixture({ ...newer, payload: adopted, draftVersion: 2, draftHash: "c".repeat(64) })))
    .mockResolvedValueOnce(response({ generation: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state: "dispatched", result: null, errorReason: null, attempt: null }, reused: false }));

  await act(async () => editor.buildFromProfile());

  expect(editor.build?.stoppedAt).not.toBe("save");
  expect(vi.mocked(fetch).mock.calls.map(call => String(call[0]))).toContain("/api/tools/geo-knowledge-base/v2/roles");
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
  const reply = later<Response>(); vi.mocked(fetch).mockReturnValueOnce(reply.promise); let generating!: Promise<boolean>;
  await act(async () => { generating = editor.generate("questions"); }); await mount(view, 2); await mount(view, 1);
  await act(async () => { reply.resolve(response({ generation: { generationId: V2_CANDIDATE_ID, kbId: view.kbId, kind: "questions", inputHash: "a".repeat(64), state: "succeeded", result: full.prepared, errorReason: null, attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: 1, outputTokens: 1, requestCount: 1 } }, reused: false })); await generating; });
  vi.mocked(fetch).mockResolvedValueOnce(response(view)); await act(async () => editor.reviewProfileCopy());
  expect(editor.copyStale).toBe(false); expect(editor.view.prepared?.candidateId).toBe(V2_CANDIDATE_ID); expect(editor.candidateStale).toBe(true);
});
it("derives, evidences, generates, accepts and freezes a whole knowledge base in one gesture", async () => {
  // The state a visitor lands in right after confirming a Profile: a draft
  // holding the Profile copy, nothing derived from it, nothing frozen.
  const base = editorFixture(), id = "44444444-4444-4444-8444-444444444444";
  const view = { ...base, prepared: null, frozen: null, sourceReceipt: null, requiresSave: true,
    payload: { ...base.payload, roles: [], market: { ...base.payload.market, language: "en" },
      competitors: [{ domain: "rival.example", brandName: "", confirmed: false, aliases: [] },
        { domain: "conflict.example", brandName: "", confirmed: false, aliases: [] },
        { domain: "down.example", brandName: "", confirmed: false, aliases: [] }] } };
  const proposal = createGeoRoleProposal({ generationId: id, kbId: view.kbId, baseDraftVersion: "2", baseDraftHash: "c".repeat(64),
    profileCopyHash: geoV2Digest(view.payload.profileCopy), input: { ...ROLE_SYNTHESIS_INPUT, officialName: view.payload.officialName, questionLanguage: "en" },
    output: { ...ROLE_SYNTHESIS_OUTPUT, roles: [{ ...ROLE_SYNTHESIS_OUTPUT.roles[0]!, id: "r1" }] }, sourceReceiptRefs: [],
    selectedEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, manual: 0, crawl: 0 } });
  const saved = (version: number, hash: string) => response({ draftVersion: version, contentHash: hash, updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] });
  // What one refresh really brings back: one competitor page that names itself,
  // one whose identity signals conflict, one that could not be fetched.
  const signal = (host: string, name: string) => ({ kind: "json_ld_organization" as const, name, aliases: [], url: `https://${host}/`, hostMatched: true, excludedReason: null });
  const capture = { confirmed: false as const, source: "crawl" as const, observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "d".repeat(64), signalsTruncated: false };
  const discoveredFact = { evidenceId: "F1" as const, key: "Is it free?", value: "Yes. No account is needed.", confirmed: false as const,
    source: "crawl" as const, sourceUrl: "https://acme.example/", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "e".repeat(64),
    status: "available" as const, reason: null, excerpt: "Yes. No account is needed." };
  // One statement the page really made, and one the refresh could not read: a
  // fact with no value has nothing to carry into the draft.
  const missingFact = { evidenceId: "F2" as const, key: "What does it cost?", confirmed: false as const, source: null,
    sourceUrl: "https://acme.example/pricing", observedAt: null, bodyHash: null,
    status: "unavailable" as const, reason: "value_missing" as const, value: null, excerpt: null };
  // And one the page contradicts: it has a page, a time and an excerpt, so only
  // the status says it must not be carried.
  const conflictedFact = { evidenceId: "F3" as const, key: "Do you store birth data?", confirmed: false as const, source: "crawl" as const,
    sourceUrl: "https://acme.example/privacy", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "e".repeat(64),
    status: "conflict" as const, reason: "conflicting" as const, value: null, excerpt: "The page says both." };
  const receipt = { ...sourceFixture({ ...view, draftVersion: 2, draftHash: "c".repeat(64) }), facts: [discoveredFact, missingFact, conflictedFact], competitors: [
    { ...capture, evidenceId: "C1", domain: "rival.example", sourceUrl: "https://rival.example/", signals: [signal("rival.example", "Rival Analytics")], status: "available" as const, reason: null, brandName: "Rival Analytics", aliases: ["Rival"], method: "json_ld" as const },
    { ...capture, evidenceId: "C2", domain: "conflict.example", sourceUrl: "https://conflict.example/", signals: [signal("conflict.example", "One name"), signal("conflict.example", "Another name")], status: "conflict" as const, reason: "identity_conflict" as const, brandName: null, aliases: [], method: "conflicting_signals" as const },
    { ...capture, evidenceId: "C3", domain: "down.example", sourceUrl: "https://down.example/", signals: [], status: "unavailable" as const, reason: "fetch_failed" as const, brandName: null, aliases: [], method: null, source: null, observedAt: null, bodyHash: null },
  ] };
  vi.mocked(fetch)
    .mockResolvedValueOnce(saved(2, "c".repeat(64)))
    .mockResolvedValueOnce(response(receipt))
    .mockResolvedValueOnce(response({ generation: { generationId: id, kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state: "succeeded", result: proposal, errorReason: null, attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: 1, outputTokens: 1, requestCount: 1 } }, reused: false }))
    .mockResolvedValueOnce(saved(3, "e".repeat(64)))
    .mockResolvedValueOnce(response({ generation: { generationId: base.prepared!.candidateId, kbId: view.kbId, kind: "questions", inputHash: "f".repeat(64), state: "succeeded", result: base.prepared, errorReason: null, attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "fixture", inputTokens: 1, outputTokens: 1, requestCount: 1 } }, reused: false }))
    .mockResolvedValueOnce(response({ snapshotId: base.prepared!.candidateId, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: base.prepared!.candidateHash, questionSetHash: "a".repeat(64), questionCount: 1, reusedExisting: false }))
    .mockResolvedValueOnce(response(base));
  await mount(view);

  await act(async () => editor.generateAll());

  // Every step of the workbench, in order, without a person pressing any of
  // them: save, evidence, roles, save the adopted roles, question set, freeze.
  expect(vi.mocked(fetch).mock.calls.map(call => String(call[0]))).toEqual([
    "/api/tools/geo-knowledge-base/v2/draft",
    "/api/tools/geo-knowledge-base/v2/sources",
    "/api/tools/geo-knowledge-base/v2/roles",
    "/api/tools/geo-knowledge-base/v2/draft",
    "/api/tools/geo-knowledge-base/v2/prepare",
    "/api/tools/geo-knowledge-base/v2/freeze",
    "/api/tools/geo-knowledge-base/v2/load",
  ]);
  // The roles the model proposed went into the draft that was frozen, accepted
  // rather than left pending: nothing else would have let the freeze proceed.
  const second = JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body)) as { payload: { roles: { id: string; review: string; source: { kind: string; generationId: string } }[] } };
  expect(second.payload.roles).toHaveLength(1);
  expect(second.payload.roles[0]).toMatchObject({ id: "r1", review: "accepted", source: { kind: "model", generationId: id } });
  // And the identity each competitor's own page gave. A competitor with no
  // name is dropped from share of voice and has nothing for a mention to match,
  // so leaving all three unnamed -- which is what the workbench's adopt panel
  // was for -- would have frozen a knowledge base that cannot see its rivals.
  const competitors = (JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body)) as { payload: { competitors: { domain: string; brandName: string; confirmed: boolean }[] } }).payload.competitors;
  expect(competitors).toEqual([
    { domain: "rival.example", brandName: "Rival Analytics", confirmed: true, aliases: ["Rival"] },
    // Conflicting signals and a failed fetch stay exactly as they were: unnamed
    // and unconfirmed, which is the truth about them.
    { domain: "conflict.example", brandName: "", confirmed: false, aliases: [] },
    { domain: "down.example", brandName: "", confirmed: false, aliases: [] },
  ]);
  // What the site says about itself, read off its own page by the refresh and
  // carried into the draft with the evidence for it. Without this the frozen
  // knowledge base holds no statement the site actually makes.
  const facts = (JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body)) as { payload: { facts: { key: string; value: string; review: string; sourceUrl: string; supportRef: { evidenceId: string } | null }[] } }).payload.facts;
  expect(facts.at(-1)).toMatchObject({ key: "Is it free?", value: "Yes. No account is needed.", review: "accepted", sourceUrl: "https://acme.example/", supportRef: { evidenceId: "F1" } });
  // And only that one: an entry the refresh could not read has no value to
  // state, and a fact with no value cannot be accepted at all.
  expect(facts.some(fact => fact.key === "What does it cost?")).toBe(false);
  expect(facts.some(fact => fact.key === "Do you store birth data?")).toBe(false);
  expect(editor.confirm?.stoppedAt).toBeNull();
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
    let refreshing!: Promise<boolean>;
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

it("flushes a pending edit with a kept-alive request when the editor unmounts, then never again", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed then left" }));
    await act(async () => root.unmount()); root = createRoot(host);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ keepalive: true, method: "POST" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).payload.officialName).toBe("Typed then left");
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 3); });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it("does not autosave over a conflicting version until someone saves by hand", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "conflict" }, draftVersion: 5 }, { status: 409 }));
    await act(async () => editor.change({ ...editor.payload, officialName: "A" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(editor.status).toEqual({ kind: "error", code: "conflict" });
    expect(editor.autosaveHold).toBe("conflict");
    await act(async () => editor.change({ ...editor.payload, officialName: "AB" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 3); });
    // The re-based version is not written automatically: that would overwrite another session unread.
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 6, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => editor.save());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).baseVersion).toBe(5);
    expect(editor.autosaveHold).toBeNull();
    expect(editor.dirty).toBe(false);
  } finally { vi.useRealTimers(); }
});
it("does not autosave while the Profile copy is stale, since every write would be refused", async () => {
  vi.useFakeTimers();
  try {
    const view = editorFixture();
    await mount(view, 1); await mount(view, 2);
    expect(editor.copyStale).toBe(true);
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed on a stale copy" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 3); });
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.autosaveHold).toBe("copyStale");
  } finally { vi.useRealTimers(); }
});
it("does not write a draft identical to the one the server already holds", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    const original = editor.payload.officialName;
    await act(async () => editor.change({ ...editor.payload, officialName: original + "x" }));
    await act(async () => editor.change({ ...editor.payload, officialName: original }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.dirty).toBe(false);
    expect(editor.edited).toBe(false);
    expect(editor.status.kind).toBe("saved");
  } finally { vi.useRealTimers(); }
});
it("resumes a held write as soon as the running generation settles", async () => {
  vi.useFakeTimers();
  try {
    const view = editorFixture(), generationId = "66666666-6666-4666-8666-666666666666";
    await mount({ ...view, generations: { roles: { generationId, kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state: "dispatched", result: null, errorReason: null, attempt: null }, questions: null } });
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed during a run" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 2); });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(response({ generation: { generationId, kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state: "failed", result: null, errorReason: "provider_rejected", attempt: { attemptedCalls: 1, delivery: "response_received", modelRequested: "m", inputTokens: 1, outputTokens: 1, requestCount: 1 } } }));
    vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "e".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => editor.readGeneration("roles"));
    expect(editor.autosaveHold).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain("draft");
    expect(editor.dirty).toBe(false);
  } finally { vi.useRealTimers(); }
});
it("holds a write back while a dispatched generation is still bound to this draft", async () => {
  vi.useFakeTimers();
  try {
    const view = editorFixture();
    await mount({ ...view, generations: { roles: { generationId: "11111111-1111-4111-8111-111111111111",
      kbId: view.kbId, kind: "roles", state: "dispatched", errorReason: null, attempt: null, result: null, inputHash: "d".repeat(64) }, questions: null } });
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed while a run is out" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 4); });
    // Writing now would move the draft version the running request was sent
    // with, making its paid result unusable and opening a second dispatch.
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.dirty).toBe(true);
  } finally { vi.useRealTimers(); }
});
it("addresses the version the editor holds, not the one the queued timer's render captured", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    // A write is queued while an earlier one is still in flight, so its
    // closure predates the version the server is about to hand back.
    const first = later<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise);
    await act(async () => editor.change({ ...editor.payload, officialName: "First" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => editor.change({ ...editor.payload, officialName: "Second" }));
    vi.mocked(fetch).mockResolvedValue(response({ draftVersion: 3, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => { first.resolve(response({ draftVersion: 2, contentHash: "b".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).baseVersion).toBe(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).baseVersion).toBe(2);
    expect(editor.view.draftVersion).toBe(3);
    expect(editor.dirty).toBe(false);
    expect(editor.status.kind).not.toBe("error");
  } finally { vi.useRealTimers(); }
});
it("adopting the copy already held is not an edit and does not bump the version", async () => {
  const view = editorFixture();
  await mount(view);
  const before = editor.payload;
  vi.mocked(fetch).mockResolvedValueOnce(response(view));
  await act(async () => editor.reviewProfileCopy());
  expect(editor.copyProposal).not.toBeNull();
  await act(async () => editor.adoptProfileCopy());
  expect(editor.copyProposal).toBeNull();
  expect(editor.payload).toBe(before);
  expect(editor.edited).toBe(false);
  expect(editor.dirty).toBe(false);
});

it("warns about leaving only for the visitor's own edits, never for a draft that merely needs one save", async () => {
  const add = vi.spyOn(window, "addEventListener");
  await mount({ ...editorFixture(), requiresSave: true });
  expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
  await act(async () => editor.change({ ...editor.payload, officialName: "Mine" }));
  expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);
  add.mockRestore();
});
it("stays quietly unsaved while a row is still being filled in, instead of announcing an error every pause", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    await act(async () => editor.change({ ...editor.payload, facts: [...editor.payload.facts, { key: "", value: "", reason: "lowConfidence", sourceUrl: "", observedAt: "", review: "pending", supportRef: null }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 3); });
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.status.kind).not.toBe("error");
    expect(editor.dirty).toBe(true);
    await act(async () => editor.save());
    expect(editor.status).toEqual({ kind: "error", code: "invalid_input" });
  } finally { vi.useRealTimers(); }
});

it("treats a server refusal for a generation running in another tab as a hold, and retries later", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "generation_running" } }, { status: 409 }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed while another tab generates" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(editor.status.kind).not.toBe("error");
    expect(editor.autosaveHold).toBe("running");
    expect(editor.dirty).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    // The retry waits its own, longer cadence. Advancing straight past both
    // delays would pass just as well if the retry ran at the typing cadence,
    // which is how a hardcoded delay survived review here once already.
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_RETRY_MS - GEO_KB_V2_AUTOSAVE_MS); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editor.dirty).toBe(false);
    expect(editor.autosaveHold).toBeNull();
  } finally { vi.useRealTimers(); }
});
it("stops retrying a write the server refuses, instead of spending the visitor's quota on a loop", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    // The draft route counts refused calls against the same hourly bucket as
    // real edits, so a cadence-driven retry would exhaust the visitor's own
    // budget and then refuse the edits they actually make.
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed into a rate limit" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 20); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(editor.autosaveHold).toBe("failed");
    expect(editor.dirty).toBe(true);
    // Typing is what asks again: the visitor is present and the hint said so.
    vi.mocked(fetch).mockResolvedValue(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed again" }));
    expect(editor.autosaveHold).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editor.dirty).toBe(false);
  } finally { vi.useRealTimers(); }
});
it("still flushes the last edit on unmount after a failed save, since one request is not a loop", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed into a rate limit" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(editor.autosaveHold).toBe("failed");
    await act(async () => root.unmount()); root = createRoot(host);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).payload.officialName).toBe("Typed into a rate limit");
  } finally { vi.useRealTimers(); }
});
it("a manual save refused for a run elsewhere arms its own recovery instead of holding forever", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "generation_running" } }, { status: 409 }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed then saved by hand" }));
    await act(async () => { await editor.save(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The visitor pressed Save, so they are told why nothing was written.
    expect(editor.status).toMatchObject({ kind: "error", code: "generation_running" });
    expect(editor.autosaveHold).toBe("running");
    vi.mocked(fetch).mockResolvedValueOnce(response({ draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    // The edit that preceded the manual save left a typing timer armed. The
    // recovery has to replace it with its own, longer one, or this test would
    // pass on that leftover timer and prove nothing about the refusal.
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_RETRY_MS - GEO_KB_V2_AUTOSAVE_MS); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editor.dirty).toBe(false);
    expect(editor.autosaveHold).toBeNull();
  } finally { vi.useRealTimers(); }
});
it("re-arming after an operation still refuses to write a draft the visitor never edited", async () => {
  vi.useFakeTimers();
  try {
    const view = { ...editorFixture(), requiresSave: true };
    await mount(view);
    vi.mocked(fetch).mockResolvedValueOnce(response(view));
    // Reload runs through the same lock as a save, so its release re-arms the
    // autosave. The draft still needs one write, but it is not the visitor's
    // work: writing it here would be a save nobody asked for.
    await act(async () => editor.reload());
    expect(editor.dirty).toBe(true);
    expect(editor.edited).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS * 6); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/v2/load");
  } finally { vi.useRealTimers(); }
});
it("an abandoned claim does not hold the write, because nothing can ever clear it", async () => {
  vi.useFakeTimers();
  try {
    const view = editorFixture();
    // Only `claim` reclaims an expired claimed lease, and claiming needs a
    // saved draft. Holding on this state would deadlock the knowledge base.
    await mount({ ...view, generations: { roles: { generationId: "11111111-1111-4111-8111-111111111111",
      kbId: view.kbId, kind: "roles", state: "claimed", errorReason: null, attempt: null, result: null, inputHash: "d".repeat(64) }, questions: null } });
    vi.mocked(fetch).mockResolvedValue(response({ draftVersion: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] }));
    await act(async () => editor.change({ ...editor.payload, officialName: "Typed after an abandoned claim" }));
    expect(editor.autosaveHold).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(editor.dirty).toBe(false);
  } finally { vi.useRealTimers(); }
});
