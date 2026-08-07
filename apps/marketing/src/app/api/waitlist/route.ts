// @input  — POST { email, locale?, source?, landing_page? } / PATCH { subscriber_id, name?, company?, role? }
// @output — waitlist signup persisted in the marketing Supabase project (waitlist_signups)
// @pos    — public waitlist capture; fails closed with 503 until the owner applies
//           supabase/migrations/0003_waitlist_signups.sql to the live project
import { apiError, apiSuccess, safeApiError } from "../../../lib/api-response";
import { checkRateLimit, extractClientIp } from "../../../lib/rate-limit";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";

const TABLE = "waitlist_signups";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_FIELD_LENGTH = 200;
const PROFILE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

// PGRST205: PostgREST schema cache has no such table; 42P01: undefined table.
// Both mean the migration has not been applied, not that the caller erred.
const MISSING_STORE_CODES = new Set(["PGRST205", "42P01"]);

export async function POST(request: Request) {
  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const email = normalizeEmail(body.email);
  if (!email) {
    return apiError("INVALID_EMAIL", "A valid email address is required", 400);
  }

  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(
    `waitlist:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many signups from this address. Please try again shortly.",
      429,
    );
  }

  const client = createClientOr503();
  if (client instanceof Response) return client;

  try {
    const { data, error } = await client
      .from(TABLE)
      .insert({
        email,
        locale: body.locale === "zh" ? "zh" : "en",
        source: optionalText(body.source),
        landing_page: optionalText(body.landing_page),
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        // A duplicate signup is indistinguishable from a first signup: a 409
        // would let anyone probe which emails are on the list. No id is
        // returned, so a stranger cannot attach profile fields to the
        // existing row either.
        return apiSuccess({ id: null }, 200);
      }
      if (MISSING_STORE_CODES.has(error.code ?? "")) {
        return storeUnavailable();
      }
      return safeApiError("INSERT_FAILED", error.message, 500);
    }
    return apiSuccess({ id: data.id }, 201);
  } catch (error) {
    return safeApiError(
      "INSERT_FAILED",
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}

export async function PATCH(request: Request) {
  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const subscriberId = body.subscriber_id;
  if (typeof subscriberId !== "string" || !subscriberId.trim()) {
    return apiError("MISSING_ID", "subscriber_id is required", 400);
  }

  const updateFields = collectProfileFields(body);
  if (updateFields instanceof Response) return updateFields;
  if (Object.keys(updateFields).length === 0) {
    return apiError("NO_FIELDS", "No fields to update", 400);
  }

  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(
    `waitlist-patch:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many updates from this address. Please try again shortly.",
      429,
    );
  }

  const client = createClientOr503();
  if (client instanceof Response) return client;

  try {
    const { data: subscriber } = await client
      .from(TABLE)
      .select("created_at")
      .eq("id", subscriberId)
      .maybeSingle();
    if (!subscriber) {
      return apiError("NOT_FOUND", "Subscriber not found", 404);
    }

    const createdAt = new Date(subscriber.created_at).getTime();
    if (
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > PROFILE_WINDOW_MS
    ) {
      return apiError(
        "WINDOW_EXPIRED",
        "Profile update window has expired",
        403,
      );
    }

    const { data, error } = await client
      .from(TABLE)
      .update(updateFields)
      .eq("id", subscriberId)
      .select("id")
      .single();
    if (error) {
      return safeApiError("UPDATE_FAILED", error.message, 500);
    }
    return apiSuccess(data);
  } catch (error) {
    return safeApiError(
      "UPDATE_FAILED",
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}

async function readJsonRecord(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("INVALID_BODY", "Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}

function createClientOr503():
  | ReturnType<typeof createAdminSupabaseClient>
  | Response {
  try {
    return createAdminSupabaseClient();
  } catch {
    return storeUnavailable();
  }
}

function storeUnavailable(): Response {
  return apiError(
    "LEAD_CAPTURE_UNAVAILABLE",
    "The waitlist is temporarily unavailable. Please try again later.",
    503,
  );
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, MAX_FIELD_LENGTH);
}

function collectProfileFields(
  body: Record<string, unknown>,
): Record<string, string | null> | Response {
  const fields: Record<string, string | null> = {};
  for (const key of ["name", "company", "role"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") {
      return apiError("INVALID_FIELDS", `${key} must be a string`, 400);
    }
    fields[key] = optionalText(value);
  }
  return fields;
}
