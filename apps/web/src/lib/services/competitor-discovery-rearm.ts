import {
  isTransient,
  SOURCE_ERROR_CODES,
  type SourceErrorCode,
} from "@sf/sources";

/**
 * How many automatic competitor-discovery attempts one project may consume.
 *
 * Discovery is best-effort evidence, not a gate. The synthesis route allows 20
 * attempts per workspace per 15 minutes, so automatic re-arming must stay far
 * below that: a provider that is permanently misconfigured for this market must
 * not be able to spend the operator's whole budget before they can regenerate.
 */
export const MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS = 2;

/**
 * How far back failures are counted.
 *
 * The cap alone would be permanent: a project that burned its attempts could
 * never discover competitors again. A window stops the storm within minutes —
 * the production loop fired 20 times in 88 seconds — while still letting a
 * later attempt through.
 *
 * The window is the backstop, not the primary escape. What actually releases a
 * fixed project is the request fingerprint below: a repair changes the request,
 * and a changed request is a first attempt rather than a repetition.
 */
export const COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Start of the window failures are counted in, from a caller-supplied clock. */
export function competitorDiscoveryFailureWindowStart(now: Date): Date {
  return new Date(now.getTime() - COMPETITOR_DISCOVERY_FAILURE_WINDOW_MS);
}

/** Terminal-failure history for one (project, active_key) pair. */
export interface CompetitorDiscoveryFailureHistory {
  readonly count: number;
  readonly lastErrorCode: string | null;
}

/** One terminal discovery run, as stored. Newest first when listed. */
export interface CompetitorDiscoveryTerminalFailure {
  readonly lastErrorCode: string | null;
  readonly requestPayload: unknown;
}

function isKnownSourceErrorCode(value: string): value is SourceErrorCode {
  return (SOURCE_ERROR_CODES as readonly string[]).includes(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function locationFingerprint(value: unknown): string | null {
  const location = readRecord(value);
  if (!location) return null;
  if (location["kind"] === "code" && typeof location["code"] === "number") {
    return `code:${location["code"]}`;
  }
  if (location["kind"] === "name" && typeof location["name"] === "string") {
    return `name:${location["name"]}`;
  }
  return null;
}

/**
 * The part of a collection scope that decides whether the provider accepts the
 * request at all.
 *
 * Deliberately excludes seeds, limits and schema version. Seeds carry the
 * profile version and change on every regeneration, so folding them in would
 * make every attempt look new and disable the cap the storm proved necessary.
 * What DataForSEO Labs actually rejects is the target/location/language triple
 * — status 40501 for a language the location does not serve — so that triple,
 * and only it, distinguishes a repair from a repetition.
 *
 * Returns null when the shape is unrecognised. Callers must treat null as "not
 * comparable" and count the failure, never as "different, so retry".
 */
export function competitorDiscoveryScopeFingerprint(
  scope: unknown,
): string | null {
  const record = readRecord(scope);
  if (!record) return null;
  const target = record["target"];
  const marketCode = record["marketCode"];
  const languageCode = record["providerLanguageCode"];
  const location = locationFingerprint(record["location"]);
  if (
    typeof target !== "string" ||
    typeof marketCode !== "string" ||
    typeof languageCode !== "string" ||
    location === null
  ) {
    return null;
  }
  return [target, marketCode, location, languageCode].join("|");
}

/** Same fingerprint, read out of a stored `async_runs.request_payload`. */
export function competitorDiscoveryPayloadFingerprint(
  payload: unknown,
): string | null {
  const record = readRecord(payload);
  if (!record) return null;
  return competitorDiscoveryScopeFingerprint(record["collectionScope"]);
}

/**
 * Failure history for the request that is about to be enqueued.
 *
 * Only failures of the *same* request count. A permanently misconfigured market
 * still gets capped after the first refusal, because retrying it reproduces the
 * identical request. But once the configuration is repaired the fingerprint
 * changes, and the repaired request is judged on its own record instead of
 * inheriting a verdict earned by the defect that was just fixed.
 *
 * This is what production needed: a project accumulated 13 refusals under
 * `providerLanguageCode: "zh"`, and after the fix shipped, the very first
 * attempt under `"en"` was still being refused by its predecessors' history.
 */
export function competitorDiscoveryFailureHistory(
  failures: readonly CompetitorDiscoveryTerminalFailure[],
  pendingScope: unknown,
): CompetitorDiscoveryFailureHistory {
  const pending = competitorDiscoveryScopeFingerprint(pendingScope);
  const comparable = failures.filter((failure) => {
    // Fail closed on both sides: an unreadable stored payload, or a pending
    // scope we cannot fingerprint, must not be mistaken for a difference.
    if (pending === null) return true;
    const previous = competitorDiscoveryPayloadFingerprint(
      failure.requestPayload,
    );
    return previous === null || previous === pending;
  });
  return {
    count: comparable.length,
    lastErrorCode: comparable[0]?.lastErrorCode ?? null,
  };
}

/**
 * Whether another automatic discovery attempt is justified.
 *
 * A failed collection persists no snapshot, so the caller that checks "is there
 * competitor evidence yet?" reaches the same answer forever. Without this gate
 * that produced an unbounded enqueue loop in production. Fail closed: only a
 * recognised transient provider code earns a further attempt, and never more
 * than the cap.
 */
export function shouldRearmCompetitorDiscovery(
  history: CompetitorDiscoveryFailureHistory,
): boolean {
  if (history.count <= 0) return true;
  if (history.count >= MAX_AUTOMATIC_COMPETITOR_DISCOVERY_ATTEMPTS)
    return false;
  const code = history.lastErrorCode;
  if (code === null) return false;
  return isKnownSourceErrorCode(code) && isTransient(code);
}
