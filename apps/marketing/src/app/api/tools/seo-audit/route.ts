// @input  -- authenticated POST JSON body with one website URL
// @output -- projected SEO Agent audit evidence or shared auth/upstream errors
// @pos    -- compatibility boundary over the shared authenticated Agent handler

import { handleAgentAuditRequest } from "../../../../lib/agents/audit-handler.ts";

export const runtime = "nodejs";
/** The crawler caps itself at 240 seconds; this leaves response headroom. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleAgentAuditRequest(request, "seo");
}
