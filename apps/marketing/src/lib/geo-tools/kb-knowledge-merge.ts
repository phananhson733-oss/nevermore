// @input -- a freshly assembled v3 draft and the draft it replaces
// @output -- one merged draft that keeps what the owner decided, plus an account of why
// @pos -- pure merge: no fetch, no clock, no store, no model call

/**
 * Section 4.4. An update re-observes the site; it must not re-ask the owner
 * everything they already answered, and it must never answer for them.
 *
 * Four rules, and the third and fourth are the ones that are easy to get wrong:
 *
 *  - same key, same content: the decision stands untouched.
 *  - same key, same page, changed content: the decision stands, and the item is
 *    left with a `baseContentHash` that no longer matches -- which is how the
 *    card knows to say "has a new observation" instead of quietly presenting an
 *    approval of text nobody has read.
 *  - same key, a *different* page, changed content: the two observations are
 *    carried side by side. A fact then withholds its value with
 *    `reason: "conflicting"` rather than picking a page as the winner, because
 *    picking one is how a knowledge base ends up stating two prices for one
 *    plan -- or the wrong one of them.
 *  - similar wording, different key: the owner is *prompted*, never inherited
 *    from. Two scope statements differing by one word score 0.9 easily, so
 *    inheriting an exclusion at that distance would make the other statement
 *    disappear without anyone deciding it should. Exclusions apply on the exact
 *    key alone.
 */
import {
  GEO_ITEM_SIMILARITY_PROMPT,
  geoItemSimilarity,
  type GeoItemKeyParts,
} from "./kb-item-identity.ts";
import { assertGeoItemKeyIntegrity } from "./kb-item-key.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { GEO_KNOWLEDGE_LIMITS, type GeoKnowledgeSource } from "./kb-knowledge-shape.ts";
import { geoPartialLimitation, type GeoLimitationClause } from "./kb-knowledge-limitation.ts";
import {
  GEO_KB_V3_LIMITS,
  geoV3Items,
  parseGeoKbPayloadV3,
  type GeoDecision,
  type GeoKbPayloadV3,
  type GeoKnowledgeBodyV3,
  type GeoReviewV3,
  type GeoOverrideV3,
  type GeoV3Item,
} from "./kb-v3-contract.ts";
import { geoSourcePages, type GeoSourceIndex } from "./kb-knowledge-assemble-sources.ts";

type DecisionRecord = GeoReviewV3["decisions"][number];
type Suppression = GeoReviewV3["suppressions"][number];
type ItemModule = GeoV3Item["module"];

/** `alternateObservationSchema` is capped at four in `kb-v3-contract.ts:194`. */
const GEO_MAX_ALTERNATE_OBSERVATIONS = 4;

/**
 * What a fact says once two pages disagree about it. Deliberately free of
 * numbers: the value is withheld, so quoting either page's figure in the
 * sentence would re-assert what the item is refusing to assert.
 */
export const GEO_CONFLICTING_FACT_STATEMENT =
  "Observed pages state different values for this fact; which one is current has not been resolved.";

export type GeoMergeOutcomeKind =
  | "new"
  | "unchanged"
  | "new_observation"
  | "conflicting"
  | "conflict_unrepresentable"
  | "suppressed"
  | "carried_declared"
  | "dropped"
  | "dropped_unmergeable";

/** A previous item this one may be a re-wording of. A prompt, never an inheritance. */
export interface GeoMergeSimilarity {
  readonly itemKey: string;
  readonly similarity: number;
  readonly decision: GeoDecision;
}

export interface GeoMergeOutcome {
  readonly itemKey: string;
  readonly module: ItemModule;
  readonly kind: GeoMergeOutcomeKind;
  readonly similarTo: GeoMergeSimilarity | null;
}

export interface GeoDraftMergeV3 {
  readonly payload: GeoKbPayloadV3;
  readonly outcomes: readonly GeoMergeOutcome[];
  /** Suppressions the contract's ceiling could not keep. Never silent. */
  readonly evictedSuppressions: readonly string[];
  /**
   * Owner corrections this merge could not carry into the new body, with the
   * text that was lost. Section 4.4 says a correction survives its observation,
   * so reaching this list is a defect somewhere -- but a defect the caller can
   * see and refuse on beats one that deletes the owner's own words and answers
   * 200. Today only an entity field can land here.
   */
  readonly droppedCorrections: readonly { readonly itemKey: string; readonly override: GeoOverrideV3 }[];
}

export interface MergeGeoDraftV3Input {
  /** The freshly assembled draft, normally with an empty review. */
  readonly next: GeoKbPayloadV3;
  /** The draft being replaced, or null for a first update. */
  readonly previous: GeoKbPayloadV3 | null;
  /** The version `previous` was read at; recorded on decisions this merge revives. */
  readonly previousDraftVersion: string;
}

/**
 * One thing one page said, kept apart from the others this item is holding open.
 *
 * The union of a conflict's citations is not a page any observation came from,
 * and comparing against the union is what let a re-observation of ONE of two
 * disagreeing pages count as "the same page" for the item as a whole -- and so
 * silently resolve the disagreement in favour of whichever page came back.
 */
interface Observation {
  readonly summary: string;
  readonly sourceRefs: readonly string[];
  readonly observedAt: string | null;
  readonly pages: ReadonlySet<string>;
}

/**
 * An item's observations: the ones it is holding open when it has any, and
 * otherwise the single one it is asserting.
 */
function observationsOf(
  item: GeoV3Item,
  row: Record<string, unknown> | undefined,
  index: GeoSourceIndex,
): readonly Observation[] {
  const alternates = row?.alternateObservations;
  if (Array.isArray(alternates) && alternates.length > 0) {
    return alternates.map((entry) => {
      const alternate = entry as { summary: string; sourceRefs: string[]; observedAt: string | null };
      return { ...alternate, pages: geoSourcePages(alternate.sourceRefs, index) };
    });
  }
  return [{
    summary: item.claims[0]?.text ?? "",
    sourceRefs: item.sourceRefs,
    observedAt: row === undefined ? null : observedAtOf(row),
    pages: geoSourcePages(item.sourceRefs, index),
  }];
}

interface SideItem {
  readonly item: GeoV3Item;
  readonly contentHash: string;
  readonly pages: ReadonlySet<string>;
  readonly observations: readonly Observation[];
}

function sourceIndex(knowledge: GeoKnowledgeBodyV3 | null): GeoSourceIndex {
  const catalogue = knowledge?.sourceCatalogue ?? [];
  return { catalogue, byId: new Map(catalogue.map((source) => [source.id, source])), droppedSourceRefs: new Set() };
}

function sideItems(knowledge: GeoKnowledgeBodyV3 | null): ReadonlyMap<string, SideItem> {
  const index = sourceIndex(knowledge);
  // The same digest the review handler files a decision against. Two
  // definitions of "the content this was decided on" would make every item look
  // rewritten forever.
  const hashes = geoV3ItemContentHashes(knowledge);
  const rows = new Map<string, Record<string, unknown>>();
  for (const list of itemLists(knowledge as unknown as MutableBody ?? { sourceCatalogue: [] })) {
    for (const row of list.rows) if (typeof row.itemKey === "string") rows.set(row.itemKey, row);
  }
  return new Map(geoV3Items(knowledge).map((item) => [item.itemKey, {
    item,
    contentHash: hashes.get(item.itemKey) ?? "",
    pages: geoSourcePages(item.sourceRefs, index),
    observations: observationsOf(item, rows.get(item.itemKey), index),
  }]));
}

/** The text two items are compared on when their keys differ: their identity, not their prose. */
function identityText(parts: GeoItemKeyParts): string | null {
  switch (parts.module) {
    case "facts": return [parts.subject, parts.attribute, ...parts.qualifiers].join(" ");
    case "qa": return parts.canonicalQuestion;
    case "comparisons": return parts.dimension;
    case "scope": return parts.statement;
    // Entity fields are addressed by name; wording cannot drift.
    case "entity": return null;
  }
}

/** Items only compete for the same identity inside one type, intent, rival or kind. */
function similarityBucket(parts: GeoItemKeyParts): string | null {
  switch (parts.module) {
    case "facts": return `facts:${parts.type}`;
    case "qa": return `qa:${parts.intent}`;
    case "comparisons": return `comparisons:${parts.competitorKey}`;
    case "scope": return `scope:${parts.kind}`;
    case "entity": return null;
  }
}

function findSimilar(
  item: GeoV3Item,
  previous: ReadonlyMap<string, SideItem>,
  decisions: ReadonlyMap<string, DecisionRecord>,
  suppressed: ReadonlySet<string>,
): GeoMergeSimilarity | null {
  const bucket = similarityBucket(item.identity);
  const text = identityText(item.identity);
  if (bucket === null || text === null) return null;
  let best: GeoMergeSimilarity | null = null;
  for (const [key, candidate] of previous) {
    if (similarityBucket(candidate.item.identity) !== bucket) continue;
    const decision = decisions.get(key)?.decision ?? (suppressed.has(key) ? "excluded" : "pending");
    // Only a decision worth inheriting is worth interrupting the owner about.
    if (decision === "pending") continue;
    const other = identityText(candidate.item.identity);
    if (other === null) continue;
    const similarity = geoItemSimilarity(text, other);
    if (similarity < GEO_ITEM_SIMILARITY_PROMPT) continue;
    if (best === null || similarity > best.similarity || (similarity === best.similarity && key < best.itemKey)) {
      best = { itemKey: key, similarity, decision };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// mutating the assembled body: conflicts and carried-forward corrections
// ---------------------------------------------------------------------------

type MutableModule<T> = { status?: string; limitation?: string; limitationKeys?: GeoLimitationClause[]; reason?: string; value?: T };
type MutableBody = {
  facts?: MutableModule<Record<string, unknown>[]>;
  qa?: MutableModule<Record<string, unknown>[]>;
  scope?: MutableModule<Record<string, Record<string, unknown>[]>>;
  comparisons?: MutableModule<{ competitor: { key: string; name?: string }; rows: Record<string, unknown>[] }[]>;
  entity?: MutableModule<{ fields?: Record<string, unknown>[] }>;
  sourceCatalogue: GeoKnowledgeSource[];
};

/**
 * What a module says when this update found nothing there but the owner's own
 * declaration is still standing in it. Composed through the shared clause table,
 * so it reaches the card as a key the reader can say in its own language.
 *
 * A function rather than a constant: the composed value holds an ARRAY, and the
 * merge writes it into several mutable module objects that are later serialized.
 * One shared array between them is an aliasing bug waiting for its first caller.
 */
const carriedOnlyLimitation = () => geoPartialLimitation([{ key: "carried_owner_declared_only" }]);

/** Every mutable item list the merge may write into, with the ceiling that governs it. */
function itemLists(body: MutableBody): readonly { readonly rows: Record<string, unknown>[]; readonly limit: number; readonly scope: string }[] {
  const lists: { rows: Record<string, unknown>[]; limit: number; scope: string }[] = [];
  if (body.facts?.value !== undefined) lists.push({ rows: body.facts.value, limit: GEO_KNOWLEDGE_LIMITS.facts, scope: "facts" });
  if (body.qa?.value !== undefined) lists.push({ rows: body.qa.value, limit: GEO_KNOWLEDGE_LIMITS.qa, scope: "qa" });
  for (const [kind, rows] of Object.entries(body.scope?.value ?? {})) {
    lists.push({ rows, limit: GEO_KNOWLEDGE_LIMITS.scopeItems, scope: `scope:${kind}` });
  }
  for (const comparison of body.comparisons?.value ?? []) {
    lists.push({ rows: comparison.rows, limit: GEO_KNOWLEDGE_LIMITS.comparisonRows, scope: `comparisons:${comparison.competitor.key}` });
  }
  if (body.entity?.value?.fields !== undefined) {
    lists.push({ rows: body.entity.value.fields, limit: 32, scope: "entity" });
  }
  return lists;
}

function findRow(body: MutableBody, itemKey: string): Record<string, unknown> | null {
  for (const list of itemLists(body)) {
    const row = list.rows.find((entry) => entry.itemKey === itemKey);
    if (row !== undefined) return row;
  }
  return null;
}

/**
 * Bring the pages a carried observation cites into this run's catalogue. The
 * ceiling is the contract's, and a citation that does not fit cannot be
 * carried: a reference to a source nobody can resolve is worse than an item
 * that says it could not be merged.
 */
function adoptSources(body: MutableBody, refs: readonly string[], from: ReadonlyMap<string, GeoKnowledgeSource>): boolean {
  const present = new Set(body.sourceCatalogue.map((source) => source.id));
  const missing = refs.filter((ref) => !present.has(ref));
  if (missing.some((ref) => !from.has(ref))) return false;
  if (body.sourceCatalogue.length + missing.length > GEO_KNOWLEDGE_LIMITS.sources) return false;
  for (const ref of missing) body.sourceCatalogue.push(from.get(ref) as GeoKnowledgeSource);
  return true;
}

interface ConflictInput {
  readonly body: MutableBody;
  readonly next: SideItem;
  /** The observations this run did not re-observe; each keeps its own time. */
  readonly unresolved: readonly Observation[];
  readonly previousSources: ReadonlyMap<string, GeoKnowledgeSource>;
}

/**
 * Record that two pages disagree, on one identity rather than two items. Two
 * items would each be reviewable, each be acceptable and each be published --
 * which is how a knowledge base states two prices for one plan.
 */
function applyConflict(input: ConflictInput): boolean {
  const row = findRow(input.body, input.next.item.itemKey);
  if (row === null) return false;
  const observations: Observation[] = [
    { summary: input.next.item.claims[0]?.text ?? "", sourceRefs: input.next.item.sourceRefs, observedAt: observedAtOf(row), pages: input.next.pages },
    ...input.unresolved,
  ];
  // The contract holds four observations at most. Dropping one to fit would
  // silently discard a page the owner has not ruled on, which is the whole
  // thing this branch exists to prevent, so the item says it could not be
  // represented instead.
  if (observations.length > GEO_MAX_ALTERNATE_OBSERVATIONS) return false;
  const merged = [...new Set(observations.flatMap((observation) => [...observation.sourceRefs]))];
  if (merged.length > GEO_KNOWLEDGE_LIMITS.sourceRefs) return false;
  // `geoText` bounds an alternate at 800 code points, and a 1 200-point
  // definition cannot be shortened to fit without misquoting it.
  if (observations.some(({ summary }) => summary.trim() === "" || Array.from(summary).length > 800)) return false;
  for (const observation of input.unresolved) {
    if (!adoptSources(input.body, observation.sourceRefs, input.previousSources)) return false;
  }
  row.sourceRefs = merged;
  row.alternateObservations = observations.map(({ summary, sourceRefs, observedAt }) => ({ summary, sourceRefs: [...sourceRefs], observedAt }));
  if (input.next.item.module === "facts") {
    row.value = null;
    row.reason = "conflicting";
    row.statement = GEO_CONFLICTING_FACT_STATEMENT;
  }
  return true;
}

function observedAtOf(row: Record<string, unknown>): string | null {
  return typeof row.observedAt === "string" ? row.observedAt : null;
}

/**
 * Put a corrected item back after its observation disappeared. The correction
 * never depended on the observation -- publishing turns it into the owner's own
 * declaration and demotes the page that used to carry it -- so losing the item
 * would lose an answer the owner gave.
 */
function carryForward(
  body: MutableBody,
  previous: MutableBody,
  itemKey: string,
  previousSources: ReadonlyMap<string, GeoKnowledgeSource>,
  decided: ReadonlySet<string>,
): boolean {
  const source = findRow(previous, itemKey);
  const item = geoV3Items(previous as unknown as GeoKnowledgeBodyV3).find((entry) => entry.itemKey === itemKey);
  if (source === null || item === undefined) return false;
  // An entity field's text lives in the module's value, not in its row, so a
  // revived row would address a field that is no longer there. This is the one
  // correction that cannot be carried; the caller reports it rather than
  // dropping it in silence.
  if (item.module === "entity") return false;
  if (!adoptSources(body, item.sourceRefs, previousSources)) return false;
  const target = reopenList(body, item, previous);
  if (target === null) return false;
  // At the ceiling, an owner's own words outrank a sentence a model wrote this
  // morning: drop an undecided generated row to make room. Never a decided one
  // -- that would trade one owner's answer for another's.
  if (target.rows.length >= target.limit) {
    const spare = target.rows.findIndex((row) => typeof row.itemKey === "string" && !decided.has(row.itemKey));
    if (spare < 0) return false;
    target.rows.splice(spare, 1);
  }
  target.rows.push(structuredClone(source));
  return true;
}

/**
 * The list a carried item belongs in, re-opening the module when this update
 * closed it.
 *
 * Section 4.4: "key 消失 → `declared_owner` 的修正条目保留（它本来就不依赖观察）".
 * A correction never rested on the observation, so a run that observed nothing
 * is not a reason to delete the owner's answer -- and a module holding only
 * that answer is exactly `partial`, which the contract already has and the card
 * already draws. Leaving the module `unavailable` is not an option that keeps
 * the decision either: `assertOverrideTargets` refuses a payload whose decision
 * names an item the body does not carry.
 */
function reopenList(
  body: MutableBody,
  item: GeoV3Item,
  previous: MutableBody,
): { rows: Record<string, unknown>[]; limit: number } | null {
  const scope = listScope(item);
  const existing = itemLists(body).find((list) => list.scope === scope);
  if (existing !== undefined) return existing;

  // `reason` is deleted rather than set to undefined: the module schemas are
  // strict, and a present key holding undefined is still a present key.
  const reopen = <T>(module: MutableModule<T> | undefined, value: T): MutableModule<T> => {
    const next: MutableModule<T> = { ...(module ?? {}), status: "partial", ...carriedOnlyLimitation(), value };
    delete next.reason;
    return next;
  };
  if (item.module === "facts") { body.facts = reopen(body.facts, []); }
  else if (item.module === "qa") { body.qa = reopen(body.qa, []); }
  else if (item.module === "scope") {
    body.scope = reopen(body.scope, body.scope?.value
      ?? { does: [], doesNot: [], needsHuman: [], misconceptions: [] });
  } else if (item.module === "comparisons") {
    // A comparison row cannot stand without the competitor it compares against,
    // and that identity lives on the parent entry in the draft being replaced.
    const key = (item.identity as { competitorKey: string }).competitorKey;
    const parent = (previous.comparisons?.value ?? []).find((entry) => entry.competitor.key === key);
    if (parent === undefined) return null;
    /*
     * The scope key here is per competitor (`comparisons:<key>`, `listScope`
     * below), so reaching this line means THIS COMPETITOR is missing -- not
     * that the module is closed. The other three modules have one scope each,
     * so for them `existing === undefined` really does mean "this update
     * observed nothing for this section" and the limitation is true. Saying it
     * about a comparisons module that came back holding other competitors would
     * tell the owner a run that did compare their site observed nothing, and
     * `status: "partial"` also forces the review card out of its folded summary.
     * So the module is only reopened when it did not survive this update at
     * all; a surviving module keeps whatever status it earned, and the carried
     * entry's own rows already say `declared_owner`.
     */
    const surviving = body.comparisons?.value !== undefined && body.comparisons.status !== "unavailable";
    const list = (surviving ? body.comparisons?.value : undefined) ?? [];
    // Checked before anything is written. The old order left the module
    // downgraded to "observed nothing" on a refusal that carried nothing.
    if (list.length >= GEO_KNOWLEDGE_LIMITS.comparisons) return null;
    if (!surviving) body.comparisons = reopen(body.comparisons, list);
    else body.comparisons = { ...body.comparisons, value: list };
    (body.comparisons.value as { competitor: { key: string }; rows: Record<string, unknown>[] }[])
      .push({ ...structuredClone(parent), rows: [] });
  } else return null;

  return itemLists(body).find((list) => list.scope === scope) ?? null;
}

function listScope(item: GeoV3Item): string {
  if (item.module === "scope") return `scope:${(item.identity as { kind: string }).kind}`;
  if (item.module === "comparisons") return `comparisons:${(item.identity as { competitorKey: string }).competitorKey}`;
  return item.module;
}

// ---------------------------------------------------------------------------
// the merge itself
// ---------------------------------------------------------------------------

function reviveSuppression(itemKey: string, contentHash: string, suppressedAt: string, baseDraftVersion: string): DecisionRecord {
  return {
    itemKey,
    decision: "excluded",
    override: null,
    baseContentHash: contentHash,
    // The owner decided this when they excluded it, not now: a merge that
    // re-dated the decision would make an old exclusion look like today's.
    decidedAt: suppressedAt,
    baseDraftVersion,
  };
}

export function mergeGeoDraftV3(input: MergeGeoDraftV3Input): GeoDraftMergeV3 {
  const next = parseGeoKbPayloadV3(input.next);
  const previous = input.previous === null ? null : parseGeoKbPayloadV3(input.previous);
  const body = structuredClone(next.knowledge) as GeoKnowledgeBodyV3 | null;
  const mutable = body as unknown as MutableBody | null;
  const previousItems = sideItems(previous?.knowledge ?? null);
  const previousBody = previous?.knowledge as unknown as MutableBody | undefined;
  const previousSources = new Map((previous?.knowledge?.sourceCatalogue ?? []).map((source) => [source.id, source]));
  // The draft being replaced decides first; a review already sitting on the
  // freshly assembled draft is a lower-priority seed rather than a rival.
  const decisions = new Map([
    ...next.review.decisions.map((record) => [record.itemKey, record] as const),
    ...(previous?.review.decisions ?? []).map((record) => [record.itemKey, record] as const),
  ]);
  const suppressions = new Map([
    ...next.review.suppressions.map((record) => [record.itemKey, record] as const),
    ...(previous?.review.suppressions ?? []).map((record) => [record.itemKey, record] as const),
  ]);
  const nextIndex = sourceIndex(next.knowledge);
  const nextHashes = geoV3ItemContentHashes(next.knowledge);
  const outcomes: GeoMergeOutcome[] = [];
  const merged: DecisionRecord[] = [];
  const revived = new Set<string>();

  for (const item of geoV3Items(body)) {
    const current: SideItem = { item, contentHash: nextHashes.get(item.itemKey) ?? "", pages: new Set(), observations: [] };
    const before = previousItems.get(item.itemKey);
    const record = decisions.get(item.itemKey);
    const suppression = suppressions.get(item.itemKey);
    if (before === undefined) {
      if (suppression !== undefined) {
        revived.add(item.itemKey);
        merged.push(reviveSuppression(item.itemKey, current.contentHash, suppression.suppressedAt, input.previousDraftVersion));
        outcomes.push({ itemKey: item.itemKey, module: item.module, kind: "suppressed", similarTo: null });
        continue;
      }
      outcomes.push({
        itemKey: item.itemKey,
        module: item.module,
        kind: "new",
        similarTo: findSimilar(item, previousItems, decisions, new Set(suppressions.keys())),
      });
      continue;
    }
    if (record !== undefined) merged.push(record);
    else if (suppression !== undefined) {
      revived.add(item.itemKey);
      merged.push(reviveSuppression(item.itemKey, current.contentHash, suppression.suppressedAt, input.previousDraftVersion));
    }
    if (before.contentHash === current.contentHash) {
      outcomes.push({ itemKey: item.itemKey, module: item.module, kind: "unchanged", similarTo: null });
      continue;
    }
    const pages = geoSourcePages(item.sourceRefs, nextIndex);
    // What this run did NOT re-observe. An item holding two disagreeing pages
    // is holding a question only the owner can answer, and re-reading one of
    // those pages answers nothing about the other: overlapping with one cited
    // page does not establish that the other observation was resolved. Before
    // this was per-observation it was measured against the union of a
    // conflict's citations, so re-observing either page made the item look
    // "same page" as a whole and the raw body -- one price, picked by whichever
    // page came back -- replaced the withheld value with no owner decision.
    const unresolved = before.observations.filter((observation) =>
      ![...pages].some((page) => observation.pages.has(page)));
    if (unresolved.length === 0 || mutable === null) {
      outcomes.push({ itemKey: item.itemKey, module: item.module, kind: "new_observation", similarTo: null });
      continue;
    }
    const applied = applyConflict({ body: mutable, next: { ...current, pages }, unresolved, previousSources });
    outcomes.push({
      itemKey: item.itemKey,
      module: item.module,
      kind: applied ? "conflicting" : "conflict_unrepresentable",
      similarTo: null,
    });
  }

  const present = new Set(geoV3Items(body).map((item) => item.itemKey));
  // Which keys the owner has spoken for, so the ceiling never evicts one of
  // them to make room for another.
  const decided = new Set([...decisions.keys(), ...suppressions.keys()]);
  const droppedCorrections: { itemKey: string; override: GeoOverrideV3 }[] = [];
  for (const record of decisions.values()) {
    if (present.has(record.itemKey)) continue;
    const item = previousItems.get(record.itemKey)?.item;
    const module: ItemModule = item?.module ?? "facts";
    if (record.override !== null && previousBody !== undefined && mutable !== null
      && carryForward(mutable, previousBody, record.itemKey, previousSources, decided)) {
      merged.push(record);
      outcomes.push({ itemKey: record.itemKey, module, kind: "carried_declared", similarTo: null });
      continue;
    }
    if (record.override !== null) droppedCorrections.push({ itemKey: record.itemKey, override: record.override });
    outcomes.push({
      itemKey: record.itemKey,
      module,
      kind: record.override === null ? "dropped" : "dropped_unmergeable",
      similarTo: null,
    });
  }

  // Every exclusion ever made, including those whose item has just disappeared:
  // that is what stops the next update from quietly handing one back.
  // A revived exclusion is filed against the item as it ends up, conflicts
  // included; only decisions the owner actually made keep their original basis.
  const finalHashes = geoV3ItemContentHashes(body);
  const settled = merged.map((record) => revived.has(record.itemKey)
    ? { ...record, baseContentHash: finalHashes.get(record.itemKey) ?? record.baseContentHash }
    : record);
  const review = buildReview(settled, [...decisions.values()], suppressions);
  const payload = parseGeoKbPayloadV3({ ...next, knowledge: body, review: review.review });
  assertGeoItemKeyIntegrity(geoV3Items(payload.knowledge));
  return { payload, outcomes, evictedSuppressions: review.evicted, droppedCorrections };
}

/**
 * The review that survives the update: every decision whose item is still here,
 * and every exclusion ever made. An exclusion outlives its item on purpose --
 * that is what stops the next update from quietly handing back something the
 * owner threw out.
 */
function buildReview(
  decisions: readonly DecisionRecord[],
  exclusions: readonly DecisionRecord[],
  suppressions: ReadonlyMap<string, Suppression>,
): { readonly review: GeoReviewV3; readonly evicted: readonly string[] } {
  const kept = new Map<string, Suppression>(suppressions);
  for (const record of [...exclusions, ...decisions]) {
    // The owner excluded it when they excluded it. This merge reads no clock:
    // stamping today would make every old exclusion look like a fresh one.
    if (record.decision === "excluded" && !kept.has(record.itemKey)) {
      kept.set(record.itemKey, { itemKey: record.itemKey, suppressedAt: record.decidedAt });
    }
  }
  const ordered = [...kept.values()].sort((left, right) =>
    left.suppressedAt === right.suppressedAt ? left.itemKey.localeCompare(right.itemKey) : left.suppressedAt.localeCompare(right.suppressedAt));
  const overflow = Math.max(0, ordered.length - GEO_KB_V3_LIMITS.suppressions);
  return {
    review: {
      decisions: decisions.slice(0, GEO_KB_V3_LIMITS.decisions),
      // Newest survive the ceiling: an exclusion made today is the one the
      // owner is most likely to notice coming back.
      suppressions: ordered.slice(overflow),
    },
    evicted: ordered.slice(0, overflow).map((record) => record.itemKey),
  };
}
