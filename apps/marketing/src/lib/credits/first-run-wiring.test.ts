// @input  -- the five tool handlers' default dependency objects
// @output -- assertions that production actually reports a qualifying run
// @pos    -- covers the one seam no handler test can see

import { describe, expect, it } from "vitest";

import { DEFAULT_DEPENDENCIES as DEFAULT_AUDIT_DEPENDENCIES } from "../agents/audit-handler.ts";
import { DEFAULT_DEPENDENCIES as DEFAULT_PROFILE_REFRESH_DEPENDENCIES } from "../agents/profile-refresh-handler.ts";
import { DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES } from "../tools/keyword-opportunity-handler.ts";
import { DEFAULT_QUICK_WINS_DEPENDENCIES } from "../tools/quick-wins-handler.ts";
import { DEFAULT_TRAFFIC_DROP_DEPENDENCIES } from "../tools/traffic-drop-handler.ts";
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
    ["quick-wins", DEFAULT_QUICK_WINS_DEPENDENCIES],
    ["traffic-drop", DEFAULT_TRAFFIC_DROP_DEPENDENCIES],
    ["keyword-opportunities", DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES],
    ["agent-audit", DEFAULT_AUDIT_DEPENDENCIES],
    ["profile-refresh", DEFAULT_PROFILE_REFRESH_DEPENDENCIES],
  ])("%s carries the real reporter", (_name, dependencies) => {
    expect(dependencies.reportFirstRun).toBe(reportFirstToolRun);
  });
});
