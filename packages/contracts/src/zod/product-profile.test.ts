import { describe, expect, it } from "vitest";
import {
  AddProductProfileCompetitorRequest,
  ConfirmProductProfileRequest,
  CreateProductProfileSynthesisRunRequest,
  ConfirmedProductProfile,
  createInitialProductProfileDraft,
  isProductProfileCompetitorIncludedByDefault,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  ProductProfileDraft,
  ProductProfileEditablePatch,
  ProductProfileRowDto,
  ProductProfileSchemaVersion,
  ReviewProductProfileCompetitorRequest,
  UpdateProductProfileDraftRequest,
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

const tracedProfilePaths = [
  "/businessHint",
  "/productName",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
  "/competitorCandidates/0",
] as const;

function evidenceId(index: number): string {
  return `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function tracedProfileProvenance() {
  return tracedProfilePaths.map((path, index) => ({
    path,
    derivation: "inferred" as const,
    confidence: "medium" as const,
    evidenceRefs: [
      {
        evidenceRefId: evidenceId(index),
        kind: "analysisInvocation" as const,
        analysisInvocationId: ids.invocation,
      },
    ],
    limitation: null,
    observedAt: now,
  }));
}

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
    fieldProvenance: tracedProfileProvenance(),
    missingFields: [],
    conflictingFields: [],
  } as const;
}

describe("ProductProfileDraft", () => {
  it("treats complete generated classifications as opt-out defaults", () => {
    expect(
      isProductProfileCompetitorIncludedByDefault({
        reviewStatus: "candidate",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
      }),
    ).toBe(true);
    expect(
      isProductProfileCompetitorIncludedByDefault({
        reviewStatus: "approved",
        relationship: "indirect",
        analysisScope: ["content"],
      }),
    ).toBe(true);
    expect(
      isProductProfileCompetitorIncludedByDefault({
        reviewStatus: "excluded",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
      }),
    ).toBe(false);
    expect(
      isProductProfileCompetitorIncludedByDefault({
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
      }),
    ).toBe(false);
  });

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
        missingFields: [
          "/productName",
          "/oneLiner",
          "/category",
          "/productType",
          "/businessModels",
          "/valueProposition",
          "/coreFeatures",
          "/targetMarkets",
          "/targetAudiences",
          "/competitorCandidates",
        ],
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
                evidenceRefId:
                  value.fieldProvenance[0]!.evidenceRefs[0]!.evidenceRefId,
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

  it("rejects populated semantic facts without provenance coverage", () => {
    const value = completeProfile();
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: value.fieldProvenance.filter(
          (entry) => entry.path !== "/category",
        ),
      }).success,
    ).toBe(false);
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: value.fieldProvenance.filter(
          (entry) => entry.path !== "/competitorCandidates/0",
        ),
      }).success,
    ).toBe(false);
  });

  it("requires honest missing markers and rejects stale markers on populated facts", () => {
    const value = completeProfile();
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        category: null,
        fieldProvenance: value.fieldProvenance.filter(
          (entry) => entry.path !== "/category",
        ),
      }).success,
    ).toBe(false);
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        missingFields: ["/category"],
      }).success,
    ).toBe(false);
  });

  it("binds synthesis metadata and evidence references to one frozen lineage", () => {
    const value = completeProfile();
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        analysisInvocationId: null,
      }).success,
    ).toBe(false);
    expect(
      ProductProfileDraft.safeParse({
        ...value,
        fieldProvenance: value.fieldProvenance.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                evidenceRefs: [
                  {
                    ...entry.evidenceRefs[0],
                    analysisInvocationId: ids.other,
                  },
                ],
              }
            : entry,
        ),
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

  it.each([
    ["targetCompanyOrAudience", null],
    ["buyerRoles", []],
    ["userRoles", []],
    ["useCases", []],
    ["triggers", []],
    ["pains", []],
    ["jtbd", []],
  ] as const)(
    "requires substantive Primary audience field %s only at confirmation",
    (field, invalid) => {
      const value = completeProfile();
      const incompleteAudience = {
        ...value.targetAudiences[0],
        [field]: invalid,
      };
      const incomplete = {
        ...value,
        targetAudiences: [incompleteAudience],
      };

      expect(ProductProfileDraft.safeParse(incomplete).success).toBe(true);
      expect(ConfirmedProductProfile.safeParse(incomplete).success).toBe(false);
    },
  );

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

  it("does not fabricate or require a competitor pool at confirmation", () => {
    expect(
      ConfirmedProductProfile.safeParse({
        ...completeProfile(),
        competitorCandidates: [],
        fieldProvenance: completeProfile().fieldProvenance.filter(
          (entry) => !entry.path.startsWith("/competitorCandidates"),
        ),
        missingFields: ["/competitorCandidates"],
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
    expect(draft).not.toHaveProperty("customerModel");
    expect(draft).not.toHaveProperty("growthObjectives");
  });

  it("preserves old Product Profile rows that predate the optional onboarding fields", () => {
    const historical = completeProfile();

    expect(ProductProfileDraft.safeParse(historical).success).toBe(true);
    expect(ConfirmedProductProfile.safeParse(historical).success).toBe(true);
  });

  it("records declared onboarding facts without presenting them as observed evidence", () => {
    const draft = createInitialProductProfileDraft({
      sourceSiteId: ids.site,
      sourcePageUrl: "https://example.com/product",
      productName: "  RelayOps  ",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
    });

    expect(draft).toMatchObject({
      productName: "RelayOps",
      customerModel: "b2b",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
      targetMarkets: [{ marketCode: "US", priority: "primary" }],
    });
    expect(draft.missingFields).not.toContain("/productName");
    expect(draft.missingFields).not.toContain("/targetMarkets");
    expect(draft.fieldProvenance).toEqual(
      expect.arrayContaining(
        [
          "/productName",
          "/customerModel",
          "/targetMarkets",
          "/growthObjectives",
        ].map((path) =>
          expect.objectContaining({
            path,
            derivation: "declared",
            confidence: "high",
            evidenceRefs: [
              expect.objectContaining({ kind: "userEdit" }),
            ],
            observedAt: null,
          }),
        ),
      ),
    );
    expect(
      draft.fieldProvenance.flatMap((entry) =>
        entry.evidenceRefs.map((ref) => ref.evidenceRefId),
      ),
    ).toHaveLength(new Set(
      draft.fieldProvenance.flatMap((entry) =>
        entry.evidenceRefs.map((ref) => ref.evidenceRefId),
      ),
    ).size);
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

describe("Product Profile public command contracts", () => {
  it("requires an existing base version for every versioned command", () => {
    expect(
      CreateProductProfileSynthesisRunRequest.parse({ baseVersion: 1 }),
    ).toEqual({ baseVersion: 1 });
    expect(
      UpdateProductProfileDraftRequest.parse({
        baseVersion: 2,
        patch: { category: "Customer onboarding" },
      }),
    ).toEqual({
      baseVersion: 2,
      patch: { category: "Customer onboarding" },
    });
    expect(ConfirmProductProfileRequest.parse({ baseVersion: 3 })).toEqual({
      baseVersion: 3,
    });

    for (const schema of [
      CreateProductProfileSynthesisRunRequest,
      ConfirmProductProfileRequest,
    ]) {
      expect(schema.safeParse({ baseVersion: 0 }).success).toBe(false);
      expect(schema.safeParse({ baseVersion: 1.5 }).success).toBe(false);
      expect(
        schema.safeParse({ baseVersion: 1, invented: true }).success,
      ).toBe(false);
    }
  });

  it("allows only editable customer fields and requires a non-empty patch", () => {
    expect(
      ProductProfileEditablePatch.safeParse({
        productName: "RelayOps",
        customerModel: "b2b",
        growthObjectives: [
          "increase_signups",
          "increase_organic_traffic",
        ],
        category: null,
        businessModels: [],
        targetMarkets: [{ marketCode: "US", priority: "primary" }],
        targetAudiences: completeProfile().targetAudiences,
      }).success,
    ).toBe(true);

    expect(ProductProfileEditablePatch.safeParse({}).success).toBe(false);
    for (const forbidden of [
      "sourceSiteId",
      "sourceSnapshotId",
      "analysisInvocationId",
      "generatedAt",
      "fieldProvenance",
      "missingFields",
      "conflictingFields",
      "competitorCandidates",
    ]) {
      expect(
        ProductProfileEditablePatch.safeParse({ [forbidden]: "forged" })
          .success,
      ).toBe(false);
    }
  });

  it("keeps update envelopes strict and rejects malformed nested candidates", () => {
    expect(
      UpdateProductProfileDraftRequest.safeParse({
        baseVersion: 1,
        patch: {},
      }).success,
    ).toBe(false);
    expect(
      UpdateProductProfileDraftRequest.safeParse({
        baseVersion: 1,
        patch: { targetMarkets: [{ marketCode: "usa", priority: "primary" }] },
      }).success,
    ).toBe(false);
    expect(
      UpdateProductProfileDraftRequest.safeParse({
        baseVersion: 1,
        patch: { productName: "RelayOps" },
        sourceSnapshotId: ids.snapshot,
      }).success,
    ).toBe(false);
  });

  it("reviews a competitor without accepting client-owned provenance", () => {
    expect(
      ReviewProductProfileCompetitorRequest.parse({
        baseVersion: 4,
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap", "content"],
        reason: "Overlapping audience and acquisition strategy",
        similarity: 0.74,
      }),
    ).toMatchObject({ reviewStatus: "approved", relationship: "direct" });

    expect(
      ReviewProductProfileCompetitorRequest.safeParse({
        baseVersion: 4,
        reviewStatus: "trusted",
      }).success,
    ).toBe(false);
    expect(
      ReviewProductProfileCompetitorRequest.safeParse({
        baseVersion: 4,
        reviewStatus: "approved",
        analysisScope: ["content", "content"],
      }).success,
    ).toBe(false);
    expect(
      ReviewProductProfileCompetitorRequest.safeParse({
        baseVersion: 4,
        reviewStatus: "approved",
        evidenceRefs: [{ kind: "userEdit" }],
      }).success,
    ).toBe(false);
  });

  it("accepts only grounded fields for a declared competitor", () => {
    expect(
      AddProductProfileCompetitorRequest.parse({
        baseVersion: 4,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
      }),
    ).toMatchObject({ domain: "userpilot.com", relationship: "direct" });

    for (const invalid of [
      {
        baseVersion: 4,
        name: "Userpilot",
        domain: "https://userpilot.com",
        relationship: "direct",
        analysisScope: ["positioning"],
      },
      {
        baseVersion: 4,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: "benchmark",
        analysisScope: ["positioning"],
      },
      {
        baseVersion: 4,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: "direct",
        analysisScope: [],
      },
      {
        baseVersion: 4,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: "direct",
        analysisScope: ["positioning"],
        candidateId: ids.competitor,
      },
    ]) {
      expect(AddProductProfileCompetitorRequest.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("validates the explicit version row DTO and never accepts an opaque profile", () => {
    const row = {
      id: ids.other,
      projectId: ids.site,
      version: 2,
      status: "draft",
      profile: completeProfile(),
      contentHash: "a".repeat(64),
      createdAt: now,
      isCurrent: true,
      isConfirmed: false,
    } as const;

    expect(ProductProfileRowDto.parse(row)).toEqual(row);
    expect(
      ProductProfileRowDto.safeParse({
        ...row,
        profile: { invented: "opaque payload" },
      }).success,
    ).toBe(false);
    expect(
      ProductProfileRowDto.safeParse({
        ...row,
        contentHash: "not-a-sha256",
      }).success,
    ).toBe(false);
  });

  it("makes a complete row carry a substantively confirmed profile", () => {
    const confirmedRow = {
      id: ids.other,
      projectId: ids.site,
      version: 3,
      status: "complete",
      profile: completeProfile(),
      contentHash: "b".repeat(64),
      createdAt: now,
      isCurrent: false,
      isConfirmed: true,
    } as const;
    expect(ProductProfileRowDto.safeParse(confirmedRow).success).toBe(true);

    const primary = completeProfile().targetAudiences[0];
    expect(
      ProductProfileRowDto.safeParse({
        ...confirmedRow,
        profile: {
          ...completeProfile(),
          targetAudiences: [{ ...primary, buyerRoles: [] }],
        },
      }).success,
    ).toBe(false);
    expect(
      ProductProfileRowDto.safeParse({
        ...confirmedRow,
        status: "draft",
      }).success,
    ).toBe(false);
  });
});
