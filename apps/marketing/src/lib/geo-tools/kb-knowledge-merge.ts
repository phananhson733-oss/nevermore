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
import {
  GEO_KB_V3_LIMITS,
  geoV3Items,
  parseGeoKbPayloadV3,
  type GeoDecision,
  type GeoKbPayloadV3,
  type GeoKnowledgeBodyV3,
  type GeoReviewV3,
  type GeoV3Item,
} from "./kb-v3-contract.ts";
import { geoSourcePages, type GeoSourceIndex } from "./kb-knowledge-assemble-sources.ts";

type DecisionRecord = GeoReviewV3["decisions"][number];
type Suppression = GeoReviewV3["suppressions"][number];
type ItemModule = GeoV3Item["module"];

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
}

export interface MergeGeoDraftV3Input {
  /** The freshly assembled draft, normally with an empty review. */
  readonly next: GeoKbPayloadV3;
  /** The draft being replaced, or null for a first update. */
  readonly previous: GeoKbPayloadV3 | null;
  /** The version `previous` was read at; recorded on decisions this merge revives. */
  readonly previousDraftVersion: string;
}

interface SideItem {
  readonly item: GeoV3Item;
  readonly contentHash: string;
  readonly pages: ReadonlySet<string>;
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
  return new Map(geoV3Items(knowledge).map((item) => [item.itemKey, {
    item,
    contentHash: hashes.get(item.itemKey) ?? "",
    pages: geoSourcePages(item.sourceRefs, index),
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

type MutableBody = {
  facts?: { value?: Record<string, unknown>[] };
  qa?: { value?: Record<string, unknown>[] };
  scope?: { value?: Record<string, Record<string, unknown>[]> };
  comparisons?: { value?: { competitor: { key: string }; rows: Record<string, unknown>[] }[] };
  entity?: { value?: { fields?: Record<string, unknown>[] } };
  sourceCatalogue: GeoKnowledgeSource[];
};

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
  readonly previous: SideItem;
  /** When the competing page was read. Carried so both observations keep their own time. */
  readonly previousObservedAt: string | null;
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
  const nextSummary = input.next.item.claims[0]?.text ?? "";
  const previousSummary = input.previous.item.claims[0]?.text ?? "";
  const merged = [...new Set([...input.next.item.sourceRefs, ...input.previous.item.sourceRefs])];
  if (merged.length > GEO_KNOWLEDGE_LIMITS.sourceRefs) return false;
  // `geoText` bounds an alternate at 800 code points, and a 1 200-point
  // definition cannot be shortened to fit without misquoting it.
  if ([nextSummary, previousSummary].some((summary) => summary.trim() === "" || Array.from(summary).length > 800)) return false;
  if (!adoptSources(input.body, input.previous.item.sourceRefs, input.previousSources)) return false;
  row.sourceRefs = merged;
  row.alternateObservations = [
    { summary: nextSummary, sourceRefs: [...input.next.item.sourceRefs], observedAt: observedAtOf(row) },
    { summary: previousSummary, sourceRefs: [...input.previous.item.sourceRefs], observedAt: input.previousObservedAt },
  ];
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
): boolean {
  const source = findRow(previous, itemKey);
  const item = geoV3Items(previous as unknown as GeoKnowledgeBodyV3).find((entry) => entry.itemKey === itemKey);
  if (source === null || item === undefined) return false;
  // An entity field's text lives in the module's value, not in its row, so a
  // revived row would address a field that is no longer there.
  if (item.module === "entity") return false;
  const target = itemLists(body).find((list) => list.scope === listScope(item));
  if (target === undefined || target.rows.length >= target.limit) return false;
  if (!adoptSources(body, item.sourceRefs, previousSources)) return false;
  target.rows.push(structuredClone(source));
  return true;
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
    const current: SideItem = { item, contentHash: nextHashes.get(item.itemKey) ?? "", pages: new Set() };
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
    const samePage = [...pages].some((page) => before.pages.has(page));
    if (samePage || mutable === null) {
      outcomes.push({ itemKey: item.itemKey, module: item.module, kind: "new_observation", similarTo: null });
      continue;
    }
    const applied = applyConflict({
      body: mutable,
      next: { ...current, pages },
      previous: before,
      previousObservedAt: previousBody === undefined ? null : observedAtOf(findRow(previousBody, item.itemKey) ?? {}),
      previousSources,
    });
    outcomes.push({
      itemKey: item.itemKey,
      module: item.module,
      kind: applied ? "conflicting" : "conflict_unrepresentable",
      similarTo: null,
    });
  }

  const present = new Set(geoV3Items(body).map((item) => item.itemKey));
  for (const record of decisions.values()) {
    if (present.has(record.itemKey)) continue;
    const item = previousItems.get(record.itemKey)?.item;
    const module: ItemModule = item?.module ?? "facts";
    if (record.override !== null && previousBody !== undefined && mutable !== null && carryForward(mutable, previousBody, record.itemKey, previousSources)) {
      merged.push(record);
      outcomes.push({ itemKey: record.itemKey, module, kind: "carried_declared", similarTo: null });
      continue;
    }
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
  return { payload, outcomes, evictedSuppressions: review.evicted };
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
