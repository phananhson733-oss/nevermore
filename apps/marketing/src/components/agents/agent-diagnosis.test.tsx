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
          targetQueryUnconfirmed: "Not confirmed",
        },
        scopeLabel: "Audit scope",
        scopes: { site: "Site", page: "Page" },
        scopeSummary: "{groups} groups · {total} checks",
        blockers: "Blockers",
        blockersHint: "Counted separately",
        health: "Health",
        healthUnavailable: "Unavailable",
        healthHint: "Excluded checks never become zero.",
        healthScoredCount: "Derived from {scored} scored checks",
        healthInsufficient: "Not enough evidence for a health score",
        healthInsufficientHint:
          "Scored checks in this scope: {scored}. A single number is withheld below {minimum}.",
        healthPendingSources: "Still waiting on: {sources}",
        healthDimmedReason:
          "Dimmed because blocker checks are open in this scope ({blockers}). Read those before the score.",
        evaluatedTotal: "{evaluated} / {total} evaluated",
        engineCoverage: "{ready} / {total} engines ready",
        inventoryCoverage: "Inventory {ready} / {total}",
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
          notMeasured: "Not measured in this run",
          notScored: "Not scored",
        },
        axes: { result: "Result", engine: "Engine", truth: "Truthfulness" },
        axisLegend: {
          result: "What this run decided for the check.",
          engine: "Whether the detector is integrated and had a source.",
          truth: "How the value was learned.",
        },
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
          accessRequired: "Authorized source required",
        },
        truth: {
          observed: "Observed",
          notObserved: "Not observed in bounded sample",
          documented: "Documented",
          inferred: "Inferred",
          partial: "Partial",
          sourceGated: "Source gated",
          unavailable: "Unavailable",
          illustrative: "Illustrative",
        },
        searchSource: {
          absent:
            "This run did not read Search Console. The search-performance checks stay excluded until it is authorized — signing in with Google is not the same as granting this tool access.",
          connect: "Connect Search Console",
          present:
            "Search performance read from {property}, {start} to {end}.",
          unavailable:
            "Search Console did not answer this run — a timeout or a rate limit. The authorization is fine; run it again shortly.",
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
        authorities: {
          official: "Official standard",
          industry: "Industry practice",
          sop: "Internal SOP",
          judgment: "Internal judgment",
        },
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

type AuditRecord = AgentAuditSuccessData["result"]["records"][number];

const TARGET_URL = "https://astrologywiki.com/chart";

/** Neutral "tested, nothing affected" record; overrides carry the exceptions. */
function record(id: string, overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id,
    category: "crawl",
    state: "not_observed",
    unit: "pages",
    population: "every_collected_page" as const,
    tested: 24,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  };
}

function auditData({
  availability,
  records,
  targetInspected,
  inspectedTargetUrl,
}: {
  readonly availability: AgentAuditSuccessData["result"]["coverage"]["availability"];
  readonly records: readonly AuditRecord[];
  readonly targetInspected: boolean;
  readonly inspectedTargetUrl?: string | null;
}): AgentAuditSuccessData {
  return {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v5",
        completedAt: "2026-08-13T00:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: TARGET_URL,
      siteOrigin: "https://astrologywiki.com",
      scannedAt: "2026-08-13T00:00:00.000Z",
      targetInspected,
      inspectedTargetUrl: inspectedTargetUrl ?? (targetInspected ? TARGET_URL : null),
      targetPageExtract: null,
      coverage: {
        availability,
        pagesInspected: availability === "unavailable" ? 0 : 24,
        linksObserved: availability === "unavailable" ? 0 : 180,
        sitemapUrlsObserved: availability === "unavailable" ? 0 : 24,
        urlsSkipped: 0,
        urlsBlocked: 0,
        urlsDisallowed: 0,
        urlsErrored: 0,
        stopReason:
          availability === "unavailable" ? "crawl_failed" : "complete",
      },
      siteResources: {
        robotsFetched: availability !== "unavailable",
        robotsGroupsObserved: availability === "unavailable" ? 0 : 1,
        sitemapReferencesObserved: availability === "unavailable" ? 0 : 1,
        sitemapFetched: availability !== "unavailable",
      },
      records,
    },
  };
}

/** Nothing was collected at all: every check is excluded. */
const data = auditData({
  availability: "unavailable",
  records: [],
  targetInspected: true,
  inspectedTargetUrl: "https://acme.test/",
});

/**
 * One clean observation. Enough for the evaluator to emit a weighted mean, far
 * too little for that mean to be worth printing as a 0-100 number.
 */
const thinEvidence = auditData({
  availability: "available",
  records: [record("internal_target_http_error", { unit: "link_targets" })],
  targetInspected: true,
  inspectedTargetUrl: "https://acme.test/",
});

/** Several scored checks plus a target-page blocker. */
const richEvidence = auditData({
  availability: "available",
  targetInspected: true,
  inspectedTargetUrl: "https://acme.test/",
  records: [
    record("internal_target_http_error", { unit: "link_targets" }),
    record("meta_description_duplicate", { category: "metadata" }),
    record("title_missing", { category: "metadata" }),
    record("h1_missing", { category: "structure" }),
    record("sitemap_page_without_observed_inlink", { category: "links" }),
    record("click_depth_beyond_reviewed_limit", { category: "structure" }),
    record("non_2xx_final_status", {
      category: "indexability",
      state: "observed",
      affected: 1,
      observations: [
        { url: TARGET_URL, values: [{ label: "final_status", value: 404 }] },
      ],
    }),
  ],
});

function render(
  scope: "site" | "page",
  selectedGroupId: string,
  auditResult: AgentAuditSuccessData = data,
): string {
  const model = buildAgentAuditViewModel({
    agent: "seo",
    locale: "en",
    context,
    data: auditResult,
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

/** Markup of one element, from its test id to the end of its open element. */
/** The rendered <p> carrying an exact sentence, so a size rule names its target. */
function paragraphContaining(html: string, sentence: string): string {
  const end = html.indexOf(sentence);
  expect(end).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<p ", end);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

function element(html: string, testId: string, closingTag: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf(closingTag, start));
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
    expect(html).toContain("5 groups · 31 checks");
    expect(html).toContain("0 / 31 evaluated");
    expect(html).not.toContain("0/100");
  });

  it("renders the complete selected-group ledger and focused explainability detail", () => {
    const html = render("page", "9");

    expect(html).toContain("9 groups · 49 checks");
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

  describe("health evidence floor", () => {
    it("withholds the 0-100 number when too few checks were scored", () => {
      const html = render("site", "C", thinEvidence);

      expect(element(html, "diagnosis-health", "</article>")).toContain(
        'data-health-state="insufficient"',
      );
      expect(html).not.toContain("/100");
      expect(html).toContain("Not enough evidence for a health score");
      expect(html).toContain("Scored checks in this scope: 1.");
      expect(html).toContain("A single number is withheld below 3.");
    });

    it("names the data sources the withheld score is still waiting on", () => {
      const html = render("site", "C", thinEvidence);

      expect(html).toContain("Still waiting on:");
      expect(html).toContain("Authorized search source required");
    });

    it("reports the number with the count of checks behind it once scored", () => {
      const html = render("site", "C", richEvidence);
      const card = element(html, "diagnosis-health", "</article>");

      expect(card).toContain('data-health-state="scored"');
      expect(card).toContain("100/100");
      expect(card).toContain("Derived from 5 scored checks");
      expect(card).not.toContain("Not enough evidence");
    });

    it("does not count evaluated-but-unscored checks toward the floor", () => {
      // Page group 1 is judged and never scored: two of its checks come back as
      // blockers here, and neither may prop up the scored-check count.
      const html = render("page", "1", richEvidence);
      const card = element(html, "diagnosis-health", "</article>");

      expect(card).toContain("Derived from 4 scored checks");
    });

    it("says why the health card is dimmed while blockers are open", () => {
      const withBlockers = element(
        render("page", "1", richEvidence),
        "diagnosis-health",
        "</article>",
      );
      const withoutBlockers = element(
        render("site", "C", richEvidence),
        "diagnosis-health",
        "</article>",
      );

      expect(withBlockers).toContain("opacity-70");
      expect(withBlockers).toContain('data-health-dimmed="true"');
      expect(withBlockers).toContain(
        "Dimmed because blocker checks are open in this scope (2).",
      );
      expect(withoutBlockers).not.toContain("opacity-70");
      expect(withoutBlockers).not.toContain('data-health-dimmed="true"');
    });
  });

  describe("axis badges", () => {
    it("never renders an axis state the evaluator cannot produce", () => {
      const html = [
        render("site", "E", richEvidence),
        render("page", "1", richEvidence),
        render("page", "9", richEvidence),
        render("site", "A"),
      ].join("");

      expect(html).not.toContain("Needs integration");
      expect(html).not.toContain("Documented");
      expect(html).not.toContain("Inferred");
      expect(html).not.toContain("Illustrative");
    });

    it("still labels every reachable axis state", () => {
      const blockers = render("page", "1", richEvidence);
      const passes = render("page", "6", richEvidence);
      const gated = render("site", "E");

      expect(blockers).toContain("Blocker");
      expect(blockers).toContain("Ready");
      expect(blockers).toContain("Observed");
      expect(passes).toContain("Not observed in bounded sample");
      expect(gated).toContain("Source gated");
      expect(gated).toContain("Unavailable");
    });

    it("explains the three axes and points the badges at the explanation", () => {
      const html = render("site", "E", richEvidence);

      expect(html).toContain('data-testid="diagnosis-axis-legend"');
      expect(html).toContain('id="seo-diagnosis-axis-result"');
      expect(html).toContain('id="seo-diagnosis-axis-engine"');
      expect(html).toContain('id="seo-diagnosis-axis-truth"');
      expect(html).toContain("What this run decided for the check.");
      expect(html).toContain(
        "Whether the detector is integrated and had a source.",
      );
      expect(html).toContain("How the value was learned.");
      expect(html).toContain('aria-describedby="seo-diagnosis-axis-result"');
      expect(html).toContain('aria-describedby="seo-diagnosis-axis-engine"');
      expect(html).toContain('aria-describedby="seo-diagnosis-axis-truth"');
    });
  });

  describe("the search source", () => {
    it("keeps the shipped catalogues in step with this fixture", async () => {
      // The fixture above is hand-written, so the component can render a
      // missing key and nothing here would notice: next-intl prints the dotted
      // path instead of throwing, and a `toContain` on the prose passes on the
      // path itself. Reading the real catalogues is the only check that a key
      // this component asks for actually ships.
      const [en, zh] = await Promise.all([
        import("../../i18n/messages/en.json"),
        import("../../i18n/messages/zh.json"),
      ]);
      for (const catalogue of [en.default, zh.default]) {
        const source = (
          catalogue as unknown as {
            agents: {
              workbench: {
                diagnosis: { searchSource?: Record<string, string> };
              };
            };
          }
        ).agents.workbench.diagnosis.searchSource;
        expect(Object.keys(source ?? {}).sort()).toEqual([
          "absent",
          "connect",
          "present",
          "unavailable",
        ]);
      }
    });

    it("says the run did not read Search Console, and offers the grant", () => {
      const html = render("site", "E");
      const notice = element(html, "diagnosis-search-source", "</p>");

      // Six checks report "authorized source required" and, before this, a
      // visitor who had already signed in with Google had no way to learn that
      // signing in is not the same as granting this tool access.
      expect(notice).toContain("did not read Search Console");
      expect(notice).toContain("signing in with Google is not the same");
      expect(notice).toContain(
        "/api/auth/google/start?scope=gsc&amp;next=%2Fagents%2Fseo",
      );
    });

    it("does not offer the grant when the source was simply not answering", () => {
      const html = render("site", "E", {
        ...data,
        result: { ...data.result, searchPerformanceUnavailable: true },
      });
      const notice = element(html, "diagnosis-search-source", "</p>");

      expect(notice).toContain("did not answer this run");
      // Sending a visitor who is already connected back through OAuth would ask
      // them to fix something OAuth cannot.
      expect(notice).not.toContain("/api/auth/google/start");
    });

    it("names the property and window once a grant answered", () => {
      const html = render("site", "E", {
        ...data,
        result: {
          ...data.result,
          searchPerformance: {
            version: "search_performance.agent.v2" as const,
            property: "sc-domain:astrologywiki.com",
            startDate: "2026-07-19",
            endDate: "2026-08-15",
            records: [],
          },
        },
      });
      const notice = element(html, "diagnosis-search-source", "</p>");

      expect(notice).toContain("sc-domain:astrologywiki.com");
      expect(notice).toContain("2026-07-19");
      expect(notice).toContain("2026-08-15");
      // No connect link once connected: an offer to do what is already done
      // reads as the connection not having worked.
      expect(notice).not.toContain("/api/auth/google/start");
    });
  });

  describe("honesty copy legibility", () => {
    it("keeps boundary and hint copy at body size and body colour", () => {
      const html = render("site", "E", richEvidence);
      const boundary = element(html, "diagnosis-boundary", "</p>");
      const healthCard = element(html, "diagnosis-health", "</article>");

      expect(boundary).toContain("text-[12.5px]");
      expect(boundary).toContain("text-text-dark-primary");

      // Assert on the honesty sentences themselves. Banning a size string from
      // the whole card also caught the card's own eyebrow — a label, not
      // honesty copy — so the rule fired on the wrong element and blocked
      // raising the legibility floor everywhere else.
      for (const sentence of [
        "Derived from 5 scored checks",
        "Excluded checks never become zero.",
      ]) {
        const line = paragraphContaining(healthCard, sentence);
        expect(line).toContain("text-[12px]");
        expect(line).toContain("text-text-dark-primary");
      }
    });

    it("renders nothing below the 10.5px legibility floor", () => {
      const html = render("site", "E", richEvidence);
      // Derived from what actually rendered rather than from a list of known
      // offenders: a new 9px label added tomorrow has to trip this too.
      const sizes = [...html.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(
        (match) => Number(match[1]),
      );
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
    });
  });

  describe("null-value wording", () => {
    it("calls an unset target query unconfirmed rather than unavailable", () => {
      const model = buildAgentAuditViewModel({
        agent: "seo",
        locale: "en",
        context: { ...context, targetQuery: "" },
        data,
      });
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AgentDiagnosis
            model={model}
            scope="site"
            selectedGroupId="E"
            selectedCheckId={null}
            onScopeChange={vi.fn()}
            onGroupChange={vi.fn()}
            onCheckChange={vi.fn()}
          />
        </NextIntlClientProvider>,
      );

      expect(html).toContain("Not confirmed");
    });

    it("separates an unmeasured value from an uncounted score", () => {
      const html = render("site", "E");

      expect(html).toContain("Not measured in this run");
      expect(html).toContain("Not scored");
    });
  });
});
