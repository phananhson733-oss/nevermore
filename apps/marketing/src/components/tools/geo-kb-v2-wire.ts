// @input -- private JSON wire data for complete v2 knowledge and generation UI
// @output -- strict renderable DTOs, never cryptographic or ownership authority
// @pos -- browser-safe boundary; no hashing, stores, provider calls or secret fields
import { z } from "zod";
import type { GeoPreparedCandidateV1 } from "../../lib/geo-tools/kb-prepared-contract.ts";
import type { GeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import type { GeoKbGenerationRecord } from "../../lib/geo-tools/kb-generation.ts";
import { parseGeoKbPayloadV2, geoRoleEligibleForLayer, geoRoleV2Schema, geoFactV2Schema, type GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "../../lib/geo-tools/kb-question-set-v2.ts";
import type { GeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { parseGeoSnapshotContextV2Shape, geoSourceReceiptRefSchema } from "../../lib/geo-tools/snapshot-context-v2-shape.ts";
import { parseGeoRoleSynthesis, parseGeoRoleSynthesisInput } from "../../lib/geo-tools/kb-synthesis-contract.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "../../lib/geo-tools/kb-v2-json.ts";
import { profileCopyReference, parseGeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { normalizeAccountWebsiteUrl, parseMarketingWebsiteProfile, fieldProvenanceSchema } from "../../lib/account-websites/contracts.ts";
import { parseGeoKbSourceReportV2, type GeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
import type { GeoInheritedProfile } from "../../lib/geo-tools/asset-context.ts";
import { isFrozen, isInheritedProfile, type GeoKbFrozenSummary } from "./geo-kb-wire.ts";

export type GeoKbGenerationWire = Omit<GeoKbGenerationRecord, "userId" | "result"> & { readonly result: GeoPreparedCandidateV1 | GeoRoleProposal | null };
export interface GeoKbFrozenV2Wire {
  readonly kbId: string; readonly snapshotId: string; readonly revision: number; readonly frozenAt: string;
  readonly contentHash: string; readonly questionSetHash: string; readonly questionCount: number;
  readonly payload: GeoKbPayloadV2; readonly questionSet: GeoQuestionSetV2; readonly context: GeoSnapshotContextV2;
}
export interface GeoKbEditorViewV2 {
  readonly schemaVersion: "marketing-geo-kb-editor.v2";
  readonly kbId: string; readonly origin: string; readonly host: string;
  readonly draftVersion: number; readonly draftHash: string | null; readonly profileCopyHash: string; readonly payload: GeoKbPayloadV2; readonly requiresSave: boolean;
  readonly profile: GeoInheritedProfile | null;
  readonly frozen: GeoKbFrozenV2Wire | GeoKbFrozenSummary | null;
  readonly sourceReceipt: GeoKbSourceReportV2 | null;
  readonly prepared: GeoPreparedCandidateV1 | null;
  readonly generations: { readonly roles: GeoKbGenerationWire | null; readonly questions: GeoKbGenerationWire | null };
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid();
const safeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger);
const text = (maximum: number) => z.string().min(1).max(maximum);
const time = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const refs = z.array(geoSourceReceiptRefSchema).max(32).refine(rows => new Set(rows.map(row => row.receiptId)).size === rows.length);
const counts = z.object({ profile: safeInteger.max(10_000), gsc: safeInteger.max(10_000), crawl: safeInteger.max(10_000), manual: safeInteger.max(10_000) }).strict();
const same = (a: unknown, b: unknown) => canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
function requireLink(condition: boolean): asserts condition { if (!condition) throw new Error("Inconsistent GEO wire data"); }
function bounded(value: unknown, maximum: number): void { requireLink(geoV2JsonbBytes(value) <= maximum); }

const preparedSchema = z.object({ schemaVersion: z.literal("marketing-geo-prepared-candidate.v1"), candidateId: uuid, kbId: uuid,
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value))),
  baseDraftHash: hash, profileCopyHash: hash, sourceReceiptRefs: refs, generatorVersion: text(128),
  payload: z.unknown().transform(parseGeoKbPayloadV2), questionSet: z.unknown().transform(parseGeoQuestionSetV2),
  context: z.unknown().transform(parseGeoSnapshotContextV2Shape), candidateHash: hash,
}).strict();

/** These are consistency checks only. SHA verification and owner-scoped reads
 * remain server work; matching strings never confer write/freeze authority. */
function linkedKnowledge(payload: GeoKbPayloadV2, questions: GeoQuestionSetV2, context: GeoSnapshotContextV2): void {
  requireLink(context.targetHost === normalizeAccountWebsiteUrl(payload.targetUrl)?.host);
  requireLink(questions.country === payload.market.country && questions.language === payload.market.language);
  const copy = payload.profileCopy;
  requireLink(same(context.profile, { reference: profileCopyReference(copy), productName: copy.profile.productName,
    oneLinePositioning: copy.profile.oneLinePositioning, coreFeatures: copy.profile.coreFeatures,
    market: { country: copy.profile.country, language: copy.profile.locale },
    fieldProvenance: copy.profile.fieldProvenance.filter(field => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(field.path)),
  }));
  requireLink(same(context.competitors, payload.competitors));
  const evidence = new Set(context.evidenceCatalog.map(item => item.id));
  requireLink(questions.evidenceRefs.every(ref => evidence.has(ref)));
  const roles = new Map(payload.roles.map(role => [role.id, role]));
  requireLink(context.roles.length === payload.roles.length);
  for (const policy of context.roles) {
    const role = roles.get(policy.roleId);
    requireLink(role !== undefined && policy.review === role.review && same(policy.source, role.source));
    requireLink(same(policy.eligibleLayers, (["problem", "evaluation"] as const).filter(layer => geoRoleEligibleForLayer(role, layer))));
  }
  for (const entity of questions.entityCatalog) if (entity.roleId !== null) requireLink(roles.get(entity.roleId)?.review === "accepted");
  for (const question of questions.questions) {
    const role = question.roleId === null ? undefined : roles.get(question.roleId);
    if (question.roleId !== null) requireLink(role?.review === "accepted");
    if (question.provenance.kind === "semantic" && (question.layer === "problem" || question.layer === "evaluation")) requireLink(role !== undefined && geoRoleEligibleForLayer(role, question.layer));
  }
  const facts = new Map(payload.facts.map(fact => [fact.key, fact]));
  requireLink(context.facts.length === payload.facts.length);
  for (const shown of context.facts) {
    const fact = facts.get(shown.key);
    requireLink(fact !== undefined && shown.review === fact.review && shown.reason === fact.reason);
    if (shown.source !== "none") {
      requireLink(fact.review === "accepted" && fact.reason === "" && shown.value === fact.value && shown.sourceUrl === fact.sourceUrl && shown.observedAt === fact.observedAt);
      requireLink(shown.source === "crawl" ? same(shown.supportRef, fact.supportRef) : fact.supportRef === null);
    }
  }
}

export function parseGeoKbPreparedWire(value: unknown): GeoPreparedCandidateV1 | null {
  try {
    bounded(value, 1_572_864);
    const parsed = preparedSchema.parse(value);
    requireLink(parsed.context.kbId === parsed.kbId && parsed.context.candidateId === parsed.candidateId
      && parsed.context.payloadHash === parsed.baseDraftHash && parsed.generatorVersion === parsed.questionSet.methodVersion
      && same(parsed.sourceReceiptRefs, parsed.context.sourceReceiptRefs));
    linkedKnowledge(parsed.payload, parsed.questionSet, parsed.context);
    return parsed;
  } catch { return null; }
}

const proposalSchema = z.object({ schemaVersion: z.literal("marketing-geo-role-proposal.v1"), promptVersion: text(128), generationId: uuid, kbId: uuid,
  baseDraftVersion: z.string().regex(/^(0|[1-9]\d{0,14})$/u), baseDraftHash: hash, profileCopyHash: hash,
  input: z.unknown(), output: z.unknown(), sourceReceiptRefs: refs, selectedEvidenceCounts: counts, availableEvidenceCounts: counts, contentHash: hash,
}).strict();
export function parseGeoKbRoleProposalWire(value: unknown): GeoRoleProposal | null {
  try {
    bounded(value, 393_216);
    const parsed = proposalSchema.parse(value), input = parseGeoRoleSynthesisInput(parsed.input);
    if (!input.ok) return null;
    const output = parseGeoRoleSynthesis(parsed.output, input.value);
    if (!output.ok) return null;
    for (const kind of ["profile", "gsc", "crawl", "manual"] as const) requireLink(parsed.selectedEvidenceCounts[kind] === input.value.sources.filter(source => source.kind === kind).length && parsed.availableEvidenceCounts[kind] >= parsed.selectedEvidenceCounts[kind]);
    return { ...parsed, input: input.value, output: output.value };
  } catch { return null; }
}

const attemptSchema = z.object({ attemptedCalls: z.union([z.literal(0), z.literal(1)]), delivery: z.enum(["not_attempted", "response_received", "outcome_unknown"]), modelRequested: text(200).nullable(), inputTokens: safeInteger.nullable(), outputTokens: safeInteger.nullable(), requestCount: safeInteger.nullable() }).strict();
const generationSchema = z.object({ generationId: uuid, kbId: uuid, kind: z.enum(["roles", "questions"]), inputHash: hash,
  state: z.enum(["claimed", "dispatched", "succeeded", "failed", "uncertain"]), result: z.unknown(),
  errorReason: z.enum(["rate_limited", "quota_unavailable", "invalid_output", "provider_rejected", "outcome_unknown", "input_stale", "model_unavailable"]).nullable(),
  attempt: attemptSchema.nullable(),
}).strict();
export function parseGeoKbGenerationWire(value: unknown): GeoKbGenerationWire | null {
  try {
    bounded(value, 2_100_000);
    const parsed = generationSchema.parse(value), attempt = parsed.attempt;
    if (attempt !== null) requireLink((attempt.attemptedCalls === 0) === (attempt.delivery === "not_attempted"));
    if (parsed.state === "claimed" || parsed.state === "dispatched") {
      requireLink(parsed.result === null && parsed.errorReason === null && attempt === null);
      return { ...parsed, result: null };
    }
    if (parsed.state === "succeeded") {
      requireLink(parsed.errorReason === null && attempt?.attemptedCalls === 1 && attempt.delivery === "response_received");
      const result = parsed.kind === "roles" ? parseGeoKbRoleProposalWire(parsed.result) : parseGeoKbPreparedWire(parsed.result);
      requireLink(result !== null && result.kbId === parsed.kbId && ("generationId" in result ? result.generationId : result.candidateId) === parsed.generationId);
      return { ...parsed, result };
    }
    requireLink(parsed.result === null && parsed.errorReason !== null);
    if (parsed.state === "uncertain") requireLink(parsed.errorReason === "outcome_unknown" && attempt?.attemptedCalls === 1 && attempt.delivery === "outcome_unknown");
    else if (attempt === null) requireLink(parsed.errorReason === "rate_limited" || parsed.errorReason === "quota_unavailable");
    else requireLink(attempt.delivery !== "outcome_unknown");
    return { ...parsed, result: null };
  } catch { return null; }
}

const frozenSchema = z.object({ kbId: uuid, snapshotId: uuid, revision: safeInteger.min(1), frozenAt: time,
  contentHash: hash, questionSetHash: hash, questionCount: safeInteger.min(1), payload: z.unknown().transform(parseGeoKbPayloadV2),
  questionSet: z.unknown().transform(parseGeoQuestionSetV2), context: z.unknown().transform(parseGeoSnapshotContextV2Shape),
}).strict();
export function parseGeoKbFrozenV2Wire(value: unknown): GeoKbFrozenV2Wire | null {
  try {
    bounded(value, 1_572_864);
    const parsed = frozenSchema.parse(value);
    requireLink(parsed.context.kbId === parsed.kbId && parsed.contentHash === parsed.context.payloadHash
      && parsed.questionSetHash === parsed.context.questionSetHash && parsed.questionCount === parsed.questionSet.questions.length);
    linkedKnowledge(parsed.payload, parsed.questionSet, parsed.context);
    return parsed;
  } catch { return null; }
}

const profileSchema = z.object({ reference: z.unknown(), productName: z.string().max(2048), oneLinePositioning: z.string().max(2048), coreFeatures: z.array(z.string().max(2048)).max(32),
  market: z.object({ country: z.string().max(2048), language: z.string().max(2048) }).strict(),
  fieldProvenance: z.array(fieldProvenanceSchema).max(3).refine(rows => rows.every(row => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(row.path)) && new Set(rows.map(row => row.path)).size === rows.length).optional(),
  fullProfile: z.unknown().transform(parseMarketingWebsiteProfile).optional(),
}).strict();
// A preview is not a write-ready payload. Missing categories or an unsupported
// source locale must remain visible for correction, not acquire fake defaults.
// Role/fact review and copied-source metadata retain their full v2 validators.
const pendingDraftSchema = z.object({ schemaVersion: z.literal("marketing-geo-kb.v2"), targetUrl: z.string().max(2048), officialName: z.string().max(200),
  aliases: z.array(z.string().max(80)).max(12), categoryTerms: z.array(z.string().max(80)).max(8),
  market: z.object({ country: z.string().max(2), language: z.string().max(32) }).strict(),
  roles: z.array(geoRoleV2Schema).max(5), facts: z.array(geoFactV2Schema).max(24),
  competitors: z.array(z.object({ domain: z.string().max(255), brandName: z.string().max(200), confirmed: z.boolean(), aliases: z.array(z.string().max(200)).max(10).optional() }).strict().refine(value => !value.confirmed || value.brandName.trim().length > 0)).max(5),
  importedFrom: z.object({ websiteId: text(64), snapshotId: text(64), snapshotRevision: z.string().max(16) }).strict().nullable(),
  profileCopy: z.unknown().transform(parseGeoProfileCopy),
}).strict();
function parsePendingDraft(value: unknown): GeoKbPayloadV2 {
  bounded(value, 393_216);
  const parsed = pendingDraftSchema.parse(value);
  requireLink(new Set(parsed.roles.map(role => role.id)).size === parsed.roles.length && new Set(parsed.facts.map(fact => fact.key)).size === parsed.facts.length);
  return parsed;
}
const viewSchema = z.object({ schemaVersion: z.literal("marketing-geo-kb-editor.v2"), kbId: uuid, origin: text(2048), host: text(255),
  draftVersion: safeInteger, draftHash: hash.nullable(), profileCopyHash: hash, payload: z.unknown(), requiresSave: z.boolean(),
  profile: z.unknown(), frozen: z.unknown(), sourceReceipt: z.unknown(), prepared: z.unknown(),
  generations: z.object({ roles: z.unknown(), questions: z.unknown() }).strict(),
}).strict();
const legacyFrozenKeys = new Set(["snapshotId", "revision", "frozenAt", "contentHash", "questionCount", "retrievalCount", "payload", "questionSetHash", "registryVersion", "questions", "skippedLayers"]);
export function parseGeoKbEditorViewV2(value: unknown): GeoKbEditorViewV2 | null {
  try {
    bounded(value, 8_388_608);
    const parsed = viewSchema.parse(value), site = normalizeAccountWebsiteUrl(parsed.origin);
    const payload = parsed.requiresSave ? parsePendingDraft(parsed.payload) : parseGeoKbPayloadV2(parsed.payload);
    requireLink(site !== null && site.origin === parsed.origin && site.host === parsed.host && normalizeAccountWebsiteUrl(payload.targetUrl)?.host === parsed.host);
    requireLink((parsed.draftVersion === 0) === (parsed.draftHash === null) && (parsed.draftVersion > 0 || parsed.requiresSave));
    let profile: GeoInheritedProfile | null = null;
    if (parsed.profile !== null) {
      const shape = profileSchema.parse(parsed.profile); requireLink(isInheritedProfile(shape));
      if (shape.fullProfile !== undefined) {
        const full = shape.fullProfile;
        requireLink(shape.productName === full.productName && shape.oneLinePositioning === full.oneLinePositioning
          && same(shape.coreFeatures, full.coreFeatures) && shape.market.country === full.country && shape.market.language === full.locale);
        if (shape.fieldProvenance !== undefined) requireLink(same(shape.fieldProvenance, full.fieldProvenance.filter(field => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(field.path))));
      }
      profile = shape;
    }
    let frozen: GeoKbFrozenV2Wire | GeoKbFrozenSummary | null = null;
    if (parsed.frozen !== null) {
      const full = parseGeoKbFrozenV2Wire(parsed.frozen);
      if (full !== null) { requireLink(full.kbId === parsed.kbId && full.context.targetHost === parsed.host); frozen = full; }
      else {
        requireLink(isFrozen(parsed.frozen) && Object.keys(parsed.frozen).every(key => legacyFrozenKeys.has(key)));
        requireLink(uuid.safeParse(parsed.frozen.snapshotId).success && hash.safeParse(parsed.frozen.contentHash).success
          && Number.isSafeInteger(parsed.frozen.revision) && parsed.frozen.revision > 0 && Number.isFinite(Date.parse(parsed.frozen.frozenAt))
          && Number.isSafeInteger(parsed.frozen.questionCount) && parsed.frozen.questionCount >= 0
          && Number.isSafeInteger(parsed.frozen.retrievalCount) && parsed.frozen.retrievalCount >= 0 && parsed.frozen.retrievalCount <= parsed.frozen.questionCount);
        if (parsed.frozen.questions !== undefined) requireLink(parsed.frozen.questions.length === parsed.frozen.questionCount);
        requireLink(parsed.frozen.payload === undefined || (parsed.frozen.payload.schemaVersion === "marketing-geo-kb.v1" && normalizeAccountWebsiteUrl(parsed.frozen.payload.targetUrl)?.host === parsed.host));
        frozen = parsed.frozen;
      }
    }
    const sourceReceipt = parsed.sourceReceipt === null ? null : parseGeoKbSourceReportV2(parsed.sourceReceipt);
    if (sourceReceipt) requireLink(sourceReceipt.kbId === parsed.kbId && sourceReceipt.targetHost === parsed.host);
    const prepared = parsed.prepared === null ? null : parseGeoKbPreparedWire(parsed.prepared);
    requireLink(parsed.prepared === null || (prepared !== null && prepared.kbId === parsed.kbId && prepared.context.targetHost === parsed.host));
    const roles = parsed.generations.roles === null ? null : parseGeoKbGenerationWire(parsed.generations.roles);
    const questions = parsed.generations.questions === null ? null : parseGeoKbGenerationWire(parsed.generations.questions);
    requireLink(parsed.generations.roles === null || (roles !== null && roles.kbId === parsed.kbId && roles.kind === "roles"));
    requireLink(parsed.generations.questions === null || (questions !== null && questions.kbId === parsed.kbId && questions.kind === "questions"));
    if (questions?.result && "context" in questions.result) requireLink(questions.result.context.targetHost === parsed.host);
    return { ...parsed, payload, profile, frozen, sourceReceipt, prepared, generations: { roles, questions } };
  } catch { return null; }
}

export interface GeoKbDraftSaveV2 { readonly draftVersion: number; readonly contentHash: string; readonly updatedAt: string; readonly blockers: readonly string[] }
export interface GeoKbFreezeV2Response { readonly snapshotId: string; readonly revision: number; readonly frozenAt: string; readonly contentHash: string; readonly questionSetHash: string; readonly questionCount: number; readonly reusedExisting: boolean }
const draftSaveSchema = z.object({ draftVersion: safeInteger.min(1), contentHash: hash, updatedAt: time, blockers: z.array(text(200)).max(32) }).strict();
const freezeResponseSchema = z.object({ snapshotId: uuid, revision: safeInteger.min(1), frozenAt: time, contentHash: hash, questionSetHash: hash, questionCount: safeInteger.min(1), reusedExisting: z.boolean() }).strict();
export function parseGeoKbDraftSaveV2(value: unknown): GeoKbDraftSaveV2 | null {
  try { bounded(value, 8192); return draftSaveSchema.parse(value); } catch { return null; }
}
export function parseGeoKbFreezeV2Response(value: unknown): GeoKbFreezeV2Response | null {
  try { bounded(value, 4096); return freezeResponseSchema.parse(value); } catch { return null; }
}
