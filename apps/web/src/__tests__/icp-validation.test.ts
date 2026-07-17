import { describe, expect, it } from "vitest";
import { CompleteIcpProfileInput, DraftIcpProfilePatch, UpdateContextRequest } from "@sf/contracts";

/**
 * AC-008: draft accepts partial/null; complete returns pointer-level errors for
 * each missing required field. Validates the Zod contract used by the API.
 */

const completeFixture = () => ({
  productName: "Acme Analytics",
  oneLineDescription: "Product analytics for B2B SaaS teams.",
  customerModel: "b2b" as const,
  businessProfile: "b2b_saas" as const,
  businessProfileNote: null,
  marketCodes: ["US", "GB"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
  segments: ["Growth teams"],
  personas: [
    { name: "PM Pat", roleOrContext: "Product manager", jobs: ["ship features"], painPoints: ["no data"] },
  ],
  useCases: ["Funnel analysis"],
  offers: ["Self-serve plan"],
  differentiators: ["Warehouse-native"],
  primaryConversion: { label: "Book a demo", type: "demo" as const, targetUrl: null },
  priorityProductsOrServices: ["Dashboards"],
  priorityUrls: [],
  competitors: [],
  brandConstraints: [],
  complianceConstraints: [],
  technicalConstraints: [],
  resourceConstraints: [],
  growthQuestions: ["How to grow signups?"],
  ninetyDayGoals: ["Double organic signups"],
});

describe("CompleteIcpProfileInput (AC-008)", () => {
  it("accepts a full valid profile", () => {
    expect(CompleteIcpProfileInput.safeParse(completeFixture()).success).toBe(true);
  });

  it("returns a pointer-addressable issue for each missing required field", () => {
    const result = CompleteIcpProfileInput.safeParse({ productName: "Only this" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join("/"));
    for (const required of ["oneLineDescription", "customerModel", "personas", "primaryConversion", "ninetyDayGoals"]) {
      expect(paths).toContain(required);
    }
  });

  it("requires businessProfileNote (min 3) when businessProfile is 'other'", () => {
    const bad = { ...completeFixture(), businessProfile: "other" as const, businessProfileNote: null };
    const result = CompleteIcpProfileInput.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join("/") === "businessProfileNote")).toBe(true);
  });

  it("rejects unknown keys (additionalProperties: false)", () => {
    const bad = { ...completeFixture(), sneaky: "x" };
    expect(CompleteIcpProfileInput.safeParse(bad).success).toBe(false);
  });
});

describe("DraftIcpProfilePatch (AC-008)", () => {
  it("accepts a partial patch", () => {
    expect(DraftIcpProfilePatch.safeParse({ productName: "Just a name" }).success).toBe(true);
  });

  it("accepts explicit null to clear a field", () => {
    expect(DraftIcpProfilePatch.safeParse({ oneLineDescription: null }).success).toBe(true);
  });

  it("rejects an empty patch (minProperties: 1)", () => {
    expect(DraftIcpProfilePatch.safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(DraftIcpProfilePatch.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("UpdateContextRequest discriminator", () => {
  it("routes mode=draft to the draft patch", () => {
    const parsed = UpdateContextRequest.safeParse({
      mode: "draft",
      baseVersion: 0,
      profile: { productName: "x" },
    });
    expect(parsed.success).toBe(true);
  });

  it("routes mode=complete to the complete schema and enforces it", () => {
    const parsed = UpdateContextRequest.safeParse({
      mode: "complete",
      baseVersion: 1,
      profile: { productName: "only" },
    });
    expect(parsed.success).toBe(false);
  });
});
