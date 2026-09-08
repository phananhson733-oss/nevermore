// @input -- authenticated same-origin GEO v3 review request
// @output -- the private validated handler response; no route-local provider logic
// @pos -- Node entrypoint using the shared owner-scoped v3 runtime
import { handleGeoKbV3Review } from "../../../../../../lib/geo-tools/kb-v3-review-handler.ts";
import { DEFAULT_GEO_KB_V3_RUNTIME } from "../../../../../../lib/geo-tools/kb-v3-runtime.ts";

export const runtime = "nodejs";
export const maxDuration = 30;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbV3Review(request, DEFAULT_GEO_KB_V3_RUNTIME.review);
}
