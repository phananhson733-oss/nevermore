// @input  -- an authenticated POST with an empty body
// @output -- the frozen knowledge-base versions this account can brief from
// @pos    -- thin Next.js boundary over the GEO Brief load handler

import {
  DEFAULT_BRIEF_HANDLER_DEPENDENCIES,
  handleBriefLoad,
} from "../../../../../lib/geo-tools/brief-handler-deps.ts";

export const runtime = "nodejs";
/** Two reads and no provider call. */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleBriefLoad(request, DEFAULT_BRIEF_HANDLER_DEPENDENCIES);
}
