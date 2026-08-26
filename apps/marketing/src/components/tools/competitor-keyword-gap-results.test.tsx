// @vitest-environment jsdom
// @input  -- production-shaped competitor-gap envelopes
// @output -- compact six-column results, evidence rendering, and bounded coverage
// @pos    -- result-surface verification for the Marketing competitor keyword gap tool

import { describe, expect, it, vi } from "vitest";
import {
  BASE,
  buttonFor,
  click,
  installResultsHarness,
  productionRows,
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

describe("CompetitorKeywordGapResults", () => {
  it("renders the compact six-column table, stable overview metrics, and one legend for provider own-state", async () => {
    const host = await renderResults();
    const scope = host.querySelector("[data-scope-strip]");
    const legend = host.querySelector("[data-source-legend]");
    const table = host.querySelector("table") as HTMLTableElement;
    const wrapper = table.parentElement as HTMLElement;
    const tableSurface = host.querySelector("[data-results-table]");

    expect(host.querySelector('[data-run-status="complete"]')).not.toBeNull();
    expect(scope?.textContent).toContain("example.com");
    expect(scope?.textContent).toContain("alpha.example");
    expect(scope?.textContent).toContain("beta.example");
    expect(scope?.textContent).toContain("US");
    expect(scope?.textContent).toContain("en");
    expect(scope?.querySelector("time")?.getAttribute("datetime")).toBe(
      BASE.result.capturedAt,
    );
    expect(host.querySelectorAll("[data-summary-metric]")).toHaveLength(3);
    expect(
      host.querySelector('[data-summary-metric="returned-gap-rows"]')
        ?.textContent,
    ).toContain("2");
    expect(
      host.querySelector('[data-summary-metric="completed-competitors"]')
        ?.textContent,
    ).toContain("2 / 2");
    expect(
      host.querySelector('[data-summary-metric="gsc-observed-rows"]')
        ?.textContent,
    ).toContain("1");
    expect(legend?.querySelector('[data-source="dfs"]')?.textContent).toContain(
      "sources.dfs",
    );
    expect(legend?.querySelector('[data-source="gsc"]')?.textContent).toContain(
      "sources.gsc",
    );
    expect(host.textContent?.match(/legend\.ownState/g)).toHaveLength(1);
    expect(host.textContent).not.toContain(
      "ownState.not_observed_in_provider_rankings",
    );

    const headers = [
      ...host.querySelectorAll('thead th[scope="col"] [data-column-label]'),
    ].map((label) => label.textContent?.trim());
    expect(headers).toEqual([
      "table.keyword",
      "table.monthlySearchVolume",
      "table.competitorCoverage",
      "table.yourStatus",
      "table.opportunitySignals",
      "table.nextAction",
    ]);
    // Provenance is asked while reading a cell, so it sits in the header the
    // cell belongs to rather than in a legend the reader has scrolled past.
    // Opportunity signals deliberately carries NO column badge: it mixes
    // provider estimates with this tool's own heuristics, so the basis rides
    // on the pre-screen chip that varies instead.
    expect(
      [...host.querySelectorAll("thead [data-column-source]")].map((badge) =>
        badge.getAttribute("data-column-source"),
      ),
    ).toEqual(["dfs", "dfs", "gsc"]);
    expect(table.querySelector("caption")?.textContent).toContain(
      "table.caption",
    );
    expect(wrapper.tabIndex).toBe(0);
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(wrapper.className).toContain("focus-visible:outline-2");
    expect(table.className).toContain("min-w-[1080px]");
    expect(tableSurface?.className).toContain("max-w-[1440px]");
    expect(tableSurface?.className).toContain("w-[calc(100vw-32px)]");
    expect(table.className).toContain("text-[13px]");
    expect(table.className).toContain("leading-[1.45]");
    expect(table.querySelector("tbody p")).toBeNull();
    expect(table.querySelector("[data-keyword]")?.className).toContain(
      "text-[15.5px]",
    );
    expect(table.querySelector("[data-keyword]")?.className).toContain(
      "leading-[1.25]",
    );
    expect(table.querySelector("[data-monthly-volume]")?.className).toContain(
      "tabular-nums",
    );
    // The lane sentence is stated once above the table, not once per row.
    expect(table.querySelector("[data-next-step-copy]")).toBeNull();
    expect(
      table.querySelector('[data-row-action="open-checker"]')?.className,
    ).toContain("text-[12px]");
    expect(host.firstElementChild?.className).not.toMatch(
      /(?:min-w-screen|w-screen|overflow-x-(?:auto|scroll))/,
    );
  });

  it("keeps monthly volume to one DFS number and moves KD into opportunity signals", async () => {
    const host = await renderResults();
    const cells = host.querySelectorAll("tbody tr:first-child td");

    expect(cells).toHaveLength(6);
    expect(cells[1]?.textContent).toContain("2,900");
    expect(cells[1]?.textContent).not.toContain("metrics.difficulty");
    expect(cells[1]?.textContent).not.toContain("metrics.cpc");
    expect(cells[4]?.textContent).toContain("signals.difficulty");
    expect(cells[4]?.textContent).toContain("signals.bestRank");
  });

  it("keeps provider null distinct from explicit zero and renders every competitor rank", async () => {
    const host = await renderResults();
    const first = tableRow(host, "approval workflow software");
    const second = tableRow(host, "approval policy template");

    expect(first.querySelector("[data-monthly-volume]")?.textContent).toBe(
      "2,900",
    );
    expect(first.querySelectorAll("[data-competitor-rank]")).toHaveLength(2);
    expect(first.textContent).toContain("alpha.example #4");
    expect(first.textContent).toContain("beta.example #9");
    expect(first.textContent).toContain("signals.difficulty:value=—");
    expect(second.querySelector("[data-monthly-volume]")?.textContent).toBe(
      "0",
    );
    expect(second.textContent).toContain("signals.difficulty:value=17");
  });

  it("bounds long keyword and domain text inside the horizontal region", async () => {
    const longDomain = `${"very-long-segment-".repeat(8)}.example`;
    const host = await renderResults(
      withResult({
        rows: [
          row(0, {
            keyword: "long keyword ".repeat(30).trim(),
            competitorRanks: { [longDomain]: 7 },
            competitorCount: 1,
            bestCompetitorRank: 7,
          }),
        ],
      }),
    );

    expect(host.querySelector("[data-keyword]")?.className).toMatch(
      /(?:break-words|overflow-wrap-anywhere)/,
    );
    expect(host.querySelector("[data-competitor-rank]")?.className).toMatch(
      /(?:max-w-|break-all|break-words|truncate)/,
    );
  });

  it.each(["not_requested", "unavailable"] as const)(
    "shows GSC overview as unavailable when overlay status is %s",
    async (overlayStatus) => {
      const host = await renderResults(withResult({ overlayStatus }));
      expect(
        host.querySelector('[data-summary-metric="gsc-observed-rows"]')
          ?.textContent,
      ).toContain("—");
      expect(
        host.querySelector('[data-summary-metric="gsc-observed-rows"]')
          ?.textContent,
      ).toContain(`sources.status.${overlayStatus}`);
    },
  );

  it("keeps contract order, shows ten of 100 rows, and reports exact four-lane counts", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));
    const filters = host.querySelector("[data-next-step-filters]");
    const allFilter = host.querySelector('[data-next-step-filter="all"]');
    const contentFilter = host.querySelector(
      '[data-next-step-filter="review_content_gap"]',
    );

    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(allFilter?.getAttribute("aria-pressed")).toBe("true");
    expect(contentFilter?.getAttribute("aria-pressed")).toBe("false");

    // Each lane's sentence is stated ONCE above the table. Five optimize rows
    // are on screen and the sentence appears once, which is the whole point of
    // moving it out of the rows; and only the lanes actually visible get one,
    // so a note never describes rows the reader cannot see.
    expect(
      [...host.querySelectorAll("[data-lane-note]")].map((note) =>
        note.getAttribute("data-lane-note"),
      ),
    ).toEqual(["optimize_existing", "review_existing_query"]);
    expect(
      host.textContent?.match(/nextSteps\.optimize_existing/g),
    ).toHaveLength(1);
    expect(host.querySelector("tbody tr:first-child")?.textContent).toContain(
      "optimize-00",
    );
    expect(filters?.textContent).toContain("filters.all · 100");
    expect(filters?.textContent).toContain("filters.optimize_existing · 5");
    expect(filters?.textContent).toContain("filters.review_existing_query · 5");
    expect(filters?.textContent).toContain("filters.review_content_gap · 88");
    expect(filters?.textContent).toContain("filters.verify_own_coverage · 2");
    expect(host.textContent).toContain("actions.remaining:count=90");

    await click(buttonFor(host, "actions.showAll"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(host.textContent).toContain("actions.showingAll:count=100");
    expect(host.querySelectorAll("[data-lane-note]")).toHaveLength(4);
    expect(
      host.textContent?.match(/nextSteps\.optimize_existing/g),
    ).toHaveLength(1);
    await click(buttonFor(host, "actions.showLess"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);

    await click(contentFilter);
    expect(allFilter?.getAttribute("aria-pressed")).toBe("false");
    expect(contentFilter?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(host.textContent).toContain("actions.remaining:count=78");
    await click(buttonFor(host, "actions.showAll"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(88);
    await click(host.querySelector('[data-next-step-filter="all"]'));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(host.textContent).toContain("actions.remaining:count=90");
  });

  it("renders all four GSC states, labels evidence basis, and never promotes query-page totals", async () => {
    const rows = [
      BASE.result.rows[0]!,
      rowWithGsc(
        1,
        {
          queryStatus: "observed_weak",
          evidenceBasis: "query_page",
          queryImpressions: null,
          queryPosition: null,
          pageStatus: "observed_partial",
          pageUrl: "https://example.com/page-only?variant=b",
          pageImpressions: 42,
          pagePosition: 18,
          queryPageCoverage: null,
          nextStep: "review_existing_query",
        },
        { keyword: "query page only" },
      ),
      BASE.result.rows[1]!,
      rowWithGsc(
        3,
        {
          queryStatus: "gsc_query_sample_not_read",
          pageStatus: "gsc_query_page_sample_not_read",
          nextStep: "verify_own_coverage",
        },
        { keyword: "sample unread" },
      ),
      rowWithGsc(
        4,
        {
          queryStatus: "observed_strong",
          evidenceBasis: "query",
          queryImpressions: 800,
          queryPosition: 4,
          pageStatus: "observed_sufficient",
          pageUrl: "https://example.com/strong",
          pageImpressions: 750,
          pagePosition: 4.2,
          queryPageCoverage: 0.94,
          nextStep: "review_existing_query",
        },
        { keyword: "strong query" },
      ),
      rowWithGsc(
        5,
        {
          queryStatus: "observed_weak",
          evidenceBasis: "query",
          queryImpressions: 18,
          queryPosition: 21,
          pageStatus: "gsc_query_page_sample_not_read",
          nextStep: "review_existing_query",
        },
        { keyword: "page sample unread" },
      ),
    ];
    const host = await renderResults(withResult({ rows }));
    const observed = tableRow(host, "approval workflow software");
    const pageOnly = tableRow(host, "query page only");
    const miss = tableRow(host, "approval policy template");
    const unread = tableRow(host, "sample unread");
    const strong = tableRow(host, "strong query");
    const pageUnread = tableRow(host, "page sample unread");

    expect(observed.textContent).toContain("gsc.observed_weak");
    expect(observed.textContent).not.toContain("gsc.evidenceBasis.query");
    expect(
      observed.querySelector("[data-gsc-status]")?.getAttribute("aria-label"),
    ).toContain("gsc.evidenceBasis.query");
    expect(observed.textContent).toContain(
      "gsc.pageStatus.observed_sufficient",
    );
    expect(observed.textContent).not.toContain("gsc.pageMetricLine");
    expect(pageOnly.textContent).toContain("gsc.evidenceBasis.query_page");
    expect(pageOnly.textContent).toContain("gsc.pageStatus.observed_partial");
    expect(pageOnly.textContent).not.toContain("gsc.impressionsLine");
    expect(pageOnly.textContent).toContain("gsc.pageMetricLine");
    // The attributed page is named with its query string. Search Console
    // attributes query-string URLs routinely, and two rows on the same path
    // are different pages -- a line that cannot tell them apart names neither.
    expect(pageOnly.textContent).toContain(
      "gsc.pageStatus.observed_partial · example.com/page-only?variant=b",
    );
    expect(miss.textContent).toContain("gsc.not_observed_in_gsc_query_sample");
    expect(unread.textContent).toContain("gsc.gsc_query_sample_not_read");
    expect(strong.textContent).toContain("gsc.observed_strong");
    expect(pageUnread.textContent).toContain(
      "gsc.pageStatus.gsc_query_page_sample_not_read",
    );
    expect(miss.querySelector("[data-gsc-metrics]")).toBeNull();
    expect(unread.querySelector("[data-gsc-metrics]")).toBeNull();
    expect(miss.querySelector("td:nth-child(4)")?.textContent).not.toContain(
      "—",
    );
    expect(unread.querySelector("td:nth-child(4)")?.textContent).not.toContain(
      "—",
    );
  });

  it("renders each GSC number only where the contract has one, and never substitutes zero", async () => {
    const malformedQueryPair = rowWithGsc(
      0,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 12,
        queryPosition: null,
        pageStatus: "not_observed_in_gsc_query_page_sample",
        pageUrl: null,
        pageImpressions: null,
        pagePosition: null,
        nextStep: "review_existing_query",
      },
      { keyword: "missing query position" },
    );
    const malformedPagePair = rowWithGsc(
      1,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        queryImpressions: null,
        queryPosition: null,
        pageStatus: "observed_partial",
        pageUrl: "https://example.com/incomplete",
        pageImpressions: 9,
        pagePosition: null,
        nextStep: "review_existing_query",
      },
      { keyword: "missing page position" },
    );
    const host = await renderResults(
      withResult({ rows: [malformedQueryPair, malformedPagePair] }),
    );

    // Impressions and the position are two separate readings now that the pill
    // carries one of them, so a missing position withholds the position alone
    // rather than the impressions the sample really did report.
    const missingPosition = tableRow(host, "missing query position");
    expect(missingPosition.textContent).toContain(
      "gsc.impressionsLine:impressions=12",
    );
    expect(missingPosition.textContent).not.toContain("gsc.statusWithPosition");
    expect(
      missingPosition.querySelector("[data-gsc-status]")?.textContent,
    ).toBe("gsc.observed_weak");
    expect(missingPosition.textContent).toContain(
      "gsc.pageStatus.not_observed_in_gsc_query_page_sample",
    );
    expect(tableRow(host, "missing page position").textContent).not.toContain(
      "gsc.pageMetricLine",
    );
    expect(host.textContent).not.toContain("position=0");
    expect(host.textContent).not.toContain("impressions=0");
  });

  it("keeps technical coverage after the table and always states the six durable evidence boundaries", async () => {
    const envelope = withResult(
      {
        completedCompetitors: 1,
        unavailableCompetitors: 1,
        competitors: [
          {
            ...BASE.result.competitors[0]!,
            returnedRows: 1,
            totalCount: 8,
            truncated: true,
          },
          {
            domain: "beta.example",
            status: "unavailable",
            returnedRows: 0,
            totalCount: null,
            truncated: false,
            failureCode: "keyword_source_unavailable",
          },
        ],
        resultTruncated: true,
        overlayStatus: "partial",
        gscQueryTruncated: true,
        gscQueryPageTruncated: true,
      },
      "partial",
    );
    const host = await renderResults(envelope);
    const table = host.querySelector("table");
    const details = host.querySelector("details[data-coverage-details]");
    const boundaries = host.querySelector("[data-evidence-boundaries]");

    expect(details?.hasAttribute("open")).toBe(true);
    expect(host.textContent).toContain("status.partial");
    expect(details?.textContent).toContain(
      "coverage.failure:code=keyword_source_unavailable",
    );
    expect(details?.textContent).toContain("coverage.truncated");
    expect(details?.textContent).toContain("limitations.resultTruncated");
    expect(details?.textContent).toContain("limitations.gscQueryTruncated");
    expect(details?.textContent).toContain("limitations.gscQueryPageTruncated");
    expect(boundaries?.querySelectorAll("li")).toHaveLength(6);
    expect(
      table !== null && details !== null
        ? Boolean(
            table.compareDocumentPosition(details) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
    expect(
      details !== null && boundaries !== null
        ? Boolean(
            details.compareDocumentPosition(boundaries) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
  });

  it("keeps complete warning-free coverage collapsed and names all six durable boundaries", async () => {
    const host = await renderResults();
    const details = host.querySelector("details[data-coverage-details]");
    const boundaries = host.querySelector("[data-evidence-boundaries]");

    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("coverage.scope");
    expect(details?.textContent).toContain("alpha.example");
    expect(details?.textContent).toContain("beta.example");
    expect(boundaries?.querySelectorAll("li")).toHaveLength(6);
    for (const key of [
      "boundaries.dfsEstimates",
      "boundaries.gscOwnSample",
      "boundaries.competitorOutcomesUnavailable",
      "boundaries.manualSnapshot",
      "boundaries.dfsSnapshot",
      "boundaries.preScreen",
    ]) {
      expect(boundaries?.textContent).toContain(key);
    }
  });

  it("distinguishes a complete empty result from an unavailable run", async () => {
    const empty = await renderResults(withResult({ rows: [] }));
    expect(empty.textContent).toContain("empty.title");
    expect(empty.textContent).toContain("empty.body");

    await unmountResults();

    const unavailable = await renderResults(
      withResult(
        {
          completedCompetitors: 0,
          unavailableCompetitors: 2,
          rows: [],
          overlayStatus: "unavailable",
        },
        "unavailable",
      ),
    );
    expect(unavailable.textContent).toContain("status.unavailable");
    expect(unavailable.textContent).toContain("status.unavailableBody");
    expect(unavailable.querySelector("table")).toBeNull();
  });

  it("puts the average position inside the status pill and never leaves a dangling separator", async () => {
    const strong = rowWithGsc(
      0,
      {
        queryStatus: "observed_strong",
        evidenceBasis: "query",
        queryImpressions: 1_200,
        queryPosition: 3.4,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/strong",
        pageImpressions: 1_100,
        pagePosition: 3.6,
        queryPageCoverage: 0.9,
        nextStep: "review_existing_query",
      },
      { keyword: "strong pill" },
    );
    const weak = rowWithGsc(
      1,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 318,
        queryPosition: 22.5,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/weak",
        pageImpressions: 300,
        pagePosition: 23,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      { keyword: "weak pill" },
    );
    const withoutPosition = rowWithGsc(
      2,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        queryImpressions: null,
        queryPosition: null,
        pageStatus: "observed_partial",
        pageUrl: "https://example.com/page-only",
        pageImpressions: 12,
        pagePosition: 18,
        nextStep: "review_existing_query",
      },
      { keyword: "pill without position" },
    );
    const unread = rowWithGsc(
      3,
      {
        queryStatus: "gsc_query_sample_not_read",
        pageStatus: "gsc_query_page_sample_not_read",
        nextStep: "verify_own_coverage",
      },
      { keyword: "pill unread" },
    );
    const host = await renderResults(
      withResult({
        rows: [strong, weak, withoutPosition, row(4), unread],
      }),
    );
    const pill = (keyword: string): Element | null =>
      tableRow(host, keyword).querySelector("[data-gsc-status]");

    expect(pill("strong pill")?.textContent).toBe(
      "gsc.statusWithPosition:status=gsc.observed_strong,position=3.4",
    );
    expect(pill("weak pill")?.textContent).toBe(
      "gsc.statusWithPosition:status=gsc.observed_weak,position=22.5",
    );
    // No position in the contract, so the state stands alone: a separator with
    // nothing after it reads as a number that failed to render.
    expect(pill("pill without position")?.textContent).toBe(
      "gsc.observed_weak",
    );
    expect(pill("keyword 04")?.textContent).toBe(
      "gsc.not_observed_in_gsc_query_sample",
    );
    expect(pill("pill unread")?.textContent).toBe(
      "gsc.gsc_query_sample_not_read",
    );

    // The number is an impression-weighted average over a 28-day window that
    // itself ends two to three days back, and the short label cannot say so.
    // The title carries the qualification, and only on the pills that actually
    // show a number: qualifying a window on a pill with no position would
    // explain an average that is not there.
    expect(pill("strong pill")?.getAttribute("title")).toBe(
      "gsc.positionTitle",
    );
    expect(pill("weak pill")?.getAttribute("title")).toBe("gsc.positionTitle");
    expect(pill("pill without position")?.hasAttribute("title")).toBe(false);
    expect(pill("keyword 04")?.hasAttribute("title")).toBe(false);
    expect(pill("pill unread")?.hasAttribute("title")).toBe(false);

    // Tone still comes from the state alone; the position never changes it.
    expect(pill("strong pill")?.className).toContain("text-brand-success");
    expect(pill("weak pill")?.className).toContain("text-brand-warning");
    expect(pill("keyword 04")?.className).toContain("text-brand-error");
    expect(pill("pill unread")?.className).toContain(
      "text-text-dark-secondary",
    );

    // The line below the pill keeps the impressions and stops repeating the
    // position the pill now carries.
    const impressions = tableRow(host, "weak pill").querySelector(
      '[data-gsc-metrics="query"]',
    );
    expect(impressions?.textContent).toBe(
      "gsc.impressionsLine:impressions=318",
    );
    expect(impressions?.textContent).not.toContain("position=");
    expect(host.textContent).not.toContain("gsc.metricLine");
  });
});
