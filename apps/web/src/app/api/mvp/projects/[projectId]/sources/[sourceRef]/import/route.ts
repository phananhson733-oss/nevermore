import { NextResponse } from "next/server";
import { ImportConfirmRequest } from "@sf/contracts";
import { ProblemError, REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { confirmImport, previewImport, MAX_IMPORT_BYTES } from "@/lib/services/csv-import";

/**
 * `POST /api/mvp/projects/{projectId}/sources/csv/import` — CSV keyword-gap import
 * (spec §7.5). `multipart/form-data` ⇒ preview (200); `application/json` with
 * `mode=confirm` ⇒ confirm (202 async). Only the `csv` provider uses this route.
 */
export const POST = operatorRoute<{ projectId: string; sourceRef: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, sourceRef } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    if (sourceRef !== "csv") {
      throw new ProblemError("NOT_FOUND", "Only the csv provider supports import.");
    }
    const scope = { workspaceId: ctx.operator.workspaceId };
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new ProblemError("VALIDATION_ERROR", "A CSV file field is required.");
      }
      if (file.size > MAX_IMPORT_BYTES) {
        throw new ProblemError("IMPORT_TOO_LARGE", "CSV exceeds the 20MB import limit.");
      }
      const templateId = String(form.get("templateId") ?? "keyword_gap_v1");
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await previewImport(scope, id, ctx.operator.userId, { bytes, templateId });
      return ok(result, ctx.requestId);
    }

    const body = await parseJsonBody(request, ImportConfirmRequest);
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await confirmImport(scope, id, ctx.operator.userId, idempotencyKey, body);
    const response = NextResponse.json(
      { run: result.run, statusUrl: result.statusUrl, resourceRef: result.resourceRef },
      { status: 202 },
    );
    response.headers.set("Location", result.location);
    response.headers.set("Retry-After", "1");
    response.headers.set(REQUEST_ID_HEADER, ctx.requestId);
    return response;
  },
);

export const dynamic = "force-dynamic";
