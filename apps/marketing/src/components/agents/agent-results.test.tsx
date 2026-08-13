// @vitest-environment jsdom
// @input  -- one bounded Agent response plus a confirmed Agent-local Profile
// @output -- integration proof for the independent four-stage result workflow
// @pos    -- client-state guard connecting Profile, Diagnosis, Recommendations, and Solution

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import en from "../../i18n/messages/en.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentResults } from "./agent-results";

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
    targetUrl: "https://example.com",
    siteOrigin: "https://example.com",
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

describe("AgentResults", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function render(agent: "seo" | "tech", pageOnly = false): void {
    const draft = updateAgentProfile(
      createAgentProfileDraft(agent, "https://example.com"),
      {
        country: "US",
        locale: "en-US",
        pageType: "tool",
        targetQuery: "technical seo audit",
        auditScope: pageOnly ? "page-only" : "site-first",
      },
    );
    const profile = confirmAgentProfile(draft);

    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{
            agents: en.agents,
            tools: { seoAudit: en.tools.seoAudit },
          }}
        >
          <AgentResults
            agent={agent}
            locale="en"
            data={{ ...data, run: { ...data.run, agent } }}
            profile={profile}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("connects captured evidence to all four review stages without inventing a score", () => {
    render("seo");

    expect(host.textContent).toContain("Stage 02 · Captured report");
    expect(host.textContent).toContain("Stage 02 · Diagnosis");
    expect(host.textContent).toContain("Stage 03 · Recommendations");
    expect(host.textContent).toContain(
      "Stage 04 · Selected solution & validation",
    );
    expect(host.textContent).toContain("5 groups · 27 checks");
    expect(host.textContent).toContain("Page · 9 groups / 50 checks");
    expect(host.textContent).toContain("Unavailable");
    expect(host.textContent).not.toContain("0/100");
  });

  it("uses SEO defaults and preserves separate site/page group selections", () => {
    render("seo");

    expect(
      host
        .querySelector('[data-testid="diagnosis-group-E"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-scope-page"]')
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-9"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-group-2"]')
        ?.click();
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-scope-site"]')
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-E"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-scope-page"]')
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-2"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps Recommendations and Selected Solution inside the active scope", () => {
    render("seo");

    expect(
      host.querySelector('[data-testid^="agent-recommendation-seo:site:"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid^="agent-recommendation-seo:page:"]'),
    ).toBeNull();

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-scope-page"]')
        ?.click();
    });

    expect(
      host.querySelector('[data-testid^="agent-recommendation-seo:site:"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid^="agent-recommendation-seo:page:"]'),
    ).not.toBeNull();
  });

  it("uses Tech defaults and keeps its solution identity independent", () => {
    render("tech");

    expect(
      host
        .querySelector('[data-testid="diagnosis-group-A"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(host.querySelector("#tech-selected-solution")).not.toBeNull();
    expect(host.querySelector("#seo-selected-solution")).toBeNull();
    expect(host.textContent).toContain("Tech Agent fix review");
  });

  it("honors a confirmed page-only Profile as the initial audit scope", () => {
    render("seo", true);

    expect(
      host
        .querySelector('[data-testid="diagnosis-scope-page"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-9"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("saves and resets a non-Official local policy without rejudging the run", () => {
    render("seo", true);
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-group-3"]')
        ?.click();
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-check-3.4"]')
        ?.click();
    });

    const initialHealth = host.textContent?.match(/Health[^0-9]*(\d+\/100|Unavailable)/)?.[1];
    const threshold = host.querySelector<HTMLInputElement>(
      '[data-policy-threshold="3.4"]',
    );
    expect(threshold?.disabled).toBe(false);
    act(() => {
      if (threshold) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(threshold, "Local H2 range 2–7");
        threshold.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-policy-action="save"]')
        ?.click();
    });

    expect(host.textContent).toContain("Local H2 range 2–7");
    expect(host.textContent).toContain("A new real run is required");
    expect(host.textContent?.match(/Health[^0-9]*(\d+\/100|Unavailable)/)?.[1]).toBe(
      initialHealth,
    );

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-policy-action="reset-check"]')
        ?.click();
    });
    expect(host.textContent).not.toContain("Local H2 range 2–7");
    expect(host.textContent).toContain("Tool landing soft range: H2 5–9");
  });

  it("locks an Official threshold while leaving the non-blocking weight reviewable", () => {
    render("tech", true);
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-group-8"]')
        ?.click();
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-check-8.1"]')
        ?.click();
    });

    expect(
      host.querySelector<HTMLInputElement>('[data-policy-threshold="8.1"]')
        ?.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('[data-policy-weight="8.1"]')
        ?.disabled,
    ).toBe(false);
    expect(host.textContent).toContain("Official threshold is locked");
  });
});
