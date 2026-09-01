// @input -- authenticated same-origin GEO v2 sources request
// @output -- the private validated handler response; no route-local provider logic
// @pos -- Node entrypoint using the shared owner-scoped v2 runtime
import { handleGeoKbSources } from "../../../../../../lib/geo-tools/kb-source-handler.ts";
import { DEFAULT_GEO_KB_V2_RUNTIME } from "../../../../../../lib/geo-tools/kb-v2-runtime.ts";

export const runtime = "nodejs";
export const maxDuration = 120;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbSources(request, DEFAULT_GEO_KB_V2_RUNTIME.sources);
}
