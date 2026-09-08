// @input  -- same-origin POST {} and the owned website route parameter
// @output -- private website GEO editor view, in whichever format is stored; GET never creates a KB
// @pos    -- canonical account website GEO entry

import { handleWebsiteGeoLoad } from "../../../../../../lib/account-websites/geo-route.ts";
import { authenticateAccountRequest } from "../../../../../../lib/account-websites/route-http.ts";
import { readAccountWebsite } from "../../../../../../lib/account-websites/store.ts";
import { loadGeoKbEditorAny } from "../../../../../../lib/geo-tools/kb-v2-runtime.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly websiteId: string }> },
): Promise<Response> {
  const { websiteId } = await context.params;
  return handleWebsiteGeoLoad(request, websiteId, {
    authenticate: authenticateAccountRequest,
    readWebsite: readAccountWebsite,
    // Whichever editor this knowledge base actually holds. `loadGeoKbEditorV2`
    // stood here and answered `unavailable` for every v3 draft, which this
    // route turns into 503: a v3 knowledge base that is perfectly fine read as
    // a permanent outage, and the v3 review card -- whose only feed is this
    // route -- could never be reached.
    loadKnowledgeBase: loadGeoKbEditorAny,
  });
}
