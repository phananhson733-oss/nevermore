"use client";
// @input -- server-owned editor DTO and monotonic observations of the parent Profile
// @output -- detached edits plus explicit save/source/generate/review/freeze actions
// @pos -- no automatic provider retries and no saved response overwrites later input
import { useEffect, useRef, useState } from "react";
import { createGeoProfileCopy, profileCopyReference, type GeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { canonicalGeoV2Text } from "../../lib/geo-tools/kb-v2-json.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoKbGenerationKind } from "../../lib/geo-tools/kb-generation.ts";
import type { GeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { parseGeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
import { parseGeoKbDraftSaveV2, parseGeoKbFreezeV2Response, parseGeoKbEditorViewV2, parseGeoKbGenerationWire, type GeoKbEditorViewV2, type GeoKbGenerationWire } from "./geo-kb-v2-wire.ts";
import { adoptGeoKbRoleProposals, submitGeoKbPayloadV2 } from "./geo-kb-v2-editor.ts";
import { ACCOUNT_AUTOSAVE_DELAY_MS } from "../account/autosave-delay.ts";

export const GEO_KB_V2_API = "/api/tools/geo-knowledge-base/v2/";
export const GEO_KB_V2_AUTOSAVE_MS = ACCOUNT_AUTOSAVE_DELAY_MS;
/** Retry cadence when the server reports a generation running in another tab; this tab cannot observe it end. */
export const GEO_KB_V2_AUTOSAVE_RETRY_MS = 5_000;
/** Why an automatic write is being held back, for the editor to say so. */
export type GeoKbV2AutosaveHold = "conflict" | "copyStale" | "running" | "busy";
type Operation = "save" | "load" | "sources" | "roles" | "questions" | "freeze" | "copy";
interface Pending { readonly idempotencyKey: string; readonly draftHash: string; readonly baseVersion: number; readonly generationId: string | null; readonly inputIdentity?: string; readonly sourceSequence?: number; readonly settled?: boolean; readonly readNotFound?: boolean; readonly knownState?: string }
type PendingSet = Readonly<Record<GeoKbGenerationKind, Pending | null>>;
export interface RetainedGeoKbRequest { readonly id: string; readonly kind: GeoKbGenerationKind; readonly idempotencyKey: string | null; readonly generationId: string | null; readonly inputIdentity: string | null; readonly draftHash: string | null; readonly baseVersion: number; readonly state: string; readonly errorReason: string | null }
type GenerationAction = "normal" | "read_only" | "new_input" | "resend_same";
export type GeoKbV2EditorStatus = { readonly kind: "idle" | "saved" } | { readonly kind: "busy"; readonly operation: Operation } | { readonly kind: "error"; readonly code: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const storageKey = (kbId: string, kind: GeoKbGenerationKind) => `gg:geo-kb-generation:${kbId}:${kind}`;
const historyKey = (kbId: string) => `gg:geo-kb-generation:${kbId}:history`;
const unresolved = (state: string | undefined) => ["claimed", "dispatched", "uncertain", "unknown", "not_found"].includes(state ?? "");
function normalizedRequestIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? canonicalGeoV2Text(parsed) : undefined; } catch { return undefined; }
}
function sameGenerationBasis(left: string | null | undefined, right: string): boolean {
  if (left === null || left === undefined) return false;
  try {
    const { baseVersion: _leftCas, ...a } = JSON.parse(left) as Record<string, unknown>;
    const { baseVersion: _rightCas, ...b } = JSON.parse(right) as Record<string, unknown>;
    return canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
  } catch { return false; }
}
function storedHistory(kbId: string): readonly RetainedGeoKbRequest[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(historyKey(kbId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RetainedGeoKbRequest => record(item) && typeof item.id === "string" && ["roles", "questions"].includes(String(item.kind)) && (item.idempotencyKey === null || typeof item.idempotencyKey === "string") && (item.generationId === null || typeof item.generationId === "string") && (item.inputIdentity === null || typeof item.inputIdentity === "string") && (item.draftHash === null || hash(item.draftHash)) && typeof item.baseVersion === "number" && Number.isSafeInteger(item.baseVersion) && typeof item.state === "string" && (item.errorReason === null || typeof item.errorReason === "string")).map(item => ({ ...item, inputIdentity: normalizedRequestIdentity(item.inputIdentity) ?? null }));
  } catch { return []; }
}
const same = (left: unknown, right: unknown) => canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
/** One source selection for UI, request identity, generation and candidate checks. */
export function currentGeoKbSourceSelection(view: GeoKbEditorViewV2, payload: GeoKbPayloadV2) {
  const stored = view.sourceReceipt;
  const receipt = stored && stored.kbId === view.kbId && stored.targetHost === view.host && same(stored.profileReference, profileCopyReference(payload.profileCopy)) ? stored : null;
  return { receipt, stale: stored !== null && receipt === null, refs: receipt ? [{ receiptId: receipt.receiptId, contentHash: receipt.contentHash }] : [] };
}
function storedPending(kbId: string, kind: GeoKbGenerationKind, includeSettled = false): Pending | null {
  try { const raw: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(kbId, kind)) ?? "null");
    const identity = record(raw) ? normalizedRequestIdentity(raw.inputIdentity) : undefined;
    return record(raw) && (includeSettled || raw.settled !== true) && typeof raw.idempotencyKey === "string" && /^[a-zA-Z0-9_-]{8,128}$/u.test(raw.idempotencyKey) && hash(raw.draftHash) && typeof raw.baseVersion === "number" && Number.isSafeInteger(raw.baseVersion) && raw.baseVersion > 0 && (raw.generationId === null || typeof raw.generationId === "string")
      ? { idempotencyKey: raw.idempotencyKey, draftHash: raw.draftHash, baseVersion: raw.baseVersion, generationId: raw.generationId, readNotFound: raw.readNotFound === true, ...(typeof raw.knownState === "string" ? { knownState: raw.knownState } : {}), ...(identity === undefined ? {} : { inputIdentity: identity }), sourceSequence: typeof raw.sourceSequence === "number" && Number.isSafeInteger(raw.sourceSequence) ? raw.sourceSequence : 0 } : null;
  } catch { return null; }
}
function persistPending(kbId: string, kind: GeoKbGenerationKind, value: Pending | null): boolean {
  try { if (value === null) window.sessionStorage.removeItem(storageKey(kbId, kind)); else window.sessionStorage.setItem(storageKey(kbId, kind), JSON.stringify(value)); return true; } catch { return false; }
}
async function post(path: string, body: unknown): Promise<{ readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly code: string; readonly draftVersion?: number }> {
  try {
    const response = await fetch(`${GEO_KB_V2_API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const bodyValue: unknown = await response.json();
    if (!record(bodyValue)) return { ok: false, code: "bad_response" };
    if (response.ok) return Object.hasOwn(bodyValue, "data") ? { ok: true, data: bodyValue.data } : { ok: false, code: "bad_response" };
    return { ok: false, code: record(bodyValue.error) && typeof bodyValue.error.code === "string" ? bodyValue.error.code : "bad_response",
      ...(typeof bodyValue.draftVersion === "number" && Number.isSafeInteger(bodyValue.draftVersion) && bodyValue.draftVersion >= 0 ? { draftVersion: bodyValue.draftVersion } : {}) };
  } catch { return { ok: false, code: "network" }; }
}
export interface UseGeoKbV2EditorProps {
  readonly initialView: GeoKbEditorViewV2; readonly locale: string; readonly confirmedProfileRevision?: number; readonly canonicalWebsiteId?: string;
}
export function useGeoKbV2Editor({ initialView, locale, confirmedProfileRevision, canonicalWebsiteId }: UseGeoKbV2EditorProps) {
  const [view, setView] = useState(initialView), [payload, setPayload] = useState(initialView.payload);
  const [dirty, setDirty] = useState(initialView.requiresSave), [status, setStatus] = useState<GeoKbV2EditorStatus>({ kind: "idle" });
  // A draft can need saving without anyone having typed: an older stored format
  // is upgraded for display, and a conflict re-bases the version. Those still
  // block generation, but telling the visitor they have unsaved edits is false.
  const [edited, setEdited] = useState(false);
  const [copyProposal, setCopyProposal] = useState<GeoProfileCopy | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [signal, setSignal] = useState({ revision: confirmedProfileRevision, sequence: 0 });
  const [reviewedSequence, setReviewedSequence] = useState(0);
  const [copyHashNeedsReload, setCopyHashNeedsReload] = useState(false);
  const [pending, setPending] = useState<PendingSet>({ roles: null, questions: null });
  const [retainedRequests, setRetainedRequests] = useState<readonly RetainedGeoKbRequest[]>([]);
  const historyRef = useRef<readonly RetainedGeoKbRequest[]>([]), unknownBaselines = useRef(new Map<string, { version: number; hash: string | null }>());
  const current = useRef({ view, payload, dirty, edited: false, pending, signal, copyStale: false }), lock = useRef(false), editRevision = useRef(0), invalidCandidates = useRef(new Set<string>()), copySequence = useRef(0);
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A 409 re-bases the version so the next write can succeed. Before autosave
  // that next write was always a person pressing Save after reading the
  // conflict; an automatic write would turn the re-base into a silent
  // last-writer-wins over another session. Held until a manual save.
  const conflictHold = useRef(false);
  // The server refused a write because a generation is running for this kb
  // in a tab this one cannot see. Shown as the same "running" hold; retried.
  const runningElsewhere = useRef(false);
  // Canonical text of what the server holds, so a type-then-backspace pause
  // does not write an identical draft, bump the version, and stale a candidate.
  const lastSaved = useRef<string | null>(initialView.requiresSave ? null : canonicalGeoV2Text(submitGeoKbPayloadV2(initialView.payload)));
  current.current = { view, payload, dirty, edited, pending, signal, copyStale: current.current.copyStale };
  useEffect(() => {
    // Server and first hydration render both use only the server DTO. Browser
    // recovery is restored after mount without sending a request.
    const recovered = { roles: storedPending(initialView.kbId, "roles"), questions: storedPending(initialView.kbId, "questions") };
    current.current.pending = recovered; setPending(recovered);
    historyRef.current = storedHistory(initialView.kbId); setRetainedRequests(historyRef.current);
  }, [initialView.kbId]);
  if (signal.revision !== confirmedProfileRevision) {
    if (view.prepared) invalidCandidates.current.add(view.prepared.candidateId);
    const next = { revision: confirmedProfileRevision, sequence: signal.sequence + 1 };
    current.current.signal = next; setSignal(next); setReview(null);
  }
  const sourceCopy = payload.profileCopy;
  const copyStale = signal.sequence !== reviewedSequence || (view.profile !== null && (sourceCopy.snapshotId !== view.profile.reference.snapshotId || sourceCopy.profileHash !== view.profile.reference.profileHash));
  current.current.copyStale = copyStale;
  const copyHashReady = !copyHashNeedsReload && same(sourceCopy, view.payload.profileCopy);
  const sourceSelection = currentGeoKbSourceSelection(view, payload);
  const candidate = view.prepared;
  const candidateStale = candidate !== null && (dirty || view.requiresSave || copyStale || candidate.baseDraftHash !== view.draftHash || Number(candidate.baseDraftVersion) !== view.draftVersion || invalidCandidates.current.has(candidate.candidateId) ||
    !sourceSelection.refs.every(selected => candidate.sourceReceiptRefs.some(ref => same(ref, selected))));
  const busy = status.kind === "busy";
  const canGenerate = !busy && !dirty && !view.requiresSave && !copyStale && copyHashReady && view.draftVersion > 0 && view.draftHash !== null;
  const needsReview = payload.roles.some(role => role.review === "pending") || payload.facts.some(fact => fact.review === "pending");
  const canPrepare = canGenerate && !needsReview;
  for (const kind of ["roles", "questions"] as const) {
    const generation = view.generations[kind];
    if (generation && unresolved(generation.state) && !unknownBaselines.current.has(generation.generationId)) unknownBaselines.current.set(generation.generationId, { version: view.draftVersion, hash: view.draftHash });
  }
  function requestInput(kind: GeoKbGenerationKind) {
    const active = current.current, sourceReceiptRefs = currentGeoKbSourceSelection(active.view, active.payload).refs;
    const displayLocale = locale.toLowerCase().startsWith("zh") ? "zh" as const : "en" as const;
    const body = { kbId: active.view.kbId, baseVersion: active.view.draftVersion, draftHash: active.view.draftHash!, sourceReceiptRefs, displayLocale };
    return { body, identity: canonicalGeoV2Text({ kind, ...body }) };
  }
  function generationAction(kind: GeoKbGenerationKind): GenerationAction {
    if (!(kind === "questions" ? canPrepare : canGenerate) || current.current.dirty) return "read_only";
    const identity = requestInput(kind).identity, held = current.current.pending[kind];
    const historical = historyRef.current.find(item => item.kind === kind && sameGenerationBasis(item.inputIdentity, identity) && unresolved(item.state));
    if (historical) return historical.inputIdentity === identity && historical.state === "not_found" && historical.generationId === null && historical.idempotencyKey !== null ? "resend_same" : "read_only";
    if (held) {
      if (held.inputIdentity === identity) return held.generationId === null && held.readNotFound === true ? "resend_same" : "read_only";
      if (held.inputIdentity !== undefined) return sameGenerationBasis(held.inputIdentity, identity) ? "read_only" : "new_input";
      return view.draftVersion > held.baseVersion && view.draftHash !== held.draftHash ? "new_input" : "read_only";
    }
    const generation = current.current.view.generations[kind];
    if (!generation || !unresolved(generation.state)) return "normal";
    const baseline = unknownBaselines.current.get(generation.generationId);
    return baseline && view.draftVersion > baseline.version && view.draftHash !== baseline.hash ? "new_input" : "read_only";
  }
  const candidateIdentity = candidate === null ? null : `${candidate.candidateId}:${candidate.candidateHash}`;
  const canFreeze = !busy && candidate !== null && !candidateStale && review === candidateIdentity;
  // Warn about leaving only for a visitor's own edits. A draft that merely
  // needs one save (never stored, or an older format) is not their work, and
  // autosave deliberately never writes it, so a dialog for it would fire on
  // every navigation away from every never-saved knowledge base.
  useEffect(() => { if (!edited) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [edited]);

  /**
   * A run the server is still executing. The lock is released as soon as the
   * dispatch POST returns, but the run itself continues, still bound to the
   * draft version it was sent with; writing a new version under it makes its
   * paid result unusable. An uncertain or unknown outcome is not "running":
   * the editor's own recovery copy tells the visitor to save a new version,
   * and holding the write would contradict that.
   */
  const running = (state: string | undefined) => state === "claimed" || state === "dispatched";
  function generationRunningNow(): boolean {
    return (["roles", "questions"] as const).some(kind => running(current.current.view.generations[kind]?.state));
  }
  const generationRunning = (["roles", "questions"] as const).some(kind => running(view.generations[kind]?.state));
  function autosaveHoldNow(): GeoKbV2AutosaveHold | null {
    if (conflictHold.current) return "conflict";
    // Every write would fail with context_stale until the copy is adopted.
    if (current.current.copyStale) return "copyStale";
    if (lock.current) return "busy";
    return generationRunningNow() || runningElsewhere.current ? "running" : null;
  }
  const autosaveHold: GeoKbV2AutosaveHold | null = conflictHold.current ? "conflict" : copyStale ? "copyStale" : busy ? "busy" : generationRunning || runningElsewhere.current ? "running" : null;
  /**
   * Only a real edit schedules a write. A draft that merely needs one save
   * after a format upgrade or a version conflict is left alone: persisting it
   * on load would be a write nobody asked for. A held write is not polled
   * for; whatever lifts the hold re-arms it.
   */
  function scheduleAutosave(delay = GEO_KB_V2_AUTOSAVE_MS) {
    if (autosave.current !== null) clearTimeout(autosave.current);
    autosave.current = setTimeout(() => {
      autosave.current = null;
      // A retry after a remote-generation refusal asks the server again; the
      // server, not this tab, knows whether that run has ended.
      if (delay === GEO_KB_V2_AUTOSAVE_RETRY_MS) runningElsewhere.current = false;
      if (!current.current.dirty || autosaveHoldNow() !== null) return;
      // A row the visitor is still filling in (an added fact with no key yet,
      // half a URL) does not parse. That is not an error to announce on a
      // cadence; the draft simply stays unsaved until it does, or until Save.
      try { parseGeoKbPayloadV2(submitGeoKbPayloadV2(current.current.payload)); } catch { return; }
      void persist(true);
    }, GEO_KB_V2_AUTOSAVE_MS);
  }
  function resumeAutosave() { if (current.current.dirty && autosave.current === null && autosaveHoldNow() === null) scheduleAutosave(); }
  useEffect(() => () => {
    if (autosave.current !== null) clearTimeout(autosave.current);
    // Leaving by client-side navigation skips beforeunload. A pending edit is
    // flushed with a request the browser keeps alive after the page is gone;
    // the server's version check still refuses a stale write.
    if (!current.current.dirty || !current.current.edited || autosaveHoldNow() !== null) return;
    let submitted: GeoKbPayloadV2;
    try { submitted = parseGeoKbPayloadV2(submitGeoKbPayloadV2(current.current.payload)); } catch { return; }
    if (canonicalGeoV2Text(submitted) === lastSaved.current) return;
    const base = current.current.view;
    // Fire and forget: nothing can be shown afterwards, and a thrown or
    // non-promise fetch (a test double, a closed page) must not surface here.
    try {
      void Promise.resolve(fetch(`${GEO_KB_V2_API}draft`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ kbId: base.kbId, baseVersion: base.draftVersion, payload: submitted, expectedProfileReference: base.profile?.reference ?? null }) })).catch(() => undefined);
    } catch { /* unmount must never throw */ }
  }, []);
  function change(next: GeoKbPayloadV2) { editRevision.current++; current.current.payload = next; current.current.dirty = true; setPayload(next); setDirty(true); setEdited(true); setReview(null); setStatus(previous => previous.kind === "saved" ? { kind: "idle" } : previous); scheduleAutosave(); }
  function setRequest(kind: GeoKbGenerationKind, value: Pending | null) {
    const previous = current.current.pending[kind];
    if (value !== null) persistPending(view.kbId, kind, value);
    else if (previous) persistPending(view.kbId, kind, { ...previous, settled: true });
    const next = { ...current.current.pending, [kind]: value }; current.current.pending = next; setPending(next);
  }
  function saveHistory(next: readonly RetainedGeoKbRequest[]): boolean {
    try { window.sessionStorage.setItem(historyKey(view.kbId), JSON.stringify(next)); historyRef.current = next; setRetainedRequests(next); return true; } catch { return false; }
  }
  function retainPrevious(kind: GeoKbGenerationKind): boolean {
    const held = current.current.pending[kind], generation = current.current.view.generations[kind];
    if (!held && (!generation || !unresolved(generation.state))) return true;
    const id = held?.generationId ?? generation?.generationId ?? null, key = held?.idempotencyKey ?? null;
    const baseline = id ? unknownBaselines.current.get(id) : undefined;
    const entry: RetainedGeoKbRequest = { id: `${kind}:${key ?? id}`, kind, idempotencyKey: key, generationId: held ? held.generationId : id, inputIdentity: held?.inputIdentity ?? null, draftHash: held?.draftHash ?? baseline?.hash ?? null, baseVersion: held?.baseVersion ?? baseline?.version ?? view.draftVersion, state: held?.knownState ?? (held && held.generationId !== generation?.generationId ? "unknown" : generation?.state ?? "unknown"), errorReason: generation?.errorReason ?? null };
    return saveHistory([...historyRef.current.filter(item => item.id !== entry.id), entry]);
  }
  async function perform(operation: Operation, work: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setStatus({ kind: "busy", operation });
    try { await work(); } catch { setStatus({ kind: "error", code: "bad_response" }); }
    finally { lock.current = false; setStatus(previous => previous.kind === "busy" ? { kind: "idle" } : previous); resumeAutosave(); }
  }
  function error(result: { readonly code: string; readonly draftVersion?: number }) {
    if (result.code === "conflict") {
      conflictHold.current = true;
      if (result.draftVersion !== undefined) setView(previous => ({ ...previous, draftVersion: result.draftVersion!, requiresSave: true }));
    }
    setStatus({ kind: "error", code: result.code });
  }
  function acceptGeneration(generation: GeoKbGenerationWire) {
    if (generation.kbId !== current.current.view.kbId) throw new Error("Foreign generation");
    const existing = current.current.pending[generation.kind];
    if (generation.result?.schemaVersion === "marketing-geo-prepared-candidate.v1" && existing && existing.sourceSequence !== current.current.signal.sequence) invalidCandidates.current.add(generation.result.candidateId);
    if (existing) {
      // A latest record can belong to another explicit input/key. Only the
      // dispatch response or the exact-key read may establish this linkage.
      const belongs = existing.generationId === generation.generationId;
      if (belongs) setRequest(generation.kind, generation.state === "succeeded" || generation.state === "failed" ? null : { ...existing, generationId: generation.generationId, knownState: generation.state, readNotFound: false });
    }
    setView(previous => ({ ...previous, generations: { ...previous.generations, [generation.kind]: generation },
      ...(generation.state === "succeeded" && generation.result?.schemaVersion === "marketing-geo-prepared-candidate.v1" ? { prepared: generation.result } : {}) }));
    current.current.view = { ...current.current.view, generations: { ...current.current.view.generations, [generation.kind]: generation } };
    if (!running(generation.state)) resumeAutosave();
    setReview(null);
  }
  async function readSaved() {
    const start = editRevision.current, wasDirty = current.current.dirty;
    const result = await post("load", { url: view.origin }); if (!result.ok) { error(result); return false; }
    const loaded = parseGeoKbEditorViewV2(result.data);
    if (!loaded || loaded.kbId !== view.kbId) { error({ code: "schema_mismatch" }); return false; }
    if (loaded.prepared?.candidateId !== current.current.view.prepared?.candidateId || loaded.prepared?.candidateHash !== current.current.view.prepared?.candidateHash) setReview(null);
    current.current.view = loaded; setView(loaded); setCopyHashNeedsReload(false);
    lastSaved.current = loaded.requiresSave ? null : canonicalGeoV2Text(submitGeoKbPayloadV2(loaded.payload));
    if (!wasDirty && editRevision.current === start) { current.current.payload = loaded.payload; current.current.dirty = loaded.requiresSave; setPayload(loaded.payload); setDirty(loaded.requiresSave); setEdited(false); }
    for (const kind of ["roles", "questions"] as const) if (loaded.generations[kind]) acceptGeneration(loaded.generations[kind]!);
    return true;
  }
  const reload = () => perform("load", async () => { await readSaved(); });
  const save = () => { conflictHold.current = false; return persist(false); };
  const persist = (automatic: boolean) => perform("save", async () => {
    let submitted: GeoKbPayloadV2;
    try { submitted = parseGeoKbPayloadV2(submitGeoKbPayloadV2(current.current.payload)); } catch { error({ code: "invalid_input" }); return; }
    const version = editRevision.current;
    const canonical = canonicalGeoV2Text(submitted);
    // An automatic write of what the server already holds is churn: it bumps
    // the version and stales a prepared candidate for a type-then-backspace.
    // A deliberate Save keeps its existing meaning of advancing the version.
    if (automatic && canonical === lastSaved.current && current.current.view.draftHash !== null) {
      // Nothing to write: the server already holds exactly this.
      const newer = editRevision.current !== version; current.current.dirty = newer; setDirty(newer); setEdited(newer);
      setStatus({ kind: newer ? "idle" : "saved" }); return;
    }
    // Read the version from the ref, not from this render's `view`. Autosave
    // fires from a timer created one render earlier, so a closure read would
    // address a version the server has already moved past and answer 409 to a
    // visitor who was only typing.
    const base = current.current.view;
    const copyChanged = !same(submitted.profileCopy, base.payload.profileCopy);
    const result = await post("draft", { kbId: base.kbId, baseVersion: base.draftVersion, payload: submitted, expectedProfileReference: base.profile?.reference ?? null });
    if (!result.ok && result.code === "generation_running") {
      runningElsewhere.current = true; setStatus({ kind: "idle" });
      if (automatic) scheduleAutosave(GEO_KB_V2_AUTOSAVE_RETRY_MS); else error(result);
      return;
    }
    if (!result.ok) { error(result); return; }
    runningElsewhere.current = false;
    const data = parseGeoKbDraftSaveV2(result.data);
    if (!data) { error({ code: "schema_mismatch" }); return; }
    const next = { ...current.current.view, draftVersion: data.draftVersion, draftHash: data.contentHash, payload: submitted, requiresSave: false };
    current.current.view = next; setView(next); lastSaved.current = canonical;
    const newer = editRevision.current !== version; current.current.dirty = newer; setDirty(newer); setEdited(newer);
    if (copyChanged) { setCopyHashNeedsReload(true); if (!(await readSaved())) return; }
    setStatus({ kind: current.current.dirty ? "idle" : "saved" });
  });
  const refreshSources = async () => { if (!canGenerate || current.current.dirty) return; await perform("sources", async () => {
    const startVersion = view.draftVersion, startHash = view.draftHash;
    const result = await post("sources", { kbId: view.kbId }); if (!result.ok) { error(result); return; }
    let receipt; try { receipt = parseGeoKbSourceReportV2(result.data); } catch { error({ code: "schema_mismatch" }); return; }
    if (receipt.kbId !== view.kbId || receipt.targetHost !== view.host || receipt.draftVersion !== startVersion || receipt.draftHash !== startHash) { error({ code: "input_stale" }); return; }
    if (view.prepared && !same(currentGeoKbSourceSelection({ ...view, sourceReceipt: receipt }, current.current.payload).refs, sourceSelection.refs)) invalidCandidates.current.add(view.prepared.candidateId);
    setView(previous => ({ ...previous, sourceReceipt: receipt })); setReview(null);
  }); };
  const generate = async (kind: GeoKbGenerationKind, action: Exclude<GenerationAction, "read_only"> = "normal") => {
    if (generationAction(kind) !== action) return;
    await perform(kind, async () => {
      const saved = storedPending(view.kbId, kind, true);
      const input = requestInput(kind), inputIdentity = input.identity;
      const historical = historyRef.current.find(item => item.kind === kind && item.inputIdentity === inputIdentity && item.idempotencyKey !== null);
      const held = current.current.pending[kind];
      const key = held?.inputIdentity === inputIdentity ? held.idempotencyKey : saved?.inputIdentity === inputIdentity ? saved.idempotencyKey : historical?.idempotencyKey ?? crypto.randomUUID();
      if (action !== "normal" && held?.inputIdentity !== inputIdentity && !retainPrevious(kind)) { error({ code: "recovery_unavailable" }); return; }
      if (action === "new_input" && held?.idempotencyKey === key) return;
      const request: Pending = { idempotencyKey: key, inputIdentity, draftHash: input.body.draftHash, baseVersion: input.body.baseVersion, generationId: null, sourceSequence: current.current.signal.sequence };
      // Record identity before dispatch. If recovery storage is unavailable, do not start a potentially billed request.
      if (!persistPending(view.kbId, kind, request)) { error({ code: "recovery_unavailable" }); return; } setRequest(kind, request);
      const result = await post(kind === "roles" ? "roles" : "prepare", { ...input.body, idempotencyKey: request.idempotencyKey });
      if (!result.ok) { if (["model_unavailable", "unsupported_language", "invalid_input", "input_stale", "invalid_request", "auth_required", "not_found", "conflict"].includes(result.code)) setRequest(kind, null); error(result); return; }
      const parsed = record(result.data) ? parseGeoKbGenerationWire(result.data.generation) : null;
      if (!parsed || parsed.kind !== kind || parsed.kbId !== view.kbId) { error({ code: "schema_mismatch" }); return; }
      if (parsed.result?.schemaVersion === "marketing-geo-prepared-candidate.v1" && request.sourceSequence === current.current.signal.sequence) invalidCandidates.current.delete(parsed.result.candidateId);
      setRequest(kind, { ...request, generationId: parsed.generationId }); acceptGeneration(parsed);
    });
  };
  const readGeneration = (kind: GeoKbGenerationKind) => perform("load", async () => {
    const request = current.current.pending[kind];
    const id = request?.generationId ?? (request === null ? current.current.view.generations[kind]?.generationId : undefined);
    if (!id && !request) { await readSaved(); return; }
    const result = await post("generation", id ? { kbId: view.kbId, generationId: id } : { kbId: view.kbId, kind, idempotencyKey: request!.idempotencyKey });
    if (!result.ok) { if (!id && request && result.code === "not_found") setRequest(kind, { ...request, readNotFound: true }); error(result); return; }
    const parsed = record(result.data) ? parseGeoKbGenerationWire(result.data.generation) : null;
    if (!parsed || parsed.kind !== kind || parsed.kbId !== view.kbId || id !== undefined && parsed.generationId !== id) { error({ code: "schema_mismatch" }); return; }
    if (request) setRequest(kind, { ...request, generationId: parsed.generationId }); acceptGeneration(parsed);
  });
  const readRetainedRequest = (entry: RetainedGeoKbRequest) => perform("load", async () => {
    const owned = historyRef.current.find(item => item.id === entry.id); if (!owned) return;
    const body = owned.generationId ? { kbId: view.kbId, generationId: owned.generationId } : { kbId: view.kbId, kind: owned.kind, idempotencyKey: owned.idempotencyKey };
    const result = await post("generation", body);
    if (!result.ok) { if (!owned.generationId && result.code === "not_found") saveHistory(historyRef.current.map(item => item.id === owned.id ? { ...item, state: "not_found" } : item)); error(result); return; }
    const generation = record(result.data) ? parseGeoKbGenerationWire(result.data.generation) : null;
    if (!generation || generation.kind !== owned.kind || generation.kbId !== view.kbId || owned.generationId !== null && generation.generationId !== owned.generationId) { error({ code: "schema_mismatch" }); return; }
    saveHistory(historyRef.current.map(item => item.id === owned.id ? { ...item, generationId: generation.generationId, state: generation.state, errorReason: generation.errorReason } : item));
  });
  const reviewProfileCopy = () => perform("copy", async () => {
    const sequence = current.current.signal.sequence;
    const result = await post("load", { url: view.origin }); if (!result.ok) { error(result); return; }
    const loaded = parseGeoKbEditorViewV2(result.data), profile = loaded?.profile;
    if (!loaded || loaded.kbId !== view.kbId || !profile?.fullProfile || canonicalWebsiteId !== undefined && profile.reference.websiteId !== canonicalWebsiteId) { error({ code: "schema_mismatch" }); return; }
    const proposal = createGeoProfileCopy(profile.reference, profile.fullProfile);
    setView(previous => ({ ...previous, profile })); copySequence.current = sequence; setCopyProposal(proposal);
    if (sequence === current.current.signal.sequence && proposal.snapshotId === current.current.payload.profileCopy.snapshotId && proposal.profileHash === current.current.payload.profileCopy.profileHash) setReviewedSequence(sequence);
  });
  function adoptProfileCopy() {
    if (!copyProposal || copySequence.current !== current.current.signal.sequence) return;
    const changed = copyProposal.snapshotId !== current.current.payload.profileCopy.snapshotId || copyProposal.profileHash !== current.current.payload.profileCopy.profileHash;
    // Adopting the copy already held is not an edit. Treating it as one would
    // bump the draft version and stale a prepared candidate for nothing.
    if (!changed && same(copyProposal, current.current.payload.profileCopy)) { setReviewedSequence(copySequence.current); setCopyProposal(null); return; }
    change({ ...current.current.payload, profileCopy: copyProposal,
      ...(changed ? { roles: current.current.payload.roles.map(role => ({ ...role, review: "pending" as const })), facts: current.current.payload.facts.map(fact => ({ ...fact, review: "pending" as const })) } : {}) });
    setReviewedSequence(copySequence.current); setCopyProposal(null);
  }
  function roleProposalReusable(proposal: GeoRoleProposal) {
    return copyHashReady && !copyStale && proposal.profileCopyHash === view.profileCopyHash && proposal.input.officialName === current.current.payload.officialName && proposal.input.questionLanguage === current.current.payload.market.language;
  }
  function adoptRoles(proposal: GeoRoleProposal, ids: readonly string[], mode: "append" | "replace_selected" | "replace_all" = "append") {
    const stored = view.generations.roles;
    if (stored?.state !== "succeeded" || stored.result?.schemaVersion !== "marketing-geo-role-proposal.v1" || stored.result.contentHash !== proposal.contentHash || !roleProposalReusable(stored.result)) return;
    const selected = stored.result.output.roles.filter(role => ids.includes(role.id));
    if (selected.length !== ids.length || selected.length === 0 || mode === "replace_all" && selected.length !== stored.result.output.roles.length) return;
    const adopted = adoptGeoKbRoleProposals(selected, stored.result.generationId), existing = current.current.payload.roles;
    if (mode === "append" && existing.some(role => ids.includes(role.id))) return;
    const roles = mode === "replace_all" ? adopted : [...existing.map(role => mode === "replace_selected" ? adopted.find(item => item.id === role.id) ?? role : role), ...adopted.filter(role => !existing.some(item => item.id === role.id))];
    if (roles.length > 5) return;
    change({ ...current.current.payload, roles });
  }
  const freeze = async () => { if (!canFreeze || current.current.dirty || !candidate) return; await perform("freeze", async () => {
    const result = await post("freeze", { kbId: view.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash });
    if (!result.ok) { error(result); return; }
    const data = parseGeoKbFreezeV2Response(result.data);
    if (!data) { error({ code: "schema_mismatch" }); return; }
    setReview(null); await readSaved();
  }); };
  return { view, payload, dirty, edited, status, busy, generationRunning, autosaveHold, pending, retainedRequests, readRetainedRequest, generationAction, copyProposal, copyStale, copyHashReady, sourceSelection, roleProposalReusable, canAdoptProfileCopy: copyProposal !== null && copySequence.current === signal.sequence, candidateStale, canGenerate, canPrepare, needsReview, canFreeze, reviewed: review === candidateIdentity && candidateIdentity !== null,
    change, save, reload, refreshSources, generate, readGeneration, freeze, reviewProfileCopy, adoptProfileCopy, adoptRoles,
    dismissProfileCopy: () => setCopyProposal(null), confirmReview: (accepted: boolean) => setReview(accepted && !candidateStale ? candidateIdentity : null) };
}
