import type { NextRequest } from "next/server";
import type { z } from "zod";
import { IdempotencyKey, Uuid } from "@sf/contracts";
import { ProblemError, type ProblemFieldError } from "@sf/observability";

/**
 * Request validation helpers. Zod issues become pointer-level 422 errors
 * (spec §11.1, AC-008); malformed JSON is 400; a bad path UUID is 404 (absent,
 * not leaked). Body schemas are `.strict()` so unknown keys are rejected.
 */

/** Map a Zod issue path to an RFC6901 JSON pointer, e.g. ["profile","personas",0] → "/profile/personas/0". */
function toPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return `/${path.map((seg) => String(seg).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function zodToFieldErrors(error: z.ZodError): ProblemFieldError[] {
  return error.issues.map((issue) => ({
    pointer: toPointer(issue.path),
    code: issue.code,
    message: issue.message,
  }));
}

/** Parse + validate a JSON request body against a schema, or throw a problem. */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ProblemError("BAD_REQUEST", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ProblemError("VALIDATION_ERROR", "Request failed validation.", {
      errors: zodToFieldErrors(result.error),
    });
  }
  return result.data;
}

/** Require and validate the `Idempotency-Key` header (1–128 printable ASCII). */
export function requireIdempotencyKey(request: NextRequest): string {
  const value = request.headers.get("idempotency-key");
  const parsed = IdempotencyKey.safeParse(value);
  if (!parsed.success) {
    throw new ProblemError("BAD_REQUEST", "A valid Idempotency-Key header is required.");
  }
  return parsed.data;
}

/** Validate a path UUID; an invalid id is treated as not-found (no existence leak). */
export function parseUuidParam(value: string): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success) throw new ProblemError("NOT_FOUND", "Resource not found.");
  return parsed.data;
}
