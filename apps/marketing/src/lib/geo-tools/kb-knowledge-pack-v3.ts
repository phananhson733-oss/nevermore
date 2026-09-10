// @input -- a v3 draft (generated knowledge plus the owner's review) and an optional question set
// @output -- the v2 knowledge pack that publishing freezes, assembled deterministically
// @pos -- pure publish-time assembly: no clock, no fetch, no store, no model call

/**
 * Publishing is the moment a draft becomes something other tools read, so this
 * is where the two halves of a v3 draft are finally joined: what was generated
 * (immutable, paid for, bound to a generation record by hash) and what the
 * owner decided about it (freely edited, and never part of that identity).
 *
 * Three properties are why this is its own assembler rather than a branch
 * inside `kb-knowledge-pack.ts`:
 *
 *  - the question set is optional. v1 parses a full question set and checks it
 *    against `context.questionSetHash` before it assembles anything, so a run
 *    whose knowledge succeeded and whose question set failed could not be
 *    published at all.
 *  - the review is applied here, once: excluded items never reach the pack, and
 *    everything left that nobody confirmed one by one is published as
 *    `accepted_in_bulk` -- labelled, not upgraded.
 *  - a correction is republished as the owner's own claim: the page that
 *    carried the value it replaced moves to `priorSourceRefs`, which no support
 *    check reads.
 *
 * Every input arrives as an argument, both timestamps included, so the same
 * draft always assembles to the same `contentHash` -- which is what makes
 * publishing the same content twice idempotent instead of minting a version.
 */
import {
  buildGeoKnowledgePackV2,
  GEO_KNOWLEDGE_PACK_V2_SCHEMA,
  type GeoKnowledgePackV2,
  type GeoPackDecision,
} from "./kb-knowledge-pack-v2-contract.ts";
import {
  GEO_ENTITY_REMOVABLE_PATHS,
  type GeoEntityRemovablePath,
  GEO_EVIDENCE_GROUPS,
  GEO_KNOWLEDGE_LIMITS,
  type GeoEntityFieldPath,
  type GeoEvidenceCheck,
  type GeoItemOrigin,
  type GeoUnavailableReason,
} from "./kb-knowledge-shape.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import {
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
  type GeoKnowledgeBodyV3,
  type GeoOverrideV3,
  type GeoReviewV3,
} from "./kb-v3-contract.ts";
import {
  geoLimitationEnglish,
  geoPartialLimitation,
  type GeoLimitationClause,
} from "./kb-knowledge-limitation.ts";

/**
 * Said in the facts section when every model module failed. Without it a short
 * list of declared facts reads as the whole truth about the product.
 *
 * The sentence itself now comes from the shared clause table, so the English a
 * pack stores and the Chinese a reader sees cannot drift apart.
 */
export const GEO_FACTS_WITHOUT_MODEL_LIMITATION = geoLimitationEnglish("facts_without_model");

const COVERAGE_REVIEW_ACTION = "Review available evidence before relying on this section.";
const COVERAGE_UNAVAILABLE = "This content is currently unavailable.";

/**
 * What a section withheld by the owner says in the coverage table.
 *
 * The generic row states an absence and points at the evidence, which is a
 * claim about the collection run. When the run collected supported content and
 * the owner removed it, both halves are false -- and the action that restores
 * the section is a review decision, not more evidence.
 */
const COVERAGE_OWNER_EXCLUDED: Readonly<Partial<Record<GeoUnavailableReason, { readonly summary: string; readonly nextAction: string }>>> = {
  owner_excluded_all: {
    summary: "You excluded every item in this section, so it is not published.",
    nextAction: "Restore an excluded item to publish this section.",
  },
  owner_excluded_required: {
    summary: "You excluded a field this section cannot be published without, so it is not published.",
    nextAction: "Restore that field to publish this section.",
  },
};

// ---------------------------------------------------------------------------
// shared module shape
// ---------------------------------------------------------------------------

type ModuleOf<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "partial"; readonly limitation: string; readonly limitationKeys?: GeoLimitationClause[]; readonly value: T }
  | { readonly status: "unavailable"; readonly reason: GeoUnavailableReason };

interface DraftProvenance {
  readonly itemKey: string;
  readonly origin: GeoItemOrigin;
  readonly sourceRefs: readonly string[];
  readonly evidenceChecks: GeoEvidenceCheck;
}

interface PublishedProvenance {
  readonly itemKey: string;
  readonly origin: GeoItemOrigin;
  readonly decision: GeoPackDecision;
  readonly sourceRefs: readonly string[];
  readonly priorSourceRefs: readonly string[];
  readonly ownerDeclaredAt: string | null;
  readonly evidenceChecks: GeoEvidenceCheck;
}

/** What publishing decided about one item. `null` means it is not published. */
interface Resolution {
  readonly decision: GeoPackDecision;
  readonly override: GeoOverrideV3 | null;
  readonly decidedAt: string | null;
}
type Resolve = (itemKey: string) => Resolution | null;

function unavailable(reason: GeoUnavailableReason): ModuleOf<never> {
  return { status: "unavailable", reason };
}

/**
 * Keep a reviewed module's state while replacing what it holds.
 *
 * `limitationKeys` travels with `limitation`. Dropping it here would republish
 * a module whose sentence is English-only, on a pack whose draft could have
 * been read in Chinese -- the same page, worse, after publishing.
 */
function withStatus<T>(
  module: { readonly status: "available" } | { readonly status: "partial"; readonly limitation: string; readonly limitationKeys?: GeoLimitationClause[] },
  value: T,
): ModuleOf<T> {
  if (module.status !== "partial") return { status: "available", value };
  return module.limitationKeys === undefined
    ? { status: "partial", limitation: module.limitation, value }
    : { status: "partial", limitation: module.limitation, limitationKeys: module.limitationKeys, value };
}

function canonicalTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

/**
 * The publish-time reading of the review.
 *
 * A missing record means nobody looked at the item, which is exactly what
 * `pending` means, so both take the same route: published, and labelled as not
 * having been confirmed one by one. Nothing here may turn a batch into
 * `accepted` -- pressing a different button must not let the same model output
 * claim a stronger label.
 */
function reviewIndex(review: GeoReviewV3): Resolve {
  const decisions = new Map(review.decisions.map((record) => [record.itemKey, record]));
  const suppressed = new Set(review.suppressions.map((record) => record.itemKey));
  return (itemKey) => {
    if (suppressed.has(itemKey)) return null;
    const record = decisions.get(itemKey);
    if (record === undefined || record.decision === "pending") {
      return { decision: "accepted_in_bulk", override: null, decidedAt: null };
    }
    if (record.decision === "excluded") return null;
    return { decision: record.decision, override: record.override, decidedAt: record.decidedAt };
  };
}

/**
 * The correction for one module, if the owner made one. A correction filed
 * against a different module is a mismatch between the review and the knowledge
 * it addresses, and applying it would edit the wrong item.
 */
function overrideFor<M extends GeoOverrideV3["module"]>(resolution: Resolution, module: M): Extract<GeoOverrideV3, { module: M }> | null {
  const override = resolution.override;
  if (override === null) return null;
  if (override.module !== module) throw new Error("Correction addresses a different module");
  // The discriminant has just been checked; TypeScript cannot narrow a union
  // through a generic type parameter on its own.
  return override as Extract<GeoOverrideV3, { module: M }>;
}

/**
 * A corrected item is the owner's claim, not the page's. Its sources move to
 * `priorSourceRefs`, which is rendered as "what this replaced" and is read by
 * no support check, and `evidenceChecks` becomes `owner_declared` -- so the
 * numeric-literal check in the pack contract skips it rather than asking an old
 * page to back a number it never carried.
 */
function publishedProvenance(item: DraftProvenance, resolution: Resolution): PublishedProvenance {
  const common = { itemKey: item.itemKey, decision: resolution.decision };
  if (resolution.override === null) {
    return { ...common, origin: item.origin, sourceRefs: [...item.sourceRefs], priorSourceRefs: [], ownerDeclaredAt: null, evidenceChecks: item.evidenceChecks };
  }
  if (resolution.decidedAt === null) throw new Error("A correction requires the time it was decided");
  return { ...common, origin: "declared_owner", sourceRefs: [], priorSourceRefs: [...item.sourceRefs], ownerDeclaredAt: resolution.decidedAt, evidenceChecks: "owner_declared" };
}

/**
 * Republish one collection: drop what the review excluded, keep the module's
 * own status otherwise.
 *
 * A module whose every item was excluded is not an empty module, and it is not
 * an evidence shortfall either: `resolve` returns null only for an exclusion or
 * a suppression, and a run that genuinely found nothing arrives already
 * `unavailable` and is returned untouched above. So the module says the owner
 * emptied it. `insufficient_evidence` here would blame the evidence for a
 * decision a person made, on a section the run did support.
 */
function republish<TDraft extends DraftProvenance, TPack>(
  module: ModuleOf<readonly TDraft[]>,
  resolve: Resolve,
  publish: (item: TDraft, resolution: Resolution) => TPack,
): ModuleOf<readonly TPack[]> {
  if (module.status === "unavailable") return module;
  const kept = module.value.flatMap((item) => {
    const resolution = resolve(item.itemKey);
    return resolution === null ? [] : [publish(item, resolution)];
  });
  if (module.value.length > 0 && kept.length === 0) return unavailable("owner_excluded_all");
  return withStatus(module, kept);
}

// ---------------------------------------------------------------------------
// per-module assembly
// ---------------------------------------------------------------------------

type EntityModuleV3 = GeoKnowledgeBodyV3["entity"];
type EntityValue = Omit<Extract<EntityModuleV3, { status: "available" }>["value"], "fields">;
type EntityFieldDraft = Extract<EntityModuleV3, { status: "available" }>["value"]["fields"][number];
type FactDraft = Extract<GeoKnowledgeBodyV3["facts"], { status: "available" }>["value"][number];
type QaDraft = Extract<GeoKnowledgeBodyV3["qa"], { status: "available" }>["value"][number];
type ComparisonDraft = Extract<GeoKnowledgeBodyV3["comparisons"], { status: "available" }>["value"][number];
type ComparisonRowDraft = ComparisonDraft["rows"][number];
type StatementDraft = Extract<GeoKnowledgeBodyV3["scope"], { status: "available" }>["value"]["does"][number];

/**
 * Which entity fields a correction can address, by name. Unknown names fail
 * closed: stamping a provenance row `declared_owner` while leaving the
 * generated value in place would publish a claim the owner never made.
 */
const ENTITY_CORRECTIONS: Readonly<Record<string, (value: EntityValue, text: string) => EntityValue>> = {
  name: (value, text) => ({ ...value, name: text }),
  disambiguation: (value, text) => ({ ...value, disambiguation: text }),
  "categories.primary": (value, text) => ({ ...value, categories: { ...value.categories, primary: text } }),
  "definitions.w25": (value, text) => ({ ...value, definitions: { ...value.definitions, w25: text } }),
  "definitions.w55": (value, text) => ({ ...value, definitions: { ...value.definitions, w55: text } }),
  "definitions.w120": (value, text) => ({ ...value, definitions: { ...value.definitions, w120: text } }),
  "audience.who": (value, text) => ({ ...value, audience: { ...value.audience, who: text } }),
  "audience.notFor": (value, text) => ({ ...value, audience: { ...value.audience, notFor: text } }),
  "founded.year": (value, text) => ({ ...value, founded: { ...value.founded, year: text } }),
  "founded.team": (value, text) => ({ ...value, founded: { ...value.founded, team: text } }),
  "founded.location": (value, text) => ({ ...value, founded: { ...value.founded, location: text } }),
};

function correctEntity(value: EntityValue, field: EntityFieldDraft, resolution: Resolution): EntityValue {
  const override = overrideFor(resolution, "entity");
  if (override === null) return value;
  if (override.field !== field.field) throw new Error("Correction addresses a different entity field");
  const apply = ENTITY_CORRECTIONS[override.field];
  if (apply === undefined) throw new Error("Unsupported entity field correction");
  return apply(value, override.value);
}

type EntityRow = { readonly field: string } & PublishedProvenance;

/**
 * How excluding one entity field removes what it stands for.
 *
 * The provenance row was never the claim: dropping only the row published
 * exactly the text the owner rejected, and published it with less provenance
 * beside it than the fields they accepted -- so the rejected value read as the
 * least qualified thing on the page rather than as absent.
 *
 * Only a field the entity contract can be published without appears here: a
 * list empties, a nullable scalar becomes null. Every other path is required,
 * and a path added to `GEO_ENTITY_FIELD_PATHS` without an entry here is treated
 * as required -- the fail-closed direction, since the alternative is publishing
 * an excluded value.
 */
const ENTITY_REMOVALS: Readonly<Record<GeoEntityRemovablePath, (value: EntityValue) => EntityValue>> = {
  aliases: (value) => ({ ...value, aliases: [] }),
  "categories.secondary": (value) => ({ ...value, categories: { ...value.categories, secondary: [] } }),
  sameAs: (value) => ({ ...value, sameAs: [] }),
  disambiguation: (value) => ({ ...value, disambiguation: null }),
  "audience.notFor": (value) => ({ ...value, audience: { ...value.audience, notFor: null } }),
  "founded.year": (value) => ({ ...value, founded: { ...value.founded, year: null } }),
  "founded.team": (value) => ({ ...value, founded: { ...value.founded, team: null } }),
  "founded.location": (value) => ({ ...value, founded: { ...value.founded, location: null } }),
  "links.pricing": (value) => ({ ...value, links: { ...value.links, pricing: null } }),
  "links.docs": (value) => ({ ...value, links: { ...value.links, docs: null } }),
  "links.about": (value) => ({ ...value, links: { ...value.links, about: null } }),
  "links.changelog": (value) => ({ ...value, links: { ...value.links, changelog: null } }),
  "links.faq": (value) => ({ ...value, links: { ...value.links, faq: null } }),
};

/**
 * Re-exported from the shape layer, where the list has to live so the review UI
 * -- a client component that must not import this file -- can read it too.
 *
 * The two cannot drift, and not by convention: `ENTITY_REMOVALS` above is typed
 * as a *total* record over `GeoEntityRemovablePath`, so a removable path with
 * no remover and a remover for a required path are both compile errors.
 */
export { GEO_ENTITY_REQUIRED_PATHS } from "./kb-knowledge-shape.ts";

/**
 * A predicate over the same list the removal table is keyed by, so narrowing
 * here cannot disagree with what `ENTITY_REMOVALS` actually holds. A cast would
 * have compiled and been wrong the moment the two lists diverged.
 */
function removable(path: GeoEntityFieldPath): path is GeoEntityRemovablePath {
  return (GEO_ENTITY_REMOVABLE_PATHS as readonly string[]).includes(path);
}

function entityModule(module: EntityModuleV3, resolve: Resolve): ModuleOf<EntityValue & { readonly fields: readonly EntityRow[] }> {
  if (module.status === "unavailable") return module;
  const { fields, ...value } = module.value;
  const reviewed = fields.map((field) => ({ field, resolution: resolve(field.itemKey) }));
  const published = reviewed.flatMap((entry) => (entry.resolution === null ? [] : [{ field: entry.field, resolution: entry.resolution }]));
  // Said before the required-field check below: when nothing survived, "you
  // excluded all of it" is the whole story, and which field was structural is
  // not something the reader needs to be told.
  if (fields.length > 0 && published.length === 0) return unavailable("owner_excluded_all");
  const excluded = reviewed.flatMap((entry) => (entry.resolution === null ? [entry.field.field] : []));
  const removals = excluded.flatMap((path) => (removable(path) ? [ENTITY_REMOVALS[path]] : []));
  // A required field cannot be dropped from the value, and publishing it after
  // the owner excluded it would state exactly what they rejected. So the whole
  // section is withheld, and says that a review decision withheld it.
  if (removals.length < excluded.length) return unavailable("owner_excluded_required");
  const kept = removals.reduce<EntityValue>((current, remove) => remove(current), value);
  const corrected = published.reduce<EntityValue>((current, entry) => correctEntity(current, entry.field, entry.resolution), kept);
  const rows: readonly EntityRow[] = published.map((entry) => ({
    field: entry.field.field,
    ...publishedProvenance(entry.field, entry.resolution),
  }));
  return withStatus(module, { ...corrected, fields: rows });
}

/**
 * A corrected fact drops `observedAt`: the value it now states was never
 * observed on that date, and the date the owner declared it is carried by
 * `ownerDeclaredAt` instead.
 */
function publishFact(fact: FactDraft, resolution: Resolution) {
  const { itemKey, origin, sourceRefs, evidenceChecks, alternateObservations, ...content } = fact;
  const override = overrideFor(resolution, "facts");
  const corrected = override === null
    ? content
    : { ...content, statement: override.statement, label: override.label, value: override.value, reason: override.reason, observedAt: null };
  return { ...corrected, ...publishedProvenance(fact, resolution) };
}

function publishQa(item: QaDraft, resolution: Resolution) {
  const { itemKey, origin, sourceRefs, evidenceChecks, alternateObservations, ...content } = item;
  const override = overrideFor(resolution, "qa");
  const corrected = override === null ? content : { ...content, directAnswer: override.directAnswer, expansion: override.expansion };
  return { ...corrected, ...publishedProvenance(item, resolution) };
}

function publishStatement(item: StatementDraft, resolution: Resolution) {
  const { itemKey, origin, sourceRefs, evidenceChecks, alternateObservations, ...content } = item;
  const override = overrideFor(resolution, "scope");
  const corrected = override === null ? content : { ...content, text: override.text };
  return { ...corrected, ...publishedProvenance(item, resolution) };
}

function publishComparisonRow(row: ComparisonRowDraft, resolution: Resolution) {
  const { itemKey, origin, sourceRefs, evidenceChecks, alternateObservations, ...content } = row;
  const override = overrideFor(resolution, "comparisons");
  const corrected = override === null ? content : { ...content, product: override.product, competitor: override.competitor };
  return { ...corrected, ...publishedProvenance(row, resolution) };
}

type PublishedRow = ReturnType<typeof publishComparisonRow>;
type PublishedComparison = Omit<ComparisonDraft, "rows"> & { readonly rows: readonly PublishedRow[] };

/**
 * A comparison with no rows left states nothing, so it is dropped rather than
 * published as a heading over an empty table.
 */
function comparisonsModule(module: GeoKnowledgeBodyV3["comparisons"], resolve: Resolve): ModuleOf<readonly PublishedComparison[]> {
  if (module.status === "unavailable") return module;
  const kept = module.value.flatMap((comparison) => {
    const rows = comparison.rows.flatMap((row) => {
      const resolution = resolve(row.itemKey);
      return resolution === null ? [] : [publishComparisonRow(row, resolution)];
    });
    return rows.length === 0 ? [] : [{ ...comparison, rows }];
  });
  if (module.value.length > 0 && kept.length === 0) return unavailable("owner_excluded_all");
  return withStatus(module, kept);
}

type PublishedScope = Readonly<Record<"does" | "doesNot" | "needsHuman" | "misconceptions", readonly ReturnType<typeof publishStatement>[]>>;

function scopeModule(module: GeoKnowledgeBodyV3["scope"], resolve: Resolve): ModuleOf<PublishedScope> {
  if (module.status === "unavailable") return module;
  const group = (statements: readonly StatementDraft[]) => statements.flatMap((item) => {
    const resolution = resolve(item.itemKey);
    return resolution === null ? [] : [publishStatement(item, resolution)];
  });
  const value: PublishedScope = {
    does: group(module.value.does),
    doesNot: group(module.value.doesNot),
    needsHuman: group(module.value.needsHuman),
    misconceptions: group(module.value.misconceptions),
  };
  const before = Object.values(module.value).reduce((sum, statements) => sum + statements.length, 0);
  const after = Object.values(value).reduce((sum, statements) => sum + statements.length, 0);
  if (before > 0 && after === 0) return unavailable("owner_excluded_all");
  return withStatus(module, value);
}

/** The four modules a model produces. All unavailable means the model step failed. */
const MODEL_MODULES = ["entity", "qa", "comparisons", "scope"] as const;

function factsModule(knowledge: GeoKnowledgeBodyV3, resolve: Resolve): ModuleOf<readonly ReturnType<typeof publishFact>[]> {
  const republished = republish(knowledge.facts, resolve, publishFact);
  if (republished.status === "unavailable") return republished;
  if (!MODEL_MODULES.every((name) => knowledge[name].status === "unavailable")) return republished;
  // Every model module failed, so what is left came from the profile and from
  // observed FAQ answers. If a synthesized fact survived from an earlier run
  // the sentence would be false, so it is not claimed.
  if (republished.value.some((fact) => fact.origin === "synthesized")) return republished;
  return { status: "partial", ...geoPartialLimitation([{ key: "facts_without_model" }]), value: republished.value };
}

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

interface CoverageRow {
  readonly id: string;
  readonly label: string;
  readonly status: "covered" | "partial" | "missing";
  readonly summary: string;
  readonly nextAction: string | null;
  readonly sourceRefs: readonly string[];
}

/**
 * Coverage rows point at some of the sources behind a section rather than all
 * of them: the catalogue holds up to 32 sources and a reference list up to 16.
 * They are a way in, not a claim of completeness -- the claims themselves cite
 * their own sources item by item.
 */
function capped(refs: readonly string[]): readonly string[] {
  return [...new Set(refs)].slice(0, GEO_KNOWLEDGE_LIMITS.sourceRefs);
}

function moduleRefs<T>(module: ModuleOf<T>, refs: (value: T) => readonly string[]): readonly string[] {
  return module.status === "unavailable" ? [] : capped(refs(module.value));
}

function coverageRow(id: string, label: string, module: ModuleOf<unknown>, sourceRefs: readonly string[]): CoverageRow {
  if (module.status === "available") return { id, label, status: "covered", summary: "Supported content is available.", nextAction: null, sourceRefs };
  if (module.status === "partial") return { id, label, status: "partial", summary: module.limitation, nextAction: COVERAGE_REVIEW_ACTION, sourceRefs };
  const excluded = COVERAGE_OWNER_EXCLUDED[module.reason];
  if (excluded !== undefined) return { id, label, status: "missing", summary: excluded.summary, nextAction: excluded.nextAction, sourceRefs };
  return { id, label, status: "missing", summary: COVERAGE_UNAVAILABLE, nextAction: COVERAGE_REVIEW_ACTION, sourceRefs };
}

/**
 * The question set is a derived output of the knowledge base, not a condition
 * of publishing it, so a version without one is publishable -- and says so
 * here, because the AI visibility check cannot run against such a version.
 */
function questionsRow(hasQuestionSet: boolean): CoverageRow {
  return hasQuestionSet
    ? { id: "coverage:questions", label: "Question set", status: "covered", summary: "A question set is published with this version.", nextAction: null, sourceRefs: [] }
    : {
      id: "coverage:questions",
      label: "Question set",
      status: "missing",
      summary: "This version has no question set, so AI visibility checks cannot run against it.",
      nextAction: "Update the knowledge base to produce a question set.",
      sourceRefs: [],
    };
}

interface ReviewedModules {
  readonly entity: ModuleOf<{ readonly sourceRefs: readonly string[]; readonly fields: readonly PublishedProvenance[] }>;
  readonly facts: ModuleOf<readonly PublishedProvenance[]>;
  readonly qa: ModuleOf<readonly PublishedProvenance[]>;
  readonly comparisons: ModuleOf<readonly { readonly sourceRefs: readonly string[]; readonly rows: readonly PublishedProvenance[] }[]>;
  readonly scope: ModuleOf<Readonly<Record<string, readonly PublishedProvenance[]>>>;
}

function evidenceRefs(module: GeoKnowledgeBodyV3["evidence"]): readonly string[] {
  return moduleRefs(module, (value) => GEO_EVIDENCE_GROUPS.flatMap((group) => value[group].flatMap((item) => item.sourceRefs)));
}

function machineRefs(module: GeoKnowledgeBodyV3["machine"]): readonly string[] {
  return moduleRefs(module, (value) => (
    [value.jsonLd, value.llms, value.robots, value.sitemap, value.hreflang, value.aiCrawlers, value.snippets]
      .flatMap((observation) => observation.sourceRefs)
  ));
}

/**
 * The v1 seven rows -- one per knowledge section -- plus one for the question
 * set, which a v3 version may legitimately not have.
 */
function coverageModule(reviewed: ReviewedModules, knowledge: GeoKnowledgeBodyV3, hasQuestionSet: boolean): ModuleOf<readonly CoverageRow[]> {
  const collected = (items: readonly PublishedProvenance[]) => items.flatMap((item) => item.sourceRefs);
  const rows: readonly CoverageRow[] = [
    coverageRow("coverage:entity", "Entity", reviewed.entity, moduleRefs(reviewed.entity, (value) => [...value.sourceRefs, ...collected(value.fields)])),
    coverageRow("coverage:facts", "Facts", reviewed.facts, moduleRefs(reviewed.facts, collected)),
    coverageRow("coverage:qa", "Q&A", reviewed.qa, moduleRefs(reviewed.qa, collected)),
    coverageRow("coverage:comparisons", "Comparisons", reviewed.comparisons, moduleRefs(reviewed.comparisons, (value) => (
      value.flatMap((comparison) => [...comparison.sourceRefs, ...collected(comparison.rows)])
    ))),
    coverageRow("coverage:scope", "Scope", reviewed.scope, moduleRefs(reviewed.scope, (value) => Object.values(value).flatMap(collected))),
    coverageRow("coverage:evidence", "Evidence", knowledge.evidence, evidenceRefs(knowledge.evidence)),
    coverageRow("coverage:machine", "Machine visibility", knowledge.machine, machineRefs(knowledge.machine)),
    questionsRow(hasQuestionSet),
  ];
  return rows.some((row) => row.status !== "covered")
    ? { status: "partial", ...geoPartialLimitation([{ key: "coverage_incomplete" }]), value: rows }
    : { status: "available", value: rows };
}

// ---------------------------------------------------------------------------
// counts
// ---------------------------------------------------------------------------

function items<T>(module: ModuleOf<readonly T[]>): readonly T[] {
  return module.status === "unavailable" ? [] : module.value;
}

/**
 * Every decision the pack publishes, across all modules. The pack contract
 * counts the same set and refuses a pack whose meta disagrees with its items,
 * so this walk and that one have to see the same things.
 */
function publishedDecisions(reviewed: ReviewedModules): readonly GeoPackDecision[] {
  const entity = reviewed.entity.status === "unavailable" ? [] : reviewed.entity.value.fields;
  const scope = reviewed.scope.status === "unavailable" ? [] : Object.values(reviewed.scope.value).flat();
  return [
    ...entity,
    ...items(reviewed.facts),
    ...items(reviewed.qa),
    ...items(reviewed.comparisons).flatMap((comparison) => comparison.rows),
    ...scope,
  ].map((item) => item.decision);
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export interface BuildGeoKnowledgePackV3Input {
  /** When this pack is assembled. Passed in: the assembler reads no clock. */
  readonly generatedAt: string;
  /** A v3 draft payload, parsed here so no caller can hand in a shape nobody checked. */
  readonly payload: unknown;
  /** The question set v2 published beside this pack, or null when there is none. */
  readonly questionSet: unknown | null;
  /** When publishing books the bulk acceptance of everything still pending. */
  readonly bulkAcceptedAt: string;
}

interface ParsedInputs {
  readonly payload: GeoKbPayloadV3;
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly hasQuestionSet: boolean;
}

function parseInputs(input: BuildGeoKnowledgePackV3Input): ParsedInputs {
  if (!canonicalTimestamp(input.generatedAt)) throw new Error("Invalid pack generation time");
  if (!canonicalTimestamp(input.bulkAcceptedAt)) throw new Error("Invalid bulk acceptance time");
  // The bulk acceptance happens as the pack is made, so a pack cannot claim to
  // have been generated before a decision it already carries.
  if (input.bulkAcceptedAt > input.generatedAt) throw new Error("Bulk acceptance follows the pack it is published in");
  const payload = parseGeoKbPayloadV3(input.payload);
  const knowledge = payload.knowledge;
  // Nothing was collected: no evidence catalogue, no scan time, no item. A pack
  // of eight unavailable modules would still be a published version asserting a
  // knowledge base exists, so such a draft is simply not publishable.
  if (knowledge === null) throw new Error("A v3 draft without collected knowledge cannot be published");
  if (input.questionSet === null) return { payload, knowledge, hasQuestionSet: false };
  // A question set is optional, but one that is present must be about the same
  // market -- otherwise the visibility check asks another country's questions
  // about this version.
  const questionSet = parseGeoQuestionSetV2(input.questionSet);
  const market = payload.generationInput.identity.market;
  if (questionSet.country !== market.country || questionSet.language !== market.language) {
    throw new Error("Question set market differs from the knowledge base");
  }
  return { payload, knowledge, hasQuestionSet: true };
}

/**
 * Assemble a publishable v2 knowledge pack from a v3 draft.
 *
 * Deterministic in its arguments: the same draft, question set and timestamps
 * always produce the same `contentHash`.
 */
export function buildGeoKnowledgePackV3(input: BuildGeoKnowledgePackV3Input): GeoKnowledgePackV2 {
  const { payload, knowledge, hasQuestionSet } = parseInputs(input);
  const resolve = reviewIndex(payload.review);
  const reviewed = {
    entity: entityModule(knowledge.entity, resolve),
    facts: factsModule(knowledge, resolve),
    qa: republish(knowledge.qa, resolve, publishQa),
    comparisons: comparisonsModule(knowledge.comparisons, resolve),
    scope: scopeModule(knowledge.scope, resolve),
  };
  const decisions = publishedDecisions(reviewed);
  const accepted = decisions.filter((decision) => decision === "accepted").length;
  const market = payload.generationInput.identity.market;
  return buildGeoKnowledgePackV2({
    schemaVersion: GEO_KNOWLEDGE_PACK_V2_SCHEMA,
    meta: {
      generatedAt: input.generatedAt,
      lastScanAt: knowledge.collectedAt,
      market: market.country,
      language: market.language,
      counts: {
        facts: items(reviewed.facts).length,
        qa: items(reviewed.qa).length,
        comparisons: items(reviewed.comparisons).length,
        accepted,
        acceptedInBulk: decisions.length - accepted,
      },
    },
    ...reviewed,
    // Collected, never reviewed: these carry no per-item decision, so they are
    // published exactly as observed. `evidence.collected` in particular passes
    // through untouched -- a group nobody looked for must not arrive looking
    // like a group that was looked for and found empty.
    evidence: knowledge.evidence,
    machine: knowledge.machine,
    coverage: coverageModule(reviewed, knowledge, hasQuestionSet),
    sourceCatalogue: knowledge.sourceCatalogue,
  });
}
