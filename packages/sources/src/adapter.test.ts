import { describe, expect, it } from "vitest";
import { isTransient, SOURCE_ERROR_CODES } from "./adapter.ts";

describe("source retry classification (spec section 13.1, AC-046)", () => {
  it.each(["RATE_LIMITED", "NETWORK_ERROR", "TIMEOUT", "UNAVAILABLE"] as const)(
    "retries transient provider error %s",
    (code) => {
      expect(isTransient(code)).toBe(true);
    },
  );

  it("does not retry permission, validation, quota, or disabled failures", () => {
    const permanent = SOURCE_ERROR_CODES.filter(
      (code) => ![
        "RATE_LIMITED",
        "NETWORK_ERROR",
        "TIMEOUT",
        "UNAVAILABLE",
      ].includes(code),
    );
    expect(permanent.every((code) => !isTransient(code))).toBe(true);
  });
});
