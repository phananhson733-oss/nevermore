import { describe, expect, it } from "vitest";

import {
  COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS,
  competitorDiscoveryFailureHistory,
  competitorDiscoveryPayloadFingerprint,
  competitorDiscoveryFailureWindowStart,
  competitorDiscoveryScopeFingerprint,
  MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS,
  shouldRearmCompetitorDiscovery,
} from "./competitor-discovery-rearm.ts";

/** The scope shape as it reaches the gate, reduced to the fields it reads. */
function scope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    target: "relayops.com",
    marketCode: "US",
    providerLanguageCode: "en",
    location: { kind: "code", code: 2840 },
    ...overrides,
  };
}

function failure(
  collectionScope: unknown,
  lastErrorCode: string | null = "INVALID_CONFIGURATION",
) {
  return { lastErrorCode, requestPayload: { collectionScope } };
}

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

describe("competitorDiscoveryScopeFingerprint", () => {
  it("separates requests the provider judges differently", () => {
    // These three differences are exactly what DataForSEO Labs answers 40501
    // for. Each must read as a different request.
    const base = competitorDiscoveryScopeFingerprint(scope());
    expect(base).not.toBeNull();
    expect(
      competitorDiscoveryScopeFingerprint(scope({ providerLanguageCode: "zh" })),
    ).not.toBe(base);
    expect(
      competitorDiscoveryScopeFingerprint(
        scope({ location: { kind: "name", name: "United States" } }),
      ),
    ).not.toBe(base);
    expect(
      competitorDiscoveryScopeFingerprint(scope({ target: "other.com" })),
    ).not.toBe(base);
  });

  it("ignores fields that do not change whether the provider accepts", () => {
    // Seeds carry the profile version and change on every regeneration. Folding
    // them in would make every attempt look new and disable the cap entirely,
    // which is the failure mode the gate exists to prevent.
    expect(
      competitorDiscoveryScopeFingerprint(
        scope({
          serpCompetitors: { limit: 100, seeds: [{ keyword: "a" }] },
          rankedKeywords: { limit: 200 },
          schemaVersion: "dataforseo.search-landscape-scope.v2",
        }),
      ),
    ).toBe(competitorDiscoveryScopeFingerprint(scope()));
  });

  it.each([null, undefined, 42, "scope", [], {}, scope({ location: {} })])(
    "returns null for the unrecognised shape %s",
    (value) => {
      expect(competitorDiscoveryScopeFingerprint(value)).toBeNull();
    },
  );

  it("reads the same fingerprint out of a stored request payload", () => {
    expect(
      competitorDiscoveryPayloadFingerprint({
        provider: "dataforseo",
        operation: "search_landscape",
        collectionScope: scope(),
      }),
    ).toBe(competitorDiscoveryScopeFingerprint(scope()));
    expect(competitorDiscoveryPayloadFingerprint({})).toBeNull();
  });
});

describe("competitorDiscoveryFailureHistory", () => {
  it("does not hold a repaired request answerable for the defect it replaced", () => {
    // Production, 2026-08-03: 13 refusals sent as zh/United-States-by-name.
    // The fix switched the search language to the market's own and addressed
    // the location by code. Counting the old refusals against the new request
    // would have grounded a project whose fault was already gone.
    const before = Array.from({ length: 13 }, () =>
      failure(
        scope({
          providerLanguageCode: "zh",
          location: { kind: "name", name: "United States" },
        }),
      ),
    );
    expect(competitorDiscoveryFailureHistory(before, scope())).toEqual({
      count: 0,
      lastErrorCode: null,
    });
    expect(
      shouldRearmCompetitorDiscovery(
        competitorDiscoveryFailureHistory(before, scope()),
      ),
    ).toBe(true);
  });

  it("still caps a request that keeps reproducing itself", () => {
    // The storm protection has to survive the change above: an identical
    // request that failed is a repetition, not a repair.
    const same = [failure(scope()), failure(scope())];
    expect(competitorDiscoveryFailureHistory(same, scope())).toEqual({
      count: 2,
      lastErrorCode: "INVALID_CONFIGURATION",
    });
    expect(
      shouldRearmCompetitorDiscovery(
        competitorDiscoveryFailureHistory(same, scope()),
      ),
    ).toBe(false);
  });

  it("counts a failure whose stored payload cannot be fingerprinted", () => {
    // Fail closed. An unreadable payload is not evidence of a difference, and
    // reading it as one would reopen the enqueue loop for older rows.
    const history = competitorDiscoveryFailureHistory(
      [failure(null), failure(undefined)],
      scope(),
    );
    expect(history.count).toBe(2);
  });

  it("counts every failure when the pending scope cannot be fingerprinted", () => {
    const history = competitorDiscoveryFailureHistory(
      [failure(scope({ providerLanguageCode: "zh" }))],
      { target: "relayops.com" },
    );
    expect(history.count).toBe(1);
  });

  it("takes the error code from the newest comparable failure", () => {
    // Rows arrive newest first; the code that decides transience must come from
    // the matching request, not from whichever row happens to be first.
    const history = competitorDiscoveryFailureHistory(
      [
        failure(scope({ providerLanguageCode: "zh" }), "AUTH_REQUIRED"),
        failure(scope(), "TIMEOUT"),
      ],
      scope(),
    );
    expect(history).toEqual({ count: 1, lastErrorCode: "TIMEOUT" });
    expect(shouldRearmCompetitorDiscovery(history)).toBe(true);
  });
});
