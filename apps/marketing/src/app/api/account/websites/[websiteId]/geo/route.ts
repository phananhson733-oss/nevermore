// @input  -- same-origin POST {} and the owned website route parameter
// @output -- private website GEO editor view; GET never creates a KB
// @pos    -- canonical account website GEO entry

import { handleWebsiteGeoLoad } from "../../../../../../lib/account-websites/geo-route.ts";
import { authenticateAccountRequest } from "../../../../../../lib/account-websites/route-http.ts";
import { readAccountWebsite } from "../../../../../../lib/account-websites/store.ts";
import { DEFAULT_GEO_KB_HANDLER_DEPENDENCIES } from "../../../../../../lib/geo-tools/kb-handler-deps.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly websiteId: string }> },
): Promise<Response> {
  const { websiteId } = await context.params;
  return handleWebsiteGeoLoad(request, websiteId, {
    authenticate: authenticateAccountRequest,
    readWebsite: readAccountWebsite,
    loadKnowledgeBase: DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase,
  });
}
