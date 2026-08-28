// @input  -- authenticated Marketing POST asking for a full draft from a parsed brief
// @output -- the assembled DraftResult or a stable error envelope
// @pos    -- thin Node.js transport boundary for the draft tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { handleContentDraftRunRequest } from "../../../../../lib/tools/content-draft-handler.ts";

export const runtime = "nodejs";
/** Far above the 120 s soft budget on purpose; a route.test pins the gap. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleContentDraftRunRequest(request);
}
