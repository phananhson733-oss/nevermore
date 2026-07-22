import { describe, expect, it } from "vitest";

import {
  canonicalUtcTimestamptz,
  isTimestamptzInstant,
  sameTimestamptzInstant,
} from "./instant.ts";

describe("strict PostgreSQL/ISO timestamptz boundaries", () => {
  it("canonicalizes an explicit PostgreSQL offset without losing microseconds", () => {
    expect(
      canonicalUtcTimestamptz("2026-07-22 17:04:27.563162+08"),
    ).toBe("2026-07-22T09:04:27.563162Z");
    expect(canonicalUtcTimestamptz("2026-07-22T09:04:27Z")).toBe(
      "2026-07-22T09:04:27.000Z",
    );
  });

  it("compares the exact instant instead of its database-session text", () => {
    expect(
      sameTimestamptzInstant(
        "2026-07-22 17:04:27.563162+08",
        "2026-07-22T09:04:27.563162Z",
      ),
    ).toBe(true);
    expect(
      sameTimestamptzInstant(
        "2026-07-22 17:04:27.563162+08",
        "2026-07-22T09:04:27.563163Z",
      ),
    ).toBe(false);
  });

  it.each([
    "2026-07-22T09:04:27Z",
    "2026-07-22 09:04:27+00",
    "2026-07-22T09:04:27+0000",
    "2026-07-22T09:04:27+00:00",
    "2026-07-22 17:04:27+08",
    "2026-07-22T03:34:27-05:30",
  ])("accepts a strict zoned instant: %s", (value) => {
    expect(isTimestamptzInstant(value)).toBe(true);
  });

  it.each([
    "2026-07-22T09:04:27",
    "2026-07-22",
    "2026-02-30T09:04:27Z",
    "2026-07-22T24:00:00Z",
    "2026-07-22T09:04:60Z",
    "2026-07-22T09:04:27+14:01",
    "2026-07-22T09:04:27+15",
    " 2026-07-22T09:04:27Z",
  ])("rejects a non-canonical or ambiguous timestamp: %s", (value) => {
    expect(isTimestamptzInstant(value)).toBe(false);
    expect(() => canonicalUtcTimestamptz(value)).toThrow(/timestamptz/i);
  });
});
