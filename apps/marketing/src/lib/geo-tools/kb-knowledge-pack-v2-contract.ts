// @input -- reviewed v3 knowledge items plus the evidence catalogue they cite
// @output -- strict v2 pack parsing where every item carries origin and decision
// @pos -- immutable companion contract; internal IDs stay out of customer rendering
import { z } from "zod";

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import {
  GEO_EVIDENCE_GROUPS,
  GEO_KNOWLEDGE_LIMITS,
  geoComparisonRowContentShape,
  geoCoverageItemShape,
  geoEntityValueShape,
  geoEvidenceCheckSchema,
  geoEvidenceItemShape,
  geoFactContentShape,
  geoHash,
  geoId,
  geoItemOriginSchema,
  geoList,
  geoMachineValueShape,
  geoModuleSchema,
  geoLiteralsAllSupported,
  geoQaContentShape,
  geoRefList,
  geoShortText,
  geoSourceCatalogueItemSchema,
  geoSourceCompetitorSchema,
  geoStatementContentShape,
  geoText,
  geoTimestamp,
  geoUnique,
  refineGeoComparisonRow,
  refineGeoMachine,
  type GeoEvidenceCheck,
  type GeoItemOrigin,
} from "./kb-knowledge-shape.ts";

/**
 * v2 exists because v1 items are `.strict()`: a single added key fails to
 * parse. What is added is the pair this redesign turns on -- where a claim came
 * from (`origin`) and what the owner decided about it (`decision`) -- kept as
 * two independent fields so a decision can never be read as a source, nor a
 * source as a confirmation.
 *
 * v1 stays exactly as it is and keeps rendering historical versions.
 *
 * The item shapes themselves are not restated here. They come from
 * `kb-knowledge-shape.ts`, which is also what a v3 draft is built from: one
 * definition of what a fact *is*, wearing draft provenance on one side and
 * published provenance on the other. A second hand-maintained copy would drift,
 * and the drift would show up as a draft that cannot be published.
 */
export const GEO_KNOWLEDGE_PACK_V2_SCHEMA = "marketing-geo-knowledge-pack.v2" as const;

/**
 * The stored-size ceiling for one published pack, unchanged from v1. It is
 * declared here rather than in the shared shape because it is a property of
 * this artefact's storage column, not of the knowledge items: a draft carries
 * the same items under per-part budgets instead (`GEO_KB_V3_LIMITS`).
 */
export const GEO_KNOWLEDGE_PACK_V2_MAX_BYTES = 512 * 1024;

export { geoEvidenceCheckSchema, geoItemOriginSchema };
export type { GeoEvidenceCheck, GeoItemOrigin };

/**
 * What the owner decided. `pending` and `excluded` exist in the draft but never
 * in a published pack: publishing converts what is left of `pending` into
 * `accepted_in_bulk`, and drops `excluded` items entirely. Keeping those two
 * out of this enum is what makes "a published item was either confirmed one by
 * one, or is labelled as not having been" a contract rather than a convention.
 */
export const geoPackDecisionSchema = z.enum(["accepted", "accepted_in_bulk"]);
export type GeoPackDecision = z.infer<typeof geoPackDecisionSchema>;

/**
 * The provenance every reviewable item carries. `sourceRefs` may be empty only
 * for an owner declaration -- an owner who corrects a price is the source, and
 * pointing at the page that said the old price would be a lie. That page moves
 * to `priorSourceRefs`, which is displayed as "what this replaced" and is
 * excluded from every support check by construction: no rule in this file
 * reads it.
 */
const provenanceShape = {
  itemKey: geoHash,
  origin: geoItemOriginSchema,
  decision: geoPackDecisionSchema,
  sourceRefs: geoRefList(0),
  priorSourceRefs: geoRefList(0),
  ownerDeclaredAt: geoTimestamp.nullable(),
  evidenceChecks: geoEvidenceCheckSchema,
} as const;

type ProvenanceValue = {
  readonly origin: GeoItemOrigin;
  readonly sourceRefs: readonly string[];
  readonly priorSourceRefs: readonly string[];
  readonly ownerDeclaredAt: string | null;
  readonly evidenceChecks: GeoEvidenceCheck;
};

/**
 * The origin/evidence pairings that are allowed to exist at all.
 *
 * `requireSource` is the one rule an unavailable fact is exempt from: it has
 * nothing to cite. Everything else -- who declared it, when, and what the
 * evidence check may claim -- still applies, because those are statements about
 * the item's authority, and an item with no value still wears them in the UI.
 */
export function refineProvenance(item: ProvenanceValue, ctx: z.RefinementCtx, requireSource = true): void {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (item.origin === "declared_owner") {
    if (item.ownerDeclaredAt === null) issue("Owner declaration requires a declaration time");
    if (item.evidenceChecks !== "owner_declared") issue("Owner declaration cannot claim a citation check");
    return;
  }
  if (item.ownerDeclaredAt !== null) issue("Only an owner declaration carries a declaration time");
  if (item.evidenceChecks === "owner_declared") issue("Only an owner declaration is owner-declared");
  if (item.priorSourceRefs.length > 0) issue("Superseded sources exist only on an owner declaration");
  if (requireSource && item.sourceRefs.length === 0) issue("An observed or synthesized item requires a source");
}

/**
 * Entity provenance hangs beside the values rather than wrapping each one: the
 * rendered shape stays the shape a reader wants, while every field still says
 * where it came from and what was decided about it.
 */
const entityFieldProvenanceSchema = z.object({ field: geoShortText, ...provenanceShape }).strict().superRefine(refineProvenance);

const entitySchema = z.object({
  ...geoEntityValueShape,
  fields: z.array(entityFieldProvenanceSchema).max(32).refine((rows) => geoUnique(rows.map((row) => row.field)), "Duplicate entity field provenance"),
}).strict();

const factSchema = z.object({ ...geoFactContentShape, ...provenanceShape }).strict().superRefine((fact, ctx) => {
  // An unavailable fact has nothing to cite, so the "must have a source" rule
  // does not apply to it; it must instead say why it is unavailable. Only that
  // one rule is waived -- an unavailable fact that claimed `owner_declared`
  // provenance would still render the owner's own word beside a third party's
  // observation, which is the falsehood the whole origin field exists to stop.
  if (fact.value === null) {
    if (fact.reason === "") ctx.addIssue({ code: "custom", message: "Unavailable fact requires a reason" });
    refineProvenance(fact, ctx, false);
    return;
  }
  if (fact.reason !== "") ctx.addIssue({ code: "custom", message: "An available fact cannot carry an unavailability reason" });
  refineProvenance(fact, ctx);
});

const qaSchema = z.object({ ...geoQaContentShape, ...provenanceShape }).strict().superRefine(refineProvenance);

const comparisonRowSchema = z.object({ ...geoComparisonRowContentShape, ...provenanceShape }).strict().superRefine((row, ctx) => {
  refineProvenance(row, ctx);
  refineGeoComparisonRow(row, ctx);
});

const comparisonSchema = z.object({
  id: geoId,
  competitor: geoSourceCompetitorSchema,
  checkedAt: geoTimestamp,
  rows: z.array(comparisonRowSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisonRows),
  verdict: geoText,
  sourceRefs: geoRefList(1),
}).strict();

const statementSchema = z.object({ ...geoStatementContentShape, ...provenanceShape }).strict().superRefine(refineProvenance);
const scopeSchema = z.object({
  does: geoList(statementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  doesNot: geoList(statementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  needsHuman: geoList(statementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
  misconceptions: geoList(statementSchema, GEO_KNOWLEDGE_LIMITS.scopeItems),
}).strict().refine((scope) => Object.values(scope).some((items) => items.length > 0), "Scope cannot be empty");

const evidenceItemSchema = z.object(geoEvidenceItemShape).strict();
const evidenceSchema = z.object({
  proof: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  changelog: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  press: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  thirdPartyProfiles: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  /** First-party proof-of-work signals: bylines, review credits, own data. */
  firstPartyProof: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  /**
   * Which groups were actually looked for. A group absent from this list was
   * not collected; a group present but empty was collected and found nothing.
   * v1 could not tell those apart, so an uncollected group rendered as an
   * absent one.
   */
  collected: z.array(z.enum(GEO_EVIDENCE_GROUPS)).max(GEO_EVIDENCE_GROUPS.length).refine(geoUnique),
}).strict().superRefine((evidence, ctx) => {
  for (const group of GEO_EVIDENCE_GROUPS) {
    if (evidence[group].length > 0 && !evidence.collected.includes(group)) {
      ctx.addIssue({ code: "custom", message: `Group ${group} has items but is not marked collected` });
    }
  }
});

const machineSchema = z.object(geoMachineValueShape).strict().superRefine(refineGeoMachine);

const coverageItemSchema = z.object(geoCoverageItemShape).strict();

const bodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_PACK_V2_SCHEMA),
  meta: z.object({
    generatedAt: geoTimestamp,
    lastScanAt: geoTimestamp,
    market: geoShortText,
    language: geoShortText,
    counts: z.object({
      facts: z.number().int().min(0).max(GEO_KNOWLEDGE_LIMITS.facts),
      qa: z.number().int().min(0).max(GEO_KNOWLEDGE_LIMITS.qa),
      comparisons: z.number().int().min(0).max(GEO_KNOWLEDGE_LIMITS.comparisons),
      /** How many published items were confirmed one by one, and how many were not. */
      accepted: z.number().int().min(0).max(1_000),
      acceptedInBulk: z.number().int().min(0).max(1_000),
    }).strict(),
  }).strict(),
  entity: geoModuleSchema(entitySchema),
  facts: geoModuleSchema(z.array(factSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.facts)),
  qa: geoModuleSchema(z.array(qaSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.qa)),
  comparisons: geoModuleSchema(z.array(comparisonSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisons)),
  scope: geoModuleSchema(scopeSchema),
  evidence: geoModuleSchema(evidenceSchema),
  machine: geoModuleSchema(machineSchema),
  coverage: geoModuleSchema(z.array(coverageItemSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.coverageItems)),
  sourceCatalogue: z.array(geoSourceCatalogueItemSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.sources),
}).strict();
const packSchema = bodySchema.extend({ contentHash: geoHash }).strict();

export type GeoKnowledgePackBodyV2 = z.infer<typeof bodySchema>;
export type GeoKnowledgePackV2 = z.infer<typeof packSchema>;
export type GeoKnowledgeSourceV2 = GeoKnowledgePackV2["sourceCatalogue"][number];
export type GeoKnowledgeEntityV2 = Extract<GeoKnowledgePackV2["entity"], { status: "available" }>["value"];
export type GeoKnowledgeFactV2 = Extract<GeoKnowledgePackV2["facts"], { status: "available" }>["value"][number];
export type GeoKnowledgeQaV2 = Extract<GeoKnowledgePackV2["qa"], { status: "available" }>["value"][number];
export type GeoKnowledgeComparisonV2 = Extract<GeoKnowledgePackV2["comparisons"], { status: "available" }>["value"][number];
export type GeoKnowledgeEvidenceItemV2 = z.infer<typeof evidenceItemSchema>;

function moduleValue<T>(module: { readonly status: string; readonly value?: T }): T | null {
  return "value" in module ? module.value ?? null : null;
}

function isCompetitorSource(source: GeoKnowledgeSourceV2 | undefined, competitorKey: string, competitorName: string): boolean {
  return source?.kind === "competitor_page" && source.availability !== "unavailable"
    && source.competitor?.key === competitorKey && source.competitor.name === competitorName;
}
function isOwnPageSource(source: GeoKnowledgeSourceV2 | undefined): boolean {
  return source?.kind === "own_page" && source.availability !== "unavailable";
}

type Claim = {
  readonly text: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly ownerDeclared: boolean;
};

function assertPackIntegrity(body: GeoKnowledgePackBodyV2): void {
  if (body.meta.lastScanAt > body.meta.generatedAt) throw new Error("Knowledge pack scan time exceeds generation time");
  const sourceById = new Map(body.sourceCatalogue.map((source) => [source.id, source]));
  if (sourceById.size !== body.sourceCatalogue.length) throw new Error("Duplicate source id");
  const entity = moduleValue(body.entity);
  const ownPages = body.sourceCatalogue.filter((source) => source.kind === "own_page");
  if (ownPages.length > GEO_KNOWLEDGE_LIMITS.ownPages) throw new Error("Own-page source limit exceeded");
  const ownSiteAnchor = entity?.links.home ?? body.sourceCatalogue.find((source) => (
    ["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null
  ))?.url;
  const targetHost = ownSiteAnchor === undefined || ownSiteAnchor === null ? undefined : normalizeAccountWebsiteUrl(ownSiteAnchor)?.host;
  const competitorPages = body.sourceCatalogue.filter((source) => source.kind === "competitor_page");
  const competitorKeys = new Set(competitorPages.map((source) => source.competitor!.key));
  if (competitorKeys.size > GEO_KNOWLEDGE_LIMITS.competitorIdentities) throw new Error("Competitor source limit exceeded");
  for (const key of competitorKeys) {
    if (competitorPages.filter((source) => source.competitor!.key === key).length > GEO_KNOWLEDGE_LIMITS.competitorPagesPerIdentity) throw new Error("Competitor page limit exceeded");
  }
  for (const kind of ["robots", "sitemap", "llms"] as const) {
    if (body.sourceCatalogue.filter((source) => source.kind === kind).length > GEO_KNOWLEDGE_LIMITS.machineSourcesPerKind) throw new Error("Machine source limit exceeded");
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
    if (source.kind === "third_party_page" && targetHost !== undefined && normalized.host === targetHost) throw new Error("Own-site source labelled third party");
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
  const itemKeys: string[] = [];
  const claims: Claim[] = [];
  const decisions: GeoPackDecision[] = [];
  const add = (
    entry: { readonly id?: string; readonly sourceRefs: readonly string[]; readonly itemKey?: string; readonly origin?: GeoItemOrigin; readonly decision?: GeoPackDecision },
    ...values: (string | null)[]
  ) => {
    if (entry.id !== undefined) contentIds.push(entry.id);
    if (entry.itemKey !== undefined) itemKeys.push(entry.itemKey);
    if (entry.decision !== undefined) decisions.push(entry.decision);
    claims.push({
      text: values.filter((value): value is string => value !== null),
      sourceRefs: entry.sourceRefs,
      ownerDeclared: entry.origin === "declared_owner",
    });
  };

  if (entity) {
    add(entity, entity.name, ...entity.aliases, entity.categories.primary, ...entity.categories.secondary,
      entity.definitions.w25, entity.definitions.w55, entity.definitions.w120, entity.audience.who, entity.audience.notFor,
      entity.founded.year, entity.founded.team, entity.founded.location, entity.disambiguation);
    for (const field of entity.fields) {
      itemKeys.push(field.itemKey);
      decisions.push(field.decision);
    }
  }
  for (const fact of facts) {
    add(fact, fact.statement);
    if (fact.observedAt !== null && fact.observedAt > body.meta.generatedAt || fact.nextReviewAt !== null && fact.observedAt !== null && fact.nextReviewAt < fact.observedAt) throw new Error("Invalid fact review time");
  }
  for (const item of qa) add(item, item.question, ...item.variants, item.directAnswer, item.expansion);
  for (const comparison of comparisons) {
    contentIds.push(comparison.id);
    const comparisonSources = comparison.sourceRefs.map((reference) => sourceById.get(reference));
    if (comparisonSources.some((source) => source === undefined)) throw new Error("Unknown source reference");
    if (comparisonSources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
    claims.push({ text: [comparison.competitor.name, comparison.verdict], sourceRefs: comparison.sourceRefs, ownerDeclared: false });
    const verdictHasCompetitor = comparisonSources.some((source) => isCompetitorSource(source, comparison.competitor.key, comparison.competitor.name));
    const verdictHasProduct = comparisonSources.some(isOwnPageSource);
    if (!verdictHasCompetitor || !verdictHasProduct) throw new Error("Unsupported comparison verdict evidence");
    const citedComparisonSources = [...comparisonSources, ...comparison.rows.flatMap((row) => row.sourceRefs.map((reference) => sourceById.get(reference)))];
    if (comparison.checkedAt > body.meta.generatedAt || citedComparisonSources.some((source) => (
      (source?.kind === "own_page" || source?.kind === "competitor_page") && source.observedAt !== null && comparison.checkedAt < source.observedAt
    ))) throw new Error("Invalid comparison check time");
    for (const row of comparison.rows) {
      contentIds.push(row.id);
      itemKeys.push(row.itemKey);
      decisions.push(row.decision);
      const rowSources = row.sourceRefs.map((reference) => sourceById.get(reference));
      if (rowSources.some((source) => source === undefined)) throw new Error("Unknown source reference");
      if (rowSources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
      // An owner declaration states the product side itself and cites nothing.
      if (row.origin !== "declared_owner") {
        const hasCompetitor = rowSources.some((source) => isCompetitorSource(source, comparison.competitor.key, comparison.competitor.name));
        const hasProduct = rowSources.some(isOwnPageSource);
        if (row.competitor !== null && !hasCompetitor) throw new Error("Unsupported comparison row evidence");
        if (row.product !== null && !hasProduct) throw new Error("Unsupported comparison row evidence");
      }
      claims.push({
        text: [row.dimension, row.product, row.competitor].filter((value): value is string => value !== null),
        sourceRefs: row.sourceRefs,
        ownerDeclared: row.origin === "declared_owner",
      });
    }
  }
  const scope = moduleValue(body.scope);
  if (scope) for (const items of Object.values(scope)) for (const item of items) add(item, item.text);
  const evidence = moduleValue(body.evidence);
  if (evidence) {
    for (const group of GEO_EVIDENCE_GROUPS) {
      for (const item of evidence[group]) {
        contentIds.push(item.id);
        claims.push({ text: [item.label, item.summary], sourceRefs: item.sourceRefs, ownerDeclared: false });
        const declared = item.sourceRefs.map((reference) => sourceById.get(reference));
        if (declared.some((source) => source === undefined)) throw new Error("Unknown source reference");
        // The independence label must match what the cited source actually is.
        const thirdParty = declared.filter((source) => source!.kind === "third_party_page");
        if (item.independence === "first_party") {
          if (thirdParty.length > 0) throw new Error("First-party evidence cannot cite a third-party source");
        } else {
          if (thirdParty.length === 0) throw new Error("Third-party independence requires a third-party source");
          if (thirdParty.some((source) => source!.independence !== item.independence)) throw new Error("Independence label differs from the observed source");
        }
      }
    }
  }
  const machine = moduleValue(body.machine);
  if (machine) {
    const observations = [
      { observation: machine.jsonLd, expectedKind: "own_page" },
      { observation: machine.llms, expectedKind: "llms" },
      { observation: machine.robots, expectedKind: "robots" },
      { observation: machine.sitemap, expectedKind: "sitemap" },
      { observation: machine.hreflang, expectedKind: "own_page" },
      { observation: machine.aiCrawlers, expectedKind: "robots" },
    ] as const;
    for (const { observation, expectedKind } of observations) {
      const sources = observation.sourceRefs.map((reference) => sourceById.get(reference));
      if (sources.some((source) => source === undefined)) throw new Error("Unknown source reference");
      if (sources.some((source) => source!.kind !== expectedKind)) throw new Error("Machine source kind mismatch");
    }
    const snippetSources = machine.snippets.sourceRefs.map((reference) => sourceById.get(reference));
    if (snippetSources.some((source) => source === undefined)) throw new Error("Unknown source reference");
    if (snippetSources.some((source) => !["own_page", "robots"].includes(source!.kind))) throw new Error("Machine source kind mismatch");
  }
  const coverage = moduleValue(body.coverage) ?? [];
  for (const item of coverage) {
    contentIds.push(item.id);
    if (item.sourceRefs.some((reference) => !sourceById.has(reference))) throw new Error("Unknown source reference");
  }
  if (!geoUnique(contentIds)) throw new Error("Duplicate content id");
  if (!geoUnique(itemKeys)) throw new Error("Duplicate item key");
  if (!geoUnique(comparisons.map((item) => item.competitor.key))) throw new Error("Duplicate competitor comparison");
  const accepted = decisions.filter((decision) => decision === "accepted").length;
  if (body.meta.counts.accepted !== accepted || body.meta.counts.acceptedInBulk !== decisions.length - accepted) {
    throw new Error("Knowledge pack decision counts mismatch");
  }

  for (const claim of claims) {
    // An owner declaration is its own authority: it cites nothing, and the page
    // that carried the value it replaced must not be read as supporting it.
    if (claim.ownerDeclared) continue;
    const sources = claim.sourceRefs.map((reference) => sourceById.get(reference));
    if (sources.some((source) => source === undefined)) throw new Error("Unknown source reference");
    if (sources.some((source) => source!.availability === "unavailable")) throw new Error("Unavailable source reference");
    if (!geoLiteralsAllSupported(claim.text, sources.flatMap((source) => source!.excerpts))) {
      throw new Error("Unsupported numeric claim");
    }
  }
}

function assertByteLimit(value: unknown): void {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_PACK_V2_MAX_BYTES) throw new Error("Knowledge pack exceeds byte limit");
}

export function geoKnowledgePackV2Digest(body: GeoKnowledgePackBodyV2): string {
  return geoV2Digest(body);
}

export function buildGeoKnowledgePackV2(value: unknown): GeoKnowledgePackV2 {
  const body = bodySchema.parse(value);
  assertPackIntegrity(body);
  const pack = packSchema.parse({ ...body, contentHash: geoKnowledgePackV2Digest(body) });
  assertByteLimit(pack);
  return pack;
}

export function parseGeoKnowledgePackV2(value: unknown): GeoKnowledgePackV2 {
  const parsed = packSchema.parse(value);
  const { contentHash, ...body } = parsed;
  assertPackIntegrity(body);
  assertByteLimit(parsed);
  if (geoKnowledgePackV2Digest(body) !== contentHash) throw new Error("Knowledge pack hash mismatch");
  return parsed;
}
