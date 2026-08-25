// @vitest-environment jsdom
// @input  -- production-shaped competitor-gap envelopes
// @output -- compact six-column results, qualified actions, and bounded evidence rendering
// @pos    -- result-surface verification for the Marketing competitor keyword gap tool

import { describe, expect, it, vi } from "vitest";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";
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
  writeTextMock,
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

    const headers = [...host.querySelectorAll('thead th[scope="col"]')].map(
      (header) => header.textContent?.trim(),
    );
    expect(headers).toEqual([
      "table.keyword",
      "table.monthlySearchVolume",
      "table.competitorCoverage",
      "table.yourStatus",
      "table.opportunitySignals",
      "table.nextCheck",
    ]);
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
    expect(table.querySelector("[data-next-step-copy]")?.className).toContain(
      "text-[13px]",
    );
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

  it("writes a bounded private handoff through a locale-only checker link", async () => {
    const host = await renderResults(BASE, {
      locale: "zh",
      selectedProperty: "sc-domain:example.com",
    });
    const checker = tableRow(host, "approval workflow software").querySelector(
      '[data-row-action="open-checker"]',
    ) as HTMLAnchorElement;

    expect(checker).toBeInstanceOf(HTMLAnchorElement);
    expect(checker.getAttribute("href")).toBe("/zh/tools/on-page-seo-check");
    expect(checker.getAttribute("href")).not.toContain("?");
    checker.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(checker);

    const stored = JSON.parse(
      String(sessionStorage.getItem(TOOL_HANDOFF_KEY)),
    ) as {
      readonly property: string;
      readonly query: string;
      readonly page: string;
      readonly evidenceId: string;
    };

    expect(stored.property).toBe("sc-domain:example.com");
    expect(stored.query).toBe("approval workflow software");
    expect(stored.page).toBe("https://example.com/product");
    expect(stored.evidenceId.length).toBeLessThanOrEqual(256);
    expect(JSON.stringify(BASE)).not.toContain("sc-domain:example.com");
  });

  it("prevents checker navigation and reports an inline error when storage fails", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const host = await renderResults(BASE, {
      selectedProperty: "sc-domain:example.com",
    });
    const checker = tableRow(host, "approval workflow software").querySelector(
      '[data-row-action="open-checker"]',
    );

    expect(await click(checker)).toBe(false);
    expect(setItem).toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "actions.handoffFailed",
    );
  });

  it("keeps a long keyword handoff id bounded and deterministic", async () => {
    // Longer than the old keyword-derived 256-char evidence id, but still
    // inside the handoff contract's 512-char query bound.
    const longKeyword = "long handoff keyword ".repeat(14).trim();
    const host = await renderResults(
      withResult({
        rows: [
          {
            ...BASE.result.rows[0]!,
            keyword: longKeyword,
          },
        ],
      }),
      { selectedProperty: "sc-domain:example.com" },
    );
    const checker = host.querySelector('[data-row-action="open-checker"]');

    checker?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(checker);
    const stored = JSON.parse(
      String(sessionStorage.getItem(TOOL_HANDOFF_KEY)),
    ) as {
      readonly query: string;
      readonly evidenceId: string;
    };
    expect(stored.query).toBe(longKeyword);
    expect(stored.evidenceId.length).toBeLessThanOrEqual(256);

    const firstEvidenceId = stored.evidenceId;
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    checker?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(checker);
    const repeated = JSON.parse(
      String(sessionStorage.getItem(TOOL_HANDOFF_KEY)),
    ) as { readonly evidenceId: string };
    expect(repeated.evidenceId).toBe(firstEvidenceId);
  });

  it("offers checker for sufficient strong evidence and a safe new-window page for partial evidence", async () => {
    const strong = rowWithGsc(
      0,
      {
        queryStatus: "observed_strong",
        evidenceBasis: "query",
        queryImpressions: 1_000,
        queryPosition: 4,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/strong",
        pageImpressions: 900,
        pagePosition: 4.2,
        queryPageCoverage: 0.9,
        nextStep: "review_existing_query",
      },
      { keyword: "strong sufficient" },
    );
    const partial = rowWithGsc(
      1,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        queryImpressions: null,
        queryPosition: null,
        pageStatus: "observed_partial",
        pageUrl: "https://example.com/partial",
        pageImpressions: 12,
        pagePosition: 9.2,
        queryPageCoverage: null,
        nextStep: "review_existing_query",
      },
      { keyword: "partial page" },
    );
    const unsafe = rowWithGsc(
      2,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        pageStatus: "observed_partial",
        pageUrl: "javascript:alert(1)",
        pageImpressions: 3,
        pagePosition: 8,
        nextStep: "review_existing_query",
      },
      { keyword: "unsafe page" },
    );
    const host = await renderResults(
      withResult({ rows: [strong, partial, unsafe] }),
      {
        selectedProperty: "sc-domain:example.com",
      },
    );

    expect(
      tableRow(host, "strong sufficient").querySelector(
        '[data-row-action="open-checker"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement);
    const pageLink = tableRow(host, "partial page").querySelector(
      '[data-row-action="open-observed-page"]',
    ) as HTMLAnchorElement;
    expect(pageLink).toBeInstanceOf(HTMLAnchorElement);
    expect(pageLink.getAttribute("href")).toBe("https://example.com/partial");
    expect(pageLink.getAttribute("target")).toBe("_blank");
    expect(pageLink.getAttribute("rel")).toContain("noopener");
    expect(tableRow(host, "unsafe page").textContent).not.toContain(
      "actions.openObservedPage",
    );
  });

  it("does not let an empty property hide a safe observed page", async () => {
    const partial = rowWithGsc(
      0,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        pageStatus: "observed_partial",
        pageUrl: "https://example.com/partial",
        pageImpressions: 12,
        pagePosition: 9.2,
        nextStep: "review_existing_query",
      },
      { keyword: "partial without property" },
    );
    const sufficient = {
      ...BASE.result.rows[0]!,
      keyword: "sufficient without property",
    };
    const host = await renderResults(
      withResult({ rows: [partial, sufficient] }),
      { selectedProperty: "" },
    );

    for (const keyword of [
      "partial without property",
      "sufficient without property",
    ]) {
      expect(
        tableRow(host, keyword).querySelector(
          '[data-row-action="open-observed-page"]',
        ),
      ).toBeInstanceOf(HTMLAnchorElement);
    }
    expect(host.textContent).not.toContain("actions.openChecker");
  });

  it("supports copy and focus-property actions for their evidence lanes", async () => {
    const focusProperty = vi.fn();
    const host = await renderResults(
      withResult({
        rows: [
          row(0, {
            keyword: "copy target",
          }),
          row(1, {
            keyword: "focus target",
            gsc: {
              queryStatus: "gsc_query_sample_not_read",
              evidenceBasis: null,
              queryImpressions: null,
              queryPosition: null,
              pageStatus: "gsc_query_page_sample_not_read",
              pageUrl: null,
              pageImpressions: null,
              pagePosition: null,
              queryPageCoverage: null,
              nextStep: "verify_own_coverage",
            },
          }),
        ],
      }),
      {
        selectedProperty: "sc-domain:example.com",
        onFocusProperty: focusProperty,
      },
    );

    await click(
      [...tableRow(host, "copy target").querySelectorAll("button")].find(
        (button) => button.textContent?.includes("actions.copyKeyword"),
      ) ?? null,
    );
    expect(writeTextMock).toHaveBeenCalledWith("copy target");

    await click(
      [...tableRow(host, "focus target").querySelectorAll("button")].find(
        (button) => button.textContent?.includes("actions.focusProperty"),
      ) ?? null,
    );
    expect(focusProperty).toHaveBeenCalledOnce();

    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    await click(
      [...tableRow(host, "copy target").querySelectorAll("button")].find(
        (button) => button.textContent?.includes("actions.copyKeyword"),
      ) ?? null,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "actions.copyFailed",
    );
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
          pageUrl: "https://example.com/page-only",
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
    expect(pageOnly.textContent).not.toContain("gsc.metricLine");
    expect(pageOnly.textContent).toContain("gsc.pageMetricLine");
    expect(pageOnly.textContent).toContain("example.com/page-only");
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

  it("renders GSC metric lines only for complete non-null pairs and never substitutes zero", async () => {
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

    expect(tableRow(host, "missing query position").textContent).not.toContain(
      "gsc.metricLine",
    );
    expect(tableRow(host, "missing query position").textContent).toContain(
      "gsc.pageStatus.not_observed_in_gsc_query_page_sample",
    );
    expect(tableRow(host, "missing page position").textContent).not.toContain(
      "gsc.pageMetricLine",
    );
    expect(host.textContent).not.toContain("position=0");
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

  it("copies the current filter as one fenced plan and reports the copied count", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));
    const copyPlan = (): Element | null =>
      host.querySelector('[data-row-action="copy-plan"]');

    // Collapsed: only the ten rows on screen are copied; the other ninety in
    // the filter are counted as omitted, never carried into the plan.
    expect(copyPlan()?.textContent).toContain("actions.copyPlan:count=10");
    expect(host.querySelector('[role="status"]')).toBeNull();

    await click(copyPlan());
    expect(writeTextMock).toHaveBeenCalledOnce();
    const collapsed = String(writeTextMock.mock.calls[0]?.[0]);
    expect(collapsed.startsWith("# Competitor keyword gap plan")).toBe(true);
    expect(collapsed.match(/```json/g)).toHaveLength(1);
    expect(collapsed).toContain('"laneFilter": "all"');
    expect(collapsed).toContain('"bandFilter": "all"');
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(collapsed).not.toContain('"keyword": "content-gap-00"');
    expect(collapsed).toContain('"omittedRows": 90');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "actions.copyPlanDone:count=10",
    );

    // Expanded: the plan follows the filter's full order up to the cap.
    const showAll = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("actions.showAll"),
    );
    await click(showAll ?? null);
    expect(copyPlan()?.textContent).toContain("actions.copyPlan:count=20");
    await click(copyPlan());
    const markdown = String(writeTextMock.mock.calls[1]?.[0]);
    expect(markdown).toContain('"keyword": "content-gap-09"');
    expect(markdown).not.toContain('"keyword": "content-gap-10"');
    expect(markdown).toContain('"omittedRows": 80');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "actions.copyPlanDone:count=20",
    );

    await click(
      host.querySelector('[data-next-step-filter="verify_own_coverage"]'),
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(copyPlan()?.textContent).toContain("actions.copyPlan:count=2");

    await click(copyPlan());
    const filtered = String(writeTextMock.mock.calls[2]?.[0]);
    expect(filtered).toContain('"laneFilter": "verify_own_coverage"');
    expect(filtered).toContain('"keyword": "verify-01"');
    expect(filtered).not.toContain("optimize-00");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "actions.copyPlanDone:count=2",
    );
  });

  it("disables the plan button when the lane and band filter match nothing", async () => {
    const host = await renderResults();
    const copyPlan = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>('[data-row-action="copy-plan"]');

    expect(copyPlan()?.disabled).toBe(false);

    await click(
      host.querySelector('[data-next-step-filter="optimize_existing"]'),
    );
    await click(host.querySelector('[data-pre-screen-filter="stretch"]'));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(copyPlan()?.textContent).toContain("actions.copyPlan:count=0");
    expect(copyPlan()?.disabled).toBe(true);

    await click(copyPlan());
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("writes the Chinese plan for zh locales and reports a clipboard failure inline", async () => {
    const host = await renderResults(BASE, { locale: "zh" });
    const copyPlan = host.querySelector('[data-row-action="copy-plan"]');

    await click(copyPlan);
    expect(
      String(writeTextMock.mock.calls[0]?.[0]).startsWith("# 竞品词差距计划"),
    ).toBe(true);
    expect(host.querySelector('[role="status"]')).not.toBeNull();

    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    await click(copyPlan);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "actions.copyPlanFailed",
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
