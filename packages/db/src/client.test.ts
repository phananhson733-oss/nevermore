import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDbHandle,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DB_LOCK_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  getDbPoolStats,
  installSlowQueryInstrumentation,
} from "./client.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDbHandle runtime boundaries", () => {
  it("projects pool saturation counters without connection metadata", () => {
    const pool = {
      options: { max: 4, connectionString: "customer-secret" },
      totalCount: 4,
      idleCount: 1,
      waitingCount: 2,
    } as unknown as Parameters<typeof getDbPoolStats>[0];

    expect(getDbPoolStats(pool)).toEqual({
      max: 4,
      total: 4,
      idle: 1,
      active: 3,
      waiting: 2,
      saturationRatio: 0.75,
    });
    expect(JSON.stringify(getDbPoolStats(pool))).not.toContain(
      "customer-secret",
    );
  });

  it("emits slow-query duration only, never SQL text, values, or errors", async () => {
    const original = vi.fn(() => Promise.resolve({ rows: [] }));
    const pool = { query: original } as unknown as Parameters<
      typeof installSlowQueryInstrumentation
    >[0];
    const events: unknown[] = [];
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35.125);

    installSlowQueryInstrumentation(pool, {
      slowQueryThresholdMs: 20,
      onSlowQuery: (event) => events.push(event),
    });

    await pool.query("SELECT customer_secret FROM tenant", ["token-value"]);

    expect(original).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ durationMs: 25.13 }]);
    expect(JSON.stringify(events)).not.toContain("customer_secret");
    expect(JSON.stringify(events)).not.toContain("token-value");
  });

  it("preserves callback-style query semantics when instrumentation observes it", async () => {
    const original = vi.fn(
      (
        _text: unknown,
        callback: (error: null, result: { readonly rowCount: number }) => void,
      ) => {
        callback(null, { rowCount: 1 });
      },
    );
    const pool = { query: original } as unknown as Parameters<
      typeof installSlowQueryInstrumentation
    >[0];
    const events: unknown[] = [];
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(15);
    installSlowQueryInstrumentation(pool, {
      slowQueryThresholdMs: 0,
      onSlowQuery: (event) => events.push(event),
    });

    const result = await new Promise<{ readonly rowCount: number | null }>(
      (resolve, reject) => {
        pool.query("SELECT 1", (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      },
    );

    expect(result).toEqual({ rowCount: 1 });
    expect(events).toEqual([{ durationMs: 10 }]);
  });

  it("sets finite checkout, lock, statement, and idle-transaction timeouts", async () => {
    const handle = createDbHandle(
      "postgresql://unused:unused@127.0.0.1:5432/unused",
      1,
    );

    try {
      const options = (
        handle.pool as unknown as {
          readonly options: {
            readonly connectionTimeoutMillis?: number;
            readonly lock_timeout?: number;
            readonly statement_timeout?: number;
            readonly idle_in_transaction_session_timeout?: number;
          };
        }
      ).options;

      expect(options.connectionTimeoutMillis).toBeTypeOf("number");
      expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(options.connectionTimeoutMillis).toBeLessThanOrEqual(30_000);
      expect(options.lock_timeout).toBe(DB_LOCK_TIMEOUT_MS);
      expect(options.statement_timeout).toBe(DB_STATEMENT_TIMEOUT_MS);
      expect(options.idle_in_transaction_session_timeout).toBe(
        DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      );
      expect(options.lock_timeout).toBeLessThan(24 * 60 * 60 * 1_000);
      expect(options.statement_timeout).toBeLessThan(
        24 * 60 * 60 * 1_000,
      );
      expect(options.idle_in_transaction_session_timeout).toBeLessThan(
        24 * 60 * 60 * 1_000,
      );
    } finally {
      await handle.end();
    }
  });

  it("handles pool error events immediately without inspecting the thrown value", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const handle = createDbHandle(
      "postgresql://unused:unused@127.0.0.1:5432/unused",
      1,
    );
    let prototypeReads = 0;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          prototypeReads += 1;
          throw new Error("hostile-pool-error-marker");
        },
      },
    );

    try {
      const emitter = handle.pool as unknown as {
        emit(event: string, value: unknown): boolean;
        listenerCount(event: string): number;
      };

      expect(emitter.listenerCount("error")).toBeGreaterThan(0);
      expect(() => emitter.emit("error", hostile)).not.toThrow();
      expect(prototypeReads).toBe(0);

      const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
      expect(logged).toContain('"event":"db_pool_error"');
      expect(logged).toContain('"code":"DB_POOL_ERROR"');
      expect(logged).not.toContain("hostile-pool-error-marker");
    } finally {
      await handle.end();
    }
  });
});
