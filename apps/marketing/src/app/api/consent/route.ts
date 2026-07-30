// @input  — POST request body (visitor_id, categories[], policy_version, locale, geo_country?)
// @output — JSON response reporting recorded or explicitly local-only consent handling
// @pos    — Optional Consent 事件 API；未配置存储时安全降级，不影响浏览器内 Cookie 偏好
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { apiError, apiSuccess, safeApiError } from "../../../lib/api-response";
import { extractClientIp } from "../../../lib/rate-limit";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import {
  hasConsentPersistenceConfig,
  isConsentStoreUnavailable,
} from "./persistence";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!isRecord(body)) {
    return apiError(
      "INVALID_BODY",
      "Request body must be a JSON object",
      400,
    );
  }

  const { visitor_id, categories, policy_version, locale, geo_country } = body;

  if (typeof visitor_id !== "string" || !visitor_id.trim()) {
    return apiError("MISSING_VISITOR_ID", "visitor_id is required", 400);
  }

  if (!Array.isArray(categories) || categories.length === 0) {
    return apiError(
      "MISSING_CATEGORIES",
      "categories must be a non-empty array",
      400,
    );
  }

  if (
    !categories.every(
      (category) =>
        isRecord(category) &&
        typeof category.category === "string" &&
        Boolean(category.category.trim()) &&
        typeof category.status === "string" &&
        Boolean(category.status.trim()),
    )
  ) {
    return apiError(
      "INVALID_CATEGORIES",
      "each category must include category and status strings",
      400,
    );
  }

  if (typeof policy_version !== "string" || !policy_version.trim()) {
    return apiError(
      "MISSING_POLICY_VERSION",
      "policy_version is required",
      400,
    );
  }

  if (
    !hasConsentPersistenceConfig({
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    })
  ) {
    return apiSuccess(
      { recorded: false, reason: "persistence_not_configured" },
      202,
    );
  }

  try {
    // Derive ip_hash from request headers using the shared hardened extractor
    // (x-real-ip → XFF last hop → "unknown"). The first XFF hop is
    // attacker-spoofable on Vercel, so we must not key off it here (#165).
    const ip = extractClientIp(request.headers);
    const ipHash = ip !== "unknown" ? await hashIp(ip) : null;

    const rows = categories.map((category) => ({
      visitor_id,
      category: category.category,
      status: category.status,
      policy_version,
      ip_hash: ipHash,
      geo_country: typeof geo_country === "string" ? geo_country : null,
      locale: typeof locale === "string" && locale ? locale : "en",
    }));

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("consent_events")
      .insert(rows)
      .select();

    if (error) {
      if (isConsentStoreUnavailable(error.code)) {
        return apiSuccess(
          { recorded: false, reason: "consent_store_unavailable" },
          202,
        );
      }
      return safeApiError("INSERT_FAILED", error.message, 500);
    }

    return apiSuccess(data, 201);
  } catch (error) {
    return safeApiError(
      "INSERT_FAILED",
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
