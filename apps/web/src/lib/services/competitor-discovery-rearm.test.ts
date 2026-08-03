import { describe, expect, it } from "vitest";

import {
  COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS,
  competitorDiscoveryFailureWindowStart,
  MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS,
  shouldRearmCompetitorDiscovery,
} from "./competitor-discovery-rearm.ts";

describe("shouldRearmCompetitorDiscovery", () => {
  it("arms the first attempt", () => {
    expect(
      shouldRearmCompetitorDiscovery({ count: 0, lastErrorCode: null }),
    ).toBe(true);
  });

  it("refuses to re-arm after a permanent provider failure", () => {
    // The production loop: DataForSEO answered INVALID_CONFIGURATION, the run
    // persisted no snapshot, and every following synthesis POST enqueued
    // another identical job — 34 of them for one project — until the workspace
    // rate limit answered 429.
    expect(
      shouldRearmCompetitorDiscovery({
        count: 1,
        lastErrorCode: "INVALID_CONFIGURATION",
      }),
    ).toBe(false);
  });

  it.each([
    "AUTH_REQUIRED",
    "PERMISSION_DENIED",
    "QUOTA_EXCEEDED",
    "FEATURE_DISABLED",
    "INVALID_RESPONSE",
  ])("refuses to re-arm after permanent code %s", (code) => {
    expect(
      shouldRearmCompetitorDiscovery({ count: 1, lastErrorCode: code }),
    ).toBe(false);
  });

  it.each(["RATE_LIMITED", "NETWORK_ERROR", "TIMEOUT", "UNAVAILABLE"])(
    "re-arms once more after transient code %s",
    (code) => {
      expect(
        shouldRearmCompetitorDiscovery({ count: 1, lastErrorCode: code }),
      ).toBe(true);
    },
  );

  it("stops even transient retries at the attempt cap", () => {
    expect(
      shouldRearmCompetitorDiscovery({
        count: MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS,
        lastErrorCode: "TIMEOUT",
      }),
    ).toBe(false);
    expect(
      shouldRearmCompetitorDiscovery({
        count: MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS + 5,
        lastErrorCode: "TIMEOUT",
      }),
    ).toBe(false);
  });

  it("treats an unrecognised or absent code as permanent", () => {
    // Fail closed: an unknown code is not evidence that retrying is safe.
    expect(
      shouldRearmCompetitorDiscovery({ count: 1, lastErrorCode: null }),
    ).toBe(false);
    expect(
      shouldRearmCompetitorDiscovery({ count: 1, lastErrorCode: "WAT" }),
    ).toBe(false);
  });

  it("caps automatic attempts well below the route's rate limit", () => {
    // The synthesis route allows 20 attempts per workspace per 15 minutes.
    // Automatic discovery must never be able to consume that budget on its own.
    expect(MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS).toBeLessThan(20);
  });
});

describe("competitorDiscoveryFailureWindowStart", () => {
  it("counts failures in a window rather than over all history", () => {
    // A cap without a window is permanent. The production project burned 34
    // attempts before the cause was fixed; counting all of them would have left
    // it unable to ever discover competitors again.
    const now = new Date("2026-08-03T12:00:00.000Z");
    expect(competitorDiscoveryFailureWindowStart(now).toISOString()).toBe(
      "2026-08-03T06:00:00.000Z",
    );
  });

  it("uses a window long enough to outlast a retry storm", () => {
    // The production loop fired 20 runs in 88 seconds, and the route's own
    // limiter resets after 15 minutes. The window must comfortably exceed both
    // so the storm cannot simply resume.
    expect(COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS).toBeGreaterThan(
      15 * 60 * 1000,
    );
  });

  it("uses a window short enough to self-heal without an operator", () => {
    expect(COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });
});
