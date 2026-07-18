/**
 * GA4 normalization (spec §7.4, §7.6). Pure transform from the two parsed daily
 * reports into per-landing-page `METRIC_GA4_LANDING` observations aggregated over
 * the current 28-day window. Rows are merged by `date + canonical landingPage`,
 * then rolled up per canonical page.
 *
 * Evidence honesty (spec §1.3, AC-017): key-event counts are `null` — never 0 —
 * whenever the source has no key events mapped (`GA4_KEY_EVENT_UNMAPPED`) or the
 * event/metric combination is incompatible on the property
 * (`GA4_KEY_EVENT_REPORT_INCOMPATIBLE`). A genuine observed 0 (mapped, compatible,
 * but no conversions in the window) stays 0. Session rows are ALWAYS saved even
 * when key events are unavailable.
 *
 * Contract note: `buildObservation` carries a value ONLY when the observation
 * availability is exactly `"available"` (it nulls the value otherwise). Because
 * sessions must survive even when key events are degraded, each emitted landing
 * observation is `"available"`, and the key-event degradation is expressed IN the
 * projection's dedicated `keyEvents: null` + `keyEventUnavailableReason` fields
 * (which exist for exactly this purpose) and in `limitation`. Snapshot-level
 * "partial" availability is set by the adapter's `collect`.
 */

import type { NormalizedObservation } from "../adapter.ts";
import type { Ga4LandingProjection } from "../observations.ts";
import { METRIC_GA4_LANDING, buildObservation } from "../observations.ts";
import { canonicalizeUrl } from "../canonical-url.ts";
import type { Ga4Window } from "./window.ts";

/** Stable, machine-readable reasons key events are unavailable (spec §7.4). */
export const GA4_KEY_EVENT_UNMAPPED = "GA4_KEY_EVENT_UNMAPPED";
export const GA4_KEY_EVENT_REPORT_INCOMPATIBLE = "GA4_KEY_EVENT_REPORT_INCOMPATIBLE";

export type Ga4KeyEventState = "available" | "unmapped" | "incompatible";

export interface Ga4KeyEventStatus {
  readonly state: Ga4KeyEventState;
}

/** One parsed SESSION report row (dimensions date + landingPage). */
export interface Ga4SessionRow {
  /** YYYY-MM-DD in the property timezone. */
  readonly date: string;
  /** GA4 `landingPage` dimension: a path (may include a query), e.g. `/pricing`. */
  readonly landingPage: string;
  readonly sessions: number;
  readonly engagedSessions: number | null;
  readonly engagementRate: number | null;
}

/** One parsed KEY-EVENT report row (dimensions date + landingPage + eventName). */
export interface Ga4KeyEventRow {
  readonly date: string;
  readonly landingPage: string;
  readonly eventName: string;
  readonly keyEvents: number;
}

/** The stable reason string for a non-available key-event state (null when available). */
export function keyEventReason(state: Ga4KeyEventState): string | null {
  switch (state) {
    case "available":
      return null;
    case "unmapped":
      return GA4_KEY_EVENT_UNMAPPED;
    case "incompatible":
      return GA4_KEY_EVENT_REPORT_INCOMPATIBLE;
  }
}

interface SessionAccumulator {
  sessions: number;
  engagedSessions: number;
  engagedUnavailable: boolean;
}

/** Resolve a GA4 landingPage PATH against the site origin → canonical subjectUrl. */
function toSubjectUrl(landingPage: string, siteOrigin: string): string | null {
  if (landingPage === "" || landingPage === "(not set)") return null;
  return canonicalizeUrl(landingPage, siteOrigin)?.subjectUrl ?? null;
}

/**
 * Merge the two GA4 reports into per-page `METRIC_GA4_LANDING` observations over
 * the current 28-day window. Inputs are treated as read-only; the local Maps and
 * accumulators are freshly created and never alias any input.
 */
export function normalizeGa4(
  sessionRows: readonly Ga4SessionRow[],
  keyEventRows: readonly Ga4KeyEventRow[],
  siteOrigin: string,
  window: Ga4Window,
  capturedAt: string,
  keyEventStatus: Ga4KeyEventStatus,
): NormalizedObservation[] {
  const { start, end } = window.current28d;
  const inWindow = (date: string): boolean => date >= start && date <= end;

  // Aggregate sessions per canonical page (current-28d slice only).
  const sessionsByPage = new Map<string, SessionAccumulator>();
  for (const row of sessionRows) {
    if (!inWindow(row.date)) continue;
    const subjectUrl = toSubjectUrl(row.landingPage, siteOrigin);
    if (subjectUrl === null) continue;
    const acc = sessionsByPage.get(subjectUrl) ?? {
      sessions: 0,
      engagedSessions: 0,
      engagedUnavailable: false,
    };
    acc.sessions += row.sessions;
    if (row.engagedSessions === null) acc.engagedUnavailable = true;
    else acc.engagedSessions += row.engagedSessions;
    sessionsByPage.set(subjectUrl, acc);
  }

  // Sum the selected key events per canonical page (server split them by eventName).
  const keyEventsByPage = new Map<string, number>();
  for (const row of keyEventRows) {
    if (!inWindow(row.date)) continue;
    const subjectUrl = toSubjectUrl(row.landingPage, siteOrigin);
    if (subjectUrl === null) continue;
    keyEventsByPage.set(subjectUrl, (keyEventsByPage.get(subjectUrl) ?? 0) + row.keyEvents);
  }

  const keyEventsAvailable = keyEventStatus.state === "available";
  const reason = keyEventReason(keyEventStatus.state);

  const observations: NormalizedObservation[] = [];
  for (const [subjectUrl, acc] of sessionsByPage) {
    const engagedSessions = acc.engagedUnavailable ? null : acc.engagedSessions;
    const engagementRate =
      engagedSessions !== null && acc.sessions > 0 ? engagedSessions / acc.sessions : null;
    // Available: a missing page means 0 selected conversions in the window (real 0).
    // Unavailable: null, never 0 (spec §1.3, AC-017).
    const keyEvents = keyEventsAvailable ? keyEventsByPage.get(subjectUrl) ?? 0 : null;

    const projection: Ga4LandingProjection = {
      sessions: acc.sessions,
      engagedSessions,
      engagementRate,
      keyEvents,
      keyEventUnavailableReason: keyEventsAvailable ? null : reason,
    };

    observations.push(
      buildObservation({
        provider: "ga4",
        metricKey: METRIC_GA4_LANDING,
        subjectType: "url",
        subjectRef: subjectUrl,
        observedAt: capturedAt,
        availability: "available",
        value: { json: projection },
        unit: null,
        limitation: keyEventsAvailable ? "" : reason ?? "",
      }),
    );
  }

  // Deterministic output order (stable observation keys).
  observations.sort((a, b) =>
    a.subjectRef < b.subjectRef ? -1 : a.subjectRef > b.subjectRef ? 1 : 0,
  );
  return observations;
}
