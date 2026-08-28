// @input  -- public POST JSON body with one page URL and an optional target question
// @output -- a transient citability report or a safe error envelope
// @pos    -- thin Next.js boundary over the page-citability handler

import { handleCitabilityRequest } from "../../../../lib/geo-tools/citability-handler.ts";

export const runtime = "nodejs";
/**
 * Three bounded fetches at eight seconds each, plus parsing. Sixty leaves
 * headroom without holding a function open for a crawl-sized budget.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCitabilityRequest(request);
}
