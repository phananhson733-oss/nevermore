/**
 * Local-development auth affordance (NOT a product feature). When
 * `NODE_ENV !== "production"` AND `SF_DEV_AUTH === "true"`, the app treats every
 * request as a fixed local operator so the authenticated screens can be exercised
 * without a running Supabase Auth (GoTrue) instance. It is double-gated and can
 * NEVER activate in production (spec §14.1). Edge-safe: no node-only imports.
 */

/** Fixed synthetic operator id used only under dev auth. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_NAME = "Local Dev Operator";

export function isDevAuthEnabled(): boolean {
  return process.env["NODE_ENV"] !== "production" && process.env["SF_DEV_AUTH"] === "true";
}
