// @input  -- the slug of a tool run that just succeeded, inside a request scope
// @output -- nothing; the referral reward is claimed after the response is sent
// @pos    -- the single side effect the two Agent handlers gained

import { after } from "next/server";

import {
  getServerAuthenticatedUser,
  type ServerAuthenticatedUser,
} from "../auth/server-auth-user.ts";
import { creditsEnabled, type QualifyingTool } from "./credits-config.ts";
import { rewardReferral, type CreditsResult, type ReferralVerdict } from "./credits-store.ts";

export interface FirstRunReporterDependencies {
  readonly schedule: (task: () => Promise<void>) => void;
  readonly readUser: () => Promise<ServerAuthenticatedUser>;
  readonly reward: (
    userId: string,
    toolSlug: string,
  ) => Promise<CreditsResult<ReferralVerdict>>;
  readonly enabled: () => boolean;
}

export const DEFAULT_FIRST_RUN_DEPENDENCIES: FirstRunReporterDependencies = {
  schedule: (task) => {
    after(task);
  },
  readUser: getServerAuthenticatedUser,
  reward: rewardReferral,
  enabled: () => creditsEnabled(),
};

/**
 * Record that a qualifying tool run succeeded, so a referred visitor's first
 * run can pay its reward.
 *
 * Two properties this function must never lose:
 *
 * 1. It cannot throw. agents/audit-handler.ts returns its success outside any
 *    try/catch, so a throw there becomes a 500 on a run that already produced
 *    its evidence, and profile-refresh would turn one into an error envelope.
 *    A credit is worth strictly less than the work the visitor waited for.
 *
 * 2. It cannot await. The handlers release their in-flight gate slot in a
 *    finally that runs after the success expression is evaluated, so awaiting
 *    two network round trips here would hold that slot and hand concurrent
 *    visitors a scan_in_progress 409 they did not earn.
 *
 * Deciding whether this is the first run belongs to the database, not here: the
 * function claims it under a row lock, so two runs finishing together cannot
 * both qualify.
 */
export function reportFirstToolRun(
  tool: QualifyingTool,
  dependencies: FirstRunReporterDependencies = DEFAULT_FIRST_RUN_DEPENDENCIES,
): void {
  try {
    if (!dependencies.enabled()) return;

    dependencies.schedule(async () => {
      try {
        const user = await dependencies.readUser();
        // Anonymous and Search-Console-only visitors are the normal case on
        // three of these tools; there is simply no account to credit.
        if (user.status !== "authenticated") return;
        await dependencies.reward(user.userId, tool);
      } catch (error) {
        console.error("[credits] first-run report failed:", error);
      }
    });
  } catch (error) {
    // after() throws outside a request scope. Nothing about a response the
    // visitor has already earned should depend on that.
    console.error("[credits] could not schedule the first-run report:", error);
  }
}
