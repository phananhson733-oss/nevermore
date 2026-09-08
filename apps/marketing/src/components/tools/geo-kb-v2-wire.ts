// @input -- private JSON wire data for complete v2 knowledge and generation UI
// @output -- strict renderable DTOs, never cryptographic or ownership authority
// @pos -- browser-safe boundary; no hashing, stores, provider calls or secret fields
import { z } from "zod";
import type { AnyGeoPreparedCandidate, GeoPreparedCandidateV1, GeoPreparedCandidateV2 } from "../../lib/geo-tools/kb-prepared-contract.ts";
import type { GeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import type { GeoKbGenerationRecord } from "../../lib/geo-tools/kb-generation.ts";
import type { GeoKnowledgeGenerationResultV1 } from "../../lib/geo-tools/kb-knowledge-generation-contract.ts";
import type { GeoKnowledgePackV1 } from "../../lib/geo-tools/kb-knowledge-pack-contract.ts";
import type { GeoKnowledgePackV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import {
  GEO_EVIDENCE_GROUPS, GEO_KNOWLEDGE_LIMITS, geoComparisonRowContentShape, geoCoverageItemShape, geoEntityValueShape,
  geoEvidenceCheckSchema, geoEvidenceItemShape, geoFactContentShape, geoItemOriginSchema, geoList, geoMachineValueShape,
  geoModuleSchema, geoQaContentShape, geoRefList, geoShortText, geoSourceCatalogueItemSchema, geoSourceCompetitorSchema,
  geoStatementContentShape, geoTimestamp, geoUnique, refineGeoComparisonRow, refineGeoMachine,
} from "../../lib/geo-tools/kb-knowledge-shape.ts";
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
import { codePointLength, hasLoneSurrogate } from "../../lib/agents/geo-canonical.ts";
import { isFrozen, isInheritedProfile, type GeoKbFrozenSummary } from "./geo-kb-wire.ts";

export type GeoKbGenerationWire = Omit<GeoKbGenerationRecord, "userId" | "result"> & { readonly result: AnyGeoPreparedCandidate | GeoRoleProposal | GeoKnowledgeGenerationResultV1 | null };
export interface GeoKbFrozenV2Wire {
  readonly kbId: string; readonly snapshotId: string; readonly revision: number; readonly frozenAt: string;
  readonly contentHash: string; readonly questionSetHash: string; readonly questionCount: number;
  readonly payload: GeoKbPayloadV2; readonly questionSet: GeoQuestionSetV2; readonly context: GeoSnapshotContextV2;
}
/** Additive browser read model. The immutable payload/question/context schemas
 * stay v2; this discriminator prevents an old strict wire from being silently
 * reinterpreted when its companion customer pack is present. */
export interface GeoKbFrozenKnowledgeWire extends GeoKbFrozenV2Wire {
  readonly wireSchemaVersion: "marketing-geo-kb-frozen-wire.v1";
  readonly knowledgePack: GeoKnowledgePackV1 | GeoKnowledgePackV2 | null;
}
export interface GeoKbEditorViewV2 {
  readonly schemaVersion: "marketing-geo-kb-editor.v2";
  readonly kbId: string; readonly origin: string; readonly host: string;
  readonly draftVersion: number; readonly draftHash: string | null; readonly profileCopyHash: string; readonly payload: GeoKbPayloadV2; readonly requiresSave: boolean;
  readonly profile: GeoInheritedProfile | null;
  readonly frozen: GeoKbFrozenKnowledgeWire | GeoKbFrozenV2Wire | GeoKbFrozenSummary | null;
  readonly sourceReceipt: GeoKbSourceReportV2 | null;
  readonly prepared: AnyGeoPreparedCandidate | null;
  readonly generations: { readonly roles: GeoKbGenerationWire | null; readonly knowledge_pack?: GeoKbGenerationWire | null; readonly questions: GeoKbGenerationWire | null };
}

// Browser-safe mirrors of the durable result allowance. A test locks the
// result value to the server candidate constant without importing server-only
// runtime code into this module. All variable record fields are independently
// bounded below; 4 KiB covers their encoded envelope and future fixed metadata.
export const GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES = 2_359_296;
export const GEO_KB_GENERATION_RECORD_WIRE_MAX_BYTES = 4_096;
export const GEO_KB_GENERATION_WIRE_MAX_BYTES = GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES + GEO_KB_GENERATION_RECORD_WIRE_MAX_BYTES;

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid();
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const safeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger);
// Match the persisted knowledge contracts exactly: limits count Unicode code
// points, not UTF-16 units, and customer text cannot carry JSON-hostile
// controls or an unpaired surrogate that would hash differently after UTF-8.
// eslint-disable-next-line no-control-regex
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const text = (maximum: number) => z.string().refine(value => value.trim().length > 0
  && codePointLength(value) <= maximum && !unsafeText.test(value) && !hasLoneSurrogate(value));
const time = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const refs = z.array(geoSourceReceiptRefSchema).max(32).refine(rows => new Set(rows.map(row => row.receiptId)).size === rows.length);
const canonicalRefs = refs.superRefine((rows, ctx) => {
  if (rows.some((row, index) => index > 0 && rows[index - 1]!.receiptId.localeCompare(row.receiptId) >= 0)) ctx.addIssue({ code: "custom", message: "Source receipt references must be canonical" });
});
const counts = z.object({ profile: safeInteger.max(10_000), gsc: safeInteger.max(10_000), crawl: safeInteger.max(10_000), manual: safeInteger.max(10_000) }).strict();
const knowledgeReasons = ["not_collected", "not_published", "not_found", "fetch_failed", "blocked", "rate_limited", "timeout", "invalid_response", "partial_body", "unsupported_language", "generation_unavailable", "outcome_unknown", "insufficient_evidence", "not_applicable", "context_stale"] as const;
const publicUrl = z.string().max(2_048).refine(value => /^https?:\/\//u.test(value) && normalizeAccountWebsiteUrl(value)?.submittedUrl === value);
const competitorIdentitySchema = z.object({ key: text(128), name: text(200), confirmed: z.literal(true) }).strict();
const knowledgeSourceSchema = z.object({ id: text(128), kind: z.enum(["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact"]), label: text(120), url: publicUrl.nullable(),
  competitor: competitorIdentitySchema.nullable(), availability: z.enum(["available", "partial", "unavailable"]), reason: z.enum(knowledgeReasons).nullable(), observedAt: time.nullable(), bodyHash: hash.nullable(), excerpts: z.array(text(1_200)).max(8) }).strict();
const sourceCatalogueSchema = z.array(knowledgeSourceSchema).min(1).max(32).refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
const knowledgeSynthesisInputSchema = z.object({ schemaVersion: z.literal("marketing-geo-knowledge-synthesis-input.v1"), officialName: text(200), aliases: z.array(text(200)).max(12), categoryTerms: z.array(text(200)).max(12), market: text(32), language: text(32), targetUrl: publicUrl,
  confirmedCompetitors: z.array(competitorIdentitySchema).max(5), evidenceContentHash: hash, sourceCatalogueHash: hash, sourceCatalogue: sourceCatalogueSchema, contentHash: hash }).strict();
const unavailableModule = z.object({ status: z.literal("unavailable"), reason: z.enum(knowledgeReasons) }).strict();
const knowledgeModule = <T extends z.ZodTypeAny>(value: T) => z.union([
  z.object({ status: z.literal("available"), value }).strict(),
  z.object({ status: z.literal("partial"), limitation: text(2_400), value }).strict(),
  unavailableModule,
]);
const sourceIds = z.array(text(128)).min(1).max(16).refine(values => new Set(values).size === values.length);
const knowledgeEntitySchema = z.object({
  name: text(200), aliases: z.array(text(200)).max(12),
  categories: z.object({ primary: text(200), secondary: z.array(text(200)).max(12) }).strict(),
  definitions: z.object({ w25: text(800), w55: text(800), w120: text(800) }).strict(),
  audience: z.object({ who: text(800), notFor: text(800).nullable() }).strict(),
  founded: z.object({ year: z.string().regex(/^\d{4}$/u).nullable(), team: text(800).nullable(), location: text(800).nullable() }).strict(),
  disambiguation: text(800).nullable(),
  links: z.object({ home: publicUrl, pricing: publicUrl.nullable(), docs: publicUrl.nullable(), about: publicUrl.nullable(), changelog: publicUrl.nullable(), faq: publicUrl.nullable() }).strict(),
  sameAs: z.array(publicUrl).max(16), sourceRefs: sourceIds,
}).strict();
const knowledgeFactSchema = z.object({ id: text(128), type: z.enum(["price", "policy", "feature", "integration", "company", "audience", "data", "other"]), statement: text(800), sourceRefs: sourceIds, observedAt: time.nullable(), nextReviewAt: time.nullable() }).strict();
const knowledgeQaSchema = z.object({ id: text(128), intent: z.enum(["definition", "comparison", "price", "operation", "trust", "boundary", "alternative", "applicability", "other"]), question: text(800), variants: z.array(text(800)).max(8), directAnswer: text(800), expansion: text(2_400).nullable(), sourceRefs: sourceIds }).strict();
const knowledgeComparisonRowSchema = z.object({ id: text(128), dimension: text(120), product: text(800).nullable(), competitor: text(800).nullable(), sourceRefs: sourceIds, availability: z.enum(["available", "partial", "unavailable"]) }).strict();
const knowledgeComparisonSchema = z.object({ id: text(128), competitor: competitorIdentitySchema, checkedAt: time, rows: z.array(knowledgeComparisonRowSchema).min(1).max(16), verdict: text(800), sourceRefs: sourceIds }).strict();
const knowledgeStatementSchema = z.object({ id: text(128), text: text(800), sourceRefs: sourceIds }).strict();
const knowledgeScopeSchema = z.object({ does: z.array(knowledgeStatementSchema).max(24), doesNot: z.array(knowledgeStatementSchema).max(24), needsHuman: z.array(knowledgeStatementSchema).max(24), misconceptions: z.array(knowledgeStatementSchema).max(24) }).strict();
const knowledgeEvidenceItemSchema = z.object({ id: text(128), label: text(120), summary: text(800), url: publicUrl.nullable(), sourceRefs: sourceIds }).strict();
const knowledgeEvidenceSchema = z.object({ proof: z.array(knowledgeEvidenceItemSchema).max(32), changelog: z.array(knowledgeEvidenceItemSchema).max(32), press: z.array(knowledgeEvidenceItemSchema).max(32), thirdPartyProfiles: z.array(knowledgeEvidenceItemSchema).max(32) }).strict();
const machineStatus = z.enum(["present", "absent", "unreachable", "not_checked"]);
const machineObservation = z.object({ status: machineStatus, sourceRefs: sourceIds }).strict();
const knowledgeMachineSchema = z.object({
  jsonLd: z.object({ status: machineStatus, types: z.array(text(200)).max(32), sourceRefs: sourceIds }).strict(),
  llms: machineObservation, robots: machineObservation,
  sitemap: z.object({ status: machineStatus, urlCount: safeInteger.max(1_000_000).nullable(), knowledgePagesListed: z.boolean().nullable(), sourceRefs: sourceIds }).strict(),
  hreflang: z.object({ status: machineStatus, locales: z.array(text(200)).max(64), sourceRefs: sourceIds }).strict(),
}).strict();
const knowledgeCoverageSchema = z.object({ id: text(128), label: text(120), status: z.enum(["covered", "partial", "missing"]), summary: text(800), nextAction: text(800).nullable(), sourceRefs: sourceIds }).strict();
const knowledgePackSchema = z.object({ schemaVersion: z.literal("marketing-geo-knowledge-pack.v1"),
  meta: z.object({ generatedAt: time, lastScanAt: time, market: text(32), language: text(32), counts: z.object({ facts: safeInteger.max(64), qa: safeInteger.max(32), comparisons: safeInteger.max(5) }).strict() }).strict(),
  entity: knowledgeModule(knowledgeEntitySchema), facts: knowledgeModule(z.array(knowledgeFactSchema).min(1).max(64)),
  qa: knowledgeModule(z.array(knowledgeQaSchema).min(1).max(32)), comparisons: knowledgeModule(z.array(knowledgeComparisonSchema).min(1).max(5)),
  scope: knowledgeModule(knowledgeScopeSchema), evidence: knowledgeModule(knowledgeEvidenceSchema), machine: knowledgeModule(knowledgeMachineSchema),
  coverage: knowledgeModule(z.array(knowledgeCoverageSchema).min(1).max(24)),
  sourceCatalogue: sourceCatalogueSchema, contentHash: hash,
}).strict();
/**
 * The published knowledge pack v2, as the browser is allowed to see it.
 *
 * Built from the shared client-safe item shapes rather than hand-copied a
 * second time: v1's copy below drifted from its server contract precisely
 * because it was a copy, and a browser schema that silently fails to parse a
 * published version renders the version as if it had no knowledge at all.
 * What is deliberately absent is any integrity claim -- the digest and the
 * evidence checks stay server work, and matching strings here confer no
 * authority.
 */
const packDecisionSchema = z.enum(["accepted", "accepted_in_bulk"]);
const packProvenanceShape = {
  itemKey: hash, origin: geoItemOriginSchema, decision: packDecisionSchema,
  sourceRefs: geoRefList(0), priorSourceRefs: geoRefList(0),
  ownerDeclaredAt: geoTimestamp.nullable(), evidenceChecks: geoEvidenceCheckSchema,
} as const;
const packEntitySchema = z.object({
  ...geoEntityValueShape,
  fields: z.array(z.object({ field: geoShortText, ...packProvenanceShape }).strict()).max(32).refine(rows => geoUnique(rows.map(row => row.field))),
}).strict();
const packFactSchema = z.object({ ...geoFactContentShape, ...packProvenanceShape }).strict();
const packQaSchema = z.object({ ...geoQaContentShape, ...packProvenanceShape }).strict();
const packComparisonRowSchema = z.object({ ...geoComparisonRowContentShape, ...packProvenanceShape }).strict().superRefine(refineGeoComparisonRow);
const packComparisonSchema = z.object({
  id: text(128), competitor: geoSourceCompetitorSchema, checkedAt: geoTimestamp,
  rows: z.array(packComparisonRowSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisonRows),
  verdict: text(800), sourceRefs: geoRefList(1),
}).strict();
const packStatementSchema = z.object({ ...geoStatementContentShape, ...packProvenanceShape }).strict();
const packScopeSchema = z.object({
  does: geoList(packStatementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  doesNot: geoList(packStatementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  needsHuman: geoList(packStatementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  misconceptions: geoList(packStatementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
}).strict();
const packEvidenceItemSchema = z.object(geoEvidenceItemShape).strict();
const packEvidenceSchema = z.object({
  proof: geoList(packEvidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  changelog: geoList(packEvidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  press: geoList(packEvidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  thirdPartyProfiles: geoList(packEvidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  firstPartyProof: geoList(packEvidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  // Which groups were looked for at all. A group missing here was not collected;
  // a group present but empty was collected and found nothing.
  collected: z.array(z.enum(GEO_EVIDENCE_GROUPS)).max(GEO_EVIDENCE_GROUPS.length).refine(geoUnique),
}).strict();
const packMachineSchema = z.object(geoMachineValueShape).strict().superRefine(refineGeoMachine);
const packCoverageSchema = z.object(geoCoverageItemShape).strict();
const knowledgePackV2Schema = z.object({
  schemaVersion: z.literal("marketing-geo-knowledge-pack.v2"),
  meta: z.object({
    generatedAt: geoTimestamp, lastScanAt: geoTimestamp, market: text(32), language: text(32),
    counts: z.object({
      facts: safeInteger.max(GEO_KNOWLEDGE_LIMITS.facts), qa: safeInteger.max(GEO_KNOWLEDGE_LIMITS.qa),
      comparisons: safeInteger.max(GEO_KNOWLEDGE_LIMITS.comparisons),
      // How many published items were confirmed one by one, and how many were not.
      accepted: safeInteger.max(1_000), acceptedInBulk: safeInteger.max(1_000),
    }).strict(),
  }).strict(),
  entity: geoModuleSchema(packEntitySchema),
  facts: geoModuleSchema(z.array(packFactSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.facts)),
  qa: geoModuleSchema(z.array(packQaSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.qa)),
  comparisons: geoModuleSchema(z.array(packComparisonSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisons)),
  scope: geoModuleSchema(packScopeSchema),
  evidence: geoModuleSchema(packEvidenceSchema),
  machine: geoModuleSchema(packMachineSchema),
  coverage: geoModuleSchema(z.array(packCoverageSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.coverageItems)),
  sourceCatalogue: z.array(geoSourceCatalogueItemSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.sources)
    .refine(rows => geoUnique(rows.map(row => row.id))),
  contentHash: hash,
}).strict();

/** Render-shape only. Null means this browser cannot render the value, never
 * that the published version has no knowledge. */
export function parseGeoKnowledgePackWire(value: unknown): GeoKnowledgePackV1 | GeoKnowledgePackV2 | null {
  try {
    if (!record(value)) return null;
    return value.schemaVersion === "marketing-geo-knowledge-pack.v2"
      ? knowledgePackV2Schema.parse(value) as unknown as GeoKnowledgePackV2
      : knowledgePackSchema.parse(value) as GeoKnowledgePackV1;
  } catch { return null; }
}
const same = (a: unknown, b: unknown) => canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
function requireLink(condition: boolean): asserts condition { if (!condition) throw new Error("Inconsistent GEO wire data"); }
function bounded(value: unknown, maximum: number): void { requireLink(geoV2JsonbBytes(value) <= maximum); }

const preparedSchema = z.object({ schemaVersion: z.literal("marketing-geo-prepared-candidate.v1"), candidateId: uuid, kbId: uuid,
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value))),
  baseDraftHash: hash, profileCopyHash: hash, sourceReceiptRefs: refs, generatorVersion: text(128),
  payload: z.unknown().transform(parseGeoKbPayloadV2), questionSet: z.unknown().transform(parseGeoQuestionSetV2),
  context: z.unknown().transform(parseGeoSnapshotContextV2Shape), candidateHash: hash,
}).strict();
const preparedV2Schema = preparedSchema.omit({ schemaVersion: true, candidateHash: true }).extend({
  schemaVersion: z.literal("marketing-geo-prepared-candidate.v2"), knowledgePack: knowledgePackSchema,
  knowledgeSynthesisInput: knowledgeSynthesisInputSchema,
  knowledgeGeneration: z.object({ generationId: uuid, inputHash: hash, synthesisInputHash: hash, evidenceContentHash: hash, payloadHash: hash,
    questionSetHash: hash, packHash: hash, sourceCatalogueHash: hash, promptVersion: z.literal("geo-kb-knowledge-pack.v1") }).strict(),
  candidateHash: hash,
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

function parseGeoKbPreparedV1Wire(value: unknown): GeoPreparedCandidateV1 {
  const parsed = preparedSchema.parse(value);
  requireLink(parsed.context.kbId === parsed.kbId && parsed.context.candidateId === parsed.candidateId
    && parsed.context.payloadHash === parsed.baseDraftHash && parsed.generatorVersion === parsed.questionSet.methodVersion
    && same(parsed.sourceReceiptRefs, parsed.context.sourceReceiptRefs));
  linkedKnowledge(parsed.payload, parsed.questionSet, parsed.context);
  return parsed;
}

export function parseGeoKbPreparedWire(value: unknown): AnyGeoPreparedCandidate | null {
  try {
    bounded(value, GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES);
    if (!record(value) || value.schemaVersion === "marketing-geo-prepared-candidate.v1") return parseGeoKbPreparedV1Wire(value);
    const parsed = preparedV2Schema.parse(value);
    const { knowledgePack: _pack, knowledgeSynthesisInput: _synthesis, knowledgeGeneration: _generation, ...common } = parsed;
    parseGeoKbPreparedV1Wire({ ...common, schemaVersion: "marketing-geo-prepared-candidate.v1" });
    const pack = parsed.knowledgePack, synthesis = parsed.knowledgeSynthesisInput, generation = parsed.knowledgeGeneration;
    const submittedTarget = normalizeAccountWebsiteUrl(parsed.payload.targetUrl)?.submittedUrl;
    requireLink(pack.meta.market === parsed.payload.market.country && pack.meta.language === parsed.payload.market.language
      && normalizeAccountWebsiteUrl(synthesis.targetUrl)?.submittedUrl === submittedTarget
      && synthesis.officialName === parsed.payload.officialName && same(synthesis.aliases, parsed.payload.aliases)
      && same(synthesis.categoryTerms, parsed.payload.categoryTerms)
      && synthesis.market === parsed.payload.market.country && synthesis.language === parsed.payload.market.language
      && same(synthesis.confirmedCompetitors, parsed.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true })))
      && same(synthesis.sourceCatalogue, pack.sourceCatalogue.filter(source => source.availability !== "unavailable"))
      && generation.synthesisInputHash === synthesis.contentHash && generation.evidenceContentHash === synthesis.evidenceContentHash
      && generation.payloadHash === parsed.baseDraftHash && generation.questionSetHash === parsed.context.questionSetHash
      && generation.packHash === pack.contentHash);
    const targetHost = normalizeAccountWebsiteUrl(parsed.payload.targetUrl)?.host;
    const competitors = new Map(parsed.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => [competitor.domain, competitor.brandName]));
    for (const source of pack.sourceCatalogue) {
      if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null) requireLink(new URL(source.url).host === targetHost);
      if (source.kind === "competitor_page") requireLink(source.competitor !== null && source.url !== null && competitors.get(source.competitor.key) === source.competitor.name && new URL(source.url).host === source.competitor.key);
    }
    return parsed as unknown as GeoPreparedCandidateV2;
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

const knowledgeEvidenceEnvelopeSchema = z.object({ schemaVersion: z.literal("marketing-geo-knowledge-evidence.v1"), collectedAt: time, targetUrl: publicUrl,
  confirmedCompetitors: z.array(competitorIdentitySchema).max(5), availability: z.enum(["available", "partial", "unavailable"]), limitation: text(800).nullable(),
  pages: z.array(z.unknown()).max(18), machine: z.unknown(), sourceCatalogue: sourceCatalogueSchema, contentHash: hash }).strict();
const knowledgeNarrativeEnvelopeSchema = z.object({ schemaVersion: z.literal("marketing-geo-knowledge-narrative.v1"), entity: z.unknown(), facts: z.array(z.unknown()).max(64),
  qa: z.array(z.unknown()).max(32), comparisons: z.array(z.unknown()).max(5), scope: z.unknown() }).strict();
const knowledgeResultSchema = z.object({ schemaVersion: z.literal("marketing-geo-knowledge-generation-result.v1"), generationId: uuid, kbId: uuid,
  manifest: z.object({ schemaVersion: z.literal("marketing-geo-knowledge-generation-input.v1"), kbId: uuid,
    baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value))), baseDraftHash: hash, profileCopyHash: hash,
    sourceReceiptRefs: canonicalRefs, knowledgeSynthesisInput: knowledgeSynthesisInputSchema }).strict(),
  evidence: knowledgeEvidenceEnvelopeSchema, synthesisInput: knowledgeSynthesisInputSchema, narrative: knowledgeNarrativeEnvelopeSchema,
  generatedAt: time, contentHash: hash }).strict();
function parseGeoKbKnowledgeGenerationWire(value: unknown): GeoKnowledgeGenerationResultV1 | null {
  try {
    bounded(value, 2_097_152);
    const parsed = knowledgeResultSchema.parse(value);
    requireLink(parsed.manifest.kbId === parsed.kbId && same(parsed.manifest.knowledgeSynthesisInput, parsed.synthesisInput)
      && parsed.synthesisInput.evidenceContentHash === parsed.evidence.contentHash && parsed.synthesisInput.targetUrl === parsed.evidence.targetUrl
      && same(parsed.synthesisInput.confirmedCompetitors, parsed.evidence.confirmedCompetitors)
      && same(parsed.synthesisInput.sourceCatalogue, parsed.evidence.sourceCatalogue.filter(source => source.availability !== "unavailable"))
      && Date.parse(parsed.generatedAt) >= Date.parse(parsed.evidence.collectedAt));
    return parsed as unknown as GeoKnowledgeGenerationResultV1;
  } catch { return null; }
}

const attemptSchema = z.object({ attemptedCalls: z.union([z.literal(0), z.literal(1)]), delivery: z.enum(["not_attempted", "response_received", "outcome_unknown"]), modelRequested: text(200).nullable(), inputTokens: safeInteger.nullable(), outputTokens: safeInteger.nullable(), requestCount: safeInteger.nullable() }).strict();
const generationSchema = z.object({ generationId: uuid, kbId: uuid, kind: z.enum(["roles", "questions", "knowledge_pack"]), inputHash: hash,
  state: z.enum(["claimed", "dispatched", "succeeded", "failed", "uncertain"]), result: z.unknown(),
  errorReason: z.enum(["rate_limited", "quota_unavailable", "invalid_output", "provider_rejected", "outcome_unknown", "input_stale", "model_unavailable"]).nullable(),
  attempt: attemptSchema.nullable(),
}).strict();
export function parseGeoKbGenerationWire(value: unknown): GeoKbGenerationWire | null {
  try {
    bounded(value, GEO_KB_GENERATION_WIRE_MAX_BYTES);
    const parsed = generationSchema.parse(value), attempt = parsed.attempt;
    if (attempt !== null) requireLink((attempt.attemptedCalls === 0) === (attempt.delivery === "not_attempted"));
    if (parsed.state === "claimed" || parsed.state === "dispatched") {
      requireLink(parsed.result === null && parsed.errorReason === null && attempt === null);
      return { ...parsed, result: null };
    }
    if (parsed.state === "succeeded") {
      requireLink(parsed.errorReason === null && attempt?.attemptedCalls === 1 && attempt.delivery === "response_received");
      const result = parsed.kind === "roles" ? parseGeoKbRoleProposalWire(parsed.result)
        : parsed.kind === "knowledge_pack" ? parseGeoKbKnowledgeGenerationWire(parsed.result) : parseGeoKbPreparedWire(parsed.result);
      requireLink(result !== null && result.kbId === parsed.kbId && ("candidateId" in result ? result.candidateId : result.generationId) === parsed.generationId);
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

const frozenKnowledgeSchema = frozenSchema.extend({
  wireSchemaVersion: z.literal("marketing-geo-kb-frozen-wire.v1"),
  knowledgePack: z.unknown().nullable(),
}).strict();

function linkedCustomerPack(payload: GeoKbPayloadV2, pack: GeoKnowledgePackV1 | GeoKnowledgePackV2): void {
  requireLink(pack.meta.market === payload.market.country && pack.meta.language === payload.market.language);
  const target = normalizeAccountWebsiteUrl(payload.targetUrl);
  requireLink(target !== null);
  const confirmed = new Map(payload.competitors.filter(competitor => competitor.confirmed).map(competitor => [competitor.domain, competitor.brandName]));
  if (pack.entity.status !== "unavailable") {
    const entity = pack.entity.value;
    requireLink(entity.name === payload.officialName && same(entity.aliases, payload.aliases));
    requireLink(entity.categories.primary === payload.categoryTerms[0] && same(entity.categories.secondary, payload.categoryTerms.slice(1)));
    requireLink(normalizeAccountWebsiteUrl(entity.links.home)?.host === target.host);
  }
  for (const source of pack.sourceCatalogue) {
    if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null) {
      requireLink(normalizeAccountWebsiteUrl(source.url)?.host === target.host);
    }
    if (source.kind === "competitor_page") {
      requireLink(source.competitor !== null && source.url !== null);
      requireLink(confirmed.get(source.competitor.key) === source.competitor.name);
      requireLink(normalizeAccountWebsiteUrl(source.url)?.host === source.competitor.key);
    }
  }
}

export function parseGeoKbFrozenKnowledgeWire(value: unknown): GeoKbFrozenKnowledgeWire | null {
  try {
    bounded(value, 2_359_296);
    const parsed = frozenKnowledgeSchema.parse(value);
    const { wireSchemaVersion, knowledgePack: rawPack, ...legacy } = parsed;
    const base = parseGeoKbFrozenV2Wire(legacy);
    requireLink(base !== null);
    // The server already verified the cryptographic pack identity. This
    // browser boundary validates the complete render shape without importing
    // Node crypto or pretending to re-establish server authority.
    const knowledgePack = rawPack === null ? null : parseGeoKnowledgePackWire(rawPack);
    // A stored pack that will not parse is an inconsistency, not an absent
    // pack: rendering null here would show a published version as having no
    // customer knowledge at all.
    requireLink(rawPack === null || knowledgePack !== null);
    if (knowledgePack !== null) linkedCustomerPack(base.payload, knowledgePack);
    return { ...base, wireSchemaVersion, knowledgePack };
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
  generations: z.object({ roles: z.unknown(), knowledge_pack: z.unknown().optional(), questions: z.unknown() }).strict(),
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
    let frozen: GeoKbFrozenKnowledgeWire | GeoKbFrozenV2Wire | GeoKbFrozenSummary | null = null;
    if (parsed.frozen !== null) {
      const full = parseGeoKbFrozenKnowledgeWire(parsed.frozen) ?? parseGeoKbFrozenV2Wire(parsed.frozen);
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
    const knowledge = parsed.generations.knowledge_pack === undefined || parsed.generations.knowledge_pack === null ? null : parseGeoKbGenerationWire(parsed.generations.knowledge_pack);
    const questions = parsed.generations.questions === null ? null : parseGeoKbGenerationWire(parsed.generations.questions);
    requireLink(parsed.generations.roles === null || (roles !== null && roles.kbId === parsed.kbId && roles.kind === "roles"));
    requireLink(parsed.generations.knowledge_pack === undefined || parsed.generations.knowledge_pack === null || (knowledge !== null && knowledge.kbId === parsed.kbId && knowledge.kind === "knowledge_pack"));
    requireLink(parsed.generations.questions === null || (questions !== null && questions.kbId === parsed.kbId && questions.kind === "questions"));
    if (questions?.result && "context" in questions.result) requireLink(questions.result.context.targetHost === parsed.host);
    return { ...parsed, payload, profile, frozen, sourceReceipt, prepared,
      generations: { roles, ...(parsed.generations.knowledge_pack === undefined ? {} : { knowledge_pack: knowledge }), questions } };
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
