// @input  -- GET from a signed-in browser (a <video>/<img> src or a download link); ?download=1 for a file
// @output -- a 302 to a 15-minute signed R2 URL for a ready clip of a published drama
// @pos    -- how promoters preview and download clips without them passing through this server
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { CONTENT_TYPE_EXTENSIONS, isUuid } from "../../../../../lib/task-center/contracts.ts";
import { getPublicAsset } from "../../../../../lib/task-center/dramas-store.ts";
import { attachmentDisposition, r2ObjectUrl } from "../../../../../lib/task-center/r2.ts";
import {
  authenticateAccountRequest,
  privateError,
  requireR2,
  requireTaskDb,
} from "../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return privateError("not_found", 404);
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const db = requireTaskDb();
  if (!db.ok) return db.response;
  const r2 = requireR2();
  if (!r2.ok) return r2.response;

  let asset;
  try {
    asset = await getPublicAsset(db.value, assetId);
  } catch (error) {
    console.error("[tasks] asset lookup failed", error);
    return privateError("tasks_unavailable", 503);
  }
  if (asset === null) return privateError("not_found", 404);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const extension = CONTENT_TYPE_EXTENSIONS[asset.contentType as keyof typeof CONTENT_TYPE_EXTENSIONS] ?? "bin";
  const fileName = `${asset.title}.${extension}`.replace(/[/\\]/g, "_");
  const target = r2ObjectUrl(r2.value, "GET", asset.objectKey, {
    expiresSeconds: 900,
    query: download ? { "response-content-disposition": attachmentDisposition(fileName) } : undefined,
  });
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "private, no-store" },
  });
}
