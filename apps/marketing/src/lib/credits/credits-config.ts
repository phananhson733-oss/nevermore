// @input  -- nothing; this module is a constant table
// @output -- the wiring-layer and UI source of truth for every credits number
// @pos    -- records the seed values that credit_settings holds at runtime

/**
 * Runtime authority for these numbers is `public.credit_settings`, which the
 * SQL functions read for themselves. A rolling deploy can therefore never have
 * two instances granting different amounts on the same day.
 *
 * This file exists so the UI can print a price without a round trip, and so
 * that anyone editing one of these numbers is forced by credits-config.test.ts
 * to edit the migration too.
 */
export const CREDITS_SETTINGS_SEED = {
  mode: "welfare",
  dailyAmount: 20,
  welfareAccrualCap: 600,
  referralDailyCap: 200,
  signupBonus: 100,
  referralReward: 50,
  referralInviterCap: 20,
} as const;

/** Slugs recorded on ledger rows, and the unit Phase 2 will price a run in. */
export type CreditToolSlug =
  | "keyword-opportunities"
  | "agent-audit"
  | "quick-wins"
  | "profile-refresh"
  | "traffic-drop"
  | "profile-search";

/**
 * Phase 2 prices, shown today only as the "free while testing" notice.
 *
 * Anchored at roughly 1 credit per US cent against measured per-run cost:
 * the keyword map spends about $0.09 of DataForSEO plus an uncalibrated LLM
 * call, the crawl-only tools spend nothing but compute.
 */
export const CREDIT_TOOL_PRICES: Readonly<Record<CreditToolSlug, number>> = {
  "keyword-opportunities": 25,
  "agent-audit": 10,
  "quick-wins": 5,
  "profile-refresh": 5,
  "traffic-drop": 3,
  "profile-search": 2,
};

/**
 * A referral is earned by finishing one of these, not by signing up.
 *
 * Only tools whose ADMISSION is the Supabase session are listed. The three
 * Search Console tools authorize against the sealed `gg_id` Google cookie
 * instead, so the identity that did the work and the identity that would be
 * credited are different things with nothing binding them: one Google account
 * could qualify an unlimited number of Supabase accounts. Rather than bridge
 * the two, they are excluded until Phase 2 puts them behind the same Supabase
 * login (design §1 Phase 2), at which point the binding is free.
 *
 * profile-search stays out on its own merits: one DataForSEO call is not work.
 */
export const QUALIFYING_TOOLS = [
  "agent-audit",
  "profile-refresh",
] as const satisfies ReadonlyArray<CreditToolSlug>;

export type QualifyingTool = (typeof QUALIFYING_TOOLS)[number];

/**
 * A bound, not a specification: the generator emits eight characters from a
 * 32-symbol alphabet. Codes are identifiers rather than secrets, so the only
 * job here is to reject input that could never have been issued.
 */
export const REFERRAL_CODE_PATTERN = /^[a-z0-9]{8,16}$/;

/** Reading the balance also grants the day, so the badge cannot poll freely. */
export const BALANCE_RATE_LIMIT = {
  max: 30,
  windowSeconds: 3_600,
} as const;

/** Ledger page size on /account/credits. */
export const LEDGER_PAGE_SIZE = 25;

export const REFERRAL_COOKIE_NAME = "gg_ref";

/** Referral attribution window, last touch wins. */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Kill switch. Anything other than the exact string "true" leaves the site
 * behaving as it did before credits existed.
 */
export function creditsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.MARKETING_CREDITS_ENABLED === "true";
}
