import { describe, expect, it } from "vitest";
import { CreateGrowthAuditRunRequest } from "./capabilities.ts";

const baseRequest = {
  siteId: "20000000-0000-4000-8000-000000000001",
  icpProfileId: "20000000-0000-4000-8000-000000000002",
  scope: {
    kind: "url",
    targetRefs: [
      "https://example.com/customer-onboarding/",
      "https://example.com/integrations/salesforce/",
    ],
  },
  outputLocale: "zh-CN",
  capabilityContractVersion: "growth-audit.0.3.0",
} as const;

describe("CreateGrowthAuditRunRequest", () => {
  it("accepts a strict, versioned multi-URL audit request", () => {
    expect(CreateGrowthAuditRunRequest.safeParse(baseRequest).success).toBe(
      true,
    );
  });

  it("rejects duplicate target refs", () => {
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: {
          kind: "url",
          targetRefs: [
            "https://example.com/customer-onboarding/",
            "https://example.com/customer-onboarding/",
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires targets for URL/template scope and forbids them for site scope", () => {
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: { kind: "url" },
      }).success,
    ).toBe(false);
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: { kind: "template", targetRefs: [] },
      }).success,
    ).toBe(false);
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: {
          kind: "site",
          targetRefs: ["https://example.com/customer-onboarding/"],
        },
      }).success,
    ).toBe(false);
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: { kind: "site" },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown request and nested scope keys", () => {
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        confirmOpportunity: true,
      }).success,
    ).toBe(false);
    expect(
      CreateGrowthAuditRunRequest.safeParse({
        ...baseRequest,
        scope: { ...baseRequest.scope, crawlNow: true },
      }).success,
    ).toBe(false);
  });
});
