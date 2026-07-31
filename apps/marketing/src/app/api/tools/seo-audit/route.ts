// @input  -- public POST JSON body with one website URL
// @output -- language-neutral synchronous SEO Audit report or stable error envelope
// @pos    -- thin Next.js boundary over the shared Public Tools handler

import { handleSeoAuditRequest } from "@/lib/tools/seo-audit-handler";

export const runtime = "nodejs";
/** The crawler caps itself at 240 seconds; this leaves response headroom. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleSeoAuditRequest(request);
}
