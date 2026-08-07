// @input  -- POST JSON body naming one granted Search Console property
// @output -- SEO Quick Wins evidence envelope or a stable error envelope
// @pos    -- thin Next.js boundary over the shared quick-wins handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { extractClientIp } from "@/lib/rate-limit";
import {
  DEFAULT_QUICK_WINS_DEPENDENCIES,
  handleQuickWinsRequest,
} from "@/lib/tools/quick-wins-handler";
import { createQuickWinsReader } from "@/lib/tools/quick-wins-reader";

export const runtime = "nodejs";
/** Two concurrent Search Console reads plus one backoff each. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleQuickWinsRequest(request, {
    ...DEFAULT_QUICK_WINS_DEPENDENCIES,
    // The reader is built from the token the handler resolved, inside the
    // gate. Building it here would mean resolving the grant before admission
    // control, which is two outbound Google calls per unadmitted request.
    runReport: ({ accessToken, ...input }) =>
      createQuickWinsReader({ accessToken })(input),
    now: () => new Date(),
    extractClientIp,
  });
}
