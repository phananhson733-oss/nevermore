// LOCAL ONLY: real handlers/builders/adapters with synthetic in-memory transport.
// This proves no production database, authentication or provider integration.
import { createHash } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { AiVisibilityCheck } from "../src/components/tools/ai-visibility-check.tsx";
import { canonicalProfileJson, emptyMarketingWebsiteProfile, parseMarketingWebsiteProfile, type MarketingWebsiteProfileV1, type WebsiteDetails } from "../src/lib/account-websites/contracts.ts";
import { createGeoProfileCopy, profileCopyReference } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { emptyGeoKbPayload } from "../src/lib/geo-tools/kb-contract.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "../src/lib/geo-tools/kb-v2-contract.ts";
import { geoV2Digest } from "../src/lib/geo-tools/kb-v2-digest.ts";
import { createGeoKbV2Runtime, type GeoKbV2RuntimeDependencies } from "../src/lib/geo-tools/kb-v2-runtime.ts";
import { createGeoKbGenerationPreparer } from "../src/lib/geo-tools/kb-generation-preparer.ts";
import { createGeoKbGenerationStore, type GeoKbRpcTransport } from "../src/lib/geo-tools/kb-generation-store.ts";
import type { GeoGenerationValue, GeoKbGenerationKind, GeoKbGenerationRecord } from "../src/lib/geo-tools/kb-generation.ts";
import { createGeoKbPreparedStore, saveGeoKbDraftV2, persistGeoSourceReceiptV2, readGeoSourceReceiptV2 } from "../src/lib/geo-tools/kb-prepared-store.ts";
import { parseGeoPreparedCandidate, type GeoPreparedCandidateV1 } from "../src/lib/geo-tools/kb-prepared-contract.ts";
import { readVersionedGeoKnowledgeBase, readVersionedFrozenGeoKb } from "../src/lib/geo-tools/kb-versioned-read.ts";
import { DEFAULT_GEO_KB_STORE_DEPENDENCIES } from "../src/lib/geo-tools/kb-store.ts";
import { readCompleteGeoKnowledgeBase } from "../src/lib/geo-tools/kb-complete-read.ts";
import { readVersionedGeoSnapshotContext, DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES } from "../src/lib/geo-tools/asset-context-store.ts";
import { parseGeoKbEditorViewV2, parseGeoKbFrozenV2Wire, type GeoKbFrozenV2Wire } from "../src/components/tools/geo-kb-v2-wire.ts";
import { handleGeoKbV2Load, handleGeoKbV2Draft } from "../src/lib/geo-tools/kb-v2-draft-handler.ts";
import { handleGeoKbSources } from "../src/lib/geo-tools/kb-source-handler.ts";
import { handleGeoKbGeneration, handleGeoKbGenerationRead } from "../src/lib/geo-tools/kb-generation-handler.ts";
import { handleGeoKbPreparedRead, handleGeoKbPreparedFreeze } from "../src/lib/geo-tools/kb-prepared-handler.ts";
import { verifyGeoKbSourceReportV2 } from "../src/lib/geo-tools/kb-sources.ts";
import type { GeoKbSourceReportV2 } from "../src/lib/geo-tools/kb-source-contract.ts";
import { synthesizeGeoKbRoles, synthesizeGeoKbQuestions } from "../src/lib/geo-tools/kb-synthesis.ts";
import { createKeywordLlmClient, type KeywordLlmConfig } from "../src/lib/tools/keyword-llm-client.ts";
import type { GeoRoleSynthesisInput, GeoQuestionSynthesisInput } from "../src/lib/geo-tools/kb-synthesis-contract.ts";
import { parseGeoRoleProposal } from "../src/lib/geo-tools/kb-role-proposal.ts";
import { adoptGeoKbRoleProposals } from "../src/components/tools/geo-kb-v2-editor.ts";
import { createGeoChainFixture, GEO_CHAIN_ORIGIN, GEO_CHAIN_USER } from "./geo-chain-fixtures.ts";
import type { VisibilityEngine, VisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2-contract.ts";
import { projectFrozenGeoQuestions } from "../src/lib/geo-tools/kb-consumer-projection.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2.ts";
import { observeVisibilityV2 } from "../src/lib/geo-tools/visibility-sampling-v2.ts";
import { enrichVisibilityReportV2 } from "../src/lib/geo-tools/visibility-enrich.ts";

export const GEO_V2_USER = GEO_CHAIN_USER;
export const GEO_V2_KB = "66666666-6666-4666-8666-666666666666";
export const GEO_V2_NOW = "2026-08-31T03:00:00.000Z";
const WEBSITE = "11111111-1111-4111-8111-111111111115";
const PROFILE_SNAPSHOT = "11111111-1111-4111-8111-111111111116";
const LLM_URL = "https://offline-geo-llm.test/v1/chat/completions";
const CONFIG: KeywordLlmConfig = { apiKey: "offline-fixture-only", model: "offline-model", url: LLM_URL, authScheme: "bearer", temperature: 0.2 };
const clone = <T>(value: T): T => structuredClone(value);
const hashProfile = (profile: MarketingWebsiteProfileV1) => createHash("sha256").update(canonicalProfileJson(profile)).digest("hex");
const object = (value: unknown): Record<string, unknown> => { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid offline RPC record"); return value as Record<string, unknown>; };
const scalar = (value: unknown): string => { if (typeof value !== "string") throw new Error("Invalid offline RPC scalar"); return value; };

export function renderOfflineVisibilityInitial(locale: "en" | "zh", authentication: "authenticated" | "unauthenticated" | "unavailable"): string {
  // The isolated tsx runner uses classic JSX for imported source components.
  // Supply React only during synchronous fixture rendering, never in the app.
  const scope = globalThis as typeof globalThis & { React?: typeof React }, previous = scope.React;
  scope.React = React;
  try { return renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages: locale === "zh" ? zh : en,
    children: React.createElement(AiVisibilityCheck, { locale, authentication }) })); }
  finally { if (previous === undefined) Reflect.deleteProperty(scope, "React"); else scope.React = previous; }
}
export function hydrateSafeOfflineVisibilityHtml(html: string, initial: { authenticated: string; unauthenticated: string; unavailable: string }): string {
  // The test-only Flight auth prop must agree with the exact initial HTML.
  // Render the real component in both states; do not suppress hydration errors.
  const signedOut = [initial.unauthenticated, initial.unavailable];
  const matches = signedOut.flatMap(markup => Array.from({ length: html.split(markup).length - 1 }, () => markup));
  if (matches.length !== 1) throw new Error(`Expected exactly one signed-out Visibility SSR root, got ${matches.length}`);
  return html.replace(matches[0]!, initial.authenticated);
}

function roleReply(input: GeoRoleSynthesisInput) {
  const refs = input.sources.filter(source => source.id.endsWith(":primaryIcp") || source.kind === "gsc").slice(0, 4).map(source => source.id);
  if (!refs.length) throw new Error("Missing real source catalog in role fixture");
  return { roles: [{ id: "finance-managers", label: input.displayLocale === "zh" ? "财务经理" : "Finance managers", questionLabel: "finance managers", segment: "Finance teams handling invoice follow-up", painPoints: ["manual reminders for invoices"], alternatives: ["spreadsheets"], decisionCriteria: ["audit trails"], vocabulary: ["overdue invoices"], evidenceRefs: refs }], categoryTerms: [{ text: "invoice reminder software", evidenceRefs: refs }] };
}
function questionReply(input: GeoQuestionSynthesisInput) {
  const entities = input.entities.map(entity => ({ id: entity.id, text: entity.text }));
  const entity = (kind: string, roleId: string | null = null) => {
    const found = input.entities.find(item => item.kind === kind && item.roleId === roleId);
    if (!found) throw new Error(`Missing offline question entity ${kind}`); return found;
  };
  const q = (id: string, text: string, layer: string, roleId: string | null, refs: readonly string[]) => ({ id, text, layer, roleId, entityRefs: refs,
    evidenceRefs: [...new Set(refs.flatMap(ref => input.entities.find(item => item.id === ref)!.evidenceRefs))] });
  const category = entity("category"), brand = entity("brand");
  const questions = [q("discovery", `Which ${category.text} helps teams?`, "discovery", null, [category.id]), q("branded", `What does ${brand.text} provide?`, "branded", null, [brand.id])];
  for (const role of input.roles) {
    const pain = entity("role_pain", role.id), criterion = entity("role_criterion", role.id), alternative = entity("role_alternative", role.id);
    questions.push(q(`problem-${role.id}`, `How can ${role.questionLabel} reduce ${pain.text.replace(" for ", " of ")}?`, "problem", role.id, [pain.id]));
    questions.push(q(`evaluation-${role.id}`, `How should ${role.questionLabel} evaluate ${criterion.text}?`, "evaluation", role.id, [criterion.id]));
    questions.push(q(`comparison-${role.id}`, `How does ${category.text} compare with ${alternative.text}?`, "comparison", role.id, [category.id, alternative.id]));
  }
  for (const rival of input.entities.filter(item => item.kind === "competitor")) questions.push(q(`compare-${rival.id}`, `How does ${brand.text} compare with ${rival.text}?`, "comparison", null, [brand.id, rival.id]));
  return { entities, questions };
}

export function createGeoKbV2Fixture(options: { readonly connected?: boolean } = {}) {
  let serial = 100;
  const id = () => `77777777-7777-4777-8777-${String(++serial).padStart(12, "0")}`;
  const profile: MarketingWebsiteProfileV1 = { ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: "Invoice reminders with traceable audit trails", valueProposition: "Reduce manual invoice follow-up without losing evidence", coreFeatures: ["Invoice reminders", "Audit trails"], categories: ["invoice reminder software"], primaryCta: "Create a reminder", primaryIcp: "Finance managers reduce manual invoice reminders, compare spreadsheets and audit trails, and track overdue invoices", buyer: "Finance managers", user: "Finance teams", triggerPain: "manual invoice reminders", country: "US", locale: "en-US", directCompetitors: ["rival.example"], fieldProvenance: [{ path: "/oneLinePositioning", derivation: "declared", confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] }] };
  const reference = { schemaVersion: "website-profile-reference.v1" as const, websiteId: WEBSITE, snapshotId: PROFILE_SNAPSHOT, snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: hashProfile(profile) };
  let website: WebsiteDetails = { websiteId: WEBSITE, submittedUrl: `${GEO_CHAIN_ORIGIN}/`, origin: GEO_CHAIN_ORIGIN, host: "geo-chain.test", canonicalSiteKey: "geo-chain.test", displayName: "Acme", isPrimary: true, profileState: "confirmed", confirmedSnapshotId: PROFILE_SNAPSHOT, confirmedSnapshotRevision: 1, confirmedAt: GEO_V2_NOW, createdAt: GEO_V2_NOW, updatedAt: GEO_V2_NOW,
    draft: { draftVersion: 1, updatedAt: GEO_V2_NOW, profileHash: reference.profileHash, profile: clone(profile) }, currentConfirmedSnapshot: { ...reference, confirmedAt: GEO_V2_NOW, profile: clone(profile) } };
  const profiles = new Map([[reference.profileHash, website.currentConfirmedSnapshot!]]);
  let payload = parseGeoKbPayloadV2({ ...emptyGeoKbPayload(GEO_CHAIN_ORIGIN), schemaVersion: "marketing-geo-kb.v2", profileCopy: createGeoProfileCopy(reference, profile), officialName: "Acme", aliases: ["Acme", "Acme Billing"], categoryTerms: ["invoice reminder software"], roles: [], competitors: [{ domain: "rival.example", brandName: "Rival", aliases: ["Rival Billing"], confirmed: true }, { domain: "missing-rival.example", brandName: "", aliases: [], confirmed: false }],
    facts: [{ key: "Seats", value: "The product supports three seats.", reason: "", sourceUrl: `${GEO_CHAIN_ORIGIN}/pricing`, observedAt: GEO_V2_NOW, review: "pending", supportRef: null }, { key: "Price", value: "", reason: "notPublished", sourceUrl: "", observedAt: "", review: "pending", supportRef: null }, { key: "No login", value: "No account required", reason: "", sourceUrl: "", observedAt: "", review: "pending", supportRef: null }] });
  let draftVersion = 1, frozenId: string | null = null, source: GeoKbSourceReportV2 | null = null, candidate: GeoPreparedCandidateV1 | null = null;
  let unknownNext: GeoKbGenerationKind | null = null;
  const sources = new Map<string, GeoKbSourceReportV2>(), candidates = new Map<string, GeoPreparedCandidateV1>();
  const frozenRows = new Map<string, Record<string, unknown>>(), frozenByCandidate = new Map<string, string>();
  const generations = new Map<string, { record: GeoKbGenerationRecord; key: string; claimToken: string; input: Record<string, GeoGenerationValue> }>();
  const stats = { dispatches: { roles: 0, questions: 0 }, modelCalls: { roles: 0, questions: 0 }, quota: 0, sourceCalls: [] as string[], sourceReads: [] as (string | null)[],
    structuredOutputRequests: [] as { kind: GeoKbGenerationKind; responseFormat: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } } }[], rpc: [] as string[] };
  const owned = (userId: unknown, kbId: unknown) => userId === GEO_V2_USER && kbId === GEO_V2_KB;
  const currentCopy = () => website.currentConfirmedSnapshot!;
  const currentInput = (input: Record<string, unknown>) => input.baseDraftVersion === String(draftVersion) && input.baseDraftHash === geoV2Digest(payload) && input.profileCopyHash === geoV2Digest(payload.profileCopy) && payload.profileCopy.profileHash === currentCopy().profileHash;
  const result = (outcome: string, extra: Record<string, unknown> = {}) => ({ data: [{ outcome, ...clone(extra) }], error: null });
  const rpc: GeoKbRpcTransport["callRpc"] = async (name, p) => {
    stats.rpc.push(name);
    if (!owned(p.p_user_id, p.p_kb_id)) return result("not_found");
    if (name === "marketing_geo_save_kb_draft") {
      if (p.p_base_version !== draftVersion) return result("conflict", { draft_version: draftVersion });
      const next = parseGeoKbPayloadV2(p.p_payload);
      if (next.profileCopy.profileHash !== currentCopy().profileHash) return result("profile_stale");
      if (geoV2Digest(next) !== p.p_content_hash) throw new Error("Invalid offline draft hash");
      payload = clone(next); draftVersion++;
      return result("saved", { draft_version: draftVersion, content_hash: geoV2Digest(payload), updated_at: GEO_V2_NOW });
    }
    if (name === "marketing_geo_record_enrichment") {
      source = verifyGeoKbSourceReportV2(p.p_report); sources.set(source.receiptId, clone(source)); return result("recorded");
    }
    if (name === "marketing_geo_claim_generation") {
      const key = scalar(p.p_idempotency_key), kind = p.p_kind as GeoKbGenerationKind;
      const existing = [...generations.values()].find(item => item.key === key && item.record.kind === kind);
      if (existing) return existing.record.inputHash === p.p_input_hash ? result("existing", { generation: existing.record }) : result("conflict");
      const input = object(p.p_input);
      if (!currentInput(input)) return result("input_stale");
      const record: GeoKbGenerationRecord = { generationId: id(), userId: GEO_V2_USER, kbId: GEO_V2_KB, kind, inputHash: scalar(p.p_input_hash), state: "claimed", result: null, errorReason: null, attempt: null };
      const claimToken = id(); generations.set(record.generationId, { record, claimToken, key, input: clone(input) as Record<string, GeoGenerationValue> });
      return result("claimed", { generation: record, claim_token: claimToken });
    }
    if (name === "marketing_geo_read_generation" || name === "marketing_geo_read_generation_by_key") {
      const found = name.endsWith("by_key") ? [...generations.values()].find(item => item.key === p.p_idempotency_key && item.record.kind === p.p_kind) : p.p_generation_id === null ? [...generations.values()].filter(item => item.record.kind === p.p_kind).at(-1) : generations.get(scalar(p.p_generation_id));
      return found ? result("found", { generation: found.record }) : result("not_found");
    }
    if (name === "marketing_geo_dispatch_generation" || name === "marketing_geo_finish_generation") {
      const found = generations.get(scalar(p.p_generation_id));
      if (!found || found.claimToken !== p.p_claim_token) return result("not_found");
      if (name.includes("dispatch")) {
        if (found.record.state !== "claimed") return result("existing", { generation: found.record });
        found.record = { ...found.record, state: "dispatched" }; stats.dispatches[found.record.kind]++; return result("dispatched", { generation: found.record });
      }
      if (!["claimed", "dispatched"].includes(found.record.state)) return result("existing", { generation: found.record });
      const stale = !currentInput(found.input);
      found.record = { ...found.record, state: stale ? "failed" : p.p_state as GeoKbGenerationRecord["state"], result: stale ? null : clone(p.p_result) as GeoGenerationValue,
        errorReason: stale ? "input_stale" : p.p_error_reason as GeoKbGenerationRecord["errorReason"], attempt: clone(p.p_attempt) as GeoKbGenerationRecord["attempt"] };
      if (found.record.state === "succeeded" && found.record.kind === "questions") { candidate = parseGeoPreparedCandidate(found.record.result); candidates.set(candidate.candidateId, clone(candidate)); }
      return result("finished", { generation: found.record });
    }
    if (name === "marketing_geo_freeze_prepared_kb") {
      const prepared = candidates.get(scalar(p.p_candidate_id));
      if (!prepared) return result("not_found");
      if (prepared.candidateHash !== p.p_candidate_hash) return result("candidate_mismatch");
      const old = frozenByCandidate.get(prepared.candidateId);
      if (old) { const row = frozenRows.get(old)!; return result("frozen", { snapshot_id: old, revision: row.revision, frozen_at: row.frozen_at, content_hash: prepared.baseDraftHash, reused_existing: true }); }
      if (!currentInput(prepared as unknown as Record<string, unknown>)) return result("input_stale");
      const snapshotId = id(), revision = frozenRows.size + 1;
      const row = { id: snapshotId, user_id: GEO_V2_USER, kb_id: GEO_V2_KB, revision, schema_version: prepared.payload.schemaVersion, payload: clone(prepared.payload), content_hash: prepared.baseDraftHash, question_set: clone(prepared.questionSet), question_set_hash: prepared.context.questionSetHash, context_hash: prepared.context.contentHash, frozen_at: GEO_V2_NOW, context: clone(prepared.context) };
      frozenRows.set(snapshotId, row); frozenByCandidate.set(prepared.candidateId, snapshotId); frozenId = snapshotId;
      return result("frozen", { snapshot_id: snapshotId, revision, frozen_at: GEO_V2_NOW, content_hash: prepared.baseDraftHash, reused_existing: false });
    }
    throw new Error(`Unplanned offline RPC: ${name}`);
  };
  const bundle = () => ({ knowledgeBases: [{ id: GEO_V2_KB, user_id: GEO_V2_USER, origin: GEO_CHAIN_ORIGIN, host: "geo-chain.test", canonical_site_key: "geo-chain.test", current_frozen_snapshot_id: frozenId, created_at: GEO_V2_NOW, updated_at: GEO_V2_NOW }], drafts: [{ kb_id: GEO_V2_KB, user_id: GEO_V2_USER, schema_version: payload.schemaVersion, draft_version: draftVersion, payload: clone(payload), content_hash: geoV2Digest(payload), updated_at: GEO_V2_NOW }], snapshots: frozenId ? [clone(frozenRows.get(frozenId)!)] : [] });
  const store = { ...DEFAULT_GEO_KB_STORE_DEPENDENCIES, readDetails: async (userId: string, kbId: string) => ({ kind: "ok" as const, data: owned(userId, kbId) ? bundle() : { knowledgeBases: [], drafts: [], snapshots: [] } }),
    readSnapshot: async (userId: string, kbId: string, selector: { by: "snapshotId"; snapshotId: string } | { by: "revision"; revision: number } | { by: "current" }) => ({ kind: "ok" as const, data: !owned(userId, kbId) ? null : clone(selector.by === "snapshotId" ? frozenRows.get(selector.snapshotId) ?? null : selector.by === "revision" ? [...frozenRows.values()].find(row => row.revision === selector.revision) ?? null : frozenId ? frozenRows.get(frozenId)! : null) }) };
  const readDetails: GeoKbV2RuntimeDependencies["readDetails"] = input => readVersionedGeoKnowledgeBase(input, store);
  const readComplete: GeoKbV2RuntimeDependencies["readComplete"] = input => readCompleteGeoKnowledgeBase(input, {
    readFrozen: selected => readVersionedFrozenGeoKb(selected, store), readContext: selected => readVersionedGeoSnapshotContext(selected, { ...DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES,
      readSnapshot: async (userId, kbId, snapshotId) => ({ data: owned(userId, kbId) ? clone(frozenRows.get(snapshotId) ?? null) : null, error: null }),
      readContext: async (userId, kbId, snapshotId) => { const row = owned(userId, kbId) ? frozenRows.get(snapshotId) : undefined; return { data: row ? { snapshot_id: snapshotId, user_id: userId, kb_id: kbId, content_hash: row.context_hash, context: clone(row.context) } : null, error: null }; },
    }) });
  const readSource: GeoKbV2RuntimeDependencies["readSource"] = input => readGeoSourceReceiptV2(input, async scope => { stats.sourceReads.push(scope.receiptId ?? null); const row = owned(scope.userId, scope.kbId) ? scope.receiptId ? sources.get(scope.receiptId) : source : null; return { data: row ? { id: row.receiptId, user_id: GEO_V2_USER, kb_id: GEO_V2_KB, content_hash: row.contentHash, report: clone(row) } : null, error: null }; });
  const generationStore = createGeoKbGenerationStore({ callRpc: rpc });
  const preparedStore = createGeoKbPreparedStore({ callRpc: rpc, readCandidate: async input => { const row = owned(input.userId, input.kbId) ? input.candidateId ? candidates.get(input.candidateId) : candidate : null; return { data: row ? { id: row.candidateId, user_id: GEO_V2_USER, kb_id: GEO_V2_KB, candidate_hash: row.candidateHash, candidate: clone(row) } : null, error: null }; } });
  const authenticate: GeoKbV2RuntimeDependencies["authenticate"] = async () => ({ status: "authenticated", userId: GEO_V2_USER, email: null, avatarUrl: null, googleSubject: "offline-subject" });
  const readWebsite: GeoKbV2RuntimeDependencies["readWebsite"] = async (userId, websiteId) => userId === GEO_V2_USER && websiteId === WEBSITE ? { kind: "ok", value: clone(website) } : { kind: "missing" };
  const runtime = createGeoKbV2Runtime({ authenticate, ensure: async input => owned(input.userId, GEO_V2_KB) && input.origin === GEO_CHAIN_ORIGIN ? { kind: "ok", value: { kbId: GEO_V2_KB, created: false } } : { kind: "missing" }, readDetails, readWebsite,
    readProfile: async (userId, url) => { const { confirmedAt: _time, profile: currentProfile, ...currentReference } = currentCopy(); return userId === GEO_V2_USER && new URL(url).origin === GEO_CHAIN_ORIGIN ? { kind: "ok", value: { website: clone(website), reference: currentReference, profile: clone(currentProfile) } } : { kind: "missing" }; },
    readComplete, readSource, generationStore, preparedStore, persistSource: input => persistGeoSourceReceiptV2(input, { callRpc: rpc }), saveDraft: input => saveGeoKbDraftV2(input, { readKnowledgeBase: readDetails, callRpc: rpc }), resolveConfig: () => CONFIG,
    quota: async () => { stats.quota++; return { kind: "allowed", hits: 1 }; },
    sourceTransports: { authenticate, readAsset: async () => ({ kind: "missing" }), persistReceipt: null, readIdentity: async () => options.connected === false ? null : { sub: "offline-subject" }, readGscSession: async () => ({ properties: ["sc-domain:geo-chain.test"] }), openGscGate: async () => ({ ok: true, release: () => undefined }),
      resolveGrant: async () => ({ kind: "grant", accessToken: "offline-only", properties: ["sc-domain:geo-chain.test"], propertyTotal: 1 }), readQueries: async () => ({ queries: ["manual invoice reminders", "invoice reminder software audit trails", "spreadsheet overdue invoices"], truncated: false }),
      fetchPage: async url => { stats.sourceCalls.push(url); if (url === "https://rival.example/") return { kind: "ok", url, body: '<script type="application/ld+json">{"@type":"Organization","name":"Rival","url":"https://rival.example/"}</script><meta property="og:site_name" content="Rival">', observedAt: GEO_V2_NOW };
        if (url === "https://missing-rival.example/") return { kind: "unavailable", url, reason: "fetch_failed" };
        if (url === `${GEO_CHAIN_ORIGIN}/pricing`) return { kind: "ok", url, body: "<html><h1>Seats</h1><p>The product supports three seats.</p></html>", observedAt: GEO_V2_NOW }; throw new Error(`Unplanned source fetch ${url}`); }, now: () => new Date(GEO_V2_NOW), newId: id, clientIp: () => "203.0.113.19" },
  });
  const offlineClient = (kind: GeoKbGenerationKind, output: unknown) => createKeywordLlmClient({ config: CONFIG, fetchImpl: async (url, init) => {
    if (url !== LLM_URL || ![...generations.values()].some(item => item.record.kind === kind && item.record.state === "dispatched")) throw new Error("Model fixture reached before durable dispatch");
    const request = object(JSON.parse(scalar(init?.body))), responseFormat = object(request.response_format), jsonSchema = object(responseFormat.json_schema), schema = object(jsonSchema.schema);
    if (responseFormat.type !== "json_schema" || typeof jsonSchema.name !== "string" || jsonSchema.strict !== true) throw new Error("Offline model request did not use strict structured output");
    stats.structuredOutputRequests.push({ kind, responseFormat: { type: "json_schema", json_schema: { name: jsonSchema.name, strict: true, schema: clone(schema) } } });
    stats.modelCalls[kind]++;
    if (unknownNext === kind) { unknownNext = null; throw new TypeError("Offline ambiguous provider failure"); }
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], model: "offline-model", usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 } });
  } });
  const prepare = createGeoKbGenerationPreparer({ readDetails: async input => { const value = await readDetails(input); return value.kind === "ok" ? value : { kind: "unavailable" }; }, validateCurrentProfileCopy: runtime.draft.validateCurrentCopy,
    readReceipt: async input => { const value = await readSource(input); return value.kind === "ok" && value.value ? { kind: "ok", value: value.value } : { kind: "missing" }; }, readGeneration: runtime.generation.store.read, resolveConfig: () => CONFIG,
    synthesizeRoles: (input, deps) => synthesizeGeoKbRoles(input, { ...deps, client: offlineClient("roles", roleReply(input)) }),
    synthesizeQuestions: (input, deps) => synthesizeGeoKbQuestions(input, { ...deps, client: offlineClient("questions", questionReply(input)) }),
  });
  const generation = { ...runtime.generation, prepare };
  const dispatch = (path: string, request: Request): Promise<Response> => {
    if (path === "load") return handleGeoKbV2Load(request, runtime.load);
    if (path === "draft") return handleGeoKbV2Draft(request, runtime.draft);
    if (path === "sources") return handleGeoKbSources(request, runtime.sources);
    if (path === "roles" || path === "prepare") return handleGeoKbGeneration(request, path === "roles" ? "roles" : "questions", generation);
    if (path === "generation") return handleGeoKbGenerationRead(request, generation);
    if (path === "prepared") return handleGeoKbPreparedRead(request, runtime.prepared);
    if (path === "freeze") return handleGeoKbPreparedFreeze(request, runtime.prepared);
    throw new Error(`Unplanned V2 path ${path}`);
  };
  const post = (path: string, body: unknown) => dispatch(path, new Request(`http://127.0.0.1:3027/api/tools/geo-knowledge-base/v2/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3027" }, body: JSON.stringify(body) }));
  const load = async () => { const response = await post("load", { url: GEO_CHAIN_ORIGIN }); const body = await response.json(); const view = parseGeoKbEditorViewV2(body.data); if (!response.ok || !view) throw new Error(`Offline complete load failed: ${JSON.stringify(body)}`); return view; };
  const save = (next: GeoKbPayloadV2) => post("draft", { kbId: GEO_V2_KB, baseVersion: draftVersion, payload: next, expectedProfileReference: profileCopyReference(next.profileCopy) });
  const generate = (kind: GeoKbGenerationKind, key: string) => post(kind === "roles" ? "roles" : "prepare", { kbId: GEO_V2_KB, baseVersion: draftVersion, draftHash: geoV2Digest(payload), idempotencyKey: key, displayLocale: "en", sourceReceiptRefs: source ? [{ receiptId: source.receiptId, contentHash: source.contentHash }] : [] });
  const prepareComplete = async () => {
    const sourced = await post("sources", { kbId: GEO_V2_KB }); if (!sourced.ok) throw new Error(`Sources failed ${await sourced.text()}`);
    const generated = await generate("roles", "fixture_roles_key"); const body = await generated.json(); const proposal = parseGeoRoleProposal(body.data.generation.result);
    const fact = source!.facts.find(item => item.key === "Seats"); if (fact?.status !== "available" || !fact.sourceUrl || !fact.observedAt) throw new Error("Real source fixture did not support Seats");
    const next = { ...payload, roles: adoptGeoKbRoleProposals(proposal.output.roles, proposal.generationId).map(role => ({ ...role, review: "accepted" as const })), facts: payload.facts.map(item => item.key === "Seats" ? { ...item, review: "accepted" as const, sourceUrl: fact.sourceUrl!, observedAt: fact.observedAt!, supportRef: { receiptId: source!.receiptId, evidenceId: fact.evidenceId } } : { ...item, review: item.key === "Price" ? "accepted" as const : "excluded" as const }) };
    const saved = await save(next); if (!saved.ok) throw new Error(`Save failed ${await saved.text()}`);
    const prepared = await generate("questions", "fixture_questions_key"); const response = await prepared.json(); if (response.data?.generation?.state !== "succeeded") throw new Error(`Prepare failed ${JSON.stringify(response)}`);
  };
  return { kbId: GEO_V2_KB, origin: GEO_CHAIN_ORIGIN, authenticate, readWebsite, readComplete, readSource, runtime, generation, dispatch, post, load, save, generate, prepareComplete, stats,
    publicFixture: createGeoChainFixture("A"),
    get payload() { return clone(payload); }, get website() { return clone(website); }, get currentCandidate() { return clone(candidate); },
    get currentFrozen(): GeoKbFrozenV2Wire | null { const row = frozenId ? frozenRows.get(frozenId) : null; return row ? parseGeoKbFrozenV2Wire({ kbId: GEO_V2_KB, snapshotId: row.id, revision: row.revision, frozenAt: row.frozen_at, contentHash: row.content_hash, questionSetHash: row.question_set_hash, questionCount: (row.question_set as GeoPreparedCandidateV1["questionSet"]).questions.length, payload: row.payload, questionSet: row.question_set, context: row.context }) : null; },
    failNextModel(kind: GeoKbGenerationKind) { unknownNext = kind; },
    saveProfile(next: MarketingWebsiteProfileV1) { const parsed = parseMarketingWebsiteProfile(next); website = { ...website, profileState: hashProfile(parsed) === currentCopy().profileHash ? "confirmed" : "unconfirmed_changes", draft: { draftVersion: website.draft!.draftVersion + 1, profileHash: hashProfile(parsed), profile: clone(parsed), updatedAt: GEO_V2_NOW } }; return clone(website); },
    confirmProfile() { const draft = website.draft!; let snapshot = profiles.get(draft.profileHash); if (!snapshot) { snapshot = { ...reference, snapshotId: id(), snapshotRevision: profiles.size + 1, profileHash: draft.profileHash, confirmedAt: GEO_V2_NOW, profile: clone(draft.profile) }; profiles.set(draft.profileHash, snapshot); } website = { ...website, profileState: "confirmed", confirmedSnapshotId: snapshot.snapshotId, confirmedSnapshotRevision: snapshot.snapshotRevision, confirmedAt: snapshot.confirmedAt, currentConfirmedSnapshot: clone(snapshot) }; return clone(website); },
  };
}
export type GeoKbV2Fixture = ReturnType<typeof createGeoKbV2Fixture>;
export const GEO_V2_VISIBILITY_RUN = "88888888-8888-4888-8888-888888888888";
export async function runOfflineV2Visibility(fixture: GeoKbV2Fixture, engines: readonly VisibilityEngine[], samplesPerQuestion: number): Promise<VisibilityReportV2> {
  const frozen = fixture.currentFrozen;
  if (!frozen) throw new Error("Visibility cannot run before exact freeze");
  const read = await fixture.readComplete({ userId: GEO_V2_USER, kbId: fixture.kbId, snapshotId: frozen.snapshotId });
  if (read.kind !== "ok") throw new Error("Complete frozen read unavailable");
  const questions = projectFrozenGeoQuestions(read.value.snapshot.questionSet);
  const context = { officialName: frozen.payload.officialName, aliases: frozen.payload.aliases, competitors: frozen.payload.competitors, targetHost: "geo-chain.test", marketCode: frozen.payload.market.country, language: frozen.payload.market.language };
  const plan = buildVisibilityPlan(questions, engines, samplesPerQuestion);
  const samples = await Promise.all(plan.map(item => observeVisibilityV2(context, item, { provider: { observe: async () => ({ answerText: "1. Rival\n2. Other\n\n## Audit trails\nCompare audit trail support.\n\n## Invoice reminders\nConsider manual follow-up.", webSearchPerformed: true, citationsComplete: true,
    citations: [{ url: "https://publisher.test/best-tools", title: "Best invoice tools", annotationText: null, providerOutputItemIndex: 0, sectionIndex: 0, annotationOrdinal: 0, startIndex: null, endIndex: null, spanBasis: "provider_message_section_text" }], model: "offline-fixture", modelObserved: "offline-fixture", providerTaskId: `offline-v2-${item.slotId}`, costUsd: 0, observedAt: "2026-08-31T03:00:30.000Z" }) } })));
  const report = createVisibilityReportV2({ runId: GEO_V2_VISIBILITY_RUN, kbId: frozen.kbId, snapshotId: frozen.snapshotId, snapshotRevision: frozen.revision, questionSetHash: frozen.questionSetHash,
    startedAt: GEO_V2_NOW, finishedAt: "2026-08-31T03:01:00.000Z", context, questions, samples, engines, samplesPerQuestion });
  return enrichVisibilityReportV2(report, { fetchResource: fixture.publicFixture.fetchResource, renderPage: fixture.publicFixture.renderPage, now: () => new Date("2026-08-31T03:01:00.000Z") });
}
