// @input  -- any POST, typically a tab still polling a run started before durable runs were removed
// @output -- 410 `keyword_run_expired`, private and uncached
// @pos    -- tombstone for the retired durable-run status endpoint; there is no run state to read
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolError } from "@sf/public-tools/contract";

export const runtime = "nodejs";

/**
 * Every run pointer a browser can still hold names a run that no longer has a
 * store behind it, so the answer is the same for all of them and reveals
 * nothing about any one. The client treats this code as terminal: it drops
 * the pointer and goes back to the confirm step instead of retrying.
 */
export async function POST(): Promise<Response> {
  return Response.json(createPublicToolError("keyword_run_expired"), {
    status: 410,
    headers: { "Cache-Control": "no-store, private" },
  });
}
