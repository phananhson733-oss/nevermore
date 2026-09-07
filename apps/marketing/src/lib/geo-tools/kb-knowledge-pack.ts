// @input -- frozen v2 payload/context and receipt-bound evidence/synthesis outputs
// @output -- deterministic customer GEO knowledge pack; never fetches, generates, or persists
// @pos -- pure assembly boundary between approved contracts and customer rendering
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { geoNumbersSupported } from "./geo-numeric-literal.ts";
import { parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { buildGeoKnowledgePackV1, type GeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { parseGeoKnowledgeNarrativeV1, parseGeoKnowledgeSynthesisInputV1, type GeoKnowledgeNarrativeV1 } from "./kb-knowledge-synthesis-contract.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { parseGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";

const FAILURE_REASONS = ["unsupported_language", "generation_unavailable", "outcome_unknown", "insufficient_evidence", "timeout"] as const;
type NarrativeFailureReason = typeof FAILURE_REASONS[number];
type EntityModule = GeoKnowledgePackV1["entity"];
type FactsModule = GeoKnowledgePackV1["facts"];
type QaModule = GeoKnowledgePackV1["qa"];
type ComparisonsModule = GeoKnowledgePackV1["comparisons"];
type ScopeModule = GeoKnowledgePackV1["scope"];
type EvidenceModule = GeoKnowledgePackV1["evidence"];
type MachineModule = GeoKnowledgePackV1["machine"];
type CoverageModule = GeoKnowledgePackV1["coverage"];
type EntityValue = Extract<EntityModule, { status: "available" }>["value"];
type FactsValue = Extract<FactsModule, { status: "available" }>["value"];
type QaValue = Extract<QaModule, { status: "available" }>["value"];
type ComparisonsValue = Extract<ComparisonsModule, { status: "available" }>["value"];
type ScopeValue = Extract<ScopeModule, { status: "available" }>["value"];
type EvidenceValue = Extract<EvidenceModule, { status: "available" }>["value"];
type MachineValue = Extract<MachineModule, { status: "available" }>["value"];
type CoverageValue = Extract<CoverageModule, { status: "available" }>["value"];
type UnavailableModule = Extract<EntityModule, { status: "unavailable" }>;

function canonicalTimestamp(value: string): boolean { return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function normalized(value: string): string { return value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim(); }
function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function containsExactPhrase(excerpt: string, value: string): boolean { return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(value)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(excerpt); }
function containsExactFactValue(excerpt: string, value: string): boolean { return containsExactPhrase(excerpt, value) && geoNumbersSupported([value], [excerpt]); }
function unavailable(reason: UnavailableModule["reason"]): UnavailableModule { return { status: "unavailable", reason }; }
function latestObservation(sourceRefs: readonly string[], evidence: GeoKnowledgeEvidenceV1): string | null { return sourceRefs.flatMap(ref => evidence.sourceCatalogue.find(source => source.id === ref)?.observedAt ?? []).sort().at(-1) ?? null; }
function uniqueSourceRefs(sourceRefs: readonly string[]): string[] { return [...new Set(sourceRefs)]; }
function entitySourceRefs(module: EntityModule, fallback: string): string[] { return module.status === "unavailable" ? [fallback] : uniqueSourceRefs(module.value.sourceRefs); }
function collectionSourceRefs(module: FactsModule | QaModule | ComparisonsModule, fallback: string): string[] { return module.status === "unavailable" ? [fallback] : uniqueSourceRefs(module.value.flatMap(item => item.sourceRefs)); }
function scopeSourceRefs(module: ScopeModule, fallback: string): string[] { return module.status === "unavailable" ? [fallback] : uniqueSourceRefs(Object.values(module.value).flatMap(items => items.flatMap(item => item.sourceRefs))); }
function evidenceSourceRefs(module: EvidenceModule, fallback: string): string[] { return module.status === "unavailable" ? [fallback] : uniqueSourceRefs(Object.values(module.value).flatMap(items => items.flatMap(item => item.sourceRefs))); }
function machineSourceRefs(module: MachineModule, fallback: string): string[] { return module.status === "unavailable" ? [fallback] : uniqueSourceRefs(Object.values(module.value).flatMap(item => item.sourceRefs)); }

function parseInputs(input: BuildGeoKnowledgePackInput) {
  if (!canonicalTimestamp(input.generatedAt)) throw new Error("Invalid pack generation time");
  const payload = parseGeoKbPayloadV2(input.payload); const context = parseGeoSnapshotContextV2(input.context); const questionSet = parseGeoQuestionSetV2(input.questionSet); const evidence = parseGeoKnowledgeEvidenceV1(input.evidence); const synthesisInput = input.synthesisInput === null ? null : parseGeoKnowledgeSynthesisInputV1(input.synthesisInput);
  const host = normalizeAccountWebsiteUrl(payload.targetUrl)?.host;
  if (host === null || host === undefined || context.targetHost !== host || context.payloadHash !== geoV2Digest(payload) || !same(context.competitors, payload.competitors)) throw new Error("Payload/context identity mismatch");
  if (geoV2Digest(questionSet) !== context.questionSetHash || questionSet.country !== payload.market.country || questionSet.language !== payload.market.language || normalizeAccountWebsiteUrl(evidence.targetUrl)?.submittedUrl !== normalizeAccountWebsiteUrl(payload.targetUrl)?.submittedUrl || input.generatedAt < evidence.collectedAt) throw new Error("Evidence, question set, or time mismatch");
  if (input.narrative !== null && synthesisInput === null) throw new Error("Narrative requires synthesis input"); const projected = evidence.sourceCatalogue.filter(source => source.availability !== "unavailable");
  if (synthesisInput !== null && (synthesisInput.targetUrl !== evidence.targetUrl || synthesisInput.evidenceContentHash !== evidence.contentHash || !same(synthesisInput.sourceCatalogue, projected))) throw new Error("Synthesis evidence identity mismatch");
  const confirmed = payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true }));
  if (synthesisInput !== null && (synthesisInput.officialName !== payload.officialName || !same(synthesisInput.aliases, payload.aliases) || !same(synthesisInput.categoryTerms, payload.categoryTerms) || synthesisInput.market !== payload.market.country || synthesisInput.language !== payload.market.language || !same(synthesisInput.confirmedCompetitors, confirmed) || !same(evidence.confirmedCompetitors, confirmed))) throw new Error("Synthesis payload identity mismatch");
  if (input.narrative === null ? input.narrativeFailureReason === null || !FAILURE_REASONS.includes(input.narrativeFailureReason) : input.narrativeFailureReason !== null) throw new Error("Invalid narrative result pairing");
  const narrative = input.narrative === null ? null : parseGeoKnowledgeNarrativeV1(input.narrative, synthesisInput!);
  return { payload, context, evidence, synthesisInput, narrative };
}

function links(evidence: GeoKnowledgeEvidenceV1) {
  const home = evidence.targetUrl; const host = new URL(home).host; const ownUrls = new Set(evidence.sourceCatalogue.filter(source => source.kind === "own_page" && source.availability !== "unavailable" && source.url !== null).map(source => source.url!)); const pages = evidence.pages.filter(page => new URL(page.url).host === host);
  const forIntent = (intent: "pricing" | "docs" | "about" | "changelog" | "faq") => pages.flatMap(page => page.links.filter(link => link.intent === intent && new URL(link.url).host === host && ownUrls.has(link.url)).map(link => link.url)).sort()[0] ?? null;
  return { home, pricing: forIntent("pricing"), docs: forIntent("docs"), about: forIntent("about"), changelog: forIntent("changelog"), faq: forIntent("faq") };
}
function entityModule(payload: GeoKbPayloadV2, evidence: GeoKnowledgeEvidenceV1, narrative: GeoKnowledgeNarrativeV1 | null): EntityModule {
  if (narrative === null) return unavailable("generation_unavailable");
  const value: EntityValue = { name: payload.officialName, aliases: [...payload.aliases], categories: { primary: payload.categoryTerms[0]!, secondary: payload.categoryTerms.slice(1) }, definitions: narrative.entity.definitions, audience: narrative.entity.audience, founded: narrative.entity.founded, disambiguation: narrative.entity.disambiguation, links: links(evidence), sameAs: [], sourceRefs: [...narrative.entity.sourceRefs] };
  return Object.values(value.links).some(link => link === null) ? { status: "partial", limitation: "Some optional public links were not observed.", value } : { status: "available", value };
}
function factsModule(context: ReturnType<typeof parseGeoSnapshotContextV2>, evidence: GeoKnowledgeEvidenceV1, narrative: GeoKnowledgeNarrativeV1 | null, failure: NarrativeFailureReason): FactsModule {
  const narrativeFacts = narrative?.facts.map(fact => ({ ...fact, observedAt: latestObservation(fact.sourceRefs, evidence), nextReviewAt: null })) ?? [];
  const accepted = context.facts.filter(fact => fact.source !== "none" && fact.value !== null); const missing: string[] = [];
  const exactFacts = accepted.flatMap(fact => { const source = evidence.sourceCatalogue.find(item => item.kind === "accepted_fact" && normalized(item.label) === normalized(fact.key) && item.excerpts.some(excerpt => containsExactFactValue(excerpt, fact.value!))); if (source === undefined) { missing.push(fact.key); return []; } const statement = source.excerpts.find(excerpt => containsExactFactValue(excerpt, fact.value!))!; return [{ id: `fact:accepted-${geoV2Digest({ key: fact.key, source: source.id }).slice(0, 20)}`, type: "other" as const, statement, sourceRefs: [source.id], observedAt: latestObservation([source.id], evidence), nextReviewAt: null }]; });
  const value: FactsValue = [...narrativeFacts, ...exactFacts.filter(item => !narrativeFacts.some(existing => existing.id === item.id || existing.statement === item.statement))];
  if (value.length === 0) return narrative === null ? unavailable(failure) : unavailable("insufficient_evidence");
  return missing.length > 0 ? { status: "partial", limitation: "Some accepted facts lacked an exact cited evidence excerpt.", value } : { status: "available", value };
}
function qaModule(narrative: GeoKnowledgeNarrativeV1 | null): QaModule { if (narrative === null) return unavailable("generation_unavailable"); if (narrative.qa.length === 0) return unavailable("insufficient_evidence"); const value: QaValue = narrative.qa; return { status: "available", value }; }
function comparisonsModule(evidence: GeoKnowledgeEvidenceV1, narrative: GeoKnowledgeNarrativeV1 | null): ComparisonsModule { if (narrative === null) return unavailable("generation_unavailable"); if (narrative.comparisons.length === 0) return unavailable(evidence.confirmedCompetitors.length === 0 ? "not_applicable" : "insufficient_evidence"); const value: ComparisonsValue = narrative.comparisons.map(comparison => ({ ...comparison, checkedAt: evidence.collectedAt })); return { status: "available", value }; }
function scopeModule(narrative: GeoKnowledgeNarrativeV1 | null): ScopeModule { if (narrative === null) return unavailable("generation_unavailable"); const value: ScopeValue = narrative.scope; return { status: "available", value }; }
function evidenceModule(evidence: GeoKnowledgeEvidenceV1): EvidenceModule {
  const pages = evidence.sourceCatalogue.filter(source => source.kind === "own_page" && source.availability !== "unavailable"); const changelogUrls = new Set(evidence.pages.flatMap(page => page.links.filter(link => link.intent === "changelog").map(link => link.url)));
  const item = (source: typeof pages[number]) => ({ id: `evidence:${source.id}`, label: source.label, summary: source.excerpts[0]!, url: source.url, sourceRefs: [source.id] });
  const value: EvidenceValue = { proof: pages.filter(source => !changelogUrls.has(source.url!)).map(item), changelog: pages.filter(source => changelogUrls.has(source.url!)).map(item), press: [], thirdPartyProfiles: [] };
  if (pages.length === 0) return unavailable("insufficient_evidence"); return pages.some(source => source.availability === "partial") ? { status: "partial", limitation: "Some collected own-site evidence is partial.", value } : { status: "available", value };
}
function machineModule(evidence: GeoKnowledgeEvidenceV1): MachineModule {
  const unavailableOwn = (refs: readonly string[]) => refs.some(ref => evidence.sourceCatalogue.find(source => source.id === ref)?.availability === "unavailable"); const value: MachineValue = { jsonLd: { ...evidence.machine.jsonLd, status: evidence.machine.jsonLd.status === "absent" && unavailableOwn(evidence.machine.jsonLd.sourceRefs) ? "unreachable" : evidence.machine.jsonLd.status }, llms: evidence.machine.llms, robots: evidence.machine.robots, sitemap: { status: evidence.machine.sitemap.status, urlCount: evidence.machine.sitemap.urlCount, knowledgePagesListed: evidence.machine.sitemap.knowledgePagesListed, sourceRefs: evidence.machine.sitemap.sourceRefs }, hreflang: { ...evidence.machine.hreflang, status: evidence.machine.hreflang.status === "absent" && unavailableOwn(evidence.machine.hreflang.sourceRefs) ? "unreachable" : evidence.machine.hreflang.status } };
  const signals = [value.jsonLd, value.llms, value.robots, value.sitemap, value.hreflang]; return signals.every(signal => signal.status === "present") ? { status: "available", value } : { status: "partial", limitation: "Some machine-readable visibility signals were absent or unavailable.", value };
}
type ContentModule = EntityModule | FactsModule | QaModule | ComparisonsModule | ScopeModule | EvidenceModule | MachineModule;
function coverageRow(id: string, label: string, module: ContentModule, sourceRefs: string[]): CoverageValue[number] {
  if (module.status === "available") return { id, label, status: "covered", summary: "Supported content is available.", nextAction: null, sourceRefs };
  if (module.status === "partial") return { id, label, status: "partial", summary: module.limitation, nextAction: "Review available evidence before relying on this section.", sourceRefs };
  return { id, label, status: "missing", summary: "This content is currently unavailable.", nextAction: "Review available evidence before relying on this section.", sourceRefs };
}
function coverageModule(modules: { entity: EntityModule; facts: FactsModule; qa: QaModule; comparisons: ComparisonsModule; scope: ScopeModule; evidence: EvidenceModule; machine: MachineModule }, fallback: string): CoverageModule {
  const labels = { entity: "Entity", facts: "Facts", qa: "Q&A", comparisons: "Comparisons", scope: "Scope", evidence: "Evidence", machine: "Machine visibility" } as const;
  const rows: CoverageValue = [
    coverageRow("coverage:entity", labels.entity, modules.entity, entitySourceRefs(modules.entity, fallback)),
    coverageRow("coverage:facts", labels.facts, modules.facts, collectionSourceRefs(modules.facts, fallback)),
    coverageRow("coverage:qa", labels.qa, modules.qa, collectionSourceRefs(modules.qa, fallback)),
    coverageRow("coverage:comparisons", labels.comparisons, modules.comparisons, collectionSourceRefs(modules.comparisons, fallback)),
    coverageRow("coverage:scope", labels.scope, modules.scope, scopeSourceRefs(modules.scope, fallback)),
    coverageRow("coverage:evidence", labels.evidence, modules.evidence, evidenceSourceRefs(modules.evidence, fallback)),
    coverageRow("coverage:machine", labels.machine, modules.machine, machineSourceRefs(modules.machine, fallback)),
  ];
  return rows.some(row => row.status !== "covered") ? { status: "partial", limitation: "Some customer knowledge sections are incomplete.", value: rows } : { status: "available", value: rows };
}

export interface BuildGeoKnowledgePackInput { readonly generatedAt: string; readonly payload: unknown; readonly context: unknown; readonly questionSet: unknown; readonly evidence: unknown; readonly synthesisInput: unknown | null; readonly narrative: unknown | null; readonly narrativeFailureReason: NarrativeFailureReason | null; }
export function buildGeoKnowledgePack(input: BuildGeoKnowledgePackInput): GeoKnowledgePackV1 {
  const parsed = parseInputs(input); const { payload, context, evidence, narrative } = parsed; const failure = input.narrativeFailureReason ?? "generation_unavailable";
  const entity = narrative === null ? unavailable(failure) : entityModule(payload, evidence, narrative); const facts = factsModule(context, evidence, narrative, failure); const qa = narrative === null ? unavailable(failure) : qaModule(narrative); const comparisons = narrative === null ? unavailable(failure) : comparisonsModule(evidence, narrative); const scope = narrative === null ? unavailable(failure) : scopeModule(narrative); const customerEvidence = evidenceModule(evidence); const machine = machineModule(evidence); const fallback = evidence.sourceCatalogue[0]?.id; if (fallback === undefined) throw new Error("Evidence source catalogue is empty"); const coverage = coverageModule({ entity, facts, qa, comparisons, scope, evidence: customerEvidence, machine }, fallback);
  return buildGeoKnowledgePackV1({ schemaVersion: "marketing-geo-knowledge-pack.v1", meta: { generatedAt: input.generatedAt, lastScanAt: evidence.collectedAt, market: payload.market.country, language: payload.market.language, counts: { facts: facts.status === "unavailable" ? 0 : facts.value.length, qa: qa.status === "unavailable" ? 0 : qa.value.length, comparisons: comparisons.status === "unavailable" ? 0 : comparisons.value.length } }, entity, facts, qa, comparisons, scope, evidence: customerEvidence, machine, coverage, sourceCatalogue: evidence.sourceCatalogue });
}
