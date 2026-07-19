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

/**
 * Space reserved for the multipart boundary, part headers, and the small
 * `templateId` field around a 20 MiB CSV file. The actual `File.size` is checked
 * separately by the import route; this allowance only prevents rejecting a
 * legal file because of its multipart envelope.
 */
export const MAX_MULTIPART_BODY_OVERHEAD_BYTES = 64 * 1024;

const BODY_REQUIRED = "A request body is required.";
const BODY_INVALID = "The request body could not be read.";
const BODY_TOO_LARGE = "Request body exceeds the size limit.";

/** HTTP media types are case-insensitive; parameters follow the base type. */
export function isMultipartFormDataContentType(contentType: string): boolean {
  return /^multipart\/form-data(?:\s*;|$)/i.test(contentType);
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Rejection status must not depend on whether an already-failing transport
    // also rejects cancellation.
  }
}

function declaredBodyBytes(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Read the decoded Fetch request stream with a hard byte ceiling. The stream is
 * cancelled as soon as a chunk would cross the limit, so callers never buffer
 * an unbounded body and cannot bypass the cap with a false Content-Length.
 */
async function readBodyWithinLimit(
  request: NextRequest,
  maxBodyBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new RangeError("maxBodyBytes must be a positive safe integer");
  }

  const declared = declaredBodyBytes(request.headers);
  if (declared !== null && declared > maxBodyBytes) {
    cancelBody(request.body);
    throw new ProblemError("IMPORT_TOO_LARGE", BODY_TOO_LARGE);
  }

  const body = request.body;
  if (!body) {
    throw new ProblemError("BAD_REQUEST", BODY_REQUIRED);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw new ProblemError("BAD_REQUEST", BODY_INVALID);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        // Treat every transport rejection as untrusted input, even if its
        // rejection value happens to be a ProblemError with another code.
        throw new ProblemError("BAD_REQUEST", BODY_INVALID);
      }
      const { done, value } = result;
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ProblemError("BAD_REQUEST", BODY_INVALID);
      }
      if (value.byteLength > maxBodyBytes - totalBytes) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Keep the stable 413 even if transport cancellation itself fails.
        }
        throw new ProblemError("IMPORT_TOO_LARGE", BODY_TOO_LARGE);
      }
      if (value.byteLength > 0) {
        chunks.push(value);
        totalBytes += value.byteLength;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Do not let transport cleanup replace the stable request problem.
    }
  }

  if (totalBytes === 0) {
    throw new ProblemError("BAD_REQUEST", BODY_REQUIRED);
  }

  const bytes = new Uint8Array(new ArrayBuffer(totalBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Parse multipart form data from a byte-limited copy of the decoded request
 * stream. `request.formData()` is deliberately not used: it would parse and
 * buffer the untrusted stream before application code could enforce a limit.
 */
export async function parseMultipartFormDataWithinLimit(
  request: NextRequest,
  maxBodyBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isMultipartFormDataContentType(contentType)) {
    throw new ProblemError("BAD_REQUEST", "Content-Type must be multipart/form-data.");
  }

  const bytes = await readBodyWithinLimit(request, maxBodyBytes);
  try {
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
    });
    return await boundedRequest.formData();
  } catch {
    throw new ProblemError("BAD_REQUEST", "Request body must be valid multipart form data.");
  }
}

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
  // Fetch exposes the decoded body stream. Count those bytes incrementally so a
  // chunked or compressed payload cannot force request.text() to buffer past the
  // cap before validation gets a chance to run.
  const bytes = await readBodyWithinLimit(request, MAX_JSON_BODY_BYTES);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProblemError("BAD_REQUEST", "Request body must be valid JSON.");
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
