import { describe, expect, it } from "vitest";

import type {
  KeywordCoverageRead,
  KeywordOpportunityProviderRow,
} from "@sf/public-tools";
import { SourceError, type DomainRegistrationEvidence } from "@sf/sources";
import { createKeywordCostAccumulator } from "./keyword-cost-guard.ts";
import {
  EMPTY_KEYWORD_LLM_USAGE,
  KeywordLlmError,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import {
  keywordSerpWaves,
  runKeywordCandidateStage,
  runKeywordCoverageStage,
  runKeywordInterpretationStage,
  runKeywordRankStage,
  runKeywordRegistrationStage,
  runKeywordSerpStage,
  runKeywordTrafficStage,
  runKeywordValidationStage,
} from "./keyword-opportunity-workflow-runtime.ts";

const NOW = "2026-08-28T00:00:00.000Z";
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

function now(): Date {
  return new Date(NOW);
}

function usage(overrides: Partial<KeywordLlmUsage> = {}): KeywordLlmUsage {
  return { ...EMPTY_KEYWORD_LLM_USAGE, requestCount: 1, ...overrides };
}

function completeSample(keyword = CANDIDATE.keyword): KeywordSerpSampleResult {
  return {
    keyword,
    status: "complete",
    failureReason: null,
    observedAt: NOW,
    results: [
      {
        domain: "small.example",
        position: 2,
        title: "Result",
        url: "https://small.example/result",
      },
    ],
    pageItemTypes: [],
    aiOverview: null,
    communityItems: [],
  };
}

function coverageRead(): KeywordCoverageRead {
  return {
    queryRows: [
      { query: CANDIDATE.keyword, impressions: 20, position: 4 },
      { query: "private unrelated query", impressions: 1, position: 90 },
    ],
    queryPageRows: [
      {
        query: CANDIDATE.keyword,
        page: "https://example.com/product",
        impressions: 20,
        position: 4,
      },
    ],
    queryPaging: { pagesFetched: 1, truncated: false },
    queryPagePaging: { pagesFetched: 1, truncated: false },
  };
}

function registration(domain: string): DomainRegistrationEvidence {
  return {
    domain,
    availability: "available",
    registeredAt: "2026-01-01T00:00:00.000Z",
    observedAt: NOW,
    sourceHost: "rdap.example",
    reason: null,
  };
}

describe("keyword Workflow paid-safe runtime", () => {
  it("deduplicates candidate expansion and returns its real LLM usage", async () => {
    const result = await runKeywordCandidateStage(
      { token: TOKEN, cap: 150 },
      {
        now,
        expandCandidates: async () => [
          CANDIDATE,
          { ...CANDIDATE, keyword: "  CLINIC APPOINTMENT AUTOMATION " },
        ],
        llmUsage: () => usage({ inputTokens: 900, outputTokens: 140 }),
      },
    );

    expect(result).toMatchObject({
      status: "ok",
      generated: 2,
      candidates: [CANDIDATE],
      llm: { inputTokens: 900, outputTokens: 140, requestCount: 1 },
      startedAt: Date.parse(NOW),
    });
  });

  it("turns candidate transport/schema errors into the stable model error", async () => {
    const result = await runKeywordCandidateStage(
      { token: TOKEN, cap: 150 },
      {
        now,
        expandCandidates: async () => {
          throw new KeywordLlmError("schema_invalid", "invalid response");
        },
        llmUsage: () => usage({ retryCount: 1 }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "keyword_generation_unavailable",
      llm: { requestCount: 1, retryCount: 1 },
    });
  });

  it("returns provider validation rows and a serializable cost delta", async () => {
    const costs = createKeywordCostAccumulator();
    const result = await runKeywordValidationStage(
      { token: TOKEN, candidates: [CANDIDATE] },
      {
        now,
        costs,
        validateVolumes: async () => {
          costs.record("keyword_overview", 0.017);
          return [PROVIDER_ROW];
        },
      },
    );

    expect(result).toMatchObject({
      status: "ok",
      providerRows: [PROVIDER_ROW],
      costs: {
        byEndpoint: { keyword_overview: 0.017 },
        unpricedCalls: 0,
      },
    });
  });

  it("compacts GSC coverage and never returns the grant or unrelated rows", async () => {
    const result = await runKeywordCoverageStage(
      {
        token: TOKEN,
        grant: {
          accessToken: "access-secret",
          properties: ["sc-domain:example.com"],
        },
        candidates: [CANDIDATE],
      },
      { now, readCoverageQueries: async () => coverageRead() },
    );
    const serialized = JSON.stringify(result);

    expect(result.coverage).toHaveLength(1);
    expect(result.coverage[0]?.coverage.state).toBe("observed_exact_strong");
    expect(serialized).not.toContain("access-secret");
    expect(serialized).not.toContain("private unrelated query");
    expect(serialized).not.toContain("queryRows");
  });

  it("maps an indeterminate SERP transport failure without throwing", async () => {
    const costs = createKeywordCostAccumulator();
    const result = await runKeywordSerpStage(
      {
        keyword: CANDIDATE.keyword,
        marketCode: "US",
        languageCode: "en",
      },
      {
        now,
        costs,
        sampleSerp: async () => {
          costs.record("serp_organic", 0.002);
          throw new Error("socket closed after dispatch");
        },
      },
    );

    expect(result.sample).toMatchObject({
      status: "unavailable",
      failureReason: "transport_outcome_unknown",
    });
    expect(result.costs.byEndpoint.serp_organic).toBe(0.002);
  });

  it("plans no more than ten per-keyword durable steps in one wave", () => {
    const waves = keywordSerpWaves(
      Array.from({ length: 25 }, (_, index) => `keyword-${index}`),
    );

    expect(waves.map((wave) => wave.length)).toEqual([10, 10, 5]);
    expect(Math.max(...waves.map((wave) => wave.length))).toBe(10);
  });

  it("degrades failed SERP interpretation without altering the SERP sample", async () => {
    const sample = completeSample();
    const result = await runKeywordInterpretationStage(
      { samples: [sample] },
      {
        now,
        interpretSerpEvidence: async () => {
          throw new KeywordLlmError("timeout", "timed out");
        },
        llmUsage: () => usage({ retryCount: 1 }),
      },
    );

    expect(result.entries).toEqual([]);
    expect(result.availability).toBe("unavailable");
    expect(result.llm.retryCount).toBe(1);
    expect(sample).toEqual(completeSample());
  });

  it("does not mislabel a deterministic provider-wide SERP refusal as an unknown transport outcome", async () => {
    const costs = createKeywordCostAccumulator();
    const result = await runKeywordSerpStage(
      {
        keyword: CANDIDATE.keyword,
        marketCode: "US",
        languageCode: "en",
      },
      {
        now,
        costs,
        sampleSerp: async () => {
          throw new SourceError("AUTH_REQUIRED", "provider refused auth");
        },
      },
    );

    expect(result.sample.failureReason).toBe("provider_unavailable");
  });

  it("serializes rank, traffic, and RDAP maps while preserving unavailable as null", async () => {
    const rankCosts = createKeywordCostAccumulator();
    const trafficCosts = createKeywordCostAccumulator();
    const ranks = await runKeywordRankStage(["a.example", "b.example"], {
      now,
      costs: rankCosts,
      resolveDomainRanks: async (domains) =>
        new Map(domains.map((domain, index) => [domain, index + 1])),
    });
    const traffic = await runKeywordTrafficStage(
      { domains: ["a.example"], marketCode: "US" },
      {
        now,
        costs: trafficCosts,
        resolveDomainTraffic: async () => null,
      },
    );
    const registrations = await runKeywordRegistrationStage(
      ["a.example"],
      {
        now,
        resolveDomainRegistrations: async (domains) =>
          new Map(domains.map((domain) => [domain, registration(domain)])),
      },
    );

    expect(ranks.entries).toEqual([
      ["a.example", 1],
      ["b.example", 2],
    ]);
    expect(traffic.entries).toBeNull();
    expect(registrations.entries).toEqual([
      ["a.example", registration("a.example")],
    ]);
  });

  it("normalizes a successful per-keyword sample without inventing evidence", async () => {
    const costs = createKeywordCostAccumulator();
    const result = await runKeywordSerpStage(
      {
        keyword: CANDIDATE.keyword,
        marketCode: "US",
        languageCode: "en",
      },
      {
        now,
        costs,
        sampleSerp: async () => [completeSample()],
      },
    );

    expect(result.sample).toEqual(completeSample());
  });
});
