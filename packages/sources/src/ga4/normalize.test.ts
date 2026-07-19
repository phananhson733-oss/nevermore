import { describe, expect, it } from "vitest";
import type { Ga4LandingProjection } from "../observations.ts";
import type { NormalizedObservation } from "../adapter.ts";
import {
  GA4_KEY_EVENT_REPORT_TRUNCATED,
  GA4_LIMITATION,
  normalizeGa4,
  type Ga4KeyEventRow,
  type Ga4KeyEventStatus,
  type Ga4SessionRow,
} from "./normalize.ts";
import type { Ga4Window } from "./window.ts";

const WINDOW: Ga4Window = {
  timeZone: "UTC",
  startDate: "2026-05-22",
  endDate: "2026-07-16",
  current28d: { start: "2026-06-19", end: "2026-07-16" },
};
const ORIGIN = "https://example.com";
const CAPTURED_AT = "2026-07-17T00:00:00.000Z";

function projectionOf(observation: NormalizedObservation): Ga4LandingProjection {
  return observation.valueJson as Ga4LandingProjection;
}

function pageOf(observations: readonly NormalizedObservation[], subjectUrl: string): NormalizedObservation {
  const found = observations.find((o) => o.subjectRef === subjectUrl);
  if (!found) throw new Error(`no observation for ${subjectUrl}`);
  return found;
}

describe("normalizeGa4", () => {
  const available: Ga4KeyEventStatus = { state: "available" };

  it("merges daily rows per canonical page and recomputes the window engagement rate", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", sessions: 10, engagedSessions: 6, engagementRate: 0.6 },
      { date: "2026-07-02", landingPage: "/pricing", sessions: 20, engagedSessions: 14, engagementRate: 0.7 },
      { date: "2026-06-01", landingPage: "/pricing", sessions: 100, engagedSessions: 50, engagementRate: 0.5 }, // out of 28d window
      { date: "2026-07-01", landingPage: "/blog", sessions: 5, engagedSessions: 1, engagementRate: 0.2 },
    ];
    const keyEventRows: readonly Ga4KeyEventRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", eventName: "sign_up", keyEvents: 2 },
      { date: "2026-07-02", landingPage: "/pricing", eventName: "sign_up", keyEvents: 3 },
      { date: "2026-07-02", landingPage: "/pricing", eventName: "purchase", keyEvents: 1 },
    ];

    const observations = normalizeGa4(sessionRows, keyEventRows, ORIGIN, WINDOW, CAPTURED_AT, available);
    expect(observations).toHaveLength(2);

    const pricing = pageOf(observations, "https://example.com/pricing");
    const projection = projectionOf(pricing);
    expect(pricing.metricKey).toBe("ga4.landing.v1");
    expect(pricing.subjectType).toBe("url");
    expect(pricing.availability).toBe("available");
    expect(pricing.origin).toBe("first_party");
    expect(pricing.grade).toBe("A");
    expect(projection.sessions).toBe(30); // 10 + 20; out-of-window 100 excluded
    expect(projection.engagedSessions).toBe(20); // 6 + 14
    expect(projection.engagementRate).toBeCloseTo(20 / 30);
    expect(projection.keyEvents).toBe(6); // 2 + 3 + 1 across eventName rows
    expect(projection.keyEventUnavailableReason).toBeNull();
    expect(pricing.limitation).toBe(GA4_LIMITATION);
  });

  it("treats a compatible page with no key-event rows as a real observed 0", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "/no-conv", sessions: 8, engagedSessions: 4, engagementRate: 0.5 },
    ];
    const observations = normalizeGa4(sessionRows, [], ORIGIN, WINDOW, CAPTURED_AT, available);
    const projection = projectionOf(observations[0]!);
    expect(projection.keyEvents).toBe(0);
    expect(projection.keyEventUnavailableReason).toBeNull();
  });

  it("emits keyEvents null (never 0) with the unmapped reason, still saving sessions", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", sessions: 8, engagedSessions: 4, engagementRate: 0.5 },
    ];
    const observations = normalizeGa4(sessionRows, [], ORIGIN, WINDOW, CAPTURED_AT, { state: "unmapped" });
    const observation = observations[0]!;
    const projection = projectionOf(observation);
    expect(projection.sessions).toBe(8); // session rows still saved
    expect(projection.keyEvents).toBeNull();
    expect(projection.keyEvents).not.toBe(0);
    expect(projection.keyEventUnavailableReason).toBe("GA4_KEY_EVENT_UNMAPPED");
    expect(observation.limitation).toBe("GA4_KEY_EVENT_UNMAPPED");
  });

  it("emits keyEvents null with the incompatible reason", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", sessions: 8, engagedSessions: 4, engagementRate: 0.5 },
    ];
    // Key-event rows are ignored when the status is not available.
    const keyEventRows: readonly Ga4KeyEventRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", eventName: "sign_up", keyEvents: 9 },
    ];
    const observations = normalizeGa4(sessionRows, keyEventRows, ORIGIN, WINDOW, CAPTURED_AT, {
      state: "incompatible",
    });
    const projection = projectionOf(observations[0]!);
    expect(projection.keyEvents).toBeNull();
    expect(projection.keyEventUnavailableReason).toBe("GA4_KEY_EVENT_REPORT_INCOMPATIBLE");
    expect(observations[0]!.limitation).toBe("GA4_KEY_EVENT_REPORT_INCOMPATIBLE");
  });

  it("never treats absent rows from a truncated key-event report as real zeroes", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "/pricing", sessions: 8, engagedSessions: 4, engagementRate: 0.5 },
    ];
    const observations = normalizeGa4(
      sessionRows,
      [],
      ORIGIN,
      WINDOW,
      CAPTURED_AT,
      { state: "truncated" },
    );

    const projection = projectionOf(observations[0]!);
    expect(projection.keyEvents).toBeNull();
    expect(projection.keyEventUnavailableReason).toBe(GA4_KEY_EVENT_REPORT_TRUNCATED);
    expect(observations[0]!.limitation).toBe(GA4_KEY_EVENT_REPORT_TRUNCATED);
  });

  it("skips (not set) landing pages and canonicalizes paths (stripping utm)", () => {
    const sessionRows: readonly Ga4SessionRow[] = [
      { date: "2026-07-01", landingPage: "(not set)", sessions: 9, engagedSessions: 1, engagementRate: 0.1 },
      { date: "2026-07-03", landingPage: "/pricing?utm_source=x", sessions: 4, engagedSessions: 2, engagementRate: 0.5 },
    ];
    const observations = normalizeGa4(sessionRows, [], ORIGIN, WINDOW, CAPTURED_AT, available);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.subjectRef).toBe("https://example.com/pricing");
  });
});
