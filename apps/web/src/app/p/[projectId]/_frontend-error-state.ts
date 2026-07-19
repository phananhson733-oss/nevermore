/**
 * Pure UI decisions shared by the project screens. Keeping these decisions
 * outside React makes the failure paths deterministic and independently tested;
 * no server/provider detail is ever returned for display.
 */

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

interface RunProjection {
  readonly status: string;
}

export type RunQueryOutcome =
  | "query_error"
  | "terminal"
  | "active"
  | "loading";

function runQueryOutcome(
  run: RunProjection | undefined,
  error: unknown,
): RunQueryOutcome {
  // A final query error wins over retained/stale data. TanStack Query may keep
  // the previous data while the refetch itself has failed.
  if (error != null) return "query_error";
  if (run === undefined) return "loading";
  return TERMINAL_RUN_STATUSES.has(run.status) ? "terminal" : "active";
}

export const sourceRunQueryOutcome = runQueryOutcome;
export const studioRunQueryOutcome = runQueryOutcome;

/** Do not immediately re-seed a settled poll from the same stale projection. */
export function resolveSourceRunId(
  locallyStartedRunId: string | null,
  projectedRunId: string | null,
  settledRunId: string | null,
): string | null {
  if (locallyStartedRunId !== null) return locallyStartedRunId;
  return projectedRunId === settledRunId ? null : projectedRunId;
}

export type SourceHintMessageKey =
  | "rateLimitRetryScheduled"
  | "permissionReconnectRequired";

interface SourceHintProjection {
  readonly state: string;
  readonly activeRun:
    | {
        readonly progress: { readonly phase: string };
        readonly lastError: { readonly code: string } | null;
      }
    | null;
}

/** Map stable source/run states to user-safe recovery guidance. */
export function sourceHintMessageKey(
  source: SourceHintProjection,
): SourceHintMessageKey | null {
  if (source.state === "permission_denied") {
    return "permissionReconnectRequired";
  }
  if (
    source.activeRun?.progress.phase === "retry_wait" &&
    source.activeRun.lastError?.code === "RATE_LIMITED"
  ) {
    return "rateLimitRetryScheduled";
  }
  return null;
}

export type SourceCollectLabelKey = "collectNow" | "retryCollection";

/** Partial/stale sources are collected again, not for the first time. */
export function sourceCollectLabelKey(state: string): SourceCollectLabelKey {
  return state === "partial" || state === "stale"
    ? "retryCollection"
    : "collectNow";
}

export type OAuthCallbackMessageKey =
  | "oauthStateReplayed"
  | "oauthStateExpired"
  | "oauthConsentDenied"
  | "oauthExchangeFailed"
  | "oauthError";

/** Allowlist callback codes; unknown query text always becomes generic copy. */
export function oauthCallbackMessageKey(
  code: string | null,
): OAuthCallbackMessageKey {
  switch (code) {
    case "OAUTH_STATE_REPLAYED":
      return "oauthStateReplayed";
    case "OAUTH_STATE_EXPIRED":
      return "oauthStateExpired";
    case "OAUTH_CONSENT_DENIED":
      return "oauthConsentDenied";
    case "OAUTH_EXCHANGE_FAILED":
      return "oauthExchangeFailed";
    default:
      return "oauthError";
  }
}

export type ExportErrorMessageKey =
  | "exportAlreadyActive"
  | "exportDependencyUnavailable"
  | "exportFailed";

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Map only stable contract codes; provider/problem detail is never displayed. */
export function exportErrorMessageKey(error: unknown): ExportErrorMessageKey {
  switch (codeOf(error)) {
    case "RUN_ALREADY_ACTIVE":
      return "exportAlreadyActive";
    case "DEPENDENCY_UNAVAILABLE":
      return "exportDependencyUnavailable";
    default:
      return "exportFailed";
  }
}

export interface CsvPreviewField {
  readonly label: string;
  readonly value: string;
}

export interface CsvPreviewEntry {
  readonly rowNumber: number;
  readonly fields: readonly CsvPreviewField[];
}

/** One label/value list per row for the narrow-screen accessible presentation. */
export function csvPreviewEntries(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): readonly CsvPreviewEntry[] {
  return rows.map((row, index) => ({
    rowNumber: index + 1,
    fields: columns.map((column) => {
      const value = row[column];
      return {
        label: column,
        value: value == null ? "" : String(value),
      };
    }),
  }));
}
