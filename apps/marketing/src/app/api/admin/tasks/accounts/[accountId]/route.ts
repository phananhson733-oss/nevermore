// @input  -- PUT {status: whitelisted|rejected} from /admin/tasks/accounts, by an admin
// @output -- the account marked reviewed, with the admin's email and the time
// @pos    -- admin review endpoint for task_center.promoter_accounts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { reviewAccount } from "../../../../../../lib/task-center/accounts-store.ts";
import { accountReviewSchema, isUuid } from "../../../../../../lib/task-center/contracts.ts";
import {
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { readonly params: Promise<{ accountId: string }> },
): Promise<Response> {
  const mutation = await readAdminMutation(request, 256);
  if (!mutation.ok) return mutation.response;
  const { accountId } = await context.params;
  if (!isUuid(accountId)) return privateError("not_found", 404);
  const parsed = accountReviewSchema.safeParse(mutation.value.body);
  if (!parsed.success) return privateError("invalid_request", 400);

  try {
    const found = await reviewAccount(mutation.value.db, accountId, parsed.data.status, mutation.value.email);
    return found ? privateJson({ data: { accountId, status: parsed.data.status } }) : privateError("not_found", 404);
  } catch (error) {
    console.error("[admin tasks] account review failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
