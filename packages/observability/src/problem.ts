/**
 * RFC 9457 application/problem+json errors with the frozen SignalFrame code
 * registry (spec §11.1). Product error codes map to a single HTTP status; the
 * mapping is the single source of truth shared by every route handler.
 */

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export type ProblemCode =
  // 400
  | "BAD_REQUEST"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_STATE_EXPIRED"
  // 401
  | "AUTH_REQUIRED"
  // 404
  | "NOT_FOUND"
  // 409
  | "VERSION_CONFLICT"
  | "STALE_REVISION"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RUN_ALREADY_ACTIVE"
  | "FINDING_ACTION_ACTIVE"
  | "OAUTH_STATE_REPLAYED"
  | "IMPORT_TOKEN_REPLAYED"
  // 413
  | "IMPORT_TOO_LARGE"
  // 422
  | "VALIDATION_ERROR"
  | "CONTEXT_INCOMPLETE"
  | "CRAWL_SNAPSHOT_REQUIRED"
  | "SNAPSHOT_PROJECT_MISMATCH"
  | "INVALID_COLLECTION_OPERATION"
  | "OAUTH_PROPERTY_INVALID"
  | "IMPORT_TOKEN_INVALID"
  | "IMPORT_TOKEN_EXPIRED"
  | "SOURCE_NOT_CONNECTED"
  | "ACTION_NOT_EXECUTABLE"
  | "ARTIFACT_VALIDATION_FAILED"
  | "PROJECT_ARCHIVED"
  // 429
  | "RATE_LIMITED"
  // 503
  | "DEPENDENCY_UNAVAILABLE"
  | "FEATURE_DISABLED";

export const PROBLEM_STATUS: Record<ProblemCode, number> = {
  BAD_REQUEST: 400,
  OAUTH_STATE_INVALID: 400,
  OAUTH_STATE_EXPIRED: 400,
  AUTH_REQUIRED: 401,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  STALE_REVISION: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  RUN_ALREADY_ACTIVE: 409,
  FINDING_ACTION_ACTIVE: 409,
  OAUTH_STATE_REPLAYED: 409,
  IMPORT_TOKEN_REPLAYED: 409,
  IMPORT_TOO_LARGE: 413,
  VALIDATION_ERROR: 422,
  CONTEXT_INCOMPLETE: 422,
  CRAWL_SNAPSHOT_REQUIRED: 422,
  SNAPSHOT_PROJECT_MISMATCH: 422,
  INVALID_COLLECTION_OPERATION: 422,
  OAUTH_PROPERTY_INVALID: 422,
  IMPORT_TOKEN_INVALID: 422,
  IMPORT_TOKEN_EXPIRED: 422,
  SOURCE_NOT_CONNECTED: 422,
  ACTION_NOT_EXECUTABLE: 422,
  ARTIFACT_VALIDATION_FAILED: 422,
  PROJECT_ARCHIVED: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  FEATURE_DISABLED: 503,
};

/** A single field-level validation error, JSON-pointer addressed (spec AC-008). */
export interface ProblemFieldError {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
}

/** The problem+json response body shape (spec §11.1). */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly requestId: string;
  readonly errors?: readonly ProblemFieldError[];
}

const TITLES: Partial<Record<ProblemCode, string>> = {
  BAD_REQUEST: "Bad request",
  AUTH_REQUIRED: "Authentication required",
  NOT_FOUND: "Not found",
  VALIDATION_ERROR: "Validation failed",
  VERSION_CONFLICT: "Version conflict",
  STALE_REVISION: "Stale revision",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key reused",
  RUN_ALREADY_ACTIVE: "Run already active",
  RATE_LIMITED: "Rate limited",
  FEATURE_DISABLED: "Feature disabled",
  DEPENDENCY_UNAVAILABLE: "Dependency unavailable",
};

const titleFor = (code: ProblemCode): string =>
  TITLES[code] ??
  code
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

/** A thrown error that carries a product problem code; caught by the API wrapper. */
export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly fieldErrors: readonly ProblemFieldError[] | undefined;
  readonly extraHeaders: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ProblemCode,
    detail: string,
    options?: { errors?: readonly ProblemFieldError[]; headers?: Record<string, string> },
  ) {
    super(detail);
    this.name = "ProblemError";
    this.code = code;
    this.status = PROBLEM_STATUS[code];
    this.fieldErrors = options?.errors;
    this.extraHeaders = options?.headers;
  }
}

/** Build a problem+json body from a code, detail, and the active request id. */
export function toProblemBody(
  code: ProblemCode,
  detail: string,
  requestId: string,
  errors?: readonly ProblemFieldError[],
): ProblemBody {
  const status = PROBLEM_STATUS[code];
  return {
    type: `https://signalframe.app/problems/${code.toLowerCase()}`,
    title: titleFor(code),
    status,
    code,
    detail,
    requestId,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}
