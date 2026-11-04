// @input  -- same-origin authenticated POST naming a frozen version and a sample count
// @output -- a refusal before anything is charged; runs are paused while no executor is wired
// @pos    -- the only place a paid visibility run would be started

import {
  DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
  handleVisibilityStart,
} from "../../../../../lib/geo-tools/visibility-handler-deps.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleVisibilityStart(request, DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES);
}
