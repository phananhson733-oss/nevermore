import { DecideKeywordRelationRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceAttemptRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import {
  decideProjectAuditKeywordRelation,
  getProjectAuditKeywordRelation,
} from "@/lib/services/growth-map-keyword-relations";

const KEYWORD_RELATION_MUTATION_MAX_ATTEMPTS = 30;
const KEYWORD_RELATION_MUTATION_WINDOW_MS = 60 * 1_000;

function rejectQuery(): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Keyword Relation detail does not accept query parameters.",
    {
      errors: [
        {
          pointer: "/query",
          code: "unknown_query_parameter",
          message: "This operation does not accept query parameters.",
        },
      ],
    },
  );
}

function assertNoQuery(request: Request): void {
  if (new URL(request.url).searchParams.size > 0) rejectQuery();
}

function mutationPolicy(projectId: string) {
  return {
    scope: `keyword-relation-mutation:${projectId}`,
    maxAttempts: KEYWORD_RELATION_MUTATION_MAX_ATTEMPTS,
    windowMs: KEYWORD_RELATION_MUTATION_WINDOW_MS,
  } as const;
}

/** Return one current customer-visible Keyword Relation projection. */
export const GET = operatorRoute<{
  projectId: string;
  relationId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, relationId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedRelationId = parseUuidParam(relationId);
  assertNoQuery(request);
  const result = await getProjectAuditKeywordRelation(
    { workspaceId: ctx.operator.workspaceId },
    id,
    selectedRelationId,
  );
  return ok(result, ctx.requestId);
});

/**
 * Append one revision-checked customer decision. Actor identity always comes
 * from the authenticated operator session.
 */
export const PATCH = operatorRoute<{
  projectId: string;
  relationId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, relationId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedRelationId = parseUuidParam(relationId);
  assertNoQuery(request);
  const body = await parseJsonBody(
    request,
    DecideKeywordRelationRequest,
  );
  await assertWorkspaceAttemptRateLimit(
    ctx.operator.workspaceId,
    mutationPolicy(id),
  );
  const result = await decideProjectAuditKeywordRelation(
    {
      workspaceId: ctx.operator.workspaceId,
      actorId: ctx.operator.userId,
    },
    id,
    selectedRelationId,
    body,
  );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
