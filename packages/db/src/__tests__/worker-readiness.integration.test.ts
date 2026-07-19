import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import {
  acquireWorkerReadinessLease,
  checkWorkerReadiness,
  type WorkerReadinessLease,
} from "../worker-readiness.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("worker readiness lease", () => {
  let worker: DbHandle;
  let web: DbHandle;
  let lease: WorkerReadinessLease | undefined;

  beforeAll(() => {
    worker = createDbHandle(DATABASE_URL!, 1);
    web = createDbHandle(DATABASE_URL!, 1);
  });

  afterAll(async () => {
    await lease?.release().catch(() => undefined);
    await worker?.end();
    await web?.end();
  });

  it("changes readiness with the lifetime of a real worker database session", async () => {
    await expect(checkWorkerReadiness(web.pool)).resolves.toBe(false);

    lease = await acquireWorkerReadinessLease(worker.pool);
    await expect(checkWorkerReadiness(web.pool)).resolves.toBe(true);

    await lease.release();
    lease = undefined;
    await expect(checkWorkerReadiness(web.pool)).resolves.toBe(false);
  });
});
