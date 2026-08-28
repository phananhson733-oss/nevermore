import { describe, expect, it } from "vitest";

import type { KeywordOpportunityProviderRow } from "@sf/public-tools";
import {
  keywordCoverageSnapshots,
  keywordPricedCandidates,
} from "./keyword-opportunity-stages.ts";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import { assembleKeywordOpportunityPayload } from "./keyword-opportunity-assembly.ts";

const TOKEN: KeywordContextToken = {
  siteUrl: "https://example.com/",
  marketCode: "US",
  languageCode: "en",
  propositions: [
    {
      statement: "Automate clinic appointments",
      sourceUrl: "https://example.com/product",
    },
  ],
  pages: [
    {
      url: "https://example.com/product",
      title: "Practice operations platform",
      headings: ["Automate patient intake"],
    },
  ],
  pagesFetched: 1,
  productPagesFetched: 1,
  stopReason: "completed",
  seeds: [],
  sub: "owner-a",
};

const CANDIDATE: KeywordCandidateDraft = {
  keyword: "clinic appointment automation",
  discoveryBasis: "site_proposition",
  questionForm: false,
  propositionIndex: 0,
};

const PROVIDER_ROW: KeywordOpportunityProviderRow = {
  keyword: CANDIDATE.keyword,
  volume: 120,
  difficulty: 14,
  intent: "commercial",
  serpFeatures: [],
};

const UNAVAILABLE_SAMPLE: KeywordSerpSampleResult = {
  keyword: CANDIDATE.keyword,
  status: "unavailable",
  failureReason: "provider_unavailable",
  observedAt: null,
  results: [],
  pageItemTypes: null,
  aiOverview: null,
  communityItems: null,
};

describe("assembleKeywordOpportunityPayload", () => {
  it("assembles the same evidence model with Workflow-managed persistence and measured durations", () => {
    const priced = keywordPricedCandidates(
      [CANDIDATE],
      [PROVIDER_ROW],
      keywordCoverageSnapshots(TOKEN, [CANDIDATE], null),
    );
    const times = [1_005, 1_007];

    const payload = assembleKeywordOpportunityPayload(
      {
        token: TOKEN,
        generated: 1,
        priced,
        attemptedSamples: [UNAVAILABLE_SAMPLE],
        interpretationEntries: [],
        domainRankEntries: null,
        domainTrafficEntries: null,
        domainRegistrationEntries: null,
        unavailableStages: ["serp_sample"],
        completedAt: "2026-08-28T00:00:00.000Z",
        totalStartedAt: 1_000,
        durationsMs: {
          validation: 1,
          coverage: 2,
          serpSampling: 3,
          serpInterpretation: null,
          domainEnrichment: null,
        },
      },
      {
        persistence: "workflow_managed",
        now: () => times.shift() ?? 1_007,
      },
    );

    expect(payload.run.persistence).toBe("workflow_managed");
    expect(payload.result.context.siteUrl).toBe(TOKEN.siteUrl);
    expect(payload.result.process.validation).toMatchObject({
      requested: 1,
      available: 1,
      accounted: true,
    });
    expect(payload.result.process.serp).toMatchObject({
      planned: 1,
      dispatched: 1,
      completed: 0,
      failed: 1,
      accounted: true,
    });
    expect(payload.result.process.durationsMs).toEqual({
      total: 7,
      validation: 1,
      coverage: 2,
      serpSampling: 3,
      serpInterpretation: null,
      domainEnrichment: null,
      report: 2,
    });
  });

  it("keeps the synchronous path unpersisted by default", () => {
    const payload = assembleKeywordOpportunityPayload({
      token: TOKEN,
      generated: 0,
      priced: [],
      attemptedSamples: [],
      interpretationEntries: [],
      domainRankEntries: null,
      domainTrafficEntries: null,
      domainRegistrationEntries: null,
      unavailableStages: [],
      completedAt: "2026-08-28T00:00:00.000Z",
      totalStartedAt: null,
      durationsMs: {
        validation: null,
        coverage: null,
        serpSampling: null,
        serpInterpretation: null,
        domainEnrichment: null,
      },
    });

    expect(payload.run.persistence).toBe("none");
    expect(payload.result.process.durationsMs.total).toBeNull();
  });
});
