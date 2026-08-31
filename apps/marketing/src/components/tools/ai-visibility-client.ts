// @input -- load/status responses for the existing run protocol
// @output -- validated client values and bounded polling helpers
// @pos -- private visibility transport parsing; no UI or provider calls
import { GEO_VISIBILITY_SCHEMA_VERSION, VISIBILITY_RUNS_PER_DAY } from "../../lib/geo-tools/visibility-contract.ts";
import { GEO_VISIBILITY_V2, type AnyVisibilityReport as VisibilityReport } from "../../lib/geo-tools/visibility-v2-contract.ts";
import { parseVisibilityReportV2 } from "../../lib/geo-tools/visibility-export.ts";
import { decodeVisibilityWire, VISIBILITY_WIRE_SCHEMA } from "../../lib/geo-tools/visibility-wire.ts";
export const POLL_DEFAULT_MS = 2_000;
const POLL_MAX_MS = 5_000;
export interface FrozenVersion {
  readonly kbId: string;
  readonly snapshotId: string;
  readonly host: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
  readonly language: string | null;
  readonly marketCode: string | null;
}

/** What the load endpoint reports beside the choices themselves. */
export interface LoadedChoices {
  readonly versions: readonly FrozenVersion[];
  /**
   * False only when the server says so. Absent means the account has no frozen
   * version at all, which is the empty state — refusing the button there would
   * be an answer to a question nobody asked.
   */
  readonly providerConfigured: boolean;
  readonly runsPerDay: number;
}

export type StatusOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "completed"; readonly report: VisibilityReport }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "invalid" };

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function errorCodeOf(value: unknown): string | null {
  const error = asRecord(asRecord(value)?.["error"]);
  const code = error?.["code"];
  return typeof code === "string" && code.length > 0 ? code : null;
}

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * One frozen choice, field by field.
 *
 * A `as readonly FrozenVersion[]` cast is why the page shipped reading
 * `data.versions` while the handler sent `data.choices`: the assertion made
 * `undefined` typecheck as a list of versions, so nothing between the two
 * modules ever compared them. Checking the fields the form indexes into is
 * what turns that class of mistake into a load error instead of a blank page.
 */
function asFrozenVersion(value: unknown): FrozenVersion | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kbId = record["kbId"];
  const snapshotId = record["snapshotId"];
  const host = record["host"];
  const frozenAt = record["frozenAt"];
  const revision = countOf(record["revision"]);
  const questionCount = countOf(record["questionCount"]);
  const retrievalCount = countOf(record["retrievalCount"]);
  if (
    typeof kbId !== "string" ||
    kbId.length === 0 ||
    typeof snapshotId !== "string" ||
    snapshotId.length === 0 ||
    typeof host !== "string" ||
    typeof frozenAt !== "string" ||
    revision === null ||
    questionCount === null ||
    retrievalCount === null
  ) {
    return null;
  }
  return {
    kbId,
    snapshotId,
    host,
    frozenAt,
    revision,
    questionCount,
    retrievalCount,
    language: typeof record["language"] === "string" ? record["language"] : null,
    marketCode: typeof record["marketCode"] === "string" ? record["marketCode"] : null,
  };
}

/** The load endpoint's payload, or null when it is not the shape the form reads. */
export function asLoadedChoices(body: unknown): LoadedChoices | null {
  const data = asRecord(asRecord(body)?.["data"]);
  if (data === null) return null;
  const list = data["choices"];
  if (!Array.isArray(list)) return null;
  const versions: FrozenVersion[] = [];
  for (const entry of list) {
    const version = asFrozenVersion(entry);
    if (version === null) return null;
    versions.push(version);
  }
  return {
    versions,
    providerConfigured: data["providerConfigured"] !== false,
    runsPerDay: countOf(data["runsPerDay"]) ?? VISIBILITY_RUNS_PER_DAY,
  };
}

/**
 * Accept a report only when the shapes the page indexes into are present.
 *
 * The schema version is checked because a tab left open across a deploy would
 * otherwise render an older reading of newer fields, and a stale bundle is
 * exactly the case where a wrong number looks like a real one.
 */
export function asReport(value: unknown): VisibilityReport | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (record["wireSchema"] === VISIBILITY_WIRE_SCHEMA) return decodeVisibilityWire(value);
  const manifest = asRecord(record["manifest"]);
  const metrics = asRecord(record["metrics"]);
  if (manifest === null || metrics === null) return null;
  if (manifest["schemaVersion"] === GEO_VISIBILITY_V2) return parseVisibilityReportV2(value);
  if (manifest["schemaVersion"] !== GEO_VISIBILITY_SCHEMA_VERSION) return null;
  if (!Array.isArray(metrics["byLayer"])) return null;
  if (!Array.isArray(record["questions"])) return null;
  if (!Array.isArray(record["citedDomains"])) return null;
  if (!Array.isArray(record["limits"])) return null;
  return value as VisibilityReport;
}

export function readStatus(httpStatus: number, body: unknown): StatusOutcome {
  const code = errorCodeOf(body);
  if (httpStatus >= 400) {
    return code === null ? { kind: "invalid" } : { kind: "error", code };
  }
  const data = asRecord(asRecord(body)?.["data"]);
  if (data === null) return { kind: "invalid" };
  if (data["status"] === "completed") {
    const report = asReport(data["report"]);
    return report === null
      ? { kind: "error", code: "schema_mismatch" }
      : { kind: "completed", report };
  }
  // Queued is not a failure. The workflow reports `pending` before it reports
  // `running`, and a client that treated the first as unreadable spent five
  // polls — about ten seconds — declaring a paid run dead while several
  // hundred provider calls were still in flight.
  if (data["status"] === "running" || data["status"] === "queued") {
    return { kind: "running" };
  }
  return { kind: "invalid" };
}

/**
 * The server's own cooldown, clamped.
 *
 * It travels in the body, not in `Retry-After`: `privateJson` sets only
 * `Cache-Control`. A hostile or broken value must still not park the button
 * for a week, hence the ceiling.
 */
export function retryAfterSecondsFrom(body: unknown): number {
  const record = asRecord(body);
  const seconds =
    countOf(record?.["retryAfterSeconds"]) ??
    countOf(asRecord(record?.["data"])?.["retryAfterSeconds"]) ??
    0;
  return Math.min(seconds, 3_600);
}

export function pollDelayMs(body: unknown): number {
  const seconds = retryAfterSecondsFrom(body);
  return seconds > 0 ? Math.min(POLL_MAX_MS, seconds * 1_000) : POLL_DEFAULT_MS;
}

export function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
