import { describe, expect, it } from "vitest";
import type { ProductProfileDraft } from "@sf/contracts";
import {
  buildEditorPatch,
  initialEditorState,
  isCompetitorReviewReady,
} from "./_product-profile-editor";

const primary = {
  candidateId: "00000000-0000-4000-8000-000000000101",
  reviewStatus: "primary" as const,
  targetCompanyOrAudience: "B2B SaaS companies",
  buyerRoles: ["VP Customer Success"],
  userRoles: ["Customer Operations Lead"],
  useCases: ["Standardize onboarding"],
  triggers: ["Scaling implementation"],
  pains: ["Inconsistent handoffs"],
  jtbd: ["Launch customers predictably"],
  outcomes: ["Shorter time to value"],
  barriers: ["Fragmented tooling"],
  qualificationSignals: ["Dedicated operations team"],
  disqualifiers: [],
};

function profile(): ProductProfileDraft {
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: "00000000-0000-4000-8000-000000000102",
    sourcePageUrl: "https://relayops.com/",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "Overseas B2B growth",
    productName: "RelayOps",
    customerModel: "b2b",
    growthObjectives: [
      "increase_signups",
      "generate_qualified_leads",
    ],
    oneLiner: "Customer onboarding operations",
    category: "Customer Operations",
    productType: "B2B SaaS",
    businessModels: ["Custom model", "Subscription"],
    valueProposition: "Standardize complex onboarding",
    coreFeatures: ["Workflow orchestration", "Handoff visibility"],
    targetMarkets: [
      { marketCode: "GB", priority: "secondary" },
      { marketCode: "US", priority: "primary" },
    ],
    targetAudiences: [
      primary,
      {
        ...primary,
        candidateId: "00000000-0000-4000-8000-000000000103",
        reviewStatus: "secondary",
        targetCompanyOrAudience: "Implementation agencies",
      },
    ],
    competitorCandidates: [],
    fieldProvenance: [],
    missingFields: [],
    conflictingFields: [],
  };
}

describe("Product Profile editor patch", () => {
  it("keeps an empty initial product type on the normal selector instead of opening a custom field", () => {
    const empty = { ...profile(), productType: null };

    expect(initialEditorState(empty)).toMatchObject({
      productType: "",
      customProductType: "",
    });
  });

  it("does not replace evidence-backed roots when the customer changed nothing", () => {
    const current = profile();

    expect(buildEditorPatch(current, initialEditorState(current))).toEqual({});
  });

  it("sends only the one semantic root the customer actually changed", () => {
    const current = profile();
    const state = {
      ...initialEditorState(current),
      productName: "RelayOps International",
    };

    expect(buildEditorPatch(current, state)).toEqual({
      productName: "RelayOps International",
    });
  });

  it("updates the declared customer model and growth goals without replacing ICP fields", () => {
    const current = profile();
    const state = {
      ...initialEditorState(current),
      customerModel: "hybrid" as const,
      growthObjectives: [
        "increase_signups",
        "increase_ai_visibility",
      ] as const,
    };

    expect(buildEditorPatch(current, state)).toEqual({
      customerModel: "hybrid",
      growthObjectives: [
        "increase_signups",
        "increase_ai_visibility",
      ],
    });
  });

  it("preserves the original business-model and market order on unrelated edits", () => {
    const current = profile();
    const state = {
      ...initialEditorState(current),
      valueProposition: "A customer-corrected value proposition",
    };

    expect(buildEditorPatch(current, state)).toEqual({
      valueProposition: "A customer-corrected value proposition",
    });
  });

  it("updates only targetMarkets when the primary market changes", () => {
    const current = profile();
    const state = {
      ...initialEditorState(current),
      primaryMarket: "GB",
      secondaryMarkets: ["US"],
    };

    expect(buildEditorPatch(current, state)).toEqual({
      targetMarkets: [
        { marketCode: "GB", priority: "primary" },
        { marketCode: "US", priority: "secondary" },
      ],
    });
  });

  it("edits the product's single Primary ICP without a reusable-candidate selector", () => {
    const current = profile();
    const secondary = current.targetAudiences[1]!;
    const state = {
      ...initialEditorState(current),
      primaryAudienceId: secondary.candidateId,
      targetCompanyOrAudience: secondary.targetCompanyOrAudience ?? "",
      buyerRoles: secondary.buyerRoles.join("\n"),
      userRoles: secondary.userRoles.join("\n"),
      useCases: secondary.useCases.join("\n"),
      triggers: secondary.triggers.join("\n"),
      pains: secondary.pains.join("\n"),
      jtbd: secondary.jtbd.join("\n"),
      outcomes: secondary.outcomes.join("\n"),
      barriers: secondary.barriers.join("\n"),
      qualificationSignals: secondary.qualificationSignals.join("\n"),
      disqualifiers: secondary.disqualifiers.join("\n"),
    };

    const patch = buildEditorPatch(current, state);

    expect(Object.keys(patch)).toEqual(["targetAudiences"]);
    expect(patch.targetAudiences).toHaveLength(1);
    expect(patch.targetAudiences?.[0]).toMatchObject({
      candidateId: secondary.candidateId,
      reviewStatus: "primary",
    });
  });

  it("opens a legacy generated candidate as the default Primary ICP draft", () => {
    const legacyCandidate = {
      ...profile(),
      targetAudiences: [
        {
          ...primary,
          reviewStatus: "candidate" as const,
        },
      ],
    };

    expect(initialEditorState(legacyCandidate)).toMatchObject({
      primaryAudienceId: primary.candidateId,
      targetCompanyOrAudience: primary.targetCompanyOrAudience,
      buyerRoles: "VP Customer Success",
    });
  });

  it("opens a new product-specific Primary ICP draft when generation has not returned an audience yet", () => {
    const emptyAudienceProfile = {
      ...profile(),
      targetAudiences: [],
    };
    const initial = initialEditorState(emptyAudienceProfile);

    expect(initial).toMatchObject({
      primaryAudienceId: "__new__",
      targetCompanyOrAudience: "",
      buyerRoles: "",
    });

    const patch = buildEditorPatch(emptyAudienceProfile, {
      ...initial,
      targetCompanyOrAudience: "B2B SaaS customer operations teams",
      buyerRoles: "VP Customer Success",
      useCases: "Standardize customer onboarding",
    });

    expect(patch.targetAudiences).toHaveLength(1);
    expect(patch.targetAudiences?.[0]).toMatchObject({
      candidateId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      reviewStatus: "primary",
      targetCompanyOrAudience: "B2B SaaS customer operations teams",
      buyerRoles: ["VP Customer Success"],
      useCases: ["Standardize customer onboarding"],
    });
  });
});

describe("competitor review readiness", () => {
  const unclassified = {
    name: "A discovered company",
    domain: "competitor.example",
    relationship: "" as const,
    analysisScope: [],
  };

  it("requires relationship and analysis scope before approval", () => {
    expect(
      isCompetitorReviewReady({
        ...unclassified,
        reviewStatus: "approved",
      }),
    ).toBe(false);
  });

  it.each(["candidate", "excluded"] as const)(
    "allows an unclassified candidate to be marked %s without invented data",
    (reviewStatus) => {
      expect(
        isCompetitorReviewReady({ ...unclassified, reviewStatus }),
      ).toBe(true);
    },
  );
});
