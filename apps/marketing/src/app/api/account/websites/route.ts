// @input  -- authenticated account website list/create requests
// @output -- private website summaries/details or stable safe errors
// @pos    -- collection endpoint for Marketing-owned account websites

import { z } from "zod";

import {
  addAccountWebsite,
  listAccountWebsites,
} from "../../../../lib/account-websites/store.ts";
import {
  authenticateAccountRequest,
  CREATE_WEBSITE_BODY_LIMIT_BYTES,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../../../../lib/account-websites/route-http.ts";

export const runtime = "nodejs";

const createWebsiteSchema = z
  .object({
    url: z.string().min(1).max(2_048),
    displayName: z.string().max(160).nullable().optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;

  const result = await listAccountWebsites(authentication.userId);
  return result.kind === "ok"
    ? privateJson({ data: { websites: result.value } })
    : privateError("account_websites_unavailable", 503);
}

export async function POST(request: Request): Promise<Response> {
  const authentication = await authenticateAccountRequest();
  if (!authentication.ok) return authentication.response;

  const body = await readAccountMutationJson(
    request,
    CREATE_WEBSITE_BODY_LIMIT_BYTES,
  );
  if (!body.ok) return body.response;
  const parsed = createWebsiteSchema.safeParse(body.value);
  if (!parsed.success) return privateError("invalid_request", 400);

  const displayName =
    parsed.data.displayName === undefined || parsed.data.displayName === null
      ? null
      : parsed.data.displayName.trim() || null;
  const result = await addAccountWebsite({
    userId: authentication.userId,
    url: parsed.data.url,
    displayName,
  });

  if (result.kind === "ok") {
    return privateJson({ data: { website: result.value } }, 201);
  }
  if (result.kind === "duplicate") {
    return privateJson(
      {
        error: {
          code: "website_exists",
          details: { website: result.website },
        },
      },
      409,
    );
  }
  if (result.kind === "invalid" && result.code === "invalid_url") {
    return privateError("invalid_url", 400);
  }
  return privateError("account_websites_unavailable", 503);
}
