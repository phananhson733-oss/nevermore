// @input  -- public POST JSON body with one website URL
// @output -- bounded, transient internal-link crawl report or safe error envelope
// @pos    -- thin Next.js boundary over the shared Public Tools handler

import { handleInternalLinkAuditRequest } from "@/lib/tools/internal-link-audit-handler";

export const runtime = "nodejs";
/** The crawl itself caps at 40 seconds; this allows safe response headroom. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleInternalLinkAuditRequest(request);
}
