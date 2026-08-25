// @vitest-environment jsdom
// @input  -- production-shaped v3 competitor-gap envelopes with competitor pages, pre-screen bands, and SERP snapshots
// @output -- linked competitor chips, band and lane filters, snapshot and traffic chips, sample rule, and GSC row-count rendering
// @pos    -- v3 signal-surface verification for the Marketing competitor keyword gap tool

import { describe, expect, it, vi } from "vitest";
import { COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS } from "@sf/public-tools/competitor-keyword-gap";
import {
  BASE,
  click,
  installResultsHarness,
  renderResults,
  row,
  rowWithGsc,
  tableRow,
  unmountResults,
  withResult,
} from "./competitor-keyword-gap-results-harness";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Readonly<Record<string, unknown>>) => {
      const rendered = values
        ? Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")
        : "";
      return rendered === "" ? key : `${key}:${rendered}`;
    },
}));

installResultsHarness();

describe("CompetitorKeywordGapResults v3 signals", () => {
  it("links each competitor chip to its ranking page when one is known", async () => {
    const unsafe = row(2, {
      keyword: "unsafe competitor page",
      competitorRanks: { "alpha.example": 3 },
      competitorPages: {
        "alpha.example": {
          url: "javascript:alert(1)",
          title: "Unsafe",
          etv: 5,
        },
      },
      bestCompetitorRank: 3,
    });
    const host = await renderResults(
      withResult({ rows: [...BASE.result.rows, unsafe] }),
    );
    const first = tableRow(host, "approval workflow software");
    const alpha = first.querySelector(
      '[data-competitor-rank="alpha.example"]',
    ) as HTMLAnchorElement;
    const beta = first.querySelector('[data-competitor-rank="beta.example"]');

    expect(alpha).toBeInstanceOf(HTMLAnchorElement);
    expect(alpha.getAttribute("href")).toBe("https://alpha.example/approvals");
    expect(alpha.getAttribute("target")).toBe("_blank");
    expect(alpha.getAttribute("rel")).toBe("noopener noreferrer");
    expect(alpha.getAttribute("title")).toBe("Alpha approvals");
    expect(alpha.textContent).toContain("alpha.example #4");
    expect(beta).toBeInstanceOf(HTMLSpanElement);
    expect(beta?.textContent).toContain("beta.example #9");
    expect(
      tableRow(host, "unsafe competitor page").querySelector(
        '[data-competitor-rank="alpha.example"]',
      ),
    ).toBeInstanceOf(HTMLSpanElement);
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("shows the best competitor page's DFS traffic estimate only when the provider gave one", async () => {
    const host = await renderResults();
    const withTraffic = tableRow(host, "approval workflow software");
    const smallerTraffic = tableRow(host, "approval policy template");
    const missing = row(0, {
      keyword: "no traffic estimate",
      competitorPages: {
        "alpha.example": {
          url: "https://alpha.example/x",
          title: null,
          etv: null,
        },
      },
    });

    const trafficChip = withTraffic.querySelector("[data-competitor-traffic]");
    expect(trafficChip?.textContent).toContain(
      "signals.competitorTraffic:value=812",
    );
    // The chip names the page's domain so it cannot be read as another
    // competitor's page when the open-competitor-page link falls back.
    expect(trafficChip?.textContent).toContain("alpha.example");
    expect(trafficChip?.textContent).not.toContain("beta.example");
    expect(
      smallerTraffic.querySelector("[data-competitor-traffic]")?.textContent,
    ).toContain("signals.competitorTraffic:value=120");

    await unmountResults();
    const second = await renderResults(withResult({ rows: [missing] }));
    expect(
      tableRow(second, "no traffic estimate").querySelector(
        "[data-competitor-traffic]",
      ),
    ).toBeNull();
  });

  it("shows the pre-screen band with its basis", async () => {
    const prioritized = row(0, {
      keyword: "prioritized keyword",
      preScreen: {
        band: "prioritize_serp_check",
        basis: "dfs_estimate",
        reason: "kd_low_rank_top10",
      },
    });
    const brand = row(1, {
      keyword: "alpha brand keyword",
      preScreen: {
        band: "defer_brand_navigational",
        basis: "tool_heuristic",
        reason: "competitor_brand_token",
      },
    });
    const host = await renderResults(
      withResult({ rows: [prioritized, brand] }),
    );
    const prioritizedChip = tableRow(host, "prioritized keyword").querySelector(
      '[data-pre-screen="prioritize_serp_check"]',
    );
    const brandChip = tableRow(host, "alpha brand keyword").querySelector(
      '[data-pre-screen="defer_brand_navigational"]',
    );

    expect(prioritizedChip).not.toBeNull();
    expect(prioritizedChip?.textContent).toContain(
      "preScreen.band.prioritize_serp_check",
    );
    expect(prioritizedChip?.getAttribute("title")).toContain(
      "preScreen.basis.dfs_estimate",
    );
    expect(prioritizedChip?.getAttribute("title")).toContain(
      "preScreen.reason.kd_low_rank_top10",
    );
    expect(brandChip?.textContent).toContain(
      "preScreen.band.defer_brand_navigational",
    );
    expect(brandChip?.getAttribute("title")).toContain(
      "preScreen.basis.tool_heuristic",
    );
    expect(brandChip?.getAttribute("title")).toContain(
      "preScreen.reason.competitor_brand_token",
    );
    // The basis qualifier and reason are visible text, not only a tooltip,
    // so keyboard and touch users reach the "not winnability" caveat.
    const prioritizedReason = tableRow(
      host,
      "prioritized keyword",
    ).querySelector("[data-pre-screen-reason]");
    const brandReason = tableRow(host, "alpha brand keyword").querySelector(
      "[data-pre-screen-reason]",
    );
    expect(prioritizedReason?.textContent).toContain(
      "preScreen.basis.dfs_estimate",
    );
    expect(prioritizedReason?.textContent).toContain(
      "preScreen.reason.kd_low_rank_top10",
    );
    expect(brandReason?.textContent).toContain(
      "preScreen.basis.tool_heuristic",
    );
    expect(brandReason?.textContent).toContain(
      "preScreen.reason.competitor_brand_token",
    );
  });

  it("shows a dated AI Overview snapshot chip only when the snapshot lists it", async () => {
    const undated = row(3, {
      keyword: "undated snapshot",
      serpSnapshot: { itemTypes: ["ai_overview"], updatedAt: null },
    });
    // The guard only pins updatedAt to string | null, so a provider format
    // drift must read as "date given but unreadable", never as "undated".
    const unreadable = row(5, {
      keyword: "unreadable snapshot date",
      serpSnapshot: { itemTypes: ["ai_overview"], updatedAt: "not-a-date" },
    });
    const host = await renderResults(
      withResult({
        rows: [...BASE.result.rows, undated, row(4), unreadable],
      }),
    );
    const dated = tableRow(host, "approval workflow software").querySelector(
      '[data-serp-snapshot="ai_overview"]',
    );

    expect(dated?.textContent).toContain("signals.aiOverviewSnapshot:date=");
    expect(dated?.textContent).toContain("2026");
    expect(
      tableRow(host, "approval policy template").querySelector(
        "[data-serp-snapshot]",
      ),
    ).toBeNull();
    expect(
      tableRow(host, "undated snapshot").querySelector(
        '[data-serp-snapshot="ai_overview"]',
      )?.textContent,
    ).toContain("signals.aiOverviewSnapshotUndated");
    expect(
      tableRow(host, "keyword 04").querySelector("[data-serp-snapshot]"),
    ).toBeNull();
    const unreadableChip = tableRow(
      host,
      "unreadable snapshot date",
    ).querySelector('[data-serp-snapshot="ai_overview"]');
    expect(unreadableChip?.textContent).toContain(
      "signals.aiOverviewSnapshot:date=not-a-date",
    );
    expect(unreadableChip?.textContent).not.toContain(
      "signals.aiOverviewSnapshotUndated",
    );
  });

  it("offers the competitor page next to copy-keyword in the content-gap lane", async () => {
    const known = row(0, {
      keyword: "known competitor page",
      competitorRanks: { "alpha.example": 9, "beta.example": 2 },
      competitorPages: {
        "alpha.example": {
          url: "https://alpha.example/fallback",
          title: null,
          etv: null,
        },
        "beta.example": {
          url: "https://beta.example/best",
          title: null,
          etv: null,
        },
      },
      competitorCount: 2,
      bestCompetitorRank: 2,
    });
    const fallback = row(1, {
      keyword: "fallback competitor page",
      competitorRanks: { "alpha.example": 9, "beta.example": 2 },
      competitorPages: {
        "alpha.example": {
          url: "https://alpha.example/fallback",
          title: null,
          etv: null,
        },
        "beta.example": { url: null, title: null, etv: null },
      },
      competitorCount: 2,
      bestCompetitorRank: 2,
    });
    const unknown = row(2, { keyword: "unknown competitor page" });
    const host = await renderResults(
      withResult({ rows: [known, fallback, unknown] }),
    );
    const knownRow = tableRow(host, "known competitor page");
    const fallbackRow = tableRow(host, "fallback competitor page");
    const unknownRow = tableRow(host, "unknown competitor page");
    const open = knownRow.querySelector(
      '[data-row-action="open-competitor-page"]',
    ) as HTMLAnchorElement;

    expect(
      knownRow.querySelector('[data-row-action="copy-keyword"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(open).toBeInstanceOf(HTMLAnchorElement);
    expect(open.getAttribute("href")).toBe("https://beta.example/best");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(open.textContent).toContain("actions.openCompetitorPage");
    expect(open.textContent).toContain("beta.example");
    // The fallback opens a different competitor than the best-rank chip
    // describes, so the link names its domain visibly.
    const fallbackOpen = fallbackRow.querySelector(
      '[data-row-action="open-competitor-page"]',
    );
    expect(fallbackOpen?.getAttribute("href")).toBe(
      "https://alpha.example/fallback",
    );
    expect(fallbackOpen?.textContent).toContain("alpha.example");
    expect(fallbackOpen?.textContent).not.toContain("beta.example");
    expect(
      unknownRow.querySelector('[data-row-action="copy-keyword"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      unknownRow.querySelector('[data-row-action="open-competitor-page"]'),
    ).toBeNull();
  });

  it("filters by pre-screen band and by lane together", async () => {
    const brandGap = row(0, {
      keyword: "brand gap",
      preScreen: {
        band: "defer_brand_navigational",
        basis: "tool_heuristic",
        reason: "competitor_brand_token",
      },
    });
    const prioritizedGap = row(1, {
      keyword: "prioritized gap",
      preScreen: {
        band: "prioritize_serp_check",
        basis: "dfs_estimate",
        reason: "kd_low_rank_top10",
      },
    });
    const prioritizedOptimize = rowWithGsc(
      2,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 100,
        queryPosition: 20,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/optimize",
        pageImpressions: 90,
        pagePosition: 19,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      {
        keyword: "prioritized optimize",
        preScreen: {
          band: "prioritize_serp_check",
          basis: "dfs_estimate",
          reason: "kd_low_rank_top10",
        },
      },
    );
    const host = await renderResults(
      withResult({ rows: [brandGap, prioritizedGap, prioritizedOptimize] }),
    );
    const bandFilters = host.querySelector("[data-pre-screen-filters]");
    const laneFilters = host.querySelector("[data-next-step-filters]");
    const allBands = host.querySelector('[data-pre-screen-filter="all"]');
    const brandBand = host.querySelector(
      '[data-pre-screen-filter="defer_brand_navigational"]',
    );
    const prioritizedBand = host.querySelector(
      '[data-pre-screen-filter="prioritize_serp_check"]',
    );

    expect(bandFilters?.textContent).toContain("preScreen.filterAll · 3");
    expect(bandFilters?.textContent).toContain(
      "preScreen.band.prioritize_serp_check · 2",
    );
    expect(bandFilters?.textContent).toContain(
      "preScreen.band.defer_brand_navigational · 1",
    );
    expect(allBands?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("[data-pre-screen-filter]")).toHaveLength(
      COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS.length + 1,
    );

    await click(brandBand);
    expect(brandBand?.getAttribute("aria-pressed")).toBe("true");
    expect(allBands?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody tr")?.textContent).toContain("brand gap");
    expect(laneFilters?.textContent).toContain("filters.all · 3");
    expect(laneFilters?.textContent).toContain(
      "filters.review_content_gap · 2",
    );
    expect(laneFilters?.textContent).toContain("filters.optimize_existing · 1");

    await click(
      host.querySelector('[data-next-step-filter="review_content_gap"]'),
    );
    await click(prioritizedBand);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody tr")?.textContent).toContain(
      "prioritized gap",
    );
    expect(bandFilters?.textContent).toContain("preScreen.filterAll · 2");
    expect(bandFilters?.textContent).toContain(
      "preScreen.band.prioritize_serp_check · 1",
    );

    await click(allBands);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("resets the band filter when the lane changes so a lane chip's count always matches the visible rows", async () => {
    const brandGap = row(0, {
      keyword: "brand gap",
      preScreen: {
        band: "defer_brand_navigational",
        basis: "tool_heuristic",
        reason: "competitor_brand_token",
      },
    });
    const prioritizedOptimize = rowWithGsc(
      1,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 100,
        queryPosition: 20,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/optimize",
        pageImpressions: 90,
        pagePosition: 19,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      {
        keyword: "prioritized optimize",
        preScreen: {
          band: "prioritize_serp_check",
          basis: "dfs_estimate",
          reason: "kd_low_rank_top10",
        },
      },
    );
    const host = await renderResults(
      withResult({ rows: [brandGap, prioritizedOptimize] }),
    );
    const allBands = host.querySelector('[data-pre-screen-filter="all"]');
    const brandBand = host.querySelector(
      '[data-pre-screen-filter="defer_brand_navigational"]',
    );
    const optimizeLane = host.querySelector(
      '[data-next-step-filter="optimize_existing"]',
    );

    await click(brandBand);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody tr")?.textContent).toContain("brand gap");

    // The optimize lane advertises 1 row and none of them is in the pressed
    // band; without the reset the table would render empty with no message.
    expect(optimizeLane?.textContent).toContain(
      "filters.optimize_existing · 1",
    );
    await click(optimizeLane);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody tr")?.textContent).toContain(
      "prioritized optimize",
    );
    expect(allBands?.getAttribute("aria-pressed")).toBe("true");
    expect(brandBand?.getAttribute("aria-pressed")).toBe("false");
    expect(brandBand?.textContent).toContain(
      "preScreen.band.defer_brand_navigational · 0",
    );
  });

  it("states the sample rule and in-rule counts in coverage", async () => {
    const host = await renderResults(
      withResult({
        competitors: [
          BASE.result.competitors[0]!,
          {
            domain: "beta.example",
            status: "unavailable",
            returnedRows: 0,
            totalCount: null,
            truncated: false,
            failureCode: "keyword_source_unavailable",
          },
        ],
      }),
    );
    const details = host.querySelector("details[data-coverage-details]");
    const rule = details?.querySelector("[data-sample-rule]");
    const alphaCard = details?.querySelector(
      '[data-competitor-status="complete"]',
    );
    const betaCard = details?.querySelector(
      '[data-competitor-status="unavailable"]',
    );

    expect(rule?.textContent).toContain(
      "coverage.sampleRule:maxRank=20,limit=300",
    );
    expect(alphaCard?.textContent).toContain(
      "coverage.rowsInRule:returned=2,total=2",
    );
    expect(alphaCard?.textContent).not.toContain("coverage.rows:");
    expect(betaCard?.textContent).toContain("coverage.rows:returned=0,total=—");
    expect(betaCard?.textContent).not.toContain("coverage.rowsInRule");
  });

  it("surfaces a GSC zero-row limitation", async () => {
    const zero = await renderResults(
      withResult({ overlayStatus: "available", gscQueryRowCount: 0 }),
    );
    const zeroDetails = zero.querySelector("details[data-coverage-details]");

    expect(zeroDetails?.hasAttribute("open")).toBe(true);
    expect(zeroDetails?.textContent).toContain("limitations.gscNoRows");
    expect(zero.querySelector("[data-gsc-query-rows]")?.textContent).toContain(
      "overview.gscQueryRows:count=0",
    );

    await unmountResults();

    const forty = await renderResults(
      withResult({ overlayStatus: "available", gscQueryRowCount: 40 }),
    );
    const gscCard = forty.querySelector(
      '[data-summary-metric="gsc-observed-rows"]',
    );
    expect(
      gscCard?.querySelector("[data-gsc-query-rows]")?.textContent,
    ).toContain("overview.gscQueryRows:count=40");
    expect(forty.textContent).not.toContain("limitations.gscNoRows");
    expect(
      forty
        .querySelector("details[data-coverage-details]")
        ?.hasAttribute("open"),
    ).toBe(false);

    await unmountResults();

    const notRequested = await renderResults(
      withResult({ overlayStatus: "not_requested", gscQueryRowCount: null }),
    );
    expect(notRequested.querySelector("[data-gsc-query-rows]")).toBeNull();
    expect(notRequested.textContent).not.toContain("limitations.gscNoRows");
  });
});
