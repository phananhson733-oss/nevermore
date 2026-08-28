// @input  -- private account API requests and the verified Marketing auth boundary
// @output -- bounded JSON/auth results and consistently private JSON responses
// @pos    -- shared HTTP policy for account website route handlers

import { z } from "zod";

import { isSameOriginPost } from "../auth/disconnect.ts";
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";

export const CREATE_WEBSITE_BODY_LIMIT_BYTES = 8_192;
export const SAVE_PROFILE_BODY_LIMIT_BYTES = 131_072;
export const CONFIRM_PROFILE_BODY_LIMIT_BYTES = 1_024;

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function privateError(code: string, status: number): Response {
  return privateJson({ error: { code } }, status);
}

export type AccountAuthenticationResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly response: Response };

export async function authenticateAccountRequest(): Promise<AccountAuthenticationResult> {
  const authentication = await getServerAuthenticatedUser().catch(() => ({
    status: "unavailable" as const,
  }));
  if (authentication.status === "unavailable") {
    return { ok: false, response: privateError("auth_unavailable", 503) };
  }
  if (authentication.status === "unauthenticated") {
    return { ok: false, response: privateError("auth_required", 401) };
  }
  return { ok: true, userId: authentication.userId };
}

export type AccountJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

export async function readAccountMutationJson(
  request: Request,
  maxBytes: number,
): Promise<AccountJsonResult> {
  if (!isSameOriginPost(request)) {
    return { ok: false, response: privateError("cross_origin", 403) };
  }
  const body = await readPublicToolJson(request, maxBytes);
  if (body.ok) return body;
  const status =
    body.code === "unsupported_media_type"
      ? 415
      : body.code === "payload_too_large"
        ? 413
        : 400;
  return { ok: false, response: privateError(body.code, status) };
}

export function parseAccountWebsiteId(value: string): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
