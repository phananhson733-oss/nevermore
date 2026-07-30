import { describe, expect, it } from "vitest";
import {
  type ProductProfileDraft,
  type ProductProfileDraftRowDto,
} from "@sf/contracts";
import type { ProductProfileWorkspace } from "@/lib/api/hooks-product-profile";
import {
  buildProductProfileViewModel,
  getFieldFactState,
} from "./_product-profile-view-model";

const IDS = {
  project: "00000000-0000-4000-8000-000000000001",
  site: "00000000-0000-4000-8000-000000000002",
  row: "00000000-0000-4000-8000-000000000003",
  audience: "00000000-0000-4000-8000-000000000004",
  competitor: "00000000-0000-4000-8000-000000000005",
  evidence: "00000000-0000-4000-8000-000000000006",
} as const;

function provenance(path: string) {
  return {
    path,
    derivation: "declared" as const,
    confidence: "high" as const,
    evidenceRefs: [{ evidenceRefId: IDS.evidence, kind: "userEdit" as const }],
    limitation: null,
    observedAt: null,
  };
}

function profile(
  overrides: Partial<ProductProfileDraft> = {},
): ProductProfileDraft {
  const requiredPaths = [
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
  ];
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: IDS.site,
    sourcePageUrl: "https://relayops.com/product/",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: null,
    productName: "RelayOps",
    oneLiner: "Customer onboarding operations for global B2B teams.",
    category: "Customer operations",
    productType: "B2B SaaS",
    businessModels: ["Subscription"],
    valueProposition: "Standardize complex onboarding without slowing teams.",
    coreFeatures: ["Workflow orchestration", "Handoff visibility"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: IDS.audience,
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50–500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize onboarding handoffs"],
        triggers: ["Rising implementation volume"],
        pains: ["Inconsistent handoffs"],
        jtbd: ["Launch customers predictably"],
        outcomes: ["Shorter time to value"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: [],
      },
    ],
    competitorCandidates: [
      {
        candidateId: IDS.competitor,
        name: "GuideCX",
        domain: "guidecx.com",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
        similarity: 0.84,
        reason: "Overlapping customer onboarding workflow category.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: requiredPaths.map((path, index) => ({
      ...provenance(path),
      evidenceRefs: [
        {
          evidenceRefId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
          kind: "userEdit" as const,
        },
      ],
    })),
    missingFields: [],
    conflictingFields: [],
    ...overrides,
  };
}

function workspace(
  current: ProductProfileDraft,
): ProductProfileWorkspace {
  const row: ProductProfileDraftRowDto = {
    id: IDS.row,
    projectId: IDS.project,
    version: 4,
    status: "draft",
    profile: current,
    contentHash: "a".repeat(64),
    createdAt: "2026-07-22T00:00:00.000Z",
    isCurrent: true,
    isConfirmed: false,
  };
  return {
    projectId: IDS.project,
    currentProfile: row,
    confirmedProfile: null,
    activeSynthesisRun: null,
    activeCrawlRun: null,
  };
}

describe("Product Profile customer view model", () => {
  it("marks a traceable complete draft ready for explicit confirmation", () => {
    const view = buildProductProfileViewModel(workspace(profile()));

    expect(view.profileState).toBe("draft");
    expect(view.primaryAudience?.targetCompanyOrAudience).toContain("B2B SaaS");
    expect(view.confirmation.ready).toBe(true);
    expect(view.confirmation.items.every((item) => item.complete)).toBe(true);
    expect(view.evidence).toMatchObject({
      sourcePageUrl: "https://relayops.com/product/",
      frozen: false,
      provenanceCount: 10,
      missingCount: 0,
      conflictCount: 0,
    });
  });

  it("keeps missing facts visibly missing and blocks confirmation", () => {
    const incomplete = profile({
      valueProposition: null,
      targetAudiences: [],
      fieldProvenance: profile().fieldProvenance.filter(
        (entry) =>
          entry.path !== "/valueProposition" &&
          entry.path !== "/targetAudiences",
      ),
      missingFields: ["/valueProposition", "/targetAudiences"],
    });

    const view = buildProductProfileViewModel(workspace(incomplete));

    expect(view.primaryAudience).toBeNull();
    expect(view.confirmation.ready).toBe(false);
    expect(
      view.confirmation.items.filter((item) => !item.complete).map((item) => item.id),
    ).toEqual(expect.arrayContaining(["value", "primaryIcp"]));
    expect(getFieldFactState(incomplete, "/valueProposition")).toMatchObject({
      state: "missing",
      label: "missing",
    });
  });

  it("surfaces conflicts instead of treating populated values as confirmed facts", () => {
    const conflicted = profile({
      oneLiner: "Two incompatible positioning claims were found.",
      conflictingFields: ["/oneLiner"],
    });

    const view = buildProductProfileViewModel(workspace(conflicted));

    expect(getFieldFactState(conflicted, "/oneLiner")).toMatchObject({
      state: "conflicting",
      label: "conflicting",
    });
    expect(view.confirmation.ready).toBe(false);
    expect(view.confirmation.items.find((item) => item.id === "identity")).toMatchObject(
      { complete: false },
    );
  });

  it("reports provenance derivation and frozen lineage without exposing raw evidence", () => {
    const generated = profile({
      sourceSnapshotId: "00000000-0000-4000-8000-000000000011",
      analysisInvocationId: "00000000-0000-4000-8000-000000000012",
      generatedAt: "2026-07-22T01:02:03.000Z",
      fieldProvenance: [
        {
          path: "/productName",
          derivation: "inferred",
          confidence: "medium",
          evidenceRefs: [
            {
              evidenceRefId: IDS.evidence,
              kind: "analysisInvocation",
              analysisInvocationId: "00000000-0000-4000-8000-000000000012",
            },
          ],
          limitation: "Derived from the frozen product page set.",
          observedAt: "2026-07-22T01:02:03.000Z",
        },
        ...profile().fieldProvenance.filter((entry) => entry.path !== "/productName"),
      ],
    });

    expect(getFieldFactState(generated, "/productName")).toMatchObject({
      state: "supported",
      label: "inferred",
      confidence: "medium",
    });
    expect(buildProductProfileViewModel(workspace(generated)).evidence).toMatchObject({
      frozen: true,
      sourceSnapshotId: "00000000-0000-4000-8000-000000000011",
      analysisInvocationId: "00000000-0000-4000-8000-000000000012",
      generatedAt: "2026-07-22T01:02:03.000Z",
    });
  });

  it("blocks approval when an approved competitor has no relationship or scope", () => {
    const invalidReview = profile({
      competitorCandidates: [
        {
          ...profile().competitorCandidates[0]!,
          relationship: null,
          analysisScope: [],
        },
      ],
    });

    const view = buildProductProfileViewModel(workspace(invalidReview));

    expect(view.confirmation.ready).toBe(false);
    expect(view.confirmation.items.find((item) => item.id === "competitors")).toMatchObject(
      { complete: false },
    );
  });

  it("keeps confirmation unavailable while a real synthesis run is active", () => {
    const active = workspace(profile());
    const view = buildProductProfileViewModel({
      ...active,
      activeSynthesisRun: {
        id: "00000000-0000-4000-8000-000000000020",
        projectId: IDS.project,
        kind: "product_profile_synthesis",
        status: "running",
        progress: {
          phase: "synthesizing",
          current: 1,
          total: 3,
          messageKey: "run.running",
        },
        lastError: null,
        resultRef: null,
        queuedAt: "2026-07-22T00:00:00.000Z",
        startedAt: "2026-07-22T00:00:01.000Z",
        completedAt: null,
      },
    });

    expect(view.confirmation.items.every((item) => item.complete)).toBe(true);
    expect(view.confirmation.ready).toBe(false);
  });

  it("projects a confirmed row as read-only instead of reopening confirmation", () => {
    const current = workspace(profile());
    const confirmedProfile = current.currentProfile?.profile;
    if (!confirmedProfile) throw new Error("fixture profile missing");
    const view = buildProductProfileViewModel({
      ...current,
      currentProfile: {
        ...current.currentProfile!,
        status: "complete",
        profile: confirmedProfile,
        isConfirmed: true,
      } as ProductProfileWorkspace["currentProfile"],
      confirmedProfile: {
        ...current.currentProfile!,
        status: "complete",
        profile: confirmedProfile,
        isConfirmed: true,
      } as ProductProfileWorkspace["confirmedProfile"],
    });

    expect(view.profileState).toBe("confirmed");
    expect(view.confirmation.ready).toBe(false);
  });
});
