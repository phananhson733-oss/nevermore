// @input -- bounded, receipt-backed evidence projected for a single synthesis call
// @output -- strict narrative data safe for deterministic knowledge-pack assembly
// @pos -- model text cannot invent authorities, URLs, competitors, or numeric claims
import { z } from "zod";

import { hasLoneSurrogate } from "../agents/geo-canonical.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import { parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { geoLiteralsAllSupported } from "./kb-knowledge-shape.ts";

export const GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA = "marketing-geo-knowledge-synthesis-input.v1" as const;
export const GEO_KNOWLEDGE_NARRATIVE_SCHEMA = "marketing-geo-knowledge-narrative.v1" as const;
export const GEO_KNOWLEDGE_SYNTHESIS_LIMITS = {
  inputBytes: 163_840, narrativeBytes: 131_072, sources: 32, aliases: 12, categoryTerms: 12, competitors: 5,
  sourceRefs: 16, facts: 64, qa: 32, variants: 8, comparisons: 5, comparisonRows: 16, scopeItems: 24,
  definitionCodePoints: { w25: 250, w55: 550, w120: 1_200 },
} as const;

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;
// JSON can encode these controls, but the stored customer pack intentionally cannot.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const URL_TEXT = /(?:https?:\/\/|www\.|(?:^|[^\p{L}\p{N}_-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?=$|[^\p{L}\p{N}_-]))/iu;
const PROPER_SUBJECT_CLAIM = /(?:^|[.!?]\s+)([A-Z]{2,}|[A-Z][\p{Ll}\p{N}&'’-]*(?:\s+(?:[A-Z]{2,}|[A-Z][\p{Ll}\p{N}&'’-]*))*)\s+(?:is|offers|provides|supports|competes|replaces|alternative|competitor|versus|vs)\b/gu;
const ORDINARY_SUBJECTS = new Set(["yes", "teams", "supports"]);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const canonicalTimestamp = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const normalized = (value: string) => value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
const normalizedUnique = (values: readonly string[]) => unique(values.map(normalized));
const text = (maximum: number) => z.string().refine(value => value.trim() !== "" && Array.from(value).length <= maximum && !CONTROL.test(value) && !hasLoneSurrogate(value), `Expected text up to ${maximum} code points`);
const id = text(128).regex(ID);
const hash = z.string().regex(HASH);
const publicUrl = z.string().max(2_048).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" && url.hash === "" && url.toString() === value; } catch { return false; }
}, "Expected exact public HTTPS URL");
const timestamp = z.string().refine(canonicalTimestamp, "Expected canonical timestamp");
function canonicalCompetitorKey(value: string): boolean {
  try { const url = new URL(`https://${value}/`); return value === value.toLocaleLowerCase("en") && value.includes(".") && !value.endsWith(".") && url.hostname === value && url.username === "" && url.password === "" && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === ""; } catch { return false; }
}
const competitorSchema = z.object({ key: id.refine(canonicalCompetitorKey, "Expected canonical competitor hostname"), name: text(200), confirmed: z.literal(true) }).strict();
const sourceSchema = z.object({
  id, kind: z.enum(["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact"]), label: text(120), url: publicUrl.nullable(), competitor: competitorSchema.nullable(),
  availability: z.enum(["available", "partial"]), reason: z.enum(["not_collected", "not_published", "not_found", "timeout", "fetch_failed", "blocked", "rate_limited", "invalid_response", "partial_body", "unsupported_language", "generation_unavailable", "outcome_unknown", "insufficient_evidence", "not_applicable", "context_stale"]).nullable(),
  observedAt: timestamp.nullable(), bodyHash: hash.nullable(), excerpts: z.array(text(1_200)).min(1).max(8),
}).strict().superRefine((source, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((source.kind === "competitor_page") !== (source.competitor !== null)) issue("Invalid competitor source scope");
  if (!['gsc', 'accepted_fact'].includes(source.kind) && source.url === null) issue("Public source URL required");
  if (source.availability === "available" ? source.reason !== null : source.reason === null) issue("Source availability reason mismatch");
  if (source.bodyHash !== null && source.observedAt === null) issue("Body hash requires observation time");
  if (!['gsc', 'accepted_fact'].includes(source.kind) && (source.observedAt === null || source.bodyHash === null)) issue("Crawled source requires observation receipt");
  if (source.kind === "gsc" && source.observedAt === null) issue("GSC source requires observation time");
});

const inputBodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA), officialName: text(200), aliases: z.array(text(200)).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.aliases).refine(normalizedUnique, "Duplicate alias"),
  categoryTerms: z.array(text(200)).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.categoryTerms).refine(normalizedUnique, "Duplicate category term"), market: text(120), language: text(120),
  targetUrl: publicUrl, confirmedCompetitors: z.array(competitorSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.competitors).refine(values => unique(values.map(value => value.key)), "Duplicate competitor"), evidenceContentHash: hash, sourceCatalogueHash: hash,
  sourceCatalogue: z.array(sourceSchema).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.sources),
}).strict();
const inputSchema = inputBodySchema.extend({ contentHash: hash }).strict();
export type GeoKnowledgeSynthesisInputBodyV1 = z.infer<typeof inputBodySchema>;
export type GeoKnowledgeSynthesisInputV1 = z.infer<typeof inputSchema>;

function assertInputIntegrity(body: GeoKnowledgeSynthesisInputBodyV1): void {
  const sources = new Map(body.sourceCatalogue.map(source => [source.id, source]));
  if (sources.size !== body.sourceCatalogue.length) throw new Error("Duplicate source id");
  const urls = body.sourceCatalogue.flatMap(source => source.url === null ? [] : [source.url]);
  if (!unique(urls)) throw new Error("Duplicate source URL");
  if (geoKnowledgeSynthesisSourceCatalogueDigest(body.sourceCatalogue) !== body.sourceCatalogueHash) throw new Error("Knowledge synthesis source catalogue hash mismatch");
  const competitors = new Map(body.confirmedCompetitors.map(competitor => [competitor.key, competitor.name])); const target = new URL(body.targetUrl);
  for (const source of body.sourceCatalogue) {
    if (source.competitor !== null && competitors.get(source.competitor.key) !== source.competitor.name) throw new Error("Unconfirmed competitor source");
    if (source.kind === "competitor_page" && source.url !== null && new URL(source.url).host !== source.competitor!.key) throw new Error("Foreign competitor source");
    if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null && new URL(source.url).host !== target.host) throw new Error("Foreign own-site source");
    if (source.url !== null) { const url = new URL(source.url); if (source.kind === "robots" && (url.pathname !== "/robots.txt" || url.search !== "")) throw new Error("Invalid robots source URL"); if (source.kind === "llms" && (url.pathname !== "/llms.txt" || url.search !== "")) throw new Error("Invalid llms source URL"); if (source.kind === "sitemap" && (url.search !== "" || !url.pathname.toLocaleLowerCase("en").includes("sitemap") || !url.pathname.toLocaleLowerCase("en").endsWith(".xml"))) throw new Error("Invalid sitemap source URL"); }
  }
}
function assertInputBytes(value: unknown): void { if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_SYNTHESIS_LIMITS.inputBytes) throw new Error("Knowledge synthesis input exceeds byte budget"); }
export function geoKnowledgeSynthesisSourceCatalogueDigest(value: GeoKnowledgeSynthesisInputBodyV1["sourceCatalogue"]): string { return geoV2Digest(value); }
export function geoKnowledgeSynthesisInputDigest(body: GeoKnowledgeSynthesisInputBodyV1): string { return geoV2Digest(body); }

export function buildGeoKnowledgeSynthesisInputV1(seed: unknown, rawEvidence: GeoKnowledgeEvidenceV1): GeoKnowledgeSynthesisInputV1 {
  const evidence = parseGeoKnowledgeEvidenceV1(rawEvidence);
  const profile = z.object({ officialName: text(200), aliases: z.array(text(200)), categoryTerms: z.array(text(200)), market: text(120), language: text(120) }).strict().parse(seed);
  const sourceCatalogue = z.array(sourceSchema).parse(evidence.sourceCatalogue.filter(source => source.availability !== "unavailable"));
  const body = inputBodySchema.parse({ schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA, ...profile, targetUrl: evidence.targetUrl, confirmedCompetitors: evidence.confirmedCompetitors, evidenceContentHash: evidence.contentHash, sourceCatalogueHash: geoKnowledgeSynthesisSourceCatalogueDigest(sourceCatalogue), sourceCatalogue });
  assertInputIntegrity(body); const result = inputSchema.parse({ ...body, contentHash: geoKnowledgeSynthesisInputDigest(body) }); assertInputBytes(result); return result;
}
export function parseGeoKnowledgeSynthesisInputV1(value: unknown): GeoKnowledgeSynthesisInputV1 {
  const parsed = inputSchema.parse(value); const { contentHash, ...body } = parsed; assertInputIntegrity(body); assertInputBytes(parsed);
  if (geoKnowledgeSynthesisInputDigest(body) !== contentHash) throw new Error("Knowledge synthesis input hash mismatch"); return parsed;
}

const refs = z.array(id).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.sourceRefs).refine(unique, "Duplicate source reference");
const definition = (wordCap: number, codePointCap: number) => text(codePointCap).refine(value => value.trim().split(/\s+/u).filter(Boolean).length <= wordCap, `Expected no more than ${wordCap} words`).refine(value => !URL_TEXT.test(value), "Model output cannot contain URLs");
const narrativeText = (maximum: number) => text(maximum).refine(value => !URL_TEXT.test(value), "Model output cannot contain URLs");
const nullableNarrativeText = (maximum: number) => narrativeText(maximum).nullable();
const entitySchema = z.object({ definitions: z.object({ w25: definition(25, GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w25), w55: definition(55, GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w55), w120: definition(120, GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w120) }).strict(), audience: z.object({ who: narrativeText(800), notFor: nullableNarrativeText(800) }).strict(), founded: z.object({ year: z.string().regex(/^\d{4}$/u).nullable(), team: nullableNarrativeText(800), location: nullableNarrativeText(800) }).strict(), disambiguation: nullableNarrativeText(800), sourceRefs: refs }).strict();
const factSchema = z.object({ id, type: z.enum(["price", "policy", "feature", "integration", "company", "audience", "data", "other"]), statement: narrativeText(800), sourceRefs: refs }).strict();
const qaSchema = z.object({ id, intent: z.enum(["definition", "comparison", "price", "operation", "trust", "boundary", "alternative", "applicability", "other"]), question: narrativeText(800), variants: z.array(narrativeText(800)).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.variants).refine(normalizedUnique, "Duplicate variant"), directAnswer: narrativeText(800), expansion: nullableNarrativeText(2_400), sourceRefs: refs }).strict();
const rowSchema = z.object({ id, dimension: narrativeText(120), product: nullableNarrativeText(800), competitor: nullableNarrativeText(800), sourceRefs: refs, availability: z.enum(["available", "partial", "unavailable"]) }).strict().superRefine((row, ctx) => { if (row.availability === "available" && (row.product === null || row.competitor === null)) ctx.addIssue({ code: "custom", message: "Available comparison row requires both values" }); if (row.availability === "unavailable" && (row.product !== null || row.competitor !== null)) ctx.addIssue({ code: "custom", message: "Unavailable comparison row cannot carry values" }); });
const comparisonSchema = z.object({ id, competitor: competitorSchema, rows: z.array(rowSchema).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.comparisonRows), verdict: narrativeText(800), sourceRefs: refs }).strict();
const statementSchema = z.object({ id, text: narrativeText(800), sourceRefs: refs }).strict();
const scopeSchema = z.object({ does: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.scopeItems), doesNot: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.scopeItems), needsHuman: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.scopeItems), misconceptions: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.scopeItems) }).strict().refine(scope => Object.values(scope).some(items => items.length > 0), "Scope cannot be empty");
const narrativeSchema = z.object({ schemaVersion: z.literal(GEO_KNOWLEDGE_NARRATIVE_SCHEMA), entity: entitySchema, facts: z.array(factSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.facts), qa: z.array(qaSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.qa), comparisons: z.array(comparisonSchema).max(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.comparisons), scope: scopeSchema }).strict();
export type GeoKnowledgeNarrativeV1 = z.infer<typeof narrativeSchema>;

function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function mentions(value: string, competitor: GeoKnowledgeSynthesisInputV1["confirmedCompetitors"][number]): boolean {
  return [competitor.name, competitor.key].some(candidate => new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped(candidate)}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(value));
}
function properSubjects(value: string): readonly string[] { return [...value.matchAll(PROPER_SUBJECT_CLAIM)].map(match => match[1]!).filter(subject => !ORDINARY_SUBJECTS.has(normalized(subject))); }
function assertNarrativeIntegrity(value: GeoKnowledgeNarrativeV1, input: GeoKnowledgeSynthesisInputV1): void {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_SYNTHESIS_LIMITS.narrativeBytes) throw new Error("Knowledge narrative exceeds byte budget");
  const sources = new Map(input.sourceCatalogue.map(source => [source.id, source])); const ids: string[] = []; const allText: string[] = []; const claims: Array<{ text: readonly string[]; sourceRefs: readonly string[]; productEvidence: boolean }> = [];
  const add = (item: { id: string; sourceRefs: readonly string[] }, productEvidence: boolean, ...values: (string | null)[]) => { ids.push(item.id); const textValues = values.filter((entry): entry is string => entry !== null); claims.push({ text: textValues, sourceRefs: item.sourceRefs, productEvidence }); };
  const entityText = [value.entity.definitions.w25, value.entity.definitions.w55, value.entity.definitions.w120, value.entity.audience.who, value.entity.audience.notFor, value.entity.founded.year, value.entity.founded.team, value.entity.founded.location, value.entity.disambiguation].filter((entry): entry is string => entry !== null);
  const mentionedCompetitors = (texts: readonly string[]) => input.confirmedCompetitors.filter(competitor => texts.some(value => mentions(value, competitor)));
  if (mentionedCompetitors(entityText).length > 0) throw new Error("Competitor mention is not allowed in entity narrative");
  allText.push(...entityText); claims.push({ text: entityText, sourceRefs: value.entity.sourceRefs, productEvidence: true });
  for (const fact of value.facts) { if (mentionedCompetitors([fact.statement]).length > 0) throw new Error("Competitor mention is not allowed in facts"); add(fact, true, fact.statement); allText.push(fact.statement); }
  for (const qa of value.qa) { const qaText = [qa.question, ...qa.variants, qa.directAnswer, ...(qa.expansion === null ? [] : [qa.expansion])]; const named = mentionedCompetitors(qaText); if (named.length > 0) { if (qa.intent !== "comparison" && qa.intent !== "alternative") throw new Error("Competitor mention requires comparison or alternative QA"); for (const competitor of named) if (!qa.sourceRefs.some(reference => { const source = sources.get(reference); return source?.kind === "competitor_page" && source.competitor?.key === competitor.key && source.competitor.name === competitor.name; })) throw new Error("Competitor mention requires matching competitor evidence"); } add(qa, true, ...qaText); allText.push(...qaText); }
  if (!unique(value.comparisons.map(comparison => comparison.competitor.key))) throw new Error("Duplicate competitor comparison");
  for (const comparison of value.comparisons) { add(comparison, false, comparison.competitor.name, comparison.verdict); allText.push(comparison.verdict); const confirmed = input.confirmedCompetitors.find(candidate => candidate.key === comparison.competitor.key); if (confirmed?.name !== comparison.competitor.name) throw new Error("Unconfirmed or mismatched competitor"); const comparisonSources = comparison.sourceRefs.map(reference => sources.get(reference)); if (!comparisonSources.some(source => source?.kind === "own_page") || !comparisonSources.some(source => source?.kind === "competitor_page" && source.competitor?.key === comparison.competitor.key && source.competitor.name === comparison.competitor.name)) throw new Error("Unsupported comparison verdict evidence"); for (const row of comparison.rows) { add(row, false, row.dimension, row.product, row.competitor); const rowSources = row.sourceRefs.map(reference => sources.get(reference)); if (row.product !== null && !rowSources.some(source => source?.kind === "own_page")) throw new Error("Unsupported comparison row evidence"); if (row.competitor !== null && !rowSources.some(source => source?.kind === "competitor_page" && source.competitor?.key === comparison.competitor.key && source.competitor.name === comparison.competitor.name)) throw new Error("Unsupported comparison row evidence"); } }
  for (const group of Object.values(value.scope)) for (const item of group) { if (mentionedCompetitors([item.text]).length > 0) throw new Error("Competitor mention is not allowed in scope"); add(item, true, item.text); allText.push(item.text); }
  if (!unique(ids)) throw new Error("Duplicate content id"); if (!normalizedUnique(allText)) throw new Error("Duplicate narrative text");
  const knownSubjects = new Set([input.officialName, ...input.aliases, ...input.confirmedCompetitors.flatMap(competitor => [competitor.name, competitor.key])].map(normalized));
  for (const claim of claims) { const cited = claim.sourceRefs.map(reference => sources.get(reference)); if (cited.some(source => source === undefined)) throw new Error("Unknown or unavailable source reference"); for (const subject of claim.text.flatMap(properSubjects)) if (!knownSubjects.has(normalized(subject)) && !cited.some(source => source!.excerpts.some(excerpt => normalized(excerpt).includes(normalized(subject)))) ) throw new Error("Proper-name claim subject is absent from cited evidence"); const productSources = cited.filter((source): source is GeoKnowledgeSynthesisInputV1["sourceCatalogue"][number] => source?.kind === "own_page" || source?.kind === "accepted_fact"); if (claim.productEvidence && productSources.length === 0) throw new Error("Product evidence is required"); if (!geoLiteralsAllSupported(claim.text, (claim.productEvidence ? productSources : cited).flatMap(source => source!.excerpts))) throw new Error("Unsupported numeric claim"); }
}
export function geoKnowledgeNarrativeDigest(value: GeoKnowledgeNarrativeV1): string { return geoV2Digest(value); }
export function parseGeoKnowledgeNarrativeV1(raw: unknown, rawInput: GeoKnowledgeSynthesisInputV1): GeoKnowledgeNarrativeV1 { const input = parseGeoKnowledgeSynthesisInputV1(rawInput); const value = narrativeSchema.parse(raw); assertNarrativeIntegrity(value, input); return value; }
