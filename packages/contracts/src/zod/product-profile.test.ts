import { describe, expect, it } from "vitest";
import {
  ConfirmedProductProfile,
  createInitialProductProfileDraft,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  ProductProfileDraft,
  ProductProfileSchemaVersion,
} from "./product-profile.ts";

const ids = {
  site: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
  invocation: "33333333-3333-4333-8333-333333333333",
  audience: "44444444-4444-4444-8444-444444444444",
  competitor: "55555555-5555-4555-8555-555555555555",
  pageSnapshot: "66666666-6666-4666-8666-666666666666",
  evidence: "77777777-7777-4777-8777-777777777777",
  other: "88888888-8888-4888-8888-888888888888",
} as const;

const now = "2026-07-22T08:00:00Z";

function completeProfile() {
  return {
    profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourceSiteId: ids.site,
    sourcePageUrl: "https://example.com/products/growth?market=us",
    sourceSnapshotId: ids.snapshot,
    analysisInvocationId: ids.invocation,
    generatedAt: now,
    businessHint: "Enterprise and consumer analytics",
    productName: "Example Growth",
    oneLiner: "Evidence-grounded growth analysis",
    category: "Growth analytics",
    productType: "Managed software and advisory service",
    businessModels: ["subscription", "professional services"],
    valueProposition: "Find and execute measurable growth opportunities.",
    coreFeatures: ["Technical diagnostics", "Audience research"],
    targetMarkets: [
      { marketCode: "US", priority: "primary" },
      { marketCode: "GB", priority: "secondary" },
    ],
    targetAudiences: [
      {
        candidateId: ids.audience,
        reviewStatus: "primary",
        targetCompanyOrAudience: "Growth teams and independent creators",
        buyerRoles: ["VP Growth", "Owner"],
        userRoles: ["SEO lead", "Creator"],
        useCases: ["Prioritize growth work"],
        triggers: ["Organic acquisition has stalled"],
        pains: ["Recommendations are disconnected from evidence"],
        jtbd: ["Choose the next highest-value growth action"],
        outcomes: ["A measurable, reviewed action plan"],
        barriers: ["Incomplete source coverage"],
        qualificationSignals: ["Owns a public web property"],
        disqualifiers: ["No permission to inspect the target site"],
      },
    ],
    competitorCandidates: [
      {
        candidateId: ids.competitor,
        name: "Peer Example",
        domain: "peer.example.com",
        relationship: "direct",
        analysisScope: ["positioning", "product_capability"],
        similarity: 0.82,
        reason: "Overlapping audience and workflow",
        reviewStatus: "approved",
        confidence: "medium",
      },
    ],
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "observed",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: ids.evidence,
            kind: "pageSnapshot",
            pageSnapshotId: ids.pageSnapshot,
          },
        ],
        limitation: null,
        observedAt: now,
      },
    ],
    missingFields: [],
    conflictingFields: [],
  } as const;
}

describe("ProductProfileDraft", () => {
  it("uses the exact version and permits an honest incomplete draft", () => {
    expect(ProductProfileSchemaVersion.parse(PRODUCT_PROFILE_SCHEMA_VERSION)).toBe(
      "product-profile.0.3.0",
    );
    expect(
      ProductProfileDraft.parse({
        ...completeProfile(),
        sourceSnapshotId: null,
        analysisInvocationId: null,
        generatedAt: null,
        productName: null,
        oneLiner: null,
        category: null,
        productType: null,
        businessModels: [],
        valueProposition: null,
        coreFeatures: [],
        targetMarkets: [],
        targetAudiences: [],
        competitorCandidates: [],
        fieldProvenance: [],
        missingFields: ["/productName"],
      }).productName,
    ).toBeNull();
  });

  it("is strict at the top level and inside candidates", () => {
    expect(
      ProductProfileDraft.safeParse({ ...completeProfile(), invented: true }).success,
    ).toBe(false);
    const value = completeProfile();
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        targetAudiences: [
          { ...value.targetAudiences[0], invented: "not allowed" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires normalized competitor hostnames and bounded similarity", () => {
    const value = completeProfile();
    for (const domain of [
      "HTTPS://PEER.EXAMPLE.COM",
      "peer.example.com/pricing",
      "peer.example.com:443",
    ]) {
      expect(
        ProductProfileDraft.safeParse({
          ...value,
          competitorCandidates: [
            { ...value.competitorCandidates[0], domain },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        competitorCandidates: [
          { ...value.competitorCandidates[0], similarity: 1.01 },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires canonical or declared evidence anchors and unique evidenceRefIds", () => {
    const value = completeProfile();
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: [
          {
            ...value.fieldProvenance[0],
            evidenceRefs: [
              {
                evidenceRefId: ids.evidence,
                kind: "pageSnapshot",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: [
          value.fieldProvenance[0],
          {
            path: "/category",
            derivation: "inferred",
            confidence: "low",
            evidenceRefs: [
              {
                evidenceRefId: ids.evidence,
                kind: "analysisInvocation",
                analysisInvocationId: ids.invocation,
              },
            ],
            limitation: "Category is model-inferred.",
            observedAt: now,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: [
          {
            path: "/businessHint",
            derivation: "declared",
            confidence: "high",
            evidenceRefs: [
              {
                evidenceRefId: ids.other,
                kind: "snapshot",
                snapshotId: ids.snapshot,
              },
            ],
            limitation: null,
            observedAt: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("ConfirmedProductProfile", () => {
  it("accepts a broad B2B/B2C hybrid profile", () => {
    expect(ConfirmedProductProfile.safeParse(completeProfile()).success).toBe(true);
  });

  it.each([
    ["productName", null],
    ["oneLiner", null],
    ["category", null],
    ["productType", null],
    ["valueProposition", null],
    ["businessModels", []],
    ["coreFeatures", []],
  ] as const)("requires confirmed field %s", (field, invalid) => {
    expect(
      ConfirmedProductProfile.safeParse({
        ...completeProfile(),
        [field]: invalid,
      }).success,
    ).toBe(false);
  });

  it("requires exactly one primary market and audience", () => {
    const value = completeProfile();
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        targetMarkets: value.targetMarkets.map((market) => ({
          ...market,
          priority: "secondary" as const,
        })),
      }).success,
    ).toBe(false);
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        targetAudiences: [
          value.targetAudiences[0],
          {
            ...value.targetAudiences[0],
            candidateId: ids.other,
            reviewStatus: "primary",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires unique candidate IDs, market codes, and competitor domains", () => {
    const value = completeProfile();
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        targetAudiences: [
          value.targetAudiences[0],
          { ...value.targetAudiences[0], reviewStatus: "secondary" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        competitorCandidates: [
          {
            ...value.competitorCandidates[0],
            candidateId: value.targetAudiences[0].candidateId,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        targetMarkets: [value.targetMarkets[0], value.targetMarkets[0]],
      }).success,
    ).toBe(false);
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        competitorCandidates: [
          value.competitorCandidates[0],
          {
            ...value.competitorCandidates[0],
            candidateId: ids.other,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires scope and relationship only for approved competitors", () => {
    const value = completeProfile();
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        competitorCandidates: [
          {
            ...value.competitorCandidates[0],
            relationship: null,
            analysisScope: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ConfirmedProductProfile.safeParse({
        ...value,
        competitorCandidates: [
          {
            ...value.competitorCandidates[0],
            reviewStatus: "candidate",
            relationship: null,
            analysisScope: [],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("createInitialProductProfileDraft", () => {
  it("constructs an honest no-data draft without inventing profile values", () => {
    const draft = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/deep/product",
    });

    expect(ProductProfileDraft.safeParse(draft).success).toBe(true);
    expect(draft).toMatchObject({
      profileSchemaVersion: "product-profile.0.3.0",
      sourceSnapshotId: null,
      analysisInvocationId: null,
      generatedAt: null,
      businessHint: null,
      productName: null,
      oneLiner: null,
      category: null,
      productType: null,
      businessModels: [],
      valueProposition: null,
      coreFeatures: [],
      targetMarkets: [],
      targetAudiences: [],
      competitorCandidates: [],
      fieldProvenance: [],
      conflictingFields: [],
    });
    expect(draft.missingFields).toEqual(
      expect.arrayContaining([
        "/productName",
        "/targetMarkets",
        "/targetAudiences",
        "/competitorCandidates",
      ]),
    );
  });

  it("trims and records only a present declared business hint", () => {
    const draft = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      businessHint: "  A hybrid marketplace  ",
    });

    expect(draft.businessHint).toBe("A hybrid marketplace");
    expect(draft.fieldProvenance).toHaveLength(1);
    expect(draft.fieldProvenance[0]).toMatchObject({
      path: "/businessHint",
      derivation: "declared",
      evidenceRefs: [{ kind: "declaredHint" }],
    });
    expect(() =>
      createInitialProductProfileDraft({
        sourceSiteId: ids.site,
        sourcePageUrl: "https://example.com/product",
        businessHint: "   ",
      }),
    ).toThrow();
  });

  it("gives semantically identical declared hints the same evidence identity", () => {
    const first = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      businessHint: "  A hybrid marketplace  ",
    });
    const replay = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      businessHint: "A hybrid marketplace",
    });

    expect(replay).toEqual(first);
    expect(replay.fieldProvenance[0]?.evidenceRefs[0]?.evidenceRefId).toBe(
      first.fieldProvenance[0]?.evidenceRefs[0]?.evidenceRefId,
    );
    expect(first.fieldProvenance[0]?.evidenceRefs[0]?.evidenceRefId).toBe(
      "67f44430-7d48-8c7a-a338-10501b8f9da9",
    );
  });

  it("uses a different evidence identity when declared evidence changes", () => {
    const first = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      businessHint: "A hybrid marketplace",
    });
    const changed = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      businessHint: "A subscription analytics product",
    });

    expect(changed.fieldProvenance[0]?.evidenceRefs[0]?.evidenceRefId).not.toBe(
      first.fieldProvenance[0]?.evidenceRefs[0]?.evidenceRefId,
    );
  });
});
