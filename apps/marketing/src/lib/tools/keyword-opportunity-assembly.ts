// @input  -- serializable keyword-stage snapshots and bounded timing metadata
// @output -- one v3 evidence envelope for synchronous or Workflow-managed delivery
// @pos    -- shared deterministic assembly; it performs no provider, model, cookie, or persistence call
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildKeywordOpportunityPayload,
  judgeKeywordWinnability,
  KEYWORD_OPPORTUNITY_THRESHOLD_POLICY_VERSION,
  KEYWORD_OPPORTUNITY_UNSAMPLED,
  keywordVolumeKey,
  type KeywordOpportunityContext,
  type KeywordOpportunityEnvelope,
  type KeywordOpportunityObservationV3,
} from "@sf/public-tools/keyword-opportunity";
import type { PublicToolPersistence } from "@sf/public-tools/contract";
import type { DomainRegistrationEvidence } from "@sf/sources/rdap/domain-registration";
import type {
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import type { KeywordPricedCandidate } from "./keyword-opportunity-stages.ts";
import { keywordEnrichmentTargets } from "./keyword-opportunity-stages.ts";
import type { KeywordSerpInterpretation } from "./keyword-prompts.ts";
import {
  buildKeywordSignalEvidence,
  KEYWORD_YOUNG_DOMAIN_MONTHS,
  keywordSiteRankTier,
  keywordSiteTrafficThreshold,
} from "./keyword-signal-evidence.ts";

export interface KeywordOpportunityStageDurations {
  readonly validation: number | null;
  readonly coverage: number | null;
  readonly serpSampling: number | null;
  readonly serpInterpretation: number | null;
  readonly domainEnrichment: number | null;
}

export interface KeywordOpportunityAssemblyInput {
  readonly token: KeywordContextToken;
  readonly generated: number;
  readonly priced: readonly KeywordPricedCandidate[];
  readonly attemptedSamples: readonly KeywordSerpSampleResult[];
  readonly interpretationEntries: readonly (
    readonly [string, KeywordSerpInterpretation | null]
  )[];
  readonly domainRankEntries: readonly (readonly [string, number])[] | null;
  readonly domainTrafficEntries:
    | readonly (readonly [string, number | null])[]
    | null;
  readonly domainRegistrationEntries:
    | readonly (readonly [string, DomainRegistrationEvidence])[]
    | null;
  readonly unavailableStages: readonly string[];
  readonly completedAt: string;
  readonly totalStartedAt: number | null;
  readonly durationsMs: KeywordOpportunityStageDurations;
}

export interface KeywordOpportunityAssemblyOptions {
  readonly persistence?: PublicToolPersistence;
  readonly now?: () => number;
}

export function assembleKeywordOpportunityPayload(
  input: KeywordOpportunityAssemblyInput,
  options: KeywordOpportunityAssemblyOptions = {},
): KeywordOpportunityEnvelope {
  const now = options.now ?? Date.now;
  const reportStartedAt = now();
  const domainRanks =
    input.domainRankEntries === null
      ? null
      : new Map(input.domainRankEntries);
  const domainTraffic =
    input.domainTrafficEntries === null
      ? null
      : new Map(input.domainTrafficEntries);
  const domainRegistrations =
    input.domainRegistrationEntries === null
      ? null
      : new Map(input.domainRegistrationEntries);
  const completeSamples = input.attemptedSamples.filter(
    (sample) => sample.status === "complete",
  );
  const { siteDomain } = keywordEnrichmentTargets(
    completeSamples,
    input.token.siteUrl,
  );
  const siteDomainRank =
    siteDomain === null ? null : (domainRanks?.get(siteDomain) ?? null);
  const siteTrafficThreshold = keywordSiteTrafficThreshold(siteDomainRank);
  const siteRankTier = keywordSiteRankTier(siteDomainRank);
  const samplesByKeyword = new Map(
    input.attemptedSamples.map((sample) => [
      keywordVolumeKey(sample.keyword),
      sample,
    ]),
  );
  const interpretationsByKeyword = new Map(
    input.interpretationEntries.map(([keyword, interpretation]) => [
      keywordVolumeKey(keyword),
      interpretation,
    ]),
  );

  const observations: KeywordOpportunityObservationV3[] = input.priced.map(
    (row) => {
      const attempted = samplesByKeyword.get(
        keywordVolumeKey(row.candidate.keyword),
      );
      const sample: KeywordSerpSampleResult = attempted ?? {
        keyword: row.candidate.keyword,
        status: "unavailable",
        failureReason: null,
        observedAt: null,
        results: [],
        pageItemTypes: null,
        aiOverview: null,
        communityItems: null,
      };
      const enriched = buildKeywordSignalEvidence({
        sample,
        observedAt: input.completedAt,
        siteDomainRank,
        domainTraffic,
        domainRegistrations,
        marketCode: input.token.marketCode,
        languageCode: input.token.languageCode,
      });
      const interpretation = interpretationsByKeyword.get(
        keywordVolumeKey(row.candidate.keyword),
      );
      const availableInterpretation =
        interpretation?.availability === "available" ? interpretation : null;
      const serpIntent =
        availableInterpretation === null
          ? null
          : {
              intent: availableInterpretation.intent,
              source: "serp_top_ten_interpretation" as const,
              observedAt: sample.observedAt ?? input.completedAt,
              modelId: availableInterpretation.modelId,
              promptVersion: availableInterpretation.promptVersion,
            };
      const aiOverview =
        availableInterpretation !== null
          ? {
              ...enriched.aiOverview,
              answerAssessment: availableInterpretation.aiOverviewAssessment,
              reason: availableInterpretation.reason,
              modelId: availableInterpretation.modelId,
              promptVersion: availableInterpretation.promptVersion,
            }
          : enriched.aiOverview.availability === "observed" &&
              enriched.aiOverview.markdown !== null
            ? {
                ...enriched.aiOverview,
                answerAssessment: "unavailable" as const,
                reason: "interpretation_unavailable",
                modelId: null,
                promptVersion: null,
              }
            : enriched.aiOverview;
      const serp =
        sample.status === "complete"
          ? {
              ...judgeKeywordWinnability(
                {
                  results: sample.results,
                  domainRanks: domainRanks ?? new Map(),
                  pageItemTypes: sample.pageItemTypes,
                },
                siteDomainRank,
              ),
              status: "complete" as const,
              failureReason: null,
              observedAt: sample.observedAt ?? input.completedAt,
              organicResults: sample.results.map((result) => ({
                position: result.position,
                domain: result.domain,
                title: result.title ?? null,
                url: result.url ?? null,
              })),
            }
          : {
              ...KEYWORD_OPPORTUNITY_UNSAMPLED,
              status: "unavailable" as const,
              failureReason: sample.failureReason ?? null,
              observedAt: null,
              organicResults: [],
            };
      return {
        keyword: row.candidate.keyword,
        lane: row.candidate.questionForm ? "geo" : "seo",
        discoveryBasis: row.candidate.discoveryBasis,
        questionForm: row.candidate.questionForm,
        propositionIndex: row.candidate.propositionIndex,
        validation: row.validation,
        serp,
        serpIntent,
        signals: enriched.signals,
        aiOverview,
        coverage: row.coverage.state,
        supportingPage: row.coverage.supportingPage,
      };
    },
  );

  const context: KeywordOpportunityContext = {
    siteUrl: input.token.siteUrl,
    pagesFetched: input.token.pagesFetched,
    productPagesFetched: input.token.productPagesFetched,
    ...(input.token.selection === undefined
      ? {}
      : { selection: input.token.selection }),
    propositions: input.token.propositions,
    contextSufficient: input.token.pages.length >= 3,
    stopReason: input.token.stopReason,
  };

  const pending = buildKeywordOpportunityPayload(
    {
      marketCode: input.token.marketCode,
      languageCode: input.token.languageCode,
      context,
      generated: input.generated,
      observations,
      unavailableStages: input.unavailableStages,
      process: {
        validation: { requested: input.priced.length },
        serp: {
          planned: input.attemptedSamples.length,
          dispatched: input.attemptedSamples.filter(
            (sample) => sample.failureReason !== "budget_exhausted",
          ).length,
        },
        thresholds: {
          policyVersion: KEYWORD_OPPORTUNITY_THRESHOLD_POLICY_VERSION,
          youngDomainMonths: KEYWORD_YOUNG_DOMAIN_MONTHS,
          siteDomainRank,
          siteRankTier,
          lowOrganicTrafficThreshold: siteTrafficThreshold,
        },
        durationsMs: {
          total: null,
          ...input.durationsMs,
          report: null,
        },
      },
      completedAt: input.completedAt,
    },
    options.persistence,
  );
  const reportFinishedAt = now();

  return {
    ...pending,
    result: {
      ...pending.result,
      process: {
        ...pending.result.process,
        durationsMs: {
          ...pending.result.process.durationsMs,
          total:
            input.totalStartedAt === null
              ? null
              : reportFinishedAt - input.totalStartedAt,
          report: reportFinishedAt - reportStartedAt,
        },
      },
    },
  };
}
