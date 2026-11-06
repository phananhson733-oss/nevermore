// @input  -- DELETE from a signed-in browser on /promotions
// @output -- the promoter's own account withdrawn, only while it still waits for review
// @pos    -- the promoter's delete on task_center.promoter_accounts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isSameOriginPost } from "../../../../../lib/auth/disconnect.ts";
import { withdrawAccount } from "../../../../../lib/task-center/accounts-store.ts";
import { isUuid } from "../../../../../lib/task-center/contracts.ts";
import {
  authenticateAccountRequest,
  privateError,
  privateJson,
  requireTaskDb,
} from "../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ accountId: string }> },
): Promise<Response> {
  if (!isSameOriginPost(request)) return privateError("cross_origin", 403);
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const { accountId } = await context.params;
  if (!isUuid(accountId)) return privateError("not_found", 404);
  const db = requireTaskDb();
  if (!db.ok) return db.response;

  try {
    // Someone else's account, a missing one and one already reviewed all
    // answer 404: nothing here says which.
    const removed = await withdrawAccount(db.value, authentication.userId, accountId);
    return removed ? privateJson({ data: { accountId } }) : privateError("not_found", 404);
  } catch (error) {
    console.error("[tasks] account withdraw failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
