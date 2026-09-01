// @input -- authenticated same-origin JSON POST naming an immutable run ID
// @output -- exactly owned V2 evidence or the explicit V1 summary-only shape
// @pos -- private read-only reopen boundary; never starts a detection workflow
import { z } from "zod";
import { authenticateAccountRequest, privateError, privateJson, readAccountMutationJson } from "../../../../../../lib/account-websites/route-http.ts";
import { readVisibilityHistory } from "../../../../../../lib/geo-tools/visibility-history.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateAccountRequest();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, 1024);
  if (!body.ok) return body.response;
  const parsed = z.object({ runId: z.string().uuid() }).strict().safeParse(body.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  try {
    const read = await readVisibilityHistory({ userId: auth.userId, runId: parsed.data.runId });
    if (read.kind === "ok") return privateJson({ data: read.value });
    if (read.kind === "missing") return privateError("not_found", 404);
    return privateError("store_unavailable", 503);
  } catch { return privateError("store_unavailable", 503); }
}
