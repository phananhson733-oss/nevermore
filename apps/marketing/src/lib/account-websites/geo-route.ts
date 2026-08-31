// @input  -- authenticated POST {}, with the website identity owned by the route
// @output -- the owned website's existing GEO asset, never client-selected site data
// @pos    -- canonical website → GEO boundary; shared KB load retains one site key

import { normalizeAccountWebsiteUrl } from "./contracts.ts";
import type { readAccountWebsite } from "./store.ts";
import {
  type authenticateAccountRequest,
  parseAccountWebsiteId,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "./route-http.ts";
import type { GeoKbHandlerDependencies } from "../geo-tools/kb-handler.ts";

export interface WebsiteGeoDependencies {
  readonly authenticate: typeof authenticateAccountRequest;
  readonly readWebsite: typeof readAccountWebsite;
  readonly loadKnowledgeBase: GeoKbHandlerDependencies["loadKnowledgeBase"];
}

export async function handleWebsiteGeoLoad(
  request: Request,
  websiteId: string,
  dependencies: WebsiteGeoDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  if (parseAccountWebsiteId(websiteId) === null) {
    return privateError("website_not_found", 404);
  }
  const body = await readAccountMutationJson(request, 1_024);
  if (!body.ok) return body.response;
  if (body.value === null || typeof body.value !== "object" ||
      Array.isArray(body.value) || Object.keys(body.value).length !== 0) {
    return privateError("invalid_request", 400);
  }

  const result = await dependencies.readWebsite(auth.userId, websiteId);
  if (result.kind === "missing") return privateError("website_not_found", 404);
  if (result.kind !== "ok") return privateError("account_websites_unavailable", 503);
  const website = result.value;
  const loaded = await dependencies.loadKnowledgeBase({ userId: auth.userId, url: website.origin });
  if (loaded.kind === "not_found") return privateError("not_found", 404);
  if (loaded.kind !== "ok") return privateError("store_unavailable", 503);

  // Both the old URL shortcut and this route resolve the same canonical site.
  // Refuse inconsistent store output instead of returning another site's data.
  const site = normalizeAccountWebsiteUrl(loaded.value.origin);
  if (site === null || site.canonicalSiteKey !== website.canonicalSiteKey ||
      (loaded.value.profile != null && loaded.value.profile.reference.websiteId !== websiteId)) {
    return privateError("store_unavailable", 503);
  }
  return privateJson({ data: {
    website: { websiteId, origin: website.origin, host: website.host, profileState: website.profileState },
    knowledgeBase: loaded.value,
  } });
}
