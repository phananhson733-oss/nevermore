// @input  -- authenticated SEO Agent profile-diagnosis POST
// @output -- cached or live public-page Product/ICP refresh result
// @pos    -- thin Next.js boundary over the shared profile-refresh handler

import { handleAgentProfileRefreshRequest } from "../../../../../lib/agents/profile-refresh-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  return handleAgentProfileRefreshRequest(request, "seo");
}
