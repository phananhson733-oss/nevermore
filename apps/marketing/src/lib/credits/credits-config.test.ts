// @input  -- the credits configuration module and the 0004 migration text
// @output -- assertions pinning every number a human might change by hand
// @pos    -- guards the config against silent drift from the migration defaults

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BALANCE_RATE_LIMIT,
  CREDIT_TOOL_PRICES,
  CREDITS_SETTINGS_SEED,
  QUALIFYING_TOOLS,
  REFERRAL_CODE_PATTERN,
  creditsEnabled,
} from "./credits-config.ts";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/0004_credits_ledger.sql",
    import.meta.url,
  ),
);

describe("credits-config", () => {
  it("prices every tool the credits system knows about", () => {
    expect(Object.keys(CREDIT_TOOL_PRICES).sort()).toEqual(
      [...QUALIFYING_TOOLS, "profile-search"].sort(),
    );
    expect(CREDIT_TOOL_PRICES["keyword-opportunities"]).toBe(25);
    expect(CREDIT_TOOL_PRICES["agent-audit"]).toBe(10);
    expect(CREDIT_TOOL_PRICES["quick-wins"]).toBe(5);
    expect(CREDIT_TOOL_PRICES["profile-refresh"]).toBe(5);
    expect(CREDIT_TOOL_PRICES["traffic-drop"]).toBe(3);
    expect(CREDIT_TOOL_PRICES["profile-search"]).toBe(2);
  });

  it("excludes profile-search from the qualifying run list", () => {
    expect(QUALIFYING_TOOLS).not.toContain("profile-search");
  });

  /**
   * The migration is the runtime authority; this file only records the seed.
   * A number changed in one place and not the other is the exact failure this
   * pins: the page would advertise a grant the database never makes.
   */
  it("matches every DEFAULT in the 0004 migration", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const defaults: ReadonlyArray<readonly [string, number]> = [
      ["daily_amount", CREDITS_SETTINGS_SEED.dailyAmount],
      ["welfare_accrual_cap", CREDITS_SETTINGS_SEED.welfareAccrualCap],
      ["referral_daily_cap", CREDITS_SETTINGS_SEED.referralDailyCap],
      ["signup_bonus", CREDITS_SETTINGS_SEED.signupBonus],
      ["referral_reward", CREDITS_SETTINGS_SEED.referralReward],
      ["referral_inviter_cap", CREDITS_SETTINGS_SEED.referralInviterCap],
    ];

    for (const [column, expected] of defaults) {
      const match = new RegExp(
        `${column}\\s+integer\\s+not null\\s+default\\s+(\\d+)`,
      ).exec(sql);
      expect(match, `${column} default not found in the migration`).not.toBeNull();
      expect(Number(match?.[1]), `${column} drifted from the migration`).toBe(
        expected,
      );
    }
  });

  it("seeds the mode the migration defaults to", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("default 'welfare'");
    expect(CREDITS_SETTINGS_SEED.mode).toBe("welfare");
  });

  it("only accepts referral codes the generator can produce", () => {
    expect(REFERRAL_CODE_PATTERN.test("ab3kd9xz")).toBe(true);
    expect(REFERRAL_CODE_PATTERN.test("AB3KD9XZ")).toBe(false);
    expect(REFERRAL_CODE_PATTERN.test("short")).toBe(false);
    expect(REFERRAL_CODE_PATTERN.test("a".repeat(17))).toBe(false);
    expect(REFERRAL_CODE_PATTERN.test("ab3kd9x-")).toBe(false);
  });

  it("rate limits the balance endpoint, because reading it writes", () => {
    expect(BALANCE_RATE_LIMIT.max).toBeGreaterThan(0);
    expect(BALANCE_RATE_LIMIT.windowSeconds).toBe(3_600);
  });

  it("stays off unless the flag is exactly true", () => {
    expect(creditsEnabled({})).toBe(false);
    expect(
      creditsEnabled({ MARKETING_CREDITS_ENABLED: "1" }),
    ).toBe(false);
    expect(
      creditsEnabled({ MARKETING_CREDITS_ENABLED: "TRUE" }),
    ).toBe(false);
    expect(
      creditsEnabled({ MARKETING_CREDITS_ENABLED: "true" }),
    ).toBe(true);
  });
});
