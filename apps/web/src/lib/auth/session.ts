import { eq, sql } from "drizzle-orm";
import { cache } from "react";
import { operatorProfiles, workspaces } from "@sf/db/schema";
import { getDb } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEV_USER_ID, DEV_USER_NAME, isDevAuthEnabled } from "@/lib/auth/dev";
import {
  FREE_PLAN_TIER,
  INTERNAL_PLAN_TIER,
  isSelfServeSignupEnabled,
} from "@/lib/auth/plan";

/**
 * The single development workspace name (spec §1.2: one workspace, all
 * operators). Workspace names are rendered as customer data, so this uses the
 * customer-facing brand even though the bootstrap itself is local-dev only.
 */
const SINGLETON_WORKSPACE_NAME = "GenGrowth";

/** Resolved operator identity + workspace for a request. */
export interface OperatorContext {
  readonly userId: string;
  readonly workspaceId: string;
}

/** The identity a signup needs: who they are, and what to call them. */
interface AuthenticatedUser {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Read the display name Google (or any provider) supplied.
 *
 * This is rendered as customer data, so it falls back through the fields a
 * provider may or may not send rather than risking an empty name. The email
 * local-part is the last resort — never the full address, which would put a
 * contactable identifier into a workspace label.
 */
function readDisplayName(user: {
  readonly email?: string | undefined;
  readonly user_metadata?: Record<string, unknown> | undefined;
}): string {
  const metadata = user.user_metadata ?? {};
  for (const key of ["full_name", "name", "preferred_username"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  const localPart = user.email?.split("@")[0]?.trim();
  return localPart && localPart !== "" ? localPart : "Operator";
}

/** The authenticated Supabase user, or null if unauthenticated. */
async function getAuthUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, displayName: readDisplayName(user) };
}

/** Resolve an existing operator. Never creates anything. */
async function findOperator(userId: string): Promise<OperatorContext | null> {
  const { db } = getDb();
  const existing = await db
    .select({ workspaceId: operatorProfiles.workspace_id })
    .from(operatorProfiles)
    .where(eq(operatorProfiles.user_id, userId))
    .limit(1);
  return existing[0] ? { userId, workspaceId: existing[0].workspaceId } : null;
}

/**
 * Bootstrap the explicit local-development operator and singleton workspace.
 * This function is reachable only through the double-gated dev-auth branch.
 */
async function ensureDevelopmentOperator(
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
          // Internal, not free: the local dev workspace exists to exercise the
          // product, and a one-project ceiling would block that.
          .values({
            name: SINGLETON_WORKSPACE_NAME,
            plan_tier: INTERNAL_PLAN_TIER,
          })
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
 * Self-serve signup (spec §1.6): give a first-time account its OWN workspace.
 *
 * The workspace is CREATED, never selected. `ensureDevelopmentOperator` above
 * takes the first workspace it finds because local dev is explicitly a
 * single-workspace world; reusing that shape here would put every person who
 * ever signs in into one shared workspace, and since isolation is enforced by
 * application-level `workspace_id` scoping with no RLS beneath it, that is a
 * full read of every other customer's projects. The two functions look similar
 * and mean opposite things.
 *
 * The advisory lock is keyed by user, not global: two concurrent first requests
 * from the same account would otherwise each insert a workspace and then race
 * on the profile's primary key, leaving the loser's workspace orphaned. Under
 * the lock the second request sees the first one's profile and returns it.
 */
async function provisionSelfServeOperator(
  user: AuthenticatedUser,
): Promise<OperatorContext> {
  const { db } = getDb();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`sf_signup:${user.id}`}))`,
    );

    const existing = await tx
      .select({ workspaceId: operatorProfiles.workspace_id })
      .from(operatorProfiles)
      .where(eq(operatorProfiles.user_id, user.id))
      .limit(1);
    if (existing[0]) {
      return { userId: user.id, workspaceId: existing[0].workspaceId };
    }

    const created = await tx
      .insert(workspaces)
      .values({ name: user.displayName, plan_tier: FREE_PLAN_TIER })
      .returning({ id: workspaces.id });
    const workspaceId = created[0]!.id;

    await tx.insert(operatorProfiles).values({
      user_id: user.id,
      workspace_id: workspaceId,
      display_name: user.displayName,
    });

    return { userId: user.id, workspaceId };
  });
}

/**
 * Resolve the operator context for the current request, or null if the caller is
 * not authenticated. Route handlers translate null into 401 (spec §14.1).
 */
async function resolveOperatorContext(): Promise<OperatorContext | null> {
  // Local dev only (double-gated): skip Supabase and use a fixed operator so the
  // authenticated screens work without a running GoTrue instance (spec §14.1).
  if (isDevAuthEnabled()) {
    return ensureDevelopmentOperator(DEV_USER_ID, DEV_USER_NAME);
  }
  const user = await getAuthUser();
  if (!user) return null;
  const existing = await findOperator(user.id);
  if (existing) return existing;
  // Invite-only is retained as an operational brake: if signups are ever
  // abused, setting SF_SIGNUP_MODE=invite restores the pre-0.4 behaviour of
  // admitting only accounts an admin already provisioned.
  if (!isSelfServeSignupEnabled()) return null;
  return provisionSelfServeOperator(user);
}

/**
 * Request-scoped operator lookup for server components. React's server `cache`
 * is reset for every RSC request, so sibling layouts and pages share one
 * auth/database lookup without ever reusing an identity across requests. When
 * called outside an RSC renderer (for example from a route handler or a unit
 * test), React delegates directly to the resolver instead of process-caching it.
 */
export const getOperatorContext = cache(resolveOperatorContext);
