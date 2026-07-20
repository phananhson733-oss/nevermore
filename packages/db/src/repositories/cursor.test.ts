import { describe, expect, it } from "vitest";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
  isTimestampUuidCursorValid,
} from "./cursor.ts";

const ID = "00000000-0000-4000-8000-000000000001";

describe("timestamp/UUID repository cursor", () => {
  it.each([
    "2026-07-19 12:34:56+08",
    "2026-07-19 12:34:56.123456+08:00",
    "2026-07-19T04:34:56.123Z",
    "2024-02-29T00:00:00Z",
  ])("round-trips a strict PostgreSQL/ISO timestamp: %s", (timestamp) => {
    expect(
      decodeTimestampUuidCursor(encodeTimestampUuidCursor(timestamp, ID)),
    ).toEqual({ timestamp, id: ID });
  });

  it.each([
    "2026-02-29T00:00:00Z",
    "2026-02-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+14:01",
    "2026-01-01T00:00:00+15",
    "not-a-timestamp",
  ])("rejects a timestamp PostgreSQL should never receive: %s", (timestamp) => {
    expect(
      decodeTimestampUuidCursor(encodeTimestampUuidCursor(timestamp, ID)),
    ).toBeNull();
  });

  it("rejects non-canonical base64url and a non-UUID tie-breaker", () => {
    expect(decodeTimestampUuidCursor("not+a+cursor")).toBeNull();
    expect(
      decodeTimestampUuidCursor(
        encodeTimestampUuidCursor("2026-07-19T00:00:00Z", "not-a-uuid"),
      ),
    ).toBeNull();
  });

  it("exposes the decoder's exact accepted language through the semantic guard", () => {
    const valid = encodeTimestampUuidCursor(
      "2026-07-19T00:00:00.000Z",
      ID,
    );
    const invalid = encodeTimestampUuidCursor(
      "2026-02-31T00:00:00.000Z",
      ID,
    );

    expect(isTimestampUuidCursorValid(valid)).toBe(true);
    expect(isTimestampUuidCursorValid(invalid)).toBe(false);
  });
});
