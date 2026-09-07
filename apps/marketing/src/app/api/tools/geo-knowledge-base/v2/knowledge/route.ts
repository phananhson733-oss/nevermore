// @input -- authenticated same-origin GEO v2 knowledge-pack request
// @output -- the private validated handler response; no route-local crawl or provider logic
// @pos -- Node entrypoint using the shared owner-scoped v2 runtime
import { handleGeoKbGeneration } from "../../../../../../lib/geo-tools/kb-generation-handler.ts";
import { DEFAULT_GEO_KB_V2_RUNTIME } from "../../../../../../lib/geo-tools/kb-v2-runtime.ts";

export const runtime = "nodejs";
export const maxDuration = 300;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbGeneration(request, "knowledge_pack", DEFAULT_GEO_KB_V2_RUNTIME.generation);
}
