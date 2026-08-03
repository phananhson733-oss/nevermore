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
 * The cap alone would be permanent: a project that burned its attempts before
 * the defect behind them was fixed could never discover competitors again. A
 * window stops the storm within minutes — the production loop fired 20 times in
 * 88 seconds — while letting a later attempt succeed once the cause is gone.
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

function isKnownSourceErrorCode(value: string): value is SourceErrorCode {
  return (SOURCE_ERROR_CODES as readonly string[]).includes(value);
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
