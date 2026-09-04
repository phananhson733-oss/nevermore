// @input  -- authenticated Agent POST naming one page URL
// @output -- Search Console queries that page earned impressions for, or a typed reason
// @pos    -- thin Next.js boundary over the shared target-query handler

import { handleAgentTargetQueryRequest } from "../../../../lib/agents/target-query-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleAgentTargetQueryRequest(request);
}
