// @input  -- serializable keyword candidates, provider rows, coverage reads, SERP samples, and interpretations
// @output -- deterministic stage snapshots shared by synchronous and durable keyword execution
// @pos    -- pure projection layer; no network, cookies, provider clients, clocks, or mutable run accumulators
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildKeywordCoverageIndex,
  keywordTokens,
  keywordValidationFor,
  keywordVolumeKey,
  observeKeywordCoverage,
  resolveKeywordValidations,
  type KeywordCoverageObservation,
  type KeywordCoveragePage,
  type KeywordCoverageRead,
  type KeywordOpportunityProviderIntent,
  type KeywordOpportunityProviderRow,
  type KeywordOpportunityValidation,
} from "@sf/public-tools";
import { normalizeRdapDomain, normalizeTrafficDomain } from "@sf/sources";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import type {
  KeywordSerpInterpretation,
  KeywordSerpInterpretationInput,
} from "./keyword-prompts.ts";

export interface KeywordCandidatePlan {
  readonly generated: number;
  readonly candidates: readonly KeywordCandidateDraft[];
}

export interface KeywordCoverageSnapshot {
  readonly keyword: string;
  readonly coverage: KeywordCoverageObservation;
}

export interface KeywordPricedCandidate {
  readonly candidate: KeywordCandidateDraft;
  readonly validation: KeywordOpportunityValidation;
  readonly coverage: KeywordCoverageObservation;
}

export interface KeywordEnrichmentTargets {
  readonly organicDomains: readonly string[];
  readonly trafficDomains: readonly string[];
  readonly registrationDomains: readonly string[];
  readonly siteDomain: string | null;
  readonly rankTargets: readonly string[];
}

const PROVIDER_INTENTS: ReadonlySet<KeywordOpportunityProviderIntent> = new Set(
  ["informational", "navigational", "commercial", "transactional"],
);

function providerIntent(
  value: string | null,
): KeywordOpportunityProviderIntent | null {
  return value !== null &&
    PROVIDER_INTENTS.has(value as KeywordOpportunityProviderIntent)
    ? (value as KeywordOpportunityProviderIntent)
    : null;
}

function distinctNormalized(
  values: readonly string[],
  normalize: (value: string) => string | null,
): readonly string[] {
  return [
    ...new Set(
      values
        .map(normalize)
        .filter((value): value is string => value !== null),
    ),
  ];
}

export function keywordCandidatePlan(
  drafts: readonly KeywordCandidateDraft[],
  cap: number,
): KeywordCandidatePlan {
  const unique = new Map<string, KeywordCandidateDraft>();
  for (const draft of drafts) {
    const key = keywordVolumeKey(draft.keyword);
    if (key !== "" && !unique.has(key)) unique.set(key, draft);
  }
  return {
    generated: drafts.length,
    candidates: [...unique.values()].slice(0, Math.max(0, cap)),
  };
}

export function keywordCoverageSnapshots(
  token: KeywordContextToken,
  candidates: readonly KeywordCandidateDraft[],
  coverageRead: KeywordCoverageRead | null,
): readonly KeywordCoverageSnapshot[] {
  const coverageIndex =
    coverageRead === null
      ? null
      : buildKeywordCoverageIndex(
          coverageRead.queryRows,
          coverageRead.queryPageRows,
        );
  const pages: readonly KeywordCoveragePage[] = token.pages.map((page) => ({
    url: page.url,
    tokens: keywordTokens([page.title, ...(page.headings ?? [])].join(" ")),
  }));
  const crawledUrls = new Set(token.pages.map((page) => page.url));

  return candidates.map((candidate) => {
    const sourceUrl =
      candidate.discoveryBasis === "site_proposition" &&
      candidate.propositionIndex !== null
        ? token.propositions[candidate.propositionIndex]?.sourceUrl
        : undefined;
    const attributedPage =
      sourceUrl !== undefined && crawledUrls.has(sourceUrl) ? sourceUrl : null;
    return {
      keyword: candidate.keyword,
      coverage: observeKeywordCoverage(
        candidate.keyword,
        coverageIndex,
        pages,
        attributedPage,
        token.sitemapInventory ?? null,
      ),
    };
  });
}

export function keywordPricedCandidates(
  candidates: readonly KeywordCandidateDraft[],
  providerRows: readonly KeywordOpportunityProviderRow[],
  coverageSnapshots: readonly KeywordCoverageSnapshot[],
): readonly KeywordPricedCandidate[] {
  const validations = resolveKeywordValidations(
    candidates.map((candidate) => candidate.keyword),
    providerRows,
  );
  const coverageByKeyword = new Map(
    coverageSnapshots.map((snapshot) => [
      keywordVolumeKey(snapshot.keyword),
      snapshot.coverage,
    ]),
  );
  return candidates.map((candidate) => {
    const coverage = coverageByKeyword.get(keywordVolumeKey(candidate.keyword));
    if (coverage === undefined) {
      throw new Error("keyword coverage snapshot missing");
    }
    const validation = keywordValidationFor(validations, candidate.keyword);
    return {
      candidate,
      validation: {
        ...validation,
        providerIntent: providerIntent(validation.intent),
      },
      coverage,
    };
  });
}

export function keywordSerpTargets(
  priced: readonly KeywordPricedCandidate[],
): readonly string[] {
  return priced
    .filter((row) => row.validation.availability !== "explicit_zero")
    .map((row) => row.candidate.keyword);
}

export function unavailableKeywordSerpSample(
  keyword: string,
  failureReason: NonNullable<KeywordSerpSampleResult["failureReason"]>,
): KeywordSerpSampleResult {
  return {
    keyword,
    status: "unavailable",
    failureReason,
    observedAt: null,
    results: [],
    pageItemTypes: null,
    aiOverview: null,
    communityItems: null,
  };
}

export function normalizeKeywordSerpSamples(
  targets: readonly string[],
  returnedSamples: readonly KeywordSerpSampleResult[],
  observedAt: string,
): readonly KeywordSerpSampleResult[] {
  const returnedByKeyword = new Map(
    returnedSamples.map((sample) => [keywordVolumeKey(sample.keyword), sample]),
  );
  return targets.map((keyword) => {
    const returned = returnedByKeyword.get(keywordVolumeKey(keyword));
    if (returned === undefined) {
      return unavailableKeywordSerpSample(keyword, "provider_unavailable");
    }
    const status = returned.status ?? "complete";
    return status === "complete"
      ? {
          ...returned,
          keyword,
          status,
          failureReason: null,
          observedAt: returned.observedAt ?? observedAt,
        }
      : {
          ...returned,
          keyword,
          status,
          failureReason: returned.failureReason ?? "provider_unavailable",
          observedAt: null,
          results: [],
        };
  });
}

export function keywordInterpretationEntries(
  inputs: readonly KeywordSerpInterpretationInput[],
  returned: readonly KeywordSerpInterpretation[],
): readonly (readonly [string, KeywordSerpInterpretation | null])[] {
  const inputKeywords = new Map(
    inputs.map((input) => [keywordVolumeKey(input.keyword), input.keyword]),
  );
  const interpretations = new Map<
    string,
    KeywordSerpInterpretation | null
  >();
  for (const interpretation of returned) {
    const key = keywordVolumeKey(interpretation.keyword);
    if (key === "" || !inputKeywords.has(key)) continue;
    interpretations.set(
      key,
      interpretations.has(key) ? null : interpretation,
    );
  }
  return [...interpretations].map(([key, interpretation]) => [
    inputKeywords.get(key) ?? key,
    interpretation,
  ]);
}

export function keywordEnrichmentTargets(
  completeSamples: readonly KeywordSerpSampleResult[],
  siteUrl: string,
): KeywordEnrichmentTargets {
  const organicDomains = [
    ...new Set(
      completeSamples.flatMap((sample) =>
        sample.results.map((result) => result.domain.trim().toLowerCase()),
      ),
    ),
  ].filter((domain) => domain !== "");
  const trafficDomains = distinctNormalized(
    organicDomains,
    normalizeTrafficDomain,
  );
  const registrationDomains = distinctNormalized(
    organicDomains,
    normalizeRdapDomain,
  );
  let siteDomain: string | null = null;
  try {
    siteDomain = normalizeTrafficDomain(new URL(siteUrl).hostname);
  } catch {
    siteDomain = null;
  }
  return {
    organicDomains,
    trafficDomains,
    registrationDomains,
    siteDomain,
    rankTargets:
      siteDomain !== null && !organicDomains.includes(siteDomain)
        ? [...organicDomains, siteDomain]
        : organicDomains,
  };
}
