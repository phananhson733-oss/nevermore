// @input  -- POST JSON body naming one granted Search Console property
// @output -- traffic drop diagnosis envelope or a stable error envelope
// @pos    -- thin Next.js boundary over the shared traffic-drop handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { extractClientIp } from "@/lib/rate-limit";
import {
  DEFAULT_TRAFFIC_DROP_DEPENDENCIES,
  handleTrafficDropRequest,
} from "@/lib/tools/traffic-drop-handler";
import { createTrafficDropQueryReader } from "@/lib/tools/traffic-drop-query-reader";
import { createTrafficDropReader } from "@/lib/tools/traffic-drop-reader";

export const runtime = "nodejs";
/** Search Console paging plus backoff; well inside the platform limit. */
export const maxDuration = 60;

/**
 * Whole-request budget for the optional query reads.
 *
 * The daily series has already been fetched by the time these start, so this
 * is what is left rather than the whole route. Deliberately short: the query
 * evidence is an attachment, and a visitor should not wait an extra
 * half-minute for two checks that may still come back `not_available`.
 */
const QUERY_READ_BUDGET_MS = 25_000;

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const remainingMs = () => QUERY_READ_BUDGET_MS - (Date.now() - startedAt);

  return handleTrafficDropRequest(request, {
    ...DEFAULT_TRAFFIC_DROP_DEPENDENCIES,
    // Both readers are built from the token the handler resolved, inside the
    // gate. Building them here would mean resolving the grant before admission
    // control, which is two outbound Google calls per unadmitted request.
    readDailySeries: ({ accessToken, ...input }) =>
      createTrafficDropReader({ accessToken })(input),
    readQueryEvidence: ({ accessToken, ...input }) =>
      createTrafficDropQueryReader({ accessToken, remainingMs })(input),
    now: () => new Date(),
    extractClientIp,
  });
}
