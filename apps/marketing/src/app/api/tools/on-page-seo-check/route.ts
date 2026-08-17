// @input  -- authenticated On-Page Checker POST with one page URL and its target queries
// @output -- the same projected audit evidence the SEO Agent returns
// @pos    -- the boundary that gives the checker its own credit identity
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  handleAgentAuditRequest,
  ON_PAGE_CHECK_DEPENDENCIES,
} from "../../../../lib/agents/audit-handler.ts";

export const runtime = "nodejs";
/** The crawler caps itself at 240 seconds; this leaves response headroom. */
export const maxDuration = 300;

/**
 * Same handler, same engine, same in-flight gate, same completed-result cache as
 * `/api/agents/seo/audit` — deliberately, per the Owner ruling that the checker
 * reuses the Agent's execution rather than getting an engine of its own.
 *
 * What this route exists for is the ledger: a run started from the checker is
 * recorded as `on-page-seo-check`, and that identity has to come from the
 * boundary rather than the body, because the request whitelist is frozen and a
 * body field would let the client pick its own label.
 */
export async function POST(request: Request): Promise<Response> {
  return handleAgentAuditRequest(request, "seo", ON_PAGE_CHECK_DEPENDENCIES);
}
