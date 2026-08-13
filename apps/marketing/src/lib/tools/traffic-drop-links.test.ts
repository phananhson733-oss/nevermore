// @input  -- the traffic-drop outbound link table, queried per host item
// @output -- a failing test when a link detaches from its host item or loses a locale
// @pos    -- the guard on which report items carry a next-step link, and where each goes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  trafficDropActionLink,
  trafficDropCheckLink,
} from "./traffic-drop-links.ts";

describe("trafficDropActionLink", () => {
  it("sends the stage-one CTR action to SEO Quick Wins, with the agreed copy", () => {
    const link = trafficDropActionLink("isolate_stage_one_ctr", "en");
    expect(link).not.toBeNull();
    expect(link?.href).toBe("/tools/seo-quick-wins");
    expect(link?.external).toBe(false);
    expect(link?.label).toBe("Run SEO Quick Wins on this property");
    expect(link?.detail).toBe(
      "It reads the same Search Console property and lists the queries whose click-through sits below your own baseline.",
    );
  });

  it("prefixes the Quick Wins path for the Chinese locale and carries Chinese copy", () => {
    const link = trafficDropActionLink("isolate_stage_one_ctr", "zh");
    expect(link?.href).toBe("/zh/tools/seo-quick-wins");
    expect(link?.label).not.toBe("Run SEO Quick Wins on this property");
    expect(link?.label).toContain("SEO Quick Wins");
    expect(link?.detail).toBeTruthy();
  });

  it("sends the deploy-log action to SEO Agent with its account boundary", () => {
    const en = trafficDropActionLink("pull_deploy_logs", "en");
    expect(en?.href).toBe("/agents/seo");
    expect(en?.external).toBe(false);
    expect(en?.detail).toContain("verified GenGrowth account");
    expect(en?.detail).toContain("not saved");
    const zh = trafficDropActionLink("pull_deploy_logs", "zh");
    expect(zh?.href).toBe("/zh/agents/seo");
    expect(zh?.detail).toContain("验证 GenGrowth 账号");
  });

  it("gives no link to actions outside the two agreed hosts", () => {
    expect(trafficDropActionLink("avoid_rank_recovery", "en")).toBeNull();
    expect(trafficDropActionLink("split_cohorts", "en")).toBeNull();
    expect(trafficDropActionLink("resolve_manual_action", "en")).toBeNull();
  });
});

describe("trafficDropCheckLink", () => {
  it("links a Cannot-check decline concentration to the Search Console entry page", () => {
    const link = trafficDropCheckLink(
      "decline_concentration",
      "not_available",
      "en",
      null,
    );
    expect(link?.href).toBe("https://search.google.com/search-console");
    expect(link?.external).toBe(true);
    expect(link?.label).toBeTruthy();
  });

  it("deep-links the performance report when the property identifier is known", () => {
    const link = trafficDropCheckLink(
      "decline_concentration",
      "not_available",
      "en",
      "sc-domain:astrologywiki.com",
    );
    expect(link?.href).toBe(
      "https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aastrologywiki.com",
    );
    expect(link?.external).toBe(true);
  });

  it("links a Cannot-check single-page dominated decline to Tech Agent", () => {
    const en = trafficDropCheckLink(
      "single_page_dominated_decline",
      "not_available",
      "en",
      null,
    );
    expect(en?.href).toBe("/agents/tech");
    expect(en?.external).toBe(false);
    const zh = trafficDropCheckLink(
      "single_page_dominated_decline",
      "not_available",
      "zh",
      null,
    );
    expect(zh?.href).toBe("/zh/agents/tech");
    expect(zh?.label).toBeTruthy();
  });

  it("renders only on the Cannot-check row: other statuses and other checks get nothing", () => {
    // The host item is "Cannot check · <name>". A triggered concentration check
    // was computed from data we did read, and pointing at Search Console there
    // would claim a gap that does not exist.
    expect(
      trafficDropCheckLink("decline_concentration", "hit", "en", null),
    ).toBeNull();
    expect(
      trafficDropCheckLink("single_page_dominated_decline", "clear", "en", null),
    ).toBeNull();
    expect(
      trafficDropCheckLink("seasonality_yoy", "not_available", "en", null),
    ).toBeNull();
  });
});
