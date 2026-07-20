import { describe, expect, it, vi } from "vitest";
import type { DbTx } from "./client.ts";
import {
  COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
  createBoss,
  enqueueRunInTx,
  PgBoss,
  QUEUE_CONFIG,
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
      heartbeatSeconds: 60,
    });
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
});
