// @input  -- authenticated Marketing POST for one Content Brief Builder run
// @output -- the assembled ContentBrief or a stable error envelope
// @pos    -- thin Node.js transport boundary for the standalone tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { handleContentBriefRequest } from "../../../../../lib/tools/content-brief-handler.ts";

export const runtime = "nodejs";
/**
 * Far above the 45 s soft budget on purpose: the budget is what the page
 * prints and the handler enforces per stage; the platform kill is what erases
 * the evidence of where a run died. A route.test pins the gap.
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleContentBriefRequest(request);
}
