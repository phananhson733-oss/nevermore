// @input -- the own-site evidence receipt and the offsite collection of one run
// @output -- one v3 source catalogue plus the citation tests every item is held to
// @pos -- pure projection: no fetch, no clock, no store

/**
 * Two collectors produce evidence for one knowledge body, and they do not
 * agree on shape: the own-site receipt (`kb-knowledge-evidence.ts`) predates
 * third-party sources and carries no independence field at all, while the
 * offsite collector already emits v3 source rows. Joining them here, once,
 * keeps every module builder from re-deciding what a source is.
 *
 * The catalogue has a hard ceiling of 32 rows, and own-site rows are not
 * negotiable -- the machine module cites robots/sitemap/llms even when they are
 * unavailable, and dropping one would leave a dangling reference. So offsite
 * rows are what gets cut, in the order the collector ranked them, and the cut
 * is reported rather than absorbed: an evidence group whose pages were dropped
 * must not read as a group that found nothing.
 */
import type { GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import {
  GEO_KNOWLEDGE_LIMITS,
  geoLiteralsSupported,
  type GeoEvidenceCheck,
  type GeoKnowledgeSource,
} from "./kb-knowledge-shape.ts";

/**
 * What a *draft* item may claim. `owner_declared` is not one of them: an owner
 * correction lives in the review until publishing turns it into a declaration,
 * so a freshly assembled item can never carry that label.
 */
export type GeoDraftEvidenceCheck = Exclude<GeoEvidenceCheck, "owner_declared">;
import type { GeoOffsiteCollection } from "./kb-offsite-collect.ts";

/** One assertion an item makes, with the sources it makes it on. */
export interface GeoAssemblyClaim {
  readonly text: string;
  readonly sourceRefs: readonly string[];
}

export interface GeoSourceIndex {
  readonly catalogue: readonly GeoKnowledgeSource[];
  readonly byId: ReadonlyMap<string, GeoKnowledgeSource>;
  /** Offsite rows the ceiling cut. Anything citing one of these cannot be emitted. */
  readonly droppedSourceRefs: ReadonlySet<string>;
}

/** The own-site receipt's rows, widened to the v3 row that carries independence. */
function ownSiteSource(source: GeoKnowledgeEvidenceV1["sourceCatalogue"][number]): GeoKnowledgeSource {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    url: source.url,
    competitor: source.competitor,
    availability: source.availability,
    reason: source.reason,
    observedAt: source.observedAt,
    bodyHash: source.bodyHash,
    excerpts: [...source.excerpts],
    // Independence is a third-party judgement. An own page, a competitor page
    // and a robots file are not third-party sources, and labelling them
    // `undetermined` would put them in the same bucket as a media page nobody
    // could classify.
    independence: null,
  };
}

export function buildGeoSourceCatalogue(
  evidence: GeoKnowledgeEvidenceV1,
  offsite: GeoOffsiteCollection | null,
): GeoSourceIndex {
  const catalogue: GeoKnowledgeSource[] = evidence.sourceCatalogue.map(ownSiteSource);
  const taken = new Set(catalogue.map((source) => source.id));
  const dropped = new Set<string>();
  for (const source of offsite?.sources ?? []) {
    if (taken.has(source.id)) continue;
    if (catalogue.length >= GEO_KNOWLEDGE_LIMITS.sources) {
      dropped.add(source.id);
      continue;
    }
    catalogue.push(source);
    taken.add(source.id);
  }
  return { catalogue, byId: new Map(catalogue.map((source) => [source.id, source])), droppedSourceRefs: dropped };
}

function citedSources(refs: readonly string[], index: GeoSourceIndex): readonly GeoKnowledgeSource[] | null {
  const sources = refs.map((ref) => index.byId.get(ref));
  return sources.some((source) => source === undefined) ? null : sources as readonly GeoKnowledgeSource[];
}

/**
 * Whether an item may be published at all.
 *
 * The published pack refuses an item that cites a source nobody could read, and
 * refuses any claim asserting a number that occurs in none of its cited
 * excerpts. Both rules run at publish time, on the whole version at once, so an
 * item that fails either one does not degrade -- it makes the version
 * unpublishable. Deterministic items are therefore tested here, before they
 * enter the body, and dropped with a reason if they fail.
 */
export function geoItemIsCitable(
  refs: readonly string[],
  claims: readonly GeoAssemblyClaim[],
  index: GeoSourceIndex,
): boolean {
  const cited = citedSources(refs, index);
  if (cited === null || cited.length === 0) return false;
  if (cited.some((source) => source.availability === "unavailable")) return false;
  const excerpts = cited.flatMap((source) => source.excerpts);
  return claims.every((claim) => geoLiteralsSupported(claim.text, excerpts));
}

/**
 * What `cited_and_literals_match` is allowed to say about this item.
 *
 * The contract re-checks this on parse, so a wrong answer here is a thrown
 * payload rather than a mislabelled card -- which is the point. `not_applicable`
 * is the honest label for an item whose text nothing observed backs: an entity
 * field taken from the confirmed Profile, for instance, is a declaration, and
 * the pages cited beside it are context rather than proof.
 */
export function geoEvidenceCheckFor(
  refs: readonly string[],
  claims: readonly GeoAssemblyClaim[],
  index: GeoSourceIndex,
): GeoDraftEvidenceCheck {
  const cited = citedSources(refs, index);
  if (cited === null) return "not_applicable";
  if (!cited.some((source) => source.availability !== "unavailable" && source.excerpts.length > 0)) return "not_applicable";
  for (const claim of claims) {
    const claimSources = citedSources(claim.sourceRefs, index);
    if (claimSources === null) return "not_applicable";
    if (!geoLiteralsSupported(claim.text, claimSources.flatMap((source) => source.excerpts))) return "not_applicable";
  }
  return "cited_and_literals_match";
}

/** The most recent observation behind a set of citations, or null when none was observed. */
export function geoLatestObservedAt(refs: readonly string[], index: GeoSourceIndex): string | null {
  return refs
    .flatMap((ref) => index.byId.get(ref)?.observedAt ?? [])
    .sort()
    .at(-1) ?? null;
}

/**
 * The pages behind a set of citations. The merge compares these, not the
 * reference ids: "the same page" is what decides whether a changed claim is a
 * new observation of one fact or two pages disagreeing about it.
 */
export function geoSourcePages(refs: readonly string[], index: GeoSourceIndex): ReadonlySet<string> {
  return new Set(refs.flatMap((ref) => {
    const source = index.byId.get(ref);
    return source?.url === null || source === undefined ? [] : [source.url];
  }));
}

/** Own-site rows that were read, in catalogue order. */
export function geoReadableOwnPages(index: GeoSourceIndex): readonly GeoKnowledgeSource[] {
  return index.catalogue.filter((source) => source.kind === "own_page" && source.availability !== "unavailable");
}

/**
 * Extra citations that make a declared value's numbers observable. A brand name
 * or category from the Profile is not model output and is not checked by the
 * narrative, so the entity module can end up asserting a literal that appears
 * in none of the pages it cites -- which the published pack refuses.
 */
export function geoSupportingRefs(value: string, index: GeoSourceIndex, within: readonly string[]): readonly string[] {
  if (geoLiteralsSupported(value, within.flatMap((ref) => index.byId.get(ref)?.excerpts ?? []))) return [];
  for (const source of geoReadableOwnPages(index)) {
    if (within.includes(source.id)) continue;
    if (geoLiteralsSupported(value, source.excerpts)) return [source.id];
  }
  return [];
}
