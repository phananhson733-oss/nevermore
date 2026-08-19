// @input  -- a completed run's confirmed context, frozen query set and contract-valid report
// @output -- same-tab restoration of that one report, or nothing at all
// @pos    -- the narrowest thing that stops a language switch from re-billing a run

import {
  isGeoContextSnapshotV1,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";
import { isGeoQuerySetV1, type GeoQuerySetV1 } from "./geo-query-contract.ts";
import {
  isGeoReportSuccessEnvelope,
  type GeoReportDataV3,
} from "./geo-report-contract.ts";
import { isGeoRunSelfConsistent } from "./geo-run-identity.ts";

export const GEO_REPORT_SESSION_SCHEMA_VERSION =
  "geo_report_session.v1" as const;

/** Where it lives. `sessionStorage`, so it dies with the tab. */
export const GEO_REPORT_SESSION_KEY = "geo_report_session.v1";

/**
 * How long a restored report is still the report the visitor was looking at.
 *
 * Fifteen minutes. Long enough to switch language, follow a citation and come
 * back; short enough that a tab reopened after lunch shows the form rather than
 * yesterday's numbers presented as current. It is not a cache and not history:
 * nothing here survives closing the tab.
 */
export const GEO_REPORT_SESSION_TTL_MS = 15 * 60 * 1_000;

export interface GeoReportSessionStateV1 {
  readonly schemaVersion: typeof GEO_REPORT_SESSION_SCHEMA_VERSION;
  readonly savedAt: string;
  readonly context: GeoContextSnapshotV1;
  readonly querySet: GeoQuerySetV1;
  readonly report: GeoReportDataV3;
}

/**
 * The storage this module reads and writes.
 *
 * Passed in rather than reached for, so the tests exercise the same code the
 * browser runs instead of a mock of it, and so a server render cannot touch a
 * global that does not exist there.
 */
export type GeoSessionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/**
 * Whether these three objects describe the same run.
 *
 * Delegated rather than restated. The first version compared the declared hash
 * strings and nothing else, so a stored payload whose questions had been edited
 * while its digest was left alone restored cleanly and then produced a brief
 * whose call count disagreed with the report beside it. One rule, shared with
 * the brief builder, is what stops the two from drifting apart again.
 */
function isOneRun(state: GeoReportSessionStateV1): boolean {
  return isGeoRunSelfConsistent(state.context, state.querySet, state.report);
}

/**
 * Store a finished report so a same-tab navigation can put it back.
 *
 * Deliberately narrow. No auth state, no provider credentials, no account or
 * session identifier, no credits, no assistant answer beyond what the report
 * already carries, and nothing that outlives the tab. Refuses to write anything
 * that would not survive its own restore check, so a value that cannot be read
 * back is never written in the first place.
 */
export function saveGeoReportSession(
  storage: GeoSessionStorage,
  state: Omit<GeoReportSessionStateV1, "schemaVersion" | "savedAt">,
  now: Date,
): boolean {
  const candidate: GeoReportSessionStateV1 = {
    schemaVersion: GEO_REPORT_SESSION_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    ...state,
  };
  if (!isOneRun(candidate)) return false;
  try {
    storage.setItem(GEO_REPORT_SESSION_KEY, JSON.stringify(candidate));
    return true;
  } catch {
    // Private mode, a full quota, a disabled store. Losing restoration is a
    // worse experience; losing the report is not, because it is still on screen.
    return false;
  }
}

/**
 * Read back a report, or delete whatever was there.
 *
 * Every failure path removes the entry. A value that cannot be validated is not
 * a value to keep trying: leaving it would mean re-parsing the same broken
 * payload on every navigation, and the one thing worse than losing restoration
 * is restoring something that is not what the visitor paid for.
 *
 * Validated with the same guards the run itself passed — the report goes back
 * through `isGeoReportSuccessEnvelope`, which is the guard the server's own
 * payload had to satisfy.
 */
export function restoreGeoReportSession(
  storage: GeoSessionStorage,
  now: Date,
): GeoReportSessionStateV1 | null {
  const drop = (): null => {
    try {
      storage.removeItem(GEO_REPORT_SESSION_KEY);
    } catch {
      // Nothing to do about a store that will not take a delete either.
    }
    return null;
  };

  let raw: string | null;
  try {
    raw = storage.getItem(GEO_REPORT_SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return drop();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return drop();
  }

  const value = parsed as Record<string, unknown>;
  if (value["schemaVersion"] !== GEO_REPORT_SESSION_SCHEMA_VERSION) {
    return drop();
  }
  const savedAt = value["savedAt"];
  if (typeof savedAt !== "string") return drop();
  const saved = Date.parse(savedAt);
  if (!Number.isFinite(saved)) return drop();
  const age = now.getTime() - saved;
  // A future timestamp is as broken as an expired one: a clock that moved
  // backwards would otherwise pin a report open indefinitely.
  if (age < 0 || age > GEO_REPORT_SESSION_TTL_MS) return drop();

  const context: unknown = value["context"];
  const querySet: unknown = value["querySet"];
  // Wrapped and checked as an envelope so the narrowing carries the report
  // through without a cast: a cast here would be the one place a payload that
  // failed the guard could still reach the page.
  const envelope: unknown = { data: value["report"] };
  if (!isGeoContextSnapshotV1(context)) return drop();
  if (!isGeoQuerySetV1(querySet)) return drop();
  if (!isGeoReportSuccessEnvelope(envelope)) return drop();

  const state: GeoReportSessionStateV1 = {
    schemaVersion: GEO_REPORT_SESSION_SCHEMA_VERSION,
    savedAt,
    context,
    querySet,
    report: envelope.data,
  };
  if (!isOneRun(state)) return drop();
  return state;
}

/** A store that holds nothing, for a render with no tab behind it. */
const NO_STORAGE: GeoSessionStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

/**
 * This tab's store, or one that holds nothing.
 *
 * Reaching for `sessionStorage` is guarded rather than assumed: the component
 * renders on the server, and some browser configurations throw on the property
 * access itself rather than on the call. Falling back to a store that holds
 * nothing means every caller can treat storage as always present.
 */
export function geoSessionStorage(): GeoSessionStorage {
  try {
    return globalThis.sessionStorage ?? NO_STORAGE;
  } catch {
    return NO_STORAGE;
  }
}

/** Forget the stored report. Called on start-over and on an explicit restart. */
export function clearGeoReportSession(storage: GeoSessionStorage): void {
  try {
    storage.removeItem(GEO_REPORT_SESSION_KEY);
  } catch {
    // A store that refuses a delete is a store nothing was written to.
  }
}
