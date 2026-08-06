/**
 * Workspace plan tiers and the signup gate (spec §1.6).
 *
 * Self-serve signup admits accounts nobody vetted, and every expensive thing
 * this product does — crawling, LLM synthesis, diagnosis — hangs off a project.
 * Bounding the project count is therefore the one limit that bounds cost
 * without instrumenting a dozen execution paths, each of which would be another
 * place to forget.
 *
 * Edge-safe: no node imports, so the proxy can read the signup mode too.
 */

export const FREE_PLAN_TIER = "free";
export const INTERNAL_PLAN_TIER = "internal";

export type PlanTier = typeof FREE_PLAN_TIER | typeof INTERNAL_PLAN_TIER;

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** Active project ceiling per tier; null means unbounded. */
const PROJECT_LIMITS: Readonly<Record<PlanTier, number | null>> = {
  [FREE_PLAN_TIER]: 1,
  [INTERNAL_PLAN_TIER]: null,
};

/**
 * Coerce a stored tier string.
 *
 * An unrecognised value resolves to `free` rather than to unbounded: a tier
 * this build does not know about must not be the one that lifts the limit.
 */
export function asPlanTier(raw: string | null | undefined): PlanTier {
  return raw === INTERNAL_PLAN_TIER ? INTERNAL_PLAN_TIER : FREE_PLAN_TIER;
}

/** How many active projects this tier may hold, or null for unbounded. */
export function projectLimitFor(tier: PlanTier): number | null {
  return PROJECT_LIMITS[tier];
}

/**
 * Whether a first-time account provisions itself a workspace.
 *
 * Self-serve is the default because it is what §1.6 now specifies. The env var
 * is an operational brake for abuse, not a feature flag: setting
 * `SF_SIGNUP_MODE=invite` restores the pre-0.4 behaviour where only accounts an
 * admin already provisioned can resolve an operator context.
 */
export function isSelfServeSignupEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  return env["SF_SIGNUP_MODE"] !== "invite";
}
