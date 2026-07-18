import { NextResponse } from "next/server";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { handleGoogleCallback } from "@/lib/services/source-connect";

/**
 * `GET /api/mvp/oauth/google/callback` — consume one Google OAuth callback and
 * 303 back to the project Sources screen with `oauthIntentId` (success) or a
 * stable `error` code (spec §7.4, §11.2). This is the one GET that consumes
 * external authorization state; it needs both a session and valid state.
 */
export const GET = operatorRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const location = await handleGoogleCallback(
    { workspaceId: ctx.operator.workspaceId },
    {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    },
  );

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
  response.headers.set(REQUEST_ID_HEADER, ctx.requestId);
  return response;
});

export const dynamic = "force-dynamic";
