import { isTimestampUuidCursorValid } from "@sf/db";
import { ProblemError } from "@sf/observability";

/**
 * Reject a malformed opaque timestamp+UUID keyset before any database access.
 * The response deliberately exposes only the public query pointer, never the
 * decoded (potentially customer-sensitive) cursor payload.
 */
export function assertValidTimestampUuidListCursor(
  cursor: string | null,
): void {
  if (cursor === null || isTimestampUuidCursorValid(cursor)) return;

  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer: "/cursor",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ],
    },
  );
}
