export type DbProcessBoundary = "migrate" | "migrate-check" | "smoke";
export type DbProcessFailureType = "internal" | "unknown";

const DB_PROCESS_FAILURES = {
  migrate: {
    event: "db_migrate_failed",
    code: "DB_MIGRATE_FAILED",
  },
  "migrate-check": {
    event: "db_migrate_check_failed",
    code: "DB_MIGRATE_CHECK_FAILED",
  },
  smoke: {
    event: "db_smoke_failed",
    code: "DB_SMOKE_FAILED",
  },
} as const satisfies Record<
  DbProcessBoundary,
  Readonly<{ event: string; code: string }>
>;

function classifyFailure(error: unknown): DbProcessFailureType {
  try {
    return error instanceof Error ? "internal" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Serialize a database CLI's process-level failure without inspecting or
 * coercing the thrown value. In particular, PostgreSQL exception fields can
 * contain SQL or customer data and must never cross this logging boundary.
 */
export function serializeDbProcessFailure(
  boundary: DbProcessBoundary,
  error: unknown,
): string {
  return JSON.stringify({
    ...DB_PROCESS_FAILURES[boundary],
    type: classifyFailure(error),
  });
}
