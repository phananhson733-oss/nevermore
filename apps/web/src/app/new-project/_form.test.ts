import { describe, expect, it } from "vitest";
import { mapProjectFieldErrors } from "./_form-errors";
import {
  buildCreateProductRequest,
  validateNewProductValues,
  type NewProductFormValues,
} from "./_form-values";

describe("mapProjectFieldErrors", () => {
  const messages = {
    productUrlInvalid: "localized-product-url",
    requiredField: "localized-required",
    growthObjectivesRequired: "localized-objective",
    createError: "localized-create-error",
  } as const;

  it("maps productUrl to the dedicated localized validation copy", () => {
    expect(
      mapProjectFieldErrors(
        [{ pointer: "/productUrl" }],
        messages,
      ),
    ).toEqual({
      fieldErrors: { productUrl: "localized-product-url" },
      generalError: null,
    });
  });

  it("maps all other field pointers to the generic localized create error", () => {
    expect(
      mapProjectFieldErrors(
        [
          { pointer: "/productName" },
          { pointer: "/customerModel" },
          { pointer: "/primaryMarket" },
          { pointer: "/growthObjectives" },
        ],
        messages,
      ),
    ).toEqual({
      fieldErrors: {
        productName: "localized-required",
        customerModel: "localized-required",
        primaryMarket: "localized-required",
        growthObjectives: "localized-objective",
      },
      generalError: null,
    });
  });

  it("sets the general localized error when no known field pointer is available", () => {
    expect(
      mapProjectFieldErrors(
        [{ pointer: "/unknown" }],
        messages,
      ),
    ).toEqual({
      fieldErrors: {},
      generalError: "localized-create-error",
    });
  });
});

const validValues: NewProductFormValues = {
  productName: "  RelayOps  ",
  productUrl: " https://relayops.example/product ",
  customerModel: "b2b",
  primaryMarket: "US",
  growthObjectives: ["increase_signups", "generate_qualified_leads"],
};

describe("new product customer inputs", () => {
  it("requires the small set of customer-known setup facts", () => {
    expect(
      validateNewProductValues({
        productName: "",
        productUrl: "",
        customerModel: "",
        primaryMarket: "",
        growthObjectives: [],
      }),
    ).toEqual({
      productName: "required",
      productUrl: "required",
      customerModel: "required",
      primaryMarket: "required",
      growthObjectives: "objective_required",
    });
  });

  it("rejects credentials and fragments without trying to audit the URL", () => {
    expect(
      validateNewProductValues({
        ...validValues,
        productUrl: "https://user:secret@example.com/product#private",
      }),
    ).toEqual({ productUrl: "invalid_url" });
  });

  it("normalizes the product command while preserving multiple selected objectives", () => {
    expect(buildCreateProductRequest(validValues)).toEqual({
      mode: "product_profile",
      productName: "RelayOps",
      productUrl: "https://relayops.example/product",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
    });
  });
});
