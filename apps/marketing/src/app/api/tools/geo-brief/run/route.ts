// @input  -- an authenticated POST naming a frozen version and one question
// @output -- one assembled brief, or a typed refusal
// @pos    -- thin Next.js boundary over the GEO Brief run handler

import {
  DEFAULT_BRIEF_HANDLER_DEPENDENCIES,
  handleBriefRun,
} from "../../../../../lib/geo-tools/brief-handler-deps.ts";

export const runtime = "nodejs";
/**
 * One sampling call at up to ninety seconds, then one assembly call, then the
 * assembly itself. Three hundred is the ceiling other paid tools here use and
 * it leaves room for a slow provider without holding a function open for a
 * run-sized budget - which is why the visibility tool, whose run is a quarter
 * of an hour, is a workflow instead.
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleBriefRun(request, DEFAULT_BRIEF_HANDLER_DEPENDENCIES);
}
