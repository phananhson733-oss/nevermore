// @input -- a bounded, evidence-bound customer GEO knowledge pack
// @output -- strict v1 parsing and deterministic content identity
// @pos -- immutable companion contract; internal IDs stay out of customer rendering
import { z } from "zod";

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { hasLoneSurrogate } from "../agents/geo-canonical.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_KNOWLEDGE_PACK_SCHEMA = "marketing-geo-knowledge-pack.v1" as const;
export const GEO_KNOWLEDGE_PACK_LIMITS = {
  maxBytes: 512 * 1024,
  sources: 32,
  ownPages: 8,
  competitorIdentities: 5,
  competitorPagesPerIdentity: 2,
  machineSourcesPerKind: 1,
  excerptsPerSource: 8,
  excerptCodePoints: 1_200,
  sourceRefs: 16,
  aliases: 12,
  secondaryCategories: 12,
  sameAs: 16,
  facts: 64,
  qa: 32,
  variants: 8,
  comparisons: 5,
  comparisonRows: 16,
  scopeItems: 24,
  evidenceItems: 32,
  coverageItems: 24,
} as const;

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;
// Preserve exact excerpts, including line breaks, while excluding JSON-hostile controls.
// eslint-disable-next-line no-control-regex
const DISALLOWED_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function boundedText(maximum: number, nonempty = true) {
  return z.string().refine((value) => (
    (!nonempty || value.trim().length > 0)
    && Array.from(value).length <= maximum
    && !DISALLOWED_TEXT.test(value)
    && !hasLoneSurrogate(value)
  ), `Expected bounded text of at most ${maximum} code points`);
}

const text = boundedText(800);
const shortText = boundedText(200);
const label = boundedText(120);
const id = boundedText(128).regex(ID);
const hash = z.string().regex(HASH);
const year = z.string().regex(/^\d{4}$/u);
const timestamp = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO timestamp",
);
const publicUrl = z.string().max(2_048).refine((value) => {
  if (!/^https?:\/\//u.test(value)) return false;
  const normalized = normalizeAccountWebsiteUrl(value);
  return normalized !== null && normalized.submittedUrl === value;
}, "Expected an exact normalized public HTTP(S) URL");
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const normalizedUnique = (values: readonly string[]) => new Set(
  values.map((value) => value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim()),
).size === values.length;
const refs = z.array(id).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.sourceRefs).refine(unique, "Duplicate source reference");
const list = <T extends z.ZodTypeAny>(item: T, maximum: number) => z.array(item).max(maximum);

export const geoKnowledgeUnavailableReasonSchema = z.enum([
  "not_collected",
  "not_published",
  "not_found",
  "timeout",
  "fetch_failed",
  "blocked",
  "rate_limited",
  "invalid_response",
  "partial_body",
  "unsupported_language",
  "generation_unavailable",
  "outcome_unknown",
  "insufficient_evidence",
  "not_applicable",
  "context_stale",
]);

function moduleSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value }).strict(),
    z.object({ status: z.literal("partial"), limitation: text, value }).strict(),
    z.object({ status: z.literal("unavailable"), reason: geoKnowledgeUnavailableReasonSchema }).strict(),
  ]);
}

const sourceCompetitorSchema = z.object({
  key: id,
  name: shortText,
  confirmed: z.literal(true),
}).strict();

const sourceCatalogueItemSchema = z.object({
  id,
  kind: z.enum(["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact"]),
  label,
  url: publicUrl.nullable(),
  competitor: sourceCompetitorSchema.nullable(),
  availability: z.enum(["available", "partial", "unavailable"]),
  reason: geoKnowledgeUnavailableReasonSchema.nullable(),
  observedAt: timestamp.nullable(),
  bodyHash: hash.nullable(),
  excerpts: z.array(boundedText(GEO_KNOWLEDGE_PACK_LIMITS.excerptCodePoints))
    .max(GEO_KNOWLEDGE_PACK_LIMITS.excerptsPerSource),
}).strict().superRefine((source, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((source.kind === "competitor_page") !== (source.competitor !== null)) issue("Invalid competitor source scope");
  if (!["gsc", "accepted_fact"].includes(source.kind) && source.url === null) issue("Public source URL required");
  if (source.bodyHash !== null && source.observedAt === null) issue("Body hash requires an observation time");
  if (source.availability === "unavailable") {
    if (source.reason === null || source.observedAt !== null || source.bodyHash !== null || source.excerpts.length !== 0) issue("Unavailable source cannot carry observed content");
    return;
  }
  if (source.availability === "available" ? source.reason !== null : source.reason === null) issue("Source availability reason mismatch");
  if (source.excerpts.length === 0) issue("Available source requires exact evidence excerpts");
  if (source.kind === "gsc" && source.observedAt === null) issue("GSC source requires an observation time");
  if (!["gsc", "accepted_fact"].includes(source.kind) && (source.observedAt === null || source.bodyHash === null)) issue("Crawled source requires observation time and body hash");
});

const entitySchema = z.object({
  name: shortText,
  aliases: z.array(shortText).max(GEO_KNOWLEDGE_PACK_LIMITS.aliases).refine(normalizedUnique),
  categories: z.object({
    primary: shortText,
    secondary: z.array(shortText).max(GEO_KNOWLEDGE_PACK_LIMITS.secondaryCategories).refine(normalizedUnique),
  }).strict(),
  definitions: z.object({ w25: text, w55: text, w120: text }).strict(),
  audience: z.object({ who: text, notFor: text.nullable() }).strict(),
  founded: z.object({ year: year.nullable(), team: text.nullable(), location: text.nullable() }).strict(),
  disambiguation: text.nullable(),
  links: z.object({
    home: publicUrl,
    pricing: publicUrl.nullable(),
    docs: publicUrl.nullable(),
    about: publicUrl.nullable(),
    changelog: publicUrl.nullable(),
    faq: publicUrl.nullable(),
  }).strict(),
  sameAs: z.array(publicUrl).max(GEO_KNOWLEDGE_PACK_LIMITS.sameAs).refine(unique),
  sourceRefs: refs,
}).strict();

const factSchema = z.object({
  id,
  type: z.enum(["price", "policy", "feature", "integration", "company", "audience", "data", "other"]),
  statement: text,
  sourceRefs: refs,
  observedAt: timestamp.nullable(),
  nextReviewAt: timestamp.nullable(),
}).strict();

const qaSchema = z.object({
  id,
  intent: z.enum(["definition", "comparison", "price", "operation", "trust", "boundary", "alternative", "applicability", "other"]),
  question: text,
  variants: z.array(text).max(GEO_KNOWLEDGE_PACK_LIMITS.variants).refine(normalizedUnique),
  directAnswer: text,
  expansion: boundedText(2_400).nullable(),
  sourceRefs: refs,
}).strict();

const comparisonRowSchema = z.object({
  id,
  dimension: label,
  product: text.nullable(),
  competitor: text.nullable(),
  sourceRefs: refs,
  availability: z.enum(["available", "partial", "unavailable"]),
}).strict().superRefine((row, ctx) => {
  if (row.availability === "available" && (row.product === null || row.competitor === null)) {
    ctx.addIssue({ code: "custom", message: "Available comparison row requires both values" });
  }
  if (row.availability === "unavailable" && (row.product !== null || row.competitor !== null)) {
    ctx.addIssue({ code: "custom", message: "Unavailable comparison row cannot carry values" });
  }
});
const comparisonSchema = z.object({
  id,
  competitor: sourceCompetitorSchema,
  checkedAt: timestamp,
  rows: z.array(comparisonRowSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.comparisonRows),
  verdict: text,
  sourceRefs: refs,
}).strict();

const statementSchema = z.object({ id, text, sourceRefs: refs }).strict();
const scopeSchema = z.object({
  does: list(statementSchema, GEO_KNOWLEDGE_PACK_LIMITS.scopeItems),
  doesNot: list(statementSchema, GEO_KNOWLEDGE_PACK_LIMITS.scopeItems),
  needsHuman: list(statementSchema, GEO_KNOWLEDGE_PACK_LIMITS.scopeItems),
  misconceptions: list(statementSchema, GEO_KNOWLEDGE_PACK_LIMITS.scopeItems),
}).strict().refine((scope) => Object.values(scope).some((items) => items.length > 0), "Scope cannot be empty");

const evidenceItemSchema = z.object({
  id,
  label,
  summary: text,
  url: publicUrl.nullable(),
  sourceRefs: refs,
}).strict();
const evidenceSchema = z.object({
  proof: list(evidenceItemSchema, GEO_KNOWLEDGE_PACK_LIMITS.evidenceItems),
  changelog: list(evidenceItemSchema, GEO_KNOWLEDGE_PACK_LIMITS.evidenceItems),
  press: list(evidenceItemSchema, GEO_KNOWLEDGE_PACK_LIMITS.evidenceItems),
  thirdPartyProfiles: list(evidenceItemSchema, GEO_KNOWLEDGE_PACK_LIMITS.evidenceItems),
}).strict().refine((evidence) => Object.values(evidence).some((items) => items.length > 0), "Evidence cannot be empty");

const machineStatus = z.enum(["present", "absent", "unreachable", "not_checked"]);
const machineObservationSchema = z.object({ status: machineStatus, sourceRefs: refs }).strict();
const machineSchema = z.object({
  jsonLd: z.object({ status: machineStatus, types: z.array(shortText).max(32).refine(normalizedUnique), sourceRefs: refs }).strict(),
  llms: machineObservationSchema,
  robots: machineObservationSchema,
  sitemap: z.object({
    status: machineStatus,
    urlCount: z.number().int().min(0).max(1_000_000).nullable(),
    knowledgePagesListed: z.boolean().nullable(),
    sourceRefs: refs,
  }).strict(),
  hreflang: z.object({ status: machineStatus, locales: z.array(shortText).max(64).refine(normalizedUnique), sourceRefs: refs }).strict(),
}).strict().superRefine((machine, ctx) => {
  if (machine.jsonLd.status !== "present" && machine.jsonLd.types.length !== 0) ctx.addIssue({ code: "custom", message: "Unobserved JSON-LD types" });
  if (machine.sitemap.status === "present"
    ? machine.sitemap.urlCount === null || machine.sitemap.knowledgePagesListed === null
    : machine.sitemap.urlCount !== null || machine.sitemap.knowledgePagesListed !== null) ctx.addIssue({ code: "custom", message: "Invalid sitemap observation" });
  if (machine.hreflang.status !== "present" && machine.hreflang.locales.length !== 0) ctx.addIssue({ code: "custom", message: "Unobserved hreflang locales" });
});

const coverageItemSchema = z.object({
  id,
  label,
  status: z.enum(["covered", "partial", "missing"]),
  summary: text,
  nextAction: text.nullable(),
  sourceRefs: refs,
}).strict();

function isCompetitorSource(
  source: GeoKnowledgeSourceV1 | undefined,
  competitorKey: string,
  competitorName: string,
): source is GeoKnowledgeSourceV1 {
  return source?.kind === "competitor_page"
    && source.availability !== "unavailable"
    && source.competitor?.key === competitorKey
    && source.competitor.name === competitorName;
}

function isOwnPageSource(source: GeoKnowledgeSourceV1 | undefined): source is GeoKnowledgeSourceV1 {
  return source?.kind === "own_page" && source.availability !== "unavailable";
}

const bodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_PACK_SCHEMA),
  meta: z.object({
    generatedAt: timestamp,
    lastScanAt: timestamp,
    market: shortText,
    language: shortText,
    counts: z.object({
      facts: z.number().int().min(0).max(GEO_KNOWLEDGE_PACK_LIMITS.facts),
      qa: z.number().int().min(0).max(GEO_KNOWLEDGE_PACK_LIMITS.qa),
      comparisons: z.number().int().min(0).max(GEO_KNOWLEDGE_PACK_LIMITS.comparisons),
    }).strict(),
  }).strict(),
  entity: moduleSchema(entitySchema),
  facts: moduleSchema(z.array(factSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.facts)),
  qa: moduleSchema(z.array(qaSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.qa)),
  comparisons: moduleSchema(z.array(comparisonSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.comparisons)),
  scope: moduleSchema(scopeSchema),
  evidence: moduleSchema(evidenceSchema),
  machine: moduleSchema(machineSchema),
  coverage: moduleSchema(z.array(coverageItemSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.coverageItems)),
  sourceCatalogue: z.array(sourceCatalogueItemSchema).min(1).max(GEO_KNOWLEDGE_PACK_LIMITS.sources),
}).strict();
const packSchema = bodySchema.extend({ contentHash: hash }).strict();

export type GeoKnowledgeUnavailableReason = z.infer<typeof geoKnowledgeUnavailableReasonSchema>;
export type GeoKnowledgePackBodyV1 = z.infer<typeof bodySchema>;
export type GeoKnowledgePackV1 = z.infer<typeof packSchema>;
export type GeoKnowledgeSourceV1 = GeoKnowledgePackV1["sourceCatalogue"][number];
export type GeoKnowledgeEntityV1 = Extract<GeoKnowledgePackV1["entity"], { status: "available" }>["value"];
export type GeoKnowledgeFactV1 = Extract<GeoKnowledgePackV1["facts"], { status: "available" }>["value"][number];
export type GeoKnowledgeQaV1 = Extract<GeoKnowledgePackV1["qa"], { status: "available" }>["value"][number];
export type GeoKnowledgeComparisonV1 = Extract<GeoKnowledgePackV1["comparisons"], { status: "available" }>["value"][number];

function moduleValue<T>(module: { readonly status: string; readonly value?: T }): T | null {
  return "value" in module ? module.value ?? null : null;
}

function numericLiterals(value: string): readonly string[] {
  return value.match(/[+-]?(?:[$€£¥]\s*)?\p{N}+(?:[.,:/-]\p{N}+)*(?:\s*[%％])?/gu) ?? [];
}

function assertPackIntegrity(body: GeoKnowledgePackBodyV1): void {
  if (body.meta.lastScanAt > body.meta.generatedAt) throw new Error("Knowledge pack scan time exceeds generation time");
  const sourceById = new Map(body.sourceCatalogue.map((source) => [source.id, source]));
  if (sourceById.size !== body.sourceCatalogue.length) throw new Error("Duplicate source id");
  const entity = moduleValue(body.entity);
  const ownPages = body.sourceCatalogue.filter((source) => source.kind === "own_page");
  if (ownPages.length > GEO_KNOWLEDGE_PACK_LIMITS.ownPages) throw new Error("Own-page source limit exceeded");
  const ownSiteAnchor = entity?.links.home ?? body.sourceCatalogue.find((source) => (
    ["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null
  ))?.url;
  const targetHost = ownSiteAnchor === undefined || ownSiteAnchor === null ? undefined : normalizeAccountWebsiteUrl(ownSiteAnchor)?.host;
  const competitorPages = body.sourceCatalogue.filter((source) => source.kind === "competitor_page");
  const competitorKeys = new Set(competitorPages.map((source) => source.competitor!.key));
  if (competitorKeys.size > GEO_KNOWLEDGE_PACK_LIMITS.competitorIdentities) throw new Error("Competitor source limit exceeded");
  for (const key of competitorKeys) {
    if (competitorPages.filter((source) => source.competitor!.key === key).length > GEO_KNOWLEDGE_PACK_LIMITS.competitorPagesPerIdentity) throw new Error("Competitor page limit exceeded");
  }
  for (const kind of ["robots", "sitemap", "llms"] as const) {
    if (body.sourceCatalogue.filter((source) => source.kind === kind).length > GEO_KNOWLEDGE_PACK_LIMITS.machineSourcesPerKind) throw new Error("Machine source limit exceeded");
  }
  for (const source of body.sourceCatalogue) {
    if (source.observedAt !== null && source.observedAt > body.meta.generatedAt) throw new Error("Source observation exceeds generation time");
    if (source.url === null) continue;
    const normalized = normalizeAccountWebsiteUrl(source.url)!;
    const url = new URL(source.url);
    if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && targetHost !== undefined && normalized.host !== targetHost) throw new Error("Foreign own-site source");
    if (source.kind === "competitor_page") {
      const keyHost = normalizeAccountWebsiteUrl(`https://${source.competitor!.key}`)?.host;
      if (keyHost !== source.competitor!.key || normalized.host !== source.competitor!.key) throw new Error("Foreign competitor source");
    }
    if (source.kind === "robots" && (url.pathname !== "/robots.txt" || url.search !== "")) throw new Error("Invalid robots source URL");
    if (source.kind === "llms" && (url.pathname !== "/llms.txt" || url.search !== "")) throw new Error("Invalid llms source URL");
    if (source.kind === "sitemap" && (url.search !== "" || !url.pathname.toLocaleLowerCase("en").includes("sitemap") || !url.pathname.toLocaleLowerCase("en").endsWith(".xml"))) throw new Error("Invalid sitemap source URL");
  }

  const facts = moduleValue(body.facts) ?? [];
  const qa = moduleValue(body.qa) ?? [];
  const comparisons = moduleValue(body.comparisons) ?? [];
  if (body.meta.counts.facts !== facts.length || body.meta.counts.qa !== qa.length || body.meta.counts.comparisons !== comparisons.length) {
    throw new Error("Knowledge pack counts mismatch");
  }

  const contentIds: string[] = [];
  const claims: { readonly text: readonly string[]; readonly sourceRefs: readonly string[] }[] = [];
  const add = (entry: { readonly id?: string; readonly sourceRefs: readonly string[] }, ...values: (string | null)[]) => {
    if (entry.id !== undefined) contentIds.push(entry.id);
    claims.push({ text: values.filter((value): value is string => value !== null), sourceRefs: entry.sourceRefs });
  };

  if (entity) add(entity, entity.name, ...entity.aliases, entity.categories.primary, ...entity.categories.secondary,
    entity.definitions.w25, entity.definitions.w55, entity.definitions.w120, entity.audience.who, entity.audience.notFor,
    entity.founded.year, entity.founded.team, entity.founded.location, entity.disambiguation);
  for (const fact of facts) {
    add(fact, fact.statement);
    if (fact.observedAt !== null && fact.observedAt > body.meta.generatedAt || fact.nextReviewAt !== null && fact.observedAt !== null && fact.nextReviewAt < fact.observedAt) throw new Error("Invalid fact review time");
  }
  for (const item of qa) add(item, item.question, ...item.variants, item.directAnswer, item.expansion);
  for (const comparison of comparisons) {
    add(comparison, comparison.competitor.name, comparison.verdict);
    contentIds.push(...comparison.rows.map((row) => row.id));
    const comparisonSources = comparison.sourceRefs.map((reference) => sourceById.get(reference));
    if (comparisonSources.some((source) => source === undefined)) throw new Error("Unknown source reference");
    if (comparisonSources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
    const verdictHasCompetitor = comparisonSources.some((source) => isCompetitorSource(source, comparison.competitor.key, comparison.competitor.name));
    const verdictHasProduct = comparisonSources.some(isOwnPageSource);
    if (!verdictHasCompetitor || !verdictHasProduct) throw new Error("Unsupported comparison verdict evidence");
    const citedComparisonSources = [...comparisonSources, ...comparison.rows.flatMap((row) => row.sourceRefs.map((reference) => sourceById.get(reference)))];
    if (comparison.checkedAt > body.meta.generatedAt || citedComparisonSources.some((source) => (
      (source?.kind === "own_page" || source?.kind === "competitor_page")
      && source.observedAt !== null
      && comparison.checkedAt < source.observedAt
    ))) throw new Error("Invalid comparison check time");
    for (const row of comparison.rows) {
      const rowSources = row.sourceRefs.map((reference) => sourceById.get(reference));
      if (rowSources.some((source) => source === undefined)) throw new Error("Unknown source reference");
      if (rowSources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
      const hasCompetitor = rowSources.some((source) => isCompetitorSource(source, comparison.competitor.key, comparison.competitor.name));
      const hasProduct = rowSources.some(isOwnPageSource);
      if (row.competitor !== null && !hasCompetitor) throw new Error("Unsupported comparison row evidence");
      if (row.product !== null && !hasProduct) throw new Error("Unsupported comparison row evidence");
      claims.push({ text: [row.dimension, row.product, row.competitor].filter((value): value is string => value !== null), sourceRefs: row.sourceRefs });
    }
  }
  const scope = moduleValue(body.scope);
  if (scope) for (const items of Object.values(scope)) for (const item of items) add(item, item.text);
  const evidence = moduleValue(body.evidence);
  if (evidence) for (const items of Object.values(evidence)) for (const item of items) add(item, item.label, item.summary);
  const machine = moduleValue(body.machine);
  if (machine) {
    const observations = [
      { observation: machine.jsonLd, expectedKind: "own_page" },
      { observation: machine.llms, expectedKind: "llms" },
      { observation: machine.robots, expectedKind: "robots" },
      { observation: machine.sitemap, expectedKind: "sitemap" },
      { observation: machine.hreflang, expectedKind: "own_page" },
    ] as const;
    for (const { observation, expectedKind } of observations) {
      const sources = observation.sourceRefs.map((reference) => sourceById.get(reference));
      if (sources.some((source) => source === undefined)) throw new Error("Unknown source reference");
      if (sources.some((source) => source!.kind !== expectedKind)) throw new Error("Machine source kind mismatch");
      const availableEvidenceRequired = observation.status === "present"
        || expectedKind === "own_page" && observation.status === "absent";
      if (sources.some((source) => availableEvidenceRequired
        ? source!.availability === "unavailable"
        : source!.availability !== "unavailable")) throw new Error("Machine source availability mismatch");
    }
  }
  const coverage = moduleValue(body.coverage) ?? [];
  for (const item of coverage) {
    contentIds.push(item.id);
    if (item.sourceRefs.some((reference) => !sourceById.has(reference))) throw new Error("Unknown source reference");
  }
  if (!unique(contentIds)) throw new Error("Duplicate content id");
  if (!unique(comparisons.map((item) => item.competitor.key))) throw new Error("Duplicate competitor comparison");

  for (const claim of claims) {
    const sources = claim.sourceRefs.map((reference) => sourceById.get(reference));
    if (sources.some((source) => source === undefined)) throw new Error("Unknown source reference");
    if (sources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
    const supported = new Set(sources.flatMap((source) => source!.excerpts.flatMap(numericLiterals)));
    for (const literal of claim.text.flatMap(numericLiterals)) {
      if (!supported.has(literal)) throw new Error("Unsupported numeric claim");
    }
  }
}

function assertByteLimit(value: unknown): void {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_PACK_LIMITS.maxBytes) throw new Error("Knowledge pack exceeds byte limit");
}

export function geoKnowledgePackDigest(body: GeoKnowledgePackBodyV1): string {
  return geoV2Digest(body);
}

export function buildGeoKnowledgePackV1(value: unknown): GeoKnowledgePackV1 {
  const body = bodySchema.parse(value);
  assertPackIntegrity(body);
  const pack = packSchema.parse({ ...body, contentHash: geoKnowledgePackDigest(body) });
  assertByteLimit(pack);
  return pack;
}

export function parseGeoKnowledgePackV1(value: unknown): GeoKnowledgePackV1 {
  const parsed = packSchema.parse(value);
  const { contentHash, ...body } = parsed;
  assertPackIntegrity(body);
  assertByteLimit(parsed);
  if (geoKnowledgePackDigest(body) !== contentHash) throw new Error("Knowledge pack hash mismatch");
  return parsed;
}
