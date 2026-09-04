// @input  -- v2 catalog, neutral crawl evidence, and one Agent-local run context
// @output -- deterministic two-scope Diagnosis view model with honest null semantics
// @pos    -- focused contract tests for the marketing Agent Stage 02 projection

import { describe, expect, it } from "vitest";
import {
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "@sf/public-tools/agent-audit";

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

const SITE_CHECK_COUNT = SITE_AUDIT_GROUPS.flatMap(
  (group) => group.checks,
).length;
const PAGE_CHECK_COUNT = PAGE_AUDIT_GROUPS.flatMap(
  (group) => group.checks,
).length;
const CHECK_COUNT = SITE_CHECK_COUNT + PAGE_CHECK_COUNT;

describe("buildAgentAuditViewModel", () => {
  it.each([["seo" as const], ["tech" as const]])(
    "keeps every catalog check for the %s Agent",
    (agent) => {
      const model = buildAgentAuditViewModel({
        agent,
        locale: "en",
        context,
      coreFeatures: [],
        data: { ...data, run: { ...data.run, agent } },
      });

      // Both catalog scopes stay in one list. The per-scope group views went
      // with the scope switch; what still has to hold is that evaluating drops
      // nothing on the way when the catalog changes.
      expect(model.evaluatedChecks).toHaveLength(CHECK_COUNT);
      expect(
        model.evaluatedChecks.filter((check) => check.check.scope === "site"),
      ).toHaveLength(SITE_CHECK_COUNT);
      expect(
        model.evaluatedChecks.filter((check) => check.check.scope === "page"),
      ).toHaveLength(PAGE_CHECK_COUNT);
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

    expect(checks).toHaveLength(CHECK_COUNT);
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

  it("defaults a legacy response's selection ledgers without inventing counts", () => {
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data,
    });

    expect(model.omittedUrls).toEqual([]);
    expect(model.manualUnavailableUrls).toEqual([]);
    expect(model.keyPages[0]?.reason).toBe("target");
  });

  it("carries the server's exact safety-valve omission ledger", () => {
    const omittedUrls = [
      "https://astrologywiki.com/blog/one",
      "https://astrologywiki.com/blog/two",
    ];
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data: {
        ...data,
        result: {
          ...data.result,
          keyPageSelection: { omittedUrls },
        },
      },
    });

    expect(model.omittedUrls).toEqual(omittedUrls);
  });

  it("carries the server's unavailable-manual ledger independently", () => {
    const manualUnavailableUrls = [
      "https://astrologywiki.com/private/one",
      "https://astrologywiki.com/private/two",
    ];
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data: {
        ...data,
        result: {
          ...data.result,
          keyPageSelection: {
            omittedUrls: [],
            manualUnavailableUrls,
          },
        },
      },
    });

    expect(model.omittedUrls).toEqual([]);
    expect(model.manualUnavailableUrls).toEqual(manualUnavailableUrls);
  });

  it("keeps an uncollected synthetic target out of the candidate list", () => {
    const candidateUrl = "https://astrologywiki.com/pricing";
    const model = buildAgentAuditViewModel({
      agent: "seo",
      locale: "en",
      context,
      coreFeatures: [],
      data: {
        ...data,
        result: {
          ...data.result,
          targetInspected: false,
          inspectedTargetUrl: null,
          landedTargetUrl: null,
          keyPages: [
            {
              url: candidateUrl,
              title: "Pricing",
              metaDescription: null,
              depth: 1,
              inboundLinks: 3,
              reason: "navigation",
            },
          ],
        },
      },
    });

    expect(model.keyPages.map((page) => page.url)).toEqual([
      data.result.targetUrl,
      candidateUrl,
    ]);
    expect(model.keyPages[0]?.reason).toBe("target");
    expect(model.candidatePages.map((page) => page.url)).toEqual([
      candidateUrl,
    ]);
    expect(model.candidatePages.map((page) => page.reason)).toEqual([
      "navigation",
    ]);
    expect(model.keyPagesWereSelected).toBe(true);
  });
});
