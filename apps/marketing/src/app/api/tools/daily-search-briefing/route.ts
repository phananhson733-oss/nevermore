// @input  -- POST JSON body naming one granted Search Console property
// @output -- Daily Search Briefing envelope or a stable error envelope
// @pos    -- thin Next.js boundary over the shared daily-briefing handler

import { extractClientIp } from "@/lib/rate-limit";
import {
  DEFAULT_DAILY_BRIEFING_DEPENDENCIES,
  handleDailyBriefingRequest,
} from "@/lib/tools/daily-briefing-handler";
import { createDailyBriefingReader } from "@/lib/tools/daily-briefing-reader";

export const runtime = "nodejs";
/** Forty-five seconds of handler budget leaves room for a stable response. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleDailyBriefingRequest(request, {
    ...DEFAULT_DAILY_BRIEFING_DEPENDENCIES,
    // This callback is invoked only after the handler admitted the request and
    // resolved its grant, keeping both reader and token request-scoped.
    runReport: ({ accessToken, ...input }) =>
      createDailyBriefingReader({ accessToken })(input),
    extractClientIp,
  });
}
