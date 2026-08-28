// @input  -- authenticated Marketing POST asking for one section to be rewritten
// @output -- a whole new DraftResult with that section replaced, or a stable error envelope
// @pos    -- thin Node.js transport boundary for the section rerun
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { handleContentDraftSectionRequest } from "../../../../../lib/tools/content-draft-handler.ts";

export const runtime = "nodejs";
/** SECTION_ENDPOINT_BUDGET_MS (65 s) stays far below this; a route.test pins the gap. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleContentDraftSectionRequest(request);
}
