// @input -- authenticated same-origin GEO v3 publish request
// @output -- the private validated handler response; no model call and no crawl budget
// @pos -- Node entrypoint using the shared owner-scoped v3 runtime
import { handleGeoKbV3Publish } from "../../../../../../lib/geo-tools/kb-v3-publish-handler.ts";
import { DEFAULT_GEO_KB_V3_RUNTIME } from "../../../../../../lib/geo-tools/kb-v3-runtime.ts";

export const runtime = "nodejs";
export const maxDuration = 60;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbV3Publish(request, DEFAULT_GEO_KB_V3_RUNTIME.publish);
}
