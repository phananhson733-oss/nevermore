// @input  -- valid website drafts, exact submitted URLs, and explicit relationship decisions
// @output -- provider-request projection, stable identity, and user-owned competitor fields
// @pos    -- focused contract tests for the website-profile competitor-discovery adapter

import { describe, expect, it } from "vitest";

import {
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileFieldProvenance,
} from "./contracts.ts";
import {
  classifyWebsiteCompetitor,
  classifyWebsiteCompetitorDraft,
  websiteCompetitorSearchIdentity,
  websiteCompetitorSearchRequest,
  type WebsiteCompetitorSearchRequest,
} from "./competitor-discovery.ts";

const OBSERVED_AT = "2026-08-28T00:00:00.000Z";

function profile(
  overrides: Partial<MarketingWebsiteProfileV1> = {},
): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    country: "US",
    locale: "en-US",
    ...overrides,
  };
}

function userEditProvenance(
  path: WebsiteProfileFieldProvenance["path"],
): WebsiteProfileFieldProvenance {
  return {
    path,
    derivation: "declared",
    confidence: "high",
    source: "user_edit",
    limitation: null,
    observedAt: null,
    evidenceUrls: [],
  };
}

function publicPageProvenance(
  path: WebsiteProfileFieldProvenance["path"],
): WebsiteProfileFieldProvenance {
  return {
    path,
    derivation: "observed",
    confidence: "medium",
    source: "public_page",
    limitation: "Public evidence may not reflect the current relationship.",
    observedAt: OBSERVED_AT,
    evidenceUrls: ["https://acme.example/evidence"],
  };
}

function unavailableProvenance(
  path: WebsiteProfileFieldProvenance["path"],
): WebsiteProfileFieldProvenance {
  return {
    path,
    derivation: "missing",
    confidence: "unknown",
    source: "not_available",
    limitation: "No relationship was declared.",
    observedAt: null,
    evidenceUrls: [],
  };
}

describe("websiteCompetitorSearchRequest", () => {
  it("projects the exact submitted URL and eligible Product Profile seeds", () => {
    const submittedUrl =
      "https://www.AstrologyWiki.com/learn?source=account#overview";
    const websiteProfile = profile({
      productName: "Astrology Wiki",
      categories: ["Astrology reference"],
      oneLinePositioning: "Evidence-led astrology explanations",
      coreFeatures: ["Natal chart guides", "Synastry explanations"],
      fieldProvenance: [
        userEditProvenance("/productName"),
        userEditProvenance("/categories"),
        userEditProvenance("/oneLinePositioning"),
        userEditProvenance("/coreFeatures"),
      ],
    });

    expect(
      websiteCompetitorSearchRequest(websiteProfile, submittedUrl),
    ).toEqual({
      url: submittedUrl,
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: [
        "Astrology Wiki",
        "Astrology reference",
        "Evidence-led astrology explanations",
        "Natal chart guides",
        "Synastry explanations",
      ],
    });
  });

  it.each(["", "us", "USA", "U1"])(
    "rejects an invalid exact market code: %j",
    (country) => {
      expect(
        websiteCompetitorSearchRequest(
          profile({ country }),
          "https://acme.example/path",
        ),
      ).toBeNull();
    },
  );

  it.each(["", "en-us", "iw-IL", "not_a_locale", null])(
    "rejects an invalid or non-canonical language identity: %j",
    (locale) => {
      const websiteProfile = {
        ...profile(),
        locale,
      } as unknown as MarketingWebsiteProfileV1;

      expect(
        websiteCompetitorSearchRequest(
          websiteProfile,
          "https://acme.example/path",
        ),
      ).toBeNull();
    },
  );

  it("keeps an empty eligible seed list as a valid domain-overlap request", () => {
    expect(
      websiteCompetitorSearchRequest(
        profile({
          productName: "Not eligible without accepted provenance",
          categories: ["Also not eligible"],
        }),
        "https://acme.example/exact?source=account",
      ),
    ).toEqual({
      url: "https://acme.example/exact?source=account",
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: [],
    });
  });
});

describe("websiteCompetitorSearchIdentity", () => {
  const request: WebsiteCompetitorSearchRequest = {
    url: "https://acme.example/pricing?source=account",
    marketCode: "US",
    languageTag: "en-US",
    targetQuery: "",
    productProfileSearchSeeds: ["Acme Analytics", "SEO platform"],
  };

  it("is stable across cosmetic seed whitespace and casing", () => {
    expect(
      websiteCompetitorSearchIdentity({
        ...request,
        productProfileSearchSeeds: [
          "  ACME\tAnalytics  ",
          "seo PLATFORM",
        ],
      }),
    ).toBe(websiteCompetitorSearchIdentity(request));
  });

  it("serializes every identity field including the literal empty target query", () => {
    expect(JSON.parse(websiteCompetitorSearchIdentity(request))).toEqual([
      "https://acme.example/pricing?source=account",
      "US",
      "en-US",
      "",
      '["acme analytics","seo platform"]',
    ]);
  });

  it.each([
    {
      label: "normalized seed",
      change: { productProfileSearchSeeds: ["Acme Analytics", "GEO platform"] },
    },
    { label: "market", change: { marketCode: "GB" } },
    { label: "locale", change: { languageTag: "en-GB" } },
    {
      label: "URL",
      change: { url: "https://acme.example/about?source=account" },
    },
  ] satisfies readonly {
    readonly label: string;
    readonly change: Partial<WebsiteCompetitorSearchRequest>;
  }[])("changes when the $label changes", ({ change }) => {
    expect(
      websiteCompetitorSearchIdentity({ ...request, ...change }),
    ).not.toBe(websiteCompetitorSearchIdentity(request));
  });
});

describe("classifyWebsiteCompetitor", () => {
  const relationshipPaths = [
    "/directCompetitors",
    "/indirectAlternatives",
    "/excludedAlternatives",
  ] as const;

  const expectedGroups = {
    direct: {
      directCompetitors: [
        "direct-a.example",
        "direct-b.example",
        "rival.example",
      ],
      indirectAlternatives: ["indirect-a.example"],
      excludedAlternatives: ["excluded-a.example"],
    },
    indirect: {
      directCompetitors: ["direct-a.example", "direct-b.example"],
      indirectAlternatives: ["indirect-a.example", "rival.example"],
      excludedAlternatives: ["excluded-a.example"],
    },
    excluded: {
      directCompetitors: ["direct-a.example", "direct-b.example"],
      indirectAlternatives: ["indirect-a.example"],
      excludedAlternatives: ["excluded-a.example", "rival.example"],
    },
  } as const;

  it("keeps an exact single-bucket classification fully idempotent", () => {
    const directProvenance = publicPageProvenance("/directCompetitors");
    const before = profile({
      productName: "Acme",
      directCompetitors: ["a.example", "rival.example", "b.example"],
      indirectAlternatives: ["indirect.example"],
      excludedAlternatives: ["excluded.example"],
      fieldProvenance: [
        userEditProvenance("/productName"),
        directProvenance,
        publicPageProvenance("/indirectAlternatives"),
        publicPageProvenance("/excludedAlternatives"),
      ],
    });
    const snapshot = structuredClone(before);

    const after = classifyWebsiteCompetitor(
      before,
      "rival.example",
      "direct",
    );

    expect({
      directCompetitors: after.directCompetitors,
      indirectAlternatives: after.indirectAlternatives,
      excludedAlternatives: after.excludedAlternatives,
      fieldProvenance: after.fieldProvenance,
    }).toEqual({
      directCompetitors: before.directCompetitors,
      indirectAlternatives: before.indirectAlternatives,
      excludedAlternatives: before.excludedAlternatives,
      fieldProvenance: before.fieldProvenance,
    });
    expect(before).toEqual(snapshot);
    expect(after).not.toBe(before);
  });

  it.each(["direct", "indirect", "excluded"] as const)(
    "moves a domain into only the %s group with exact changed-list provenance",
    (classification) => {
      const productProvenance = userEditProvenance("/productName");
      const before = profile({
        productName: "Acme",
        directCompetitors: [
          "direct-a.example",
          "WWW.RIVAL.EXAMPLE",
          "direct-b.example",
        ],
        indirectAlternatives: ["rival.example", "indirect-a.example"],
        excludedAlternatives: ["rival.example.", "excluded-a.example"],
        fieldProvenance: [
          productProvenance,
          ...relationshipPaths.map(publicPageProvenance),
        ],
      });
      const snapshot = structuredClone(before);

      const after = classifyWebsiteCompetitor(
        before,
        " WWW.Rival.Example. ",
        classification,
      );

      expect({
        directCompetitors: after.directCompetitors,
        indirectAlternatives: after.indirectAlternatives,
        excludedAlternatives: after.excludedAlternatives,
      }).toEqual(expectedGroups[classification]);
      expect(
        [
          after.directCompetitors,
          after.indirectAlternatives,
          after.excludedAlternatives,
        ].filter((values) => values.includes("rival.example")),
      ).toHaveLength(1);
      for (const path of relationshipPaths) {
        expect(
          after.fieldProvenance.find((entry) => entry.path === path),
        ).toEqual(userEditProvenance(path));
      }
      expect(after.fieldProvenance[0]).toEqual(productProvenance);
      expect(before).toEqual(snapshot);
      expect(after).not.toBe(before);
    },
  );

  it("preserves unrelated domains, order, and unchanged provenance", () => {
    const productProvenance = userEditProvenance("/productName");
    const directProvenance = unavailableProvenance("/directCompetitors");
    const indirectProvenance = publicPageProvenance(
      "/indirectAlternatives",
    );
    const excludedProvenance = publicPageProvenance(
      "/excludedAlternatives",
    );
    const before = profile({
      productName: "Acme",
      directCompetitors: [],
      indirectAlternatives: [
        "keep-before.example",
        "rival.example",
        "keep-after.example",
      ],
      excludedAlternatives: ["excluded-a.example", "excluded-b.example"],
      fieldProvenance: [
        productProvenance,
        directProvenance,
        indirectProvenance,
        excludedProvenance,
      ],
    });

    const after = classifyWebsiteCompetitor(before, "rival.example", "direct");

    expect(after.directCompetitors).toEqual(["rival.example"]);
    expect(after.indirectAlternatives).toEqual([
      "keep-before.example",
      "keep-after.example",
    ]);
    expect(after.excludedAlternatives).toEqual([
      "excluded-a.example",
      "excluded-b.example",
    ]);
    expect(after.fieldProvenance.map(({ path }) => path)).toEqual(
      before.fieldProvenance.map(({ path }) => path),
    );
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/directCompetitors",
      ),
    ).toEqual(userEditProvenance("/directCompetitors"));
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/indirectAlternatives",
      ),
    ).toEqual(userEditProvenance("/indirectAlternatives"));
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/excludedAlternatives",
      ),
    ).toEqual(excludedProvenance);
    expect(after.fieldProvenance[0]).toEqual(productProvenance);
  });

  it("adds exact provenance when a changed relationship list had none", () => {
    const after = classifyWebsiteCompetitor(
      profile(),
      "rival.example",
      "direct",
    );

    expect(after.fieldProvenance).toEqual([
      userEditProvenance("/directCompetitors"),
    ]);
  });

  it("propagates the pure classifier TypeError for an invalid domain", () => {
    expect(() =>
      classifyWebsiteCompetitor(profile(), "localhost", "direct"),
    ).toThrowError(
      new TypeError(
        "Competitor domain must be a normalized public hostname.",
      ),
    );
  });

  it("keeps strict parsing at the full-profile boundary", () => {
    expect(() =>
      classifyWebsiteCompetitor(
        profile({ trustSignals: [""] }),
        "rival.example",
        "direct",
      ),
    ).toThrow();
  });
});

describe("classifyWebsiteCompetitorDraft", () => {
  it("classifies a transient draft while preserving unrelated blank fields", () => {
    const directProvenance = publicPageProvenance("/directCompetitors");
    const indirectProvenance = publicPageProvenance(
      "/indirectAlternatives",
    );
    const trustProvenance = userEditProvenance("/trustSignals");
    const before: MarketingWebsiteProfileV1 = profile({
      businessModel: "Preserve this unrelated field",
      trustSignals: [""],
      directCompetitors: ["direct.example"],
      indirectAlternatives: ["rival.example", "keep.example"],
      excludedAlternatives: ["excluded.example"],
      fieldProvenance: [
        trustProvenance,
        directProvenance,
        indirectProvenance,
        publicPageProvenance("/excludedAlternatives"),
      ],
    });
    const snapshot = structuredClone(before);

    const after = classifyWebsiteCompetitorDraft(
      before,
      "rival.example",
      "direct",
    );

    expect(after).not.toBe(before);
    expect(after.businessModel).toBe("Preserve this unrelated field");
    expect(after.trustSignals).toEqual([""]);
    expect(after.directCompetitors).toEqual([
      "direct.example",
      "rival.example",
    ]);
    expect(after.indirectAlternatives).toEqual(["keep.example"]);
    expect(after.excludedAlternatives).toEqual(["excluded.example"]);
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/directCompetitors",
      ),
    ).toEqual(userEditProvenance("/directCompetitors"));
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/indirectAlternatives",
      ),
    ).toEqual(userEditProvenance("/indirectAlternatives"));
    expect(
      after.fieldProvenance.find(({ path }) => path === "/trustSignals"),
    ).toEqual(trustProvenance);
    expect(before).toEqual(snapshot);
  });

  it("preserves blank selected and unrelated relationship rows", () => {
    const excludedProvenance = publicPageProvenance(
      "/excludedAlternatives",
    );
    const before: MarketingWebsiteProfileV1 = profile({
      directCompetitors: ["", "direct.example"],
      indirectAlternatives: ["rival.example", "indirect.example"],
      excludedAlternatives: ["", "excluded.example"],
      fieldProvenance: [
        publicPageProvenance("/directCompetitors"),
        publicPageProvenance("/indirectAlternatives"),
        excludedProvenance,
      ],
    });

    const after = classifyWebsiteCompetitorDraft(
      before,
      "rival.example",
      "direct",
    );

    expect(after.directCompetitors).toEqual([
      "",
      "direct.example",
      "rival.example",
    ]);
    expect(after.indirectAlternatives).toEqual(["indirect.example"]);
    expect(after.excludedAlternatives).toEqual(["", "excluded.example"]);
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/directCompetitors",
      ),
    ).toEqual(userEditProvenance("/directCompetitors"));
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/indirectAlternatives",
      ),
    ).toEqual(userEditProvenance("/indirectAlternatives"));
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/excludedAlternatives",
      ),
    ).toEqual(excludedProvenance);
  });

  it("throws the exact classifier error for an invalid domain", () => {
    expect(() =>
      classifyWebsiteCompetitorDraft(
        profile({ trustSignals: [""] }),
        "localhost",
        "direct",
      ),
    ).toThrowError(
      new TypeError(
        "Competitor domain must be a normalized public hostname.",
      ),
    );
  });

  it("keeps an exact same-group transient draft order and provenance", () => {
    const directProvenance = publicPageProvenance("/directCompetitors");
    const before: MarketingWebsiteProfileV1 = profile({
      trustSignals: [""],
      directCompetitors: ["", "before.example", "rival.example"],
      indirectAlternatives: ["indirect.example"],
      excludedAlternatives: ["excluded.example"],
      fieldProvenance: [
        directProvenance,
        publicPageProvenance("/indirectAlternatives"),
        publicPageProvenance("/excludedAlternatives"),
      ],
    });
    const snapshot = structuredClone(before);

    const after = classifyWebsiteCompetitorDraft(
      before,
      "rival.example",
      "direct",
    );

    expect(after).not.toBe(before);
    expect(after.directCompetitors).toEqual(before.directCompetitors);
    expect(after.indirectAlternatives).toEqual(before.indirectAlternatives);
    expect(after.excludedAlternatives).toEqual(before.excludedAlternatives);
    expect(after.fieldProvenance).toEqual(before.fieldProvenance);
    expect(
      after.fieldProvenance.find(
        ({ path }) => path === "/directCompetitors",
      ),
    ).toEqual(directProvenance);
    expect(before).toEqual(snapshot);
  });
});
