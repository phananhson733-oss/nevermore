import { and, eq, isNull, sql } from "drizzle-orm";
import { clientProjects, workspaces } from "@sf/db/schema";
import type { DbTx } from "@sf/db";
import { ProblemError } from "@sf/observability";
import { asPlanTier, projectLimitFor } from "@/lib/auth/plan";

/**
 * The free-tier project ceiling (spec §1.6).
 *
 * Every expensive thing this product does — crawling, LLM synthesis, diagnosis,
 * measurement — hangs off a project, so the project count is the one limit that
 * bounds an unvetted signup's spend without instrumenting each execution path.
 *
 * This runs INSIDE the caller's transaction and takes a row lock on the
 * workspace first. Counting without the lock is the classic check-then-act
 * hole: two concurrent creates would both read zero, both pass, and both
 * insert, leaving a free workspace with two projects. Serialising on the
 * workspace row makes the second create observe the first one's insert.
 *
 * Archived projects do not count. Archiving is the product's own "I'm done with
 * this one" affordance, and a ceiling that counted archived rows would make the
 * free tier a single project ever rather than a single project at a time.
 */
export async function assertProjectQuotaAvailable(
  tx: DbTx,
  workspaceId: string,
): Promise<void> {
  const locked = await tx
    .select({ planTier: workspaces.plan_tier })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update")
    .limit(1);

  // A missing workspace is not this function's error to report; the caller's
  // own foreign keys will fail more precisely.
  if (!locked[0]) return;

  const limit = projectLimitFor(asPlanTier(locked[0].planTier));
  if (limit === null) return;

  const counted = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(clientProjects)
    .where(
      and(
        eq(clientProjects.workspace_id, workspaceId),
        isNull(clientProjects.archived_at),
      ),
    );

  const active = counted[0]?.total ?? 0;
  if (active < limit) return;

  throw new ProblemError(
    "PLAN_LIMIT_REACHED",
    limit === 1
      ? "The free plan includes one active project. Archive the current project to create another."
      : `The free plan includes ${limit} active projects. Archive one to create another.`,
  );
}
