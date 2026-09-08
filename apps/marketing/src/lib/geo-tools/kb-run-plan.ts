// @input -- the durable ledger of one update run's billable operations
// @output -- what to do next with each operation, and whether the run may continue
// @pos -- pure decision logic; it performs no work, spends no budget and reads no clock beyond what it is given

/**
 * Every operation in an update that costs money or spends a shared crawl
 * allowance gets its own durable row. Resuming a run then means reading those
 * rows, not replaying the run: a second invocation must never re-send a request
 * whose outcome the first one already paid for.
 *
 * The rule that shapes all of this: a request we dispatched but whose result we
 * never saw (`outcome_unknown`) is NOT evidence that nothing was charged. It is
 * probed, never retried automatically.
 */

/** What kind of operation a key names. The prefix is part of the key. */
export const GEO_RUN_OPERATION_KINDS = ["fetch", "serp", "gsc", "model"] as const;
export type GeoRunOperationKind = (typeof GEO_RUN_OPERATION_KINDS)[number];

export type GeoRunOperationState =
  | "not_started"
  | "claimed"
  | "dispatched"
  | "succeeded"
  | "failed_retryable"
  | "failed_permanent"
  | "outcome_unknown";

export interface GeoRunOperation {
  readonly key: string;
  readonly kind: GeoRunOperationKind;
  readonly state: GeoRunOperationState;
  /** Where the stored result lives, once there is one. */
  readonly resultRef: string | null;
  readonly startedAt: string | null;
  /** Only a claim is leased; a dispatched request is not re-leased. */
  readonly leaseExpiresAt: string | null;
}

/**
 * - `reuse`  the result is already stored and paid for
 * - `probe`  we may have been charged; read the outcome before doing anything
 * - `start`  nothing was dispatched, or the failure is safe to retry
 * - `wait`   someone else holds a live claim on this exact operation
 * - `skip`   a permanent failure; retrying spends money to fail again
 *
 * Listed as a value, like `GEO_RUN_OPERATION_KINDS` above, so that the tables
 * below can be checked against the whole action space rather than against
 * whichever members somebody remembered to write a case for.
 */
export const GEO_RUN_ACTIONS = ["reuse", "probe", "start", "wait", "skip"] as const;
export type GeoRunAction = (typeof GEO_RUN_ACTIONS)[number];

export function geoRunOperationAction(operation: GeoRunOperation, now: Date): GeoRunAction {
  switch (operation.state) {
    case "succeeded":
      return "reuse";
    case "dispatched":
    case "outcome_unknown":
      // A dispatched request may have been billed. Read what happened; do not
      // send it again because we did not see the answer.
      return "probe";
    case "failed_permanent":
      return "skip";
    case "failed_retryable":
    case "not_started":
      return "start";
    case "claimed":
      return operation.leaseExpiresAt !== null && Date.parse(operation.leaseExpiresAt) > now.getTime() ? "wait" : "probe";
  }
}

/**
 * True when this action can cost money or crawl allowance.
 *
 * Written as an exhaustive switch rather than `action === "start"` on purpose.
 * A new member of `GeoRunAction` is then a compile error in this function --
 * somebody has to say whether it spends -- instead of defaulting to "free".
 *
 * This answers what an action *costs*. It does not answer whether `planGeoRun`
 * may hand it out with the budget gone; that is `geoRunActionRunsUnbudgeted`,
 * and the two are deliberately separate -- see the note there.
 */
export function geoRunActionSpends(action: GeoRunAction): boolean {
  switch (action) {
    case "start":
      return true;
    case "reuse":
    case "probe":
    case "wait":
    case "skip":
      return false;
  }
}

/**
 * True when `planGeoRun` may hand this action out with no budget left.
 *
 * An allowlist of one, and not a restatement of `!geoRunActionSpends`. Those
 * are different questions, and the difference is the whole safety margin:
 *
 *  - `reuse`, `wait` and `skip` also spend nothing, so "does not spend" is a
 *    strictly wider set than "must run even when there is no time left". Using
 *    the wider set as the exemption means an action added to it later inherits
 *    a bypass nobody ever checked it for -- fail-open by classification.
 *  - The reason `probe` is exempt is not that it is cheap. It is that it
 *    resolves a charge we may already have paid; deferring it leaves money
 *    unaccounted, which is worse than the probe's own cost.
 *  - `kb-run-advance.ts` executes `plan.next` as `action === "probe" ? probe :
 *    start`, and `start` dispatches billable work. So anything this function
 *    exempts and that file does not recognise as a probe is a spend with no
 *    budget check. The exemption set must stay a subset of what that seam
 *    treats as free.
 *
 * Exhaustive for the same reason as above: a new action is a compile error
 * here until somebody decides, and the decision it forces is "may this run
 * unbudgeted", not "is this cheap".
 */
export function geoRunActionRunsUnbudgeted(action: GeoRunAction): boolean {
  switch (action) {
    case "probe":
      return true;
    case "reuse":
    case "start":
    case "wait":
    case "skip":
      return false;
  }
}

export interface GeoRunPlanInput {
  readonly operations: readonly GeoRunOperation[];
  readonly now: Date;
  /** Wall-clock start of this invocation, not of the run. */
  readonly invocationStartedAt: Date;
  /** How long this invocation may keep working before it must hand back. */
  readonly budgetMs: number;
  /** A conservative cost estimate for one more operation of each kind. */
  readonly estimatedMs: Readonly<Record<GeoRunOperationKind, number>>;
}

export interface GeoRunPlan {
  readonly status: "complete" | "in_progress" | "blocked";
  /** The next operation to act on, if this invocation should act on one. */
  readonly next: { readonly operation: GeoRunOperation; readonly action: GeoRunAction } | null;
  /** Operations another executor holds; the caller may only poll. */
  readonly waiting: readonly string[];
  /** Permanently failed operations, so the caller can report what is missing. */
  readonly skipped: readonly string[];
  readonly remaining: number;
}

/**
 * Decide what this invocation does next. It stops handing out work as soon as
 * the remaining budget cannot conservatively cover one more operation of that
 * kind: better to return `in_progress` and be called again than to be killed
 * mid-request, which is how a charge becomes invisible.
 */
export function planGeoRun(input: GeoRunPlanInput): GeoRunPlan {
  const elapsed = input.now.getTime() - input.invocationStartedAt.getTime();
  const remainingMs = input.budgetMs - elapsed;
  const waiting: string[] = [];
  const skipped: string[] = [];
  let next: GeoRunPlan["next"] = null;
  let outstanding = 0;

  for (const operation of input.operations) {
    const action = geoRunOperationAction(operation, input.now);
    if (action === "reuse") continue;
    if (action === "skip") { skipped.push(operation.key); continue; }
    outstanding += 1;
    if (action === "wait") { waiting.push(operation.key); continue; }
    if (next !== null) continue;
    // A probe resolves an unknown charge, so it is allowed even when the budget
    // is too tight to start new work. Everything else waits for a budget.
    //
    // Three conditions, and the first one is the gate, not a formality.
    //
    //  - `known` is a membership test against `GEO_RUN_ACTIONS`, because both
    //    tables below are exhaustive switches: handed a value no case matches
    //    they fall off the end and answer `undefined`. `!undefined` is `true`,
    //    so the cost predicate reports an action nobody classified as free --
    //    and the budget arm then hands it out for the entire invocation, since
    //    a run is planned when nothing has been spent yet. Classification had
    //    to come first or it decided nothing.
    //  - The two tables then have to agree. `!geoRunActionSpends` alone was
    //    fail-open by classification: it exempts every action anyone ever files
    //    as free, and `kb-run-advance.ts` runs anything that is not a probe
    //    through `startOne`, which spends. Requiring the narrow allowlist *and*
    //    the cost predicate means one wrong entry cannot open it on its own.
    //  - A kind with no entry in `estimatedMs` reads `undefined`, and
    //    `remainingMs >= undefined` is false, so an uncosted operation waits
    //    rather than being costed at zero. Do not paper that over with `?? 0`:
    //    zero means "start it with a millisecond left", which is the case where
    //    the platform kills the request mid-flight and the charge leaves no
    //    trace of where it happened.
    const known = GEO_RUN_ACTIONS.includes(action);
    const unbudgeted = geoRunActionRunsUnbudgeted(action) === true && geoRunActionSpends(action) === false;
    if (known && (unbudgeted || remainingMs >= input.estimatedMs[operation.kind])) {
      next = { operation, action };
    }
  }

  if (outstanding === 0) return { status: "complete", next: null, waiting, skipped, remaining: 0 };
  if (next === null) {
    // Either someone else holds every remaining operation, or there is no time
    // left in this invocation. Both mean: come back, do not force it through.
    return { status: waiting.length === outstanding ? "blocked" : "in_progress", next: null, waiting, skipped, remaining: outstanding };
  }
  return { status: "in_progress", next, waiting, skipped, remaining: outstanding };
}

/**
 * Operation keys are content-addressed so that the same work in a resumed run
 * maps to the same row. A fetch is keyed by URL, a SERP call by its exact
 * query, a model step by its name -- never by an index, which would shift when
 * the plan changes and silently authorise a second charge.
 */
export function geoRunOperationKey(input:
  | { readonly kind: "fetch"; readonly scope: "own" | "competitor" | "third_party" | "machine"; readonly url: string }
  | { readonly kind: "serp"; readonly query: string }
  | { readonly kind: "gsc"; readonly property: string; readonly windowDays: string }
  | { readonly kind: "model"; readonly step: "roles" | "knowledge" | "questions" },
): string {
  switch (input.kind) {
    case "fetch": return `fetch:${input.scope}:${input.url}`;
    case "serp": return `serp:${input.query}`;
    case "gsc": return `gsc:${input.property}:${input.windowDays}`;
    case "model": return `model:${input.step}`;
  }
}
