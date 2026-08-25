// @input  -- authenticated Marketing POST for one competitor keyword-gap run
// @output -- the handler's private result or stable error envelope
// @pos    -- thin Node.js transport boundary for the standalone tool

import { handleCompetitorKeywordGapRequest } from "@/lib/tools/competitor-keyword-gap-handler";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  return handleCompetitorKeywordGapRequest(request);
}
