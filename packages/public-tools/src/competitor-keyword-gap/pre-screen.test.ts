import { describe, expect, it } from "vitest";
import {
  competitorBrandTokens,
  preScreenCompetitorKeyword,
} from "./pre-screen.ts";

const METRIC = (value: number | null) =>
  value === null
    ? { availability: "provider_no_data" as const, value: null }
    : value === 0
      ? { availability: "explicit_zero" as const, value: 0 }
      : { availability: "available" as const, value };

function input(
  overrides: Partial<Parameters<typeof preScreenCompetitorKeyword>[0]> = {},
) {
  return {
    keyword: "approval workflow software",
    keywordDifficulty: METRIC(28),
    searchVolume: METRIC(2_900),
    bestCompetitorRank: 4,
    providerIntent: "commercial",
    competitorPages: {
      "one.example": "https://one.example/approval-workflows",
    },
    competitorDomains: ["one.example", "two.example"],
    ...overrides,
  };
}

describe("preScreenCompetitorKeyword", () => {
  it("prioritises a low-KD term a competitor holds on page one", () => {
    expect(preScreenCompetitorKeyword(input())).toEqual({
      band: "prioritize_serp_check",
      basis: "dfs_estimate",
      reason: "kd_low_rank_top10",
    });
  });

  it("marks mid-KD or page-two terms as stretch", () => {
    expect(
      preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(45) })).band,
    ).toBe("stretch");
    expect(preScreenCompetitorKeyword(input({ bestCompetitorRank: 14 })).band).toBe(
      "stretch",
    );
    expect(
      preScreenCompetitorKeyword(input({ bestCompetitorRank: 14 })).reason,
    ).toBe("kd_mid_rank_top20");
  });

  it("defers KD above 60 as a head term", () => {
    expect(
      preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(61) })),
    ).toEqual({
      band: "defer_head_term",
      basis: "dfs_estimate",
      reason: "kd_high",
    });
  });

  it("leaves rows without KD or volume unbanded rather than guessing", () => {
    expect(
      preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(null) }))
        .reason,
    ).toBe("dfs_metric_missing");
    expect(
      preScreenCompetitorKeyword(input({ searchVolume: METRIC(null) })).band,
    ).toBe("unbanded");
    expect(
      preScreenCompetitorKeyword(input({ searchVolume: METRIC(0) })).band,
    ).toBe("prioritize_serp_check");
  });

  it("routes a competitor brand term to the skip lane unless it is comparative", () => {
    expect(
      preScreenCompetitorKeyword(input({ keyword: "one webmaster tools" }))
        .reason,
    ).toBe("competitor_brand_token");
    expect(
      preScreenCompetitorKeyword(input({ keyword: "ONE.example login" })).band,
    ).toBe("defer_brand_navigational");
    expect(
      preScreenCompetitorKeyword(input({ keyword: "one alternatives" })).band,
    ).toBe("prioritize_serp_check");
    expect(preScreenCompetitorKeyword(input({ keyword: "two vs one" })).band).toBe(
      "prioritize_serp_check",
    );
    expect(preScreenCompetitorKeyword(input({ keyword: "one 替代" })).band).toBe(
      "prioritize_serp_check",
    );
  });

  it("routes a hostname-shaped keyword and a provider navigational intent to the skip lane", () => {
    expect(preScreenCompetitorKeyword(input({ keyword: "now.gg" })).reason).toBe(
      "domain_like_keyword",
    );
    expect(
      preScreenCompetitorKeyword(input({ providerIntent: "navigational" }))
        .reason,
    ).toBe("provider_navigational_intent");
  });

  it("recognises a competitor domain-profile page as another brand's navigational term", () => {
    expect(
      preScreenCompetitorKeyword(
        input({
          keyword: "hanime",
          competitorPages: {
            "one.example": "https://one.example/website/hanime.tv/overview/",
          },
        }),
      ),
    ).toEqual({
      band: "defer_brand_navigational",
      basis: "dfs_estimate",
      reason: "competitor_domain_profile_page",
    });
    expect(
      preScreenCompetitorKeyword(
        input({
          keyword: "approval software",
          competitorPages: {
            "one.example": "https://one.example/blog/approval-software-guide",
          },
        }),
      ).band,
    ).toBe("prioritize_serp_check");
  });

  it("does not let a short or generic-only label act as a brand token", () => {
    // "a.io" -> "a" is too short; "www.io" -> "www" is generic and "io" is too short.
    expect(
      competitorBrandTokens(["a.io", "www.io", "seo-tools.example"]),
    ).toEqual(["seo-tools"]);
    expect(competitorBrandTokens(["www.example.com"])).toEqual(["example"]);
  });

  it("derives the brand token from the registrable label, never a subdomain", () => {
    expect(
      competitorBrandTokens([
        "tools.ahrefs.com",
        "developers.example.com",
        "help.zendesk.com",
      ]),
    ).toEqual(["ahrefs", "example", "zendesk"]);
    // Second-level suffixes are skipped; "ox" and "co" are then too short.
    expect(
      competitorBrandTokens(["blog.example.co.uk", "ox.ac.uk", "co.uk"]),
    ).toEqual(["example"]);
    expect(
      preScreenCompetitorKeyword(
        input({
          keyword: "api developers guide",
          competitorDomains: ["developers.example.com"],
        }),
      ).band,
    ).toBe("prioritize_serp_check");
    expect(
      preScreenCompetitorKeyword(
        input({ keyword: "seo tools", competitorDomains: ["tools.ahrefs.com"] }),
      ).band,
    ).toBe("prioritize_serp_check");
    expect(
      preScreenCompetitorKeyword(
        input({
          keyword: "ahrefs webmaster tools",
          competitorDomains: ["tools.ahrefs.com"],
        }),
      ).reason,
    ).toBe("competitor_brand_token");
  });

  it("pins the KD and rank thresholds at their boundaries", () => {
    const reasonFor = (
      overrides: Partial<Parameters<typeof preScreenCompetitorKeyword>[0]>,
    ) => preScreenCompetitorKeyword(input(overrides)).reason;
    expect(reasonFor({ keywordDifficulty: METRIC(30) })).toBe("kd_low_rank_top10");
    expect(reasonFor({ keywordDifficulty: METRIC(31) })).toBe("kd_mid_rank_top20");
    expect(reasonFor({ keywordDifficulty: METRIC(60) })).toBe("kd_mid_rank_top20");
    expect(reasonFor({ keywordDifficulty: METRIC(61) })).toBe("kd_high");
    expect(reasonFor({ bestCompetitorRank: 10 })).toBe("kd_low_rank_top10");
    expect(reasonFor({ bestCompetitorRank: 11 })).toBe("kd_mid_rank_top20");
    // An explicit KD of zero is a real estimate, not a missing one.
    expect(
      preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(0) })),
    ).toEqual({
      band: "prioritize_serp_check",
      basis: "dfs_estimate",
      reason: "kd_low_rank_top10",
    });
  });

  it("lets a comparative query through even when the provider calls it navigational", () => {
    expect(
      preScreenCompetitorKeyword(
        input({
          keyword: "approval software alternatives",
          providerIntent: "navigational",
        }),
      ),
    ).toEqual({
      band: "prioritize_serp_check",
      basis: "dfs_estimate",
      reason: "kd_low_rank_top10",
    });
  });
});
