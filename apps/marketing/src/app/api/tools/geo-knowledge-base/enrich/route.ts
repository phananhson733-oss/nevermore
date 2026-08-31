// @input  -- same-origin authenticated request for one saved KB
// @output -- persisted, reviewable enrichment receipt or a bounded refusal
// @pos    -- source collection entry; never saves an editor draft

import { handleGeoKbEnrichment } from "../../../../../lib/geo-tools/kb-enrichment-handler.ts";
import { DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES } from "../../../../../lib/geo-tools/kb-enrichment-deps.ts";

export const runtime = "nodejs";
export const maxDuration = 120;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbEnrichment(request, DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES);
}
