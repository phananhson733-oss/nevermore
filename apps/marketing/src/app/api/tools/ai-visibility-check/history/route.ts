// @input -- authenticated same-origin JSON POST with an empty object
// @output -- the account's bounded recent visibility report history
// @pos -- private read-only history boundary; no provider or quota dependencies
import { z } from "zod";
import { authenticateAccountRequest, privateError, privateJson, readAccountMutationJson } from "../../../../../lib/account-websites/route-http.ts";
import { listVisibilityHistory } from "../../../../../lib/geo-tools/visibility-history.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateAccountRequest();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, 1024);
  if (!body.ok) return body.response;
  if (!z.object({}).strict().safeParse(body.value).success) return privateError("invalid_request", 400);
  try {
    const history = await listVisibilityHistory({ userId: auth.userId });
    return history.kind === "ok" ? privateJson({ data: history.value }) : privateError("store_unavailable", 503);
  } catch { return privateError("store_unavailable", 503); }
}
