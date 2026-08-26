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
  visibleKeywords,
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
  it("renders the compact six-column table and the two overview cards", async () => {
    const host = await renderResults();
    const scope = host.querySelector("[data-scope-strip]");
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
    // Two cards, and the second is load-bearing: it is now the only place the
    // surface says how much of the run came back, so a run with three failed
    // competitors cannot look like a complete one.
    expect(
      [...host.querySelectorAll("[data-summary-metric]")].map((card) =>
        card.getAttribute("data-summary-metric"),
      ),
    ).toEqual(["returned-gap-rows", "completed-competitors"]);
    expect(
      host.querySelector('[data-summary-metric="returned-gap-rows"]')
        ?.textContent,
    ).toContain("2");
    expect(
      host.querySelector('[data-summary-metric="completed-competitors"]')
        ?.textContent,
    ).toContain("2 / 2");
    // The gap card states what the rows ARE, keyed to the run's own rank bound
    // rather than a number typed into the sentence.
    expect(
      host.querySelector('[data-summary-metric="returned-gap-rows"]')
        ?.textContent,
    ).toContain("overview.returnedGapRowsBody:maxRank=20");
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
    // No lane sentence anywhere any more: `gsc.nextStep` still picks the row's
    // action verb, but it no longer gets a paragraph of its own.
    expect(table.querySelector("[data-next-step-copy]")).toBeNull();
    expect(
      table.querySelector('[data-row-action="open-checker"]')?.className,
    ).toContain("text-[12px]");
    expect(host.firstElementChild?.className).not.toMatch(
      /(?:min-w-screen|w-screen|overflow-x-(?:auto|scroll))/,
    );
  });

  /**
   * Asserted by DOM hook AND by key path, because the two fail differently.
   * A hook that survives says the component is still mounted; a key path that
   * survives says the catalog string is still being rendered from somewhere
   * else, which is how a "removed" sentence comes back on a different surface.
   */
  it("renders none of the stripped surfaces and none of their copy", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));

    for (const selector of [
      "[data-source-legend]",
      "[data-next-step-filters]",
      "[data-next-step-filter]",
      "[data-pre-screen-filters]",
      "[data-pre-screen-filter]",
      "[data-lane-notes]",
      "[data-lane-note]",
      '[data-row-action="copy-plan"]',
      "[data-gsc-query-rows]",
      '[data-summary-metric="gsc-observed-rows"]',
    ]) {
      expect(host.querySelector(selector), selector).toBeNull();
    }
    for (const key of [
      "legend.ownState",
      "sources.dfs",
      "sources.gsc",
      "sources.status.",
      "status.complete",
      "status.partial",
      "summary.competitors",
      "summary.unavailable",
      "filters.",
      "nextSteps.",
      "preScreen.filterAll",
      "actions.copyPlan",
      "overview.gscObservedRows",
      "overview.gscQueryRows",
    ]) {
      expect(host.textContent, key).not.toContain(key);
    }
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

  it("shows ten of 100 rows, expands to all of them, and never narrows the set", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));

    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(host.textContent).toContain("actions.remaining:count=90");

    await click(buttonFor(host, "actions.showAll"));
    // Every row of the run, because nothing filters this table any more.
    expect(host.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(host.textContent).toContain("actions.showingAll:count=100");
    await click(buttonFor(host, "actions.showLess"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("sorts by impressions descending on first render and keeps unmeasured rows last", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));
    const impressionsToggle = host.querySelector(
      '[data-sort-toggle="impressions"]',
    );
    const positionToggle = host.querySelector('[data-sort-toggle="position"]');

    expect(impressionsToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(positionToggle?.getAttribute("aria-pressed")).toBe("false");

    // Impressions THIS KEYWORD was measured with -- never the attributed
    // page's total across every query it ranks for. `review-existing-04` has
    // only the page numbers, so it counts as unmeasured here and falls to the
    // tail; ranking it by its page's 160 would have put a keyword with no
    // measured impressions above `optimize-00`, which has 100 of its own.
    //
    // `review-existing-00` and `optimize-04` both have 500. The tie goes to
    // provider search volume, not the alphabet: with no second quantity a run
    // carrying no Search Console evidence at all -- which this tool offers its
    // own button for -- degenerated into an A-Z list under a toggle that said
    // "by impressions".
    expect(visibleKeywords(host)).toEqual([
      "review-existing-00",
      "optimize-04",
      "review-existing-01",
      "review-existing-02",
      "review-existing-03",
      "optimize-03",
      "optimize-02",
      "optimize-01",
      "optimize-00",
      // Nothing measured left: the tail orders on search volume, and this row
      // carries the highest of the ninety-one.
      "verify-01",
    ]);
  });

  it("sorts by average position ascending, best first, when that toggle is pressed", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));
    const impressionsToggle = host.querySelector(
      '[data-sort-toggle="impressions"]',
    );
    const positionToggle = host.querySelector('[data-sort-toggle="position"]');

    await click(positionToggle);
    expect(positionToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(impressionsToggle?.getAttribute("aria-pressed")).toBe("false");

    // Best position FIRST: the row nearest page one is the one worth acting on
    // Ascending, best first, and again the keyword's own position rather than
    // its page's. `review-existing-04` has neither, so it is not among these.
    expect(visibleKeywords(host)).toEqual([
      "review-existing-00",
      "review-existing-01",
      "review-existing-02",
      "review-existing-03",
      "optimize-00",
      "optimize-01",
      "optimize-02",
      "optimize-03",
      "optimize-04",
      "verify-01",
    ]);
  });

  it("treats a row whose only numbers belong to its page as unmeasured", async () => {
    // `review-existing-04` carries pageImpressions 160 and pagePosition 10 and
    // nothing of its own. Those describe the page across every query it ranks
    // for, so using them here would rank this keyword by a number that is not
    // about this keyword. It sorts into the unmeasured tail in BOTH modes --
    // and last of all, because its search volume is the lowest there.
    const host = await renderResults(withResult({ rows: productionRows() }));

    await click(buttonFor(host, "actions.showAll"));
    expect(visibleKeywords(host).at(-1)).toBe("review-existing-04");

    await click(
      host.querySelector('[data-sort-toggle="position"]') as HTMLButtonElement,
    );
    await click(buttonFor(host, "actions.showAll"));
    expect(visibleKeywords(host).at(-1)).toBe("review-existing-04");
  });

  it("puts a null impressions row and a null position row last in their own mode", async () => {
    const measured = rowWithGsc(
      0,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 4,
        queryPosition: 40,
        nextStep: "optimize_existing",
      },
      { keyword: "aaa measured small" },
    );
    // Nulls on BOTH halves of each fallback, so neither mode can find a number
    // for it. The keyword sorts first alphabetically, so a tie-break alone
    // would put it on top -- only the missing-last rule keeps it at the bottom.
    const unmeasured = rowWithGsc(
      1,
      {
        queryStatus: "not_observed_in_gsc_query_sample",
        queryImpressions: null,
        queryPosition: null,
        pageImpressions: null,
        pagePosition: null,
        nextStep: "review_content_gap",
      },
      { keyword: "aaa unmeasured" },
    );
    const host = await renderResults(
      withResult({ rows: [unmeasured, measured] }),
    );

    expect(visibleKeywords(host)).toEqual([
      "aaa measured small",
      "aaa unmeasured",
    ]);
    await click(host.querySelector('[data-sort-toggle="position"]'));
    expect(visibleKeywords(host)).toEqual([
      "aaa measured small",
      "aaa unmeasured",
    ]);
  });

  it("breaks ties on the keyword, so two renders of one run agree", async () => {
    const tied = (index: number, keyword: string) =>
      rowWithGsc(
        index,
        {
          queryStatus: "observed_weak",
          evidenceBasis: "query",
          queryImpressions: 300,
          queryPosition: 12,
          nextStep: "optimize_existing",
        },
        { keyword },
      );
    // Supplied in reverse keyword order on purpose: a stable sort alone would
    // hand back the input order, so this fails unless the second key is real.
    const envelope = withResult({
      rows: [tied(0, "zeta tie"), tied(1, "alpha tie")],
    });
    const first = await renderResults(envelope);
    const firstOrder = visibleKeywords(first);

    expect(firstOrder).toEqual(["alpha tie", "zeta tie"]);
    await click(first.querySelector('[data-sort-toggle="position"]'));
    expect(visibleKeywords(first)).toEqual(["alpha tie", "zeta tie"]);

    await unmountResults();

    const second = await renderResults(envelope);
    expect(visibleKeywords(second)).toEqual(firstOrder);
  });

  it("resets the ten-row collapse when the order changes", async () => {
    const host = await renderResults(withResult({ rows: productionRows() }));

    await click(buttonFor(host, "actions.showAll"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(100);

    await click(host.querySelector('[data-sort-toggle="position"]'));
    // "The first ten" means something different in each order, so a hundred
    // rows left expanded across the change is not the screen the reader asked
    // for.
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(host.textContent).toContain("actions.remaining:count=90");
  });

  it("offers no order at all when the run measured neither key", async () => {
    // A run with no Search Console property -- which this tool offers its own
    // button for -- has null impressions and null position on every row. Both
    // toggles would then fall through to the same tie-break and produce the
    // same table, one of them highlighted under the words "by impressions"
    // while the order is really search volume, and the other doing nothing at
    // all when pressed.
    const rows = Array.from({ length: 3 }, (_, index) =>
      rowWithGsc(
        index,
        {
          queryStatus: "gsc_query_sample_not_read",
          evidenceBasis: null,
          queryImpressions: null,
          queryPosition: null,
          pageImpressions: null,
          pagePosition: null,
          nextStep: "verify_own_coverage",
        },
        { keyword: `no-gsc-${index}` },
      ),
    );
    const host = await renderResults(withResult({ rows }));

    expect(host.querySelector("[data-sort-toggles]")).toBeNull();
    // The table is still there, still ordered -- by search volume, which is
    // what the tie-break falls to. It just does not claim to be anything else.
    expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("offers only the key the run measured, and presses the one it kept", async () => {
    // Position without impressions: a reading can arrive on one key and not the
    // other, so the choice is made per key rather than on the run's overlay
    // status as a whole. This shape also pins the fallback -- the default
    // preference is "impressions", which this run cannot produce, so the one
    // remaining toggle has to read as pressed rather than leaving the reader a
    // lone unpressed button above a table that is already in its order.
    const rows = [
      rowWithGsc(
        0,
        {
          queryStatus: "observed_weak",
          evidenceBasis: "query",
          queryImpressions: null,
          queryPosition: 8,
          nextStep: "optimize_existing",
        },
        { keyword: "position only" },
      ),
      rowWithGsc(
        1,
        {
          queryStatus: "not_observed_in_gsc_query_sample",
          evidenceBasis: null,
          queryImpressions: null,
          queryPosition: null,
          nextStep: "review_content_gap",
        },
        { keyword: "nothing" },
      ),
    ];
    const host = await renderResults(withResult({ rows }));

    expect(host.querySelector('[data-sort-toggle="impressions"]')).toBeNull();
    expect(
      host
        .querySelector('[data-sort-toggle="position"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    // Pressed means it is really the order: the measured row leads, the
    // unmeasured one is last.
    expect(visibleKeywords(host)).toEqual(["position only", "nothing"]);
  });

  it("keeps the table open when the pressed order is pressed again", async () => {
    // Pressing the toggle that is already pressed changes nothing about the
    // order, so throwing away an expanded hundred rows and sending the reader
    // back to the top is a reset with no reason behind it.
    const host = await renderResults(withResult({ rows: productionRows() }));

    await click(buttonFor(host, "actions.showAll"));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(100);

    await click(host.querySelector('[data-sort-toggle="impressions"]'));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(100);
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

    // Closed on arrival, in every run: this is reference material, and opening
    // it put the longest block on the page between the reader and the table.
    // The mark on its summary is what carries the announcement now, so the
    // partial run is still visible without the reader opening anything.
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("[data-coverage-warning]")).not.toBeNull();
    // The summary card states no status sentence any more, so a partial run
    // announces itself through the warning frame, the completed-competitor
    // card, and this section's summary mark.
    const summary = host.querySelector('[data-run-status="partial"]');
    expect(summary).not.toBeNull();
    // The attribute alone proves nothing: it is assigned straight from the
    // status the test supplied, so it stays true with every visible sign of a
    // partial run deleted. The frame is what the reader actually sees.
    expect(summary?.className).toContain("brand-warning");
    expect(
      host.querySelector('[data-summary-metric="completed-competitors"]')
        ?.textContent,
    ).toContain("1 / 2");
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
    // No empty-state card, no table, and no status sentence: what tells the
    // reader nothing came back is the run-status frame plus a completed count
    // of zero, which is why that card cannot be dropped as a filler.
    expect(unavailable.textContent).not.toContain("empty.title");
    expect(unavailable.querySelector("table")).toBeNull();
    expect(
      unavailable.querySelector('[data-run-status="unavailable"]'),
    ).not.toBeNull();
    expect(
      unavailable.querySelector('[data-summary-metric="completed-competitors"]')
        ?.textContent,
    ).toContain("0 / 2");
  });

  it("says what a not-in-sample row does NOT mean, on the pill itself", async () => {
    // The label stays "not in sample" -- calling it "not covered" would state
    // something this tool cannot know, which a catalog-wide guard forbids. What
    // it could not say on its own goes in the title AND the accessible name:
    // the pill is a plain div with no tabIndex, so a keyboard user can never
    // surface a title on it.
    const host = await renderResults(
      withResult({
        rows: [
          rowWithGsc(
            0,
            {
              queryStatus: "not_observed_in_gsc_query_sample",
              evidenceBasis: null,
              queryImpressions: null,
              queryPosition: null,
              nextStep: "review_content_gap",
            },
            { keyword: "absent word" },
          ),
        ],
      }),
    );
    const pill = tableRow(host, "absent word").querySelector(
      "[data-gsc-status]",
    );

    expect(pill?.getAttribute("title")).toBe("gsc.notObservedTitle");
    expect(pill?.getAttribute("aria-label")).toContain("gsc.notObservedTitle");
  });

  it("does not qualify a row that WAS observed with the not-in-sample note", async () => {
    const host = await renderResults(
      withResult({
        rows: [
          rowWithGsc(
            0,
            {
              queryStatus: "observed_strong",
              evidenceBasis: "query",
              queryImpressions: 900,
              queryPosition: 4.1,
              nextStep: "review_existing_query",
            },
            { keyword: "present word" },
          ),
        ],
      }),
    );
    const pill = tableRow(host, "present word").querySelector(
      "[data-gsc-status]",
    );

    // The state pill carries no title at all now: the position qualification
    // moved to the chip that shows the position.
    expect(pill?.hasAttribute("title")).toBe(false);
    expect(pill?.getAttribute("aria-label")).not.toContain(
      "gsc.notObservedTitle",
    );
    expect(
      tableRow(host, "present word")
        .querySelector('[data-gsc-metrics="position"]')
        ?.getAttribute("title"),
    ).toBe("gsc.positionTitle");
  });

  it("gives the state, the impressions and the position a chip each", async () => {
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
    const positionChip = (keyword: string): Element | null =>
      tableRow(host, keyword).querySelector('[data-gsc-metrics="position"]');

    // The pill carries the STATE and nothing else. It used to carry the
    // average position welded on with a separator, which put a measurement
    // inside a state and left a dangling "·" whenever the number was absent.
    expect(pill("strong pill")?.textContent).toBe("gsc.observed_strong");
    expect(pill("weak pill")?.textContent).toBe("gsc.observed_weak");
    expect(pill("pill without position")?.textContent).toBe(
      "gsc.observed_weak",
    );
    expect(pill("keyword 04")?.textContent).toBe(
      "gsc.not_observed_in_gsc_query_sample",
    );
    expect(pill("pill unread")?.textContent).toBe(
      "gsc.gsc_query_sample_not_read",
    );
    for (const keyword of ["strong pill", "weak pill"]) {
      expect(pill(keyword)?.textContent).not.toContain("position");
    }

    // The position is its own chip, and only where there is one to show.
    expect(positionChip("strong pill")?.textContent).toBe(
      "gsc.positionChip:position=3.4",
    );
    expect(positionChip("weak pill")?.textContent).toBe(
      "gsc.positionChip:position=22.5",
    );
    expect(positionChip("pill without position")).toBeNull();
    expect(positionChip("keyword 04")).toBeNull();
    expect(positionChip("pill unread")).toBeNull();

    // The number is an impression-weighted average over a 28-day window that
    // itself ends two to three days back, and the short chip cannot say so.
    // The qualification followed the number out of the pill and onto the chip
    // that shows it.
    expect(positionChip("strong pill")?.getAttribute("title")).toBe(
      "gsc.positionTitle",
    );
    expect(positionChip("weak pill")?.getAttribute("title")).toBe(
      "gsc.positionTitle",
    );
    expect(pill("strong pill")?.hasAttribute("title")).toBe(false);
    expect(pill("weak pill")?.hasAttribute("title")).toBe(false);
    expect(pill("pill without position")?.hasAttribute("title")).toBe(false);
    // The state pill keeps the qualification that is about the STATE.
    expect(pill("keyword 04")?.getAttribute("title")).toBe(
      "gsc.notObservedTitle",
    );
    // "GSC not read" is not "looked and did not find", so the sample sentence
    // would be answering a question this row never asked.
    expect(pill("pill unread")?.hasAttribute("title")).toBe(false);

    // Tone still comes from the state alone; the position never changes it.
    expect(pill("strong pill")?.className).toContain("text-brand-success");
    expect(pill("weak pill")?.className).toContain("text-brand-warning");
    expect(pill("keyword 04")?.className).toContain("text-brand-error");
    expect(pill("pill unread")?.className).toContain(
      "text-text-dark-secondary",
    );

    // Impressions are a chip of their own too, and carry only impressions.
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
