import type { NextRequest } from "next/server";
import type { z } from "zod";
import { IdempotencyKey, Uuid } from "@sf/contracts";
import { ProblemError, type ProblemFieldError } from "@sf/observability";

/**
 * Request validation helpers. Zod issues become pointer-level 422 errors
 * (spec §11.1, AC-008); malformed JSON is 400; a bad path UUID is 404 (absent,
 * not leaked). Body schemas are `.strict()` so unknown keys are rejected.
 *
 * JSON request bodies are size-capped before parsing (AC-013, spec §14.2): an
 * oversized or decompression-bomb-style payload is rejected as 413
 * `IMPORT_TOO_LARGE` — the frozen registry's only "payload too large" code —
 * BEFORE any JSON parsing or schema validation runs.
 */

/**
 * Maximum accepted JSON request body, post-decompression (AC-013). Multipart CSV
 * uploads take the dedicated 20MB file path (spec §7.3/§7.5), not this helper, so
 * a 1 MiB cap is ample for every JSON body (the largest is a complete ICP profile).
 */
export const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

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
  // Body-size hardening (AC-013, spec §14.2): reject oversized / decompression-bomb
  // payloads BEFORE JSON parsing or schema validation. A declared Content-Length
  // over the cap is refused without buffering; the post-read check catches a small
  // compressed body that inflates past the cap once decoded.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) {
    throw new ProblemError(
      "IMPORT_TOO_LARGE",
      "Request body exceeds the size limit.",
    );
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ProblemError("BAD_REQUEST", "Request body must be valid JSON.");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new ProblemError(
      "IMPORT_TOO_LARGE",
      "Request body exceeds the size limit.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
    throw new ProblemError(
      "BAD_REQUEST",
      "A valid Idempotency-Key header is required.",
    );
  }
  return parsed.data;
}

/** Validate a path UUID; an invalid id is treated as not-found (no existence leak). */
export function parseUuidParam(value: string): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success)
    throw new ProblemError("NOT_FOUND", "Resource not found.");
  return parsed.data;
}
