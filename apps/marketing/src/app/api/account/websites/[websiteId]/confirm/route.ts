// @input  -- authenticated confirmation of one exact saved website draft version
// @output -- immutable confirmed snapshot details or stable safe conflicts/errors
// @pos    -- explicit confirmation boundary for reusable website profiles

import { z } from "zod";

import { confirmAccountWebsiteProfile } from "../../../../../../lib/account-websites/store.ts";
import {
  authenticateAccountRequest,
  CONFIRM_PROFILE_BODY_LIMIT_BYTES,
  parseAccountWebsiteId,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../../../../../../lib/account-websites/route-http.ts";

export const runtime = "nodejs";

interface WebsiteRouteContext {
  readonly params: Promise<{ readonly websiteId: string }>;
}

const confirmationSchema = z
  .object({ baseVersion: z.number().int().nonnegative() })
  .strict();

export async function POST(
  request: Request,
  context: WebsiteRouteContext,
): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const { websiteId: rawWebsiteId } = await context.params;
  const websiteId = parseAccountWebsiteId(rawWebsiteId);
  if (websiteId === null) return privateError("website_not_found", 404);

  const body = await readAccountMutationJson(
    request,
    CONFIRM_PROFILE_BODY_LIMIT_BYTES,
  );
  if (!body.ok) return body.response;
  const input = confirmationSchema.safeParse(body.value);
  if (!input.success) return privateError("invalid_request", 400);

  const result = await confirmAccountWebsiteProfile({
    userId: authentication.userId,
    websiteId,
    baseVersion: input.data.baseVersion,
  });
  if (result.kind === "ok") {
    return privateJson({ data: { website: result.value } });
  }
  if (result.kind === "missing") return privateError("website_not_found", 404);
  if (result.kind === "conflict") {
    return privateJson(
      {
        error: {
          code: "profile_conflict",
          details: { website: result.current },
        },
      },
      409,
    );
  }
  if (result.kind === "invalid" && result.code === "profile_incomplete") {
    return privateJson(
      {
        error: {
          code: "profile_incomplete",
          fields: result.fields ?? [],
        },
      },
      422,
    );
  }
  return privateError("account_websites_unavailable", 503);
}
