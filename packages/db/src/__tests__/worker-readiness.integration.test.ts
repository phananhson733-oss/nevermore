import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import {
  acquireWorkerReadinessLease,
  checkWorkerReadiness,
  type WorkerReadinessLease,
} from "../worker-readiness.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const itPosix = process.platform === "win32" ? it.skip : it;
const CHILD_READY_TIMEOUT_MS = 25_000;

function waitForChildReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("readiness child did not start before its deadline"));
    }, CHILD_READY_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout?.removeListener("data", onData);
      child.removeListener("exit", onExit);
    };
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      const errorPrefix = "worker-readiness-error:";
      const errorAt = output.indexOf(errorPrefix);
      if (errorAt >= 0) {
        const code =
          output.slice(errorAt + errorPrefix.length).split("\n")[0] ??
          "UNKNOWN";
        cleanup();
        reject(
          new Error(`readiness child failed before acquiring its lease (${code})`),
        );
        return;
      }
      if (!output.includes("worker-readiness-ready\n")) return;
      cleanup();
      resolve();
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error("readiness child exited before acquiring its lease"));
    };

    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function stopOwnedChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGCONT");
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(3_000).then(() => false),
  ]);
  if (exited || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function waitUntilNotReady(db: DbHandle): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await checkWorkerReadiness(db.pool))) return;
    await delay(50);
  }
  throw new Error("worker readiness lock outlived its idle-session TTL");
}

async function waitUntilDedicatedSessionIsDestroyed(db: DbHandle): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (db.pool.totalCount === 0) return;
    await delay(10);
  }
  throw new Error("worker readiness dedicated session was returned to the pool");
}

describeDb("worker readiness lease", () => {
  let worker: DbHandle;
  let web: DbHandle;
  let lease: WorkerReadinessLease | undefined;
  let readinessChild: ChildProcess | undefined;

  beforeAll(() => {
    worker = createDbHandle(DATABASE_URL!, 1);
    web = createDbHandle(DATABASE_URL!, 1);
  });

  afterAll(async () => {
    await stopOwnedChild(readinessChild);
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

    // The session-level idle_session_timeout must never leak to a later pool
    // borrower. The dedicated lease connection is destroyed after unlock.
    await waitUntilDedicatedSessionIsDestroyed(worker);
    const nextClient = await worker.pool.connect();
    try {
      const setting = await nextClient.query<{ idle_session_timeout: string }>(
        "SHOW idle_session_timeout",
      );
      expect(setting.rows[0]?.idle_session_timeout).toBe("0");
    } finally {
      nextClient.release();
    }
  });

  itPosix(
    "keeps the lease alive with heartbeats, then PostgreSQL expires it after SIGSTOP exceeds the TTL",
    async () => {
      const childSource = `
        import { createDbHandle } from ${JSON.stringify(new URL("../client.ts", import.meta.url).href)};
        import { acquireWorkerReadinessLease, WorkerReadinessError } from ${JSON.stringify(new URL("../worker-readiness.ts", import.meta.url).href)};

        const db = createDbHandle(process.env.DATABASE_URL, 1);
        const keepAlive = setInterval(() => {}, 1_000);
        try {
          const lease = await acquireWorkerReadinessLease(db.pool, {
            idleSessionTimeoutMs: 700,
            heartbeatIntervalMs: 100,
          });
          process.stdout.write("worker-readiness-ready\\n");
          process.once("SIGTERM", () => {
            void lease.release()
              .catch(() => undefined)
              .then(() => db.end().catch(() => undefined))
              .then(() => {
                clearInterval(keepAlive);
                process.exitCode = 0;
              });
          });
        } catch (error) {
          const code = error instanceof WorkerReadinessError
            ? error.code
            : "UNKNOWN";
          process.stdout.write("worker-readiness-error:" + code + "\\n");
          clearInterval(keepAlive);
          await db.end().catch(() => undefined);
          process.exitCode = 1;
        }
      `;

      readinessChild = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", childSource],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: DATABASE_URL!,
            NODE_ENV: "test",
          },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      await waitForChildReady(readinessChild);

      await expect(checkWorkerReadiness(web.pool)).resolves.toBe(true);
      await delay(1_000);
      await expect(checkWorkerReadiness(web.pool)).resolves.toBe(true);

      expect(readinessChild.kill("SIGSTOP")).toBe(true);
      await waitUntilNotReady(web);
      await expect(checkWorkerReadiness(web.pool)).resolves.toBe(false);
    },
    40_000,
  );
});
