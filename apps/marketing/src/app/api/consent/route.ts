// @input  — POST request body (visitor_id, categories[], policy_version, locale, geo_country?)
// @output — JSON response confirming consent events recorded or error
// @pos    — Consent 事件 API 端点，批量写入 consent_events 表（SPEC 4.2.18）；ip_hash 用共享 hardened extractClientIp 防 XFF first-hop 伪造（#165）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiSuccess, apiError, safeApiError } from "@/lib/api-response";
import { extractClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { visitor_id, categories, policy_version, locale, geo_country } = body;

  if (!visitor_id) {
    return apiError("MISSING_VISITOR_ID", "visitor_id is required", 400);
  }

  if (!Array.isArray(categories) || categories.length === 0) {
    return apiError(
      "MISSING_CATEGORIES",
      "categories must be a non-empty array",
      400,
    );
  }

  if (!policy_version) {
    return apiError(
      "MISSING_POLICY_VERSION",
      "policy_version is required",
      400,
    );
  }

  // Derive ip_hash from request headers using the shared hardened extractor
  // (x-real-ip → XFF last hop → "unknown"). The first XFF hop is
  // attacker-spoofable on Vercel, so we must not key off it here (#165).
  const ip = extractClientIp(request.headers);
  const ipHash = ip !== "unknown" ? await hashIp(ip) : null;

  const rows = categories.map((c: { category: string; status: string }) => ({
    visitor_id,
    category: c.category,
    status: c.status,
    policy_version,
    ip_hash: ipHash,
    geo_country: geo_country || null,
    locale: locale || "en",
  }));

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("consent_events")
    .insert(rows)
    .select();

  if (error) {
    return safeApiError("INSERT_FAILED", error.message, 500);
  }

  return apiSuccess(data, 201);
}

async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
