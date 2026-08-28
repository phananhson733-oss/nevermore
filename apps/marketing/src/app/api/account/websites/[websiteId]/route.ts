// @input  -- authenticated website detail, primary switch, or draft save request
// @output -- exact private website details, conflicts, or stable safe errors
// @pos    -- item endpoint for Marketing-owned account websites

import { z } from "zod";

import {
  parseMarketingWebsiteProfile,
  parseWebsiteProfileReference,
} from "../../../../../lib/account-websites/contracts.ts";
import {
  readAccountWebsite,
  saveAccountWebsiteDraft,
  setPrimaryAccountWebsite,
  type WebsiteStoreResult,
} from "../../../../../lib/account-websites/store.ts";
import {
  authenticateAccountRequest,
  parseAccountWebsiteId,
  privateError,
  privateJson,
  readAccountMutationJson,
  SAVE_PROFILE_BODY_LIMIT_BYTES,
} from "../../../../../lib/account-websites/route-http.ts";

export const runtime = "nodejs";

interface WebsiteRouteContext {
  readonly params: Promise<{ readonly websiteId: string }>;
}

const mutationSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("set_primary") }).strict(),
  z
    .object({
      intent: z.literal("save_profile"),
      baseVersion: z.number().int().nonnegative(),
      profile: z.unknown(),
      expectedReference: z.unknown().optional(),
    })
    .strict(),
]);

function websiteResult(
  result: WebsiteStoreResult<unknown>,
  successStatus = 200,
): Response {
  if (result.kind === "ok") {
    return privateJson({ data: { website: result.value } }, successStatus);
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
  if (result.kind === "invalid") {
    return privateError(
      result.code === "invalid_profile" || result.code === "invalid_reference"
        ? result.code
        : "invalid_request",
      400,
    );
  }
  return privateError("account_websites_unavailable", 503);
}

async function ownedWebsiteId(
  context: WebsiteRouteContext,
): Promise<string | null> {
  const { websiteId } = await context.params;
  return parseAccountWebsiteId(websiteId);
}

export async function GET(
  _request: Request,
  context: WebsiteRouteContext,
): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const websiteId = await ownedWebsiteId(context);
  if (websiteId === null) return privateError("website_not_found", 404);
  return websiteResult(
    await readAccountWebsite(authentication.userId, websiteId),
  );
}

export async function PATCH(
  request: Request,
  context: WebsiteRouteContext,
): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;
  const websiteId = await ownedWebsiteId(context);
  if (websiteId === null) return privateError("website_not_found", 404);

  const body = await readAccountMutationJson(
    request,
    SAVE_PROFILE_BODY_LIMIT_BYTES,
  );
  if (!body.ok) return body.response;
  const mutation = mutationSchema.safeParse(body.value);
  if (!mutation.success) return privateError("invalid_request", 400);

  if (mutation.data.intent === "set_primary") {
    return websiteResult(
      await setPrimaryAccountWebsite({
        userId: authentication.userId,
        websiteId,
      }),
    );
  }

  let profile;
  try {
    profile = parseMarketingWebsiteProfile(mutation.data.profile);
  } catch {
    return privateError("invalid_profile", 400);
  }
  let expectedReference;
  try {
    expectedReference =
      mutation.data.expectedReference === undefined
        ? undefined
        : parseWebsiteProfileReference(mutation.data.expectedReference);
  } catch {
    return privateError("invalid_reference", 400);
  }
  if (
    expectedReference !== undefined &&
    expectedReference.websiteId !== websiteId
  ) {
    return privateError("invalid_reference", 400);
  }
  return websiteResult(
    await saveAccountWebsiteDraft({
      userId: authentication.userId,
      websiteId,
      baseVersion: mutation.data.baseVersion,
      profile,
      ...(expectedReference === undefined ? {} : { expectedReference }),
    }),
  );
}
