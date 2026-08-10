import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
  KeywordGovernanceScheduleRequestsRepository,
  type KeywordGovernanceScheduleRequest,
} from "./keyword-governance-schedule-requests.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor() {
  const calls: Call[] = [];
  const results: unknown[] = [];
  return {
    executor: {
      execute(value: unknown) {
        calls.push({ method: "execute", args: [value] });
        return Promise.resolve(results.shift() ?? { rows: [] });
      },
    } as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
  };
}

function query(call: Call) {
  return new PgDialect().sqlToQuery(call.args[0] as never);
}

const ids = {
  workspace: "55000000-0000-4000-8000-000000000001",
  project: "55000000-0000-4000-8000-000000000002",
  actor: "55000000-0000-4000-8000-000000000003",
  request: "55000000-0000-4000-8000-000000000004",
  token: "55000000-0000-4000-8000-000000000005",
} as const;
const scope = { workspaceId: ids.workspace, projectId: ids.project };
const dbRow = {
  id: ids.request,
  workspace_id: ids.workspace,
  project_id: ids.project,
  dispatch_key:
    `keyword-governance-schedule.v1:${ids.workspace}:${ids.project}:analysis_refresh:refresh-1`,
  source_kind: "analysis_refresh",
  source_ref: "refresh-1",
  initiated_by: ids.actor,
  requested_at: "2026-08-10T10:00:00.000Z",
  next_attempt_at: "2026-08-10T10:00:00.000Z",
  claim_token: null,
  claimed_at: null,
  claim_expires_at: null,
  attempt_count: 0,
  completed_at: null,
  last_error_code: null,
} as const;
const row: KeywordGovernanceScheduleRequest = {
  id: ids.request,
  workspaceId: ids.workspace,
  projectId: ids.project,
  dispatchKey: dbRow.dispatch_key,
  sourceKind: "analysis_refresh",
  sourceRef: "refresh-1",
  initiatedBy: ids.actor,
  requestedAt: dbRow.requested_at,
  nextAttemptAt: dbRow.next_attempt_at,
  claimToken: null,
  claimedAt: null,
  claimExpiresAt: null,
  attemptCount: 0,
  completedAt: null,
  lastErrorCode: null,
};
const claimedDbRow = {
  ...dbRow,
  claim_token: ids.token,
  claimed_at: "2026-08-10T10:00:01.000Z",
  claim_expires_at: "2026-08-10T10:01:01.000Z",
  attempt_count: 1,
};
const claimedRow = {
  ...row,
  claimToken: ids.token,
  claimedAt: claimedDbRow.claimed_at,
  claimExpiresAt: claimedDbRow.claim_expires_at,
  attemptCount: 1,
} as const;

describe("KeywordGovernanceScheduleRequestsRepository", () => {
  it("inserts or replays one exact scoped deterministic source request", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      { rows: [{ result: { kind: "inserted", request: dbRow } }] },
      { rows: [{ result: { kind: "existing", request: dbRow } }] },
    );
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );
    const input = {
      sourceKind: "analysis_refresh" as const,
      sourceRef: "refresh-1",
      initiatedBy: ids.actor,
    };

    await expect(repo.insertRequest(scope, input)).resolves.toEqual({
      kind: "inserted",
      request: row,
    });
    await expect(repo.insertRequest(scope, input)).resolves.toEqual({
      kind: "existing",
      request: row,
    });
    const compiled = query(fake.calls[0]!);
    expect(compiled.sql).toContain(
      "app.insert_keyword_governance_schedule_request",
    );
    expect(compiled.params).toEqual([
      ids.workspace,
      ids.project,
      "analysis_refresh",
      "refresh-1",
      ids.actor,
    ]);
  });

  it("claims one exact request by id or deterministic source without revealing foreign rows", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      { rows: [{ result: { kind: "claimed", request: claimedDbRow } }] },
      { rows: [{ result: { kind: "claimed", request: claimedDbRow } }] },
      { rows: [{ result: { kind: "unavailable" } }] },
    );
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );

    await expect(repo.claimRequest(scope, {
      requestId: ids.request,
      leaseSeconds: 60,
    })).resolves.toEqual({ kind: "claimed", request: claimedRow });
    await expect(repo.claimBySource(scope, {
      sourceKind: "analysis_refresh",
      sourceRef: "refresh-1",
      leaseSeconds: 60,
    })).resolves.toEqual({ kind: "claimed", request: claimedRow });
    await expect(repo.claimRequest(scope, {
      requestId: ids.request,
      leaseSeconds: 60,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(query(fake.calls[0]!).params).toEqual([
      ids.workspace,
      ids.project,
      ids.request,
      60,
    ]);
    expect(query(fake.calls[1]!).params).toEqual([
      ids.workspace,
      ids.project,
      "analysis_refresh",
      "refresh-1",
      60,
    ]);
  });

  it("claims a bounded deterministic due batch with database-owned lease tokens", async () => {
    const fake = fakeExecutor();
    fake.enqueue({ rows: [{ result: [claimedDbRow] }] });
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );

    await expect(repo.claimDue({ limit: 25, leaseSeconds: 60 })).resolves
      .toEqual([claimedRow]);
    const compiled = query(fake.calls[0]!);
    expect(compiled.sql).toContain(
      "app.claim_due_keyword_governance_schedule_requests",
    );
    expect(compiled.params).toEqual([25, 60]);
  });

  it("completes or safely releases only the exact scoped live claim token", async () => {
    const completed = {
      ...claimedDbRow,
      completed_at: "2026-08-10T10:00:02.000Z",
    };
    const released = {
      ...dbRow,
      next_attempt_at: "2026-08-10T10:00:03.000Z",
      attempt_count: 1,
      last_error_code: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    };
    const fake = fakeExecutor();
    fake.enqueue(
      { rows: [{ result: { kind: "completed", request: completed } }] },
      { rows: [{ result: { kind: "stale" } }] },
      { rows: [{ result: { kind: "released", request: released } }] },
      { rows: [{ result: { kind: "stale" } }] },
    );
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );
    const identity = { requestId: ids.request, claimToken: ids.token };

    await expect(repo.complete(scope, identity)).resolves.toMatchObject({
      kind: "completed",
      request: { id: ids.request, completedAt: completed.completed_at },
    });
    await expect(repo.complete(scope, identity)).resolves.toEqual({
      kind: "stale",
    });
    await expect(repo.release(scope, {
      ...identity,
      errorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    })).resolves.toMatchObject({
      kind: "released",
      request: {
        id: ids.request,
        claimToken: null,
        lastErrorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
      },
    });
    await expect(repo.release(scope, {
      ...identity,
      errorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    })).resolves.toEqual({ kind: "stale" });
    expect(query(fake.calls[0]!).params).toEqual([
      ids.workspace,
      ids.project,
      ids.request,
      ids.token,
    ]);
    expect(query(fake.calls[2]!).params).toEqual([
      ids.workspace,
      ids.project,
      ids.request,
      ids.token,
      KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    ]);
  });

  it("rejects malformed scope, sources, lease bounds, limits, tokens, and error codes before SQL", async () => {
    const fake = fakeExecutor();
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );
    await expect(repo.insertRequest(scope, {
      sourceKind: "unknown" as never,
      sourceRef: "refresh-1",
      initiatedBy: ids.actor,
    })).rejects.toThrow(/sourceKind/u);
    await expect(repo.insertRequest(scope, {
      sourceKind: "analysis_refresh",
      sourceRef: " x ",
      initiatedBy: ids.actor,
    })).rejects.toThrow(/sourceRef/u);
    await expect(repo.claimDue({ limit: 101, leaseSeconds: 60 }))
      .rejects.toThrow(/limit/u);
    await expect(repo.claimDue({ limit: 1, leaseSeconds: 4 }))
      .rejects.toThrow(/leaseSeconds/u);
    await expect(repo.complete(scope, {
      requestId: ids.request,
      claimToken: "not-a-token",
    })).rejects.toThrow(/claimToken/u);
    await expect(repo.release(scope, {
      requestId: ids.request,
      claimToken: ids.token,
      errorCode: "raw provider failure" as never,
    })).rejects.toThrow(/errorCode/u);
    expect(fake.calls).toEqual([]);
  });

  it("fails closed on malformed database rows and impossible claim shapes", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      { rows: [{ result: { kind: "inserted", request: { ...dbRow, source_kind: "other" } } }] },
      { rows: [{ result: [{ ...claimedDbRow, claim_token: null }] }] },
    );
    const repo = new KeywordGovernanceScheduleRequestsRepository(
      fake.executor,
    );
    await expect(repo.insertRequest(scope, {
      sourceKind: "analysis_refresh",
      sourceRef: "refresh-1",
      initiatedBy: ids.actor,
    })).rejects.toThrow(/invalid Keyword governance schedule request/u);
    await expect(repo.claimDue({ limit: 1, leaseSeconds: 60 }))
      .rejects.toThrow(/invalid claimed Keyword governance schedule request/u);
  });
});
