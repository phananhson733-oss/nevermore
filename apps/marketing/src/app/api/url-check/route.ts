// @input  -- POST body { url: string }
// @output -- JSON { data: { reachable, statusCode, error, errorKey } }
// @pos    -- URL reachability check API, used by product/trial wizards before submission
// Once this file is updated, update the header comment and the folder _DIR.md

import { apiSuccess, apiError } from "@/lib/api-response";
import { handleUrlCheck } from "@/lib/url-check/handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const outcome = await handleUrlCheck((body as { url?: unknown }).url);
  if (outcome.kind === "bad_request") {
    return apiError(outcome.code, outcome.message, 400);
  }
  return apiSuccess(outcome.value);
}
