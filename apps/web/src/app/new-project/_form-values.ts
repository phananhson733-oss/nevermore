import type { ProjectFieldKey } from "./_form-errors";

export const CUSTOMER_MODELS = ["b2b", "b2c", "hybrid"] as const;
export type CustomerModel = (typeof CUSTOMER_MODELS)[number];

export const PRIMARY_MARKETS = [
  "US",
  "GB",
  "CA",
  "AU",
  "SG",
  "DE",
  "FR",
  "JP",
  "KR",
  "AE",
  "IN",
  "BR",
] as const;
export type PrimaryMarket = (typeof PRIMARY_MARKETS)[number];

export const GROWTH_OBJECTIVES = [
  "increase_signups",
  "generate_qualified_leads",
  "increase_organic_traffic",
  "increase_ai_visibility",
  "improve_conversion",
  "increase_revenue",
  "enter_new_markets",
] as const;
export type GrowthObjective = (typeof GROWTH_OBJECTIVES)[number];

export interface NewProductFormValues {
  readonly productName: string;
  readonly productUrl: string;
  readonly customerModel: CustomerModel | "";
  readonly primaryMarket: PrimaryMarket | "";
  readonly growthObjectives: readonly GrowthObjective[];
}

export type NewProductValidationErrors = Partial<
  Record<ProjectFieldKey, "required" | "invalid_url" | "objective_required">
>;

export function validateNewProductValues(
  values: NewProductFormValues,
): NewProductValidationErrors {
  const errors: NewProductValidationErrors = {};
  if (!values.productName.trim()) errors.productName = "required";
  if (!values.customerModel) errors.customerModel = "required";
  if (!values.primaryMarket) errors.primaryMarket = "required";
  if (values.growthObjectives.length === 0) {
    errors.growthObjectives = "objective_required";
  }

  const url = values.productUrl.trim();
  if (!url) {
    errors.productUrl = "required";
  } else {
    try {
      const parsed = new URL(url);
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      ) {
        errors.productUrl = "invalid_url";
      }
    } catch {
      errors.productUrl = "invalid_url";
    }
  }
  return errors;
}

export function buildCreateProductRequest(values: NewProductFormValues) {
  return {
    mode: "product_profile" as const,
    productName: values.productName.trim(),
    productUrl: values.productUrl.trim(),
    customerModel: values.customerModel as CustomerModel,
    primaryMarket: values.primaryMarket as PrimaryMarket,
    growthObjectives: [...values.growthObjectives],
  };
}
