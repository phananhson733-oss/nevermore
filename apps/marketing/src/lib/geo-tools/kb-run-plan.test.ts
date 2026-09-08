import { describe, expect, it } from "vitest";
import {
  GEO_RUN_ACTIONS,
  geoRunActionRunsUnbudgeted,
  geoRunActionSpends,
  geoRunOperationAction,
  geoRunOperationKey,
  planGeoRun,
  type GeoRunAction,
  type GeoRunOperation,
  type GeoRunOperationState,
} from "./kb-run-plan.ts";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ESTIMATED = { fetch: 8_000, serp: 12_000, gsc: 5_000, model: 60_000 } as const;

function operation(overrides: Partial<GeoRunOperation> = {}): GeoRunOperation {
  return {
    key: "fetch:own:https://example.com/",
    kind: "fetch",
    state: "not_started",
    resultRef: null,
    startedAt: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

describe("deciding what to do with one operation", () => {
  it("reuses a stored result rather than paying again", () => {
    expect(geoRunOperationAction(operation({ state: "succeeded", resultRef: "r1" }), NOW)).toBe("reuse");
  });

  it("probes, never retries, a request whose outcome we did not see", () => {
    // A dispatched call may have been billed. Re-sending it because the answer
    // did not arrive is how one update becomes two charges.
    expect(geoRunOperationAction(operation({ state: "dispatched" }), NOW)).toBe("probe");
    expect(geoRunOperationAction(operation({ state: "outcome_unknown" }), NOW)).toBe("probe");
    expect(geoRunActionSpends("probe")).toBe(false);
  });

  it("does not retry a permanent failure", () => {
    expect(geoRunOperationAction(operation({ state: "failed_permanent" }), NOW)).toBe("skip");
  });

  it("retries only what is safe to retry", () => {
    expect(geoRunOperationAction(operation({ state: "failed_retryable" }), NOW)).toBe("start");
    expect(geoRunOperationAction(operation({ state: "not_started" }), NOW)).toBe("start");
    expect(geoRunActionSpends("start")).toBe(true);
  });

  it("waits behind a live claim and probes an expired one", () => {
    const live = operation({ state: "claimed", leaseExpiresAt: "2026-09-07T12:01:00.000Z" });
    const expired = operation({ state: "claimed", leaseExpiresAt: "2026-09-07T11:59:00.000Z" });
    expect(geoRunOperationAction(live, NOW)).toBe("wait");
    expect(geoRunOperationAction(expired, NOW)).toBe("probe");
  });
});

describe("planning one invocation", () => {
  const plan = (operations: readonly GeoRunOperation[], elapsedMs = 0) => planGeoRun({
    operations,
    now: new Date(NOW.getTime() + elapsedMs),
    invocationStartedAt: NOW,
    budgetMs: 250_000,
    estimatedMs: ESTIMATED,
  });

  it("reports complete when everything is stored or permanently failed", () => {
    const result = plan([
      operation({ state: "succeeded", resultRef: "r1" }),
      operation({ key: "model:questions", kind: "model", state: "failed_permanent" }),
    ]);
    expect(result.status).toBe("complete");
    expect(result.skipped).toEqual(["model:questions"]);
    expect(result.remaining).toBe(0);
  });

  it("hands back rather than starting work it cannot finish", () => {
    // Being killed mid-request is exactly the case where a charge leaves no
    // trace, so the budget check is conservative on purpose.
    const result = plan([operation({ key: "model:knowledge", kind: "model" })], 220_000);
    expect(result.status).toBe("in_progress");
    expect(result.next).toBeNull();
    expect(result.remaining).toBe(1);
  });

  it("still probes an unknown outcome when the budget is nearly gone", () => {
    const result = plan([operation({ key: "model:knowledge", kind: "model", state: "outcome_unknown" })], 249_000);
    expect(result.next?.action).toBe("probe");
  });

  it("reports blocked when another executor holds everything left", () => {
    const result = plan([operation({ state: "claimed", leaseExpiresAt: "2026-09-07T12:05:00.000Z" })]);
    expect(result.status).toBe("blocked");
    expect(result.waiting).toHaveLength(1);
    expect(result.next).toBeNull();
  });

  it("acts on one operation at a time", () => {
    const result = plan([operation({ key: "fetch:own:a" }), operation({ key: "fetch:own:b" })]);
    expect(result.next?.operation.key).toBe("fetch:own:a");
    expect(result.remaining).toBe(2);
  });
});

/**
 * The budget gate, checked over the whole action space rather than over the two
 * actions that happen to reach it today.
 *
 * Both tables are `Record<GeoRunAction, ...>`, so adding a member to
 * `GEO_RUN_ACTIONS` is a type error here until somebody says how to reach that
 * action and whether the planner may hand it out with the budget gone. The
 * expectations are written down, never computed from the predicates under test.
 */
describe("what may be handed out with no budget left", () => {
  const ONE_OPERATION: Readonly<Record<GeoRunAction, GeoRunOperation>> = {
    reuse: operation({ key: "op:reuse", state: "succeeded", resultRef: "r1" }),
    probe: operation({ key: "op:probe", state: "outcome_unknown" }),
    start: operation({ key: "op:start", state: "not_started" }),
    wait: operation({ key: "op:wait", state: "claimed", leaseExpiresAt: "2026-09-07T12:59:00.000Z" }),
    skip: operation({ key: "op:skip", state: "failed_permanent" }),
  };

  /** Hand-written. Deriving this from `geoRunActionSpends` would assert nothing. */
  const HANDED_OUT: Readonly<Record<GeoRunAction, boolean>> = {
    // A stored result is not work: the planner drops it before the gate.
    reuse: false,
    // The one exemption, and the reason is the unresolved charge, not the cost.
    probe: true,
    // The action that spends. It waits for a budget that can cover it.
    start: false,
    // Somebody else holds it; there is nothing for this invocation to do.
    wait: false,
    // Permanently failed. Retrying spends money to fail again.
    skip: false,
  };

  const BUDGET_MS = 250_000;
  const spentNow = new Date(NOW.getTime() + BUDGET_MS);

  it("hands out nothing but a probe once the budget is gone", () => {
    for (const action of GEO_RUN_ACTIONS) {
      const target = ONE_OPERATION[action];
      // The fixture really produces the action it is filed under; otherwise the
      // loop below would be checking the gate against the wrong row.
      expect(geoRunOperationAction(target, spentNow)).toBe(action);
      const result = planGeoRun({
        operations: [target],
        now: spentNow,
        invocationStartedAt: NOW,
        budgetMs: BUDGET_MS,
        estimatedMs: ESTIMATED,
      });
      expect(result.next !== null).toBe(HANDED_OUT[action]);
      if (HANDED_OUT[action]) expect(result.next?.action).toBe(action);
    }
  });

  it("exempts nothing that can spend", () => {
    // The exemption is about an unresolved charge, not about being cheap -- but
    // it must never cover an action that spends, because `kb-run-advance.ts`
    // executes everything that is not a probe through the paying path.
    for (const action of GEO_RUN_ACTIONS) {
      if (!geoRunActionRunsUnbudgeted(action)) continue;
      expect(geoRunActionSpends(action)).toBe(false);
      expect(HANDED_OUT[action]).toBe(true);
    }
    expect(GEO_RUN_ACTIONS.filter((action) => geoRunActionRunsUnbudgeted(action))).toEqual(["probe"]);
  });

  it("refuses an action it cannot classify rather than waving it through", () => {
    // A build that meets an operation state it does not know computes an action
    // neither table has a case for. `!geoRunActionSpends(action)` reads that as
    // "free" and hands it out with no budget, and `kb-run-advance.ts` then runs
    // it through `startOne`, which spends. The state below is type-illegal and
    // the ledger's own `z.enum` refuses it on read, so this is not a path a
    // request takes today -- it is the only executable difference between a
    // gate that fails closed on an unclassified action and one that does not.
    const unknown = operation({ key: "op:unknown", state: "reconciling" as unknown as GeoRunOperationState });
    expect(geoRunOperationAction(unknown, spentNow) as GeoRunAction | undefined).toBeUndefined();
    const result = planGeoRun({
      operations: [unknown],
      now: spentNow,
      invocationStartedAt: NOW,
      budgetMs: BUDGET_MS,
      estimatedMs: ESTIMATED,
    });
    expect(result.next).toBeNull();
    expect(result.status).toBe("in_progress");
    expect(result.remaining).toBe(1);
  });

  it("refuses an unclassifiable action with the whole budget still available", () => {
    // The case above pins the gate at `remainingMs === 0`, where the budget arm
    // is false for every action and the classification check is never the
    // reason anything is refused -- so it could not tell a gate that fails
    // closed on an unclassified action from one that does not. This is the
    // state a run is actually planned in: an invocation decides what to do
    // FIRST, with its whole budget unspent.
    const unknown = operation({ key: "op:unknown", state: "reconciling" as unknown as GeoRunOperationState });
    expect(geoRunOperationAction(unknown, NOW) as GeoRunAction | undefined).toBeUndefined();
    // Both tables answer `undefined` here, and `!undefined` is `true`, which is
    // how "does not spend" used to be read off an action nobody classified.
    expect(geoRunActionRunsUnbudgeted(unknown.state as unknown as GeoRunAction)).toBeUndefined();
    expect(geoRunActionSpends(unknown.state as unknown as GeoRunAction)).toBeUndefined();
    // The budget arm is wide open -- 250 s against an 8 s fetch estimate -- so
    // the classification check is the only thing that can refuse this.
    expect(BUDGET_MS).toBeGreaterThan(ESTIMATED.fetch);
    const result = planGeoRun({
      operations: [unknown],
      now: NOW,
      invocationStartedAt: NOW,
      budgetMs: BUDGET_MS,
      estimatedMs: ESTIMATED,
    });
    expect(result.next).toBeNull();
    expect(result.status).toBe("in_progress");
    expect(result.remaining).toBe(1);
  });

  it("refuses an operation kind nothing costed, rather than costing it at zero", () => {
    // A kind added to the ledger and forgotten in `GEO_RUN_ESTIMATED_MS` reads
    // `undefined` out of the table. Treating a missing estimate as free is how
    // an operation gets started at the very end of an invocation and killed
    // mid-request -- the one way a charge leaves no trace of where it happened.
    const uncosted = operation({ key: "index:own", kind: "index" as unknown as GeoRunOperation["kind"] });
    expect(geoRunOperationAction(uncosted, NOW)).toBe("start");
    expect(ESTIMATED[uncosted.kind]).toBeUndefined();
    const result = planGeoRun({
      operations: [uncosted],
      now: NOW,
      invocationStartedAt: NOW,
      budgetMs: BUDGET_MS,
      estimatedMs: ESTIMATED,
    });
    expect(result.next).toBeNull();
    expect(result.remaining).toBe(1);
  });
});

describe("operation keys", () => {
  it("addresses work by content, not by position", () => {
    // A positional key shifts when the plan changes, and a shifted key is a
    // second authorisation to spend.
    expect(geoRunOperationKey({ kind: "fetch", scope: "own", url: "https://example.com/pricing" }))
      .toBe("fetch:own:https://example.com/pricing");
    expect(geoRunOperationKey({ kind: "serp", query: "\"Acme\"" })).toBe("serp:\"Acme\"");
    expect(geoRunOperationKey({ kind: "model", step: "knowledge" })).toBe("model:knowledge");
    expect(geoRunOperationKey({ kind: "gsc", property: "sc-domain:example.com", windowDays: "90" }))
      .toBe("gsc:sc-domain:example.com:90");
  });

  it("distinguishes the same URL fetched in different scopes", () => {
    expect(geoRunOperationKey({ kind: "fetch", scope: "own", url: "https://example.com/" }))
      .not.toBe(geoRunOperationKey({ kind: "fetch", scope: "third_party", url: "https://example.com/" }));
  });
});
