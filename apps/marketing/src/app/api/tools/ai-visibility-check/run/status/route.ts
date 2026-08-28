// @input  -- same-origin authenticated POST carrying a sealed run pointer
// @output -- queued, running, the finished report, or a stable private error
// @pos    -- thin Next.js boundary over the visibility status handler

import {
  DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
  handleVisibilityStatus,
} from "../../../../../../lib/geo-tools/visibility-handler-deps.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleVisibilityStatus(
    request,
    DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
  );
}
