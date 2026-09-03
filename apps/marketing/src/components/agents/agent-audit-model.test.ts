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
      schemaVersion: "seo_audit.sitewide.v18",
      completedAt: "2026-08-13T00:00:00.000Z",
      cache: { status: "miss", capturedAt: null },
    },
  },
  result: {
    targetUrl: "https://astrologywiki.com/chart",
    siteOrigin: "https://astrologywiki.com",
    scannedAt: "2026-08-13T00:00:00.000Z",
    targetInspected: true,
    inspectedTargetUrl: "https://acme.test/",
    landedTargetUrl: "https://acme.test/",
    targetPageExtract: null,
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
      sitemapUrls: [],
      sitemapUrlsComplete: true,
    },
    records: [],
  },
};

describe("buildAgentAuditViewModel", () => {
  it.each([["seo" as const], ["tech" as const]])(
    "keeps all 80 checks for the %s Agent",
    (agent) => {
      const model = buildAgentAuditViewModel({
        agent,
        locale: "en",
        context,
      coreFeatures: [],
        data: { ...data, run: { ...data.run, agent } },
      });

      // 31 site-wide + 49 page-level, in one list. The per-scope group views
      // went with the scope switch; what still has to hold is that evaluating
      // drops nothing on the way.
      expect(model.evaluatedChecks).toHaveLength(80);
      expect(
        model.evaluatedChecks.filter((check) => check.check.scope === "site"),
      ).toHaveLength(31);
      expect(
        model.evaluatedChecks.filter((check) => check.check.scope === "page"),
      ).toHaveLength(49);
    },
  );

  it("keeps unavailable and source-gated checks excluded rather than zero, pass, or verified", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data,
    });
    const checks = model.evaluatedChecks;

    expect(checks).toHaveLength(80);
    expect(checks.every((check) => check.result === "excluded")).toBe(true);
    expect(checks.some((check) => check.result === "pass")).toBe(false);
    expect(checks.every((check) => check.measurement === null)).toBe(true);
    // Contract spelling, not the view layer's old snake_case copy.
    expect(
      checks.some(
        (check) =>
          check.truth === "source-gated" || check.truth === "unavailable",
      ),
    ).toBe(true);
  });

  it("never promotes a condition not observed in the bounded sample to Pass", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data: {
        ...data,
        result: {
          ...data.result,
          coverage: { ...data.result.coverage, availability: "available" },
          records: [
            {
              id: "meta_description_duplicate",
              category: "metadata",
              state: "not_observed",
              unit: "pages",
              population: "every_collected_page" as const,
              targetTested: null,
              tested: 4,
              affected: 0,
              observations: [],
              limitation: null,
            },
          ],
        },
      },
    });
    const check = model.evaluatedChecks.find(
      (candidate) => candidate.check.id === "D2",
    );

    expect(check?.result).toBe("pass");
    expect(check?.truth).toBe("not-observed");
  });

  it("exposes every explainability field on each evaluated check", () => {
    const model = buildAgentAuditViewModel({
      agent: "tech",
      locale: "zh",
      context,
      coreFeatures: [],
      data: { ...data, run: { ...data.run, agent: "tech" } },
    });
    const check = model.evaluatedChecks.find(
      (candidate) => candidate.check.scope === "page",
    );

    expect(check).toMatchObject({ result: "excluded", measurement: null });
    expect(check?.check.title).toBeTruthy();
    expect(check?.check.threshold).toBeTruthy();
    expect(check?.check.thresholdAuthority).toBeTruthy();
    expect(check?.check.impact).toBeTruthy();
    expect(check?.check.howToFix).toBeTruthy();
    expect(check?.check.dataSource).toBeTruthy();
    expect(check?.check.boundary).toBeTruthy();
    expect(check?.scoreContribution).toBeNull();
  });

  it("preserves the confirmed Agent-local context and source provenance", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data,
    });

    expect(model.context).toEqual(context);
    expect(model.provenance).toMatchObject({
      availability: "unavailable",
      sourceTool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v18",
      persistence: "none",
    });
  });
});
