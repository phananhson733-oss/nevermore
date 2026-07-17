/**
 * Small typed fetch wrapper for the same-origin `/api/mvp` surface. The session
 * cookie is sent automatically (`credentials: "same-origin"`). Success bodies
 * (`{ data, meta? }`) are returned as-is for the caller to unwrap; non-2xx
 * responses are parsed as problem+json and thrown as a typed `ApiError`.
 */

import type { ProblemBody, ProblemFieldError } from "./types";

const API_BASE = "/api/mvp";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SendOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

/**
 * A failed API call. Carries the parsed problem+json body so callers can branch
 * on `code`/`status` and map field-level `errors` onto form inputs.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly problem: ProblemBody;

  constructor(problem: ProblemBody) {
    super(problem.detail || problem.title);
    this.name = "ApiError";
    this.code = problem.code;
    this.status = problem.status;
    this.problem = problem;
  }

  /** Field-level validation errors, for mapping onto form fields (AC-008). */
  fieldErrors(): readonly ProblemFieldError[] {
    return this.problem.errors ?? [];
  }
}

/** Structural guard: an untrusted response body is only a problem if it fits. */
function isProblemBody(value: unknown): value is ProblemBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "number" &&
    typeof v.code === "string" &&
    typeof v.detail === "string"
  );
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Coerce any non-2xx response into a ProblemBody, synthesising one if needed. */
function toProblem(response: Response, body: unknown): ProblemBody {
  if (isProblemBody(body)) return body;
  return {
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: response.status,
    code: "UNKNOWN",
    detail: `Request failed with status ${response.status}.`,
    requestId: response.headers.get("X-Request-Id") ?? "",
  };
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options?: SendOptions,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options?.body !== undefined) headers["Content-Type"] = "application/json";
  if (options?.idempotencyKey)
    headers["Idempotency-Key"] = options.idempotencyKey;

  const init: RequestInit = { method, credentials: "same-origin", headers };
  if (options?.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${API_BASE}${path}`, init);
  const parsed = await parseJson(response);

  if (!response.ok) throw new ApiError(toProblem(response, parsed));
  return parsed as T;
}

/** GET `${/api/mvp}${path}`; returns the parsed success body (caller unwraps `.data`). */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

/** Send a mutating request; returns the parsed success body (caller unwraps `.data`). */
export function apiSend<T>(
  method: HttpMethod,
  path: string,
  options?: SendOptions,
): Promise<T> {
  return request<T>(method, path, options);
}
