// @input  -- controlled Diagnosis props, a complete view model, and bilingual labels
// @output -- responsive-safe Stage 02 markup for scopes, groups, checks, and detail facts
// @pos    -- static-render regression guard for the marketing Agent Diagnosis surface

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import {
  buildAgentAuditViewModel,
  type AgentDiagnosisContext,
} from "./agent-audit-model";
import { AgentDiagnosis } from "./agent-diagnosis";

const messages = {
  agents: {
    workbench: {
      diagnosis: {
        eyebrow: "Stage 02 · Diagnosis",
        title: { seo: "Search diagnosis", tech: "Technical diagnosis" },
        description: {
          seo: "Inspect search evidence.",
          tech: "Inspect technical evidence.",
        },
        context: {
          confirmed: "Confirmed context",
          draft: "Draft context",
          country: "Country",
          locale: "Locale",
          device: "Device",
          pageType: "Page type",
          targetQuery: "Target query",
        },
        scopeLabel: "Audit scope",
        scopes: { site: "Site", page: "Page" },
        scopeSummary: "{groups} groups · {total} checks",
        blockers: "Blockers",
        blockersHint: "Counted separately",
        health: "Health",
        healthUnavailable: "Unavailable",
        healthHint: "Excluded checks never become zero.",
        evaluatedTotal: "{evaluated} / {total} evaluated",
        engineCoverage: "{ready} / {total} engines ready",
        groupsLabel: "Groups",
        checksLabel: "Checks",
        selectCheck: "Inspect {check}",
        detailLabel: "Focused check",
        detail: {
          measuredValue: "Measured value",
          threshold: "Threshold / rule",
          thresholdAuthority: "Threshold authority",
          impact: "Impact",
          howToFix: "How to fix",
          dataSource: "Data source",
          scoreContribution: "Score contribution",
          boundary: "Boundary / unknown",
        },
        axes: { result: "Result", engine: "Engine", truth: "Truth" },
        results: {
          blocker: "Blocker",
          warning: "Warning",
          tip: "Tip",
          pass: "Pass",
          excluded: "Excluded",
        },
        engines: {
          ready: "Ready",
          needsIntegration: "Needs integration",
          needsSupplement: "Needs supplement",
          notIntegrated: "Not integrated",
          accessRequired: "Access required",
        },
        truth: {
          observed: "Observed",
          documented: "Documented",
          inferred: "Inferred",
          partial: "Partial",
          sourceGated: "Source gated",
          unavailable: "Unavailable",
          illustrative: "Illustrative",
        },
        excludedBoundary:
          "Unavailable and source-gated checks are excluded, never zero or pass.",
        headingPreset: {
          label: "Heading soft preset",
          range: "H2 {h2Min}–{h2Max} · H3 {h3Min}–{h3Max} · {words}+ words",
          softRule: "Soft guidance only · never a blocker",
          boundary: "Confirm applicability for this page role.",
        },
        noCheckSelected: "Select a check to inspect its evidence contract.",
      },
    },
  },
};

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

function render(scope: "site" | "page", selectedGroupId: string): string {
  const model = buildAgentAuditViewModel({
    agent: "seo",
    locale: "en",
    context,
    data,
  });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <AgentDiagnosis
        model={model}
        scope={scope}
        selectedGroupId={selectedGroupId}
        selectedCheckId={null}
        onScopeChange={vi.fn()}
        onGroupChange={vi.fn()}
        onCheckChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentDiagnosis", () => {
  it("renders confirmed context, explicit scopes, and honest scope metrics", () => {
    const html = render("site", "E");

    expect(html).toContain('data-testid="agent-diagnosis"');
    expect(html).toContain("Confirmed context");
    expect(html).toContain("AstrologyWiki");
    expect(html).toContain("United States");
    expect(html).toContain('data-testid="diagnosis-scope-site"');
    expect(html).toContain('data-testid="diagnosis-scope-page"');
    expect(html).toContain("5 groups · 27 checks");
    expect(html).toContain("0 / 27 evaluated");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("0/100");
  });

  it("renders the complete selected-group ledger and focused explainability detail", () => {
    const html = render("page", "9");

    expect(html).toContain("9 groups · 50 checks");
    expect(html).toContain('data-testid="diagnosis-group-9"');
    expect(html).toContain('data-testid="diagnosis-check-9.1"');
    expect(html).toContain("Measured value");
    expect(html).toContain("Threshold / rule");
    expect(html).toContain("Threshold authority");
    expect(html).toContain("Impact");
    expect(html).toContain("How to fix");
    expect(html).toContain("Data source");
    expect(html).toContain("Score contribution");
    expect(html).toContain("Boundary / unknown");
    expect(html).toContain("Excluded");
    expect(html).toContain("Source gated");
  });

  it("discloses the page-type heading preset as non-blocking policy", () => {
    const html = render("page", "3");

    expect(html).toContain("H2 5–9 · H3 6–18 · 60+ words");
    expect(html).toContain("Soft guidance only · never a blocker");
    expect(html).toContain("Confirm applicability for this page role.");
  });

  it("uses responsive document flow without nested vertical scroll containers", () => {
    const html = render("site", "E");

    expect(html).toContain("lg:grid-cols");
    expect(html).not.toMatch(/overflow-y-(?:auto|scroll)/);
    expect(html).not.toMatch(/max-h-\[/);
  });
});
