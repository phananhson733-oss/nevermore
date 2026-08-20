import { describe, expect, it } from "vitest";

import type { DomainRegistrationEvidence } from "@sf/sources";
import type { KeywordSerpSampleResult } from "./keyword-opportunity-handler.ts";
import {
  buildKeywordSignalEvidence,
  keywordSiteTrafficThreshold,
} from "./keyword-signal-evidence.ts";

const OBSERVED_AT = "2026-08-20T12:00:00.000Z";

function result(
  domain: string,
  position: number,
  url: string | null = `https://${domain}/answer`,
): KeywordSerpSampleResult["results"][number] {
  return { domain, position, title: `Answer from ${domain}`, url };
}

function sample(
  overrides: Partial<KeywordSerpSampleResult> = {},
): KeywordSerpSampleResult {
  return {
    keyword: "clinic billing question",
    status: "complete",
    failureReason: null,
    observedAt: OBSERVED_AT,
    results: [result("alpha.com", 1), result("beta.com", 2)],
    pageItemTypes: [],
    aiOverview: null,
    communityItems: [],
    ...overrides,
  };
}

function registration(
  domain: string,
  registeredAt: string | null,
): DomainRegistrationEvidence {
  return {
    domain,
    availability: registeredAt === null ? "unavailable" : "available",
    registeredAt,
    observedAt: OBSERVED_AT,
    sourceHost: "rdap.example",
    reason: registeredAt === null ? "registration_event_missing" : null,
  };
}

function evidence(
  overrides: Partial<Parameters<typeof buildKeywordSignalEvidence>[0]> = {},
) {
  return buildKeywordSignalEvidence({
    sample: sample(),
    observedAt: OBSERVED_AT,
    siteDomainRank: 200,
    domainTraffic: new Map([
      ["alpha.com", 20_000],
      ["beta.com", 25_000],
    ]),
    domainRegistrations: new Map([
      ["alpha.com", registration("alpha.com", "2020-01-01T00:00:00.000Z")],
      ["beta.com", registration("beta.com", "2020-01-01T00:00:00.000Z")],
    ]),
    marketCode: "US",
    languageCode: "en",
    ...overrides,
  });
}

describe("keywordSiteTrafficThreshold", () => {
  it.each([
    [1, 5_000],
    [200, 5_000],
    [201, 50_000],
    [500, 50_000],
    [501, 100_000],
    [1_000, 100_000],
  ])("maps site rank %i to threshold %i", (rank, threshold) => {
    expect(keywordSiteTrafficThreshold(rank)).toBe(threshold);
  });

  it.each([null, 0, -1, 1_001, 1.5, Number.NaN])(
    "keeps unavailable or out-of-range site rank %s unavailable",
    (rank) => {
      expect(keywordSiteTrafficThreshold(rank)).toBeNull();
    },
  );
});

describe("young-domain signal", () => {
  it("includes the exact 24-calendar-month boundary", () => {
    const built = evidence({
      domainRegistrations: new Map([
        [
          "alpha.com",
          registration("alpha.com", "2024-08-20T12:00:00.000Z"),
        ],
        ["beta.com", registration("beta.com", "2020-01-01T00:00:00.000Z")],
      ]),
    });

    expect(built.signals.youngDomain).toEqual({
      state: "observed",
      observation: {
        domain: "alpha.com",
        registrationDate: "2024-08-20T12:00:00.000Z",
        observedAt: OBSERVED_AT,
        ageMonths: 24,
      },
    });
  });

  it("chooses the latest registration date, then the stable domain tie", () => {
    const built = evidence({
      sample: sample({
        results: [
          result("zeta.com", 1),
          result("alpha.com", 2),
          result("newest.com", 3),
        ],
      }),
      domainRegistrations: new Map([
        ["zeta.com", registration("zeta.com", "2026-01-01T00:00:00.000Z")],
        [
          "alpha.com",
          registration("alpha.com", "2026-01-01T00:00:00.000Z"),
        ],
        [
          "newest.com",
          registration("newest.com", "2026-02-01T00:00:00.000Z"),
        ],
      ]),
    });

    expect(built.signals.youngDomain).toMatchObject({
      state: "observed",
      observation: { domain: "newest.com" },
    });

    const tied = evidence({
      sample: sample({
        results: [result("zeta.com", 1), result("alpha.com", 2)],
      }),
      domainRegistrations: new Map([
        ["zeta.com", registration("zeta.com", "2026-01-01T00:00:00.000Z")],
        [
          "alpha.com",
          registration("alpha.com", "2026-01-01T00:00:00.000Z"),
        ],
      ]),
    });
    expect(tied.signals.youngDomain).toMatchObject({
      state: "observed",
      observation: { domain: "alpha.com" },
    });
  });

  it("uses the RDAP registrable-domain key even when the result uses a private suffix", () => {
    const built = evidence({
      sample: sample({ results: [result("tenant.blogspot.com", 1)] }),
      domainRegistrations: new Map([
        [
          "blogspot.com",
          registration("blogspot.com", "2026-01-01T00:00:00.000Z"),
        ],
      ]),
    });

    expect(built.signals.youngDomain).toMatchObject({
      state: "observed",
      observation: { domain: "blogspot.com" },
    });
  });

  it("lets distinct private-suffix hosts share their one registrable-domain observation", () => {
    const built = evidence({
      sample: sample({
        results: [
          result("one.blogspot.com", 1),
          result("two.blogspot.com", 2),
        ],
      }),
      domainRegistrations: new Map([
        [
          "blogspot.com",
          registration("blogspot.com", "2020-01-01T00:00:00.000Z"),
        ],
      ]),
    });

    expect(built.signals.youngDomain).toEqual({
      state: "not_observed",
      observation: null,
    });
  });

  it("returns not observed only when every distinct domain has usable registration evidence", () => {
    expect(evidence().signals.youngDomain).toEqual({
      state: "not_observed",
      observation: null,
    });

    const partial = evidence({
      domainRegistrations: new Map([
        ["alpha.com", registration("alpha.com", "2020-01-01T00:00:00.000Z")],
      ]),
    });
    expect(partial.signals.youngDomain).toMatchObject({
      state: "unavailable",
      observation: null,
    });
  });
});

describe("low-organic-traffic signal", () => {
  it("chooses the minimum known ETV, with a stable domain tie", () => {
    const built = evidence({
      siteDomainRank: 500,
      domainTraffic: new Map([
        ["alpha.com", 200],
        ["beta.com", 100],
      ]),
    });
    expect(built.signals.lowOrganicTrafficDomain).toEqual({
      state: "observed",
      observation: {
        domain: "beta.com",
        organicEtv: 100,
        threshold: 50_000,
        marketCode: "US",
        languageCode: "en",
        observedAt: OBSERVED_AT,
      },
    });

    const tied = evidence({
      siteDomainRank: 500,
      domainTraffic: new Map([
        ["beta.com", 100],
        ["alpha.com", 100],
      ]),
    });
    expect(tied.signals.lowOrganicTrafficDomain).toMatchObject({
      state: "observed",
      observation: { domain: "alpha.com" },
    });
  });

  it("lets a known positive survive unresolved sibling domains", () => {
    const built = evidence({
      siteDomainRank: 200,
      domainTraffic: new Map([
        ["alpha.com", 4_999],
        ["beta.com", null],
      ]),
    });
    expect(built.signals.lowOrganicTrafficDomain).toMatchObject({
      state: "observed",
      observation: { domain: "alpha.com", threshold: 5_000 },
    });
  });

  it("returns not observed only when every result domain is known and none is below the threshold", () => {
    expect(evidence().signals.lowOrganicTrafficDomain).toEqual({
      state: "not_observed",
      observation: null,
    });

    for (const overrides of [
      { siteDomainRank: 0 },
      { siteDomainRank: null },
      { domainTraffic: null },
      { domainTraffic: new Map([["alpha.com", 20_000]]) },
      {
        domainTraffic: new Map([
          ["alpha.com", 20_000],
          ["beta.com", null],
        ]),
      },
    ] satisfies readonly Partial<
      Parameters<typeof buildKeywordSignalEvidence>[0]
    >[]) {
      expect(
        evidence(overrides).signals.lowOrganicTrafficDomain,
      ).toMatchObject({ state: "unavailable", observation: null });
    }
  });
});

describe("community signal", () => {
  it("prefers the best concrete provider item over an organic-domain fallback", () => {
    const built = evidence({
      sample: sample({
        results: [result("old.reddit.com", 1)],
        communityItems: [
          {
            type: "forum",
            position: 5,
            title: "Forum thread",
            url: "https://forum.example/thread",
            domain: "forum.example",
          },
          {
            type: "discussions_and_forums",
            position: 3,
            title: "Better thread",
            url: "https://community.example/thread",
            domain: "community.example",
          },
        ],
      }),
    });

    expect(built.signals.communityResult).toEqual({
      state: "observed",
      observation: {
        domain: "community.example",
        url: "https://community.example/thread",
        position: 3,
        source: "provider_item_type",
      },
    });
  });

  it.each([
    "reddit.com",
    "old.reddit.com",
    "quora.com",
    "stackexchange.com",
    "math.stackexchange.com",
    "stackoverflow.com",
    "news.ycombinator.com",
  ])("recognises the conservative fallback domain %s", (domain) => {
    const built = evidence({
      sample: sample({
        results: [result(domain, 4)],
        communityItems: null,
      }),
    });
    expect(built.signals.communityResult).toMatchObject({
      state: "observed",
      observation: { domain, source: "domain_fallback" },
    });
  });

  it("does not classify Medium or suffix-spoofed domains as community", () => {
    const built = evidence({
      sample: sample({
        results: [
          result("medium.com", 1),
          result("notreddit.com", 2),
          result("reddit.com.evil.test", 3),
        ],
        communityItems: [],
      }),
    });
    expect(built.signals.communityResult).toEqual({
      state: "not_observed",
      observation: null,
    });
  });

  it("keeps an unreported provider community list unavailable when no fallback exists", () => {
    const built = evidence({
      sample: sample({ communityItems: null }),
    });
    expect(built.signals.communityResult).toMatchObject({
      state: "unavailable",
      observation: null,
    });
  });
});

describe("AI Overview evidence", () => {
  it("retains a provider block without assessing it", () => {
    const built = evidence({
      sample: sample({
        pageItemTypes: ["ai_overview"],
        aiOverview: {
          markdown: "A provider answer",
          isAsync: null,
          references: [],
        },
      }),
    });
    expect(built.aiOverview).toEqual({
      availability: "observed",
      markdown: "A provider answer",
      loadedAsync: null,
      answerAssessment: "unavailable",
      reason: "not_assessed",
      modelId: null,
      promptVersion: null,
    });
  });

  it("reports observed-but-unavailable content when the item type has no block", () => {
    const built = evidence({
      sample: sample({ pageItemTypes: ["ai_overview"], aiOverview: null }),
    });
    expect(built.aiOverview).toEqual({
      availability: "observed",
      markdown: null,
      loadedAsync: null,
      answerAssessment: "unavailable",
      reason: "content_unavailable",
      modelId: null,
      promptVersion: null,
    });
  });

  it("distinguishes a reported absence from unreported item types", () => {
    expect(evidence().aiOverview).toMatchObject({
      availability: "not_observed",
      markdown: null,
      loadedAsync: null,
    });
    expect(
      evidence({ sample: sample({ pageItemTypes: null }) }).aiOverview,
    ).toMatchObject({
      availability: "unavailable",
      markdown: null,
      loadedAsync: null,
    });
  });
});

describe("unavailable SERP", () => {
  it("keeps every required signal and AI Overview unavailable", () => {
    const built = evidence({
      sample: sample({
        status: "unavailable",
        failureReason: "provider_unavailable",
        observedAt: null,
        results: [],
      }),
    });

    expect(built.signals.youngDomain.state).toBe("unavailable");
    expect(built.signals.lowOrganicTrafficDomain.state).toBe("unavailable");
    expect(built.signals.communityResult.state).toBe("unavailable");
    expect(built.aiOverview).toMatchObject({
      availability: "unavailable",
      answerAssessment: "unavailable",
    });
  });
});
