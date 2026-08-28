// @input  -- authenticated URL lookup for a confirmed website profile
// @output -- exact snapshot reference plus consumer-safe profile
// @pos    -- read boundary used by Tools and Agents to resolve saved profiles

import { findAccountWebsiteByUrl } from "../../../../../lib/account-websites/store.ts";
import {
  authenticateAccountRequest,
  privateError,
  privateJson,
} from "../../../../../lib/account-websites/route-http.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;

  const urls = new URL(request.url).searchParams.getAll("url");
  const url = urls.length === 1 ? urls[0]?.trim() : undefined;
  if (!url || url.length > 2_048) return privateError("invalid_url", 400);

  const result = await findAccountWebsiteByUrl(authentication.userId, url);
  if (result.kind === "ok") return privateJson({ data: result.value });
  if (result.kind === "missing") return privateError("website_not_found", 404);
  if (result.kind === "invalid") {
    return result.code === "profile_not_confirmed"
      ? privateError("profile_not_confirmed", 409)
      : privateError("invalid_url", 400);
  }
  return privateError("account_websites_unavailable", 503);
}
