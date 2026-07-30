import { describe, expect, it } from "vitest";
import {
  CreateProjectRequest,
  CreateProjectWireRequest,
} from "./projects.ts";

const body = (siteUrl: string) => ({
  clientName: "Acme",
  projectName: "Acme Growth",
  siteUrl,
  marketCodes: ["US"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
});

const productProfileBody = (productUrl: string, businessHint?: string) => ({
  mode: "product_profile" as const,
  productUrl,
  ...(businessHint === undefined ? {} : { businessHint }),
});

describe("CreateProjectRequest siteUrl", () => {
  it("preserves a valid legacy URL in the wire schema for idempotency lookup", () => {
    const siteUrl = "https://example.com/customer-path?campaign=legacy";
    const parsed = CreateProjectWireRequest.safeParse(body(siteUrl));

    expect(parsed.success).toBe(true);
    if (parsed.success && "siteUrl" in parsed.data) {
      expect(parsed.data.siteUrl).toBe(siteUrl);
    }
  });

  it("accepts only origin-preserving HTTP(S) URLs", () => {
    expect(CreateProjectRequest.safeParse(body("https://example.com")).success).toBe(true);
    expect(CreateProjectRequest.safeParse(body("http://example.com:8080/")).success).toBe(true);
  });

  it.each([
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/customer-path",
    "https://example.com/?campaign=private",
    "https://example.com/#fragment",
  ])("rejects a URL whose target cannot be stored honestly: %s", (siteUrl) => {
    const result = CreateProjectRequest.safeParse(body(siteUrl));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["siteUrl"]);
    }
  });
});

describe("product-profile create request", () => {
  it("accepts a deep public HTTP(S) product URL and trims the optional hint", () => {
    expect(
      CreateProjectRequest.parse(
        productProfileBody(
          "https://example.com/products/growth?market=us",
          "  A hybrid marketplace  ",
        ),
      ),
    ).toEqual({
      mode: "product_profile",
      productUrl: "https://example.com/products/growth?market=us",
      businessHint: "A hybrid marketplace",
    });
  });

  it("accepts declared product identity, market, customer model, and bounded growth objectives", () => {
    expect(
      CreateProjectRequest.parse({
        ...productProfileBody("https://example.com/products/growth"),
        productName: "  RelayOps  ",
        customerModel: "b2b",
        primaryMarket: "US",
        growthObjectives: [
          "increase_signups",
          "generate_qualified_leads",
          "increase_ai_visibility",
        ],
      }),
    ).toEqual({
      mode: "product_profile",
      productUrl: "https://example.com/products/growth",
      productName: "RelayOps",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
        "increase_ai_visibility",
      ],
    });
  });

  it("rejects invalid or duplicate declared onboarding choices", () => {
    const valid = productProfileBody("https://example.com/product");
    for (const request of [
      { ...valid, productName: "   " },
      { ...valid, customerModel: "enterprise" },
      { ...valid, primaryMarket: "usa" },
      { ...valid, growthObjectives: [] },
      {
        ...valid,
        growthObjectives: ["increase_signups", "increase_signups"],
      },
      { ...valid, growthObjectives: ["invented_objective"] },
    ]) {
      expect(CreateProjectRequest.safeParse(request).success).toBe(false);
    }
  });

  it.each([
    "ftp://example.com/product",
    "https://user:password@example.com/product",
    "https://localhost/product",
    "https://intranet/product",
    "http://127.0.0.1/product",
    "https://10.0.0.1/product",
    "https://198.18.0.1/product",
    "https://198.51.100.1/product",
    "https://[::ffff:127.0.0.1]/product",
    "https://[2001:db8::1]/product",
    "https://example.com/product#private-fragment",
  ])("rejects a non-public or unsafe product URL: %s", (productUrl) => {
    expect(
      CreateProjectRequest.safeParse(productProfileBody(productUrl)).success,
    ).toBe(false);
  });

  it.each([
    "https://product.test/launch",
    "https://product.invalid/launch",
    "https://product.example/launch",
    "https://nested.product.TEST/launch",
    "https://product.test./launch",
  ])("rejects a reserved test or placeholder hostname: %s", (productUrl) => {
    expect(
      CreateProjectRequest.safeParse(productProfileBody(productUrl)).success,
    ).toBe(false);
  });

  it("rejects blank hints and unknown fields", () => {
    expect(
      CreateProjectRequest.safeParse(
        productProfileBody("https://example.com/product", "   "),
      ).success,
    ).toBe(false);
    expect(
      CreateProjectWireRequest.safeParse({
        ...productProfileBody("https://example.com/product"),
        clientName: "legacy leakage",
      }).success,
    ).toBe(false);
  });

  it("preserves the legacy no-mode shape alongside the discriminated new shape", () => {
    expect(CreateProjectWireRequest.safeParse(body("https://example.com")).success).toBe(
      true,
    );
    expect(
      CreateProjectWireRequest.safeParse(
        productProfileBody("https://example.com/deep/path"),
      ).success,
    ).toBe(true);
  });
});
