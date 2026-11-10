// @input  -- a drama's id, the cover URL 查剧 found for it (北斗's or the theater's CDN), the time left before the admin request must answer
// @output -- the cover copied into R2 and set on the drama: "saved", "missing" (no URL), or "failed" (no R2, a refused or slow download, a failed upload)
// @pos    -- shared by 用这部 (dramas/import) and 从官网补全 (dramas/<id>/refill); the drama is already written either way, so a cover that fails only leaves the operator to upload one
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomUUID } from "node:crypto";

import { CONTENT_TYPE_EXTENSIONS } from "./contracts.ts";
import type { TaskDb } from "./db.ts";
import { fetchCover } from "./drama-lookup.ts";
import { setDramaCover } from "./dramas-store.ts";
import { putR2Object, readR2Config } from "./r2.ts";

export type CoverCopy = "saved" | "missing" | "failed";

/** Download and upload share the time left before the deadline. */
export async function copyCover(
  db: TaskDb,
  dramaId: string,
  coverUrl: string | null,
  leftMs: number,
): Promise<CoverCopy> {
  const until = Date.now() + leftMs;
  if (coverUrl === null) return "missing";
  const r2 = readR2Config();
  if (r2 === null) return "failed";
  const image = await fetchCover(coverUrl, fetch, leftMs);
  if (image === null) return "failed";
  const key = `dramas/${dramaId}/covers/${randomUUID()}.${CONTENT_TYPE_EXTENSIONS[image.contentType]}`;
  try {
    const remaining = until - Date.now();
    if (remaining < 1_000) return "failed";
    await putR2Object(r2, key, image.bytes, image.contentType, fetch, remaining);
    return (await setDramaCover(db, dramaId, key)) ? "saved" : "failed";
  } catch (error) {
    console.error("[admin tasks] cover copy failed", error instanceof Error ? error.message : error);
    return "failed";
  }
}
