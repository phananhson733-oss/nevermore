// @input  -- public POST JSON body with one website URL
// @output -- synchronous, transient internal-link crawl report or safe error envelope
// @pos    -- thin Next.js boundary over the shared Public Tools handler

import { handleInternalLinkAuditRequest } from "@/lib/tools/internal-link-audit-handler";

export const runtime = "nodejs";
/** The shared crawler caps itself at 240 seconds; this leaves response headroom. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleInternalLinkAuditRequest(request);
}
