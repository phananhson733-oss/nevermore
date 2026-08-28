// @input  -- same-origin authenticated POST from the knowledge-base editor
// @output -- loads or creates the knowledge base for one site, or one bounded private error
// @pos    -- thin Next.js boundary over the GEO knowledge base handler

import {
  handleGeoKbLoad,
  DEFAULT_GEO_KB_HANDLER_DEPENDENCIES,
} from "../../../../../lib/geo-tools/kb-handler-deps.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleGeoKbLoad(request, DEFAULT_GEO_KB_HANDLER_DEPENDENCIES);
}
