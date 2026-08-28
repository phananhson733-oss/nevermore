// @input  -- same-origin authenticated POST carrying a sealed keyword run token
// @output -- queued/running/redirect/completed state or a stable private error
// @pos    -- thin Next.js boundary over the caller-bound Workflow status handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  handleKeywordWorkflowStatusRequest,
  readKeywordIdentity,
  readKeywordWorkflowRun,
} from "@/lib/tools/keyword-workflow-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleKeywordWorkflowStatusRequest(request, {
    readIdentity: readKeywordIdentity,
    readRun: readKeywordWorkflowRun,
    now: Date.now,
  });
}
