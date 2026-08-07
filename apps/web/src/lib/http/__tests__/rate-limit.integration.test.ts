import { randomUUID } from "node:crypto";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { idempotencyKeys, workspaces } from "@sf/db/schema";
import { ProblemError } from "@sf/observability";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSafeTestDatabaseUrl } from "../../../../../../packages/db/src/test-database-safety.ts";
import { assertWorkspaceRateLimitWithDb } from "../rate-limit.ts";

const databaseUrl = process.env["DATABASE_URL"];
const safeDatabaseUrl = databaseUrl
  ? requireSafeTestDatabaseUrl(databaseUrl)
  : undefined;
const describeDb = safeDatabaseUrl ? describe : describe.skip;

describeDb("workspace rate limiting against PostgreSQL", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const scope = `integration-${randomUUID()}`;

  beforeAll(async () => {
    handle = createDbHandle(safeDatabaseUrl!);
    const rows = await handle.db
      .insert(workspaces)
      .values([
        { name: `Rate limit ${randomUUID()}`, plan_tier: "internal" },
        { name: `Rate limit isolated ${randomUUID()}`, plan_tier: "internal" },
      ])
      .returning({ id: workspaces.id });
    workspaceId = rows[0]!.id;
    otherWorkspaceId = rows[1]!.id;
  });

  afterAll(async () => {
    if (!handle) return;
    const ids = [workspaceId, otherWorkspaceId].filter(Boolean);
    if (ids.length > 0) {
      await handle.db
        .delete(idempotencyKeys)
        .where(inArray(idempotencyKeys.workspace_id, ids));
      await handle.db.delete(workspaces).where(inArray(workspaces.id, ids));
    }
    await handle.end();
  });

  it("serializes concurrent attempts, preserves exact replay, and isolates workspaces", async () => {
    const keys = [
      "concurrent-a",
      "concurrent-b",
      "concurrent-c",
      "concurrent-d",
    ];
    const policyFor = (idempotencyKey: string) => ({
      idempotencyKey,
      scope,
      maxAttempts: 2,
      windowMs: 60_000,
    });

    const results = await Promise.allSettled(
      keys.map((key) =>
        assertWorkspaceRateLimitWithDb(handle.db, workspaceId, policyFor(key)),
      ),
    );
    const acceptedKeys = keys.filter(
      (_key, index) => results[index]?.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(acceptedKeys).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ProblemError);
      expect(result.reason).toMatchObject({
        code: "RATE_LIMITED",
        status: 429,
        extraHeaders: {
          "Retry-After": expect.stringMatching(/^([1-9]|[1-5][0-9]|60)$/),
        },
      });
    }

    // An exact transport retry must reach domain idempotency even while the
    // workspace/scope window is otherwise full.
    await expect(
      assertWorkspaceRateLimitWithDb(
        handle.db,
        workspaceId,
        policyFor(acceptedKeys[0]!),
      ),
    ).resolves.toBeUndefined();

    // The same route policy is independently budgeted per workspace.
    await expect(
      assertWorkspaceRateLimitWithDb(
        handle.db,
        otherWorkspaceId,
        policyFor("other-workspace"),
      ),
    ).resolves.toBeUndefined();

    const stored = await handle.db
      .select({
        workspaceId: idempotencyKeys.workspace_id,
        key: idempotencyKeys.idempotency_key,
      })
      .from(idempotencyKeys)
      .where(
        and(
          inArray(idempotencyKeys.workspace_id, [
            workspaceId,
            otherWorkspaceId,
          ]),
          eq(idempotencyKeys.scope, `rate_limit:${scope}`),
        ),
      );

    expect(
      stored.filter((row) => row.workspaceId === workspaceId),
    ).toHaveLength(2);
    expect(
      stored.filter((row) => row.workspaceId === otherWorkspaceId),
    ).toHaveLength(1);
    expect(stored.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
    for (const rawKey of [...keys, "other-workspace"]) {
      expect(stored.some((row) => row.key.includes(rawKey))).toBe(false);
    }
  });
});
