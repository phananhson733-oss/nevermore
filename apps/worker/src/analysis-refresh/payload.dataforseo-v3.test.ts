import { describe, expect, it } from "vitest";
import { parseAnalysisRefreshRequestPayload } from "./payload.ts";

const basePayload = {
  siteId: "00000000-0000-4000-8000-000000000001",
  icpProfile: {
    id: "00000000-0000-4000-8000-000000000002",
    version: 3,
    contentHash: "a".repeat(64),
  },
  outputLocale: "en-US",
  sourceConnectionIds: {
    crawl: "00000000-0000-4000-8000-000000000003",
    gsc: null,
    ga4: null,
  },
  dataForSeo: {
    enabled: true,
    maxKeywords: 200,
    maxCompetitors: 100,
  },
  dataForSeoBacklinks: {
    enabled: false,
    maxBacklinks: 500,
    maxReferringDomains: 100,
    maxBacklinkPages: 500,
    maxSourceVerifications: 20,
  },
} as const;

function queries(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    entityId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: index + 1,
    query: `Which onboarding platform is best for team ${index + 1}?`,
    normalizedQuery: `which onboarding platform is best for team ${index + 1}?`,
    marketCode: "US",
    languageTag: "en-US",
  }));
}

describe("Analysis Refresh DataForSEO v3 payload", () => {
  it("retains an exact immutable enabled cohort and lineage hash", () => {
    const payload = {
      ...basePayload,
      dataForSeo: {
        ...basePayload.dataForSeo,
        aiCitations: {
          state: "enabled",
          platform: "chat_gpt",
          requestedModel: "gpt-5",
          attemptedQueries: 20,
          maxOutputTokens: 1_024,
          webSearch: true,
          querySetHash: "b".repeat(64),
          queries: queries(),
          trackedCompetitorDomains: ["ahrefs.com", "semrush.com"],
        },
      },
    };

    expect(parseAnalysisRefreshRequestPayload(payload)).toEqual(payload);
  });

  it("retains typed disabled and insufficient-cohort policies without query text", () => {
    expect(
      parseAnalysisRefreshRequestPayload({
        ...basePayload,
        dataForSeo: {
          ...basePayload.dataForSeo,
          aiCitations: { state: "disabled" },
        },
      }).dataForSeo.aiCitations,
    ).toEqual({ state: "disabled" });
    expect(
      parseAnalysisRefreshRequestPayload({
        ...basePayload,
        dataForSeo: {
          ...basePayload.dataForSeo,
          aiCitations: {
            state: "skipped_insufficient_query_cohort",
            eligibleQueryCount: 19,
          },
        },
      }).dataForSeo.aiCitations,
    ).toEqual({
      state: "skipped_insufficient_query_cohort",
      eligibleQueryCount: 19,
    });
  });

  it("rejects a paid cohort that is not exactly 20", () => {
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...basePayload,
        dataForSeo: {
          ...basePayload.dataForSeo,
          aiCitations: {
            state: "enabled",
            platform: "chat_gpt",
            requestedModel: "gpt-5",
            attemptedQueries: 20,
            maxOutputTokens: 1_024,
            webSearch: true,
            querySetHash: "b".repeat(64),
            queries: queries(19),
            trackedCompetitorDomains: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects provider queries over the 500-character user_prompt limit", () => {
    const overLimit = queries();
    overLimit[0] = { ...overLimit[0]!, query: "q".repeat(501) };

    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...basePayload,
        dataForSeo: {
          ...basePayload.dataForSeo,
          aiCitations: {
            state: "enabled",
            platform: "chat_gpt",
            requestedModel: "gpt-5",
            attemptedQueries: 20,
            maxOutputTokens: 1_024,
            webSearch: true,
            querySetHash: "b".repeat(64),
            queries: overLimit,
            trackedCompetitorDomains: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects revision zero in a paid cohort", () => {
    const invalidQueries = queries();
    invalidQueries[0] = { ...invalidQueries[0]!, revision: 0 };

    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...basePayload,
        dataForSeo: {
          ...basePayload.dataForSeo,
          aiCitations: {
            state: "enabled",
            platform: "chat_gpt",
            requestedModel: "gpt-5",
            attemptedQueries: 20,
            maxOutputTokens: 1_024,
            webSearch: true,
            querySetHash: "b".repeat(64),
            queries: invalidQueries,
            trackedCompetitorDomains: [],
          },
        },
      }),
    ).toThrow();
  });

  it("continues a historical v1/v2 parent whose payload predates AI policy", () => {
    expect(parseAnalysisRefreshRequestPayload(basePayload).dataForSeo).toEqual(
      basePayload.dataForSeo,
    );
  });
});
