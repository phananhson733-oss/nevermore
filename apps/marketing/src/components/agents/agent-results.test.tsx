// @vitest-environment jsdom
// @input  -- one bounded Agent response plus a confirmed Agent-local Profile
// @output -- integration proof for the independent four-stage result workflow
// @pos    -- client-state guard connecting Profile, Diagnosis, Recommendations, and Solution

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeoAuditRecord } from "@sf/public-tools";
import { AGENT_AUDIT_COVERAGE } from "@sf/public-tools/agent-audit";
import type {
  AgentAuditSuccessData,
  AgentKeyPageCandidate,
  AgentKeyPageReason,
} from "../../lib/agents/audit-contract";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
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
      schemaVersion: "seo_audit.sitewide.v18",
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

function keyPage(
  url: string,
  reason: AgentKeyPageReason,
): AgentKeyPageCandidate {
  return {
    url,
    title: null,
    metaDescription: null,
    depth: 1,
    inboundLinks:
      typeof reason === "object" && reason.kind === "content"
        ? reason.inboundLinks
        : 1,
    reason,
  };
}

const selectionData: AgentAuditSuccessData = {
  ...evidencedData,
  result: {
    ...evidencedData.result,
    targetUrl: `${TARGET_URL}/submitted`,
    inspectedTargetUrl: `${TARGET_URL}/submitted`,
    landedTargetUrl: `${TARGET_URL}/submitted`,
    keyPages: [
      keyPage(`${TARGET_URL}/`, "home"),
      keyPage(`${TARGET_URL}/submitted`, "target"),
      keyPage(`${TARGET_URL}/pricing`, "navigation"),
      keyPage(`${TARGET_URL}/docs`, "navigation"),
      keyPage(`${TARGET_URL}/tools/alpha`, {
        kind: "cluster",
        prefix: "/tools/",
      }),
      keyPage(`${TARGET_URL}/tools/beta`, {
        kind: "cluster",
        prefix: "/tools/",
      }),
      keyPage(`${TARGET_URL}/agents/seo`, {
        kind: "cluster",
        prefix: "/agents/",
      }),
      keyPage(`${TARGET_URL}/blog/guide`, {
        kind: "content",
        inboundLinks: 8,
      }),
      keyPage(`${TARGET_URL}/manual`, "manual"),
    ],
    keyPageSelection: {
      omittedUrls: [
        `${TARGET_URL}/blog/omitted-one`,
        `${TARGET_URL}/blog/omitted-two`,
      ],
      manualUnavailableUrls: [
        `${TARGET_URL}/private/manual-one`,
        `${TARGET_URL}/private/manual-two`,
      ],
    },
  },
};

const fullSiteSelectionData: AgentAuditSuccessData = {
  ...evidencedData,
  result: {
    ...evidencedData.result,
    crawlTier: "full-site",
    keyPages: [
      keyPage(`${TARGET_URL}/`, "home"),
      keyPage(`${TARGET_URL}/about`, "full-site"),
    ],
    keyPageSelection: {
      omittedUrls: [],
      manualUnavailableUrls: [],
    },
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
      uiLocale = "en",
      onChooseFullSite,
    }: {
      readonly pageOnly?: boolean;
      readonly response?: AgentAuditSuccessData;
      readonly uiLocale?: "en" | "zh";
      readonly onChooseFullSite?: () => void;
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
          locale={uiLocale}
          timeZone="UTC"
          messages={{
            agents: (uiLocale === "zh" ? zh : en).agents,
            tools: {
              seoAudit: (uiLocale === "zh" ? zh : en).tools.seoAudit,
            },
          }}
        >
          <AgentResults
            agent={agent}
            locale={uiLocale}
            data={{ ...response, run: { ...response.run, agent } }}
            profile={profile}
            {...(onChooseFullSite ? { onChooseFullSite } : {})}
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

  it.each(["en", "zh"] as const)("explains full-site-only exclusions and offers an explicit scope change in %s", (uiLocale) => {
    const onChooseFullSite = vi.fn();
    const response: AgentAuditSuccessData = {
      ...evidencedData,
      result: {
        ...evidencedData.result,
        crawlTier: "key-pages",
        records: ["sitemap_page_without_observed_inlink", "internal_target_http_error", "page_without_any_discovery_path"].map((id) => ({
          ...observedRecord(id, []),
          state: "unverified",
          tested: 0,
          limitation: "full_site_only",
        })),
      },
    };
    render("seo", { response, uiLocale, onChooseFullSite });
    for (const id of ["C1", "C2", "C5"]) {
      const row = host.querySelector(`[data-quiet-issue="seo:site:${id}"]`);
      expect(row?.textContent).toContain(uiLocale === "zh" ? "关键页档不执行此项" : "Not run in the key-pages scope");
      expect(row?.textContent).toContain(uiLocale === "zh" ? "全站" : "full-site");
    }
    const action = host.querySelector<HTMLButtonElement>("[data-choose-full-site]");
    expect(action).not.toBeNull();
    expect(onChooseFullSite).not.toHaveBeenCalled();
    act(() => action?.click());
    expect(onChooseFullSite).toHaveBeenCalledOnce();
  });

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

  it("connects captured evidence to the issue list without inventing a score", () => {
    render("seo", { response: evidencedData });

    expect(host.textContent).toContain("Stage 02 · Captured report");
    expect(host.textContent).toContain("Reading results · issue first");
    expect(accordion()).not.toBeNull();
    expect(host.textContent).not.toContain("0/100");
  });

  it("states the run in one line and folds the collection detail away", () => {
    // The header used to open with a four-cell grid of counts, two boundary
    // cards and an origin line before the reader reached a single finding.
    // What survives above the fold is the one line that says how much was
    // looked at; the rest is still there, one disclosure away.
    render("seo", { response: evidencedData });

    const summary = host.querySelector("[data-capture-summary]");
    expect(summary?.textContent).toContain("pages crawled");
    expect(summary?.textContent).toContain("checks evaluated");

    const detail = host.querySelector<HTMLDetailsElement>(
      "[data-capture-detail]",
    );
    expect(detail).not.toBeNull();
    expect(detail?.open).toBe(false);
    // The counts did not disappear, they moved.
    expect(detail?.textContent).toContain("Links observed");
    expect(detail?.textContent).toContain("Final public origin");
  });

  it("says so when only the submitted page could be judged", () => {
    // A run that judged one page looks exactly like one that judged twelve
    // unless it says which happened.
    render("seo", { response: evidencedData });

    expect(host.querySelector("[data-key-pages-none]")).not.toBeNull();
    expect(host.textContent).toContain("submitted URL only");
  });

  it("does not print a key page count beside a line denying there are any", () => {
    // The submitted page is always judged, from a synthetic row when it is not
    // a candidate, so the count is never zero. A count-based condition read
    // "1 key page" in the header and "no key pages" directly beneath it.
    render("seo", { response: evidencedData });

    const summary =
      host.querySelector("[data-capture-summary]")?.textContent ?? "";
    const denial = host.querySelector("[data-key-pages-none]");

    expect(denial).not.toBeNull();
    expect(summary).not.toMatch(/[1-9]\d* key pages/);
  });

  it("reports the captured header count as evidence records, not as evaluated checks", () => {
    render("seo", { response: evidencedData });

    expect(host.textContent).not.toContain("Evaluated relevant checks");
    expect(host.textContent).toContain("9 / 9");
    expect(host.textContent).toContain("9 observed · 0 not observed");
  });

  it.each([
    [
      "en" as const,
      [
        "9 candidates",
        "navigation 2",
        "cluster pages 3",
        "content 1",
        "manual 1",
        "up to 15 by inbound links among pages collected in this run",
        "reduced to 10 or 5 when the 50-page safety valve applies",
      ],
      "Not included in page-level checks by the safety valve",
      "Manually added but could not be crawled or evaluated",
    ],
    [
      "zh" as const,
      [
        "候选页 9 个",
        "导航 2",
        "集群页 3",
        "内容 1",
        "手动 1",
        "按本次已收集页入链最多 15",
        "总候选超过 50 时收紧到 10 或 5",
      ],
      "安全阀未纳入页面级检查",
      "手动追加但未能抓取/评估",
    ],
  ])(
    "renders the %s candidate breakdown, prefixes and exact omissions",
    (uiLocale, phrases, omittedHeading, manualUnavailableHeading) => {
      render("seo", { response: selectionData, uiLocale });

      const summary = host.querySelector("[data-key-page-selection-summary]");
      expect(summary).not.toBeNull();
      for (const phrase of phrases) {
        expect(summary?.textContent).toContain(phrase);
      }
      expect(summary?.textContent).not.toMatch(/top 15|取前 15/iu);
      expect(summary?.textContent).not.toMatch(
        /full-site remainder|全站其余页/iu,
      );
      expect(summary?.textContent).toContain("/agents/");
      expect(summary?.textContent).toContain("/tools/");
      expect(summary?.textContent).toMatch(/home|首页/iu);
      expect(summary?.textContent).toMatch(/submitted|提交页/u);

      const omitted = host.querySelector("[data-key-page-omitted]");
      expect(omitted?.textContent).toContain(omittedHeading);
      expect(omitted?.querySelectorAll("li")).toHaveLength(2);
      expect(omitted?.textContent).toContain(
        `${TARGET_URL}/blog/omitted-one`,
      );
      expect(omitted?.textContent).toContain(
        `${TARGET_URL}/blog/omitted-two`,
      );
      expect(omitted?.textContent).not.toContain(
        `${TARGET_URL}/private/manual-one`,
      );

      const manualUnavailable = host.querySelector(
        "[data-key-page-manual-unavailable]",
      );
      expect(manualUnavailable?.textContent).toContain(
        manualUnavailableHeading,
      );
      expect(manualUnavailable?.querySelectorAll("li")).toHaveLength(2);
      expect(manualUnavailable?.textContent).toContain(
        `${TARGET_URL}/private/manual-one`,
      );
      expect(manualUnavailable?.textContent).toContain(
        `${TARGET_URL}/private/manual-two`,
      );
    },
  );

  it.each([
    ["en" as const, "full-site remainder 1", "evaluable collected pages"],
    ["zh" as const, "全站其余页 1", "可评估的已收集页面"],
  ])("renders the %s full-site remainder honestly", (uiLocale, phrase, scope) => {
    render("seo", { response: fullSiteSelectionData, uiLocale });

    expect(
      host.querySelector("[data-key-page-selection-summary]")?.textContent,
    ).toContain(phrase);
    const capture = host.querySelector("[data-capture-summary]")?.textContent;
    expect(capture).toContain(scope);
    expect(capture).not.toMatch(/key pages|关键页/u);
  });

  it("does not describe a Tech full-site crawl shortlist as all-collected page evaluation", () => {
    const techData: AgentAuditSuccessData = {
      ...selectionData,
      run: { ...selectionData.run, agent: "tech" },
      result: {
        ...selectionData.result,
        crawlTier: "full-site",
      },
    };

    render("tech", { response: techData });

    const capture = host.querySelector("[data-capture-summary]")?.textContent;
    const selection = host.querySelector(
      "[data-key-page-selection-summary]",
    )?.textContent;
    expect(capture).toContain("key pages");
    expect(capture).not.toContain("evaluable collected pages");
    expect(selection).not.toContain("full-site remainder");
  });

  it("does not count the synthetic target as a server-selected candidate", () => {
    const candidateUrl = `${TARGET_URL}/pricing`;
    const captureFailed: AgentAuditSuccessData = {
      ...evidencedData,
      result: {
        ...evidencedData.result,
        targetUrl: `${TARGET_URL}/submitted`,
        targetInspected: false,
        inspectedTargetUrl: null,
        landedTargetUrl: null,
        keyPages: [keyPage(candidateUrl, "navigation")],
        keyPageSelection: { omittedUrls: [] },
      },
    };

    render("seo", { response: captureFailed });

    expect(host.querySelector("[data-capture-summary]")?.textContent).toContain(
      "1 key pages",
    );
    const selection = host.querySelector(
      "[data-key-page-selection-summary]",
    );
    expect(selection?.textContent).toContain("1 candidates");
    expect(selection?.textContent).toContain("navigation 1");
    expect(selection?.textContent).not.toContain("2 candidates");
  });

  it("shows site-wide and page-level findings in one list", () => {
    // The scope switch is gone: a reader should not have to know that a
    // duplicate-title problem is filed under "site" and a missing H1 under
    // "page" to find either of them. One list, and the row says its own scope.
    render("seo", { response: evidencedData });

    expect(host.querySelector('[data-issue-row^="seo:site:"]')).not.toBeNull();
    expect(host.querySelector('[data-issue-row^="seo:page:"]')).not.toBeNull();
    expect(host.querySelector('[data-testid^="diagnosis-scope-"]')).toBeNull();
    expect(host.querySelector('[data-testid^="diagnosis-group-"]')).toBeNull();
  });

  /**
   * The surface this replaced showed three recommendations and disclosed the
   * rest as a number. Showing every issue removes that gap, so what has to be
   * guarded now is the stronger property: no check is dropped on the way to a
   * lane, and nothing is silently capped.
   */
  it("lands every check in exactly one lane", () => {
    render("seo", { response: evidencedData });

    const actionable = Number(
      accordion()?.getAttribute("data-actionable-count"),
    );
    expect(issueRows()).toHaveLength(actionable);
    // The replaced surface capped the list at three.
    expect(actionable).toBeGreaterThan(3);
    expect(lanedCheckCount()).toBe(AGENT_AUDIT_COVERAGE.total);
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
    expect(lanedCheckCount()).toBe(AGENT_AUDIT_COVERAGE.total);
  });

  it("uses Tech defaults and keeps its issue identity independent", () => {
    render("tech", { response: evidencedData });

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

  it("renders no local policy control anywhere on the surface", () => {
    // These were only ever reachable through the diagnosis ledger, which this
    // surface no longer has. Asserted on the whole surface rather than on the
    // deleted panel, so the guarantee survives the panel that carried it.
    render("seo", { response: evidencedData });

    expect(host.querySelector('[data-testid^="diagnosis-policy-"]')).toBeNull();
    expect(host.querySelector("[data-policy-threshold]")).toBeNull();
    expect(host.querySelector("[data-policy-weight]")).toBeNull();
    expect(host.querySelector("[data-policy-action]")).toBeNull();
    expect(host.textContent).not.toContain("Local policy control");
  });
});
