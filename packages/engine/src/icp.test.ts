import { describe, expect, it } from "vitest";
import { parseIcp } from "./icp.ts";

describe("parseIcp Product Profile projection", () => {
  it("feeds every customer Product Profile input into downstream analysis context", () => {
    const result = parseIcp({
      productName: "RelayOps",
      oneLiner: "Customer onboarding operations for global B2B teams.",
      category: "Customer onboarding",
      productType: "B2B SaaS",
      businessModels: ["Subscription"],
      customerModel: "b2b",
      growthObjectives: ["generate_qualified_leads", "increase_organic_traffic"],
      valueProposition: "Standardize complex onboarding without slowing teams.",
      coreFeatures: ["Workflow orchestration", "Handoff visibility"],
      targetMarkets: [
        { marketCode: "US", priority: "primary" },
        { marketCode: "GB", priority: "secondary" },
      ],
      targetAudiences: [
        {
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
          qualificationSignals: ["Dedicated operations team"],
          disqualifiers: ["No repeatable onboarding process"],
        },
      ],
      competitorCandidates: [
        {
          name: "GuideCX",
          domain: "guidecx.com",
          relationship: "direct",
          analysisScope: ["positioning", "product_capability"],
          reason: "Same ICP and job.",
          reviewStatus: "candidate",
          confidence: "medium",
          similarity: null,
        },
      ],
    });

    expect(result).toMatchObject({
      productName: "RelayOps",
      oneLineDescription:
        "Customer onboarding operations for global B2B teams.",
      category: "Customer onboarding",
      productType: "B2B SaaS",
      businessModels: ["Subscription"],
      customerModel: "b2b",
      businessProfile:
        "Standardize complex onboarding without slowing teams.",
      marketCodes: ["US", "GB"],
      segments: ["B2B SaaS companies with 50–500 employees"],
      useCases: ["Standardize onboarding handoffs"],
      offers: ["Workflow orchestration", "Handoff visibility"],
      differentiators: [
        "Standardize complex onboarding without slowing teams.",
      ],
      competitors: ["guidecx.com"],
      competitorDetails: [
        {
          name: "GuideCX",
          domain: "guidecx.com",
          relationship: "direct",
          analysisScope: ["positioning", "product_capability"],
          reason: "Same ICP and job.",
          reviewStatus: "candidate",
          confidence: "medium",
          similarity: null,
        },
      ],
      growthObjectives: [
        "generate_qualified_leads",
        "increase_organic_traffic",
      ],
      pains: ["Inconsistent handoffs"],
      jobsToBeDone: ["Launch customers predictably"],
      desiredOutcomes: ["Shorter time to value"],
      triggers: ["Rising implementation volume"],
      buyerRoles: ["VP Customer Success"],
      userRoles: ["Customer Operations Lead"],
      barriers: ["Fragmented tooling"],
      qualificationSignals: ["Dedicated operations team"],
      disqualifiers: ["No repeatable onboarding process"],
    });
  });

  it("keeps the legacy complete ICP projection backward compatible", () => {
    const result = parseIcp({
      productName: "Legacy",
      oneLineDescription: "Legacy description",
      marketCodes: ["CA"],
      segments: ["Legacy segment"],
      useCases: ["Legacy use case"],
      offers: ["Legacy offer"],
      differentiators: ["Legacy differentiator"],
      competitors: ["legacy.example"],
    });

    expect(result).toMatchObject({
      oneLineDescription: "Legacy description",
      marketCodes: ["CA"],
      segments: ["Legacy segment"],
      useCases: ["Legacy use case"],
      offers: ["Legacy offer"],
      differentiators: ["Legacy differentiator"],
      competitors: ["legacy.example"],
    });
  });
});
