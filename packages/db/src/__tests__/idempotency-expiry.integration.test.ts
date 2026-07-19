import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { IdempotencyRepository } from "../repositories/idempotency.ts";
import { idempotencyKeys, workspaces } from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb("idempotency expiry", () => {
  let handle: DbHandle;
  let workspaceId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Idempotency expiry ${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function expireRow(id: string, timestamp = "2000-01-01T00:00:00.000Z") {
    await handle.db
      .update(idempotencyKeys)
      .set({ expires_at: timestamp })
      .where(eq(idempotencyKeys.id, id));
  }

  async function rawRow(id: string) {
    const rows = await handle.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function waitForBlockedPrune(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await handle.pool.query<{ blocked: boolean }>(`
        select exists (
          select 1
            from pg_stat_activity
           where pid <> pg_backend_pid()
             and datname = current_database()
             and state = 'active'
             and wait_event_type = 'Lock'
             and query ilike '%delete from "app"."idempotency_keys"%'
        ) as blocked
      `);
      if (result.rows[0]?.blocked) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("prune DELETE did not reach the expected row-lock wait");
  }

  it("treats an expired completed key as absent and atomically reuses it", async () => {
    const repo = new IdempotencyRepository(handle.db);
    const scope = `expiry-${randomUUID()}`;
    const key = randomUUID();
    const original = await repo.begin({
      workspaceId,
      scope,
      key,
      requestHash: hash("old"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(original).not.toBeNull();
    await repo.complete(original!.id, {
      responseStatus: 201,
      responseBody: { stale: true },
      resourceType: "project",
      resourceId: randomUUID(),
    });

    await expireRow(original!.id);

    await expect(repo.find(workspaceId, scope, key)).resolves.toBeNull();

    const replacement = await repo.begin({
      workspaceId,
      scope,
      key,
      requestHash: hash("new"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(replacement).toMatchObject({
      id: original!.id,
      request_hash: hash("new"),
      status: "in_progress",
      response_status: null,
      response_body: null,
      resource_type: null,
      resource_id: null,
    });
    await expect(repo.find(workspaceId, scope, key)).resolves.toMatchObject({
      request_hash: hash("new"),
      status: "in_progress",
    });

    await expect(
      repo.begin({
        workspaceId,
        scope,
        key,
        requestHash: hash("third"),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toBeNull();
  });

  it("allows exactly one concurrent caller to replace an expired key", async () => {
    const repo = new IdempotencyRepository(handle.db);
    const scope = `concurrent-${randomUUID()}`;
    const key = randomUUID();
    const expired = await repo.begin({
      workspaceId,
      scope,
      key,
      requestHash: hash("seed"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(expired).not.toBeNull();
    await expireRow(expired!.id);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const contenders = await Promise.all(
      ["winner-a", "winner-b"].map((body) =>
        new IdempotencyRepository(handle.db).begin({
          workspaceId,
          scope,
          key,
          requestHash: hash(body),
          expiresAt,
        }),
      ),
    );

    expect(contenders.filter((row) => row !== null)).toHaveLength(1);
    const stored = await repo.find(workspaceId, scope, key);
    expect(stored?.request_hash).toBe(
      contenders.find((row) => row !== null)!.request_hash,
    );
  });

  it("physically prunes the selected expired row and preserves a live row", async () => {
    const repo = new IdempotencyRepository(handle.db);
    const scope = `prune-${randomUUID()}`;
    const expiredKey = randomUUID();
    const liveKey = randomUUID();
    const expired = await repo.begin({
      workspaceId,
      scope,
      key: expiredKey,
      requestHash: hash("expired"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const live = await repo.begin({
      workspaceId,
      scope,
      key: liveKey,
      requestHash: hash("live"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(expired).not.toBeNull();
    expect(live).not.toBeNull();
    await expireRow(expired!.id);

    await repo.pruneExpired(10_000);
    await expect(rawRow(expired!.id)).resolves.toBeNull();
    await expect(rawRow(live!.id)).resolves.toMatchObject({
      request_hash: hash("live"),
    });
  });

  it("does not delete a candidate refreshed while prune waits on its row lock", async () => {
    const repo = new IdempotencyRepository(handle.db);
    const scope = `prune-race-${randomUUID()}`;
    const key = randomUUID();
    const seed = await repo.begin({
      workspaceId,
      scope,
      key,
      requestHash: hash("stale"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(seed).not.toBeNull();
    await expireRow(seed!.id);

    const refreshed = deferred();
    const releaseRefreshCommit = deferred();
    const freshHash = hash("fresh");
    const refresh = handle.db.transaction(async (tx) => {
      const row = await new IdempotencyRepository(tx).begin({
        workspaceId,
        scope,
        key,
        requestHash: freshHash,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
      expect(row).not.toBeNull();
      refreshed.resolve();
      await releaseRefreshCommit.promise;
    });

    await refreshed.promise;
    const prune = repo.pruneExpired(10_000);
    await waitForBlockedPrune();
    releaseRefreshCommit.resolve();
    await Promise.all([refresh, prune]);

    await expect(rawRow(seed!.id)).resolves.toMatchObject({
      request_hash: freshHash,
      status: "in_progress",
    });
  });
});
