import type { DbHandle } from "@sf/db/client";
import { ProjectsRepository } from "@sf/db";
import { vi } from "vitest";

const WAIT_TIMEOUT_MS = 2_000;

export async function waitForLockAttempt(attempted: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      attempted,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("service did not attempt the project row lock")),
          WAIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function waitUntilBlockedBy(
  handle: DbHandle,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await handle.pool.query<{ blocked: boolean }>(
      `select exists (
         select 1
           from pg_stat_activity
          where $1::int = any(pg_blocking_pids(pid))
       ) as blocked`,
      [blockerPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("service transaction did not block on the project row");
}

/** Commit an archive while a service transaction is waiting on the project row. */
export async function archiveWinsProjectRace<T>(
  handle: DbHandle,
  projectId: string,
  mutate: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  const blocker = await handle.pool.connect();
  const original = ProjectsRepository.prototype.findByIdForUpdate;
  let signalAttempt!: () => void;
  const attempted = new Promise<void>((resolve) => {
    signalAttempt = resolve;
  });
  const lockSpy = vi
    .spyOn(ProjectsRepository.prototype, "findByIdForUpdate")
    .mockImplementation(async function (
      this: ProjectsRepository,
      scope,
      id,
    ) {
      if (id === projectId) signalAttempt();
      return original.call(this, scope, id);
    });
  let mutation: Promise<T> | undefined;

  try {
    await blocker.query("begin");
    const pid = await blocker.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    await blocker.query(
      `update app.client_projects
          set archived_at = now(), updated_at = now()
        where id = $1`,
      [projectId],
    );

    mutation = mutate();
    await waitForLockAttempt(attempted);
    await waitUntilBlockedBy(handle, pid.rows[0]!.pid);
    await blocker.query("commit");
    return (await Promise.allSettled([mutation]))[0]!;
  } catch (error) {
    await blocker.query("rollback").catch(() => undefined);
    if (mutation) await Promise.allSettled([mutation]);
    throw error;
  } finally {
    lockSpy.mockRestore();
    blocker.release();
  }
}
