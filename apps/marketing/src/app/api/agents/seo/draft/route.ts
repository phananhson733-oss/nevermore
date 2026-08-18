// @input  -- authenticated request naming one solution kind and the page's own text
// @output -- one preview draft for a site owner to review, or a stable error code
// @pos    -- thin Next.js boundary over the shared draft handler

import { handleAgentDraftRequest } from "../../../../../lib/agents/draft-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAgentDraftRequest(request);
}
