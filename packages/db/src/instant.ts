const ZONED_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/u;

interface ParsedTimestamptz {
  readonly epochMicros: bigint;
  readonly utcWholeSecondMs: number;
  readonly fractionMicros: number;
}

function parseTimestamptz(value: string): ParsedTimestamptz | null {
  const match = ZONED_TIMESTAMP.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionMicros = Number((match[7] ?? "").padEnd(6, "0"));
  const offsetSign = match[8] === "-" ? -1 : 1;
  const offsetHour = Number(match[9] ?? "0");
  const offsetMinute = Number(match[10] ?? "0");
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  // Construct the wall-clock second without Date.parse. setUTCFullYear avoids
  // Date.UTC's special treatment of years 0-99.
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, 0);
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second
  ) {
    return null;
  }

  const offsetMinutes = offsetSign * (offsetHour * 60 + offsetMinute);
  const utcWholeSecondMs = wallClock.getTime() - offsetMinutes * 60_000;
  const utc = new Date(utcWholeSecondMs);
  if (
    !Number.isFinite(utcWholeSecondMs) ||
    utc.getUTCFullYear() < 1 ||
    utc.getUTCFullYear() > 9999
  ) {
    return null;
  }
  return {
    epochMicros:
      BigInt(utcWholeSecondMs) * 1_000n + BigInt(fractionMicros),
    utcWholeSecondMs,
    fractionMicros,
  };
}

/** Strict PostgreSQL/ISO zoned timestamp syntax, including explicit offsets. */
export function isTimestamptzInstant(value: string): boolean {
  return parseTimestamptz(value) !== null;
}

/**
 * Canonical UTC representation at PostgreSQL's microsecond precision. The
 * parser deliberately does not inherit Date.parse's host-dependent grammar.
 */
export function canonicalUtcTimestamptz(value: string): string {
  const parsed = parseTimestamptz(value);
  if (!parsed) throw new RangeError("value must be a strict zoned timestamptz instant");
  const wholeSecond = new Date(parsed.utcWholeSecondMs)
    .toISOString()
    .slice(0, 19);
  const fraction = parsed.fractionMicros
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "")
    .padEnd(3, "0");
  return `${wholeSecond}.${fraction}Z`;
}

/** Compare exact absolute instants while preserving microsecond differences. */
export function sameTimestamptzInstant(
  left: string,
  right: string,
): boolean {
  const parsedLeft = parseTimestamptz(left);
  const parsedRight = parseTimestamptz(right);
  return (
    parsedLeft !== null &&
    parsedRight !== null &&
    parsedLeft.epochMicros === parsedRight.epochMicros
  );
}
