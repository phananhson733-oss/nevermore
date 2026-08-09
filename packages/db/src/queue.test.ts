import { describe, expect, it, vi } from "vitest";
import type { DbTx } from "./client.ts";
import {
  COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
  createBoss,
  enqueueAnalysisRefreshContinuationInTx,
  enqueueRunInTx,
  PgBoss,
  QUEUE_CONFIG,
  TRANSIENT_RETRY_DELAY_SECONDS,
  QUEUE_NAMES,
  startBoss,
  type RunJobPayload,
} from "./queue.ts";

const PAYLOAD: RunJobPayload = {
  runId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  contractVersion: "2026-07-18",
};

describe("pg-boss queue contract", () => {
  it("keeps the frozen crawl job window at fifteen minutes", () => {
    expect(COLLECT_CRAWL_JOB_EXPIRY_SECONDS).toBe(15 * 60);
    expect(QUEUE_CONFIG["collect.crawl"].expireInSeconds).toBe(
      COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
    );
  });

  it("gives DataForSEO the bounded vendor retry policy", () => {
    expect(QUEUE_NAMES).toContain("collect.dataforseo");
    expect(QUEUE_CONFIG["collect.dataforseo"]).toEqual({
      expireInSeconds: 600,
      retryLimit: 3,
      retryBackoff: true,
      retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
      heartbeatSeconds: 60,
    });
  });

  it("gives Product Profile synthesis a conservative five-minute window", () => {
    expect(QUEUE_NAMES).toContain("profile.synthesize");
    expect(QUEUE_CONFIG["profile.synthesize"]).toEqual({
      expireInSeconds: 300,
      retryLimit: 2,
      retryBackoff: true,
      retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
      heartbeatSeconds: 60,
    });
  });

  it("registers Topic Model generation as a bounded internal model queue", () => {
    expect(QUEUE_NAMES).toContain("topic-model.generate");
    expect(QUEUE_CONFIG["topic-model.generate"]).toEqual({
      expireInSeconds: 300,
      retryLimit: 2,
      retryBackoff: true,
      retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
      heartbeatSeconds: 60,
    });
  });

  it("gives publication a bounded non-replaying external-write window", () => {
    expect(QUEUE_NAMES).toContain("publication");
    expect(QUEUE_CONFIG.publication).toEqual({
      expireInSeconds: 600,
      retryLimit: 0,
      retryBackoff: false,
      retryDelay: 0,
      heartbeatSeconds: 60,
    });
  });

  it("registers measurement as a bounded retryable read-only queue", () => {
    expect(QUEUE_NAMES).toContain("measurement");
    expect(QUEUE_CONFIG.measurement).toEqual({
      expireInSeconds: 600,
      retryLimit: 3,
      retryBackoff: true,
      retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
      heartbeatSeconds: 60,
    });
  });

  it("registers the durable Analysis Refresh orchestration queue", () => {
    expect(QUEUE_NAMES).toContain("refresh.analysis");
    expect(QUEUE_CONFIG["refresh.analysis"]).toEqual({
      expireInSeconds: 15 * 60,
      retryLimit: 2,
      retryBackoff: true,
      retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
      heartbeatSeconds: 60,
    });
  });

  it("gives every retryable queue a backoff long enough to outlast a transient dependency outage", () => {
    // pg-boss defaults retryDelay to 1s when retryBackoff is on, which yields a
    // ~3-6s total window across two retries. A saturated connection pooler or a
    // rate-limited provider is still down at that point, so every attempt burns
    // against the same outage and the run fails as if it had never retried.
    expect(TRANSIENT_RETRY_DELAY_SECONDS).toBeGreaterThanOrEqual(30);

    for (const name of QUEUE_NAMES) {
      const cfg = QUEUE_CONFIG[name];
      if (cfg.retryLimit === 0) continue;
      expect(cfg.retryBackoff).toBe(true);
      expect(cfg.retryDelay).toBe(TRANSIENT_RETRY_DELAY_SECONDS);
    }
  });

  it("constructs normal and enqueue-only clients without opening connections", () => {
    expect(createBoss("postgres://user@localhost/db")).toBeInstanceOf(PgBoss);
    expect(
      createBoss("postgres://user@localhost/db", {
        max: 2,
        enqueueOnly: true,
      }),
    ).toBeInstanceOf(PgBoss);
  });

  it("creates and updates every queue with heartbeat and retry policy", async () => {
    const start = vi.fn(async () => undefined);
    const createQueue = vi.fn(async () => undefined);
    const updateQueue = vi.fn(async () => undefined);
    const boss = { start, createQueue, updateQueue } as unknown as PgBoss;

    await startBoss(boss);

    expect(start).toHaveBeenCalledTimes(1);
    expect(createQueue).toHaveBeenCalledTimes(QUEUE_NAMES.length);
    expect(updateQueue).toHaveBeenCalledTimes(QUEUE_NAMES.length);
    for (const name of QUEUE_NAMES) {
      expect(createQueue).toHaveBeenCalledWith(name, QUEUE_CONFIG[name]);
      expect(updateQueue).toHaveBeenCalledWith(name, QUEUE_CONFIG[name]);
      expect(QUEUE_CONFIG[name].heartbeatSeconds).toBeGreaterThanOrEqual(10);
    }
  });

  it("uses the canonical run id and rejects a null pg-boss result", async () => {
    const send = vi.fn(async () => PAYLOAD.runId as string | null);
    const boss = { send } as unknown as PgBoss;
    const tx = {} as DbTx;

    await expect(
      enqueueRunInTx(boss, tx, "diagnose", PAYLOAD),
    ).resolves.toBe(PAYLOAD.runId);
    expect(send).toHaveBeenCalledWith(
      "diagnose",
      PAYLOAD,
      expect.objectContaining({
        id: PAYLOAD.runId,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );

    send.mockResolvedValueOnce(null);
    await expect(
      enqueueRunInTx(boss, tx, "diagnose", PAYLOAD),
    ).rejects.toThrow(/explicit run job id/i);
  });

  it("places a measurement job after its absolute settlement timestamp in the same transaction", async () => {
    const send = vi.fn(async () => PAYLOAD.runId as string | null);
    const boss = { send } as unknown as PgBoss;
    const tx = {} as DbTx;
    const startAfter = new Date("2026-08-19T00:00:00.000Z");

    await expect(
      enqueueRunInTx(boss, tx, "measurement", PAYLOAD, { startAfter }),
    ).resolves.toBe(PAYLOAD.runId);
    expect(send).toHaveBeenCalledWith(
      "measurement",
      PAYLOAD,
      expect.objectContaining({
        id: PAYLOAD.runId,
        startAfter,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
  });

  it("mints a distinct transactional job for an Analysis Refresh continuation", async () => {
    const continuationId =
      "00000000-0000-4000-8000-000000000099";
    const send = vi.fn(async () => continuationId as string | null);
    const boss = { send } as unknown as PgBoss;
    const tx = {} as DbTx;
    const startAfter = new Date("2026-08-19T00:00:00.000Z");

    await expect(
      enqueueAnalysisRefreshContinuationInTx(
        boss,
        tx,
        PAYLOAD,
        { startAfter },
      ),
    ).resolves.toBe(continuationId);
    expect(send).toHaveBeenCalledWith(
      "refresh.analysis",
      PAYLOAD,
      expect.objectContaining({
        startAfter,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
    const sendOptions = (send.mock.calls[0] as unknown[] | undefined)?.[2];
    expect(sendOptions).not.toHaveProperty("id");
  });

  it("fails closed when an Analysis Refresh continuation is null or reuses the parent id", async () => {
    const send = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(PAYLOAD.runId);
    const boss = { send } as unknown as PgBoss;

    await expect(
      enqueueAnalysisRefreshContinuationInTx(
        boss,
        {} as DbTx,
        PAYLOAD,
      ),
    ).rejects.toThrow(/rejected.*continuation/i);
    await expect(
      enqueueAnalysisRefreshContinuationInTx(
        boss,
        {} as DbTx,
        PAYLOAD,
      ),
    ).rejects.toThrow(/reused.*run id/i);
  });

  it("rejects a relative or invalid Analysis Refresh continuation schedule", async () => {
    const send = vi.fn();
    const boss = { send } as unknown as PgBoss;

    for (const startAfter of [
      new Date(Number.NaN),
      "5 seconds",
      5_000,
    ]) {
      await expect(
        enqueueAnalysisRefreshContinuationInTx(
          boss,
          {} as DbTx,
          PAYLOAD,
          { startAfter } as never,
        ),
      ).rejects.toThrow(/valid absolute Date/i);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    new Date(Number.NaN),
    "2026-08-19T00:00:00Z",
    60,
  ])("rejects a non-Date delayed enqueue value %s", async (startAfter) => {
    const send = vi.fn();
    const boss = { send } as unknown as PgBoss;

    await expect(
      enqueueRunInTx(
        boss,
        {} as DbTx,
        "measurement",
        PAYLOAD,
        { startAfter } as never,
      ),
    ).rejects.toThrow(/startAfter/i);
    expect(send).not.toHaveBeenCalled();
  });
});
