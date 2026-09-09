// @input -- a knowledge base id and, for a resume or a drop, the run the tab already knows about
// @output -- the run driven to a resting state one HTTP call per operation, its free state read, and the call that drops it
// @pos -- browser-safe: no hashing, no store, no server import; it decides nothing about what the run does

/**
 * The tab's half of the run protocol.
 *
 * The server advances a run by one operation per call and hands it back; this
 * keeps calling until the plan reports a resting state. The loop lives here
 * rather than in the route because a single long request is the failure mode
 * the whole design exists to avoid: a platform kill mid-request is exactly the
 * case where a charge leaves no record of where it landed.
 *
 * Nothing here decides what work happens. The request names a knowledge base
 * and, at most, a run id; the operation list is derived on the server from the
 * owner's own draft.
 */

export const GEO_KB_RUN_ENDPOINT = "/api/tools/geo-knowledge-base/v3/run";

/** States that mean "stop calling". */
export const GEO_KB_RUN_RESTING = [
  "complete",
  "blocked",
  "run_active",
  "finished",
  "failed",
  "stalled",
] as const;
export type GeoKbRunRestingStatus = (typeof GEO_KB_RUN_RESTING)[number];

export type GeoKbRunStatus =
  | GeoKbRunRestingStatus
  | "in_progress"
  /** Another executor holds the lease right now; polling is allowed, forcing is not. */
  | "busy";

export interface GeoKbRunOperationView {
  readonly key: string;
  readonly kind: string;
  readonly state: string;
  readonly reason: string | null;
}

export interface GeoKbRunView {
  readonly status: GeoKbRunStatus;
  readonly runId: string | null;
  readonly operations: readonly GeoKbRunOperationView[];
  readonly waiting: readonly string[];
  readonly skipped: readonly string[];
  readonly remaining: number;
  /** Present when the loop stopped for a reason that is not the plan's. */
  readonly errorCode: string | null;
}

const RESTING = new Set<string>(GEO_KB_RUN_RESTING);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function operations(value: unknown): readonly GeoKbRunOperationView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    record(entry) &&
    typeof entry.key === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.state === "string"
      ? [
          {
            key: entry.key,
            kind: entry.kind,
            state: entry.state,
            reason: typeof entry.reason === "string" ? entry.reason : null,
          },
        ]
      : [],
  );
}

function keys(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * `remaining` arrives as a decimal string: this wire carries no JSON numbers,
 * the same rule the V3 payload domain enforces.
 *
 * A value that is not one reads as unknown, never as zero. It is the loop's
 * only measure of progress, and an unparsable field defaulting to zero would
 * manufacture one apparent step forward (unknown -> 0) and buy a server that
 * cannot move an extra round trip on every drive.
 */
function remaining(value: unknown): number {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,4})$/u.test(value)
    ? Number(value)
    : Number.NaN;
}

export function parseGeoKbRunView(value: unknown): GeoKbRunView | null {
  if (!record(value)) return null;
  const status = value.status;
  if (typeof status !== "string") return null;
  const run =
    record(value.run) && typeof value.run.runId === "string"
      ? value.run.runId
      : null;
  return {
    status: status as GeoKbRunStatus,
    runId: run,
    operations: operations(value.operations),
    waiting: keys(value.waiting),
    skipped: keys(value.skipped),
    remaining: remaining(value.remaining),
    errorCode: null,
  };
}

export type GeoKbRunPost = (
  body: Record<string, unknown>,
) => Promise<
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: string; readonly data: unknown }
>;

export const defaultGeoKbRunPost: GeoKbRunPost = async (body) => {
  try {
    const response = await fetch(GEO_KB_RUN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const value: unknown = await response.json();
    if (!record(value)) return { ok: false, code: "bad_response", data: null };
    if (response.ok)
      return Object.hasOwn(value, "data")
        ? { ok: true, data: value.data }
        : { ok: false, code: "bad_response", data: null };
    // A 409 still carries a body describing the run that is in the way.
    return {
      ok: false,
      code:
        record(value.error) && typeof value.error.code === "string"
          ? value.error.code
          : "bad_response",
      data: Object.hasOwn(value, "data") ? value.data : null,
    };
  } catch {
    return { ok: false, code: "network", data: null };
  }
};

export interface GeoKbRunDriveInput {
  readonly kbId: string;
  /** Start a run: a key the tab keeps, so a re-press resumes rather than duplicates. */
  readonly idempotencyKey?: string | null;
  /** Resume a run this tab (or a previous one) already created. */
  readonly runId?: string | null;
}

export interface GeoKbRunDriveDependencies {
  readonly post?: GeoKbRunPost;
  /** Called after every call so the UI can show progress while the loop runs. */
  readonly onView?: (view: GeoKbRunView) => void;
  /** Cooperative stop: the tab is closing, or the visitor pressed stop. */
  readonly signal?: { readonly aborted: boolean };
  readonly wait?: (ms: number) => Promise<void>;
  /** Hard ceiling on calls, so a server that never settles cannot spin a tab forever. */
  readonly maxCalls?: number;
  readonly busyBackoffMs?: number;
}

export const GEO_KB_RUN_MAX_CALLS = 400;
export const GEO_KB_RUN_BUSY_BACKOFF_MS = 3_000;
/**
 * How many consecutive calls may report no progress before the loop stops.
 *
 * `in_progress` with nothing acted on and no fall in `remaining` is what a
 * server that cannot move looks like. Calling forever would hide it; stopping
 * with `stalled` puts it in front of the visitor, who still has the run and can
 * continue it later.
 */
export const GEO_KB_RUN_STALL_LIMIT = 3;

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive one run to a resting state.
 *
 * The first call starts (or resumes) the run; every later call passes the run
 * id the server returned, so the auto-continue can never create a second run
 * for the same gesture.
 */
export async function driveGeoKbRun(
  input: GeoKbRunDriveInput,
  dependencies: GeoKbRunDriveDependencies = {},
): Promise<GeoKbRunView> {
  const post = dependencies.post ?? defaultGeoKbRunPost;
  const wait = dependencies.wait ?? sleep;
  const maxCalls = dependencies.maxCalls ?? GEO_KB_RUN_MAX_CALLS;
  let runId = input.runId ?? null;
  let last: GeoKbRunView = {
    status: "in_progress",
    runId,
    operations: [],
    waiting: [],
    skipped: [],
    remaining: Number.NaN,
    errorCode: null,
  };
  let stalled = 0;

  for (let call = 0; call < maxCalls; call += 1) {
    if (dependencies.signal?.aborted === true)
      return { ...last, status: "in_progress", errorCode: "aborted" };
    const body: Record<string, unknown> =
      runId === null
        ? { kbId: input.kbId, idempotencyKey: input.idempotencyKey ?? null }
        : { kbId: input.kbId, runId };
    const response = await post(body);
    const view = parseGeoKbRunView(response.ok ? response.data : response.data);
    if (view === null) {
      return {
        ...last,
        status: "failed",
        errorCode: response.ok ? "bad_response" : response.code,
      };
    }
    // Hold on to the id from the first answer: without it a retry after a
    // transient failure would look like a new gesture.
    runId = view.runId ?? runId;
    const current: GeoKbRunView = {
      ...view,
      runId,
      errorCode: response.ok ? null : response.code,
    };
    dependencies.onView?.(current);

    if (
      !response.ok &&
      current.status !== "busy" &&
      current.status !== "run_active"
    ) {
      return { ...current, status: "failed" };
    }
    if (RESTING.has(current.status)) return current;
    if (current.status === "busy") {
      await wait(dependencies.busyBackoffMs ?? GEO_KB_RUN_BUSY_BACKOFF_MS);
      last = current;
      continue;
    }
    // Progress is a fall in `remaining` or an operation acted on. NaN counts as
    // no progress, which is the conservative reading of an unparsable field.
    const moved =
      Number.isFinite(current.remaining) && Number.isFinite(last.remaining)
        ? current.remaining < last.remaining
        : Number.isFinite(current.remaining) &&
          !Number.isFinite(last.remaining);
    stalled = moved ? 0 : stalled + 1;
    last = current;
    if (stalled >= GEO_KB_RUN_STALL_LIMIT)
      return { ...current, status: "stalled", errorCode: "no_progress" };
  }
  return { ...last, status: "stalled", errorCode: "call_limit" };
}

/** Ask what run, if any, this knowledge base can continue. Spends nothing. */
export async function readGeoKbRunState(
  kbId: string,
  dependencies: GeoKbRunDriveDependencies = {},
): Promise<{
  readonly status: string;
  readonly runId: string | null;
  readonly operations: readonly GeoKbRunOperationView[];
}> {
  const post = dependencies.post ?? defaultGeoKbRunPost;
  const response = await post({ kbId, action: "read" });
  if (!response.ok || !record(response.data))
    return { status: "unavailable", runId: null, operations: [] };
  const data = response.data;
  const run =
    record(data.run) && typeof data.run.runId === "string"
      ? data.run.runId
      : null;
  return {
    status: typeof data.status === "string" ? data.status : "unavailable",
    runId: run,
    operations: operations(data.operations),
  };
}

/**
 * What asking to drop a stopped run answered.
 *
 * `busy` is kept apart from every other refusal because it is the only one a
 * person fixes by waiting: the ledger refuses while a lease is live, which
 * means an executor may be mid-request. `not_found` is kept apart from
 * `abandoned` for the opposite reason -- both leave nothing pinned, but only
 * one of them dropped something, and saying "discarded" over a run that was
 * never there is a claim about the owner's work that this page cannot make.
 */
export type GeoKbRunAbandonResult =
  | { readonly outcome: "abandoned" | "finished" | "not_found" | "busy" }
  | { readonly outcome: "failed"; readonly code: string };

/**
 * Drop a run that stopped and is not going to resume.
 *
 * This is the only call that frees `marketing_geo_kb_run_single_active_idx` for
 * a run nothing is driving. While that index is held, every attempt to start an
 * update over the same knowledge base answers `run_active`, so a stopped run
 * with no exit is a knowledge base that can never be updated again.
 *
 * It rewrites no operation: whatever the run already sent, and whatever that
 * cost, stays on the record. What it does forfeit is the run's own key -- the
 * next update starts a new one and buys the knowledge step again -- so it
 * belongs behind a gesture whose copy says so, never behind a render.
 */
export async function abandonGeoKbRun(
  input: { readonly kbId: string; readonly runId: string },
  dependencies: GeoKbRunDriveDependencies = {},
): Promise<GeoKbRunAbandonResult> {
  const post = dependencies.post ?? defaultGeoKbRunPost;
  const response = await post({
    kbId: input.kbId,
    runId: input.runId,
    action: "abandon",
  });
  if (!response.ok) {
    // `run_busy` is the route's 409 for a live lease and `not_found` its 404.
    // Everything else keeps its own code so the caller can tell an expired
    // sign-in from an outage; none of them is read as a successful drop.
    return response.code === "run_busy"
      ? { outcome: "busy" }
      : response.code === "not_found"
        ? { outcome: "not_found" }
        : { outcome: "failed", code: response.code };
  }
  // A 200 that does not name the ledger's own outcome is not a statement that
  // anything was dropped, so it is not read as one.
  const status = record(response.data) ? response.data.status : undefined;
  return status === "abandoned" || status === "finished"
    ? { outcome: status }
    : { outcome: "failed", code: "bad_response" };
}
