import { describe, expect, it } from "vitest";

import {
  buildContextProjectionV1,
  CONTEXT_PROJECTION_COMPILER_VERSION,
  CONTEXT_PROJECTION_SCHEMA_VERSION,
  parseContextProjectionV1,
} from "./context-projection.ts";
import { parseIcpForContextProjectionV1 } from "./icp.ts";

const PROFILE_CONTENT_HASH = "a".repeat(64);

function currentProfile(overrides: Record<string, unknown> = {}) {
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    productName: "Acme",
    oneLiner: "Ship faster",
    category: "Developer tools",
    productType: "saas",
    businessModels: ["usage", "subscription"],
    customerModel: "b2b",
    growthObjectives: ["increase_organic_traffic"],
    valueProposition: "Reliable releases",
    coreFeatures: ["Release orchestration"],
    targetMarkets: [
      { marketCode: "GB", priority: "secondary" },
      { marketCode: "US", priority: "primary" },
    ],
    targetAudiences: [
      {
        reviewStatus: "secondary",
        targetCompanyOrAudience: "Platform teams",
        useCases: ["Coordinate releases"],
        pains: ["Manual handoffs"],
        jtbd: ["Ship predictably"],
        outcomes: ["Fewer incidents"],
        triggers: ["Growing release volume"],
        buyerRoles: ["VP Engineering"],
        userRoles: ["Release manager"],
        barriers: ["Fragmented tools"],
        qualificationSignals: ["Dedicated platform team"],
        disqualifiers: ["No deployment workflow"],
      },
      {
        reviewStatus: "primary",
        targetCompanyOrAudience: "Global engineering teams",
        useCases: ["Automate release workflows"],
        pains: ["Slow deployments"],
        jtbd: ["Release safely"],
        outcomes: ["Shorter lead time"],
        triggers: ["Scaling delivery"],
        buyerRoles: ["CTO"],
        userRoles: ["Platform engineer"],
        barriers: ["Legacy automation"],
        qualificationSignals: ["Multiple services"],
        disqualifiers: ["Single manual release per year"],
      },
      {
        reviewStatus: "excluded",
        targetCompanyOrAudience: "Consumers",
      },
    ],
    competitorCandidates: [],
    ...overrides,
  };
}

function buildCurrent(overrides: Record<string, unknown> = {}) {
  return buildContextProjectionV1({
    profileContentHash: PROFILE_CONTENT_HASH,
    profile: currentProfile(overrides),
    siteLanguageCodes: ["en-us", "fr"],
  });
}

describe("contextProjection.v1 compiler", () => {
  it("compiles Product Profile 0.3 without borrowing legacy fields", () => {
    const projection = buildContextProjectionV1({
      profileContentHash: PROFILE_CONTENT_HASH,
      profile: currentProfile({
        targetAudiences: [],
        primaryConversion: {
          label: "legacy leak",
          type: "demo",
          targetUrl: "https://acme.test/demo",
        },
        priorityUrls: ["https://acme.test/pricing"],
        technicalConstraints: ["legacy technical leak"],
        resourceConstraints: ["legacy resource leak"],
      }),
      siteLanguageCodes: [],
    });

    expect(projection).toEqual({
      schemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
      compilerVersion: CONTEXT_PROJECTION_COMPILER_VERSION,
      profileGeneration: "product-profile.0.3.0",
      productRouting: {
        sourceKind: "product_profile",
        productName: "Acme",
        oneLiner: "Ship faster",
        productType: "saas",
        businessModels: ["subscription", "usage"],
        primaryMarket: "US",
        primaryAudience: null,
      },
      siteLanguage: {
        sourceKind: "site",
        state: "declared_empty",
        languageCodes: [],
      },
      primaryConversion: {
        state: "missing",
        sourceKind: "not_declared_for_generation",
      },
      priorityUrlSubjects: {
        state: "missing",
        sourceKind: "not_declared_for_generation",
      },
      declaredExecutionConstraints: {
        state: "missing",
        sourceKind: "not_declared_for_generation",
      },
    });
  });

  it("projects current product routing from the explicit primary facts", () => {
    expect(buildCurrent().productRouting).toEqual({
      sourceKind: "product_profile",
      productName: "Acme",
      oneLiner: "Ship faster",
      productType: "saas",
      businessModels: ["subscription", "usage"],
      primaryMarket: "US",
      primaryAudience: "Global engineering teams",
    });
  });

  it("extracts only explicit legacy conversion, URL, and execution constraints", () => {
    const projection = buildContextProjectionV1({
      profileContentHash: "b".repeat(64),
      profile: {
        productName: "Legacy Acme",
        oneLineDescription: "Legacy delivery platform",
        productType: "services",
        businessModels: ["project", "retainer", "project"],
        marketCodes: ["CA", "US"],
        segments: ["Operations teams"],
        primaryConversion: {
          label: "Book a call",
          type: "contact",
          targetUrl: "https://EXAMPLE.com/contact/?utm_source=profile",
        },
        priorityUrls: [
          "https://example.com/Zeta/",
          "https://EXAMPLE.com/pricing/?utm_source=profile",
          "https://example.com/Zeta",
        ],
        technicalConstraints: ["No plugin access", "Legacy CMS"],
        resourceConstraints: ["One engineer", "One engineer"],
      },
      siteLanguageCodes: ["fr-ca", "en-US"],
    });

    expect(projection.profileGeneration).toBe("legacy-icp.v1");
    expect(projection.productRouting).toEqual({
      sourceKind: "legacy_icp",
      productName: "Legacy Acme",
      oneLiner: "Legacy delivery platform",
      productType: "services",
      businessModels: ["project", "retainer"],
      primaryMarket: "CA",
      primaryAudience: "Operations teams",
    });
    expect(projection.siteLanguage).toEqual({
      sourceKind: "site",
      state: "declared_non_empty",
      languageCodes: ["fr-ca", "en-US"],
    });
    expect(projection.primaryConversion).toEqual({
      state: "available",
      sourceKind: "legacy_icp",
      value: {
        label: "Book a call",
        type: "contact",
        targetUrl: "https://EXAMPLE.com/contact/?utm_source=profile",
      },
    });
    expect(projection.priorityUrlSubjects).toEqual({
      state: "available",
      sourceKind: "legacy_icp",
      sourceHash: "b".repeat(64),
      normalizedRefs: [
        "https://example.com/Zeta",
        "https://example.com/pricing",
      ],
    });
    expect(projection.declaredExecutionConstraints).toEqual({
      state: "available",
      sourceKind: "legacy_icp",
      technical: ["Legacy CMS", "No plugin access"],
      resource: ["One engineer"],
    });
  });

  it("represents empty legacy optional facts as explicitly missing", () => {
    const projection = buildContextProjectionV1({
      profileContentHash: "c".repeat(64),
      profile: {
        productName: "Legacy",
        oneLineDescription: "Legacy product",
        productType: "software",
        businessModels: [],
        marketCodes: ["US"],
        segments: [],
        priorityUrls: [],
        technicalConstraints: [],
        resourceConstraints: [],
      },
      siteLanguageCodes: [],
    });

    expect(projection.primaryConversion).toEqual({
      state: "missing",
      sourceKind: "legacy_icp",
    });
    expect(projection.priorityUrlSubjects).toEqual({
      state: "missing",
      sourceKind: "legacy_icp",
    });
    expect(projection.declaredExecutionConstraints).toEqual({
      state: "missing",
      sourceKind: "legacy_icp",
    });
  });

  it("uses profileSchemaVersion as the only current-generation discriminator", () => {
    const legacy = buildContextProjectionV1({
      profileContentHash: "d".repeat(64),
      profile: {
        productName: "Looks current",
        oneLiner: "This field does not opt in",
        oneLineDescription: "Explicit legacy description",
        productType: "saas",
        businessModels: [],
        targetMarkets: [{ marketCode: "GB", priority: "primary" }],
        marketCodes: ["CA"],
        targetAudiences: [
          {
            reviewStatus: "primary",
            targetCompanyOrAudience: "New-looking audience",
          },
        ],
        segments: ["Legacy audience"],
      },
      siteLanguageCodes: ["en"],
    });

    expect(legacy.profileGeneration).toBe("legacy-icp.v1");
    expect(legacy.productRouting).toMatchObject({
      oneLiner: "Explicit legacy description",
      primaryMarket: "CA",
      primaryAudience: "Legacy audience",
    });

    expect(() =>
      buildContextProjectionV1({
        profileContentHash: "d".repeat(64),
        profile: {
          profileSchemaVersion: "product-profile.0.4.0",
          productName: "Future",
        },
        siteLanguageCodes: ["en"],
      }),
    ).toThrow(/unsupported profileSchemaVersion/u);
  });

  it("normalizes priority URL subjects deterministically under input reordering", () => {
    const urls = [
      "https://example.com/B/?b=2&a=1&utm_medium=email",
      "https://EXAMPLE.com/a/",
      "https://example.com/B?a=1&b=2",
    ];
    const compile = (priorityUrls: readonly string[]) =>
      buildContextProjectionV1({
        profileContentHash: "e".repeat(64),
        profile: {
          productName: "Legacy",
          oneLineDescription: "Legacy product",
          productType: "software",
          businessModels: [],
          marketCodes: ["US"],
          segments: [],
          priorityUrls,
        },
        siteLanguageCodes: ["en"],
      });

    expect(compile(urls).priorityUrlSubjects).toEqual(
      compile([...urls].reverse()).priorityUrlSubjects,
    );
    expect(compile(urls).priorityUrlSubjects).toMatchObject({
      normalizedRefs: [
        "https://example.com/B?a=1&b=2",
        "https://example.com/a",
      ],
    });
    expect(() => compile(["mailto:hello@example.com"])).toThrow(
      /HTTP\(S\)/u,
    );
  });

  it("validates RFC 5646 while preserving exact Site language authority", () => {
    const compile = (siteLanguageCodes: readonly string[]) =>
      buildContextProjectionV1({
        profileContentHash: PROFILE_CONTENT_HASH,
        profile: currentProfile(),
        siteLanguageCodes,
      });

    for (const languageCodes of [
      ["en-us", "x-private"],
      ["i-klingon", "sgn-BE-FR"],
    ]) {
      expect(compile(languageCodes).siteLanguage.languageCodes).toEqual(
        languageCodes,
      );
      expect(
        parseContextProjectionV1(compile(languageCodes)).siteLanguage
          .languageCodes,
      ).toEqual(languageCodes);
    }

    expect(() => compile(["en_US"])).toThrow(/valid BCP-47/u);
    expect(compile(["en", "en"]).siteLanguage.languageCodes).toEqual([
      "en",
      "en",
    ]);
  });
});

describe("contextProjection.v1 parser", () => {
  it("returns a fresh deeply frozen graph", () => {
    const built = buildCurrent();
    const parsed = parseContextProjectionV1(built);

    expect(parsed).toEqual(built);
    expect(parsed).not.toBe(built);
    expect(parsed.productRouting).not.toBe(built.productRouting);
    expect(parsed.siteLanguage).not.toBe(built.siteLanguage);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.productRouting)).toBe(true);
    expect(Object.isFrozen(parsed.productRouting.businessModels)).toBe(true);
    expect(Object.isFrozen(parsed.siteLanguage)).toBe(true);
    expect(Object.isFrozen(parsed.siteLanguage.languageCodes)).toBe(true);
    expect(Object.isFrozen(parsed.primaryConversion)).toBe(true);
    expect(Object.isFrozen(parsed.priorityUrlSubjects)).toBe(true);
    expect(Object.isFrozen(parsed.declaredExecutionConstraints)).toBe(true);
  });

  it("requires exact version literals and exact keys", () => {
    const valid = buildCurrent();
    expect(() =>
      parseContextProjectionV1({
        ...valid,
        schemaVersion: "context-projection.v2",
      }),
    ).toThrow(/schemaVersion/u);
    expect(() =>
      parseContextProjectionV1({
        ...valid,
        compilerVersion: "context-projection.compiler.1.0.1",
      }),
    ).toThrow(/compilerVersion/u);
    expect(() =>
      parseContextProjectionV1({ ...valid, mode: "auto" }),
    ).toThrow(/unknown field "mode"/u);
    expect(() =>
      parseContextProjectionV1({
        ...valid,
        productRouting: { ...valid.productRouting, severity: "high" },
      }),
    ).toThrow(/unknown field "severity"/u);
    expect(() =>
      parseContextProjectionV1({
        ...valid,
        siteLanguage: {
          sourceKind: "site",
          state: "declared_empty",
          languageCodes: undefined,
        },
      }),
    ).toThrow(/languageCodes must be an array/u);
  });

  it.each([
    "providerAvailability",
    "permission",
    "priorityBand",
    "confidence",
    "roi",
    "cadence",
    "workflowStatus",
  ])("rejects excluded mutable or inferred root field %s", (field) => {
    expect(() =>
      parseContextProjectionV1({ ...buildCurrent(), [field]: "invented" }),
    ).toThrow(/unknown field/u);
  });
});

describe("parseIcpForContextProjectionV1", () => {
  it("adapts current Product Profile content without borrowing legacy-looking fields", () => {
    const profile = currentProfile({
      primaryConversion: {
        label: "Do not borrow",
        type: "demo",
        targetUrl: "https://example.com/demo",
      },
      priorityUrls: ["https://example.com/pricing"],
      segments: ["Do not borrow"],
      offers: ["Do not borrow"],
    });
    const projection = buildContextProjectionV1({
      profileContentHash: PROFILE_CONTENT_HASH,
      profile,
      siteLanguageCodes: [],
    });

    const icp = parseIcpForContextProjectionV1(profile, projection);

    expect(icp).toMatchObject({
      productName: "Acme",
      oneLineDescription: "Ship faster",
      productType: "saas",
      businessModels: ["usage", "subscription"],
      marketCodes: ["GB", "US"],
      siteLanguageCodes: [],
      segments: ["Global engineering teams"],
      useCases: ["Automate release workflows"],
      offers: ["Release orchestration"],
      differentiators: ["Reliable releases"],
      primaryConversion: null,
      priorityUrls: [],
      growthObjectives: ["increase_organic_traffic"],
    });
    expect(icp.pains).toEqual(["Slow deployments"]);
  });

  it("hydrates legacy conversion and priority URLs from the frozen projection", () => {
    const profile = {
      productName: "Legacy",
      oneLineDescription: "Legacy product",
      productType: "software",
      businessModels: [],
      marketCodes: ["US"],
      siteLanguageCodes: ["de"],
      defaultDeliveryLocale: "de",
      segments: ["Teams"],
      primaryConversion: {
        label: "Demo",
        type: "demo",
        targetUrl: "https://example.com/demo",
      },
      priorityUrls: ["https://example.com/pricing/"],
    };
    const projection = buildContextProjectionV1({
      profileContentHash: "f".repeat(64),
      profile,
      siteLanguageCodes: ["en-GB"],
    });

    const icp = parseIcpForContextProjectionV1(profile, projection);

    expect(icp.siteLanguageCodes).toEqual(["en-GB"]);
    expect(icp.primaryConversion).toEqual({
      label: "Demo",
      type: "demo",
      targetUrl: "https://example.com/demo",
    });
    expect(icp.priorityUrls).toEqual(["https://example.com/pricing"]);
  });

  it("fails closed when profile and projection generations disagree", () => {
    const projection = buildCurrent();
    expect(() =>
      parseIcpForContextProjectionV1(
        {
          productName: "Legacy",
          oneLineDescription: "Legacy",
        },
        projection,
      ),
    ).toThrow(/profile generation/u);
  });
});
