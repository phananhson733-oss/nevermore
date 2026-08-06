import { Cursor, Uuid } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceAttemptRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
  requestHasBodyBytes,
} from "@/lib/http/validate";
import {
  listProjectAuditKeywordRelations,
  refreshProjectAuditKeywordRelations,
} from "@/lib/services/growth-map-keyword-relations";

const KEYWORD_RELATION_MUTATION_MAX_ATTEMPTS = 30;
const KEYWORD_RELATION_MUTATION_WINDOW_MS = 60 * 1_000;
const MAX_KEYWORD_IDS = 50;
const LIST_QUERY_NAMES = new Set(["limit", "cursor", "keywordId"]);

function rejectQuery(pointer = "/query"): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer,
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ],
    },
  );
}

function rejectBody(): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Keyword Relation refresh does not accept a request body.",
    {
      errors: [
        {
          pointer: "/body",
          code: "unexpected_request_body",
          message: "This operation does not accept a request body.",
        },
      ],
    },
  );
}

function assertOnlyListQuery(searchParams: URLSearchParams): void {
  for (const name of searchParams.keys()) {
    if (!LIST_QUERY_NAMES.has(name)) rejectQuery();
  }
}

function parseKeywordIds(
  searchParams: URLSearchParams,
): string[] | undefined {
  const values = searchParams.getAll("keywordId");
  if (values.length === 0) return undefined;
  if (
    values.length > MAX_KEYWORD_IDS ||
    new Set(values).size !== values.length ||
    values.some((value) => !Uuid.safeParse(value).success)
  ) {
    return rejectQuery("/keywordId");
  }
  return values;
}

function mutationPolicy(projectId: string) {
  return {
    scope: `keyword-relation-mutation:${projectId}`,
    maxAttempts: KEYWORD_RELATION_MUTATION_MAX_ATTEMPTS,
    windowMs: KEYWORD_RELATION_MUTATION_WINDOW_MS,
  } as const;
}

/**
 * List Keyword Relations as a bounded Growth Map association resource. The
 * repeated keywordId filter attaches one visible Keyword Library page in one
 * server query; it is not a standalone product module.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    assertOnlyListQuery(searchParams);
    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(
      searchParams,
      "cursor",
      Cursor,
    );
    const keywordIds = parseKeywordIds(searchParams);
    const result = await listProjectAuditKeywordRelations(
      { workspaceId: ctx.operator.workspaceId },
      id,
      {
        limit,
        cursor,
        ...(keywordIds === undefined ? {} : { keywordIds }),
      },
    );
    return ok(result, ctx.requestId);
  },
);

/**
 * Re-evaluate server-governed Keyword evidence. The command accepts no body or
 * query because relation identities, rule versions, clocks, and evidence are
 * exclusively server-owned.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    if (new URL(request.url).searchParams.size > 0) rejectQuery();
    if (await requestHasBodyBytes(request)) rejectBody();
    await assertWorkspaceAttemptRateLimit(
      ctx.operator.workspaceId,
      mutationPolicy(id),
    );
    const result = await refreshProjectAuditKeywordRelations(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
