// @input  -- v2 catalog, neutral crawl evidence, and one Agent-local run context
// @output -- deterministic two-scope Diagnosis view model with honest null semantics
// @pos    -- focused contract tests for the marketing Agent Stage 02 projection

import { describe, expect, it } from "vitest";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import {
  buildAgentAuditViewModel,
  type AgentDiagnosisContext,
} from "./agent-audit-model";

const context: AgentDiagnosisContext = {
  reviewState: "confirmed",
  productName: "AstrologyWiki",
  primaryIcp: "Reflection-oriented astrology learners",
  country: "United States",
  locale: "en",
  device: "mobile",
  pageType: "tool",
  targetQuery: "birth chart calculator",
  auditScope: "site-first",
};

const data: AgentAuditSuccessData = {
  run: {
    agent: "seo",
    mode: "authenticated_agent",
    persistence: "none",
    source: {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v3",
      completedAt: "2026-08-13T00:00:00.000Z",
      cache: { status: "miss", capturedAt: null },
    },
  },
  result: {
    targetUrl: "https://astrologywiki.com/chart",
    siteOrigin: "https://astrologywiki.com",
    scannedAt: "2026-08-13T00:00:00.000Z",
    coverage: {
      availability: "unavailable",
      pagesInspected: 0,
      linksObserved: 0,
      sitemapUrlsObserved: 0,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      stopReason: "crawl_failed",
    },
    siteResources: {
      robotsFetched: false,
      robotsGroupsObserved: 0,
      sitemapReferencesObserved: 0,
      sitemapFetched: false,
    },
    records: [],
  },
};

describe("buildAgentAuditViewModel", () => {
  it.each([
    ["seo" as const, "E", "9"],
    ["tech" as const, "A", "1"],
  ])(
    "keeps all 77 checks and applies the %s Agent defaults",
    (agent, siteDefault, pageDefault) => {
      const model = buildAgentAuditViewModel({
        agent,
        locale: "en",
        context,
        data: { ...data, run: { ...data.run, agent } },
      });

      expect(model.defaults).toEqual({
        siteGroupId: siteDefault,
        pageGroupId: pageDefault,
      });
      expect(model.scopes.site.groups).toHaveLength(5);
      expect(model.scopes.site.total).toBe(27);
      expect(model.scopes.site.inventoryReady).toBe(21);
      expect(model.scopes.page.groups).toHaveLength(9);
      expect(model.scopes.page.total).toBe(50);
      expect(model.scopes.page.inventoryReady).toBe(22);
      expect(
        model.scopes.site.total + model.scopes.page.total,
      ).toBe(77);
    },
  );

  it("keeps unavailable and source-gated checks excluded rather than zero, pass, or verified", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      data,
    });
    const checks = [
      ...model.scopes.site.groups.flatMap((group) => group.checks),
      ...model.scopes.page.groups.flatMap((group) => group.checks),
    ];

    expect(model.scopes.site.health).toBeNull();
    expect(model.scopes.page.health).toBeNull();
    expect(model.scopes.site.evaluated).toBe(0);
    expect(model.scopes.page.evaluated).toBe(0);
    expect(checks).toHaveLength(77);
    expect(checks.every((check) => check.result === "excluded")).toBe(true);
    expect(checks.some((check) => check.result === "pass")).toBe(false);
    expect(checks.every((check) => check.measurement === null)).toBe(true);
    expect(
      checks.some(
        (check) =>
          check.truth === "source_gated" || check.truth === "unavailable",
      ),
    ).toBe(true);
  });

  it("exposes every explainability field and the page-type heading policy", () => {
    const model = buildAgentAuditViewModel({
      agent: "tech",
      locale: "zh",
      context,
      data: { ...data, run: { ...data.run, agent: "tech" } },
    });
    const check = model.scopes.page.groups[0]?.checks[0];

    expect(check).toMatchObject({
      result: "excluded",
      measurement: null,
    });
    expect(check?.title).toBeTruthy();
    expect(check?.threshold).toBeTruthy();
    expect(check?.thresholdAuthority).toBeTruthy();
    expect(check?.impact).toBeTruthy();
    expect(check?.howToFix).toBeTruthy();
    expect(check?.dataSource).toBeTruthy();
    expect(check?.boundary).toBeTruthy();
    expect(check?.scoreContribution).toBeNull();
    expect(model.headingPreset).toMatchObject({
      pageType: "tool",
      h2: { min: 5, max: 9 },
      h3: { min: 6, max: 18 },
      substanceWords: 60,
      blocker: false,
    });
  });

  it("preserves the confirmed Agent-local context and source provenance", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      data,
    });

    expect(model.context).toEqual(context);
    expect(model.provenance).toMatchObject({
      availability: "unavailable",
      sourceTool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v3",
      persistence: "none",
    });
  });
});
