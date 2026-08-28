// @input  -- same-origin authenticated POST with an empty body
// @output -- the frozen knowledge-base versions this account can run against
// @pos    -- thin Next.js boundary over the visibility handler

import {
  DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
  handleVisibilityLoad,
} from "../../../../../lib/geo-tools/visibility-handler-deps.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleVisibilityLoad(request, DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES);
}
