import { NextResponse } from "next/server";
import {
  PROBLEM_CONTENT_TYPE,
  REQUEST_ID_HEADER,
  toProblemBody,
  type ProblemCode,
  type ProblemFieldError,
} from "@sf/observability";

/** Success envelope `{ data, meta? }` (spec §11.1). */
export interface Meta {
  readonly nextCursor?: string | null;
  readonly limit?: number;
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/** Build a success response carrying the `{ data, meta? }` envelope. */
export function ok<T>(
  data: T,
  requestId: string,
  init?: { status?: number; meta?: Meta; headers?: Record<string, string> },
): NextResponse {
  const body = init?.meta ? { data, meta: init.meta } : { data };
  const response = NextResponse.json(body, { status: init?.status ?? 200 });
  for (const [k, v] of Object.entries(init?.headers ?? {})) response.headers.set(k, v);
  return withRequestId(response, requestId);
}

/** Build an RFC 9457 problem+json response from a product error code. */
export function problem(
  code: ProblemCode,
  detail: string,
  requestId: string,
  init?: { errors?: readonly ProblemFieldError[]; headers?: Record<string, string> },
): NextResponse {
  const body = toProblemBody(code, detail, requestId, init?.errors);
  const response = NextResponse.json(body, {
    status: body.status,
    headers: { "content-type": PROBLEM_CONTENT_TYPE },
  });
  for (const [k, v] of Object.entries(init?.headers ?? {})) response.headers.set(k, v);
  return withRequestId(response, requestId);
}

/**
 * Catch-all for unexpected server errors. 500 is intentionally NOT in the
 * product code registry (§11.1); we emit a minimal problem body without leaking
 * internals (spec §15.2 detail/stack separation).
 */
export function internalError(requestId: string): NextResponse {
  const response = NextResponse.json(
    {
      type: "https://signalframe.app/problems/internal",
      title: "Internal Server Error",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "An unexpected error occurred.",
      requestId,
    },
    { status: 500, headers: { "content-type": PROBLEM_CONTENT_TYPE } },
  );
  return withRequestId(response, requestId);
}
