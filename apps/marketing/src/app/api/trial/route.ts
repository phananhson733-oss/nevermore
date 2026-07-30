// @input  — POST request body (email, name, product_url, target_regions, experiment_goal, primary_conversion_event, locale, landing_page)
// @output — JSON response with trial application data or error
// @pos    — Trial Applications API endpoint, writes to Supabase trial_applications table
// Once this file is updated, update the header comments and the parent _DIR.md
import { supabase } from "@/lib/supabase";
import { apiSuccess, apiError } from "@/lib/api-response";
import { validateUrlPattern } from "@/lib/url-validation";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  // 1. Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const {
    email,
    name,
    product_url,
    target_regions,
    experiment_goal,
    primary_conversion_event,
    locale,
    landing_page,
  } = body as {
    email?: string;
    name?: string;
    product_url?: string;
    target_regions?: string[];
    experiment_goal?: string;
    primary_conversion_event?: string;
    locale?: string;
    landing_page?: string;
  };

  // 2. Validate required fields
  if (!email) {
    return apiError("MISSING_FIELD", "email is required", 400);
  }
  if (!EMAIL_REGEX.test(email)) {
    return apiError("INVALID_EMAIL", "A valid email address is required", 400);
  }
  if (!product_url) {
    return apiError("MISSING_FIELD", "product_url is required", 400);
  }
  const urlCheck = validateUrlPattern(product_url);
  if (!urlCheck.valid) {
    return apiError("INVALID_URL", `URL rejected: ${urlCheck.errorKey}`, 400);
  }
  if (
    !target_regions ||
    !Array.isArray(target_regions) ||
    target_regions.length === 0
  ) {
    return apiError(
      "MISSING_FIELD",
      "target_regions must be a non-empty array",
      400,
    );
  }
  if (!experiment_goal) {
    return apiError("MISSING_FIELD", "experiment_goal is required", 400);
  }
  if (!primary_conversion_event) {
    return apiError(
      "MISSING_FIELD",
      "primary_conversion_event is required",
      400,
    );
  }

  // 3. Insert into trial_applications
  const { error } = await supabase.from("trial_applications").insert({
    email,
    name: name || null,
    product_url,
    target_regions,
    experiment_goal,
    primary_conversion_event,
    locale: locale || null,
    landing_page: landing_page || null,
    status: "pending",
  });

  if (error) {
    // Unique constraint violation on email
    if (error.code === "23505") {
      return apiError(
        "DUPLICATE_EMAIL",
        "A trial application with this email already exists",
        409,
      );
    }
    return apiError("INSERT_FAILED", "An internal error occurred", 500);
  }

  return apiSuccess({ email }, 201);
}
