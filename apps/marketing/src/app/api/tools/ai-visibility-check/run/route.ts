// @input  -- same-origin authenticated POST naming a frozen version and a sample count
// @output -- a sealed run pointer, or a refusal before anything is charged
// @pos    -- the only place a paid visibility run is started

import { start } from "workflow/api";

import {
  DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
  handleVisibilityStart,
} from "../../../../../lib/geo-tools/visibility-handler-deps.ts";
import { geoVisibilityWorkflow } from "../../../../../lib/geo-tools/visibility-workflow.ts";

export const runtime = "nodejs";
/** The run itself is durable; this route only hands it off. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleVisibilityStart(request, {
    ...DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES,
    // `start` is called from the route so the workflow entry point is a static
    // import the bundler can see; resolving it dynamically loses the binding.
    startRun: async (inputToken: string) => {
      const run = await start(geoVisibilityWorkflow, [{ inputToken }]);
      return { runId: run.runId };
    },
  });
}
