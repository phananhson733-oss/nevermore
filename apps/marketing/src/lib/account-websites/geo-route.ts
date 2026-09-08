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
import type { GeoKbStoreOutcome, GeoKbView } from "../geo-tools/kb-handler.ts";
import type { GeoKbEditorViewV2 } from "../../components/tools/geo-kb-v2-wire.ts";
import type { GeoKbEditorViewV3Wire } from "../geo-tools/kb-editor-loader.ts";
import { privateGeoEditorJson } from "../geo-tools/kb-editor-response.ts";

/**
 * The three stored formats this route can answer with. It never picks one: the
 * loader answers with whichever the knowledge base actually holds, and
 * `schemaVersion` -- absent on v1, a different literal for each of the other
 * two -- is what the browser discriminates on.
 */
export type WebsiteGeoKnowledgeBase = GeoKbView | GeoKbEditorViewV2 | GeoKbEditorViewV3Wire;

/**
 * Pinned against the wire type rather than written twice: renaming the
 * discriminator on `GeoKbEditorViewV3Wire` makes this assignment fail to
 * compile instead of silently turning every v3 load into a v1 one.
 */
const V3_SCHEMA_VERSION: GeoKbEditorViewV3Wire["schemaVersion"] = "marketing-geo-kb-editor.v3";

function isV3(knowledgeBase: WebsiteGeoKnowledgeBase): knowledgeBase is GeoKbEditorViewV3Wire {
  return "schemaVersion" in knowledgeBase && knowledgeBase.schemaVersion === V3_SCHEMA_VERSION;
}

/**
 * Whether the loaded knowledge base names the website this route resolved.
 *
 * The three formats say so in three places. A v1/v2 view carries an inherited
 * Profile and a stored Profile copy, either of which may be absent. A v3 draft
 * carries neither: the confirmed revision its generation was locked to is named
 * by `profileRef`, so that is the field the same question is asked of. Skipping
 * the check for v3 would make it the one format this route hands back with
 * another website's product facts in it.
 */
function namesThisWebsite(knowledgeBase: WebsiteGeoKnowledgeBase, websiteId: string): boolean {
  if (isV3(knowledgeBase)) return knowledgeBase.payload.generationInput.profileRef.websiteId === websiteId;
  return (knowledgeBase.profile == null || knowledgeBase.profile.reference.websiteId === websiteId)
    && (knowledgeBase.payload.profileCopy === undefined || knowledgeBase.payload.profileCopy.websiteId === websiteId);
}

export interface WebsiteGeoDependencies {
  readonly authenticate: typeof authenticateAccountRequest;
  readonly readWebsite: typeof readAccountWebsite;
  readonly loadKnowledgeBase: (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbStoreOutcome<WebsiteGeoKnowledgeBase>>;
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
  // A website whose Profile has never been confirmed is not an outage, and
  // telling the visitor the store did not respond sends them to retry a thing
  // that will never start working. The tools route already separates these.
  if (loaded.kind === "profile_copy_required") return privateError("profile_copy_required", 409);
  if (loaded.kind !== "ok") return privateError("store_unavailable", 503);

  // Both the old URL shortcut and this route resolve the same canonical site.
  // Refuse inconsistent store output instead of returning another site's data.
  const site = normalizeAccountWebsiteUrl(loaded.value.origin);
  if (site === null || site.canonicalSiteKey !== website.canonicalSiteKey ||
      !namesThisWebsite(loaded.value, websiteId)) {
    return privateError("store_unavailable", 503);
  }
  const respond = "schemaVersion" in loaded.value ? privateGeoEditorJson : privateJson;
  return respond({ data: {
    website: { websiteId, origin: website.origin, host: website.host, profileState: website.profileState },
    knowledgeBase: loaded.value,
  } });
}
