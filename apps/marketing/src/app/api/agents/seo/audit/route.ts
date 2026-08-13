// @input  -- authenticated SEO Agent POST request with one public website URL
// @output -- buffered metadata, structure, and structured-data crawl evidence
// @pos    -- thin Next.js boundary over the shared authenticated Agent handler

import { handleAgentAuditRequest } from "../../../../../lib/agents/audit-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleAgentAuditRequest(request, "seo");
}
