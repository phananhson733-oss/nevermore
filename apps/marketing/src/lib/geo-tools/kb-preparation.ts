// @input -- exact saved v2 content, checked semantic output and owned source selections
// @output -- a complete immutable prepared candidate for explicit human confirmation
// @pos -- pure assembly: no source reads, model calls, config access or persistence
import { createHash } from "node:crypto";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { createGeoPreparedCandidate, GEO_PREPARED_CANDIDATE_SCHEMA, type GeoPreparedCandidateV1 } from "./kb-prepared-contract.ts";
import { parseGeoQuestionSynthesis, parseGeoQuestionSynthesisInput, type GeoQuestionSynthesisInput, type GeoQuestionSynthesis, type GeoSynthesisEntity } from "./kb-synthesis-contract.ts";
import { buildGeoSnapshotContextV2, type BuildGeoSnapshotContextV2Input } from "./snapshot-context-v2.ts";
import { assertRegistryQuestionsMatch, parseGeoQuestionSetV2, GEO_QUESTION_SET_SCHEMA_VERSION_V2, type GeoQuestionEntityV2, type GeoQuestionV2 } from "./kb-question-set-v2.ts";
import { buildGeoQuestionSet, type GeoQuestion, type GeoQuestionSet } from "./kb-questions.ts";
import { parseGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { GEO_QUESTION_SYNTHESIS_PROMPT_VERSION } from "./kb-synthesis.ts";

export interface BuildGeoPreparedKnowledgeBaseInput extends Pick<BuildGeoSnapshotContextV2Input, "sourceReceiptRefs" | "evidenceCatalog" | "sourceSummary" | "modelRoleEdits" | "verifiedFactSupport" | "competitorEvidence"> {
  readonly candidateId: string;
  readonly kbId: string;
  readonly baseDraftVersion: number;
  readonly payload: GeoKbPayloadV2;
  readonly semanticInput: GeoQuestionSynthesisInput;
  readonly semanticOutput: unknown;
}

const same = (left: unknown, right: unknown) => canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
function semanticQuestionId(id: string): string {
  const prefixed = `semantic:${id}`;
  // Do not truncate model IDs into collisions when the namespace adds bytes.
  return prefixed.length <= 128 ? prefixed : `semantic:sha256:${createHash("sha256").update(id).digest("hex")}`;
}

function assertSavedBasis(input: BuildGeoPreparedKnowledgeBaseInput, payload: GeoKbPayloadV2, semantic: GeoQuestionSynthesisInput): void {
  const accepted = payload.roles.filter(role => role.review === "accepted").map(({ review: _review, source: _source, ...wording }) => wording);
  const provided = semantic.roles.map(({ evidenceRefs: _refs, ...wording }) => wording);
  if (semantic.officialName !== payload.officialName || !same(semantic.aliases, payload.aliases)
    || semantic.language !== payload.market.language || !same(accepted, provided)) throw new Error("Semantic input differs from the saved draft");
  const evidence = new Map(input.evidenceCatalog.map(item => [item.id, item]));
  if (evidence.size !== input.evidenceCatalog.length || semantic.evidenceSources.some(item => !evidence.has(item.id) || !same(item, evidence.get(item.id)))) throw new Error("Semantic evidence differs from the selected source catalogue");
  const positiveFacts = payload.facts.filter(fact => fact.review === "accepted" && fact.reason === "" && fact.value !== "" && (fact.supportRef === null || input.verifiedFactSupport?.some(support =>
    support.receiptId === fact.supportRef!.receiptId && support.evidenceId === fact.supportRef!.evidenceId
    && support.key === fact.key && support.value === fact.value && support.sourceUrl === fact.sourceUrl && support.observedAt === fact.observedAt)));
  for (const entity of semantic.entities) {
    if (entity.kind === "category" && !payload.categoryTerms.includes(entity.text)) throw new Error("Semantic category differs from the saved draft");
    if (entity.kind === "competitor" && !payload.competitors.some(competitor => competitor.confirmed && competitor.brandName === entity.text)) throw new Error("Semantic competitor is not confirmed");
    if (entity.kind === "fact" && !positiveFacts.some(fact => fact.value === entity.text)) throw new Error("Semantic fact lacks exact accepted support");
    // Role/brand membership was checked by parseGeoQuestionSynthesisInput;
    // the exact accepted-role comparison above ties that check to this draft.
  }
}

/** Only complete translated source concepts enter this temporary v1 input.
 * Missing/oversized translations are omitted, never shortened or guessed.
 * The persisted v2 payload itself is left completely unchanged. */
function registryProjection(payload: GeoKbPayloadV2, semantic: GeoQuestionSynthesisInput, output: GeoQuestionSynthesis): GeoKbPayload | null {
  const translated = new Map(output.entities.map(entity => [entity.id, entity.text]));
  const concepts = (kind: GeoSynthesisEntity["kind"], roleId: string | null, values: readonly string[]) => values.flatMap(value => {
    const source = semantic.entities.find(entity => entity.kind === kind && entity.roleId === roleId && entity.text === value);
    const text = source === undefined ? undefined : translated.get(source.id);
    return text !== undefined && text.length <= 80 ? [text] : [];
  });
  const categoryTerms = concepts("category", null, payload.categoryTerms);
  if (!categoryTerms.length) return null;
  const projection = {
    schemaVersion: "marketing-geo-kb.v1", targetUrl: payload.targetUrl, officialName: payload.officialName,
    aliases: payload.aliases, categoryTerms, market: payload.market, competitors: payload.competitors,
    roles: payload.roles.filter(role => role.review === "accepted" && /[A-Za-z]/u.test(role.questionLabel)).map(role => ({
      id: role.id, label: role.questionLabel, segment: role.segment,
      painPoints: concepts("role_pain", role.id, role.painPoints),
      decisionCriteria: concepts("role_criterion", role.id, role.decisionCriteria),
      vocabulary: concepts("role_vocabulary", role.id, role.vocabulary),
    })),
    facts: [], importedFrom: payload.importedFrom,
  };
  const parsed = parseGeoKbPayload(projection);
  if (!parsed.ok) throw new Error("Registry projection is outside the v1 contract");
  return parsed.value;
}

function registryQuestion(original: GeoQuestion, registry: GeoQuestionSet, entities: readonly GeoQuestionEntityV2[]): GeoQuestionV2 | null {
  if (!original.calibrated || original.mode !== "retrieval" || original.text.length > 300 || original.requiredEntities.length === 0) return null;
  const selected: GeoQuestionEntityV2[] = [];
  for (const phrase of original.requiredEntities) {
    const matches = entities.filter(entity => entity.text === phrase && (entity.roleId === null || entity.roleId === original.roleId));
    const mapped = matches.find(entity => entity.roleId === original.roleId) ?? matches[0];
    if (mapped === undefined || selected.some(entity => entity.id === mapped.id)) return null;
    selected.push(mapped);
  }
  const evidenceRefs = [...new Set(selected.flatMap(entity => entity.evidenceRefs))];
  if (evidenceRefs.length > 32) return null;
  // All common fields, including requiredEntities and actual text, remain the
  // original renderer's bytes. A missing source map removes a row, not a field.
  return { ...original, provenance: { kind: "registry", generatorVersion: registry.registryVersion, evidenceRefs, entityRefs: selected.map(entity => entity.id) } };
}

export function buildGeoPreparedKnowledgeBase(input: BuildGeoPreparedKnowledgeBaseInput): GeoPreparedCandidateV1 {
  if (!Number.isSafeInteger(input.baseDraftVersion) || input.baseDraftVersion < 1) throw new Error("Invalid saved draft revision");
  const payload = parseGeoKbPayloadV2(input.payload);
  const checkedInput = parseGeoQuestionSynthesisInput(input.semanticInput);
  if (!checkedInput.ok) throw new Error("Invalid semantic input");
  const semantic = checkedInput.value;
  assertSavedBasis(input, payload, semantic);
  const checkedOutput = parseGeoQuestionSynthesis(input.semanticOutput, semantic);
  if (!checkedOutput.ok) throw new Error("Invalid semantic output");
  const output = checkedOutput.value;
  const known = new Map(semantic.entities.map(entity => [entity.id, entity]));
  const entityCatalog: GeoQuestionEntityV2[] = output.entities.map(entity => ({ ...known.get(entity.id)!, text: entity.text }));
  const entityMap = new Map(entityCatalog.map(entity => [entity.id, entity]));
  const semanticQuestions: GeoQuestionV2[] = output.questions.map(question => ({
    id: semanticQuestionId(question.id), text: question.text, layer: question.layer, mode: "demand", roleId: question.roleId,
    requiredEntities: question.entityRefs.map(ref => entityMap.get(ref)!.text), templateId: null, calibrated: false,
    provenance: { kind: "semantic", generatorVersion: GEO_QUESTION_SYNTHESIS_PROMPT_VERSION, evidenceRefs: question.evidenceRefs, entityRefs: question.entityRefs },
  }));
  const projection = registryProjection(payload, semantic, output);
  const registry = projection === null ? null : buildGeoQuestionSet(projection);
  const calibrated = registry === null ? [] : registry.questions.flatMap(question => {
    const admitted = registryQuestion(question, registry, entityCatalog);
    return admitted === null ? [] : [admitted];
  });
  const questionSet = parseGeoQuestionSetV2({
    schemaVersion: GEO_QUESTION_SET_SCHEMA_VERSION_V2, registryVersion: registry?.registryVersion ?? "none",
    methodVersion: GEO_QUESTION_SYNTHESIS_PROMPT_VERSION, country: payload.market.country, language: payload.market.language,
    evidenceRefs: semantic.evidenceSources.map(source => source.id), entityCatalog, questions: [...semanticQuestions, ...calibrated],
  });
  if (registry !== null) assertRegistryQuestionsMatch(questionSet, registry);
  const context = buildGeoSnapshotContextV2({
    candidateId: input.candidateId, kbId: input.kbId, payload, questionSet,
    sourceReceiptRefs: input.sourceReceiptRefs, evidenceCatalog: input.evidenceCatalog, sourceSummary: input.sourceSummary,
    ...(input.modelRoleEdits === undefined ? {} : { modelRoleEdits: input.modelRoleEdits }),
    ...(input.verifiedFactSupport === undefined ? {} : { verifiedFactSupport: input.verifiedFactSupport }),
    ...(input.competitorEvidence === undefined ? {} : { competitorEvidence: input.competitorEvidence }),
  });
  return createGeoPreparedCandidate({
    schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA, candidateId: input.candidateId, kbId: input.kbId,
    baseDraftVersion: String(input.baseDraftVersion), baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy),
    sourceReceiptRefs: input.sourceReceiptRefs, generatorVersion: GEO_QUESTION_SYNTHESIS_PROMPT_VERSION,
    payload, questionSet, context,
  });
}
