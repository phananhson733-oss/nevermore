// @input  — POST request body (name, email, message, locale), analytics
// @output — JSON response with submission data or error, fires contact_form_submitted event
// @pos    — Contact API 端点，写入 Supabase contact_submissions，SPEC 5.2a 事件追踪
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { supabase } from "@/lib/supabase";
import { apiSuccess, apiError } from "@/lib/api-response";
import { trackEventServer } from "@/lib/analytics";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const { name, email, message, locale } = body;

  if (!name) {
    return apiError("MISSING_NAME", "Name is required", 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError("INVALID_EMAIL", "A valid email address is required", 400);
  }

  if (!message) {
    return apiError("MISSING_MESSAGE", "Message is required", 400);
  }

  if (message.length < 10) {
    return apiError(
      "MESSAGE_TOO_SHORT",
      "Message must be at least 10 characters",
      400,
    );
  }

  const { data, error } = await supabase
    .from("contact_submissions")
    .insert({
      name,
      email,
      message,
      locale: locale || "en",
    })
    .select()
    .single();

  if (error) {
    return apiError("INSERT_FAILED", "An internal error occurred", 500);
  }

  trackEventServer(supabase, {
    event: "contact_form_submitted",
    properties: { locale: locale || "en", referrer_page: "contact" },
  }).catch(() => {});

  return apiSuccess(data, 201);
}
