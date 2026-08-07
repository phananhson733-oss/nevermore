// @input  -- traffic-drop results rendered through the real message bundles
// @output -- a failing test when links leave their host items, evidence tiers lose
//            their collapse binding, or the exit card drifts from "what to do next"
// @pos    -- the guard on the report surface's reading order and outbound links
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type {
  TrafficDailyPoint,
  TrafficDropResult,
  TrafficFinding,
  TrafficSiteSignals,
} from "@sf/public-tools";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { TrafficDropResults } from "./traffic-drop-results.tsx";

const SERIES: readonly TrafficDailyPoint[] = [
  { date: "2026-05-01", clicks: 100, impressions: 1400 },
  { date: "2026-06-01", clicks: 40, impressions: 1300 },
  { date: "2026-07-01", clicks: 30, impressions: 1200 },
];

/** Signals where every algorithm-side block was computed. */
const COMPUTED_SIGNALS: TrafficSiteSignals = {
  selfChecks: {
    manualAction: {
      id: "manual_action",
      answer: "reports_none",
      lineage: "visitor_reported",
    },
    securityIssue: {
      id: "security_issue",
      answer: "reports_none",
      lineage: "visitor_reported",
    },
    path: "no_issue_reported",
    issues: [],
    unresolved: [],
  },
  coreUpdateTimeline: {
    kind: "compared",
    eventWindow: { startDate: "2026-05-07", endDate: "2026-06-07", dayCount: 32 },
    overlapping: [],
    tableVersion: "ranking-updates.v1",
    verifiedThrough: "2026-08-01",
  },
  brandSplit: {
    kind: "slice",
    brand: {
      queries: 12,
      clicksBefore: 300,
      clicksAfter: 280,
      clickChangeRatio: -0.07,
      impressionsBefore: 4000,
      impressionsAfter: 3900,
      impressionChangeRatio: -0.03,
    },
    nonBrand: {
      queries: 88,
      clicksBefore: 400,
      clicksAfter: 100,
      clickChangeRatio: -0.75,
      impressionsBefore: 6000,
      impressionsAfter: 5000,
      impressionChangeRatio: -0.17,
    },
    shape: "non_brand_declined_more",
    coverage: {
      before: {
        startDate: "2026-05-01",
        endDate: "2026-05-07",
        clickShare: 0.8,
        impressionShare: 0.7,
        truncated: false,
      },
      after: {
        startDate: "2026-07-01",
        endDate: "2026-07-07",
        clickShare: 0.78,
        impressionShare: 0.69,
        truncated: false,
      },
    },
  },
  queryCohort: {
    kind: "migration",
    cohortSize: 40,
    beforeDistribution: [{ bucket: "top_10", queries: 40 }],
    afterDistribution: [{ bucket: "top_10", queries: 25 }],
    stillVisible: 30,
    noLongerVisible: 10,
    topTen: {
      startedInTopTen: 40,
      heldTopTen: 25,
      slippedWithinFifty: 5,
      fellBelowFifty: 0,
      noLongerVisible: 10,
    },
    coverage: {
      beforeTruncated: false,
      afterTruncated: false,
      cohortClickShare: 0.6,
    },
  },
};

/** The same signals with the two query-level blocks not computed. */
const PARTIALLY_UNCHECKED_SIGNALS: TrafficSiteSignals = {
  ...COMPUTED_SIGNALS,
  brandSplit: {
    kind: "not_available",
    reason: "brand_terms_not_confirmed",
    coverage: null,
  },
  queryCohort: { kind: "not_available", reason: "read_not_performed" },
};

const FULLY_UNCHECKED_SIGNALS: TrafficSiteSignals = {
  ...PARTIALLY_UNCHECKED_SIGNALS,
  coreUpdateTimeline: {
    kind: "not_available",
    reason: "no_event_window",
    tableVersion: "ranking-updates.v1",
    verifiedThrough: "2026-08-01",
  },
};

const OBSERVED_FINDING: TrafficFinding = {
  id: "two_stage_decline",
  tier: "observed",
  measures: [{ key: "stage_one_clicks_change", value: -0.44 }],
  queries: [],
  hypothesis: "demand_cohort_receded",
  limitation: null,
};

const BOUNDARY_FINDING: TrafficFinding = {
  id: "seasonality_unavailable",
  tier: "data_boundary",
  measures: [
    { key: "history_days", value: 120 },
    { key: "required_days", value: 396 },
  ],
  queries: [],
  hypothesis: null,
  limitation: null,
};

function makeResult(overrides: Partial<TrafficDropResult>): TrafficDropResult {
  return {
    dataStartDate: "2026-05-01",
    dataEndDate: "2026-07-31",
    dayCount: 92,
    changePoint: {
      state: "sustained_decline",
      windows: [
        {
          id: "peak",
          startDate: "2026-05-01",
          endDate: "2026-05-07",
          clicks: 700,
          impressions: 10000,
          ctr: 0.07,
        },
        {
          id: "mid",
          startDate: "2026-06-01",
          endDate: "2026-06-07",
          clicks: 300,
          impressions: 9000,
          ctr: 0.033,
        },
        {
          id: "recent",
          startDate: "2026-07-01",
          endDate: "2026-07-07",
          clicks: 200,
          impressions: 8000,
          ctr: 0.025,
        },
      ],
      limitation: null,
    },
    findings: [OBSERVED_FINDING, BOUNDARY_FINDING],
    actions: [
      {
        id: "isolate_stage_one_ctr",
        kind: "do",
        basis: ["two_stage_decline"],
        signalBasis: [],
      },
      {
        id: "pull_deploy_logs",
        kind: "external_data",
        basis: ["transient_visibility_anomaly"],
        signalBasis: [],
      },
    ],
    checks: [
      { id: "sustained_decline", status: "hit", unavailableReason: null },
      {
        id: "decline_concentration",
        status: "not_available",
        unavailableReason: "query_data_not_supplied",
      },
      {
        id: "single_page_dominated_decline",
        status: "not_available",
        unavailableReason: "page_data_not_supplied",
      },
    ],
    siteSignals: PARTIALLY_UNCHECKED_SIGNALS,
    ...overrides,
  };
}

function render(
  result: TrafficDropResult,
  locale: "en" | "zh" = "en",
  property?: string,
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <TrafficDropResults
        result={result}
        series={SERIES}
        locale={locale}
        {...(property === undefined ? {} : { property })}
      />
    </NextIntlClientProvider>,
  );
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/** Every <details> block, innermost content flattened — nesting is not needed here. */
function detailsBlocks(markup: string): readonly string[] {
  return markup.match(/<details[\s\S]*?<\/details>/g) ?? [];
}

describe("TrafficDropResults tool links (5a)", () => {
  it("appends the Quick Wins link inside the stage-one CTR action item", () => {
    const markup = render(makeResult({}));
    expect(markup).toContain('href="/tools/seo-quick-wins"');
    expect(markup).toContain("Run SEO Quick Wins on this property");
    expect(markup).toContain(
      "lists the queries whose click-through sits below your own baseline",
    );
  });

  it("appends the SEO Audit link inside the deploy-log action item", () => {
    const markup = render(makeResult({}));
    expect(markup).toContain('href="/tools/seo-audit"');
  });

  it("drops a link when its host action is absent", () => {
    const markup = render(
      makeResult({
        actions: [
          {
            id: "pull_deploy_logs",
            kind: "external_data",
            basis: ["transient_visibility_anomaly"],
            signalBasis: [],
          },
        ],
      }),
    );
    expect(markup).not.toContain('href="/tools/seo-quick-wins"');
  });

  it("links the Cannot-check concentration row to Search Console, deep when the property is known", () => {
    const withoutProperty = render(makeResult({}));
    expect(withoutProperty).toContain(
      'href="https://search.google.com/search-console"',
    );

    const withProperty = render(
      makeResult({}),
      "en",
      "sc-domain:astrologywiki.com",
    );
    expect(withProperty).toContain(
      "resource_id=sc-domain%3Aastrologywiki.com",
    );
  });

  it("links the Cannot-check single-page row to the Internal Link Audit, and only then", () => {
    // The exit card also links the Internal Link Audit, so presence alone
    // cannot tell host-bound from ambient: count the occurrences.
    const cannotCheck = render(makeResult({}));
    expect(count(cannotCheck, 'href="/tools/internal-link-audit"')).toBe(2);

    const clear = render(
      makeResult({
        checks: [
          {
            id: "single_page_dominated_decline",
            status: "clear",
            unavailableReason: null,
          },
        ],
      }),
    );
    expect(count(clear, 'href="/tools/internal-link-audit"')).toBe(1);
  });
});

describe("TrafficDropResults exit card (5b)", () => {
  it("puts WHERE TO GO NEXT directly after the what-to-do-next block, before the checks", () => {
    const markup = render(makeResult({}));
    const actionsAt = markup.indexOf("What to do next");
    const cardAt = markup.indexOf("Where to go next");
    const checksAt = markup.indexOf("This run performed");
    expect(actionsAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(actionsAt);
    expect(checksAt).toBeGreaterThan(cardAt);
  });

  it("keeps the card body and its two links unchanged", () => {
    const markup = render(makeResult({}));
    expect(markup).toContain(
      "Start with a site check that does not require a connection.",
    );
    expect(markup).toContain("Free SEO Audit");
    expect(markup).toContain("Internal Link Audit");
  });

  it("renders the Chinese card", () => {
    const markup = render(makeResult({}), "zh");
    expect(markup).toContain("接下来去哪里");
    expect(markup).toContain("先用无需连接的数据检查网站基础。");
  });
});

describe("TrafficDropResults evidence-tier collapse (5c)", () => {
  it("keeps Observed findings expanded — never inside a collapsed block", () => {
    const markup = render(makeResult({}));
    const observedTitle = "This is not one decline, it is two";
    expect(markup).toContain(observedTitle);
    for (const block of detailsBlocks(markup)) {
      expect(block).not.toContain(observedTitle);
    }
  });

  it("collapses a Hypothesis paragraph by default with its full text preserved", () => {
    const markup = render(makeResult({}));
    const hypothesis = "Demand for that topic may simply have receded";
    expect(markup).toContain(hypothesis);
    expect(
      detailsBlocks(markup).some((block) => block.includes(hypothesis)),
    ).toBe(true);
  });

  it("collapses a finding whose own tier is hypothesis", () => {
    const hypothesisTierFinding: TrafficFinding = {
      id: "decline_concentration",
      tier: "hypothesis",
      measures: [],
      queries: [],
      hypothesis: null,
      limitation: null,
    };
    const markup = render(
      makeResult({ findings: [hypothesisTierFinding] }),
    );
    const title = (
      en as {
        tools: {
          trafficDrop: { findings: Record<string, { title: string }> };
        };
      }
    ).tools.trafficDrop.findings["decline_concentration"]!.title;
    expect(
      detailsBlocks(markup).some((block) => block.includes(title)),
    ).toBe(true);
  });

  it("gathers boundary findings and not-computed signal blocks into one counted region", () => {
    // 1 data-boundary finding + 2 not-computed signal blocks = 3 items.
    const markup = render(makeResult({}));
    expect(markup).toContain("What we could not check (3 items)");

    const region = detailsBlocks(markup).find((block) =>
      block.includes("What we could not check"),
    );
    expect(region).toBeDefined();
    // The seasonality boundary finding sank into the region, verbatim.
    expect(region).toContain("Seasonality cannot be assessed yet");
    // So did the two signal blocks that were not computed.
    expect(region).toContain("Brand vs non-brand queries");
    expect(region).toContain("Where a fixed set of queries sits now");
    // The computed timeline block stayed out of it.
    expect(region).not.toContain(
      "Where your decline sits on Google&#x27;s announced timeline",
    );
    const timelineAt = markup.indexOf("announced timeline");
    expect(timelineAt).toBeGreaterThan(-1);
    expect(timelineAt).toBeLessThan(markup.indexOf("What we could not check"));
  });

  it("counts the region in Chinese with the same arithmetic", () => {
    const markup = render(makeResult({}), "zh");
    expect(markup).toContain("我们没能查的（3 项）");
  });

  it("keeps the can/cannot-establish intro on top while any block in it is computed", () => {
    const markup = render(makeResult({}));
    const sectionAt = markup.indexOf(
      "What we can and cannot establish about a penalty",
    );
    expect(sectionAt).toBeGreaterThan(-1);
    expect(sectionAt).toBeLessThan(markup.indexOf("What we could not check"));
  });

  it("sinks the can/cannot-establish intro with its blocks when none was computed", () => {
    const markup = render(
      makeResult({ siteSignals: FULLY_UNCHECKED_SIGNALS }),
    );
    expect(markup).toContain("What we could not check (4 items)");
    const region = detailsBlocks(markup).find((block) =>
      block.includes("What we could not check"),
    );
    expect(region).toContain(
      "What we can and cannot establish about a penalty",
    );
  });

  it("excludes sunken boundary findings from the what-we-found count", () => {
    const markup = render(makeResult({}));
    // One observed finding stays; the boundary finding is counted in the
    // could-not-check region instead, not twice.
    expect(markup).toContain("What we found · 1");
  });
});
