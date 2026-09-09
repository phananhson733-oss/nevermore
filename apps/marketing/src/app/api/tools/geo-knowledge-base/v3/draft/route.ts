// @input -- authenticated same-origin request to start a v3 GEO knowledge base
// @output -- the private validated handler response; no route-local provider logic
// @pos -- Node entrypoint using the shared owner-scoped v3 runtime
import { handleGeoKbV3DraftCreate } from "../../../../../../lib/geo-tools/kb-v3-draft-create.ts";
import { DEFAULT_GEO_KB_V3_RUNTIME } from "../../../../../../lib/geo-tools/kb-v3-runtime.ts";

export const runtime = "nodejs";
/**
 * The collection this step performs bounds itself at 70 s and each page fetch
 * at 8 s, so the ceiling is the platform's rather than the working budget --
 * the same reason the single-run route carries 300. Returning late is
 * recoverable; being killed mid-request leaves a spent crawl allowance with no
 * draft to show for it.
 */
export const maxDuration = 300;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbV3DraftCreate(request, DEFAULT_GEO_KB_V3_RUNTIME.draft);
}
