// @input -- a complete GEO v3 draft: locked generation output plus mutable review
// @output -- strict v3 parsing with two independent hash domains
// @pos -- client-safe v3 contract; v1/v2 payloads keep their own parsers

/**
 * A v3 draft has two halves that change on different clocks:
 *
 *   generationInput  what the model was asked about. Locked once, right after
 *                    the roles step, and read-only for the rest of the run and
 *                    the whole review. Changing it costs another billed update.
 *   knowledge        what the model and the collectors produced. Immutable for
 *                    the same reason: it is the thing the generation records
 *                    are bound to by hash.
 *   review           what the owner decided. Freely editable, and deliberately
 *                    stored beside the knowledge rather than inside it, so an
 *                    edit never changes the identity of a paid generation.
 *
 * That split is why an owner can correct a price at 4pm and still publish the
 * knowledge generated at 9am without paying for it twice.
 */
import { z } from "zod";

import { hasLoneSurrogate } from "../agents/geo-canonical.ts";
import type { GeoItemKeyParts } from "./kb-item-identity.ts";
import { geoRoleV2Schema } from "./kb-v2-contract.ts";
import {
  GEO_KNOWLEDGE_LIMITS,
  GEO_MACHINE_SOURCE_KINDS,
  geoBoundedText,
  geoEntityFieldClaim,
  geoEntityCorrectablePathSchema,
  geoEntityFieldPathSchema,
  geoLiteralsSupported,
  geoPlainString,
  geoYear,
  type GeoEntityFieldPath,
  type GeoEvidenceCheck,
  type GeoKnowledgeSource,
  geoComparisonRowContentShape,
  geoCoverageItemShape,
  geoEntityValueShape,
  geoEvidenceItemShape,
  geoEvidenceCheckSchema,
  geoFactContentShape,
  geoHash,
  geoId,
  geoItemOriginSchema,
  geoLabel,
  geoList,
  geoMachineValueShape,
  geoModuleSchema,
  geoNormalizedUnique,
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
} from "./kb-knowledge-shape.ts";

export const GEO_KB_SCHEMA_VERSION_V3 = "marketing-geo-kb.v3" as const;

/**
 * Per-part budgets rather than one number, so a large knowledge body cannot
 * quietly crowd out the review that has to survive beside it. The sum is the
 * table's own ceiling; the migration installs the same values as CHECKs.
 */
export const GEO_KB_V3_LIMITS = {
  knowledgeBytes: 524_288,
  reviewBytes: 131_072,
  restBytes: 262_144,
  totalBytes: 1_048_576,
  decisions: 512,
  suppressions: 512,
} as const;

// Deliberately not `z.uuid()`: these identities include UUIDv8 values, and a
// version-pinning validator rejects every one of them.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const draftVersion = z.string().regex(/^(0|[1-9]\d{0,14})$/u);

// ---------------------------------------------------------------------------
// generationInput -- locked once, read-only during review
// ---------------------------------------------------------------------------

/**
 * The 13 Profile fields GEO actually reads, carried by value so a frozen
 * version can be rendered without re-reading the Profile, plus the reference
 * that proves which confirmed revision they came from. The other 15 fields stay
 * in `marketing_website_profile_snapshots`, retrievable by `snapshotId`.
 */
export const geoProfileRefSchema = z.object({
  websiteId: uuid,
  snapshotId: uuid,
  snapshotRevision: z.string().regex(/^[1-9][0-9]{0,15}$/u),
  profileHash: geoHash,
  subsetHash: geoHash,
  subset: z.object({
    productName: geoPlainString(160),
    oneLinePositioning: geoPlainString(2_000),
    coreFeatures: z.array(geoPlainString(500, 1)).max(64),
    country: geoPlainString(8),
    locale: geoPlainString(35),
    categories: z.array(geoPlainString(500, 1)).max(64),
    buyer: geoPlainString(2_000),
    primaryIcp: geoPlainString(2_000),
    triggerPain: geoPlainString(2_000),
    icpPain: geoPlainString(2_000),
    qualificationSignals: z.array(geoPlainString(500, 1)).max(64),
    icpInterests: z.array(geoPlainString(500, 1)).max(64),
    directCompetitors: z.array(geoPlainString(500, 1)).max(64),
    fieldProvenance: z.array(z.object({
      path: z.enum(["/productName", "/oneLinePositioning", "/coreFeatures"]),
      derivation: z.enum(["declared", "observed", "computed", "inferred", "missing"]),
      observedAt: geoPlainString(40).nullable(),
      evidenceUrl: geoPlainString(2_048).nullable(),
    }).strict()).max(3),
  }).strict(),
}).strict();
export type GeoProfileRefV3 = z.infer<typeof geoProfileRefSchema>;

const competitorSchema = z.object({
  domain: geoPlainString(255),
  brandName: geoPlainString(200),
  confirmed: z.boolean(),
  aliases: z.array(geoPlainString(200, 1)).max(12).optional(),
}).strict().superRefine((competitor, ctx) => {
  if (competitor.domain === "" && competitor.brandName === "") ctx.addIssue({ code: "custom", message: "A competitor needs a domain or a name" });
  if (competitor.confirmed && competitor.brandName === "") ctx.addIssue({ code: "custom", message: "A confirmed competitor needs the name that was confirmed" });
});

export const geoGenerationInputSchema = z.object({
  identity: z.object({
    targetUrl: geoPlainString(2_048),
    officialName: geoShortText,
    aliases: z.array(geoShortText).max(GEO_KNOWLEDGE_LIMITS.aliases).refine(geoNormalizedUnique),
    categoryTerms: z.array(geoShortText).max(8).refine(geoNormalizedUnique),
    market: z.object({ country: geoPlainString(8), language: geoPlainString(35) }).strict(),
  }).strict(),
  profileRef: geoProfileRefSchema,
  competitors: z.array(competitorSchema).max(GEO_KNOWLEDGE_LIMITS.competitorIdentities),
  /**
   * Roles are an internal input to the question set, not customer-facing
   * content, so they are not reviewable and carry no decision. They are locked
   * here with `review: "accepted"` because the frozen context admits only
   * accepted roles into its eligible layers.
   */
  roles: z.array(geoRoleV2Schema).max(5).refine(
    (roles) => roles.every((role) => role.review === "accepted"),
    "A locked generation input carries accepted roles only",
  ),
  evidenceContentHash: geoHash,
}).strict();
export type GeoGenerationInputV3 = z.infer<typeof geoGenerationInputSchema>;

// ---------------------------------------------------------------------------
// knowledge -- the generated body, immutable once written
// ---------------------------------------------------------------------------

/**
 * A draft item says where it came from, never what was decided about it: the
 * decision lives in `review`, keyed by the same `itemKey`. `declared_owner` is
 * absent by construction -- an owner correction is an override in the review,
 * and only publishing turns it into a declared item.
 */
const alternateObservationSchema = z.object({
  /** What the other page says, stated the way the item states its own claim. */
  summary: geoText,
  sourceRefs: geoRefList(1),
  observedAt: geoTimestamp.nullable(),
}).strict();

const draftProvenanceShape = {
  itemKey: geoHash,
  origin: geoItemOriginSchema.exclude(["declared_owner"]),
  sourceRefs: geoRefList(0),
  evidenceChecks: geoEvidenceCheckSchema.exclude(["owner_declared"]),
  /**
   * Competing observations of the same claim from *different* pages. The item
   * key is content-only, so `/pricing` saying 9 and `/plans` saying 19 are one
   * identity with two observations -- and the owner has to resolve which is
   * current. Two separate items would both be acceptable and both publish,
   * which is how a knowledge base states two prices for one plan.
   *
   * Empty is the normal case. Non-empty means unresolved: for a fact the value
   * is withheld (`reason: "conflicting"`) rather than one page being picked
   * arbitrarily as the winner.
   */
  alternateObservations: z.array(alternateObservationSchema).max(4),
} as const;

type DraftItem = {
  readonly sourceRefs: readonly string[];
  readonly alternateObservations: readonly { readonly sourceRefs: readonly string[] }[];
};

function refineDraftItem(item: DraftItem, ctx: z.RefinementCtx): void {
  if (item.sourceRefs.length === 0) ctx.addIssue({ code: "custom", message: "A generated item requires a source" });
  const cited = new Set(item.sourceRefs);
  for (const alternate of item.alternateObservations) {
    if (!alternate.sourceRefs.every((ref) => cited.has(ref))) {
      ctx.addIssue({ code: "custom", message: "A conflicting observation must be cited by the item that carries it" });
    }
  }
}

const entityFieldSchema = z.object({ field: geoEntityFieldPathSchema, ...draftProvenanceShape }).strict().superRefine(refineDraftItem);

const entitySchema = z.object({
  ...geoEntityValueShape,
  fields: z.array(entityFieldSchema).max(32).refine((rows) => geoUnique(rows.map((row) => row.field)), "Duplicate entity field provenance"),
}).strict();

/**
 * Availability, reason and conflict have to agree. Split out so a review
 * override is held to exactly the rule generated content is held to -- an
 * override that could assert a value with `reason: "notPublished"`, or withhold
 * one with no reason at all, would publish a contradiction the generator is
 * forbidden from producing.
 */
export function refineGeoFactContent(
  fact: { readonly value: string | null; readonly reason: string },
  conflicting: boolean,
  ctx: z.RefinementCtx,
): void {
  if (conflicting) {
    if (fact.value !== null || fact.reason !== "conflicting") {
      ctx.addIssue({ code: "custom", message: "A fact with competing observations withholds its value until the owner resolves it" });
    }
    return;
  }
  if (fact.reason === "conflicting") {
    ctx.addIssue({ code: "custom", message: "A conflicting fact must carry the competing observations" });
    return;
  }
  if (fact.value === null) {
    if (fact.reason === "") ctx.addIssue({ code: "custom", message: "Unavailable fact requires a reason" });
    return;
  }
  if (fact.reason !== "") ctx.addIssue({ code: "custom", message: "An available fact cannot carry an unavailability reason" });
}

const factSchema = z.object({ ...geoFactContentShape, ...draftProvenanceShape }).strict().superRefine((fact, ctx) => {
  const conflicting = fact.alternateObservations.length > 0;
  refineGeoFactContent(fact, conflicting, ctx);
  // An unavailable fact has nothing to cite. A conflicting one does: it cites
  // every page whose observation it is holding open.
  if (fact.value !== null || conflicting) refineDraftItem(fact, ctx);
});

const qaSchema = z.object({ ...geoQaContentShape, ...draftProvenanceShape }).strict().superRefine(refineDraftItem);

const comparisonRowSchema = z.object({ ...geoComparisonRowContentShape, ...draftProvenanceShape }).strict().superRefine((row, ctx) => {
  refineGeoComparisonRow(row, ctx);
  refineDraftItem(row, ctx);
});

const comparisonSchema = z.object({
  id: geoId,
  competitor: geoSourceCompetitorSchema,
  checkedAt: geoTimestamp,
  rows: z.array(comparisonRowSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisonRows),
  verdict: geoText,
  sourceRefs: geoRefList(1),
}).strict();

const statementSchema = z.object({ ...geoStatementContentShape, ...draftProvenanceShape }).strict().superRefine(refineDraftItem);
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
  firstPartyProof: geoList(evidenceItemSchema, GEO_KNOWLEDGE_LIMITS.evidenceItems),
  /**
   * Which groups were looked for at all. A group missing from this list was not
   * collected; a group present but empty was collected and found nothing. v1
   * could not tell those apart, so an uncollected group rendered as an absent
   * one -- and two groups were hard-coded empty and then hidden.
   */
  collected: z.array(z.enum(["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"])).max(5).refine(geoUnique),
}).strict().superRefine((evidence, ctx) => {
  for (const group of ["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"] as const) {
    if (evidence[group].length > 0 && !evidence.collected.includes(group)) {
      ctx.addIssue({ code: "custom", message: `Group ${group} has items but is not marked collected` });
    }
  }
});

const machineSchema = z.object(geoMachineValueShape).strict().superRefine(refineGeoMachine);
const coverageItemSchema = z.object(geoCoverageItemShape).strict();

export const geoKnowledgeBodySchema = z.object({
  entity: geoModuleSchema(entitySchema),
  facts: geoModuleSchema(z.array(factSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.facts)),
  qa: geoModuleSchema(z.array(qaSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.qa)),
  comparisons: geoModuleSchema(z.array(comparisonSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.comparisons)),
  scope: geoModuleSchema(scopeSchema),
  evidence: geoModuleSchema(evidenceSchema),
  machine: geoModuleSchema(machineSchema),
  coverage: geoModuleSchema(z.array(coverageItemSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.coverageItems)),
  sourceCatalogue: z.array(geoSourceCatalogueItemSchema).min(1).max(GEO_KNOWLEDGE_LIMITS.sources),
  collectedAt: geoTimestamp,
  generatedAt: geoTimestamp,
}).strict();
export type GeoKnowledgeBodyV3 = z.infer<typeof geoKnowledgeBodySchema>;

// ---------------------------------------------------------------------------
// review -- freely editable, never part of generation identity
// ---------------------------------------------------------------------------

/**
 * `accepted_in_bulk` is RETIRED, and kept only so that drafts written before
 * 2026-09-09 still parse. Every gesture that accepts -- the per-item button,
 * "accept all", and the publish-time sweep -- writes `accepted`; the Owner's
 * ruling is that a batch acceptance IS an acceptance. Removing the member
 * instead would make every stored draft holding one unreadable, which is a
 * data loss dressed up as a cleanup. Readers must treat it as `accepted`.
 */
export const geoDecisionSchema = z.enum(["pending", "accepted", "accepted_in_bulk", "excluded"]);
export type GeoDecision = z.infer<typeof geoDecisionSchema>;

export type GeoEntityCorrectablePathV3 = z.infer<typeof geoEntityCorrectablePathSchema>;

/**
 * What a correction to each entity field may be -- the same schema the
 * published entity holds that field to, so a correction the review accepts is
 * one the publish step can apply.
 *
 * Before this existed the correction was one width for all eleven paths, and it
 * was wrong in both directions. It was wider than `founded.year`, which is four
 * digits: an owner could save "twenty nineteen", and the whole knowledge base
 * then became unpublishable at the last button, with a 422 nothing renders. And
 * it was narrower than the six 800-point fields, so rewriting a 120-word
 * definition was cut off at 200 with the same opaque refusal.
 *
 * The record is total over `GEO_ENTITY_CORRECTABLE_PATHS`, so a path added
 * there without an entry here is a compile error rather than a field that
 * quietly inherits somebody else's rule.
 */
const ENTITY_CORRECTION_RULES = {
  name: { schema: geoShortText, max: 200 },
  "categories.primary": { schema: geoShortText, max: 200 },
  "definitions.w25": { schema: geoText, max: 800 },
  "definitions.w55": { schema: geoText, max: 800 },
  "definitions.w120": { schema: geoText, max: 800 },
  "audience.who": { schema: geoText, max: 800 },
  "audience.notFor": { schema: geoText, max: 800 },
  // The one path whose rule is a shape rather than a length.
  "founded.year": { schema: geoYear, max: null },
  "founded.team": { schema: geoText, max: 800 },
  "founded.location": { schema: geoText, max: 800 },
  disambiguation: { schema: geoText, max: 800 },
} as const satisfies Record<GeoEntityCorrectablePathV3, { readonly schema: z.ZodType<string>; readonly max: number | null }>;

/**
 * What one entity field accepts, in the terms a person can be told. The review
 * card has no zod error to render and must not offer a gesture the contract
 * refuses, so it asks for this and says it beside the input.
 */
export type GeoEntityCorrectionRuleV3 =
  | { readonly kind: "fourDigitYear" }
  | { readonly kind: "text"; readonly max: number };

export function geoEntityCorrectionRule(field: GeoEntityCorrectablePathV3): GeoEntityCorrectionRuleV3 {
  const rule = ENTITY_CORRECTION_RULES[field];
  return rule.max === null ? { kind: "fourDigitYear" } : { kind: "text", max: rule.max };
}

/** The rule this correction breaks, or null when the published entity can hold it. */
export function geoEntityCorrectionIssue(field: GeoEntityCorrectablePathV3, value: string): GeoEntityCorrectionRuleV3 | null {
  return ENTITY_CORRECTION_RULES[field].schema.safeParse(value).success ? null : geoEntityCorrectionRule(field);
}

function entityCorrectionMessage(field: GeoEntityCorrectablePathV3): string {
  const rule = geoEntityCorrectionRule(field);
  return rule.kind === "fourDigitYear"
    ? `A correction to ${field} must be a four-digit year`
    : `A correction to ${field} must be at most ${rule.max} code points of text`;
}

/** What a correction may change: the text a reader sees, never the provenance. */
export const geoOverrideSchema = z.discriminatedUnion("module", [
  z.object({
    module: z.literal("facts"),
    statement: geoText,
    label: geoShortText,
    value: geoShortText.nullable(),
    /**
     * `conflicting` is deliberately absent, and it is the one value the fact's
     * own shape has that a correction does not. Withholding a value as
     * conflicting is only honest while the competing observations are there to
     * be read, and an override carries none -- so the refinement below refused
     * every conflicting override anyway, in a message naming
     * `alternateObservations`, a field this shape does not have. An enum that
     * offers what the schema beside it always refuses is a contract lying about
     * what it accepts.
     */
    reason: z.enum(["", "notPublished", "fetchFailed", "lowConfidence"]),
  }).strict(),
  // The expansion bound is the published field's own (2 400), not `geoText`:
  // a correction has to be able to carry the text it is replacing.
  z.object({ module: z.literal("qa"), directAnswer: geoText, expansion: geoBoundedText(2_400).nullable() }).strict(),
  z.object({ module: z.literal("comparisons"), product: geoText.nullable(), competitor: geoText.nullable() }).strict(),
  z.object({ module: z.literal("scope"), text: geoText }).strict(),
  // `geoText` is the widest correctable entity field; the refinement below
  // narrows each path to its own rule, so this bound alone never decides.
  z.object({ module: z.literal("entity"), field: geoEntityCorrectablePathSchema, value: geoText }).strict(),
]).superRefine((override, ctx) => {
  // A correction is held to the same content rule as generated text.
  if (override.module === "facts") refineGeoFactContent(override, false, ctx);
  if (override.module === "entity" && geoEntityCorrectionIssue(override.field, override.value) !== null) {
    ctx.addIssue({ code: "custom", path: ["value"], message: entityCorrectionMessage(override.field) });
  }
});
export type GeoOverrideV3 = z.infer<typeof geoOverrideSchema>;

export const geoDecisionRecordSchema = z.object({
  itemKey: geoHash,
  decision: geoDecisionSchema,
  override: geoOverrideSchema.nullable(),
  /**
   * The item content this decision was made against. When the next update
   * observes the same key from the same page with different content, the
   * decision is kept but the item is flagged as having a new observation
   * rather than silently carrying an approval of text nobody read.
   */
  baseContentHash: geoHash,
  decidedAt: geoTimestamp,
  baseDraftVersion: draftVersion,
}).strict().superRefine((record, ctx) => {
  if (record.override !== null && record.decision !== "accepted") {
    ctx.addIssue({ code: "custom", message: "A correction is an acceptance of the corrected text" });
  }
  if (record.decision === "excluded" && record.override !== null) {
    ctx.addIssue({ code: "custom", message: "An excluded item cannot also be corrected" });
  }
});

export const geoReviewSchemaV3 = z.object({
  decisions: z.array(geoDecisionRecordSchema).max(GEO_KB_V3_LIMITS.decisions).refine(
    (rows) => geoUnique(rows.map((row) => row.itemKey)),
    "Duplicate decision for one item",
  ),
  /**
   * Exclusions that outlive the item. They apply on exact key only: two scope
   * statements differing by one word can score 0.9 similar, and inheriting an
   * exclusion at that distance would make the other statement disappear
   * without anyone deciding it should.
   */
  suppressions: z.array(z.object({ itemKey: geoHash, suppressedAt: geoTimestamp }).strict())
    .max(GEO_KB_V3_LIMITS.suppressions)
    .refine((rows) => geoUnique(rows.map((row) => row.itemKey)), "Duplicate suppression"),
}).strict();
export type GeoReviewV3 = z.infer<typeof geoReviewSchemaV3>;

// ---------------------------------------------------------------------------
// runRef -- which paid generations this draft is entitled to reuse
// ---------------------------------------------------------------------------

export const geoRunRefSchema = z.object({
  /** Null until the single-run route exists; the client's three-call flow has no run. */
  runId: uuid.nullable(),
  generationInputHash: geoHash,
  rolesGenerationId: uuid.nullable(),
  knowledgeGenerationId: uuid.nullable(),
  questionsGenerationId: uuid.nullable(),
}).strict();
export type GeoRunRefV3 = z.infer<typeof geoRunRefSchema>;

const payloadSchema = z.object({
  schemaVersion: z.literal(GEO_KB_SCHEMA_VERSION_V3),
  generationInput: geoGenerationInputSchema,
  knowledge: geoKnowledgeBodySchema.nullable(),
  review: geoReviewSchemaV3,
  runRef: geoRunRefSchema,
}).strict();

export type GeoKbPayloadV3 = z.infer<typeof payloadSchema>;

/** jsonb::text size, matching what the column CHECKs measure. */
function jsonbBytes(value: unknown): number {
  const canonical = (node: unknown): string => {
    if (node === null || typeof node === "boolean") return JSON.stringify(node);
    if (typeof node === "string") {
      // A lone surrogate has no valid `jsonb::text` form at all, so a size
      // measured over it is a size of something PostgreSQL will refuse.
      // Unreachable through today's parser -- every string field is either
      // `geoPlainString`/`geoBoundedText` (which reject it and name the field)
      // or a regex-bounded token. It is here for the field added next, and it
      // therefore has no test of its own: `geoPlainString` carries that one.
      if (node.includes("\u0000") || hasLoneSurrogate(node)) throw new Error("JSONB cannot store this string");
      return JSON.stringify(node);
    }
    if (typeof node === "number") throw new Error("GEO v3 payload must not contain numbers");
    if (Array.isArray(node)) return `[${node.map(canonical).join(",")}]`;
    if (typeof node !== "object" || Object.getPrototypeOf(node) !== Object.prototype) throw new Error("Expected plain JSON");
    const record = node as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  };
  const spaces = (node: unknown): number => {
    if (Array.isArray(node)) return Math.max(0, node.length - 1) + node.reduce<number>((sum, entry) => sum + spaces(entry), 0);
    if (node === null || typeof node !== "object") return 0;
    const entries = Object.values(node);
    return entries.length + Math.max(0, entries.length - 1) + entries.reduce<number>((sum, entry) => sum + spaces(entry), 0);
  };
  return new TextEncoder().encode(canonical(value)).byteLength + spaces(value);
}

/**
 * Sizes are checked per part. A single total would let a large knowledge body
 * consume the space the review needs, and the failure would then arrive when
 * the owner tries to record a decision -- after the paid work, at the moment it
 * is least recoverable.
 */
export function assertGeoV3Budgets(payload: GeoKbPayloadV3): void {
  const knowledge = payload.knowledge === null ? 4 : jsonbBytes(payload.knowledge);
  const review = jsonbBytes(payload.review);
  const rest = jsonbBytes({ schemaVersion: payload.schemaVersion, generationInput: payload.generationInput, runRef: payload.runRef });
  if (knowledge > GEO_KB_V3_LIMITS.knowledgeBytes) throw new Error("GEO v3 knowledge exceeds byte limit");
  if (review > GEO_KB_V3_LIMITS.reviewBytes) throw new Error("GEO v3 review exceeds byte limit");
  if (rest > GEO_KB_V3_LIMITS.restBytes) throw new Error("GEO v3 generation input exceeds byte limit");
  if (jsonbBytes(payload) > GEO_KB_V3_LIMITS.totalBytes) throw new Error("GEO v3 payload exceeds byte limit");
}

/**
 * One reviewable item, flattened out of the module it lives in. Every check
 * that has to reason about items -- key uniqueness, key integrity, override
 * targets, evidence support -- walks this list, so none of them can drift into
 * covering a different set of modules than the others.
 */
export interface GeoV3Item {
  readonly module: "entity" | "facts" | "qa" | "comparisons" | "scope";
  readonly itemKey: string;
  /** The content this key must be derived from; the server recomputes and compares. */
  readonly identity: GeoItemKeyParts;
  readonly sourceRefs: readonly string[];
  readonly evidenceChecks: GeoEvidenceCheck;
  /**
   * Claims whose numeric literals must occur in the excerpts cited beside them.
   *
   * This is every text field the published pack carries for the item, not only
   * the sentence it leads with: `cited_and_literals_match` is a statement about
   * the item, so a question, a label or a qualifier asserting a number nothing
   * observed would make the badge mean less than it says. The one exception is
   * a comparison row's `dimension`, and the reason is recorded in
   * kb-v3-contract.test.ts beside the partition that pins it.
   *
   * `claims[0]` is the item's own summary sentence -- the statement, the direct
   * answer, the scope text, the entity field's value -- because
   * kb-knowledge-merge.ts:243 reads it as the human-readable observation it
   * files under a conflict. Anything added here is appended, never prepended.
   */
  readonly claims: readonly { readonly text: string; readonly sourceRefs: readonly string[] }[];
  /** Entity items only; null everywhere else. */
  readonly entityField: GeoEntityFieldPath | null;
}

const moduleValue = <T>(module: { readonly status: string; readonly value?: T }): T | null => (
  "value" in module ? module.value ?? null : null
);

function alternateClaims(item: { readonly alternateObservations: readonly { readonly summary: string; readonly sourceRefs: readonly string[] }[] }) {
  return item.alternateObservations.map((alternate) => ({ text: alternate.summary, sourceRefs: alternate.sourceRefs }));
}

/** Every reviewable item in the knowledge body, in a stable order. */
export function geoV3Items(knowledge: GeoKnowledgeBodyV3 | null): readonly GeoV3Item[] {
  if (knowledge === null) return [];
  const items: GeoV3Item[] = [];
  const entity = moduleValue(knowledge.entity);
  if (entity) {
    for (const field of entity.fields) {
      items.push({
        module: "entity",
        itemKey: field.itemKey,
        identity: { module: "entity", field: field.field },
        sourceRefs: field.sourceRefs,
        evidenceChecks: field.evidenceChecks,
        claims: [{ text: geoEntityFieldClaim(entity, field.field), sourceRefs: field.sourceRefs }, ...alternateClaims(field)],
        entityField: field.field,
      });
    }
  }
  for (const fact of moduleValue(knowledge.facts) ?? []) {
    items.push({
      module: "facts",
      itemKey: fact.itemKey,
      identity: { module: "facts", type: fact.type, subject: fact.subject, attribute: fact.attribute, qualifiers: fact.qualifiers },
      sourceRefs: fact.sourceRefs,
      evidenceChecks: fact.evidenceChecks,
      claims: [
        { text: fact.statement, sourceRefs: fact.sourceRefs },
        ...(fact.value === null ? [] : [{ text: fact.value, sourceRefs: fact.sourceRefs }]),
        ...alternateClaims(fact),
        { text: fact.label, sourceRefs: fact.sourceRefs },
        { text: fact.subject, sourceRefs: fact.sourceRefs },
        { text: fact.attribute, sourceRefs: fact.sourceRefs },
        ...fact.qualifiers.map((qualifier) => ({ text: qualifier, sourceRefs: fact.sourceRefs })),
      ],
      entityField: null,
    });
  }
  for (const qa of moduleValue(knowledge.qa) ?? []) {
    items.push({
      module: "qa",
      itemKey: qa.itemKey,
      identity: { module: "qa", intent: qa.intent, canonicalQuestion: qa.canonicalQuestion },
      sourceRefs: qa.sourceRefs,
      evidenceChecks: qa.evidenceChecks,
      claims: [
        { text: qa.directAnswer, sourceRefs: qa.sourceRefs },
        ...(qa.expansion === null ? [] : [{ text: qa.expansion, sourceRefs: qa.sourceRefs }]),
        ...alternateClaims(qa),
        { text: qa.question, sourceRefs: qa.sourceRefs },
        { text: qa.canonicalQuestion, sourceRefs: qa.sourceRefs },
        ...qa.variants.map((variant) => ({ text: variant, sourceRefs: qa.sourceRefs })),
      ],
      entityField: null,
    });
  }
  for (const comparison of moduleValue(knowledge.comparisons) ?? []) {
    for (const row of comparison.rows) {
      items.push({
        module: "comparisons",
        itemKey: row.itemKey,
        identity: { module: "comparisons", competitorKey: comparison.competitor.key, dimension: row.dimension },
        sourceRefs: row.sourceRefs,
        evidenceChecks: row.evidenceChecks,
        claims: [
          ...(row.product === null ? [] : [{ text: row.product, sourceRefs: row.sourceRefs }]),
          ...(row.competitor === null ? [] : [{ text: row.competitor, sourceRefs: row.sourceRefs }]),
          ...alternateClaims(row),
        ],
        entityField: null,
      });
    }
  }
  const scope = moduleValue(knowledge.scope);
  if (scope) {
    for (const kind of ["does", "doesNot", "needsHuman", "misconceptions"] as const) {
      for (const statement of scope[kind]) {
        items.push({
          module: "scope",
          itemKey: statement.itemKey,
          identity: { module: "scope", kind, statement: statement.text },
          sourceRefs: statement.sourceRefs,
          evidenceChecks: statement.evidenceChecks,
          claims: [{ text: statement.text, sourceRefs: statement.sourceRefs }, ...alternateClaims(statement)],
          entityField: null,
        });
      }
    }
  }
  return items;
}

/** Every item key present in the knowledge body, in a stable order. */
export function geoV3ItemKeys(knowledge: GeoKnowledgeBodyV3 | null): readonly string[] {
  return geoV3Items(knowledge).map((item) => item.itemKey);
}

/**
 * What `cited_and_literals_match` is allowed to mean. It is checked here rather
 * than trusted from the generator: the label is the only thing the card shows
 * an owner about evidence, and a generator that mislabels costs nothing to
 * write. A claim citing only an unavailable source has no observed text behind
 * it at all, and a number that appears in no excerpt was not read anywhere.
 */
function assertEvidenceChecks(items: readonly GeoV3Item[], sources: ReadonlyMap<string, GeoKnowledgeSource>): void {
  for (const item of items) {
    if (item.evidenceChecks !== "cited_and_literals_match") continue;
    const cited = item.sourceRefs.map((ref) => sources.get(ref)!);
    if (!cited.some((source) => source.availability !== "unavailable" && source.excerpts.length > 0)) {
      throw new Error("A checked citation requires a source with observed text");
    }
    for (const claim of item.claims) {
      const excerpts = claim.sourceRefs.flatMap((ref) => sources.get(ref)!.excerpts);
      if (!geoLiteralsSupported(claim.text, excerpts)) {
        throw new Error("A checked claim asserts a number that occurs in no cited excerpt");
      }
    }
  }
}

/**
 * A correction has to be applicable to the thing it corrects. Without this a
 * scope override could be filed against a price, and the publish step would
 * hold an accepted correction it cannot apply to anything.
 */
function assertOverrideTargets(decisions: GeoReviewV3["decisions"], items: readonly GeoV3Item[]): void {
  const byKey = new Map(items.map((item) => [item.itemKey, item]));
  for (const decision of decisions) {
    const target = byKey.get(decision.itemKey);
    if (target === undefined) throw new Error("Decision refers to an unknown item");
    if (decision.override === null) continue;
    if (decision.override.module !== target.module) throw new Error("Correction does not match the item it addresses");
    if (decision.override.module === "entity" && decision.override.field !== target.entityField) {
      throw new Error("Correction addresses a different entity field");
    }
  }
}

/**
 * The published pack refuses a machine observation citing the wrong kind of
 * source. Checking it here too means the draft that cannot be published is
 * refused while the assembler can still fix it, rather than at publish time.
 */
function assertMachineSourceKinds(knowledge: GeoKnowledgeBodyV3 | null, sources: ReadonlyMap<string, GeoKnowledgeSource>): void {
  const machine = knowledge === null ? null : moduleValue(knowledge.machine);
  if (machine === null) return;
  for (const [field, allowed] of Object.entries(GEO_MACHINE_SOURCE_KINDS)) {
    const observation = machine[field as keyof typeof machine];
    for (const ref of observation.sourceRefs) {
      const kind = sources.get(ref)!.kind;
      if (!(allowed as readonly string[]).includes(kind)) {
        throw new Error(`Machine observation ${field} cannot cite a ${kind} source`);
      }
    }
  }
}

export function parseGeoKbPayloadV3(value: unknown): GeoKbPayloadV3 {
  const parsed = payloadSchema.parse(value);
  assertGeoV3Budgets(parsed);
  const items = geoV3Items(parsed.knowledge);
  if (new Set(items.map((item) => item.itemKey)).size !== items.length) throw new Error("Duplicate item key");
  assertOverrideTargets(parsed.review.decisions, items);

  const catalogue = parsed.knowledge?.sourceCatalogue ?? [];
  const sources = new Map(catalogue.map((source) => [source.id, source]));
  // Collapsing duplicate ids into a Set would leave every citation ambiguous:
  // two sources answering to `s` resolve differently depending on lookup order.
  if (sources.size !== catalogue.length) throw new Error("Duplicate source id");
  for (const key of parsed.knowledge === null ? [] : geoV3SourceRefs(parsed.knowledge)) {
    if (!sources.has(key)) throw new Error("Unknown source reference");
  }
  assertEvidenceChecks(items, sources);
  assertMachineSourceKinds(parsed.knowledge, sources);
  return parsed;
}

/** Every source reference the knowledge body cites. */
export function geoV3SourceRefs(knowledge: GeoKnowledgeBodyV3): readonly string[] {
  const refs: string[] = [];
  for (const item of geoV3Items(knowledge)) {
    refs.push(...item.sourceRefs);
    for (const claim of item.claims) refs.push(...claim.sourceRefs);
  }
  const entity = moduleValue(knowledge.entity);
  if (entity) refs.push(...entity.sourceRefs);
  for (const comparison of moduleValue(knowledge.comparisons) ?? []) refs.push(...comparison.sourceRefs);
  const evidence = moduleValue(knowledge.evidence);
  if (evidence) for (const group of ["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"] as const) {
    for (const item of evidence[group]) refs.push(...item.sourceRefs);
  }
  const machine = moduleValue(knowledge.machine);
  if (machine) for (const observation of [machine.jsonLd, machine.llms, machine.robots, machine.sitemap, machine.hreflang, machine.aiCrawlers, machine.snippets]) {
    refs.push(...observation.sourceRefs);
  }
  for (const item of moduleValue(knowledge.coverage) ?? []) refs.push(...item.sourceRefs);
  return refs;
}

export function isGeoKbPayloadV3(value: unknown): boolean {
  return value !== null && typeof value === "object" && "schemaVersion" in value
    && (value as { schemaVersion?: unknown }).schemaVersion === GEO_KB_SCHEMA_VERSION_V3;
}

export { geoLabel as geoV3Label };
