// @vitest-environment jsdom
// @input  -- one bounded Agent response plus a confirmed Agent-local Profile
// @output -- integration proof for the independent four-stage result workflow
// @pos    -- client-state guard connecting Profile, Diagnosis, Recommendations, and Solution

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import en from "../../i18n/messages/en.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentResults } from "./agent-results";

const TARGET_URL = "https://example.com";

const data: AgentAuditSuccessData = {
  run: {
    agent: "seo",
    mode: "authenticated_agent",
    persistence: "none",
    source: {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v17",
      completedAt: "2026-08-13T00:00:00.000Z",
      cache: { status: "miss", capturedAt: null },
    },
  },
  result: {
    targetUrl: TARGET_URL,
    siteOrigin: "https://example.com",
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

function observedRecord(
  id: string,
  urls: readonly string[],
  unit: SeoAuditRecord["unit"] = "pages",
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    population: "every_collected_page",
    targetTested: null,
    unit,
    tested: 6,
    affected: urls.length,
    observations: urls.map((url) => ({ url, values: [] })),
    limitation: null,
  };
}

/**
 * A run that actually collected evidence: five site-scope and six page-scope
 * issue conditions, so Stage 03 has more candidates than it can display.
 */
const evidencedData: AgentAuditSuccessData = {
  ...data,
  result: {
    ...data.result,
    coverage: {
      availability: "available",
      pagesInspected: 6,
      linksObserved: 20,
      sitemapUrlsObserved: 4,
      urlsSkipped: 1,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 1,
      stopReason: null,
    },
    siteResources: {
      robotsFetched: true,
      robotsGroupsObserved: 1,
      sitemapReferencesObserved: 1,
      sitemapFetched: true,
      sitemapUrls: [],
      sitemapUrlsComplete: true,
    },
    records: [
      observedRecord("noindex_directive", [TARGET_URL]),
      observedRecord("canonical_missing", [TARGET_URL]),
      observedRecord("page_not_in_sitemap", [
        TARGET_URL,
        "https://example.com/blog",
      ]),
      observedRecord("meta_description_duplicate", [
        TARGET_URL,
        "https://example.com/blog",
        "https://example.com/a",
        "https://example.com/b",
      ]),
      observedRecord("h1_missing", [TARGET_URL, "https://example.com/a"]),
      observedRecord("title_length_outside_range", [TARGET_URL]),
      observedRecord("internal_target_http_error", [
        "https://example.com/gone",
      ]),
      observedRecord("sitemap_page_without_observed_inlink", [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ]),
      observedRecord("click_depth_beyond_reviewed_limit", [
        "https://example.com/deep",
      ]),
    ],
  },
};

describe("AgentResults", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function render(
    agent: "seo" | "tech",
    {
      pageOnly = false,
      response = data,
    }: {
      readonly pageOnly?: boolean;
      readonly response?: AgentAuditSuccessData;
    } = {},
  ): void {
    const draft = updateAgentProfile(
      createAgentProfileDraft(agent, TARGET_URL),
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
            data={{ ...response, run: { ...response.run, agent } }}
            profile={profile}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function accordion(): HTMLElement | null {
    return host.querySelector<HTMLElement>(
      '[data-testid="agent-issue-accordion"]',
    );
  }

  it("names the landed page when the crawl was redirected across pages", () => {
    // This route does not require the entry to keep its subject, so a URL that
    // redirects across pages produces a report HERE -- of the destination,
    // under a heading naming the URL that was typed. The On-Page Checker never
    // reaches this state: `requireSameEntrySubject` refuses the run with
    // `target_redirected` before a report exists.
    const redirected = structuredClone(data) as unknown as {
      result: {
        targetUrl: string;
        inspectedTargetUrl: string;
        landedTargetUrl: string;
      };
    };
    // The submitted URL and the requested one are the same page here, which is
    // what a real run looks like: the canonical form of a tracking short link
    // is still that short link. Only the LANDED URL is a different page.
    redirected.result.targetUrl = "https://example.com/go/abc123";
    redirected.result.inspectedTargetUrl = "https://example.com/go/abc123";
    redirected.result.landedTargetUrl = "https://example.com/";

    render("seo", { response: redirected as unknown as AgentAuditSuccessData });

    const line = host.querySelector("[data-capture-landed]");
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain("https://example.com/");
    // Beside the submitted URL, not instead of it: the heading has to be able
    // to say "you asked for A, this is B".
    expect(host.textContent).toContain("https://example.com/go/abc123");
  });

  it("says nothing about a redirect when only the submitted string was normalised", () => {
    // The trap this guard exists for. `targetUrl` is the submitted string kept
    // verbatim; `inspectedTargetUrl` is its canonical form with `utm_*`
    // stripped and the host lowercased. Comparing the landed URL to the
    // SUBMITTED one prints "redirected" on an ordinary paste from an email --
    // a normalisation, not a redirect. The comparison is against the requested
    // URL for exactly this reason.
    const normalised = structuredClone(data) as unknown as {
      result: {
        targetUrl: string;
        inspectedTargetUrl: string;
        landedTargetUrl: string;
      };
    };
    normalised.result.targetUrl =
      "https://Example.com/pricing?utm_source=newsletter";
    normalised.result.inspectedTargetUrl = "https://example.com/pricing";
    normalised.result.landedTargetUrl = "https://example.com/pricing";

    render("seo", { response: normalised as unknown as AgentAuditSuccessData });

    expect(host.querySelector("[data-capture-landed]")).toBeNull();
  });

  function issueRows(): readonly HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>("[data-issue-row]")];
  }

  /** Every check in the active scope lands in exactly one lane. */
  function lanedCheckCount(): number {
    return (
      issueRows().length + host.querySelectorAll("[data-quiet-issue]").length
    );
  }

  it("connects captured evidence to the diagnosis and the issue list without inventing a score", () => {
    render("seo", { response: evidencedData });

    expect(host.textContent).toContain("Stage 02 · Captured report");
    expect(host.textContent).toContain("Stage 02 · Diagnosis");
    expect(host.textContent).toContain("Reading results · issue first");
    expect(accordion()).not.toBeNull();
    expect(host.textContent).toContain("5 groups · 31 checks");
    expect(host.textContent).toContain("Page · 9 groups / 49 checks");
    expect(host.textContent).not.toContain("0/100");
  });

  it("reports the captured header count as evidence records, not as evaluated checks", () => {
    render("seo", { response: evidencedData });

    expect(host.textContent).not.toContain("Evaluated relevant checks");
    expect(host.textContent).toContain("9 / 9");
    expect(host.textContent).toContain("9 observed · 0 not observed");
  });

  it("uses SEO defaults and preserves separate site/page group selections", () => {
    render("seo");

    expect(
      host
        .querySelector('[data-testid="diagnosis-group-D"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="diagnosis-scope-page"]',
        )
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-2"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="diagnosis-group-2"]')
        ?.click();
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="diagnosis-scope-site"]',
        )
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-D"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="diagnosis-scope-page"]',
        )
        ?.click();
    });
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-2"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the issue list inside the active scope", () => {
    render("seo", { response: evidencedData });

    expect(host.querySelector('[data-issue-row^="seo:site:"]')).not.toBeNull();
    expect(host.querySelector('[data-issue-row^="seo:page:"]')).toBeNull();

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="diagnosis-scope-page"]',
        )
        ?.click();
    });

    expect(host.querySelector('[data-issue-row^="seo:site:"]')).toBeNull();
    expect(host.querySelector('[data-issue-row^="seo:page:"]')).not.toBeNull();
  });

  /**
   * The surface this replaced showed three recommendations and disclosed the
   * rest as a number. Showing every issue removes that gap, so what has to be
   * guarded now is the stronger property: no check is dropped on the way to a
   * lane, and nothing is silently capped.
   */
  it("lands every check of the active scope in exactly one lane", () => {
    render("seo", { response: evidencedData });

    const actionable = Number(
      accordion()?.getAttribute("data-actionable-count"),
    );
    expect(issueRows()).toHaveLength(actionable);
    // The replaced surface capped the list at three.
    expect(actionable).toBeGreaterThan(3);
    expect(lanedCheckCount()).toBe(31);

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="diagnosis-scope-page"]',
        )
        ?.click();
    });

    expect(issueRows()).toHaveLength(
      Number(accordion()?.getAttribute("data-actionable-count")),
    );
    expect(lanedCheckCount()).toBe(49);
  });

  it("offers investigation rows, not a verdict, when no check could be evaluated", () => {
    render("seo");

    expect(host.textContent).toContain("Unavailable");
    // Nothing was observed, so no severity may appear...
    expect(host.querySelector('[data-issue-severity="blocker"]')).toBeNull();
    expect(host.querySelector('[data-issue-severity="warning"]')).toBeNull();
    // ...but the gated checks are still open questions, not a clean run.
    expect(
      host.querySelector('[data-issue-lane="investigation"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="agent-issues-clean"]')).toBeNull();
    expect(host.textContent).toContain("Affected population unavailable");
    expect(lanedCheckCount()).toBe(31);
  });

  it("uses Tech defaults and keeps its issue identity independent", () => {
    render("tech", { response: evidencedData });

    expect(
      host
        .querySelector('[data-testid="diagnosis-group-C"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(host.querySelector('[data-issue-row^="tech:"]')).not.toBeNull();
    expect(host.querySelector('[data-issue-row^="seo:"]')).toBeNull();

    // Rows open on request, so the applicable context is asserted where a
    // reader would actually meet it.
    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-issue-control="expand-visible"]',
        )
        ?.click();
    });

    expect(host.textContent).toContain("Page · device · scope");
    expect(host.textContent).not.toContain("Primary CTA");
  });

  it("honors a confirmed page-only Profile as the initial audit scope", () => {
    render("seo", { pageOnly: true });

    expect(
      host
        .querySelector('[data-testid="diagnosis-scope-page"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host
        .querySelector('[data-testid="diagnosis-group-2"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps local policy controls hidden while retaining the accepted default rule", () => {
    render("seo", { pageOnly: true });
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

    expect(host.textContent).toContain("H2 5–9");
    expect(host.querySelector('[data-testid^="diagnosis-policy-"]')).toBeNull();
    expect(host.querySelector("[data-policy-threshold]")).toBeNull();
    expect(host.querySelector("[data-policy-weight]")).toBeNull();
    expect(host.querySelector("[data-policy-action]")).toBeNull();
    expect(host.textContent).not.toContain("Local policy control");
  });
});
