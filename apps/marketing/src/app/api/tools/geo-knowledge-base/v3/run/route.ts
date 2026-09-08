// @input -- authenticated same-origin GEO v3 run requests naming a knowledge base
// @output -- the run's public state after one operation; no lease token leaves the server
// @pos -- Node entrypoint for the single-run update route
import { handleGeoKbRun } from "../../../../../../lib/geo-tools/kb-run-handler.ts";
import { DEFAULT_GEO_KB_RUN_DEPENDENCIES } from "../../../../../../lib/geo-tools/kb-run-runtime.ts";

export const runtime = "nodejs";
/**
 * The platform ceiling, not the working budget. One invocation stops handing
 * out work at 250 s (GEO_RUN_INVOCATION_BUDGET_MS) so it returns rather than
 * being killed mid-request -- the one way a charge leaves no trace of where it
 * happened.
 */
export const maxDuration = 300;
export function POST(request: Request): Promise<Response> {
  return handleGeoKbRun(request, DEFAULT_GEO_KB_RUN_DEPENDENCIES);
}
