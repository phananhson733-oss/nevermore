import {
  BlobObjectAlreadyExistsError,
  SupabaseStorageError,
} from "@sf/sources";

const TRANSIENT_DATABASE_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "58000", // system_error
  "58030", // io_error
]);

const TRANSIENT_RUNTIME_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "EBUSY",
  "EHOSTUNREACH",
  "EIO",
  "EMFILE",
  "ENETDOWN",
  "ENETUNREACH",
  "ENFILE",
  "ENOSPC",
  "ETIMEDOUT",
]);

/** Classify only infrastructure failures that are safe to execute again. */
export function isTransientInfrastructureError(error: unknown): boolean {
  return isTransient(error, new Set<object>());
}

/** Stable, non-sensitive code for retry logs. */
export function transientFailureCode(
  error: unknown,
  fallback = "INFRASTRUCTURE_UNAVAILABLE",
): string {
  if (error instanceof SupabaseStorageError) {
    if (error.status === undefined) return "STORAGE_NETWORK";
    if (error.status === 408) return "STORAGE_TIMEOUT";
    if (error.status === 429) return "STORAGE_RATE_LIMITED";
    return "STORAGE_UNAVAILABLE";
  }
  if (error instanceof BlobObjectAlreadyExistsError) {
    return "STORAGE_COLLISION";
  }
  return readCode(error) ?? fallback;
}

function isTransient(error: unknown, seen: Set<object>): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) {
    return false;
  }
  seen.add(error);

  if (error instanceof SupabaseStorageError) {
    return (
      error.status === undefined ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  // Export keys carry a fresh nonce on every attempt, so an append-only key
  // collision is safe to retry and will produce a distinct destination.
  if (error instanceof BlobObjectAlreadyExistsError) return true;

  const code = readCode(error);
  if (
    code &&
    (code.startsWith("08") ||
      TRANSIENT_DATABASE_CODES.has(code) ||
      TRANSIENT_RUNTIME_CODES.has(code))
  ) {
    return true;
  }

  return "cause" in error
    ? isTransient((error as { cause?: unknown }).cause, seen)
    : false;
}

function readCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0
    ? code.toUpperCase()
    : null;
}
