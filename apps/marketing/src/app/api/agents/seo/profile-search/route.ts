// @input  -- authenticated SEO Agent profile-search POST
// @output -- bounded organic-search overlap evidence or typed availability
// @pos    -- thin Next.js boundary over the shared profile-search handler

import { handleAgentProfileSearchRequest } from "../../../../../lib/agents/profile-search-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAgentProfileSearchRequest(request, "seo");
}
