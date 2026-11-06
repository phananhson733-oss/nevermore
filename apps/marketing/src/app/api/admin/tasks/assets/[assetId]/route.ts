// @input  -- GET (the 预览 link), PUT {clipType} or DELETE from /admin/tasks/<id>, by an admin
// @output -- GET: a 302 to a 15-minute signed R2 URL for a ready clip of any drama, draft or not;
//            PUT: the clip retagged; DELETE: the clip's row deleted, then its R2 file and still
//            (a failed file delete is logged, not undone)
// @pos    -- admin preview, retag and delete endpoint for task_center.drama_assets
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isSameOriginPost } from "../../../../../../lib/auth/disconnect.ts";
import { assetUpdateSchema, isUuid } from "../../../../../../lib/task-center/contracts.ts";
import {
  deleteAsset,
  getAsset,
  setAssetClipType,
} from "../../../../../../lib/task-center/dramas-store.ts";
import { deleteR2Object, r2ObjectUrl } from "../../../../../../lib/task-center/r2.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
  requireR2,
  requireTaskAdmin,
  requireTaskDb,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

/**
 * The preview link signs on click. A URL signed while the page rendered
 * expired 15 minutes later, so a page left open answered R2's ExpiredRequest.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ assetId: string }> },
): Promise<Response> {
  const admin = await requireTaskAdmin();
  if (!admin.ok) return admin.response;
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return privateError("not_found", 404);
  const db = requireTaskDb();
  if (!db.ok) return db.response;
  const r2 = requireR2();
  if (!r2.ok) return r2.response;

  let asset;
  try {
    asset = await getAsset(db.value, assetId);
  } catch (error) {
    console.error("[admin tasks] asset lookup failed", error);
    return privateError("tasks_unavailable", 503);
  }
  if (asset === null || asset.status !== "ready") return privateError("not_found", 404);
  return new Response(null, {
    status: 302,
    headers: {
      location: r2ObjectUrl(r2.value, "GET", asset.objectKey, { expiresSeconds: 900 }),
      "cache-control": "private, no-store",
    },
  });
}

export async function PUT(
  request: Request,
  context: { readonly params: Promise<{ assetId: string }> },
): Promise<Response> {
  const mutation = await readAdminMutation(request, 256);
  if (!mutation.ok) return mutation.response;
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return privateError("not_found", 404);
  const parsed = assetUpdateSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  try {
    if (!(await setAssetClipType(mutation.value.db, assetId, parsed.data.clipType))) {
      return privateError("not_found", 404);
    }
    return privateJson({ data: { assetId, clipType: parsed.data.clipType } });
  } catch (error) {
    console.error("[admin tasks] asset retag failed", error);
    return privateError("tasks_unavailable", 503);
  }
}

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
    const deleted = await deleteAsset(db.value, assetId);
    if (deleted === null) return privateError("not_found", 404);
    for (const key of [deleted.objectKey, deleted.posterKey]) {
      if (key === null) continue;
      await deleteR2Object(r2.value, key).catch((error: unknown) =>
        console.error(`[admin tasks] clip file left in R2: ${key}`, error),
      );
    }
    return privateJson({ data: { assetId } });
  } catch (error) {
    console.error("[admin tasks] asset delete failed", error);
    return privateError("storage_unavailable", 503);
  }
}
