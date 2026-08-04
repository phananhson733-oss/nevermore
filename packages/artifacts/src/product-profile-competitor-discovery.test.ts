import { describe, expect, it } from "vitest";
import { discoverProductProfileCompetitors } from "./product-profile-competitor-discovery.ts";

const observedAt = "2026-08-02T00:00:00.000Z";

function observation(
  index: number,
  domain: string,
  intersections: number,
  organicEstimatedTrafficVolume = 100,
) {
  return {
    observationId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    domain,
    intersections,
    organicEstimatedTrafficVolume,
    observedAt,
  };
}

describe("Product Profile DataForSEO competitor discovery", () => {
  it("filters non-competitors, classifies direct/indirect cohorts, and never invents similarity", () => {
    const result = discoverProductProfileCompetitors({
      targetDomain: "relayops.com",
      marketCode: "US",
      outputLocale: "en",
      observations: [
        observation(1, "google.com", 500),
        observation(2, "relayops.com", 100),
        observation(3, "guidecx.com", 40, 900),
        observation(4, "rocketlane.com", 18, 700),
        observation(5, "asana.com", 7, 2_000),
      ],
    });

    expect(result.map((candidate) => candidate.domain)).toEqual([
      "guidecx.com",
      "rocketlane.com",
      "asana.com",
    ]);
    expect(result[0]).toMatchObject({
      name: "Guidecx",
      relationship: "direct",
      analysisScope: [
        "positioning",
        "product_capability",
        "keyword_gap",
        "serp_visibility",
      ],
      similarity: null,
      confidence: "medium",
    });
    expect(result[2]).toMatchObject({
      relationship: "indirect",
      analysisScope: ["keyword_gap", "content", "serp_visibility"],
      similarity: null,
    });
    expect(result[0]?.reason).toContain("40 shared organic-search keywords");
  });

  it("writes reviewable reasons in the selected product language", () => {
    const [candidate] = discoverProductProfileCompetitors({
      targetDomain: "relayops.com",
      marketCode: "US",
      outputLocale: "zh-CN",
      observations: [observation(1, "guidecx.com", 12)],
    });

    expect(candidate?.reason).toContain("12 个自然搜索关键词交集");
    expect(candidate?.reason).toContain("默认纳入直接竞品");
  });

  it("classifies the seed-based SERP fallback without claiming keyword intersections", () => {
    const result = discoverProductProfileCompetitors({
      targetDomain: "relayops.com",
      marketCode: "US",
      outputLocale: "zh-CN",
      observations: [
        {
          sourceKind: "serp_competitor",
          observationId: "10000000-0000-4000-8000-000000000001",
          domain: "guidecx.com",
          rating: 100,
          keywordsCount: 4,
          relevantSerpItems: 3,
          organicEstimatedTrafficVolume: 900,
          observedAt,
        },
        {
          sourceKind: "serp_competitor",
          observationId: "10000000-0000-4000-8000-000000000002",
          domain: "asana.com",
          rating: 30,
          keywordsCount: 1,
          relevantSerpItems: 1,
          organicEstimatedTrafficVolume: 2_000,
          observedAt,
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        domain: "guidecx.com",
        relationship: "direct",
        confidence: "medium",
      }),
      expect.objectContaining({
        domain: "asana.com",
        relationship: "indirect",
        confidence: "low",
      }),
    ]);
    expect(result[0]?.reason).toContain("冻结种子 SERP");
    expect(result[0]?.reason).not.toContain("关键词交集");
  });
});
