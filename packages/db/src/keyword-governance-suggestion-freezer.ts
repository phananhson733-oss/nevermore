import {
  KeywordGovernanceSuggestionInputManifest,
  type KeywordGovernanceSuggestionInputManifest as SuggestionManifest,
} from "@sf/contracts";
import { contentHash, type CanonicalValue } from "./hash.ts";

export const KEYWORD_GOVERNANCE_SUGGESTION_CANONICAL_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

export const MAX_FROZEN_KEYWORD_GOVERNANCE_SUGGESTION_CANDIDATES = 100;

type KeywordStatus = "candidate" | "approved" | "excluded" | "parked";
type KeywordQueryKind = "search_query" | "generative_query";
type KeywordReviewOrigin =
  | "user"
  | "system_suggestion"
  | "migration_baseline";

export interface KeywordGovernanceSuggestionProductProfileAuthority {
  readonly state: "confirmed" | "draft";
  readonly productProfileId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly facts: SuggestionManifest["confirmedProductProfile"]["facts"];
}

export interface KeywordGovernanceSuggestionTopicAuthority {
  readonly state: "confirmed" | "draft";
  readonly topicModelRevisionId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly topics: readonly {
    readonly topicNodeId: string;
    readonly label: string;
  }[];
}

export interface KeywordGovernanceSuggestionPageAuthority {
  readonly sitePageId: string;
  readonly normalizedUrl: string;
  readonly title: string;
  readonly owned: boolean;
}

export interface KeywordGovernanceSuggestionOccurrenceAuthority {
  readonly occurrenceId: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly valid: boolean;
  readonly sourceKind: string;
  readonly providerSearchIntent: {
    readonly value: string;
    readonly snapshotId: string;
    readonly observationId: string;
    readonly observedAt: string;
  } | null;
}

export interface KeywordGovernanceSuggestionCandidateAuthority {
  readonly keywordId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly queryKind: KeywordQueryKind;
  readonly status: KeywordStatus;
  readonly reviewState: "unreviewed" | "confirmed";
  readonly reviewOrigin: KeywordReviewOrigin | null;
  /** Historical user governance excludes the row even if its projection moved. */
  readonly hasHumanDecision: boolean;
  readonly governanceRevision: number;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappedSitePageId: string | null;
  readonly occurrences: readonly KeywordGovernanceSuggestionOccurrenceAuthority[];
}

export interface KeywordGovernanceSuggestionFreezeInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly primaryMarketCode: string;
  readonly primaryLanguageTag: string;
  readonly confirmedProductProfile:
    | KeywordGovernanceSuggestionProductProfileAuthority
    | null;
  readonly confirmedTopicModel:
    | KeywordGovernanceSuggestionTopicAuthority
    | null;
  readonly pages: readonly KeywordGovernanceSuggestionPageAuthority[];
  readonly keywords: readonly KeywordGovernanceSuggestionCandidateAuthority[];
}

export interface FrozenKeywordGovernanceSuggestionInput {
  readonly manifest: SuggestionManifest;
  /** sha256(canonicalJson(manifest)); never embedded back into the manifest. */
  readonly inputHash: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function eligibleOccurrences(
  keyword: KeywordGovernanceSuggestionCandidateAuthority,
  input: KeywordGovernanceSuggestionFreezeInput,
): KeywordGovernanceSuggestionOccurrenceAuthority[] {
  return keyword.occurrences
    .filter(
      (occurrence) =>
        occurrence.valid &&
        occurrence.marketCode === input.marketCode &&
        occurrence.languageTag === input.languageTag,
    )
    .sort((left, right) => compareText(left.occurrenceId, right.occurrenceId));
}

function isEligible(
  keyword: KeywordGovernanceSuggestionCandidateAuthority,
  input: KeywordGovernanceSuggestionFreezeInput,
): boolean {
  return (
    keyword.status === "candidate" &&
    keyword.reviewState === "unreviewed" &&
    keyword.reviewOrigin === null &&
    !keyword.hasHumanDecision &&
    keyword.queryKind === "search_query" &&
    keyword.marketCode === input.marketCode &&
    keyword.languageTag === input.languageTag &&
    eligibleOccurrences(keyword, input).length > 0
  );
}

function latestProviderIntent(
  occurrences: readonly KeywordGovernanceSuggestionOccurrenceAuthority[],
): KeywordGovernanceSuggestionOccurrenceAuthority["providerSearchIntent"] {
  const canonicalIntents = new Set<string>(
    KEYWORD_GOVERNANCE_SUGGESTION_CANONICAL_INTENTS,
  );
  for (const occurrence of occurrences) {
    if (occurrence.providerSearchIntent === null) continue;
    if (occurrence.sourceKind !== "dataforseo_ranked") {
      throw new Error("provider intent requires exact DataForSEO authority");
    }
    if (!canonicalIntents.has(occurrence.providerSearchIntent.value)) {
      throw new Error("provider intent is outside the canonical vocabulary");
    }
  }
  const observed = occurrences
    .filter(
      (occurrence) =>
        occurrence.sourceKind === "dataforseo_ranked" &&
        occurrence.providerSearchIntent !== null,
    )
    .sort((left, right) => {
      const byTime = compareText(
        right.providerSearchIntent!.observedAt,
        left.providerSearchIntent!.observedAt,
      );
      return byTime !== 0
        ? byTime
        : compareText(
            left.providerSearchIntent!.observationId,
            right.providerSearchIntent!.observationId,
          );
    });
  return observed[0]?.providerSearchIntent ?? null;
}

function orderedCandidates(
  input: KeywordGovernanceSuggestionFreezeInput,
): KeywordGovernanceSuggestionCandidateAuthority[] {
  return input.keywords.filter((keyword) => isEligible(keyword, input)).sort(
    (left, right) =>
      compareText(left.normalizedKeyword, right.normalizedKeyword) ||
      compareText(left.displayKeyword, right.displayKeyword) ||
      compareText(left.keywordId, right.keywordId),
  );
}

function boundedAuthorityIds(
  requiredIds: ReadonlySet<string>,
  allIds: readonly string[],
): Set<string> {
  const selected = [...requiredIds].sort(compareText);
  for (const id of allIds) {
    if (selected.length >= 100) break;
    if (!requiredIds.has(id)) selected.push(id);
  }
  if (selected.length > 100) {
    throw new RangeError("frozen authority allowlist must contain at most 100 items");
  }
  return new Set(selected);
}

/**
 * Pure freezer. Callers perform all database reads before invoking this
 * function and persist the returned envelope before making a network call.
 */
export function freezeKeywordGovernanceSuggestionInput(
  input: KeywordGovernanceSuggestionFreezeInput,
): FrozenKeywordGovernanceSuggestionInput {
  if (input.marketCode !== input.primaryMarketCode) {
    throw new Error("suggestion market must equal the Project primary market");
  }
  if (input.languageTag !== input.primaryLanguageTag) {
    throw new Error("suggestion language must equal the Project primary language");
  }
  if (
    input.confirmedProductProfile === null ||
    input.confirmedProductProfile.state !== "confirmed"
  ) {
    throw new Error("a confirmed Product Profile is required");
  }
  if (
    input.confirmedTopicModel === null ||
    input.confirmedTopicModel.state !== "confirmed"
  ) {
    throw new Error("a confirmed Topic Model is required");
  }

  const candidates = orderedCandidates(input);
  if (candidates.length === 0) {
    throw new Error("at least one eligible Keyword occurrence is required");
  }
  if (candidates.length > MAX_FROZEN_KEYWORD_GOVERNANCE_SUGGESTION_CANDIDATES) {
    throw new RangeError("a frozen suggestion batch may contain at most 100 candidates");
  }

  const topicById = new Map(
    input.confirmedTopicModel.topics.map((topic) => [topic.topicNodeId, topic]),
  );
  if (topicById.size !== input.confirmedTopicModel.topics.length) {
    throw new Error("confirmed Topic Model contains duplicate Topic identities");
  }
  const ownedPages = input.pages.filter((page) => page.owned);
  const pageById = new Map(ownedPages.map((page) => [page.sitePageId, page]));
  if (pageById.size !== ownedPages.length) {
    throw new Error("owned Page inventory contains duplicate Page identities");
  }

  const requiredTopicIds = new Set<string>();
  const requiredPageIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.topicNodeId !== null) {
      if (
        candidate.topicModelRevision !== input.confirmedTopicModel.revision ||
        !topicById.has(candidate.topicNodeId)
      ) {
        throw new Error(
          "current Topic must resolve in the exact confirmed Topic revision",
        );
      }
      requiredTopicIds.add(candidate.topicNodeId);
    } else if (candidate.topicModelRevision !== null) {
      throw new Error("current Topic identity and revision must agree");
    }
    if (candidate.mappedSitePageId !== null) {
      if (candidate.topicNodeId === null) {
        throw new Error(
          "current mapped Page requires exact current Topic authority",
        );
      }
      if (!pageById.has(candidate.mappedSitePageId)) {
        throw new Error("current mapped Page must resolve to an exact owned Page");
      }
      requiredPageIds.add(candidate.mappedSitePageId);
    }
  }

  const sortedTopics = [...input.confirmedTopicModel.topics].sort(
    (left, right) =>
      compareText(left.label, right.label) ||
      compareText(left.topicNodeId, right.topicNodeId),
  );
  const topicIds = boundedAuthorityIds(
    requiredTopicIds,
    sortedTopics.map((topic) => topic.topicNodeId),
  );
  const selectedTopics = sortedTopics.filter((topic) =>
    topicIds.has(topic.topicNodeId),
  );
  const topicKeyById = new Map(
    selectedTopics.map((topic, index) => [topic.topicNodeId, `topic-${index + 1}`]),
  );

  const sortedPages = [...ownedPages].sort(
    (left, right) =>
      compareText(left.normalizedUrl, right.normalizedUrl) ||
      compareText(left.sitePageId, right.sitePageId),
  );
  const pageIds = boundedAuthorityIds(
    requiredPageIds,
    sortedPages.map((page) => page.sitePageId),
  );
  const selectedPages = sortedPages.filter((page) => pageIds.has(page.sitePageId));
  const pageKeyById = new Map(
    selectedPages.map((page, index) => [page.sitePageId, `page-${index + 1}`]),
  );

  const profile = input.confirmedProductProfile;
  const topicModel = input.confirmedTopicModel;
  const manifest = KeywordGovernanceSuggestionInputManifest.parse({
    schemaVersion: "keyword-governance-suggestion-input.v1",
    generationVersion: "keyword-governance-suggestion-generation.v1",
    promptSetVersion: "keyword-governance-suggestion.prompt.v1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    confirmedProductProfile: {
      productProfileId: profile.productProfileId,
      version: profile.version,
      contentHash: profile.contentHash,
      facts: profile.facts,
    },
    confirmedTopicModel: {
      topicModelRevisionId: topicModel.topicModelRevisionId,
      revision: topicModel.revision,
      contentHash: topicModel.contentHash,
    },
    topicAllowlist: selectedTopics.map((topic) => ({
      topicKey: topicKeyById.get(topic.topicNodeId)!,
      topicNodeId: topic.topicNodeId,
      topicModelRevision: topicModel.revision,
      label: topic.label,
    })),
    pageAllowlist: selectedPages.map((page) => ({
      pageKey: pageKeyById.get(page.sitePageId)!,
      sitePageId: page.sitePageId,
      normalizedUrl: page.normalizedUrl,
      title: page.title,
    })),
    candidates: candidates.map((candidate, index) => {
      const occurrences = eligibleOccurrences(candidate, input);
      return {
        ordinal: index + 1,
        keywordKey: `keyword-${index + 1}`,
        keywordId: candidate.keywordId,
        queryKind: "search_query",
        expectedGovernanceRevision: candidate.governanceRevision,
        displayKeyword: candidate.displayKeyword,
        normalizedKeyword: candidate.normalizedKeyword,
        deterministicEvidence: {
          sourceOccurrenceIds: [
            ...new Set(occurrences.map((occurrence) => occurrence.occurrenceId)),
          ],
          providerSearchIntent: latestProviderIntent(occurrences),
          currentTopicKey:
            candidate.topicNodeId === null
              ? null
              : topicKeyById.get(candidate.topicNodeId)!,
          currentPageKey:
            candidate.mappedSitePageId === null
              ? null
              : pageKeyById.get(candidate.mappedSitePageId)!,
        },
      };
    }),
  });

  return {
    manifest,
    inputHash: contentHash(manifest as unknown as CanonicalValue),
  };
}
