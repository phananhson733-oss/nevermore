import { normalizeFirstPartyUrl } from "../first-party.ts";
import {
  isUrlOwnedByFirstPartySite,
  normalizeFirstPartySiteOrigin,
} from "../first-party-site.ts";
import type {
  ContentShadowCompetitorFact,
  ContentShadowContentPolicy,
  ContentShadowExternalResearchTarget,
  ContentShadowFirstPartyPageSnapshotIdentity,
  ContentShadowFrozenInput,
  ContentShadowInputManifest,
  ContentShadowKeywordFact,
  ContentShadowResearchContext,
} from "../types.ts";

/**
 * Canonical frozen-input manifest for a Content Shadow run (Slice 2 red line C).
 *
 * This module owns the ONE definition of the pinned tuple so the accepting
 * service and the worker's replay guard cannot drift: the service hashes this
 * manifest into `flow_shadow_runs.content_hash`, and the worker rebuilds the
 * same manifest from live rows and re-hashes it. Any divergence — a moved
 * Finding, a superseded brief revision, or an advanced adapter/prompt/projection
 * version — changes the hash and fails the run instead of silently re-rendering
 * under different inputs.
 *
 * Hashing itself lives with the caller (`contentHash` from `@sf/db`) so this
 * package stays database-independent and there is exactly one hash
 * implementation.
 */

/** Search identities and generative identities must never be the same set. */
export class ContentShadowObservationSeparationError extends Error {
  readonly code = "CONTENT_SHADOW_OBSERVATION_COLLAPSED";

  constructor(overlap: readonly string[]) {
    super(
      `search and generative observation must stay separate; shared entity ids: ${overlap.join(", ")}`,
    );
    this.name = "ContentShadowObservationSeparationError";
  }
}

export const CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS = Object.freeze({
  firstPartyPageSnapshots: 50,
  searchKeywordFacts: 500,
  generativeKeywordFacts: 500,
  competitorFacts: 50,
  externalTargets: 8,
  evidenceRefsPerKeyword: 50,
  policyItemsPerCategory: 100,
  textChars: 10_000,
});

/** A stable identity was repeated with two different frozen payloads. */
export class ContentShadowResearchContextConflictError extends Error {
  readonly code = "CONTENT_SHADOW_RESEARCH_CONTEXT_CONFLICT";

  constructor(collection: string, identity: string) {
    super(
      `${collection} contains conflicting values for stable identity ${identity}`,
    );
    this.name = "ContentShadowResearchContextConflictError";
  }
}

/** A research collection or value exceeded its deterministic safety ceiling. */
export class ContentShadowResearchContextBoundsError extends RangeError {
  readonly code = "CONTENT_SHADOW_RESEARCH_CONTEXT_BOUNDS";

  constructor(detail: string) {
    super(`research context exceeds its frozen-input bounds: ${detail}`);
    this.name = "ContentShadowResearchContextBoundsError";
  }
}

export class ContentShadowFirstPartyIdentityError extends RangeError {
  readonly code = "CONTENT_SHADOW_FIRST_PARTY_IDENTITY_INVALID";

  constructor() {
    super(
      "firstParty.siteOrigin must be an absolute http(s) origin with a dotted DNS hostname",
    );
    this.name = "ContentShadowFirstPartyIdentityError";
  }
}

/** A purported first-party PageSnapshot belongs to no host the site owns. */
export class ContentShadowFirstPartyPageOwnershipError extends RangeError {
  readonly code = "CONTENT_SHADOW_FIRST_PARTY_PAGE_OWNERSHIP_INVALID";

  constructor(pageSnapshotId: string) {
    super(
      `first-party PageSnapshot ${pageSnapshotId} URL must use firstParty.siteOrigin's exact hostname`,
    );
    this.name = "ContentShadowFirstPartyPageOwnershipError";
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function boundedText(
  value: string,
  label: string,
  maxChars: number = CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.textChars,
): string {
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new ContentShadowResearchContextBoundsError(
      `${label} exceeds ${maxChars} characters`,
    );
  }
  return trimmed;
}

function nullableText(
  value: string | null,
  label: string,
  maxChars: number = CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.textChars,
): string | null {
  if (value === null) return null;
  const normalized = boundedText(value, label, maxChars);
  return normalized.length === 0 ? null : normalized;
}

function canonicalStringSet(
  values: readonly string[],
  label: string,
  limit: number,
  itemChars: number = CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.textChars,
): readonly string[] {
  const normalized = values
    .map((value) => boundedText(value, label, itemChars))
    .filter((value) => value.length > 0);
  const result = [...new Set(normalized)].sort(compareText);
  if (result.length > limit) {
    throw new ContentShadowResearchContextBoundsError(
      `${label} contains ${result.length} items (maximum ${limit})`,
    );
  }
  return result;
}

function canonicalInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContentShadowResearchContextBoundsError(
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function canonicalCollection<T>(
  values: readonly T[],
  options: {
    readonly label: string;
    readonly limit: number;
    readonly normalize: (value: T) => T;
    readonly identity: (value: T) => string;
  },
): readonly T[] {
  const normalized = values.map(options.normalize);
  normalized.sort((left, right) =>
    compareText(options.identity(left), options.identity(right)),
  );
  const result: T[] = [];
  for (const value of normalized) {
    const identity = options.identity(value);
    const previous = result.at(-1);
    if (previous === undefined || options.identity(previous) !== identity) {
      result.push(value);
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      throw new ContentShadowResearchContextConflictError(
        options.label,
        identity,
      );
    }
  }
  if (result.length > options.limit) {
    throw new ContentShadowResearchContextBoundsError(
      `${options.label} contains ${result.length} items (maximum ${options.limit})`,
    );
  }
  return result;
}

function canonicalFirstPartyPageSnapshots(
  values: readonly ContentShadowFirstPartyPageSnapshotIdentity[],
): readonly ContentShadowFirstPartyPageSnapshotIdentity[] {
  return canonicalCollection(values, {
    label: "first-party page snapshots",
    limit: CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.firstPartyPageSnapshots,
    identity: (value) => value.pageSnapshotId,
    normalize: (value) => ({
      pageSnapshotId: boundedText(
        value.pageSnapshotId,
        "pageSnapshotId",
        500,
      ),
      dataSnapshotId: boundedText(
        value.dataSnapshotId,
        "dataSnapshotId",
        500,
      ),
      url: boundedText(value.url, "first-party page URL", 2_048),
      urlHash: boundedText(
        value.urlHash,
        "first-party page URL hash",
        64,
      ),
      contentHash: boundedText(
        value.contentHash,
        "first-party page content hash",
        64,
      ),
      capturedAt: boundedText(
        value.capturedAt,
        "first-party page capturedAt",
        100,
      ),
    }),
  });
}

function canonicalKeywordFacts(
  values: readonly ContentShadowKeywordFact[],
  label: "search keyword facts" | "generative keyword facts",
  limit: number,
): readonly ContentShadowKeywordFact[] {
  return canonicalCollection(values, {
    label,
    limit,
    identity: (value) => value.id,
    normalize: (value) => ({
      id: boundedText(value.id, `${label} id`, 500),
      display: boundedText(value.display, `${label} display`, 500),
      market: boundedText(value.market, `${label} market`, 32),
      language: boundedText(value.language, `${label} language`, 100),
      intent: nullableText(value.intent, `${label} intent`, 100),
      buyerStage: nullableText(
        value.buyerStage,
        `${label} buyer stage`,
        100,
      ),
      cluster: nullableText(value.cluster, `${label} cluster`, 200),
      mapping: {
        decision: value.mapping.decision,
        mappedSitePageId: nullableText(
          value.mapping.mappedSitePageId,
          `${label} mapped site page id`,
          500,
        ),
        reviewState: value.mapping.reviewState,
        revision: canonicalInteger(
          value.mapping.revision,
          `${label} mapping revision`,
        ),
      },
      lastSeen: boundedText(value.lastSeen, `${label} lastSeen`, 100),
      evidenceRefs: canonicalStringSet(
        value.evidenceRefs,
        `${label} evidence refs`,
        CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.evidenceRefsPerKeyword,
        500,
      ),
    }),
  });
}

function canonicalCompetitorFacts(
  values: readonly ContentShadowCompetitorFact[],
): readonly ContentShadowCompetitorFact[] {
  return canonicalCollection(values, {
    label: "competitor facts",
    limit: CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.competitorFacts,
    identity: (value) => value.id,
    normalize: (value) => ({
      id: boundedText(value.id, "competitor id", 500),
      domain: boundedText(
        value.domain,
        "competitor domain",
        253,
      ).toLowerCase(),
      name: nullableText(value.name, "competitor name", 160),
      status: value.status,
      relationship: value.relationship,
      scopes: canonicalStringSet(
        value.scopes,
        "competitor scopes",
        5,
        100,
      ) as ContentShadowCompetitorFact["scopes"],
      revision: canonicalInteger(value.revision, "competitor revision"),
    }),
  });
}

function canonicalExternalTargets(
  values: readonly ContentShadowExternalResearchTarget[],
): readonly ContentShadowExternalResearchTarget[] {
  return canonicalCollection(values, {
    label: "external targets",
    limit: CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.externalTargets,
    identity: (value) => value.ref,
    normalize: (value) => ({
      ref: boundedText(value.ref, "external target ref", 500),
      kind: boundedText(value.kind, "external target kind", 100),
      url: boundedText(value.url, "external target URL", 2_048),
      label: boundedText(value.label, "external target label", 500),
    }),
  });
}

function canonicalContentPolicy(
  policy: ContentShadowContentPolicy,
): ContentShadowContentPolicy {
  const limit =
    CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.policyItemsPerCategory;
  return {
    brandConstraints: canonicalStringSet(
      policy.brandConstraints,
      "brand constraints",
      limit,
    ),
    complianceConstraints: canonicalStringSet(
      policy.complianceConstraints,
      "compliance constraints",
      limit,
    ),
    prohibitedTerms: canonicalStringSet(
      policy.prohibitedTerms,
      "prohibited terms",
      limit,
    ),
    claimRestrictions: canonicalStringSet(
      policy.claimRestrictions,
      "claim restrictions",
      limit,
    ),
  };
}

function assertExactIdentitySet(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): void {
  if (JSON.stringify(sortedUnique(expected)) !== JSON.stringify(actual)) {
    throw new ContentShadowResearchContextConflictError(
      `${label} identities`,
      `expected [${sortedUnique(expected).join(", ")}], received [${actual.join(", ")}]`,
    );
  }
}

/**
 * Canonicalize every research collection before it enters the hash tuple.
 * Conflicting duplicates are rejected instead of choosing a caller-order
 * winner, which would make semantically identical requests hash differently.
 */
export function canonicalizeContentShadowResearchContext(
  context: ContentShadowResearchContext,
  identities: {
    readonly searchKeywordEntityIds: readonly string[];
    readonly generativeQueryEntityIds: readonly string[];
    readonly competitorEntityIds: readonly string[];
  },
): ContentShadowResearchContext {
  const searchKeywordFacts = canonicalKeywordFacts(
    context.searchKeywordFacts,
    "search keyword facts",
    CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.searchKeywordFacts,
  );
  const generativeKeywordFacts = canonicalKeywordFacts(
    context.generativeKeywordFacts,
    "generative keyword facts",
    CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.generativeKeywordFacts,
  );
  const competitorFacts = canonicalCompetitorFacts(context.competitorFacts);
  assertObservationSeparation(
    searchKeywordFacts.map((fact) => fact.id),
    generativeKeywordFacts.map((fact) => fact.id),
  );
  assertExactIdentitySet(
    "search keyword fact",
    identities.searchKeywordEntityIds,
    searchKeywordFacts.map((fact) => fact.id),
  );
  assertExactIdentitySet(
    "generative keyword fact",
    identities.generativeQueryEntityIds,
    generativeKeywordFacts.map((fact) => fact.id),
  );
  assertExactIdentitySet(
    "competitor fact",
    identities.competitorEntityIds,
    competitorFacts.map((fact) => fact.id),
  );
  return {
    firstPartyPageSnapshots: canonicalFirstPartyPageSnapshots(
      context.firstPartyPageSnapshots,
    ),
    searchKeywordFacts,
    generativeKeywordFacts,
    competitorFacts,
    externalTargets: canonicalExternalTargets(context.externalTargets),
    contentPolicy: canonicalContentPolicy(context.contentPolicy),
  };
}

/**
 * Invariant 8 guard. A SearchQuery entity and a GenerativeQuery entity are
 * different observations of different systems; collapsing them into one set
 * (and thus one implied volume) is forbidden, so an overlapping id is rejected
 * at the boundary rather than silently de-duplicated.
 */
export function assertObservationSeparation(
  keywordEntityIds: readonly string[],
  generativeQueryEntityIds: readonly string[],
): void {
  const search = new Set(keywordEntityIds);
  const overlap = sortedUnique(
    generativeQueryEntityIds.filter((id) => search.has(id)),
  );
  if (overlap.length > 0) {
    throw new ContentShadowObservationSeparationError(overlap);
  }
}

/** Build the canonical, order-stable manifest for the frozen input tuple. */
export function buildContentShadowInputManifest(
  input: ContentShadowFrozenInput,
): ContentShadowInputManifest {
  assertObservationSeparation(
    input.searchCluster.keywordEntityIds,
    input.generativeQueryEntityIds,
  );
  const competitorEntityIds = sortedUnique(input.competitorEntityIds);
  const searchKeywordEntityIds = sortedUnique(
    input.searchCluster.keywordEntityIds,
  );
  const generativeQueryEntityIds = sortedUnique(
    input.generativeQueryEntityIds,
  );
  const siteOrigin = normalizeFirstPartySiteOrigin(
    input.firstParty.siteOrigin,
  );
  if (siteOrigin === null) throw new ContentShadowFirstPartyIdentityError();
  const researchContext = canonicalizeContentShadowResearchContext(
    input.researchContext,
    {
      searchKeywordEntityIds,
      generativeQueryEntityIds,
      competitorEntityIds,
    },
  );
  for (const snapshot of researchContext.firstPartyPageSnapshots) {
    if (!isUrlOwnedByFirstPartySite(siteOrigin, snapshot.url)) {
      throw new ContentShadowFirstPartyPageOwnershipError(
        snapshot.pageSnapshotId,
      );
    }
  }
  return {
    primaryFindingId: input.primaryFindingId,
    sourceActionId: input.sourceActionId,
    sourceDiagnosticRunId: input.sourceDiagnosticRunId,
    contentBriefArtifactId: input.contentBriefArtifactId,
    contentBriefRevision: input.contentBriefRevision,
    competitorEntityIds,
    searchCluster: {
      clusterKey: input.searchCluster.clusterKey,
      keywordEntityIds: searchKeywordEntityIds,
    },
    generativeQueryEntityIds,
    // Normalized HERE, not by the callers. The accepting service and the
    // worker's replay guard hash this tuple independently, so a normalization
    // that lived in either of them would have to be written twice and would
    // fail every replay the moment the two spellings diverged.
    firstParty: {
      siteOrigin,
      icpPrimaryConversionUrl: normalizeFirstPartyUrl(
        input.firstParty.icpPrimaryConversionUrl,
      ),
    },
    // Copied field-by-field, never spread: the manifest is a closed tuple and a
    // caller-supplied extra key must not be able to ride into the hash.
    // Order is meaningful here (document order / normalized-keyword order), so
    // this is the one collection that is NOT sorted or de-duplicated again.
    contentBriefOutline: {
      briefSections: [...input.contentBriefOutline.briefSections],
      targetKeywords: [...input.contentBriefOutline.targetKeywords],
      pageAssignment: input.contentBriefOutline.pageAssignment,
    },
    researchContext,
    flowAdapterVersion: input.flowAdapterVersion,
    promptSetVersion: input.promptSetVersion,
    projectionVersion: input.projectionVersion,
    outputLocale: input.outputLocale,
  };
}
