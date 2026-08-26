// @input  -- the Agent handlers' default dependency objects
// @output -- assertions that production actually reports a qualifying run
// @pos    -- covers the one seam no handler test can see

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEPENDENCIES as DEFAULT_AUDIT_DEPENDENCIES,
  ON_PAGE_CHECK_DEPENDENCIES,
} from "../agents/audit-handler.ts";
import { DEFAULT_DEPENDENCIES as DEFAULT_PROFILE_REFRESH_DEPENDENCIES } from "../agents/profile-refresh-handler.ts";
import { QUALIFYING_TOOLS } from "./credits-config.ts";
import { reportFirstToolRun } from "./report-first-run.ts";

/**
 * The reporter is an OPTIONAL dependency, which is what let it be added without
 * touching a single existing handler test — every one of those builds its own
 * literal deps object and simply leaves the field undefined.
 *
 * The cost of that is a blind spot exactly where it matters: if the default
 * object forgot to carry the reporter, production would quietly never pay a
 * referral and all 707 handler tests would still pass. This file is the only
 * thing standing between that mistake and a silent, unnoticed regression.
 */
describe("first-run reporting is wired into production", () => {
  it.each([
    ["agent-audit", DEFAULT_AUDIT_DEPENDENCIES],
    ["on-page-seo-check", ON_PAGE_CHECK_DEPENDENCIES],
    ["profile-refresh", DEFAULT_PROFILE_REFRESH_DEPENDENCIES],
  ])("%s carries the real reporter", (_name, dependencies) => {
    expect(dependencies.reportFirstRun).toBe(reportFirstToolRun);
  });

  /** The checker owns both its ledger label and its stricter entry policy. */
  it("keeps the checker on dedicated production wiring", () => {
    expect(DEFAULT_AUDIT_DEPENDENCIES.reportAs).toBe("agent-audit");
    expect(ON_PAGE_CHECK_DEPENDENCIES.reportAs).toBe("on-page-seo-check");
    expect(ON_PAGE_CHECK_DEPENDENCIES.delegate).not.toBe(
      DEFAULT_AUDIT_DEPENDENCIES.delegate,
    );
  });

  /**
   * The Search Console tools admit on the sealed gg_id cookie, not on the
   * Supabase session the ledger keys on. Listing one here would credit an
   * identity that did not do the work.
   */
  it("qualifies only tools the Supabase session admits", () => {
    expect([...QUALIFYING_TOOLS]).toEqual([
      "agent-audit",
      "on-page-seo-check",
      "profile-refresh",
    ]);
  });
});
