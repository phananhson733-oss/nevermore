import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalQueryEnum,
  parseQueryBoolean,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectFindings } from "@/lib/services/findings-list";

const DOMAINS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;
const REVIEW_STATES = [
  "unreviewed",
  "confirmed",
  "ignored",
  "needs_more_data",
] as const;

/**
 * `GET /api/mvp/projects/{projectId}/findings` — page of findings + evidence with
 * meta (latest run, coverage, 11 rule results) so "no finding" and "rule did not
 * run" are distinguishable (spec §11.3).
 */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);

  const url = new URL(request.url);
  const cursor = parseQueryValue(url.searchParams, "cursor", Cursor);
  const limit = parseQueryLimit(url.searchParams);
  const activeOnly = parseQueryBoolean(url.searchParams, "active", true);
  const domain = parseOptionalQueryEnum(url.searchParams, "domain", DOMAINS);
  const reviewState = parseOptionalQueryEnum(
    url.searchParams,
    "reviewState",
    REVIEW_STATES,
  );

  const result = await listProjectFindings(
    { workspaceId: ctx.operator.workspaceId },
    id,
    { limit, cursor, activeOnly, domain, reviewState },
  );
  return ok(result.data, ctx.requestId, { meta: result.meta });
});

export const dynamic = "force-dynamic";
