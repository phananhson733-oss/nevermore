// @input  -- an error body from the Profile refresh endpoint
// @output -- the one named cause a visitor can act on, or null
// @pos    -- client-side reading of a server code; it never invents a cause
/**
 * The endpoint already distinguishes "your robots.txt says no" from "the
 * homepage did not answer" from "we are rate limited". The editor used to
 * collapse all of them into one sentence, so a site that could never be
 * scanned looked exactly like a transient outage.
 */
export const PROFILE_REFRESH_REASONS = [
  "rateLimited",
  "rateLimitedByTarget",
  "botProtectionBlocked",
  "robotsDisallowed",
  "robotsUnreachable",
  "entryUnreachable",
  "tooFewPages",
  "invalidTarget",
  "unavailable",
] as const;
export type ProfileRefreshReason = (typeof PROFILE_REFRESH_REASONS)[number];

const BY_CODE: Readonly<Record<string, ProfileRefreshReason>> = {
  rate_limited: "rateLimited",
  rate_limited_by_target: "rateLimitedByTarget",
  bot_protection_blocked: "botProtectionBlocked",
  robots_disallowed: "robotsDisallowed",
  robots_unreachable: "robotsUnreachable",
  entry_unreachable: "entryUnreachable",
  too_few_pages: "tooFewPages",
  invalid_target: "invalidTarget",
  invalid_url: "invalidTarget",
  invalid_origin: "invalidTarget",
  protocol_downgrade_rejected: "invalidTarget",
  profile_source_unavailable: "unavailable",
  profile_response_invalid: "unavailable",
};

export function profileRefreshReason(body: unknown, status: number): ProfileRefreshReason | null {
  const error = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as { readonly error?: unknown }).error
    : null;
  const code = typeof error === "object" && error !== null && !Array.isArray(error)
    ? (error as { readonly code?: unknown }).code
    : null;
  if (typeof code === "string" && Object.hasOwn(BY_CODE, code)) return BY_CODE[code]!;
  // A status with no code we recognise is still worth naming when the status
  // itself carries the meaning. Anything else stays unnamed rather than guessed.
  return status === 429 ? "rateLimited" : status === 503 ? "unavailable" : null;
}
