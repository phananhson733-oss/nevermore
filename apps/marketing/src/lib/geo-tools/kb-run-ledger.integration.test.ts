// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- the run ledger's lease, transition and give-up rules as the database actually enforces them
// @pos -- real SQL tests, never a provider or production invocation
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { parseGeoRunOperationRecords, parseGeoRunRecord } from "./kb-run-ledger.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

const FETCH = "fetch:own:https://acme.test/";
const MODEL = "model:knowledge";
const SEED = [
  { key: FETCH, kind: "fetch" },
  { key: MODEL, kind: "model" },
];

type Claim = { outcome: string; run: unknown; operations: unknown; lease_token: string | null };
type Write = { outcome: string; operation: unknown };

async function knowledgeBase() {
  const userId = randomUUID();
  const created = await db.query(
    "select * from public.marketing_geo_upsert_kb($1,'https://acme.test','acme.test','acme.test')",
    [userId],
  );
  return { userId, kbId: created.rows[0].kb_id as string };
}

async function claimRun(input: {
  userId: string;
  kbId: string;
  runId?: string | null;
  key?: string | null;
  seed?: unknown;
}): Promise<Claim> {
  const result = await db.query("select * from public.marketing_geo_claim_kb_run($1,$2,$3,$4,$5)", [
    input.userId,
    input.kbId,
    input.runId ?? null,
    input.key ?? null,
    JSON.stringify(input.seed ?? SEED),
  ]);
  return result.rows[0] as Claim;
}

async function start(): Promise<{ userId: string; kbId: string; runId: string; token: string }> {
  const base = await knowledgeBase();
  const claimed = await claimRun({ ...base, key: "run-key-000001" });
  const run = parseGeoRunRecord(claimed.run);
  return { ...base, runId: run.runId, token: claimed.lease_token as string };
}

const call = async (sql: string, params: readonly unknown[]) =>
  (await db.query(sql, [...params])).rows[0] as Write;

const claimOperation = async (scope: { userId: string; runId: string; token: string }, key: string) =>
  await call("select * from public.marketing_geo_claim_kb_run_operation($1,$2,$3,$4)", [
    scope.userId,
    scope.runId,
    scope.token,
    key,
  ]);
const dispatchOperation = async (scope: { userId: string; runId: string; token: string }, key: string) =>
  await call("select * from public.marketing_geo_dispatch_kb_run_operation($1,$2,$3,$4)", [
    scope.userId,
    scope.runId,
    scope.token,
    key,
  ]);
const finishOperation = async (
  scope: { userId: string; runId: string; token: string },
  key: string,
  state: string,
  resultRef: string | null,
  reason: string | null,
) =>
  await call("select * from public.marketing_geo_finish_kb_run_operation($1,$2,$3,$4,$5,$6,$7)", [
    scope.userId,
    scope.runId,
    scope.token,
    key,
    state,
    resultRef,
    reason,
  ]);
const probeOperation = async (
  scope: { userId: string; runId: string; token: string },
  key: string,
  state: string,
  resultRef: string | null,
  reason: string | null,
) =>
  await call("select * from public.marketing_geo_probe_kb_run_operation($1,$2,$3,$4,$5,$6,$7)", [
    scope.userId,
    scope.runId,
    scope.token,
    key,
    state,
    resultRef,
    reason,
  ]);

async function expireRunLease(runId: string) {
  await db.query("update public.marketing_geo_kb_runs set lease_expires_at = now() - interval '1 minute' where id=$1", [
    runId,
  ]);
}
async function expireOperationLease(runId: string, key: string) {
  await db.query(
    "update public.marketing_geo_kb_run_operations set lease_expires_at = now() - interval '1 minute' where run_id=$1 and operation_key=$2",
    [runId, key],
  );
}
async function stateOf(runId: string, key: string): Promise<string> {
  const result = await db.query(
    "select state from public.marketing_geo_kb_run_operations where run_id=$1 and operation_key=$2",
    [runId, key],
  );
  return result.rows[0].state as string;
}

describe("holding a run", () => {
  it("seeds its operations once and hands out one lease", async () => {
    const base = await knowledgeBase();
    const claimed = await claimRun({ ...base, key: "run-key-000001" });
    expect(claimed.outcome).toBe("claimed");
    const operations = parseGeoRunOperationRecords(claimed.operations);
    expect(operations.map((row) => row.key)).toEqual([FETCH, MODEL]);
    expect(operations.every((row) => row.state === "not_started")).toBe(true);
    // A second invocation may only poll while the first may still be mid-request.
    const second = await claimRun({ ...base, runId: parseGeoRunRecord(claimed.run).runId });
    expect(second.outcome).toBe("busy");
    expect(second.lease_token).toBeNull();
  });

  it("refuses a second run over the same site instead of paying twice", async () => {
    const base = await knowledgeBase();
    await claimRun({ ...base, key: "run-key-000001" });
    const other = await claimRun({ ...base, key: "run-key-000002" });
    expect(other.outcome).toBe("run_active");
    const rows = await db.query("select count(*)::int as count from public.marketing_geo_kb_runs where kb_id=$1", [
      base.kbId,
    ]);
    expect(rows.rows[0].count).toBe(1);
  });

  it("hands the lease to the next invocation once the old one lapses, and never resets a state", async () => {
    const scope = await start();
    await claimOperation(scope, FETCH);
    await dispatchOperation(scope, FETCH);
    await expireRunLease(scope.runId);
    const again = await claimRun({ userId: scope.userId, kbId: scope.kbId, runId: scope.runId });
    expect(again.outcome).toBe("claimed");
    expect(again.lease_token).not.toBe(scope.token);
    const operations = parseGeoRunOperationRecords(again.operations);
    // Re-seeding is idempotent: the dispatched operation keeps saying it was
    // dispatched, which is the only thing standing between it and a re-send.
    expect(operations.find((row) => row.key === FETCH)?.state).toBe("dispatched");
  });

  it("refuses every write from a lease that is not the current one", async () => {
    const scope = await start();
    const stale = { ...scope, token: randomUUID() };
    expect((await claimOperation(stale, FETCH)).outcome).toBe("stale_lease");
    expect((await dispatchOperation(stale, FETCH)).outcome).toBe("stale_lease");
    expect((await finishOperation(stale, FETCH, "succeeded", "observation:1", null)).outcome).toBe("stale_lease");
    expect((await probeOperation(stale, FETCH, "outcome_unknown", null, "outcome_unknown")).outcome).toBe("stale_lease");
  });

  it("releases the lease at the end of an invocation so the tab can call again", async () => {
    const scope = await start();
    const released = await db.query("select * from public.marketing_geo_release_kb_run($1,$2,$3)", [
      scope.userId,
      scope.runId,
      scope.token,
    ]);
    expect(released.rows[0].outcome).toBe("released");
    const again = await claimRun({ userId: scope.userId, kbId: scope.kbId, runId: scope.runId });
    expect(again.outcome).toBe("claimed");
  });
});

describe("one operation's life", () => {
  it("goes claim, dispatch, finish", async () => {
    const scope = await start();
    expect((await claimOperation(scope, FETCH)).outcome).toBe("claimed");
    expect((await dispatchOperation(scope, FETCH)).outcome).toBe("dispatched");
    const finished = await finishOperation(scope, FETCH, "succeeded", "observation:1", null);
    expect(finished.outcome).toBe("finished");
    expect(parseGeoRunOperationRecords([finished.operation])[0]).toMatchObject({
      state: "succeeded",
      resultRef: "observation:1",
    });
  });

  it("refuses a finish from anything but a dispatched operation", async () => {
    const scope = await start();
    expect((await finishOperation(scope, FETCH, "succeeded", "observation:1", null)).outcome).toBe("conflict");
    await claimOperation(scope, FETCH);
    expect((await finishOperation(scope, FETCH, "succeeded", "observation:1", null)).outcome).toBe("conflict");
  });

  it("refuses an outcome whose parts disagree", async () => {
    const scope = await start();
    await claimOperation(scope, FETCH);
    await dispatchOperation(scope, FETCH);
    // A success with nowhere to read its result, a failure with no reason, and
    // an unknown outcome pretending to know why.
    expect((await finishOperation(scope, FETCH, "succeeded", null, null)).outcome).toBe("invalid");
    expect((await finishOperation(scope, FETCH, "failed_permanent", null, null)).outcome).toBe("invalid");
    expect((await finishOperation(scope, FETCH, "outcome_unknown", null, "timeout")).outcome).toBe("invalid");
    expect(await stateOf(scope.runId, FETCH)).toBe("dispatched");
  });
});

describe("a request that may already have been billed", () => {
  it("cannot be claimed again once it is dispatched", async () => {
    const scope = await start();
    await claimOperation(scope, MODEL);
    await dispatchOperation(scope, MODEL);
    expect((await claimOperation(scope, MODEL)).outcome).toBe("conflict");
    await expect(
      db.query(
        "update public.marketing_geo_kb_run_operations set state='claimed', lease_expires_at=now()+interval '2 minutes' where run_id=$1 and operation_key=$2",
        [scope.runId, MODEL],
      ),
    ).rejects.toThrow(/cannot be reclaimed/);
  });

  it("cannot be made retryable by a probe", async () => {
    // This is the rule the whole ledger exists for: a probe is precisely the
    // case where we do not know whether it was billed.
    const scope = await start();
    await claimOperation(scope, MODEL);
    await dispatchOperation(scope, MODEL);
    expect((await probeOperation(scope, MODEL, "failed_retryable", null, "rate_limited")).outcome).toBe("invalid");
    expect((await probeOperation(scope, MODEL, "outcome_unknown", null, "outcome_unknown")).outcome).toBe("probed");
    expect((await probeOperation(scope, MODEL, "failed_retryable", null, "rate_limited")).outcome).toBe("invalid");
    expect((await claimOperation(scope, MODEL)).outcome).toBe("conflict");
    await expect(
      db.query(
        "update public.marketing_geo_kb_run_operations set state='failed_retryable', reason='rate_limited', lease_expires_at=null where run_id=$1 and operation_key=$2",
        [scope.runId, MODEL],
      ),
    ).rejects.toThrow(/cannot be retried/);
  });

  it("can still be resolved late, or given up on", async () => {
    const scope = await start();
    await claimOperation(scope, MODEL);
    await dispatchOperation(scope, MODEL);
    await probeOperation(scope, MODEL, "outcome_unknown", null, "outcome_unknown");
    const resolved = await probeOperation(scope, MODEL, "succeeded", "generation:7", null);
    expect(resolved.outcome).toBe("probed");
    expect(parseGeoRunOperationRecords([resolved.operation])[0]).toMatchObject({
      state: "succeeded",
      resultRef: "generation:7",
      probeCount: 2,
    });
  });

  it("counts probes and stops the count from growing without bound", async () => {
    const scope = await start();
    await claimOperation(scope, MODEL);
    await dispatchOperation(scope, MODEL);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await probeOperation(scope, MODEL, "outcome_unknown", null, "outcome_unknown");
    }
    const rows = await db.query(
      "select probe_count from public.marketing_geo_kb_run_operations where run_id=$1 and operation_key=$2",
      [scope.runId, MODEL],
    );
    expect(rows.rows[0].probe_count).toBe(8);
  });
});

describe("an operation that never left", () => {
  it("may be restarted after its claim expires, because dispatch is written first", async () => {
    const scope = await start();
    await claimOperation(scope, FETCH);
    await expireOperationLease(scope.runId, FETCH);
    expect((await probeOperation(scope, FETCH, "failed_retryable", null, "lease_expired")).outcome).toBe("probed");
    expect((await claimOperation(scope, FETCH)).outcome).toBe("claimed");
  });

  it("is left alone while its claim is live", async () => {
    // A live claim belongs to an executor that may be about to dispatch it.
    const scope = await start();
    await claimOperation(scope, FETCH);
    expect((await probeOperation(scope, FETCH, "failed_retryable", null, "lease_expired")).outcome).toBe("conflict");
    expect(await stateOf(scope.runId, FETCH)).toBe("claimed");
  });
});

describe("extending and closing a run", () => {
  it("appends discovered work without disturbing what is already there", async () => {
    const scope = await start();
    await claimOperation(scope, FETCH);
    await dispatchOperation(scope, FETCH);
    const appended = await db.query("select * from public.marketing_geo_append_kb_run_operations($1,$2,$3,$4)", [
      scope.userId,
      scope.runId,
      scope.token,
      JSON.stringify([{ key: FETCH, kind: "fetch" }, { key: "serp:\"Acme\"", kind: "serp" }]),
    ]);
    expect(appended.rows[0].outcome).toBe("appended");
    const operations = parseGeoRunOperationRecords(appended.rows[0].operations);
    expect(operations.map((row) => row.key)).toEqual([FETCH, MODEL, 'serp:"Acme"']);
    // Re-appending an operation that is already running must never reset it.
    expect(operations[0].state).toBe("dispatched");
  });

  it("refuses an operation whose key does not carry its kind", async () => {
    const scope = await start();
    const appended = await db.query("select * from public.marketing_geo_append_kb_run_operations($1,$2,$3,$4)", [
      scope.userId,
      scope.runId,
      scope.token,
      JSON.stringify([{ key: "fetch:own:https://acme.test/x", kind: "model" }]),
    ]);
    expect(appended.rows[0].outcome).toBe("invalid");
  });

  it("will not close while work is still open", async () => {
    const scope = await start();
    const early = await db.query("select * from public.marketing_geo_finish_kb_run($1,$2,$3)", [
      scope.userId,
      scope.runId,
      scope.token,
    ]);
    expect(early.rows[0].outcome).toBe("incomplete");
    for (const key of [FETCH, MODEL]) {
      await claimOperation(scope, key);
      await dispatchOperation(scope, key);
      await finishOperation(scope, key, "succeeded", `observation:${key}`, null);
    }
    const closed = await db.query("select * from public.marketing_geo_finish_kb_run($1,$2,$3)", [
      scope.userId,
      scope.runId,
      scope.token,
    ]);
    expect(closed.rows[0].outcome).toBe("finished");
    expect(parseGeoRunRecord(closed.rows[0].run).state).toBe("complete");
    // A closed run frees the site for the next update.
    const next = await claimRun({ userId: scope.userId, kbId: scope.kbId, key: "run-key-000002" });
    expect(next.outcome).toBe("claimed");
  });

  it("closes over permanently failed work, because deciding is what finishes a run", async () => {
    const scope = await start();
    for (const key of [FETCH, MODEL]) {
      await claimOperation(scope, key);
      await dispatchOperation(scope, key);
      await finishOperation(scope, key, "failed_permanent", null, "provider_rejected");
    }
    const closed = await db.query("select * from public.marketing_geo_finish_kb_run($1,$2,$3)", [
      scope.userId,
      scope.runId,
      scope.token,
    ]);
    expect(closed.rows[0].outcome).toBe("finished");
  });

  it("can be abandoned only once nobody holds it", async () => {
    const scope = await start();
    const busy = await db.query("select * from public.marketing_geo_abandon_kb_run($1,$2)", [scope.userId, scope.runId]);
    expect(busy.rows[0].outcome).toBe("busy");
    await expireRunLease(scope.runId);
    const abandoned = await db.query("select * from public.marketing_geo_abandon_kb_run($1,$2)", [
      scope.userId,
      scope.runId,
    ]);
    expect(abandoned.rows[0].outcome).toBe("abandoned");
    // Nothing is retried and nothing is rewritten; the charges stay recorded.
    expect(await stateOf(scope.runId, FETCH)).toBe("not_started");
    expect((await claimRun({ userId: scope.userId, kbId: scope.kbId, key: "run-key-000003" })).outcome).toBe("claimed");
  });

  it("binds the generation input exactly once", async () => {
    const scope = await start();
    const hash = "a".repeat(64);
    const bound = await db.query("select * from public.marketing_geo_bind_kb_run_input($1,$2,$3,$4)", [
      scope.userId,
      scope.runId,
      scope.token,
      hash,
    ]);
    expect(bound.rows[0].outcome).toBe("bound");
    const again = await db.query("select * from public.marketing_geo_bind_kb_run_input($1,$2,$3,$4)", [
      scope.userId,
      scope.runId,
      scope.token,
      hash,
    ]);
    expect(again.rows[0].outcome).toBe("bound");
    const different = await db.query("select * from public.marketing_geo_bind_kb_run_input($1,$2,$3,$4)", [
      scope.userId,
      scope.runId,
      scope.token,
      "b".repeat(64),
    ]);
    expect(different.rows[0].outcome).toBe("conflict");
    await expect(
      db.query("update public.marketing_geo_kb_runs set generation_input_hash=$1 where id=$2", ["c".repeat(64), scope.runId]),
    ).rejects.toThrow(/bound once/);
    // Clearing it is a rebind too: `is distinct from` catches the NULL the
    // plain comparison would let through.
    await expect(
      db.query("update public.marketing_geo_kb_runs set generation_input_hash=null where id=$1", [scope.runId]),
    ).rejects.toThrow(/bound once/);
  });
});

describe("owner scope and privileges", () => {
  it("refuses a knowledge base that is not this user's", async () => {
    const base = await knowledgeBase();
    const stranger = randomUUID();
    expect((await claimRun({ userId: stranger, kbId: base.kbId, key: "run-key-000001" })).outcome).toBe("not_found");
    const read = await db.query("select * from public.marketing_geo_read_kb_run($1,$2,null)", [stranger, base.kbId]);
    expect(read.rows[0].outcome).toBe("not_found");
  });

  it("reports no open run separately from an unknown knowledge base", async () => {
    const base = await knowledgeBase();
    const read = await db.query("select * from public.marketing_geo_read_kb_run($1,$2,null)", [base.userId, base.kbId]);
    expect(read.rows[0].outcome).toBe("none");
  });

  it("keeps the ledger append-only and the browser roles out", async () => {
    const scope = await start();
    await expect(
      db.query("delete from public.marketing_geo_kb_run_operations where run_id=$1", [scope.runId]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.marketing_geo_kb_runs where id=$1", [scope.runId])).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query("truncate public.marketing_geo_kb_run_operations")).rejects.toThrow(/append-only/);
    for (const role of ["anon", "authenticated"]) {
      await db.query(`set role ${role}`);
      await expect(db.query("select 1 from public.marketing_geo_kb_runs")).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select * from public.marketing_geo_claim_kb_run($1,$2,null,'run-key-000009','[]'::jsonb)", [
          scope.userId,
          scope.kbId,
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.query("reset role");
    }
    await db.query("set role service_role");
    await expect(
      db.query(
        "insert into public.marketing_geo_kb_run_operations(run_id,user_id,kb_id,operation_key,kind,state) values($1,$2,$3,'fetch:own:x','fetch','succeeded')",
        [scope.runId, scope.userId, scope.kbId],
      ),
    ).rejects.toThrow(/permission denied/);
    await db.query("reset role");
  });
});
