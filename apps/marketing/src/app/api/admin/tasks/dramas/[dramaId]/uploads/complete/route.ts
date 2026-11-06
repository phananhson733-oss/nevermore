// @input  -- POST {purpose: asset, assetId} or {purpose: cover, objectKey} after the browser's PUT to R2 finished
// @output -- the asset marked ready (404 if it was deleted meanwhile), or the drama pointed at its new cover, once R2 confirms the object; the old cover file is kept (see setDramaCover)
// @pos    -- step 2 of an upload: nothing is shown to promoters until R2 has the file at the declared size and type
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  isUuid,
  uploadCompleteSchema,
} from "../../../../../../../../lib/task-center/contracts.ts";
import {
  getAsset,
  markAssetReady,
  setDramaCover,
} from "../../../../../../../../lib/task-center/dramas-store.ts";
import { headR2Object } from "../../../../../../../../lib/task-center/r2.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
  requireR2,
} from "../../../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

function baseType(contentType: string | null): string | null {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const { dramaId } = await context.params;
  const mutation = await readAdminMutation(request, 1_024);
  if (!mutation.ok) return mutation.response;
  if (!isUuid(dramaId)) return privateError("not_found", 404);
  const parsed = uploadCompleteSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const r2 = requireR2();
  if (!r2.ok) return r2.response;
  const { db } = mutation.value;

  try {
    if (parsed.data.purpose === "asset") {
      const asset = await getAsset(db, parsed.data.assetId);
      if (asset === null || asset.dramaId !== dramaId) return privateError("not_found", 404);
      const head = await headR2Object(r2.value, asset.objectKey);
      if (head === null) return privateError("upload_missing", 409);
      if (head.byteSize !== asset.byteSize || baseType(head.contentType) !== asset.contentType) {
        return privateError("upload_mismatch", 409);
      }
      // Deleted by another request while this one checked the file.
      if (!(await markAssetReady(db, asset.id))) return privateError("not_found", 404);
      return privateJson({ data: { assetId: asset.id, status: "ready" } });
    }

    const { objectKey } = parsed.data;
    // Only a key this drama's upload step could have issued.
    const coverPattern = new RegExp(
      `^dramas/${dramaId}/covers/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
    );
    if (!coverPattern.test(objectKey)) return privateError("invalid_key", 400);
    const head = await headR2Object(r2.value, objectKey);
    if (head === null) return privateError("upload_missing", 409);
    const type = baseType(head.contentType);
    if (
      type === null ||
      !(IMAGE_TYPES as readonly string[]).includes(type) ||
      // A cover has no row recording its declared size; an empty file is never one.
      !(head.byteSize > 0) ||
      head.byteSize > MAX_IMAGE_BYTES
    ) {
      return privateError("upload_mismatch", 409);
    }
    if (!(await setDramaCover(db, dramaId, objectKey))) return privateError("not_found", 404);
    return privateJson({ data: { coverKey: objectKey } });
  } catch (error) {
    console.error("[admin tasks] upload completion failed", error);
    return privateError("storage_unavailable", 503);
  }
}
