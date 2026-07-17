import { and, eq } from "drizzle-orm";
import { idempotencyKeys } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * Idempotency store for resource-creating POSTs (spec §11.1). Uniqueness is
 * `(workspace_id, scope, idempotency_key)`. Same key + same request hash replays
 * the stored response; same key + a different hash is a reuse conflict (409
 * IDEMPOTENCY_KEY_REUSED). The row is written in the SAME transaction as the
 * created resource so a rolled-back create never leaves a completed key.
 */

export type IdempotencyStatus = "in_progress" | "completed" | "failed";

export interface IdempotencyRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly scope: string;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly status: IdempotencyStatus;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly expires_at: string;
}

export class IdempotencyRepository extends Repository {
  async find(
    workspaceId: string,
    scope: string,
    key: string,
  ): Promise<IdempotencyRow | null> {
    const rows = await this.exec
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotency_key, key),
        ),
      )
      .limit(1);
    return (rows[0] as IdempotencyRow | undefined) ?? null;
  }

  /**
   * Reserve the key with status `in_progress`. Returns the inserted row, or null
   * if another transaction already holds the key (UNIQUE conflict → caller reads
   * the existing row and replays / conflicts).
   */
  async begin(values: {
    workspaceId: string;
    scope: string;
    key: string;
    requestHash: string;
    expiresAt: string;
  }): Promise<IdempotencyRow | null> {
    const rows = await this.exec
      .insert(idempotencyKeys)
      .values({
        workspace_id: values.workspaceId,
        scope: values.scope,
        idempotency_key: values.key,
        request_hash: values.requestHash,
        expires_at: values.expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    return (rows[0] as IdempotencyRow | undefined) ?? null;
  }

  /** Record the terminal response on the reserved key (same transaction). */
  async complete(
    id: string,
    values: {
      responseStatus: number;
      responseBody: unknown;
      resourceType: string;
      resourceId: string;
    },
  ): Promise<void> {
    await this.exec
      .update(idempotencyKeys)
      .set({
        status: "completed",
        response_status: values.responseStatus,
        response_body: values.responseBody,
        resource_type: values.resourceType,
        resource_id: values.resourceId,
      })
      .where(eq(idempotencyKeys.id, id));
  }
}
