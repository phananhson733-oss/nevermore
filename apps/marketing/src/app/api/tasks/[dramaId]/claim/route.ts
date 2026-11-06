// @input  -- POST {} from a signed-in browser on /tasks/<id>
// @output -- this person's one promo link and code for that drama (channel "all"), created once and returned after
// @pos    -- the only writer of task_center.task_claims
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { siteConfig } from "../../../../../config/site.ts";
import { claimTask } from "../../../../../lib/task-center/claims-store.ts";
import { claimInputSchema, isUuid } from "../../../../../lib/task-center/contracts.ts";
import { promoLink } from "../../../../../lib/task-center/copy.ts";
import {
  authenticateAccountRequest,
  privateError,
  privateJson,
  readAccountMutationJson,
  requireTaskDb,
} from "../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const { dramaId } = await context.params;
  const body = await readAccountMutationJson(request, 256);
  if (!body.ok) return body.response;
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const parsed = claimInputSchema.safeParse(body.value);
  if (!parsed.success || !isUuid(dramaId)) return privateError("invalid_request", 400);
  const db = requireTaskDb();
  if (!db.ok) return db.response;

  try {
    const result = await claimTask(db.value, {
      userId: authentication.userId,
      dramaId,
      channel: "all",
    });
    if (!result.ok) return privateError("not_found", 404);
    return privateJson(
      {
        data: {
          claim: {
            channel: result.claim.channel,
            code: result.claim.code,
            link: promoLink(siteConfig.url, result.claim.code),
            claimedAt: result.claim.claimedAt,
          },
        },
      },
      result.created ? 201 : 200,
    );
  } catch (error) {
    console.error("[tasks] claim failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
