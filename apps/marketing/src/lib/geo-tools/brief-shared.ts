// @input -- exact owned frozen KB/context, selected question and optional owned run evidence
// @output -- the shared GEO v1.1 Brief; no provider call and no client-supplied observation
// @pos -- deterministic producer also used by the server-side Draft provenance verifier
import { GEO_CONTENT_BRIEF_SCHEMA, GEO_MUST_ANSWER_CAP, type GeoContentBrief, type GeoOutlineItem, type GeoSource } from "@sf/public-tools/content-brief/geo-contract";
import { deriveGeoFormat, deriveGeoMustAnswer, deriveGeoReadiness, geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import type { UnavailableReason } from "@sf/public-tools/content-brief/contract";
import { geoVersionedPayloadIdentity, type GeoVersionedPayloadIdentity, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import type { AnyGeoKnowledgePack, AnyVersionedGeoSnapshotContext } from "./kb-complete-read.ts";
import { GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 } from "./snapshot-context-v3.ts";
import type { AnyGeoQuestionSet } from "./kb-question-set-v2.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { geoBriefFactsForSnapshot } from "./brief-facts.ts";

export interface SharedBriefRunEvidence {
  readonly runId: string;
  readonly fingerprint: string;
  readonly gap: "A" | "D";
  readonly samples: GeoContentBrief["evidence"]["samples"];
  readonly siteIndex: GeoContentBrief["evidence"]["site_index"];
}
export interface SharedBriefBasisInput {
  readonly frozen: VersionedGeoKbFrozenSnapshot;
  readonly context: AnyVersionedGeoSnapshotContext | null;
  /**
   * The pack a v3 version publishes its facts in. v1/v2 versions keep their
   * facts in the frozen context and pass null; passing a v2 pack beside a
   * v1/v2 payload is refused rather than ignored.
   */
  readonly knowledgePack: AnyGeoKnowledgePack | null;
  readonly questionId: string | null;
  readonly questionText: string;
  readonly runEvidence: SharedBriefRunEvidence | null;
  readonly runId: string;
  readonly now: string;
}
export type SharedBriefOutlineResult = { readonly ok: true; readonly outline: GeoOutlineItem[] } | { readonly ok: false; readonly reason: UnavailableReason };
const missing = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 } as const;

/** V1 retains the shared source-scope repair; V2 projects only context-admitted
 * facts; V3 projects the published knowledge pack. */
function briefEvidence(input: SharedBriefBasisInput) {
  return geoBriefFactsForSnapshot(input.frozen, input.context, input.knowledgePack);
}

/** V2 requirements come from this exact question's translated source entities,
 * not unrelated criteria elsewhere in the role. V1 keeps its original policy. */
function questionCriteria(set: AnyGeoQuestionSet, roles: GeoVersionedPayloadIdentity["roles"], questionId: string | null): readonly string[] {
  if (questionId === null) return [];
  if (set.schemaVersion === "marketing-geo-question-set.v2") {
    const question = set.questions.find(item => item.id === questionId);
    if (question === undefined || question.roleId === null) return [];
    const entities = new Map(set.entityCatalog.map(entity => [entity.id, entity]));
    return [...new Set(question.provenance.entityRefs.flatMap(ref => {
      const entity = entities.get(ref);
      if (entity === undefined) throw new Error("question_entity_missing");
      return entity.kind === "role_criterion" && entity.roleId === question.roleId ? [entity.text] : [];
    }))];
  }
  const question = set.questions.find(item => item.id === questionId);
  const role = question?.roleId == null ? null : roles.find(item => item.id === question.roleId);
  return question === undefined || role == null || !["comparison", "evaluation"].includes(question.layer) ? [] : role.decisionCriteria;
}

export function sharedGeoBriefBasis(input: SharedBriefBasisInput): GeoContentBrief {
  const { frozen, context, runEvidence } = input;
  const identity = geoVersionedPayloadIdentity(frozen.payload);
  // A Brief is written against one frozen question, and its promptset reference
  // names the set it is bound to. A v3 version published without a question set
  // has nothing to bind to, and an invented reference would claim a set that
  // does not exist -- so such a version produces no Brief at all.
  const questionSet = frozen.questionSet;
  if (questionSet === null || frozen.questionSetHash === null) throw new Error("question_set_required");
  if (context !== null && (context.kbId !== frozen.kbId || context.payloadHash !== frozen.contentHash || context.questionSetHash !== frozen.questionSetHash || context.targetHost !== normalizeGeoHost(identity.targetUrl))) throw new Error("snapshot_context_mismatch");
  const picked = input.questionId === null ? null : questionSet.questions.find(question => question.id === input.questionId);
  if (input.questionId !== null && picked == null) throw new Error("question_not_found");
  if (runEvidence !== null && picked == null) throw new Error("manual_run_forbidden");
  const questionText = picked?.text ?? input.questionText;
  const role = picked?.roleId == null ? null : identity.roles.find(item => item.id === picked.roleId) ?? null;
  // A v3 context carries a profile *reference plus subset*, not the schema and
  // hash pair `profile_ref` names, so it stays null there rather than being
  // filled with an identifier that points at a different thing.
  const ref = context === null || context.schemaVersion === GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 ? null : context.profile?.reference ?? null;
  const { receipts, factTable } = briefEvidence(input);
  const criteria = questionCriteria(questionSet, identity.roles, input.questionId);
  // Q1 reserves one of the eight mandatory answers. Never truncate a question
  // that actually requires more than seven additional criterion statements.
  if (criteria.length > GEO_MUST_ANSWER_CAP - 1) throw new Error("required_anchor_budget_exceeded");
  const requirements = criteria.map((text, index) => ({ id: `${role!.id}:criterion:${index + 1}`, text }));
  // parse-brief-shape's text + unique array decoder compares exact strings:
  // no case, whitespace or Unicode folding. Keep the first frozen spelling.
  // This display projection never changes the original entity IDs or Q hash.
  const requiredEntities = picked == null ? [] : questionSet.schemaVersion === "marketing-geo-question-set.v2" ? [...new Set(picked.requiredEntities)] : [...picked.requiredEntities];
  const lead: GeoContentBrief["lead_answer"] = { question_id: "Q1", requirement: picked == null ? questionText : `In the opening 200 words, directly answer: ${questionText}`, required_entities: requiredEntities, source: picked == null ? "user_input" : "kb", fact_refs: receipts.filter(fact => fact.source === "kb").map(fact => fact.id) };
  const samples = runEvidence?.samples ?? [];
  const derived = deriveGeoMustAnswer(lead, samples, requirements);
  const intent: GeoContentBrief["intent"] = picked == null ? missing : { status: "available", value: ["comparison", "evaluation"].includes(picked.layer) ? "commercial" : picked.layer === "branded" ? "navigational" : "informational", provenance: { method: "heuristic", origin: "kb" } };
  const origin: GeoContentBrief["geo_origin"] = { kind: runEvidence === null ? "manual" : "visibility", question: { id: picked?.id ?? null, text: questionText }, role: role?.id ?? null, layer: picked?.layer ?? null, gap: runEvidence?.gap ?? null, run_ref: runEvidence === null ? null : { id: runEvidence.runId, fingerprint: runEvidence.fingerprint }, sample_refs: samples.map(sample => sample.id), kb_ref: { kb_id: frozen.kbId, snapshot_id: frozen.snapshotId, revision: frozen.revision, content_hash: frozen.contentHash }, promptset_ref: { schema: questionSet.schemaVersion, registry_version: questionSet.registryVersion, hash: frozen.questionSetHash }, profile_ref: ref === null ? null : { website_id: ref.websiteId, snapshot_id: ref.snapshotId, snapshot_revision: ref.snapshotRevision, profile_schema: ref.profileSchemaVersion, profile_hash: ref.profileHash } };
  const basis: GeoContentBrief = {
    schema: GEO_CONTENT_BRIEF_SCHEMA, source: "geo", run: { run_id: input.runId, collected_at: input.now, elapsed_ms: 0, budget_ms: 90000, fingerprint: "0".repeat(64) },
    keyword: { primary: questionText, supporting: [], market: identity.market.country, language: identity.market.language }, geo_origin: origin,
    evidence: { kb_requirements: requirements, samples, facts: receipts, site_index: runEvidence?.siteIndex ?? [] }, lead_answer: lead, ...derived, fact_table: factTable, outline: missing, intent,
    format: deriveGeoFormat({ geo_origin: origin, intent }), verdict: { action: "undecidable", reason: "geo_not_serp", provenance: null }, length: missing, gap_angle: missing,
    internal_links: runEvidence === null ? missing : { status: "available", items: runEvidence.siteIndex.slice(0, 10).map(page => ({ page_ref: page.id, why: page.title || page.url, source: "site_index" })) }, do_not_cover: missing,
    draft_readiness: { writable: [], gaps: [] },
  };
  return { ...basis, draft_readiness: deriveGeoReadiness(basis) };
}

export function sharedGeoModelSources(brief: GeoContentBrief): GeoSource[] {
  return [...new Set<GeoSource>([brief.lead_answer.source, ...brief.evidence.facts.map(fact => fact.source), ...(brief.evidence.samples.length ? ["ai_sample" as const] : []), ...(brief.evidence.site_index.length ? ["site_index" as const] : [])])];
}
export async function assembleSharedGeoBrief(basis: GeoContentBrief, reply: SharedBriefOutlineResult): Promise<GeoContentBrief> {
  const first = reply.ok ? reply.outline[0] : undefined;
  const candidate: GeoContentBrief = { ...basis, run: { ...basis.run }, outline: first === undefined || !reply.ok ? { status: "unavailable", reason: reply.ok ? "validation_failed" : reply.reason, attempted: 1 } : { status: "available", items: [first, ...reply.outline.slice(1)] } };
  candidate.draft_readiness = deriveGeoReadiness(candidate);
  candidate.run.fingerprint = await geoFingerprint(candidate);
  const checked = await parseGeoContentBrief(candidate);
  if (!checked.ok) throw new Error(`shared_brief_invalid:${checked.path}`);
  return checked.value;
}
