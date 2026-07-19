import { describe, expect, it, vi } from "vitest";

import {
  acquireWorkerReadinessLease,
  checkWorkerReadiness,
  type WorkerReadinessPool,
} from "../worker-readiness.ts";

type FakeResult = {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
};

interface FakeClient {
  readonly query: ReturnType<
    typeof vi.fn<(sql: string, values?: unknown[]) => Promise<FakeResult>>
  >;
  readonly release: ReturnType<
    typeof vi.fn<(error?: Error | boolean) => void>
  >;
}

function fakePool(results: ReadonlyArray<FakeResult>): {
  readonly pool: WorkerReadinessPool;
  readonly client: FakeClient;
} {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<FakeResult>
  >();
  for (const result of results) query.mockResolvedValueOnce(result);
  const client = {
    query,
    release: vi.fn<(error?: Error | boolean) => void>(),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
  };
}

describe("worker readiness advisory lease", () => {
  it("keeps a dedicated session until the worker releases its shared lease", async () => {
    const { pool, client } = fakePool([
      { rows: [{ acquired: true }] },
      { rows: [{ released: true }] },
    ]);

    const lease = await acquireWorkerReadinessLease(pool);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0]?.[0])).toContain(
      "pg_try_advisory_lock_shared",
    );
    expect(client.release).not.toHaveBeenCalled();

    await lease.release();
    await lease.release();

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[1]?.[0])).toContain(
      "pg_advisory_unlock_shared",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("fails worker boot when the shared readiness lease cannot be acquired", async () => {
    const { pool, client } = fakePool([{ rows: [{ acquired: false }] }]);

    await expect(acquireWorkerReadinessLease(pool)).rejects.toThrow(
      "worker readiness lease",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("reports ready when an exclusive probe is blocked by a worker shared lease", async () => {
    const { pool, client } = fakePool([{ rows: [{ acquired: false }] }]);

    await expect(checkWorkerReadiness(pool)).resolves.toBe(true);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0]?.[0])).toContain(
      "pg_try_advisory_lock",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("reports not ready and immediately unlocks when no worker owns a lease", async () => {
    const { pool, client } = fakePool([
      { rows: [{ acquired: true }] },
      { rows: [{ released: true }] },
    ]);

    await expect(checkWorkerReadiness(pool)).resolves.toBe(false);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[1]?.[0])).toContain(
      "pg_advisory_unlock",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
