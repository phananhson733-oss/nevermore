import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, isConsentState } from "./cookie-consent-state";

describe("isConsentState", () => {
  it("accepts the current complete consent record", () => {
    expect(
      isConsentState({
        consent_version: CONSENT_VERSION,
        necessary: true,
        analytics: true,
        marketing: false,
        updated_at: "2026-08-05T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects stale, partial, or malformed records", () => {
    expect(
      isConsentState({
        consent_version: "0.9",
        necessary: true,
        analytics: true,
        marketing: false,
        updated_at: "2026-08-05T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(isConsentState({ analytics: true })).toBe(false);
    expect(isConsentState(null)).toBe(false);
  });
});
