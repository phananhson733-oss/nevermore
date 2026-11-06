// @input  -- DELETE from /admin/tasks/<id>, by an admin
// @output -- the clip's row deleted, then its R2 file (a failed file delete is logged, not undone)
// @pos    -- admin delete endpoint for task_center.drama_assets
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isSameOriginPost } from "../../../../../../lib/auth/disconnect.ts";
import { isUuid } from "../../../../../../lib/task-center/contracts.ts";
import { deleteAsset } from "../../../../../../lib/task-center/dramas-store.ts";
import { deleteR2Object } from "../../../../../../lib/task-center/r2.ts";
import {
  privateError,
  privateJson,
  requireR2,
  requireTaskAdmin,
  requireTaskDb,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ assetId: string }> },
): Promise<Response> {
  const admin = await requireTaskAdmin();
  if (!admin.ok) return admin.response;
  if (!isSameOriginPost(request)) return privateError("cross_origin", 403);
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return privateError("not_found", 404);
  const db = requireTaskDb();
  if (!db.ok) return db.response;
  const r2 = requireR2();
  if (!r2.ok) return r2.response;

  try {
    // The row first: from then on nothing can show the clip, and an upload
    // completing meanwhile finds no row and answers 404. If the file delete
    // then fails it is only storage, so it is logged for removal by hand.
    const objectKey = await deleteAsset(db.value, assetId);
    if (objectKey === null) return privateError("not_found", 404);
    await deleteR2Object(r2.value, objectKey).catch((error: unknown) =>
      console.error(`[admin tasks] clip file left in R2: ${objectKey}`, error),
    );
    return privateJson({ data: { assetId } });
  } catch (error) {
    console.error("[admin tasks] asset delete failed", error);
    return privateError("storage_unavailable", 503);
  }
}
