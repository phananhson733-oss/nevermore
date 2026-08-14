// @input  -- DataForSEO profile-search observations and an editable local Agent profile
// @output -- deterministic, source-bounded competitor suggestions and exclusive user classification
// @pos    -- browser-safe projection contract between provider evidence and Stage 03 review

import { describe, expect, it } from "vitest";

import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract";
import {
  classifyAgentCompetitorProfile,
  deriveAgentCompetitorSuggestions,
} from "./agent-competitor-candidates";
import {
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";

const OBSERVED_AT = "2026-08-14T04:00:00.000Z";

function overlapData(
  rows: Extract<
    AgentProfileSearchData,
    { method: "competitors_domain" }
  >["rows"],
): AgentProfileSearchData {
  return {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "acme.com",
    availability: rows.length === 0 ? "no_data" : "available",
    method: "competitors_domain",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: OBSERVED_AT,
    rows,
  };
}

function overlap(
  domain: string,
  intersections: number,
  organicEstimatedTrafficVolume: number,
  averagePosition = 4.5,
  summedPosition = 45,
) {
  return {
    kind: "organic_search_overlap" as const,
    domain,
    intersections,
    averagePosition,
    summedPosition,
    organicEstimatedTrafficVolume,
  };
}

describe("deriveAgentCompetitorSuggestions", () => {
  it("projects ranked observations into app-derived evidence-review buckets", () => {
    const suggestions = deriveAgentCompetitorSuggestions(
      overlapData([
        overlap("low.example", 3, 900),
        overlap("leader.example", 10, 100),
        overlap("peer.example", 4, 200),
        overlap("strong.example", 5, 300),
      ]),
      "www.acme.com",
    );

    expect(suggestions.map(({ domain }) => domain)).toEqual([
      "leader.example",
      "strong.example",
      "peer.example",
      "low.example",
    ]);
    expect(
      suggestions.map(({ reviewBucket, discoveryConfidence }) => ({
        reviewBucket,
        discoveryConfidence,
      })),
    ).toEqual([
      { reviewBucket: "higher_overlap", discoveryConfidence: "medium" },
      { reviewBucket: "higher_overlap", discoveryConfidence: "medium" },
      { reviewBucket: "higher_overlap", discoveryConfidence: "low" },
      { reviewBucket: "adjacent_overlap", discoveryConfidence: "low" },
    ]);
    expect(suggestions[0]).toEqual({
      domain: "leader.example",
      reviewBucket: "higher_overlap",
      discoveryConfidence: "medium",
      evidenceKind: "organic_search_overlap",
      observedAt: OBSERVED_AT,
      metrics: {
        intersections: 10,
        averagePosition: 4.5,
        summedPosition: 45,
        organicEstimatedTrafficVolume: 100,
        rank: null,
      },
    });
    expect(suggestions[0]).not.toHaveProperty("similarity");
  });

  it("filters self and non-competitor domains, keeps the strongest duplicate, and caps at eight", () => {
    const suggestions = deriveAgentCompetitorSuggestions(
      overlapData([
        overlap("acme.com", 99, 999),
        overlap("docs.acme.com", 98, 998),
        overlap("reddit.com", 97, 997),
        overlap("news.google.com", 96, 996),
        overlap("duplicate.example", 2, 10),
        overlap("duplicate.example", 7, 20),
        ...Array.from({ length: 10 }, (_, index) =>
          overlap(`candidate-${index}.example`, 10 - index, index),
        ),
      ]),
      "acme.com",
    );

    expect(suggestions).toHaveLength(8);
    expect(suggestions.map(({ domain }) => domain)).not.toEqual(
      expect.arrayContaining([
        "acme.com",
        "docs.acme.com",
        "reddit.com",
        "news.google.com",
      ]),
    );
    expect(
      suggestions.filter(({ domain }) => domain === "duplicate.example"),
    ).toHaveLength(1);
    expect(
      suggestions.find(({ domain }) => domain === "duplicate.example")
        ?.metrics.intersections,
    ).toBe(7);
  });

  it("keeps target-query SERP rows as unclassified search evidence with nullable unavailable metrics", () => {
    const data: AgentProfileSearchData = {
      schemaVersion: "agent_profile_search.v1",
      agent: "tech",
      targetHost: "acme.cn",
      availability: "available",
      method: "target_query_serp",
      market: { code: "CN", locationCode: 2156, languageCode: "zh" },
      observedAt: OBSERVED_AT,
      rows: [
        { kind: "target_query_serp", domain: "second.cn", rank: 8 },
        { kind: "target_query_serp", domain: "first.cn", rank: 2 },
      ],
    };

    expect(deriveAgentCompetitorSuggestions(data, "acme.cn")).toEqual([
      {
        domain: "first.cn",
        reviewBucket: "unclassified",
        discoveryConfidence: null,
        evidenceKind: "target_query_serp",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: null,
          summedPosition: null,
          organicEstimatedTrafficVolume: null,
          rank: 2,
        },
      },
      {
        domain: "second.cn",
        reviewBucket: "unclassified",
        discoveryConfidence: null,
        evidenceKind: "target_query_serp",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: null,
          summedPosition: null,
          organicEstimatedTrafficVolume: null,
          rank: 8,
        },
      },
    ]);
  });

  it("returns no suggestions when provider observations are unavailable", () => {
    const unavailable: AgentProfileSearchData = {
      schemaVersion: "agent_profile_search.v1",
      agent: "seo",
      targetHost: "acme.com",
      availability: "source_unavailable",
      method: "competitors_domain",
      market: { code: "US", locationCode: 2840, languageCode: "en" },
      observedAt: null,
      rows: [],
    };

    expect(deriveAgentCompetitorSuggestions(unavailable, "acme.com")).toEqual(
      [],
    );
    expect(
      deriveAgentCompetitorSuggestions(overlapData([]), "acme.com"),
    ).toEqual([]);
  });

  it("does not turn discovery buckets into profile classifications", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://acme.com"),
      {
        directCompetitors: ["declared-direct.example"],
        indirectAlternatives: ["declared-indirect.example"],
        excludedAlternatives: ["excluded.example"],
      },
    );
    const before = {
      directCompetitors: profile.directCompetitors,
      indirectAlternatives: profile.indirectAlternatives,
      excludedAlternatives: profile.excludedAlternatives,
    };

    deriveAgentCompetitorSuggestions(
      overlapData([overlap("candidate.example", 12, 300)]),
      profile.host,
    );

    expect({
      directCompetitors: profile.directCompetitors,
      indirectAlternatives: profile.indirectAlternatives,
      excludedAlternatives: profile.excludedAlternatives,
    }).toEqual(before);
  });
});

describe("classifyAgentCompetitorProfile", () => {
  it.each([
    ["direct", "directCompetitors"],
    ["indirect", "indirectAlternatives"],
    ["excluded", "excludedAlternatives"],
  ] as const)(
    "places a normalized domain in only the %s profile group with user-edit provenance",
    (classification, destination) => {
      const draft = updateAgentProfile(
        createAgentProfileDraft("seo", "https://acme.com"),
        {
          directCompetitors: ["rival.example", "direct.example"],
          indirectAlternatives: ["rival.example", "indirect.example"],
          excludedAlternatives: ["rival.example", "excluded.example"],
        },
      );

      const classified = classifyAgentCompetitorProfile(
        draft,
        "WWW.RIVAL.EXAMPLE",
        classification,
      );

      const groups = {
        directCompetitors: classified.directCompetitors,
        indirectAlternatives: classified.indirectAlternatives,
        excludedAlternatives: classified.excludedAlternatives,
      };
      expect(groups[destination]).toContain("rival.example");
      expect(
        Object.values(groups).filter((values) =>
          values.includes("rival.example"),
        ),
      ).toHaveLength(1);
      expect(groups.directCompetitors).toContain("direct.example");
      expect(groups.indirectAlternatives).toContain("indirect.example");
      expect(groups.excludedAlternatives).toContain("excluded.example");
      for (const field of [
        "directCompetitors",
        "indirectAlternatives",
        "excludedAlternatives",
      ] as const) {
        expect(
          classified.fieldProvenance.find(
            ({ path }) => path === `/${field}`,
          ),
        ).toMatchObject({ derivation: "declared", source: "user_edit" });
      }
      expect(classified.reviewState).toBe("needs_confirmation");
    },
  );
});
