import {
  KeywordGovernanceSuggestionInputManifest,
  type KeywordGovernanceSuggestionInputManifest as SuggestionManifest,
  type KeywordGovernanceSuggestionStructuredOutput as StructuredOutput,
} from "@sf/contracts";
import { parseSafeKeywordGovernanceSuggestionOutput } from "@sf/artifacts";

export interface ResolveKeywordGovernanceSuggestionsInput {
  readonly manifest: unknown;
  readonly output: unknown;
  /** Stable identities are allocated by the caller, never by the model. */
  readonly suggestionIdsByKeywordId: Readonly<Record<string, string>>;
}

type StructuredSuggestion = StructuredOutput["suggestions"][number];

export interface ResolvedKeywordGovernanceSuggestion {
  readonly suggestionId: string;
  readonly ordinal: number;
  readonly keywordId: string;
  readonly expectedGovernanceRevision: number;
  readonly suggestionVersion: "keyword-governance-suggestion.v1";
  readonly status: StructuredSuggestion["status"];
  readonly intent: StructuredSuggestion["intent"];
  readonly buyerStage: string | null;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappingDecision: StructuredSuggestion["mappingDecision"];
  readonly mappedSitePageId: string | null;
  readonly reason: string;
  readonly intentAuthority:
    | "provider_observed"
    | "llm_generated"
    | "unavailable";
  readonly intentSnapshotId: string | null;
  readonly intentObservationId: string | null;
  readonly intentObservedAt: string | null;
}

function resolvedTopic(
  manifest: SuggestionManifest,
  topicKey: string | null,
) {
  if (topicKey === null) return null;
  const topic = manifest.topicAllowlist.find(
    (candidate) => candidate.topicKey === topicKey,
  );
  if (topic === undefined) {
    throw new Error("resolved Topic key was absent from the frozen allowlist");
  }
  return topic;
}

function resolvedPage(
  manifest: SuggestionManifest,
  pageKey: string | null,
) {
  if (pageKey === null) return null;
  const page = manifest.pageAllowlist.find(
    (candidate) => candidate.pageKey === pageKey,
  );
  if (page === undefined) {
    throw new Error("resolved Page key was absent from the frozen allowlist");
  }
  return page;
}

/**
 * Resolve only against the immutable allowlists. This function performs no
 * reads or writes, so callers can run it after the model request and before
 * opening the short persistence transaction.
 */
export function resolveKeywordGovernanceSuggestions(
  input: ResolveKeywordGovernanceSuggestionsInput,
): ResolvedKeywordGovernanceSuggestion[] {
  const manifest = KeywordGovernanceSuggestionInputManifest.parse(input.manifest);
  const output = parseSafeKeywordGovernanceSuggestionOutput(
    manifest,
    input.output,
  );
  const outputByKeywordKey = new Map(
    output.suggestions.map((suggestion) => [
      suggestion.keywordKey,
      suggestion,
    ]),
  );

  return manifest.candidates.map((candidate) => {
    const generated = outputByKeywordKey.get(candidate.keywordKey);
    if (generated === undefined) {
      throw new Error("validated output did not cover a frozen Keyword");
    }
    const suggestionId = input.suggestionIdsByKeywordId[candidate.keywordId];
    if (suggestionId === undefined) {
      throw new Error("caller did not allocate every suggestion identity");
    }

    const excluded = generated.status === "excluded";
    const topicKey = excluded
      ? null
      : (candidate.deterministicEvidence.currentTopicKey ?? generated.topicKey);
    const topic = resolvedTopic(manifest, topicKey);

    const currentPageKey = candidate.deterministicEvidence.currentPageKey;
    const mappingDecision = excluded
      ? "unassigned"
      : currentPageKey !== null
        ? "existing_page"
        : generated.mappingDecision;
    const pageKey =
      mappingDecision === "existing_page"
        ? (currentPageKey ?? generated.pageKey)
        : null;
    if (mappingDecision !== "unassigned" && topic === null) {
      throw new Error("final mapped suggestion requires a resolved Topic");
    }
    const page = resolvedPage(manifest, pageKey);

    const providerIntent =
      candidate.deterministicEvidence.providerSearchIntent;
    const intent = providerIntent?.value ?? generated.intent;
    const intentLineage =
      providerIntent !== null
        ? {
            authority: "provider_observed" as const,
            snapshotId: providerIntent.snapshotId,
            observationId: providerIntent.observationId,
            observedAt: providerIntent.observedAt,
          }
        : intent !== null
          ? {
              authority: "llm_generated" as const,
              snapshotId: null,
              observationId: null,
              observedAt: null,
            }
          : {
              authority: "unavailable" as const,
              snapshotId: null,
              observationId: null,
              observedAt: null,
            };

    return {
      suggestionId,
      ordinal: candidate.ordinal,
      keywordId: candidate.keywordId,
      expectedGovernanceRevision: candidate.expectedGovernanceRevision,
      suggestionVersion: "keyword-governance-suggestion.v1",
      status: generated.status,
      intent,
      buyerStage: generated.buyerStage,
      topicNodeId: topic?.topicNodeId ?? null,
      topicModelRevision: topic?.topicModelRevision ?? null,
      mappingDecision,
      mappedSitePageId: page?.sitePageId ?? null,
      reason: generated.reason,
      intentAuthority: intentLineage.authority,
      intentSnapshotId: intentLineage.snapshotId,
      intentObservationId: intentLineage.observationId,
      intentObservedAt: intentLineage.observedAt,
    };
  });
}
