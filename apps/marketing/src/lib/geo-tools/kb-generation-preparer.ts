// @input -- authenticated saved-draft identities and owner-scoped source readers
// @output -- secret-free durable input and a deferred single-invocation closure
// @pos -- business preflight only; no routes, environment lookup or store wiring
import { createHash } from "node:crypto";
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { profileCopyReference, type GeoProfileCopy } from "./kb-profile-copy.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import { GEO_GENERATION_INPUT_BYTES, geoGenerationInputHash, type GeoKbGenerationRecord, type GeoKbGenerationInvocation, type GeoGenerationAttempt, type GeoGenerationValue } from "./kb-generation.ts";
import { synthesizeGeoKbRoles, synthesizeGeoKbQuestions, prepareGeoRoleSynthesis, prepareGeoQuestionSynthesis, isUsableGeoSynthesisConfig, type GeoSynthesisResult, type GeoSynthesisProvider } from "./kb-synthesis.ts";
import { parseAnyGeoKbPayload, parseGeoKbPayloadV2, GEO_KB_SCHEMA_VERSION_V2, type AnyGeoKbPayload, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { buildGeoRoleSynthesisBasis, buildGeoQuestionSynthesisBasis, type GeoAdmittedQuestionFact } from "./kb-synthesis-input.ts";
import { createGeoRoleProposal, parseGeoRoleProposal, resolveGeoModelRoleLineage, type GeoRoleProposal } from "./kb-role-proposal.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import type { GeoSynthesisSource, GeoQuestionSynthesisInput } from "./kb-synthesis-contract.ts";
import { verifyGeoKbSourceReportV2, geoKbSourceCatalogueV2 } from "./kb-sources.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import { selectGeoCompetitorEvidence } from "./kb-competitor-evidence.ts";
import { buildGeoPreparedKnowledgeBase, buildGeoPreparedKnowledgeBaseV2 } from "./kb-preparation.ts";
import { assertGeoSnapshotContextV2KnownInput, GEO_CONTEXT_EVIDENCE_MAX_BYTES, type GeoSourceReceiptRef, type GeoSourceSummaryV2, type GeoVerifiedFactSupportV2 } from "./snapshot-context-v2.ts";
import { parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceSource } from "./kb-knowledge-evidence.ts";
import { buildGeoKnowledgeSynthesisInputV1, type GeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION, prepareGeoKnowledgeSynthesis, synthesizeGeoKnowledgeNarrative, type GeoKnowledgeSynthesisDependencies, type GeoKnowledgeSynthesisResult } from "./kb-knowledge-synthesis.ts";
import { buildGeoKnowledgeGenerationInputManifest } from "./kb-prepared-contract.ts";
import { buildGeoKnowledgeGenerationResultV1, parseGeoKnowledgeGenerationResultV1, type GeoKnowledgeGenerationResultV1 } from "./kb-knowledge-generation-contract.ts";
import { buildGeoKnowledgePack } from "./kb-knowledge-pack.ts";

export interface GeoKnowledgeEvidenceCollectionInput {
  readonly userId: string;
  readonly kbId: string;
  readonly targetUrl: string;
  readonly payload: GeoKbPayloadV2;
  readonly confirmedCompetitors: readonly {
    readonly key: string;
    readonly name: string;
    readonly confirmed: true;
  }[];
  readonly reusedSources: readonly GeoKnowledgeEvidenceSource[];
}
export interface GeoKbGenerationPreparerDependencies {
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<{ readonly kind: "ok"; readonly value: Pick<VersionedGeoKbDetails, "kbId" | "origin" | "draft"> } | { readonly kind: "missing" | "unavailable" }>;
  readonly validateCurrentProfileCopy: (input: { readonly userId: string; readonly copy: GeoProfileCopy }) => Promise<"current" | "stale" | "unavailable">;
  readonly readReceipt: (input: { readonly userId: string; readonly kbId: string; readonly receiptId: string }) => Promise<{ readonly kind: "ok"; readonly value: unknown } | { readonly kind: "missing" | "unavailable" }>;
  readonly readGeneration: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord } | { readonly kind: "missing" | "unavailable" }>;
  readonly resolveConfig: () => KeywordLlmConfig | null;
  readonly collectKnowledgeEvidence: (input: GeoKnowledgeEvidenceCollectionInput) => Promise<unknown>;
  readonly now: () => Date;
  readonly synthesizeRoles?: typeof synthesizeGeoKbRoles;
  readonly synthesizeQuestions?: typeof synthesizeGeoKbQuestions;
  readonly synthesizeKnowledge?: (input: GeoKnowledgeSynthesisInputV1, dependencies?: GeoKnowledgeSynthesisDependencies) => Promise<GeoKnowledgeSynthesisResult>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const asValue = (value: unknown): GeoGenerationValue => JSON.parse(canonicalGeoV2Text(value)) as GeoGenerationValue;
function modelInput(provider: GeoSynthesisProvider, config: KeywordLlmConfig, timeoutMs: number) {
  return { modelRequested: provider.modelRequested, authScheme: provider.authScheme, temperature: String(provider.effectiveTemperature),
    maxOutputTokens: provider.maxOutputTokens, timeoutMs, endpointHash: createHash("sha256").update(config.url).digest("hex") };
}
function invocation<T>(result: GeoSynthesisResult<T>, build: (value: T) => unknown): GeoKbGenerationInvocation {
  const attempt: GeoGenerationAttempt = { attemptedCalls: result.attemptedCalls, delivery: result.delivery, modelRequested: result.provider?.modelRequested ?? null,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, requestCount: result.usage.requestCount };
  if (!result.ok) {
    const reason = result.delivery === "outcome_unknown" ? "outcome_unknown" : result.reason === "not_configured" ? "model_unavailable" : result.reason === "rate_limited" ? "rate_limited" : ["auth_failed", "bad_request", "server_error"].includes(result.reason) ? "provider_rejected" : "invalid_output";
    return { ok: false, reason, delivery: result.delivery, attempt };
  }
  try { return { ok: true, value: asValue(build(result.value)), attempt }; }
  catch { return { ok: false, reason: "invalid_output", delivery: "response_received", attempt }; }
}
function knowledgeInvocation(result: GeoKnowledgeSynthesisResult, build: (value: Extract<GeoKnowledgeSynthesisResult, { readonly ok: true }>["value"]) => unknown): GeoKbGenerationInvocation {
  const attempt: GeoGenerationAttempt = { attemptedCalls: result.attemptedCalls, delivery: result.delivery, modelRequested: result.provider?.modelRequested ?? null,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, requestCount: result.usage.requestCount };
  if (!result.ok) {
    const reason = result.delivery === "outcome_unknown" ? "outcome_unknown" : result.reason === "not_configured" ? "model_unavailable" : result.reason === "rate_limited" ? "rate_limited" : ["auth_failed", "bad_request", "server_error"].includes(result.reason) ? "provider_rejected" : "invalid_output";
    return { ok: false, reason, delivery: result.delivery, attempt };
  }
  try { return { ok: true, value: asValue(build(result.value)), attempt }; }
  catch { return { ok: false, reason: "invalid_output", delivery: "response_received", attempt }; }
}
const unknownInvocation = (modelRequested: string): GeoKbGenerationInvocation => ({ ok: false, reason: "outcome_unknown", delivery: "outcome_unknown",
  attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested, inputTokens: null, outputTokens: null, requestCount: null } });
class PreparationFailure extends Error {
  constructor(readonly kind: "invalid_input" | "unavailable") { super(kind); }
}
function invalid(): never { throw new PreparationFailure("invalid_input"); }
const same = (left: unknown, right: unknown): boolean => canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
function mergeSources(...groups: readonly (readonly GeoSynthesisSource[])[]): GeoSynthesisSource[] {
  const items = new Map<string, GeoSynthesisSource>();
  for (const group of groups) for (const item of group) {
    if (items.has(item.id) && !same(items.get(item.id), item)) invalid();
    items.set(item.id, item);
  }
  return [...items.values()];
}
function evidenceCounts(sources: readonly GeoSynthesisSource[]) {
  const counts = { profile: 0, gsc: 0, crawl: 0, manual: 0 };
  for (const source of sources) counts[source.kind] += 1;
  if (Object.values(counts).some((count) => count > 10_000)) invalid();
  return counts;
}
function sourceSummary(reports: readonly GeoKbSourceReportV2[], selected: readonly GeoSynthesisSource[], available: readonly GeoSynthesisSource[]): GeoSourceSummaryV2 {
  const ordered = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.receiptId.localeCompare(b.receiptId));
  const primary = ordered.find((report) => report.gsc.status === "available") ?? ordered[0];
  const gsc = primary === undefined ? null : (({ queries: _queries, ...metadata }) => metadata)(primary.gsc);
  return { gsc, selectedEvidenceCounts: evidenceCounts(selected), availableEvidenceCounts: evidenceCounts(available) };
}
function admittedFacts(payload: GeoKbPayloadV2, receipts: ReadonlyMap<string, GeoKbSourceReportV2>) {
  const facts: GeoAdmittedQuestionFact[] = [], verifiedFactSupport: GeoVerifiedFactSupportV2[] = [];
  for (const fact of payload.facts) {
    if (fact.review !== "accepted" || fact.value === "" || fact.reason !== "") continue;
    if (fact.supportRef !== null) {
      const receipt = receipts.get(fact.supportRef.receiptId);
      const support = receipt?.facts.find((entry) => entry.evidenceId === fact.supportRef!.evidenceId);
      if (!support || support.status !== "available" || support.source !== "crawl" || support.key !== fact.key || support.value !== fact.value || support.sourceUrl !== fact.sourceUrl || support.observedAt !== fact.observedAt) invalid();
      verifiedFactSupport.push({ ...fact.supportRef, key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt });
    }
    facts.push({ key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt, source: fact.supportRef === null ? "user_confirmed" : "crawl" });
  }
  return { facts, verifiedFactSupport };
}
function knowledgeSourceId(kind: "fact" | "gsc", value: unknown): string {
  return `knowledge-${kind}-${geoV2Digest(value).slice(0, 24)}`;
}
function knowledgeReusableSources(payload: GeoKbPayloadV2, receipts: ReadonlyMap<string, GeoKbSourceReportV2>, selectedReceiptIds: ReadonlySet<string>): GeoKnowledgeEvidenceSource[] {
  const sources: GeoKnowledgeEvidenceSource[] = [];
  for (const fact of payload.facts.filter(item => item.review === "accepted" && item.value !== "" && item.reason === "").slice(0, 8)) {
    if (fact.supportRef === null) {
      sources.push({ id: knowledgeSourceId("fact", { key: fact.key, value: fact.value }), kind: "accepted_fact", label: fact.key, url: null, competitor: null,
        availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: [fact.value] });
      continue;
    }
    const report = receipts.get(fact.supportRef.receiptId);
    const support = report?.facts.find(item => item.evidenceId === fact.supportRef!.evidenceId);
    if (!support || support.status !== "available" || support.source !== "crawl" || support.key !== fact.key || support.value !== fact.value || support.sourceUrl !== fact.sourceUrl || support.observedAt !== fact.observedAt || support.bodyHash === null || support.excerpt === null) invalid();
    sources.push({ id: knowledgeSourceId("fact", { receiptId: report!.receiptId, evidenceId: support.evidenceId }), kind: "accepted_fact", label: fact.key,
      // Facts are declarations, not fetched resources. Keeping their receipt
      // URL here would participate in collector URL dedupe and could suppress
      // the independent own-page crawl (including the homepage itself).
      url: null, competitor: null, availability: "available", reason: null, observedAt: support.observedAt, bodyHash: support.bodyHash, excerpts: [support.excerpt] });
  }
  const gsc = [...receipts.values()].filter(report => selectedReceiptIds.has(report.receiptId) && report.gsc.status === "available" && report.gsc.queries.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.receiptId.localeCompare(right.receiptId))[0];
  if (gsc?.gsc.status === "available") {
    const partial = gsc.gsc.truncated || gsc.gsc.queries.length > 8;
    sources.push({ id: knowledgeSourceId("gsc", { receiptId: gsc.receiptId, contentHash: gsc.contentHash }), kind: "gsc", label: "Search Console queries", url: null,
      competitor: null, availability: partial ? "partial" : "available", reason: partial ? "partial_body" : null, observedAt: gsc.gsc.observedAt, bodyHash: null, excerpts: gsc.gsc.queries.slice(0, 8).map(query => query.text) });
  }
  if (sources.length > 9 || sources.some(source => source.excerpts.length > 8)) invalid();
  return sources;
}
function durableInput(value: unknown): Readonly<Record<string, GeoGenerationValue>> {
  const parsed = asValue(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
  return parsed as Readonly<Record<string, GeoGenerationValue>>;
}
type SelectedKnowledge = { readonly record: GeoKbGenerationRecord; readonly result: GeoKnowledgeGenerationResultV1 };
async function readSelectedKnowledge(input: { readonly userId: string; readonly kbId: string; readonly generationId: string; readonly payload: GeoKbPayloadV2; readonly base: { readonly baseDraftVersion: string; readonly baseDraftHash: string; readonly profileCopyHash: string } }, dependencies: Pick<GeoKbGenerationPreparerDependencies, "readGeneration">): Promise<{ readonly kind: "ok"; readonly value: SelectedKnowledge } | { readonly kind: "invalid_input" | "input_stale" | "unavailable" }> {
  const read = await dependencies.readGeneration({ userId: input.userId, kbId: input.kbId, generationId: input.generationId }).catch(() => ({ kind: "unavailable" as const }));
  if (read.kind !== "ok") return { kind: read.kind === "unavailable" ? "unavailable" : "invalid_input" };
  const record = read.generation;
  if (record.generationId !== input.generationId || record.userId !== input.userId || record.kbId !== input.kbId || record.kind !== "knowledge_pack" || record.state !== "succeeded" || record.errorReason !== null || record.attempt?.attemptedCalls !== 1 || record.attempt.delivery !== "response_received") return { kind: "invalid_input" };
  let result: GeoKnowledgeGenerationResultV1;
  try {
    result = parseGeoKnowledgeGenerationResultV1(record.result);
    if (result.generationId !== record.generationId || result.kbId !== record.kbId || geoGenerationInputHash("knowledge_pack", durableInput(result.manifest)) !== record.inputHash) return { kind: "invalid_input" };
  } catch { return { kind: "invalid_input" }; }
  if (result.manifest.baseDraftVersion !== input.base.baseDraftVersion || result.manifest.baseDraftHash !== input.base.baseDraftHash || result.manifest.profileCopyHash !== input.base.profileCopyHash) return { kind: "input_stale" };
  const synthesis = result.synthesisInput;
  const confirmedCompetitors = input.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true }));
  if (synthesis.targetUrl !== new URL(input.payload.targetUrl).toString() || synthesis.officialName !== input.payload.officialName || !same(synthesis.aliases, input.payload.aliases)
    || !same(synthesis.categoryTerms, input.payload.categoryTerms) || synthesis.market !== input.payload.market.country || synthesis.language !== input.payload.market.language
    || !same(synthesis.confirmedCompetitors, confirmedCompetitors)) return { kind: "invalid_input" };
  return { kind: "ok", value: { record, result } };
}
function declaredRoleSources(payload: GeoKbPayloadV2, profileSources: readonly GeoSynthesisSource[]): GeoSynthesisSource[] {
  const known = new Map(profileSources.map((source) => [source.id, source]));
  const out: GeoSynthesisSource[] = [];
  for (const role of payload.roles) {
    if (role.source.kind === "model") continue;
    for (const id of role.source.evidenceRefs) {
      if (role.source.kind === "profile") {
        const source = known.get(id); if (!source) invalid(); out.push(source);
      } else {
        if (id !== `manual:${role.id}`) invalid();
        const { source: _source, ...declaration } = role;
        out.push({ id, kind: "manual", text: `Saved manual role declaration: ${canonicalGeoV2Text(declaration)}` });
      }
    }
  }
  return mergeSources(out);
}
type LineageReaders = Pick<GeoKbGenerationPreparerDependencies, "readReceipt" | "readGeneration">;
interface LineageScope { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV2 }
function receiptReader(scope: { readonly userId: string; readonly kbId: string; readonly targetUrl: string; readonly copy: GeoProfileCopy }, dependencies: Pick<LineageReaders, "readReceipt">) {
  const receipts = new Map<string, GeoKbSourceReportV2>();
  return {
    receipts,
    refs: (): GeoSourceReceiptRef[] => [...receipts.values()].map(({ receiptId, contentHash }) => ({ receiptId, contentHash })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    sources: (): GeoSynthesisSource[] => [...receipts.values()].sort((a, b) => a.receiptId.localeCompare(b.receiptId)).flatMap(geoKbSourceCatalogueV2),
    load: async (selected: readonly { readonly receiptId: string; readonly contentHash?: string }[], historical = false): Promise<void> => {
      for (const ref of selected) {
        if (!uuid.test(ref.receiptId) || ref.contentHash !== undefined && !hash.test(ref.contentHash)) invalid();
        let report = receipts.get(ref.receiptId);
        if (report === undefined) {
          if (receipts.size >= 32) invalid();
          const read = await dependencies.readReceipt({ userId: scope.userId, kbId: scope.kbId, receiptId: ref.receiptId }).catch(() => ({ kind: "unavailable" as const }));
          if (read.kind !== "ok") throw new PreparationFailure(read.kind === "missing" ? "invalid_input" : "unavailable");
          report = verifyGeoKbSourceReportV2(read.value);
        }
        if (report.receiptId !== ref.receiptId || ref.contentHash !== undefined && report.contentHash !== ref.contentHash || report.kbId !== scope.kbId || report.targetHost !== normalizeAccountWebsiteUrl(scope.targetUrl)?.host) invalid();
        if (historical ? report.profileReference !== null && report.profileReference.websiteId !== scope.copy.websiteId : !same(report.profileReference, profileCopyReference(scope.copy))) invalid();
        receipts.set(ref.receiptId, report);
      }
    },
  };
}
async function readRoleProposals(scope: LineageScope, dependencies: Pick<LineageReaders, "readGeneration">): Promise<GeoRoleProposal[]> {
  const proposals: GeoRoleProposal[] = [];
  for (const generationId of new Set(scope.payload.roles.flatMap((role) => role.source.kind === "model" ? [role.source.generationId!] : []))) {
    if (!uuid.test(generationId)) invalid();
    const read = await dependencies.readGeneration({ userId: scope.userId, kbId: scope.kbId, generationId }).catch(() => ({ kind: "unavailable" as const }));
    if (read.kind !== "ok") throw new PreparationFailure(read.kind === "missing" ? "invalid_input" : "unavailable");
    const record = read.generation;
    if (record.generationId !== generationId || record.userId !== scope.userId || record.kbId !== scope.kbId || record.kind !== "roles" || record.state !== "succeeded" || record.errorReason !== null || !hash.test(record.inputHash)) invalid();
    const proposal = parseGeoRoleProposal(record.result);
    if (proposal.generationId !== generationId || proposal.kbId !== scope.kbId) invalid();
    proposals.push(proposal);
  }
  return proposals;
}

/** previousPayload, when supplied, must be the owner-read saved draft, never
 * another HTTP field. Draft retention is not current preparation eligibility. */
export async function validateGeoKbDraftLineage(input: LineageScope & { readonly previousPayload?: AnyGeoKbPayload }, dependencies: LineageReaders): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    if (!uuid.test(input.userId) || !uuid.test(input.kbId)) invalid();
    const payload = parseGeoKbPayloadV2(input.payload);
    assertGeoProfileCopyIntegrity(payload.profileCopy);
    const scope = { userId: input.userId, kbId: input.kbId, payload };
    const reader = receiptReader({ ...scope, targetUrl: payload.targetUrl, copy: payload.profileCopy }, dependencies);
    const profiles = buildGeoRoleSynthesisBasis(payload, "en", []).input.sources;
    const knownProfiles = new Set(profiles.map((source) => source.id));
    const proposals = await readRoleProposals(scope, dependencies);
    for (const role of payload.roles) {
      if (role.source.kind === "model") {
        const proposal = proposals.find((entry) => entry.generationId === role.source.generationId);
        if (!proposal) invalid();
        const current = role.review === "accepted";
        const lineage = resolveGeoModelRoleLineage({ kbId: input.kbId, roles: [role], proposals: [proposal],
          profileCopyHash: current ? geoV2Digest(payload.profileCopy) : proposal.profileCopyHash,
          officialName: current ? payload.officialName : proposal.input.officialName,
          language: current ? payload.market.language : proposal.input.questionLanguage });
        await reader.load(lineage.sourceReceiptRefs, !current);
        const known = new Map(mergeSources(profiles, reader.sources()).map((source) => [source.id, source]));
        for (const source of lineage.evidenceCatalog) {
          // Historical Profile wording is already sealed inside the owned
          // succeeded proposal. It supplies no accepted/current authority.
          if (!current && source.kind === "profile") continue;
          if (!known.has(source.id) || !same(known.get(source.id), source)) invalid();
        }
      } else if (role.source.kind === "profile" && role.review !== "accepted" && role.source.evidenceRefs.some((id) => !knownProfiles.has(id))) {
        if (input.previousPayload?.schemaVersion !== GEO_KB_SCHEMA_VERSION_V2) invalid();
        const previous = parseGeoKbPayloadV2(input.previousPayload);
        assertGeoProfileCopyIntegrity(previous.profileCopy);
        if (previous.profileCopy.websiteId !== payload.profileCopy.websiteId || normalizeAccountWebsiteUrl(previous.targetUrl)?.host !== normalizeAccountWebsiteUrl(payload.targetUrl)?.host) invalid();
        const original = previous.roles.find((entry) => entry.id === role.id);
        if (!original || !same(original.source, role.source)) invalid();
        declaredRoleSources({ ...previous, roles: [original] }, buildGeoRoleSynthesisBasis(previous, "en", []).input.sources);
      } else declaredRoleSources({ ...payload, roles: [role] }, profiles);
    }
    for (const fact of payload.facts) {
      if (fact.supportRef === null) continue;
      const positive = fact.review === "accepted" && fact.value !== "" && fact.reason === "";
      await reader.load([{ receiptId: fact.supportRef.receiptId }], !positive);
      const support = reader.receipts.get(fact.supportRef.receiptId)?.facts.find((entry) => entry.evidenceId === fact.supportRef!.evidenceId);
      if (!support || support.status !== "available" || support.source !== "crawl") invalid();
      // Pending/excluded pointers retain the original observed tuple. They do
      // not assert that newly edited provisional wording matches that tuple.
      if (positive) admittedFacts({ ...payload, facts: [fact] }, reader.receipts);
    }
    return "valid";
  } catch (error) { return error instanceof PreparationFailure && error.kind === "unavailable" ? "unavailable" : "invalid"; }
}

export function createGeoKbGenerationPreparer(dependencies: GeoKbGenerationPreparerDependencies): GeoKbGenerationHandlerDependencies["prepare"] {
  return async (request) => {
    if (!uuid.test(request.userId) || !uuid.test(request.kbId) || !Number.isSafeInteger(request.baseVersion) || request.baseVersion < 1 || !hash.test(request.draftHash) || !["roles", "questions", "knowledge_pack"].includes(request.kind)
      || request.knowledgeGenerationId !== undefined && (request.kind !== "questions" || !uuid.test(request.knowledgeGenerationId))
      || !Array.isArray(request.sourceReceiptRefs) || request.sourceReceiptRefs.length > 32 || new Set(request.sourceReceiptRefs.map((ref) => ref.receiptId)).size !== request.sourceReceiptRefs.length) return { kind: "invalid_input" };
    const loaded = await dependencies.readDetails({ userId: request.userId, kbId: request.kbId }).catch(() => ({ kind: "unavailable" as const }));
    if (loaded.kind !== "ok") return { kind: loaded.kind };
    if (loaded.value.kbId !== request.kbId) return { kind: "unavailable" };
    const draft = loaded.value.draft;
    if (draft === null) return { kind: "invalid_input" };
    if (draft.draftVersion !== request.baseVersion || draft.contentHash !== request.draftHash) return { kind: "input_stale" };
    let payload;
    try {
      payload = parseAnyGeoKbPayload(draft.payload);
      if (geoV2Digest(payload) !== draft.contentHash || normalizeAccountWebsiteUrl(payload.targetUrl)?.host !== normalizeAccountWebsiteUrl(loaded.value.origin)?.host) return { kind: "unavailable" };
      if (payload.profileCopy === undefined) return { kind: "invalid_input" };
      assertGeoProfileCopyIntegrity(payload.profileCopy);
    } catch { return { kind: "invalid_input" }; }
    if (request.kind !== "roles" && (payload.schemaVersion !== GEO_KB_SCHEMA_VERSION_V2 || payload.roles.some((role) => role.review === "pending") || payload.facts.some((fact) => fact.review === "pending"))) return { kind: "invalid_input" };
    const current = await dependencies.validateCurrentProfileCopy({ userId: request.userId, copy: payload.profileCopy }).catch(() => "unavailable" as const);
    if (current !== "current") return { kind: current === "stale" ? "input_stale" : "unavailable" };
    if (request.kind === "knowledge_pack" && geoGenerationLanguage(payload.market.language) === null) return { kind: "unsupported_language" };
    let config: KeywordLlmConfig | null;
    try { const resolved = dependencies.resolveConfig(); config = resolved === null ? null : { ...resolved }; }
    catch { return { kind: "model_unavailable" }; }
    if (!isUsableGeoSynthesisConfig(config)) return { kind: "model_unavailable" };
    const base = { kbId: request.kbId, baseDraftVersion: String(request.baseVersion), baseDraftHash: request.draftHash, profileCopyHash: geoV2Digest(payload.profileCopy) };
    try {
      const capture = config;
      const reader = receiptReader({ userId: request.userId, kbId: request.kbId, targetUrl: payload.targetUrl, copy: payload.profileCopy! }, dependencies);
      await reader.load(request.sourceReceiptRefs);
      const { receipts, refs: receiptRefs, sources: receiptSources } = reader;
      if (request.kind === "roles") {
        const basis = buildGeoRoleSynthesisBasis(payload, request.displayLocale, receiptSources());
        if (Object.values(basis.availableEvidenceCounts).some((count) => count > 10_000)) invalid();
        const prepared = prepareGeoRoleSynthesis(basis.input, capture);
        if (!prepared.ok) return { kind: prepared.reason === "not_configured" ? "model_unavailable" : prepared.reason === "unsupported_language" ? "unsupported_language" : "invalid_input" };
        const sourceReceiptRefs = receiptRefs();
        return { kind: "ready", input: { ...base, promptHash: geoV2Digest(prepared.value.prompt), promptVersion: prepared.value.promptVersion,
          responseSchemaHash: geoV2Digest(prepared.value.responseJsonSchema), provider: modelInput(prepared.value.provider, capture, prepared.value.timeoutMs), sourceReceiptRefs: sourceReceiptRefs.map((ref) => ({ ...ref })) },
          invoke: async (generationId) => {
            try {
              const result = await (dependencies.synthesizeRoles ?? synthesizeGeoKbRoles)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
              return invocation(result, (output) => createGeoRoleProposal({ ...base, generationId, input: prepared.value.input, output, sourceReceiptRefs,
                selectedEvidenceCounts: basis.selectedEvidenceCounts, availableEvidenceCounts: basis.availableEvidenceCounts }));
            } catch { return unknownInvocation(capture.model); }
          } };
      }
      if (request.kind === "knowledge_pack") {
        const finalPayload = parseGeoKbPayloadV2(payload);
        await reader.load(finalPayload.facts.flatMap(fact => fact.review === "accepted" && fact.value !== "" && fact.reason === "" && fact.supportRef !== null ? [{ receiptId: fact.supportRef.receiptId }] : []));
        const reusedSources = knowledgeReusableSources(finalPayload, receipts, new Set(request.sourceReceiptRefs.map(ref => ref.receiptId)));
        const confirmedCompetitors = finalPayload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const }));
        const targetUrl = new URL(finalPayload.targetUrl).toString();
        let rawEvidence: unknown;
        try {
          rawEvidence = await dependencies.collectKnowledgeEvidence({ userId: request.userId, kbId: request.kbId, targetUrl, payload: finalPayload,
            confirmedCompetitors, reusedSources });
        } catch { return { kind: "unavailable" }; }
        const evidence = parseGeoKnowledgeEvidenceV1(rawEvidence);
        if (evidence.availability === "unavailable" || evidence.targetUrl !== targetUrl || !same(evidence.confirmedCompetitors, confirmedCompetitors)
          || reusedSources.some(source => !evidence.sourceCatalogue.some(candidate => candidate.id === source.id && same(candidate, source)))) return { kind: "invalid_input" };
        const synthesisInput = buildGeoKnowledgeSynthesisInputV1({ officialName: finalPayload.officialName, aliases: finalPayload.aliases, categoryTerms: finalPayload.categoryTerms,
          market: finalPayload.market.country, language: finalPayload.market.language }, evidence);
        const prepared = prepareGeoKnowledgeSynthesis(synthesisInput, capture);
        if (!prepared.ok) return { kind: prepared.reason === "not_configured" ? "model_unavailable" : prepared.reason === "unsupported_language" ? "unsupported_language" : "invalid_input" };
        const manifest = buildGeoKnowledgeGenerationInputManifest({ ...base, sourceReceiptRefs: receiptRefs(), knowledgeSynthesisInput: prepared.value.input });
        const input = durableInput(manifest);
        if (geoV2JsonbBytes(input) > GEO_GENERATION_INPUT_BYTES) return { kind: "invalid_input" };
        return { kind: "ready", input,
          invoke: async (generationId) => {
            try {
              const result = await (dependencies.synthesizeKnowledge ?? synthesizeGeoKnowledgeNarrative)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
              return knowledgeInvocation(result, narrative => buildGeoKnowledgeGenerationResultV1({ schemaVersion: "marketing-geo-knowledge-generation-result.v1",
                generationId, kbId: request.kbId, manifest, evidence, synthesisInput: prepared.value.input, narrative, generatedAt: dependencies.now().toISOString() }));
            } catch { return unknownInvocation(capture.model); }
          } };
      }
      const finalPayload = parseGeoKbPayloadV2(payload);
      let selectedKnowledge: SelectedKnowledge | null = null;
      if (request.knowledgeGenerationId !== undefined) {
        const selected = await readSelectedKnowledge({ userId: request.userId, kbId: request.kbId, generationId: request.knowledgeGenerationId, payload: finalPayload, base }, dependencies);
        if (selected.kind !== "ok") return { kind: selected.kind };
        selectedKnowledge = selected.value;
      }
      const proposals = await readRoleProposals({ userId: request.userId, kbId: request.kbId, payload: parseGeoKbPayloadV2(payload) }, dependencies);
      if (proposals.some((proposal) => proposal.profileCopyHash !== base.profileCopyHash || proposal.input.officialName !== finalPayload.officialName || proposal.input.questionLanguage !== finalPayload.market.language)) return { kind: "input_stale" };
      const lineage = resolveGeoModelRoleLineage({ kbId: request.kbId, profileCopyHash: base.profileCopyHash, officialName: finalPayload.officialName, language: finalPayload.market.language, roles: finalPayload.roles, proposals });
      await reader.load(lineage.sourceReceiptRefs);
      await reader.load(finalPayload.facts.flatMap((fact) => fact.review === "accepted" && fact.value !== "" && fact.reason === "" && fact.supportRef !== null ? [{ receiptId: fact.supportRef.receiptId }] : []));
      const profileSources = buildGeoRoleSynthesisBasis(finalPayload, request.displayLocale, []).input.sources;
      const available = mergeSources(profileSources, receiptSources());
      const known = new Map(available.map((source) => [source.id, source]));
      if (lineage.evidenceCatalog.some((source) => !known.has(source.id) || !same(known.get(source.id), source))) invalid();
      const declarations = declaredRoleSources(finalPayload, profileSources);
      const { facts, verifiedFactSupport } = admittedFacts(finalPayload, receipts);
      const basis = buildGeoQuestionSynthesisBasis(finalPayload, facts);
      const evidenceCatalog = mergeSources(basis.input.evidenceSources, lineage.evidenceCatalog, declarations);
      if (evidenceCatalog.length > 256 || geoV2JsonbBytes(evidenceCatalog) > GEO_CONTEXT_EVIDENCE_MAX_BYTES) invalid();
      const semanticInput: GeoQuestionSynthesisInput = { ...basis.input, evidenceSources: evidenceCatalog };
      const summary = sourceSummary([...receipts.values()], evidenceCatalog, mergeSources(available, basis.input.evidenceSources, declarations));
      const prepared = prepareGeoQuestionSynthesis(semanticInput, capture);
      if (!prepared.ok) return { kind: prepared.reason === "not_configured" ? "model_unavailable" : prepared.reason === "unsupported_language" ? "unsupported_language" : "invalid_input" };
      const sourceReceiptRefs = receiptRefs();
      if (selectedKnowledge !== null && !same(selectedKnowledge.result.manifest.sourceReceiptRefs, sourceReceiptRefs)) invalid();
      const competitorEvidence = selectGeoCompetitorEvidence({ kbId: request.kbId, targetHost: normalizeAccountWebsiteUrl(finalPayload.targetUrl)!.host,
        competitors: finalPayload.competitors, sourceReceiptRefs, receipts: [...receipts.values()] });
      assertGeoSnapshotContextV2KnownInput({ kbId: request.kbId, payload: finalPayload, sourceReceiptRefs, evidenceCatalog, sourceSummary: summary,
        modelRoleEdits: lineage.userEdited, verifiedFactSupport, competitorEvidence });
      const input = { ...base, promptHash: geoV2Digest(prepared.value.prompt), promptVersion: prepared.value.promptVersion,
        responseSchemaHash: geoV2Digest(prepared.value.responseJsonSchema), provider: modelInput(prepared.value.provider, capture, prepared.value.timeoutMs), sourceReceiptRefs: sourceReceiptRefs.map((ref) => ({ ...ref })),
        ...(selectedKnowledge === null ? {} : { knowledgeGeneration: { generationId: selectedKnowledge.record.generationId, inputHash: selectedKnowledge.record.inputHash, resultHash: selectedKnowledge.result.contentHash } }) };
      return { kind: "ready", input,
        invoke: async (generationId) => {
          try {
            const result = await (dependencies.synthesizeQuestions ?? synthesizeGeoKbQuestions)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
            return invocation(result, (semanticOutput) => {
              const candidateInput = { candidateId: generationId, kbId: request.kbId, baseDraftVersion: request.baseVersion, payload: finalPayload,
                semanticInput: prepared.value.input, semanticOutput, sourceReceiptRefs, evidenceCatalog, sourceSummary: summary, modelRoleEdits: lineage.userEdited, verifiedFactSupport, competitorEvidence };
              if (selectedKnowledge === null) return buildGeoPreparedKnowledgeBase(candidateInput);
              const candidate = buildGeoPreparedKnowledgeBase(candidateInput);
              const knowledgePack = buildGeoKnowledgePack({ generatedAt: selectedKnowledge.result.generatedAt, payload: candidate.payload, context: candidate.context,
                questionSet: candidate.questionSet, evidence: selectedKnowledge.result.evidence, synthesisInput: selectedKnowledge.result.synthesisInput,
                narrative: selectedKnowledge.result.narrative, narrativeFailureReason: null });
              return buildGeoPreparedKnowledgeBaseV2({ ...candidateInput, knowledgePack, knowledgeSynthesisInput: selectedKnowledge.result.synthesisInput,
                knowledgeGeneration: { generationId: selectedKnowledge.record.generationId, inputHash: selectedKnowledge.record.inputHash, promptVersion: GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION } });
            });
          } catch { return unknownInvocation(capture.model); }
        } };
    } catch (error) { return { kind: error instanceof PreparationFailure ? error.kind : "invalid_input" }; }
  };
}
