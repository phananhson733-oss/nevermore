// @input  -- nothing; this module holds one list
// @output -- every error code the GEO run route can put in front of a visitor
// @pos    -- shared by the server handler and the client workbench, so it must stay dependency-free

/**
 * Every error code the GEO run route can return.
 *
 * A list, not only a union type, so a test can walk it and check that each code
 * has a message in both locales — and that the workbench recognises it rather
 * than folding it into the generic "the run could not be completed". Two real
 * refusals reached visitors as that generic sentence because nothing tied the
 * codes to their message keys: they were missing from a hand-written list in
 * the component and from both message files, and neither typecheck nor any test
 * could see it.
 *
 * It lives in its own module because both sides need it. `geo-run-handler`
 * imports `@sf/public-tools` and the server auth helpers, so a client component
 * that reached for the list there would pull `node:net` into the browser
 * bundle — a failure this repo has shipped twice, visible only in `pnpm build`.
 * Keep this file free of imports.
 */
export const GEO_RUN_ERROR_CODES = [
  // Refused before anything is billed.
  "invalid_request",
  "geo_context_invalid",
  "geo_query_set_invalid",
  "geo_query_set_unconfirmed",
  "geo_query_set_mismatch",
  "geo_prompt_too_long",
  "geo_plan_size_mismatch",
  "geo_brand_stance_mismatch",
  // Access and version gates.
  "auth_required",
  "auth_unavailable",
  "geo_client_outdated",
  // Budget gates, also before billing.
  "geo_budget_exhausted",
  "geo_budget_unavailable",
  "geo_time_budget_exhausted",
  // Raised after the run has started.
  "geo_provider_unavailable",
  "geo_report_invalid",
] as const;

export type GeoRunErrorCode = (typeof GEO_RUN_ERROR_CODES)[number];
