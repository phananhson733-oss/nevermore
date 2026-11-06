// @input  -- POST a drama's fields from /admin/tasks, by an email on TASK_ADMIN_EMAILS
// @output -- the new draft drama's id
// @pos    -- admin create endpoint for task_center.dramas
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { dramaInputSchema } from "../../../../../lib/task-center/contracts.ts";
import { createDrama } from "../../../../../lib/task-center/dramas-store.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const mutation = await readAdminMutation(request, 16_384);
  if (!mutation.ok) return mutation.response;
  const parsed = dramaInputSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  try {
    const id = await createDrama(mutation.value.db, parsed.data, mutation.value.email);
    return privateJson({ data: { id } }, 201);
  } catch (error) {
    console.error("[admin tasks] create failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
