// @input  -- POST {purpose: cover|asset, title, fileName, contentType, byteSize} from the admin uploader
// @output -- a 15-minute signed PUT URL into R2 and the key it writes; an asset also gets a pending row
// @pos    -- step 1 of an upload: the browser then PUTs the file straight to R2, never through this server
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomUUID } from "node:crypto";

import {
  CONTENT_TYPE_EXTENSIONS,
  isUuid,
  uploadRequestSchema,
} from "../../../../../../../lib/task-center/contracts.ts";
import { createPendingAsset } from "../../../../../../../lib/task-center/dramas-store.ts";
import { r2ObjectUrl } from "../../../../../../../lib/task-center/r2.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
  requireR2,
} from "../../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

/**
 * The browser starts the PUT as soon as it gets the URL, and R2 checks the
 * expiry when a PUT starts, so a slow multi-GB upload still finishes. Short,
 * because the URL can overwrite the object for as long as it lives.
 */
const UPLOAD_URL_SECONDS = 900;

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const { dramaId } = await context.params;
  const mutation = await readAdminMutation(request, 2_048);
  if (!mutation.ok) return mutation.response;
  if (!isUuid(dramaId)) return privateError("not_found", 404);
  const parsed = uploadRequestSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const r2 = requireR2();
  if (!r2.ok) return r2.response;

  const upload = parsed.data;
  const id = randomUUID();
  const extension = CONTENT_TYPE_EXTENSIONS[upload.contentType];
  // Keys are ours, never the file name, so nothing typed by a person reaches a path.
  const objectKey =
    upload.purpose === "cover"
      ? `dramas/${dramaId}/covers/${id}.${extension}`
      : `dramas/${dramaId}/assets/${id}.${extension}`;

  if (upload.purpose === "asset") {
    const fromFileName = upload.fileName.replace(/\.[^.]+$/, "").trim().slice(0, 200);
    try {
      const created = await createPendingAsset(mutation.value.db, {
        id,
        dramaId,
        title: upload.title ?? (fromFileName || "clip"),
        objectKey,
        contentType: upload.contentType,
        byteSize: upload.byteSize,
        createdBy: mutation.value.email,
      });
      if (!created) return privateError("not_found", 404);
    } catch (error) {
      console.error("[admin tasks] pending asset failed", error);
      return privateError("tasks_unavailable", 503);
    }
  }

  return privateJson(
    {
      data: {
        assetId: upload.purpose === "asset" ? id : null,
        objectKey,
        uploadUrl: r2ObjectUrl(r2.value, "PUT", objectKey, { expiresSeconds: UPLOAD_URL_SECONDS }),
      },
    },
    201,
  );
}
