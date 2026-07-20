const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/;

export interface TimestampUuidKeyset {
  readonly timestamp: string;
  readonly id: string;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isStrictTimestamp(value: string): boolean {
  const match = TIMESTAMP.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > (daysInMonth[month - 1] ?? 0)) return false;

  if (match[7]) {
    const offsetHour = Number(match[8]);
    const offsetMinute = Number(match[9] ?? "0");
    // ISO-8601's largest real-world offset is ±14:00.
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return false;
    }
  }
  return true;
}

/** Encode the two columns used by the repository keyset indexes. */
export function encodeTimestampUuidCursor(
  timestamp: string,
  id: string,
  separator = " ",
): string {
  return Buffer.from(`${timestamp}${separator}${id}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Decode and validate an opaque timestamp+UUID cursor before either value is
 * bound to SQL. Node's base64 decoder is permissive, so canonical spelling is
 * checked explicitly. The timestamp is kept byte-for-byte for PostgreSQL while
 * calendar fields are validated without Date.parse's invalid-date rollover.
 */
export function decodeTimestampUuidCursor(
  cursor: string,
  separator = " ",
): TimestampUuidKeyset | null {
  if (!cursor || !CANONICAL_BASE64URL.test(cursor)) return null;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) return null;
    const raw = bytes.toString("utf8");
    const idx = raw.lastIndexOf(separator);
    if (idx <= 0) return null;
    const timestamp = raw.slice(0, idx);
    const id = raw.slice(idx + separator.length);
    if (!UUID.test(id) || !isStrictTimestamp(timestamp)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

/**
 * Public semantic guard for timestamp+UUID list cursors. Services use this
 * before opening a database handle; repositories still decode the same tuple
 * for SQL binding, so the accepted language cannot drift between layers.
 */
export function isTimestampUuidCursorValid(
  cursor: string,
  separator = " ",
): boolean {
  return decodeTimestampUuidCursor(cursor, separator) !== null;
}
