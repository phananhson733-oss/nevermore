// @input  -- POST {platform, handle} from a signed-in browser on /promotions
// @output -- the account as filed for whitelisting (the existing row when that handle is already on file)
// @pos    -- the promoter's write to task_center.promoter_accounts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getServerAuthenticatedUser } from "../../../../lib/auth/server-auth-user.ts";
import { submitAccount } from "../../../../lib/task-center/accounts-store.ts";
import { accountInputSchema } from "../../../../lib/task-center/contracts.ts";
import {
  privateError,
  privateJson,
  readAccountMutationJson,
  requireTaskDb,
} from "../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await readAccountMutationJson(request, 1_024);
  if (!body.ok) return body.response;
  // Read here rather than through authenticateAccountRequest: the email is
  // what tells the operators whose account this is.
  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  if (user.status === "unavailable") return privateError("auth_unavailable", 503);
  if (user.status === "unauthenticated") return privateError("auth_required", 401);
  const parsed = accountInputSchema.safeParse(body.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const db = requireTaskDb();
  if (!db.ok) return db.response;

  try {
    const result = await submitAccount(db.value, {
      userId: user.userId,
      userEmail: user.email,
      platform: parsed.data.platform,
      handle: parsed.data.handle,
    });
    if (!result.ok) return privateError(result.code, 409);
    return privateJson({ data: { account: result.account } }, result.created ? 201 : 200);
  } catch (error) {
    console.error("[tasks] account submit failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
