import type {
  ContentShadowFrozenInput,
  ContentShadowInputManifest,
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
 * package stays dependency-free and there is exactly one hash implementation.
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

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
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
  return {
    primaryFindingId: input.primaryFindingId,
    sourceActionId: input.sourceActionId,
    sourceDiagnosticRunId: input.sourceDiagnosticRunId,
    contentBriefArtifactId: input.contentBriefArtifactId,
    contentBriefRevision: input.contentBriefRevision,
    competitorEntityIds: sortedUnique(input.competitorEntityIds),
    searchCluster: {
      clusterKey: input.searchCluster.clusterKey,
      keywordEntityIds: sortedUnique(input.searchCluster.keywordEntityIds),
    },
    generativeQueryEntityIds: sortedUnique(input.generativeQueryEntityIds),
    flowAdapterVersion: input.flowAdapterVersion,
    promptSetVersion: input.promptSetVersion,
    projectionVersion: input.projectionVersion,
    outputLocale: input.outputLocale,
  };
}
