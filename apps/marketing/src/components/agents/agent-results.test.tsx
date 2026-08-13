// @input  -- guarded Agent success data rendered with the real English catalog
// @output -- regression coverage for reach ordering, evidence, and preview boundaries
// @pos    -- static-render guard for the shared SEO/Tech Agent report surface

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { AgentResults } from "./agent-results";

function record(
  id: string,
  affected: number,
  overrides: Partial<SeoAuditRecord> = {},
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: affected > 0 ? "observed" : "not_observed",
    unit: "pages",
    tested: 12,
    affected,
    observations:
      affected > 0
        ? [
            {
              url: `https://example.com/${id}`,
              values: [{ label: "title", value: null }],
            },
          ]
        : [],
    limitation: null,
    ...overrides,
  };
}

const data: AgentAuditSuccessData = {
  run: {
    agent: "seo",
    mode: "authenticated_agent",
    persistence: "none",
    source: {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v3",
      completedAt: "2026-08-12T00:00:00.000Z",
      cache: { status: "miss", capturedAt: null },
    },
  },
  result: {
    targetUrl: "https://example.com",
    siteOrigin: "https://example.com",
    scannedAt: "2026-08-12T00:00:00.000Z",
    coverage: {
      availability: "partial",
      pagesInspected: 12,
      linksObserved: 48,
      sitemapUrlsObserved: 15,
      urlsSkipped: 1,
      urlsBlocked: 2,
      urlsDisallowed: 3,
      urlsErrored: 4,
      stopReason: "max_pages",
    },
    siteResources: {
      robotsFetched: true,
      robotsGroupsObserved: 1,
      sitemapReferencesObserved: 1,
      sitemapFetched: false,
    },
    records: [
      record("title_missing", 2),
      record("title_duplicate", 9, {
        limitation: "normalised_text_match_within_inspected_pages",
      }),
      record("meta_description_missing", 1),
      record("meta_description_duplicate", 4),
      record("h1_missing", 0, {
        category: "structure",
        state: "unverified",
        tested: 0,
      }),
    ],
  },
};

function render(selectedId: string | null = null): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={{ agents: en.agents, tools: { seoAudit: en.tools.seoAudit } }}
    >
      <AgentResults
        agent="seo"
        locale="en"
        data={data}
        selectedId={selectedId}
        onSelect={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function renderUnavailable(locale: "en" | "zh"): string {
  const messages = locale === "zh" ? zh : en;
  const unavailableData: AgentAuditSuccessData = {
    ...data,
    result: {
      ...data.result,
      coverage: {
        ...data.result.coverage,
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
    },
  };

  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={{
        agents: messages.agents,
        tools: { seoAudit: messages.tools.seoAudit },
      }}
    >
      <AgentResults
        agent="seo"
        locale={locale}
        data={unavailableData}
        selectedId={null}
        onSelect={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentResults", () => {
  it("renders real capture and coverage facts without a score", () => {
    const html = render();
    expect(html).toContain("https://example.com");
    expect(html).toContain("Pages inspected");
    expect(html).toContain(">12<");
    expect(html).toContain("Known URLs not collected");
    expect(html).toContain(">10<");
    expect(html).toContain("1</p><p");
    expect(html.toLocaleLowerCase("en-US")).not.toContain("health score");
  });

  it.each([
    ["en" as const, "Known URLs not collected", "Unavailable"],
    ["zh" as const, "已知未采集 URL", "不可用"],
  ])(
    "renders unavailable not-collected reach in %s instead of a numeric zero",
    (locale, label, unavailable) => {
      const html = renderUnavailable(locale);
      const metric = html.slice(html.indexOf(label), html.indexOf(label) + 240);

      expect(metric).toContain(`>${unavailable}<`);
      expect(metric).not.toContain(">0<");
    },
  );

  it("shows only the top three issue records ordered by reach", () => {
    const html = render();
    const ids = [
      ...html.matchAll(/data-testid="agent-opportunity-([a-z0-9_]+)"/g),
    ].map((match) => match[1]);
    expect(ids).toEqual([
      "title_duplicate",
      "meta_description_duplicate",
      "title_missing",
    ]);
    expect(html).toContain(
      "Reach is not severity, predicted traffic impact, or an automatic priority.",
    );
  });

  it("preserves evidence and limitation in a not-applied selected template", () => {
    const html = render("title_duplicate");
    const solution = html.slice(
      html.indexOf('data-testid="agent-selected-solution"'),
    );
    expect(solution).toContain("https://example.com/title_duplicate");
    expect(solution).toContain("Title text");
    expect(solution).toContain(
      "Duplicate groups use case-insensitive, whitespace-normalised text",
    );
    expect(solution).toContain("Adaptable preview · not applied");
    expect(solution).toContain("title: [descriptive page title]");
    expect(solution).toContain("has not edited, applied, approved, published");
  });
});
