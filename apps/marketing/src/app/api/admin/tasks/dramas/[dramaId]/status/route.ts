// @input  -- POST {status: draft|published|archived} from /admin/tasks/<id>, by an admin
// @output -- 200 when changed; 409 when publishing a drama that has no promo target
// @pos    -- the admin publish / take-down switch
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { dramaStatusInputSchema, isUuid } from "../../../../../../../lib/task-center/contracts.ts";
import { setDramaStatus } from "../../../../../../../lib/task-center/dramas-store.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const { dramaId } = await context.params;
  const mutation = await readAdminMutation(request, 256);
  if (!mutation.ok) return mutation.response;
  if (!isUuid(dramaId)) return privateError("not_found", 404);
  const parsed = dramaStatusInputSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  try {
    const result = await setDramaStatus(mutation.value.db, dramaId, parsed.data.status);
    if (result.ok) return privateJson({ data: { status: parsed.data.status } });
    return result.code === "not_found"
      ? privateError("not_found", 404)
      : privateError(result.code, 409);
  } catch (error) {
    console.error("[admin tasks] status failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
