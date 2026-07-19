import { randomUUID } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { contentHash } from "@sf/db";
import type { Db } from "@sf/db/client";
import { idempotencyKeys } from "@sf/db/schema";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

const RATE_LIMIT_SCOPE_PREFIX = "rate_limit";

export interface RateLimitPolicy {
  readonly idempotencyKey: string;
  readonly scope: string;
  readonly maxAttempts: number;
  readonly windowMs: number;
}

export type AttemptRateLimitPolicy = Omit<RateLimitPolicy, "idempotencyKey">;

function rateLimitScope(scope: string): string {
  return `${RATE_LIMIT_SCOPE_PREFIX}:${scope}`;
}

function advisoryKey(workspaceId: string, scope: string): string {
  return `${RATE_LIMIT_SCOPE_PREFIX}:${workspaceId}:${scope}`;
}

/**
 * Shared Postgres-backed rate limiting for expensive authenticated mutations.
 * A transaction-level advisory lock serializes the check+insert per workspace/scope,
 * while `app.idempotency_keys` provides the durable sliding-window ledger without
 * changing the frozen 28-table application schema.
 */
export async function assertWorkspaceRateLimit(
  workspaceId: string,
  policy: RateLimitPolicy,
): Promise<void> {
  return assertWorkspaceRateLimitWithDb(getDb().db, workspaceId, policy);
}

/**
 * Count a non-idempotent expensive mutation. The key is minted server-side so
 * callers cannot replay a client-controlled correlation id to evade the limit.
 */
export async function assertWorkspaceAttemptRateLimit(
  workspaceId: string,
  policy: AttemptRateLimitPolicy,
): Promise<void> {
  return assertWorkspaceRateLimit(workspaceId, {
    ...policy,
    idempotencyKey: randomUUID(),
  });
}

/** Database-injected form used by integration tests and non-HTTP callers. */
export async function assertWorkspaceRateLimitWithDb(
  db: Db,
  workspaceId: string,
  policy: RateLimitPolicy,
): Promise<void> {
  const scope = rateLimitScope(policy.scope);
  const attemptKey = contentHash({ idempotencyKey: policy.idempotencyKey });

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${advisoryKey(workspaceId, scope)}, 0))`,
    );

    // Use one authoritative database clock after acquiring the lock. Capturing
    // time before waiting can make a later-created ledger row appear to be in
    // the future and produce Retry-After values longer than the policy window.
    // Explicit created_at also keeps every process on the same clock source.
    const clock = await tx.execute<{ now: Date | string }>(
      sql`select clock_timestamp() as now`,
    );
    const rawNow = clock.rows[0]?.now;
    const now = rawNow instanceof Date ? rawNow : new Date(rawNow ?? "");
    if (Number.isNaN(now.getTime())) {
      throw new Error("PostgreSQL did not return a valid rate-limit clock.");
    }
    const startedAt = now.toISOString();
    const windowStart = new Date(now.getTime() - policy.windowMs);
    const expiresAt = new Date(now.getTime() + policy.windowMs).toISOString();

    // This table also stores product idempotency responses. Delete ONLY expired
    // rows in this dedicated rate-limit scope so the ledger stays bounded and a
    // caller may reuse an old key after the window has elapsed.
    await tx
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, scope),
          lte(idempotencyKeys.expires_at, startedAt),
        ),
      );

    // Exact retries must still reach the domain idempotency service, which will
    // replay the original response or reject a same-key/different-request reuse.
    // Counting the same key again would make rate limiting break that contract.
    const existingAttempt = await tx
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotency_key, attemptKey),
        ),
      )
      .limit(1);
    if (existingAttempt[0]) return;

    const rows = await tx
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${idempotencyKeys.created_at})::text`,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, scope),
          gte(idempotencyKeys.created_at, windowStart.toISOString()),
        ),
      );
    const currentCount = rows[0]?.count ?? 0;
    if (currentCount >= policy.maxAttempts) {
      const oldest = rows[0]?.oldest ? new Date(rows[0].oldest) : now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest.getTime() + policy.windowMs - now.getTime()) / 1000),
      );
      throw new ProblemError("RATE_LIMITED", "Too many requests. Try again later.", {
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }

    await tx.insert(idempotencyKeys).values({
      workspace_id: workspaceId,
      scope,
      idempotency_key: attemptKey,
      request_hash: contentHash({ scope, startedAt, attemptKey }),
      status: "completed",
      response_status: 202,
      response_body: { acceptedAt: startedAt, rateLimit: true },
      expires_at: expiresAt,
      created_at: startedAt,
      updated_at: startedAt,
    });
  });
}
