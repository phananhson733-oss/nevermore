// @input  -- PUT a drama's full set of fields from /admin/tasks/<id>, by an admin
// @output -- 200 when saved; 409 when a published drama would lose its promo target
// @pos    -- admin edit endpoint for task_center.dramas
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { dramaInputSchema, isUuid } from "../../../../../../lib/task-center/contracts.ts";
import { updateDrama } from "../../../../../../lib/task-center/dramas-store.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const { dramaId } = await context.params;
  const mutation = await readAdminMutation(request, 16_384);
  if (!mutation.ok) return mutation.response;
  if (!isUuid(dramaId)) return privateError("not_found", 404);
  const parsed = dramaInputSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  try {
    const result = await updateDrama(mutation.value.db, dramaId, parsed.data);
    if (result.ok) return privateJson({ data: { id: dramaId } });
    return result.code === "not_found"
      ? privateError("not_found", 404)
      : privateError(result.code, 409);
  } catch (error) {
    console.error("[admin tasks] update failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
