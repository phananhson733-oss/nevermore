// @input  — POST request body (email, name, company, role, locale, utm_*, channel_fingerprint_id), analytics
// @output — JSON response with subscriber data or error, triggers welcome email + events
// @pos    — Waitlist API 端点，写入 Supabase waitlist_subscribers + 事件追踪，SPEC 2.4.2 + 5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { supabase } from "@/lib/supabase";
import { apiSuccess, apiError } from "@/lib/api-response";
import { sendWelcomeEmail } from "@/lib/email";
import { trackEventServer } from "@/lib/analytics";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const {
    email,
    name,
    company,
    role,
    locale,
    source,
    referred_by,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    channel_fingerprint_id,
    landing_page,
  } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError("INVALID_EMAIL", "A valid email address is required", 400);
  }

  const { data, error } = await supabase
    .from("waitlist_subscribers")
    .insert({
      email,
      name: name || null,
      company: company || null,
      role: role || null,
      locale: locale || "en",
      source: source || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_content: utm_content || null,
      utm_term: utm_term || null,
      channel_fingerprint_id: channel_fingerprint_id || null,
      landing_page: landing_page || null,
      referred_by: referred_by || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError("DUPLICATE_EMAIL", "Email already registered", 409);
    }
    return apiError("INSERT_FAILED", "An internal error occurred", 500);
  }

  // 异步发送欢迎邮件 + 追踪事件，不阻塞响应
  sendWelcomeEmail({ email, name, locale: locale || "en" }).catch(() => {});
  trackEventServer(supabase, {
    event: "waitlist_submitted",
    properties: {
      locale: locale || "en",
      source: source || null,
      offer_tag: data.offer_tag,
    },
  }).catch(() => {});

  return apiSuccess(data, 201);
}

export async function PATCH(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const { subscriber_id, name, company, role } = body;

  if (!subscriber_id) {
    return apiError("MISSING_ID", "subscriber_id is required", 400);
  }

  // Verify subscriber exists and was created recently (10-min window)
  const { data: subscriber, error: fetchError } = await supabase
    .from("waitlist_subscribers")
    .select("created_at")
    .eq("id", subscriber_id)
    .maybeSingle();

  if (fetchError || !subscriber) {
    return apiError("NOT_FOUND", "Subscriber not found", 404);
  }

  const createdAt = new Date(subscriber.created_at).getTime();
  if (Date.now() - createdAt > 10 * 60 * 1000) {
    return apiError("WINDOW_EXPIRED", "Profile update window has expired", 403);
  }

  // Only update explicitly provided fields
  const updateFields: Record<string, string | null> = {};
  if (name !== undefined) updateFields.name = name || null;
  if (company !== undefined) updateFields.company = company || null;
  if (role !== undefined) updateFields.role = role || null;

  if (Object.keys(updateFields).length === 0) {
    return apiError("NO_FIELDS", "No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("waitlist_subscribers")
    .update(updateFields)
    .eq("id", subscriber_id)
    .select()
    .single();

  if (error) {
    return apiError("UPDATE_FAILED", "Failed to update profile", 500);
  }

  trackEventServer(supabase, {
    event: "waitlist_profile_completed",
    properties: {
      subscriber_id,
      fields_filled: Object.keys(updateFields),
    },
  }).catch(() => {});

  return apiSuccess(data);
}
