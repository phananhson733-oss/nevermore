import { CreateProductProfileSynthesisRunRequest } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createProductProfileSynthesisRun } from "@/lib/services/product-profile-synthesis";

/** Queue a frozen-input Product Profile synthesis run; never starts an Audit. */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "product_profile_synthesis",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(
      request,
      CreateProductProfileSynthesisRunRequest,
    );
    const result = await createProductProfileSynthesisRun(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
      {
        outputLocale: resolveUiLocale(
          request.cookies.get(UI_LOCALE_COOKIE)?.value,
        ),
      },
    );
    return asyncAccepted(
      {
        run: result.run,
        statusUrl: result.statusUrl,
        resourceRef: result.resourceRef,
      },
      ctx.requestId,
      result.location,
    );
  },
);

export const dynamic = "force-dynamic";
