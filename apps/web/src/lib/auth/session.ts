import { eq, sql } from "drizzle-orm";
import { operatorProfiles, workspaces } from "@sf/db/schema";
import { getDb } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEV_USER_ID, DEV_USER_NAME, isDevAuthEnabled } from "@/lib/auth/dev";

/** The single internal workspace name (spec §1.2: one workspace, all operators). */
const SINGLETON_WORKSPACE_NAME = "SignalFrame";

/** Resolved operator identity + workspace for a request. */
export interface OperatorContext {
  readonly userId: string;
  readonly workspaceId: string;
}

/** The authenticated Supabase user id + display name, or null if unauthenticated. */
async function getAuthUser(): Promise<{
  userId: string;
  displayName: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const displayName =
    (typeof user.user_metadata?.["full_name"] === "string" &&
      user.user_metadata["full_name"]) ||
    user.email ||
    user.id;
  return { userId: user.id, displayName };
}

/**
 * Ensure the single internal workspace exists and the operator has a profile in
 * it (spec §1.2). Bootstrap is serialized by a transaction-level advisory lock so
 * concurrent first-boot requests cannot create two workspaces.
 */
async function ensureOperator(
  userId: string,
  displayName: string,
): Promise<OperatorContext> {
  const { db } = getDb();

  const existing = await db
    .select({ workspaceId: operatorProfiles.workspace_id })
    .from(operatorProfiles)
    .where(eq(operatorProfiles.user_id, userId))
    .limit(1);
  if (existing[0]) return { userId, workspaceId: existing[0].workspaceId };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('sf_singleton_bootstrap'))`,
    );

    let workspaceRow = (
      await tx.select({ id: workspaces.id }).from(workspaces).limit(1)
    )[0];
    if (!workspaceRow) {
      workspaceRow = (
        await tx
          .insert(workspaces)
          .values({ name: SINGLETON_WORKSPACE_NAME })
          .returning({
            id: workspaces.id,
          })
      )[0];
    }
    const workspaceId = workspaceRow!.id;

    await tx
      .insert(operatorProfiles)
      .values({
        user_id: userId,
        workspace_id: workspaceId,
        display_name: displayName,
      })
      .onConflictDoNothing();

    return { userId, workspaceId };
  });
}

/**
 * Resolve the operator context for the current request, or null if the caller is
 * not authenticated. Route handlers translate null into 401 (spec §14.1).
 */
export async function getOperatorContext(): Promise<OperatorContext | null> {
  // Local dev only (double-gated): skip Supabase and use a fixed operator so the
  // authenticated screens work without a running GoTrue instance (spec §14.1).
  if (isDevAuthEnabled()) {
    return ensureOperator(DEV_USER_ID, DEV_USER_NAME);
  }
  const authed = await getAuthUser();
  if (!authed) return null;
  return ensureOperator(authed.userId, authed.displayName);
}
