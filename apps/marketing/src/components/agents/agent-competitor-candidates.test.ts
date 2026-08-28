// @input  -- DataForSEO profile-search observations and an editable local Agent profile
// @output -- deterministic, source-bounded competitor suggestions and exclusive user classification
// @pos    -- browser-safe projection contract between provider evidence and Stage 03 review

import { describe, expect, it } from "vitest";

import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract";
import {
  classifyAgentCompetitorProfile,
  classifyCompetitorRelationships,
  deriveAgentCompetitorDisplayFrame,
  deriveAgentCompetitorSuggestions,
  resolveAgentCompetitorClassification,
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
      suggestions.map(
        ({ reviewBucket, discoveryConfidence, suggestedClassification }) => ({
          reviewBucket,
          discoveryConfidence,
          suggestedClassification,
        }),
      ),
    ).toEqual([
      {
        reviewBucket: "higher_overlap",
        discoveryConfidence: "medium",
        suggestedClassification: "direct",
      },
      {
        reviewBucket: "higher_overlap",
        discoveryConfidence: "medium",
        suggestedClassification: "direct",
      },
      {
        reviewBucket: "higher_overlap",
        discoveryConfidence: "low",
        suggestedClassification: "direct",
      },
      {
        reviewBucket: "adjacent_overlap",
        discoveryConfidence: "low",
        suggestedClassification: "indirect",
      },
    ]);
    expect(suggestions[0]).toEqual({
      domain: "leader.example",
      reviewBucket: "higher_overlap",
      discoveryConfidence: "medium",
      suggestedClassification: "direct",
      evidenceKind: "organic_search_overlap",
      observedAt: OBSERVED_AT,
      metrics: {
        intersections: 10,
        averagePosition: 4.5,
        medianPosition: null,
        summedPosition: 45,
        organicEstimatedTrafficVolume: 100,
        rank: null,
        rating: null,
        keywordsCount: null,
        visibility: null,
        relevantSerpItems: null,
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

  it("defaults target-query SERP rows to a low-confidence indirect business suggestion while keeping provider metrics nullable", () => {
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
        discoveryConfidence: "low",
        suggestedClassification: "indirect",
        evidenceKind: "target_query_serp",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: null,
          medianPosition: null,
          summedPosition: null,
          organicEstimatedTrafficVolume: null,
          rank: 2,
          rating: null,
          keywordsCount: null,
          visibility: null,
          relevantSerpItems: null,
        },
      },
      {
        domain: "second.cn",
        reviewBucket: "unclassified",
        discoveryConfidence: "low",
        suggestedClassification: "indirect",
        evidenceKind: "target_query_serp",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: null,
          medianPosition: null,
          summedPosition: null,
          organicEstimatedTrafficVolume: null,
          rank: 8,
          rating: null,
          keywordsCount: null,
          visibility: null,
          relevantSerpItems: null,
        },
      },
    ]);
  });

  it("projects seed-SERP competitor facts without presenting them as overlap or target-query rank", () => {
    const data: AgentProfileSearchData = {
      schemaVersion: "agent_profile_search.v1",
      agent: "seo",
      targetHost: "acme.com",
      availability: "available",
      method: "serp_competitors",
      market: { code: "US", locationCode: 2840, languageCode: "en" },
      observedAt: OBSERVED_AT,
      rows: [
        {
          kind: "profile_seed_serp_competitor",
          domain: "lower.example",
          averagePosition: 3.5,
          medianPosition: 3,
          rating: 30,
          organicEstimatedTrafficVolume: 900,
          keywordsCount: 1,
          visibility: 0.2,
          relevantSerpItems: 1,
        },
        {
          kind: "profile_seed_serp_competitor",
          domain: "leader.example",
          averagePosition: 8.25,
          medianPosition: 7,
          rating: 100,
          organicEstimatedTrafficVolume: 100,
          keywordsCount: 4,
          visibility: 0.8,
          relevantSerpItems: 3,
        },
      ],
    };

    expect(deriveAgentCompetitorSuggestions(data, "acme.com")).toEqual([
      {
        domain: "leader.example",
        reviewBucket: "unclassified",
        discoveryConfidence: "low",
        suggestedClassification: "indirect",
        evidenceKind: "profile_seed_serp_competitor",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: 8.25,
          medianPosition: 7,
          summedPosition: null,
          organicEstimatedTrafficVolume: 100,
          rank: null,
          rating: 100,
          keywordsCount: 4,
          visibility: 0.8,
          relevantSerpItems: 3,
        },
      },
      {
        domain: "lower.example",
        reviewBucket: "unclassified",
        discoveryConfidence: "low",
        suggestedClassification: "indirect",
        evidenceKind: "profile_seed_serp_competitor",
        observedAt: OBSERVED_AT,
        metrics: {
          intersections: null,
          averagePosition: 3.5,
          medianPosition: 3,
          summedPosition: null,
          organicEstimatedTrafficVolume: 900,
          rank: null,
          rating: 30,
          keywordsCount: 1,
          visibility: 0.2,
          relevantSerpItems: 1,
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

describe("classifyCompetitorRelationships", () => {
  it("moves a normalized domain into one relationship without mutating input", () => {
    const before = {
      direct: ["direct-a.example", "direct-b.example"],
      indirect: ["rival.example", "keep-a.example", "keep-b.example"],
      excluded: ["ignored.example"],
    } as const;

    const after = classifyCompetitorRelationships(
      before,
      "WWW.Rival.Example.",
      "direct",
    );

    expect(after).toEqual({
      direct: ["direct-a.example", "direct-b.example", "rival.example"],
      indirect: ["keep-a.example", "keep-b.example"],
      excluded: ["ignored.example"],
    });
    expect(before).toEqual({
      direct: ["direct-a.example", "direct-b.example"],
      indirect: ["rival.example", "keep-a.example", "keep-b.example"],
      excluded: ["ignored.example"],
    });
    expect(after.direct).not.toBe(before.direct);
    expect(after.indirect).not.toBe(before.indirect);
    expect(after.excluded).not.toBe(before.excluded);
  });

  it.each([
    [
      "direct",
      {
        direct: ["keep-direct.example", "rival.example"],
        indirect: ["keep-indirect.example"],
        excluded: ["keep-excluded.example"],
      },
    ],
    [
      "indirect",
      {
        direct: ["keep-direct.example"],
        indirect: ["keep-indirect.example", "rival.example"],
        excluded: ["keep-excluded.example"],
      },
    ],
    [
      "excluded",
      {
        direct: ["keep-direct.example"],
        indirect: ["keep-indirect.example"],
        excluded: ["keep-excluded.example", "rival.example"],
      },
    ],
  ] as const)("places a domain in only the %s relationship", (choice, expected) => {
    expect(
      classifyCompetitorRelationships(
        {
          direct: ["rival.example", "keep-direct.example"],
          indirect: ["rival.example", "keep-indirect.example"],
          excluded: ["rival.example", "keep-excluded.example"],
        },
        "rival.example",
        choice,
      ),
    ).toEqual(expected);
  });

  it("keeps a repeated same-group decision normalized and unique", () => {
    expect(
      classifyCompetitorRelationships(
        {
          direct: ["before.example", "WWW.RIVAL.EXAMPLE", "after.example"],
          indirect: [],
          excluded: [],
        },
        "rival.example.",
        "direct",
      ),
    ).toEqual({
      direct: ["before.example", "after.example", "rival.example"],
      indirect: [],
      excluded: [],
    });
  });

  it("rejects an invalid public hostname with the established error", () => {
    expect(() =>
      classifyCompetitorRelationships(
        { direct: [], indirect: [], excluded: [] },
        "localhost",
        "direct",
      ),
    ).toThrowError(
      new TypeError(
        "Competitor domain must be a normalized public hostname.",
      ),
    );
  });
});

describe("resolveAgentCompetitorClassification", () => {
  it("uses the deterministic system suggestion when the visitor has not adjusted the domain", () => {
    const suggestion = deriveAgentCompetitorSuggestions(
      overlapData([overlap("leader.example", 12, 300)]),
      "acme.com",
    )[0]!;

    expect(
      resolveAgentCompetitorClassification(suggestion, {
        direct: [],
        indirect: [],
        excluded: [],
      }),
    ).toEqual({ classification: "direct", source: "system" });
  });

  it("gives a normalized manual adjustment precedence over the system suggestion", () => {
    const suggestion = deriveAgentCompetitorSuggestions(
      overlapData([overlap("leader.example", 12, 300)]),
      "acme.com",
    )[0]!;

    expect(
      resolveAgentCompetitorClassification(suggestion, {
        direct: [],
        indirect: ["WWW.LEADER.EXAMPLE"],
        excluded: [],
      }),
    ).toEqual({ classification: "indirect", source: "manual" });
  });

  it("fails closed to a manual exclusion if legacy manual groups contain the same normalized domain", () => {
    const suggestion = deriveAgentCompetitorSuggestions(
      overlapData([overlap("leader.example", 12, 300)]),
      "acme.com",
    )[0]!;

    expect(
      resolveAgentCompetitorClassification(suggestion, {
        direct: ["leader.example"],
        indirect: ["www.leader.example"],
        excluded: ["LEADER.EXAMPLE"],
      }),
    ).toEqual({ classification: "excluded", source: "manual" });
  });
});

describe("deriveAgentCompetitorDisplayFrame", () => {
  it("groups system defaults and normalized manual overrides exactly once while retaining manual-only domains", () => {
    const suggestions = deriveAgentCompetitorSuggestions(
      overlapData([
        overlap("system-direct.example", 10, 100),
        overlap("manual-override.example", 8, 90),
        overlap("excluded-override.example", 7, 80),
        overlap("system-indirect.example", 1, 70),
      ]),
      "acme.com",
    );

    const frame = deriveAgentCompetitorDisplayFrame(suggestions, {
      direct: ["WWW.MANUAL-ONLY.EXAMPLE", "legacy-duplicate.example"],
      indirect: [
        "MANUAL-OVERRIDE.EXAMPLE",
        "www.legacy-duplicate.example",
      ],
      excluded: [
        "www.excluded-override.example",
        "LEGACY-DUPLICATE.EXAMPLE",
      ],
    });
    const compact = {
      direct: frame.direct.map(({ domain, source, suggestion }) => ({
        domain,
        source,
        hasProviderSuggestion: suggestion !== null,
      })),
      indirect: frame.indirect.map(({ domain, source, suggestion }) => ({
        domain,
        source,
        hasProviderSuggestion: suggestion !== null,
      })),
      excluded: frame.excluded.map(({ domain, source, suggestion }) => ({
        domain,
        source,
        hasProviderSuggestion: suggestion !== null,
      })),
    };

    expect(compact).toEqual({
      direct: [
        {
          domain: "system-direct.example",
          source: "system",
          hasProviderSuggestion: true,
        },
        {
          domain: "manual-only.example",
          source: "manual",
          hasProviderSuggestion: false,
        },
      ],
      indirect: [
        {
          domain: "manual-override.example",
          source: "manual",
          hasProviderSuggestion: true,
        },
        {
          domain: "system-indirect.example",
          source: "system",
          hasProviderSuggestion: true,
        },
      ],
      excluded: [
        {
          domain: "excluded-override.example",
          source: "manual",
          hasProviderSuggestion: true,
        },
        {
          domain: "legacy-duplicate.example",
          source: "manual",
          hasProviderSuggestion: false,
        },
      ],
    });
    expect(
      Object.values(frame)
        .flat()
        .map(({ domain }) => domain),
    ).toHaveLength(6);
  });
});
