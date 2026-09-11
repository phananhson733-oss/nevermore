// @input -- authenticated same-origin request naming one rival in one v3 GEO knowledge base draft
// @output -- the private validated handler response; no route-local provider logic
// @pos -- Node entrypoint using the shared owner-scoped v3 runtime
import { handleGeoKbV3Competitors } from "../../../../../../lib/geo-tools/kb-v3-competitor-handler.ts";
import { DEFAULT_GEO_KB_V3_RUNTIME } from "../../../../../../lib/geo-tools/kb-v3-runtime.ts";

export const runtime = "nodejs";
/**
 * `identify` reads one homepage, bounded at 8 s, behind a crawl gate that may
 * itself wait for an in-flight crawl on this isolate; the ceiling leaves room
 * for both. `confirm` and `unconfirm` are one owner-scoped read and one write.
 */
export const maxDuration = 60;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbV3Competitors(request, DEFAULT_GEO_KB_V3_RUNTIME.competitors);
}
