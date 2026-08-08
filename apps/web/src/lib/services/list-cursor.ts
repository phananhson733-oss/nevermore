import {
  isNumericTimestampUuidCursorValid,
  isTimestampUuidCursorValid,
} from "@sf/db";
import { ProblemError } from "@sf/observability";

/**
 * Reject a malformed opaque timestamp+UUID keyset before any database access.
 * The response deliberately exposes only the public query pointer, never the
 * decoded (potentially customer-sensitive) cursor payload.
 */
/**
 * The live Keyword Library binds the value-ordered cursor language but keeps
 * accepting well-formed cursors in the retired intake-time language: the
 * repository answers those with an empty page so the pane can offer its
 * first-page reset, which keeps pre-deploy pagination and stale deep links on
 * the graceful path instead of a permanently failing validation error.
 */
export function assertValidKeywordLibraryLiveListCursor(
  cursor: string | null,
): void {
  if (
    cursor === null ||
    isNumericTimestampUuidCursorValid(cursor) ||
    isTimestampUuidCursorValid(cursor)
  ) {
    return;
  }

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

export function assertValidNumericTimestampUuidListCursor(
  cursor: string | null,
): void {
  if (cursor === null || isNumericTimestampUuidCursorValid(cursor)) return;

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
