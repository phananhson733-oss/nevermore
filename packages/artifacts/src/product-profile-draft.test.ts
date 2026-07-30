import {
  createInitialProductProfileDraft,
  ProductProfileDraft,
  type ProductProfileFieldProvenance,
} from "@sf/contracts";
import { describe, expect, it } from "vitest";
import type { ProductProfileSemanticCandidateEnvelope } from "./llm/product-profile-client.ts";
import { buildProductProfileDraft } from "./product-profile-draft.ts";

const IDS = {
  site: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
  invocation: "33333333-3333-4333-8333-333333333333",
  secondInvocation: "33333333-3333-4333-8333-444444444444",
  pageOne: "44444444-4444-4444-8444-444444444444",
  pageTwo: "55555555-5555-4555-8555-555555555555",
  reviewedCompetitor: "66666666-6666-4666-8666-666666666666",
  excludedCompetitor: "77777777-7777-4777-8777-777777777777",
  userEvidence: "88888888-8888-4888-8888-888888888888",
  secondUserEvidence: "99999999-9999-4999-8999-999999999999",
} as const;

const GENERATED_AT = "2026-07-22T08:30:00Z";

const emptyScalar = () => ({
  value: null,
  confidence: "unknown" as const,
  sourcePageKeys: [],
  usesBusinessHint: false,
});

function emptyCandidate(): ProductProfileSemanticCandidateEnvelope {
  return {
    productName: emptyScalar(),
    oneLiner: emptyScalar(),
    category: emptyScalar(),
    productType: emptyScalar(),
    valueProposition: emptyScalar(),
    businessModels: [],
    coreFeatures: [],
    targetMarkets: [],
    targetAudiences: [],
    competitorCandidates: [],
    conflicts: [],
    unknownPaths: [
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
  };
}

function base(businessHint?: string) {
  return createInitialProductProfileDraft({
    sourceSiteId: IDS.site,
    sourcePageUrl: "https://relayops.com/product",
    ...(businessHint === undefined ? {} : { businessHint }),
  });
}

function build(
  candidate: ProductProfileSemanticCandidateEnvelope,
  overrides: Partial<Parameters<typeof buildProductProfileDraft>[0]> = {},
) {
  return buildProductProfileDraft({
    base: base(),
    candidate,
    sourceSnapshotId: IDS.snapshot,
    analysisInvocationId: IDS.invocation,
    generatedAt: GENERATED_AT,
    pageEvidence: {
      "page-1": IDS.pageOne,
      "page-2": IDS.pageTwo,
    },
    ...overrides,
  });
}

function userEditProvenance(
  path: string,
  evidenceRefId: string = IDS.userEvidence,
): ProductProfileFieldProvenance {
  return {
    path,
    derivation: "declared",
    confidence: "high",
    evidenceRefs: [{ evidenceRefId, kind: "userEdit" }],
    limitation: "Customer-reviewed value.",
    observedAt: null,
  };
}

function declaredHintProvenance(
  path: string,
  evidenceRefId: string,
): ProductProfileFieldProvenance {
  return {
    path,
    derivation: "declared",
    confidence: "high",
    evidenceRefs: [{ evidenceRefId, kind: "declaredHint" }],
    limitation: "Declared during product setup; not independently observed.",
    observedAt: null,
  };
}

describe("buildProductProfileDraft", () => {
  it("keeps absent conclusions absent and never fabricates a competitor pool", () => {
    const result = build(emptyCandidate(), { pageEvidence: {} });

    expect(result).toMatchObject({
      sourceSiteId: IDS.site,
      sourcePageUrl: "https://relayops.com/product",
      sourceSnapshotId: IDS.snapshot,
      analysisInvocationId: IDS.invocation,
      generatedAt: GENERATED_AT,
      competitorCandidates: [],
      fieldProvenance: [],
      conflictingFields: [],
    });
    expect(result.missingFields).toEqual([
      "/businessModels",
      "/category",
      "/competitorCandidates",
      "/coreFeatures",
      "/oneLiner",
      "/productName",
      "/productType",
      "/targetAudiences",
      "/targetMarkets",
      "/valueProposition",
    ]);
    expect(ProductProfileDraft.safeParse(result).success).toBe(true);
  });

  it("authors path-specific inferred provenance from invocation and cited pages", () => {
    const candidate = emptyCandidate();
    candidate.productName = {
      value: "RelayOps",
      confidence: "high",
      sourcePageKeys: ["page-2", "page-1"],
      usesBusinessHint: false,
    };
    candidate.businessModels = [
      {
        value: "Subscription",
        confidence: "medium",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) => path !== "/productName" && path !== "/businessModels",
    );

    const result = build(candidate);
    const productName = result.fieldProvenance.find(
      (entry) => entry.path === "/productName",
    );
    const businessModel = result.fieldProvenance.find(
      (entry) => entry.path === "/businessModels/0",
    );

    expect(productName).toMatchObject({
      derivation: "inferred",
      confidence: "high",
      limitation: null,
      observedAt: GENERATED_AT,
    });
    expect(productName?.evidenceRefs.map((ref) => ref.kind)).toEqual([
      "analysisInvocation",
      "pageSnapshot",
      "pageSnapshot",
    ]);
    expect(
      productName?.evidenceRefs
        .filter((ref) => ref.kind === "pageSnapshot")
        .map((ref) => ref.pageSnapshotId),
    ).toEqual([IDS.pageOne, IDS.pageTwo]);
    expect(businessModel?.evidenceRefs.map((ref) => ref.kind)).toEqual([
      "analysisInvocation",
      "pageSnapshot",
    ]);
    for (const ref of result.fieldProvenance.flatMap(
      (entry) => entry.evidenceRefs,
    )) {
      expect(ref.evidenceRefId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
  });

  it("maps and canonically orders features, markets, audiences, and audience IDs", () => {
    const candidate = emptyCandidate();
    candidate.coreFeatures = [
      {
        value: "Workflow templates",
        confidence: "medium",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
      {
        value: "Account orchestration",
        confidence: "high",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    candidate.targetMarkets = [
      {
        marketCode: "GB",
        priority: "secondary",
        confidence: "low",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
      {
        marketCode: "US",
        priority: "primary",
        confidence: "high",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    candidate.targetAudiences = [
      {
        targetCompanyOrAudience: "Zeta operations teams",
        buyerRoles: ["VP Success", "COO"],
        userRoles: ["Operations Lead"],
        useCases: ["Scale onboarding"],
        triggers: ["Growing volume"],
        pains: ["Manual handoffs"],
        jtbd: ["Launch consistently"],
        outcomes: ["Faster value"],
        barriers: [],
        qualificationSignals: ["Dedicated operations team"],
        disqualifiers: [],
        confidence: "high",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
      {
        targetCompanyOrAudience: "Alpha services teams",
        buyerRoles: ["Founder"],
        userRoles: ["Implementation Manager"],
        useCases: ["Coordinate delivery"],
        triggers: ["New service line"],
        pains: ["Fragmented process"],
        jtbd: ["Deliver repeatably"],
        outcomes: ["Predictable delivery"],
        barriers: ["Limited headcount"],
        qualificationSignals: ["Repeatable service"],
        disqualifiers: ["One-off project"],
        confidence: "medium",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
    ];
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) =>
        path !== "/coreFeatures" &&
        path !== "/targetMarkets" &&
        path !== "/targetAudiences",
    );

    const forward = build(candidate);
    const reverse = build({
      ...candidate,
      coreFeatures: [...candidate.coreFeatures].reverse(),
      targetMarkets: [...candidate.targetMarkets].reverse(),
      targetAudiences: [...candidate.targetAudiences].reverse(),
    });

    expect(forward).toEqual(reverse);
    expect(forward.coreFeatures).toEqual([
      "Account orchestration",
      "Workflow templates",
    ]);
    expect(forward.targetMarkets).toEqual([
      { marketCode: "US", priority: "primary" },
      { marketCode: "GB", priority: "secondary" },
    ]);
    expect(
      forward.targetAudiences.map((audience) => ({
        candidateId: audience.candidateId,
        reviewStatus: audience.reviewStatus,
        target: audience.targetCompanyOrAudience,
      })),
    ).toEqual([
      {
        candidateId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        reviewStatus: "candidate",
        target: "Alpha services teams",
      },
      {
        candidateId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        reviewStatus: "candidate",
        target: "Zeta operations teams",
      },
    ]);
    expect(forward.targetAudiences[1]?.buyerRoles).toEqual([
      "COO",
      "VP Success",
    ]);
    expect(forward.fieldProvenance.map((entry) => entry.path)).toEqual([
      "/coreFeatures/0",
      "/coreFeatures/1",
      "/targetAudiences/0",
      "/targetAudiences/1",
      "/targetMarkets/0",
      "/targetMarkets/1",
    ]);
  });

  it("preserves declared business-hint provenance and cites it only for hint use", () => {
    const starting = base("B2B customer onboarding workflow software");
    const originalHintProvenance = starting.fieldProvenance[0];
    const candidate = emptyCandidate();
    candidate.oneLiner = {
      value: "Customer onboarding workflows for B2B teams.",
      confidence: "medium",
      sourcePageKeys: [],
      usesBusinessHint: true,
    };
    candidate.category = {
      value: "Workflow software",
      confidence: "medium",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) => path !== "/oneLiner" && path !== "/category",
    );

    const result = build(candidate, { base: starting });

    expect(
      result.fieldProvenance.find((entry) => entry.path === "/businessHint"),
    ).toEqual(originalHintProvenance);
    expect(
      result.fieldProvenance
        .find((entry) => entry.path === "/oneLiner")
        ?.evidenceRefs.map((ref) => ref.kind),
    ).toEqual(["analysisInvocation", "declaredHint"]);
    expect(
      result.fieldProvenance
        .find((entry) => entry.path === "/category")
        ?.evidenceRefs.map((ref) => ref.kind),
    ).toEqual(["analysisInvocation", "pageSnapshot"]);
  });

  it("does not promote a model inference that cites the business hint into a customer-authored fact", () => {
    const starting = base("B2B customer onboarding workflow software");
    const hintedCandidate = emptyCandidate();
    hintedCandidate.productName = {
      value: "Hint-derived model name",
      confidence: "medium",
      sourcePageKeys: [],
      usesBusinessHint: true,
    };
    hintedCandidate.unknownPaths = hintedCandidate.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    const hinted = build(hintedCandidate, { base: starting });
    const replacementCandidate = emptyCandidate();
    replacementCandidate.productName = {
      value: "Name observed on the product page",
      confidence: "high",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    replacementCandidate.unknownPaths =
      replacementCandidate.unknownPaths.filter(
        (path) => path !== "/productName",
      );

    const replaced = build(replacementCandidate, {
      base: hinted,
      analysisInvocationId: IDS.secondInvocation,
    });

    expect(hinted.fieldProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/productName",
          derivation: "inferred",
          evidenceRefs: expect.arrayContaining([
            expect.objectContaining({ kind: "declaredHint" }),
          ]),
        }),
      ]),
    );
    expect(replaced.productName).toBe("Name observed on the product page");
    expect(
      replaced.fieldProvenance
        .find((entry) => entry.path === "/productName")
        ?.evidenceRefs.map((ref) => ref.kind),
    ).toEqual(["analysisInvocation", "pageSnapshot"]);
  });

  it("preserves base-only customer model and growth objectives without adding them to older drafts", () => {
    const starting = createInitialProductProfileDraft({
      sourceSiteId: IDS.site,
      sourcePageUrl: "https://relayops.com/product",
      customerModel: "b2b",
      growthObjectives: [
        "generate_qualified_leads",
        "increase_organic_traffic",
      ],
    });
    const customerModelProvenance = starting.fieldProvenance.find(
      (entry) => entry.path === "/customerModel",
    );
    const growthObjectivesProvenance = starting.fieldProvenance.find(
      (entry) => entry.path === "/growthObjectives",
    );

    const result = build(emptyCandidate(), {
      base: starting,
      pageEvidence: {},
    });
    const legacyResult = build(emptyCandidate(), { pageEvidence: {} });

    expect(result.customerModel).toBe("b2b");
    expect(result.growthObjectives).toEqual([
      "generate_qualified_leads",
      "increase_organic_traffic",
    ]);
    expect(
      result.fieldProvenance.find(
        (entry) => entry.path === "/customerModel",
      ),
    ).toEqual(customerModelProvenance);
    expect(
      result.fieldProvenance.find(
        (entry) => entry.path === "/growthObjectives",
      ),
    ).toEqual(growthObjectivesProvenance);
    expect(Object.hasOwn(legacyResult, "customerModel")).toBe(false);
    expect(Object.hasOwn(legacyResult, "growthObjectives")).toBe(false);
  });

  it("retains a customer-edited top-level value and its subtree provenance", () => {
    const starting = ProductProfileDraft.parse({
      ...base(),
      productName: "Customer-approved name",
      fieldProvenance: [userEditProvenance("/productName")],
      missingFields: base().missingFields.filter(
        (path) => path !== "/productName",
      ),
    });
    const candidate = emptyCandidate();
    candidate.productName = {
      value: "Model replacement",
      confidence: "high",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) => path !== "/productName",
    );

    const result = build(candidate, { base: starting });

    expect(result.productName).toBe("Customer-approved name");
    expect(
      result.fieldProvenance.find((entry) => entry.path === "/productName"),
    ).toEqual(userEditProvenance("/productName"));
  });

  it("retains onboarding-declared product name and target markets over model replacements", () => {
    const productNameProvenance = declaredHintProvenance(
      "/productName",
      "aaaaaaaa-1111-4111-8111-111111111111",
    );
    const targetMarketProvenance = declaredHintProvenance(
      "/targetMarkets/0",
      "aaaaaaaa-2222-4222-8222-222222222222",
    );
    const starting = ProductProfileDraft.parse({
      ...base(),
      productName: "Customer-declared name",
      targetMarkets: [{ marketCode: "CA", priority: "primary" }],
      fieldProvenance: [productNameProvenance, targetMarketProvenance],
      missingFields: base().missingFields.filter(
        (path) => path !== "/productName" && path !== "/targetMarkets",
      ),
    });
    const semanticCandidate = emptyCandidate();
    semanticCandidate.productName = {
      value: "Model replacement",
      confidence: "high",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    semanticCandidate.targetMarkets = [
      {
        marketCode: "US",
        priority: "primary",
        confidence: "high",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
    ];
    semanticCandidate.unknownPaths = semanticCandidate.unknownPaths.filter(
      (path) => path !== "/productName" && path !== "/targetMarkets",
    );

    const result = build(semanticCandidate, { base: starting });

    expect(result.productName).toBe("Customer-declared name");
    expect(result.targetMarkets).toEqual([
      { marketCode: "CA", priority: "primary" },
    ]);
    expect(result.fieldProvenance).toEqual([
      productNameProvenance,
      targetMarketProvenance,
    ]);
    expect(result.missingFields).not.toEqual(
      expect.arrayContaining(["/productName", "/targetMarkets"]),
    );
  });

  it("keeps a declared value protected after canonical evidence marks it contradicted", () => {
    const starting = ProductProfileDraft.parse({
      ...base(),
      productName: "Customer-declared name",
      fieldProvenance: [
        userEditProvenance(
          "/productName",
          "aaaaaaaa-1111-4111-8111-111111111111",
        ),
      ],
      missingFields: base().missingFields.filter(
        (path) => path !== "/productName",
      ),
    });
    const conflictingCandidate = emptyCandidate();
    conflictingCandidate.conflicts = [
      {
        path: "/productName",
        explanation: "The crawl uses a different public product name.",
        confidence: "high",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    conflictingCandidate.unknownPaths =
      conflictingCandidate.unknownPaths.filter(
        (path) => path !== "/productName",
      );
    const contradicted = build(conflictingCandidate, { base: starting });
    const replacementCandidate = emptyCandidate();
    replacementCandidate.productName = {
      value: "Model replacement after contradiction",
      confidence: "high",
      sourcePageKeys: ["page-2"],
      usesBusinessHint: false,
    };
    replacementCandidate.unknownPaths =
      replacementCandidate.unknownPaths.filter(
        (path) => path !== "/productName",
      );

    const replay = build(replacementCandidate, {
      base: contradicted,
      analysisInvocationId: IDS.secondInvocation,
    });

    expect(
      contradicted.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      ),
    ).toMatchObject({
      derivation: "contradicted",
      evidenceRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "userEdit" }),
        expect.objectContaining({ kind: "analysisInvocation" }),
      ]),
    });
    expect(replay.productName).toBe("Customer-declared name");
    expect(
      replay.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      ),
    ).toMatchObject({
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [
        expect.objectContaining({ kind: "userEdit" }),
      ],
      observedAt: null,
    });
  });

  it("retains customer-edited collection subtrees, including a user-added competitor pool", () => {
    const starting = ProductProfileDraft.parse({
      ...base(),
      businessModels: ["Customer-defined model"],
      coreFeatures: ["Customer-defined feature"],
      targetMarkets: [{ marketCode: "CA", priority: "primary" }],
      targetAudiences: [
        {
          candidateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reviewStatus: "candidate",
          targetCompanyOrAudience: "Customer-defined audience",
          buyerRoles: [],
          userRoles: [],
          useCases: [],
          triggers: [],
          pains: [],
          jtbd: [],
          outcomes: [],
          barriers: [],
          qualificationSignals: [],
          disqualifiers: [],
        },
      ],
      competitorCandidates: [
        {
          candidateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Customer-added peer",
          domain: "customer-peer.com",
          relationship: "indirect",
          analysisScope: ["content"],
          similarity: null,
          reason: "Added by the customer.",
          reviewStatus: "candidate",
          confidence: "high",
        },
      ],
      missingFields: base().missingFields.filter(
        (path) =>
          ![
            "/businessModels",
            "/coreFeatures",
            "/targetMarkets",
            "/targetAudiences",
            "/competitorCandidates",
          ].includes(path),
      ),
      fieldProvenance: [
        userEditProvenance(
          "/businessModels/0",
          "aaaaaaaa-1111-4111-8111-111111111111",
        ),
        userEditProvenance(
          "/coreFeatures/0",
          "aaaaaaaa-2222-4222-8222-222222222222",
        ),
        userEditProvenance(
          "/targetMarkets/0",
          "aaaaaaaa-3333-4333-8333-333333333333",
        ),
        userEditProvenance(
          "/targetAudiences/0/targetCompanyOrAudience",
          "aaaaaaaa-4444-4444-8444-444444444444",
        ),
        userEditProvenance(
          "/competitorCandidates",
          "aaaaaaaa-5555-4555-8555-555555555555",
        ),
      ],
    });

    const result = build(emptyCandidate(), { base: starting });

    expect(result.businessModels).toEqual(starting.businessModels);
    expect(result.coreFeatures).toEqual(starting.coreFeatures);
    expect(result.targetMarkets).toEqual(starting.targetMarkets);
    expect(result.targetAudiences).toEqual(starting.targetAudiences);
    expect(result.competitorCandidates).toEqual(starting.competitorCandidates);
    expect(result.missingFields).not.toEqual(
      expect.arrayContaining([
        "/businessModels",
        "/coreFeatures",
        "/targetMarkets",
        "/targetAudiences",
        "/competitorCandidates",
      ]),
    );
    expect(result.fieldProvenance).toEqual(
      [...starting.fieldProvenance].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    );
  });

  it("preserves approved and excluded competitors while merging new model domains", () => {
    const starting = ProductProfileDraft.parse({
      ...base(),
      competitorCandidates: [
        {
          candidateId: IDS.reviewedCompetitor,
          name: "Reviewed Peer",
          domain: "reviewed.example.com",
          relationship: "direct",
          analysisScope: ["positioning"],
          similarity: null,
          reason: "Customer confirmed this direct competitor.",
          reviewStatus: "approved",
          confidence: "high",
        },
        {
          candidateId: IDS.excludedCompetitor,
          name: "Excluded Peer",
          domain: "excluded.example.com",
          relationship: null,
          analysisScope: [],
          similarity: null,
          reason: "Customer excluded this adjacent product.",
          reviewStatus: "excluded",
          confidence: "high",
        },
      ],
      fieldProvenance: [
        userEditProvenance("/competitorCandidates/0", IDS.userEvidence),
        userEditProvenance(
          "/competitorCandidates/1",
          IDS.secondUserEvidence,
        ),
      ],
      missingFields: base().missingFields.filter(
        (path) => path !== "/competitorCandidates",
      ),
    });
    const candidate = emptyCandidate();
    candidate.competitorCandidates = [
      {
        name: "Should not overwrite review",
        domain: "reviewed.example.com",
        relationship: "indirect",
        analysisScope: ["content"],
        similarity: 0.2,
        reason: "A model-only reason.",
        confidence: "low",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
      {
        name: "New Peer",
        domain: "new.example.com",
        relationship: null,
        analysisScope: ["keyword_gap"],
        similarity: null,
        reason: "Observed on the comparison page.",
        confidence: "medium",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
    ];
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) => path !== "/competitorCandidates",
    );

    const result = build(candidate, { base: starting });

    expect(result.competitorCandidates).toHaveLength(3);
    expect(result.competitorCandidates[0]).toEqual(
      starting.competitorCandidates[0],
    );
    expect(result.competitorCandidates[1]).toEqual(
      starting.competitorCandidates[1],
    );
    expect(result.competitorCandidates[2]).toMatchObject({
      name: "New Peer",
      domain: "new.example.com",
      relationship: null,
      analysisScope: ["keyword_gap"],
      similarity: null,
      reviewStatus: "candidate",
    });
    expect(new Set(result.competitorCandidates.map((item) => item.domain)).size).toBe(
      3,
    );
    expect(
      result.fieldProvenance.find(
        (entry) => entry.path === "/competitorCandidates/0",
      ),
    ).toEqual(starting.fieldProvenance[0]);
    expect(
      result.fieldProvenance.find(
        (entry) => entry.path === "/competitorCandidates/1",
      ),
    ).toEqual(starting.fieldProvenance[1]);
  });

  it("records conflicts at the top-level path without also marking them missing", () => {
    const candidate = emptyCandidate();
    candidate.conflicts = [
      {
        path: "/category",
        explanation: "Two pages classify the product differently.",
        confidence: "medium",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    candidate.unknownPaths = candidate.unknownPaths.filter(
      (path) => path !== "/category",
    );

    const result = build(candidate);
    const conflict = result.fieldProvenance.find(
      (entry) => entry.path === "/category",
    );

    expect(result.category).toBeNull();
    expect(result.conflictingFields).toEqual(["/category"]);
    expect(result.missingFields).not.toContain("/category");
    expect(conflict).toMatchObject({
      derivation: "contradicted",
      confidence: "medium",
      limitation: "Two pages classify the product differently.",
      observedAt: GENERATED_AT,
    });
    expect(conflict?.evidenceRefs.map((ref) => ref.kind)).toEqual([
      "analysisInvocation",
      "pageSnapshot",
    ]);
  });

  it("is deterministic across semantic and evidence-map ordering", () => {
    const first = emptyCandidate();
    first.businessModels = [
      {
        value: "Usage based",
        confidence: "medium",
        sourcePageKeys: ["page-2", "page-1"],
        usesBusinessHint: false,
      },
      {
        value: "Subscription",
        confidence: "high",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    first.unknownPaths = first.unknownPaths.filter(
      (path) => path !== "/businessModels",
    );
    const second: ProductProfileSemanticCandidateEnvelope = {
      ...first,
      businessModels: [...first.businessModels].reverse(),
    };

    const a = build(first, {
      pageEvidence: { "page-2": IDS.pageTwo, "page-1": IDS.pageOne },
    });
    const b = build(second, {
      pageEvidence: { "page-1": IDS.pageOne, "page-2": IDS.pageTwo },
    });

    expect(a).toEqual(b);
    expect(a.businessModels).toEqual(["Subscription", "Usage based"]);
    expect(
      a.fieldProvenance.map((entry) => entry.path),
    ).toEqual([...a.fieldProvenance.map((entry) => entry.path)].sort());
  });

  it("rejects fabricated page keys, duplicate semantic domains, and unsafe UUIDs", () => {
    const fabricated = emptyCandidate();
    fabricated.productName = {
      value: "RelayOps",
      confidence: "high",
      sourcePageKeys: ["page-999"],
      usesBusinessHint: false,
    };
    fabricated.unknownPaths = fabricated.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    expect(() => build(fabricated)).toThrow(/unknown page evidence key/iu);

    const duplicateDomains = emptyCandidate();
    duplicateDomains.competitorCandidates = [
      {
        name: "First",
        domain: "same.example.com",
        relationship: "direct",
        analysisScope: [],
        similarity: null,
        reason: "First claim.",
        confidence: "medium",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
      {
        name: "Second",
        domain: "same.example.com",
        relationship: "indirect",
        analysisScope: [],
        similarity: null,
        reason: "Second claim.",
        confidence: "medium",
        sourcePageKeys: ["page-2"],
        usesBusinessHint: false,
      },
    ];
    duplicateDomains.unknownPaths = duplicateDomains.unknownPaths.filter(
      (path) => path !== "/competitorCandidates",
    );
    expect(() => build(duplicateDomains)).toThrow(/duplicate competitor domain/iu);

    expect(() =>
      build(emptyCandidate(), { analysisInvocationId: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      build(emptyCandidate(), {
        pageEvidence: { "page-1": "not-a-page-snapshot-uuid" },
      }),
    ).toThrow();
  });

  it("rejects malformed evidence maps and forged semantic grounding states", () => {
    expect(() =>
      build(emptyCandidate(), { pageEvidence: null as never }),
    ).toThrow(/pageEvidence must be a record/iu);
    expect(() =>
      build(emptyCandidate(), {
        pageEvidence: Object.create({ inherited: IDS.pageOne }) as Record<
          string,
          string
        >,
      }),
    ).toThrow(/plain record/iu);

    const nonEnumerable: Record<string, string> = {};
    Object.defineProperty(nonEnumerable, "page-1", {
      enumerable: false,
      value: IDS.pageOne,
    });
    expect(() =>
      build(emptyCandidate(), { pageEvidence: nonEnumerable }),
    ).toThrow(/enumerable string keys/iu);
    expect(() =>
      build(emptyCandidate(), { pageEvidence: { page_1: IDS.pageOne } }),
    ).toThrow(/invalid page evidence key/iu);
    expect(() =>
      build(emptyCandidate(), {
        pageEvidence: { "page-1": IDS.pageOne, "page-2": IDS.pageOne },
      }),
    ).toThrow(/distinct page snapshot/iu);

    const duplicateSource = emptyCandidate();
    duplicateSource.productName = {
      value: "RelayOps",
      confidence: "high",
      sourcePageKeys: ["page-1", "page-1"],
      usesBusinessHint: false,
    };
    duplicateSource.unknownPaths = duplicateSource.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    expect(() => build(duplicateSource)).toThrow(/duplicate source page key/iu);

    const emptyButGrounded = emptyCandidate();
    emptyButGrounded.productName = {
      value: null,
      confidence: "high",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    expect(() => build(emptyButGrounded)).toThrow(/empty semantic values/iu);

    const unknownConfidence = emptyCandidate();
    unknownConfidence.productName = {
      value: "RelayOps",
      confidence: "unknown",
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    unknownConfidence.unknownPaths = unknownConfidence.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    expect(() => build(unknownConfidence)).toThrow(/known confidence/iu);

    const ungrounded = emptyCandidate();
    ungrounded.productName = {
      value: "RelayOps",
      confidence: "high",
      sourcePageKeys: [],
      usesBusinessHint: false,
    };
    ungrounded.unknownPaths = ungrounded.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    expect(() => build(ungrounded)).toThrow(/evidence grounding/iu);

    const unavailableHint = emptyCandidate();
    unavailableHint.productName = {
      value: "RelayOps",
      confidence: "high",
      sourcePageKeys: [],
      usesBusinessHint: true,
    };
    unavailableHint.unknownPaths = unavailableHint.unknownPaths.filter(
      (path) => path !== "/productName",
    );
    expect(() => build(unavailableHint)).toThrow(/unavailable business hint/iu);

    const hintOnlyCompetitor = emptyCandidate();
    hintOnlyCompetitor.competitorCandidates = [
      {
        name: "Hint-only peer",
        domain: "hint-only-peer.com",
        relationship: null,
        analysisScope: [],
        similarity: null,
        reason: "Mentioned only in the user hint.",
        confidence: "medium",
        sourcePageKeys: [],
        usesBusinessHint: true,
      },
    ];
    hintOnlyCompetitor.unknownPaths =
      hintOnlyCompetitor.unknownPaths.filter(
        (path) => path !== "/competitorCandidates",
      );
    expect(() =>
      build(hintOnlyCompetitor, {
        base: base("A hint that names hint-only-peer.com"),
      }),
    ).toThrow(/competitor candidates require page evidence/iu);
  });

  it("rejects unknown or ambiguous semantic markers before authoring provenance", () => {
    const unknownPath = emptyCandidate();
    unknownPath.unknownPaths = ["/invented" as never];
    expect(() => build(unknownPath)).toThrow(/unknown semantic path/iu);

    const duplicateUnknown = emptyCandidate();
    duplicateUnknown.unknownPaths = ["/category", "/category"];
    expect(() => build(duplicateUnknown)).toThrow(
      /duplicate unknown semantic path/iu,
    );

    const unknownConflict = emptyCandidate();
    unknownConflict.conflicts = [
      {
        path: "/invented" as never,
        explanation: "Not a canonical field.",
        confidence: "medium",
        sourcePageKeys: ["page-1"],
        usesBusinessHint: false,
      },
    ];
    expect(() => build(unknownConflict)).toThrow(/unknown conflict path/iu);

    const duplicateConflict = emptyCandidate();
    const conflict = {
      path: "/category" as const,
      explanation: "Conflicting classifications.",
      confidence: "medium" as const,
      sourcePageKeys: ["page-1"],
      usesBusinessHint: false,
    };
    duplicateConflict.conflicts = [conflict, conflict];
    duplicateConflict.unknownPaths = duplicateConflict.unknownPaths.filter(
      (path) => path !== "/category",
    );
    expect(() => build(duplicateConflict)).toThrow(/duplicate conflict path/iu);

    const ambiguous = emptyCandidate();
    ambiguous.conflicts = [conflict];
    expect(() => build(ambiguous)).toThrow(/both unknown and conflicting/iu);
  });
});
