// @input  -- candidate browser responses from Agent profile search enrichment
// @output -- proof that only the bounded, discriminated v1 wire shape is accepted
// @pos    -- strict client-contract tests for profile-search enrichment

import { describe, expect, it } from "vitest";
import {
  isAgentProfileSearchEnvelope,
  type AgentProfileSearchEnvelope,
} from "./profile-search-contract.ts";

const competitorEnvelope = {
  data: {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "acme.com",
    availability: "available",
    method: "competitors_domain",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: "2026-08-13T10:00:00.000Z",
    rows: [
      {
        kind: "organic_search_overlap",
        domain: "rival.com",
        intersections: 12,
        averagePosition: 4.5,
        summedPosition: 54,
        organicEstimatedTrafficVolume: 321,
      },
    ],
  },
} satisfies AgentProfileSearchEnvelope;

const serpEnvelope = {
  data: {
    schemaVersion: "agent_profile_search.v1",
    agent: "tech",
    targetHost: "acme.cn",
    availability: "available",
    method: "target_query_serp",
    market: { code: "CN", locationCode: 2156, languageCode: "zh" },
    observedAt: "2026-08-13T10:00:00.000Z",
    rows: [
      { kind: "target_query_serp", domain: "rival.cn", rank: 2 },
    ],
  },
} satisfies AgentProfileSearchEnvelope;

describe("isAgentProfileSearchEnvelope", () => {
  it.each([competitorEnvelope, serpEnvelope])(
    "accepts either provider-observation method without a cost field",
    (value) => {
      expect(isAgentProfileSearchEnvelope(value)).toBe(true);
      expect(JSON.stringify(value)).not.toContain("cost");
    },
  );

  it("accepts no-data only for an observed provider method", () => {
    const value: AgentProfileSearchEnvelope = {
      data: {
        ...competitorEnvelope.data,
        availability: "no_data",
        rows: [],
      },
    };

    expect(isAgentProfileSearchEnvelope(value)).toBe(true);
  });

  it("accepts market_unsupported without fabricating a method or provider market", () => {
    const value: AgentProfileSearchEnvelope = {
      data: {
        schemaVersion: "agent_profile_search.v1",
        agent: "seo",
        targetHost: "acme.com",
        availability: "market_unsupported",
        method: null,
        market: { code: "AQ", locationCode: null, languageCode: null },
        observedAt: null,
        rows: [],
      },
    };

    expect(isAgentProfileSearchEnvelope(value)).toBe(true);
  });

  it("accepts source_unavailable only with the provider method that was attempted", () => {
    const value: AgentProfileSearchEnvelope = {
      data: {
        schemaVersion: "agent_profile_search.v1",
        agent: "seo",
        targetHost: "acme.com",
        availability: "source_unavailable",
        method: "competitors_domain",
        market: { code: "US", locationCode: 2840, languageCode: "en" },
        observedAt: null,
        rows: [],
      },
    };

    expect(isAgentProfileSearchEnvelope(value)).toBe(true);
  });

  it.each([
    ["extra top-level key", () => ({ ...structuredClone(competitorEnvelope), debug: true })],
    [
      "provider cost",
      () => ({
        data: { ...structuredClone(competitorEnvelope).data, costUsd: 0.01 },
      }),
    ],
    [
      "wrong metric shape for method",
      () => ({
        data: { ...structuredClone(competitorEnvelope).data, rows: serpEnvelope.data.rows },
      }),
    ],
    [
      "duplicate domains",
      () => ({
        data: {
          ...structuredClone(serpEnvelope).data,
          rows: [serpEnvelope.data.rows[0], serpEnvelope.data.rows[0]],
        },
      }),
    ],
    [
      "more than ten rows",
      () => ({
        data: {
          ...structuredClone(serpEnvelope).data,
          rows: Array.from({ length: 11 }, (_, index) => ({
            kind: "target_query_serp",
            domain: `rival-${index}.cn`,
            rank: index + 1,
          })),
        },
      }),
    ],
    [
      "non-canonical timestamp",
      () => ({
        data: {
          ...structuredClone(competitorEnvelope).data,
          observedAt: "2026-08-13T10:00:00Z",
        },
      }),
    ],
    [
      "a syntactically invalid hostname",
      () => ({
        data: {
          ...structuredClone(competitorEnvelope).data,
          targetHost: "bad_host.com",
        },
      }),
    ],
    [
      "available without rows",
      () => ({ data: { ...structuredClone(competitorEnvelope).data, rows: [] } }),
    ],
    [
      "unavailable carrying observations",
      () => ({
        data: {
          ...structuredClone(competitorEnvelope).data,
          availability: "source_unavailable",
          observedAt: null,
        },
      }),
    ],
    [
      "source unavailable without a planned method",
      () => ({
        data: {
          schemaVersion: "agent_profile_search.v1",
          agent: "seo",
          targetHost: "acme.com",
          availability: "source_unavailable",
          method: null,
          market: { code: "US", locationCode: null, languageCode: null },
          observedAt: null,
          rows: [],
        },
      }),
    ],
  ] as const)("rejects %s", (_label, makeValue) => {
    expect(isAgentProfileSearchEnvelope(makeValue())).toBe(false);
  });
});
