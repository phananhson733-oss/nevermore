// @input -- authenticated same-origin GEO v2 generation request
// @output -- the private validated handler response; no route-local provider logic
// @pos -- Node entrypoint using the shared owner-scoped v2 runtime
import { handleGeoKbGenerationRead } from "../../../../../../lib/geo-tools/kb-generation-handler.ts";
import { DEFAULT_GEO_KB_V2_RUNTIME } from "../../../../../../lib/geo-tools/kb-v2-runtime.ts";

export const runtime = "nodejs";
export const maxDuration = 30;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbGenerationRead(request, DEFAULT_GEO_KB_V2_RUNTIME.generation);
}
