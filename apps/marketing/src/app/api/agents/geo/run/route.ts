// @input  -- authenticated GEO Agent POST request with confirmed buyer questions
// @output -- one sampled AI-answer visibility report, or a stable typed error
// @pos    -- thin Next.js boundary over the GEO Agent run handler

import { handleGeoRunRequest } from "../../../../../lib/agents/geo-run-handler.ts";

export const runtime = "nodejs";
/**
 * The platform ceiling, matching every other long-running marketing route.
 *
 * One run issues 24 provider calls at concurrency 8; calibration put the
 * slowest single answer at 44s, so three batches plus assembly fit here with
 * room to spare. The handler holds its own tighter budget and degrades to a
 * partial report before this limit can discard the finished envelope.
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleGeoRunRequest(request);
}
