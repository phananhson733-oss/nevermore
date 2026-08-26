// @vitest-environment jsdom
// @input  -- v3 gap rows whose lane, GSC evidence and attributed page decide what the recommended-action cell may offer
// @output -- proof each control is withheld unless its destination can act on the row, and that its label names the page it opens
// @pos    -- action-qualification verification for the Marketing competitor keyword gap results table

import { describe, expect, it, vi } from "vitest";
// The destination's own floor, imported so these fixtures follow it if the
// Opportunity Finder ever moves it. A literal here would keep asserting a
// number this surface no longer has to clear.
import { MIN_QUERY_IMPRESSIONS } from "@sf/public-tools/quick-wins/evidence";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";
import { ownPagePath } from "./competitor-keyword-gap-results-shared";
import {
  click,
  installResultsHarness,
  renderResults,
  rowWithGsc,
  tableRow,
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

describe("CompetitorKeywordGapResults recommended action", () => {
  it("names the page the control opens, query string and all", async () => {
    const attributed = (index: number, search: string, keyword: string) =>
      rowWithGsc(
        index,
        {
          queryStatus: "observed_weak",
          evidenceBasis: "query_page",
          pageStatus: "observed_partial",
          pageUrl: `https://example.com/products${search}`,
          pageImpressions: 12,
          pagePosition: 9.2,
          nextStep: "review_existing_query",
        },
        { keyword },
      );
    const audited = rowWithGsc(
      2,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 318,
        queryPosition: 22,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/products?category=boots&page=2",
        pageImpressions: 300,
        pagePosition: 23,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      { keyword: "audited row" },
    );
    const host = await renderResults(
      withResult({
        rows: [
          attributed(0, "?category=shoes", "shoes row"),
          attributed(1, "?category=hats", "hats row"),
          audited,
        ],
      }),
      { selectedProperty: "sc-domain:example.com" },
    );
    const openPage = (keyword: string): HTMLAnchorElement =>
      tableRow(host, keyword).querySelector<HTMLAnchorElement>(
        '[data-row-action="open-observed-page"]',
      ) as HTMLAnchorElement;

    // Search Console attributes query-string URLs routinely. These two rows
    // open different pages, so their labels have to read differently.
    expect(openPage("shoes row").textContent).toBe(
      "actions.reviewObservedPage:page=/products?category=shoes",
    );
    expect(openPage("hats row").textContent).toBe(
      "actions.reviewObservedPage:page=/products?category=hats",
    );
    expect(openPage("shoes row").getAttribute("href")).toBe(
      "https://example.com/products?category=shoes",
    );
    expect(openPage("shoes row").getAttribute("title")).toBe(
      "https://example.com/products?category=shoes",
    );

    // Still shortened so one long URL cannot push the column off the screen,
    // but from the MIDDLE: the URLs that need telling apart are exactly the
    // ones sharing a long prefix, so cutting the tail put back the very
    // collision that adding the query string removed. The title still carries
    // the whole URL the audit will run against.
    const checker = tableRow(host, "audited row").querySelector(
      '[data-row-action="open-checker"]',
    ) as HTMLAnchorElement;
    expect(checker.textContent).toBe(
      "actions.optimizeObservedPage:page=/products?cate\u2026=boots&page=2",
    );
    expect(checker.getAttribute("title")).toBe(
      "https://example.com/products?category=boots&page=2",
    );
    // The collision this shortening exists to avoid: two pages that differ
    // only past character 28 must not render the same label.
    expect(
      ownPagePath("https://example.com/collections/all?filter=color-red"),
    ).not.toBe(
      ownPagePath("https://example.com/collections/all?filter=color-blue"),
    );

    checker.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(checker);
    const stored = JSON.parse(
      String(sessionStorage.getItem(TOOL_HANDOFF_KEY)),
    ) as { readonly page: string };
    // The label, the title and the audited URL are one value, not three.
    expect(stored.page).toBe(checker.getAttribute("title"));
  });

  it("withholds the Opportunity Finder from a strong row its destination discards", async () => {
    const strong = (
      index: number,
      queryImpressions: number | null,
      keyword: string,
    ) =>
      rowWithGsc(
        index,
        {
          queryStatus: "observed_strong",
          evidenceBasis: "query",
          queryImpressions,
          queryPosition: 3.2,
          pageStatus: "observed_sufficient",
          pageUrl: `https://example.com/${keyword.replaceAll(" ", "-")}`,
          pageImpressions: 11,
          pagePosition: 3.3,
          queryPageCoverage: 0.9,
          nextStep: "review_existing_query",
        },
        { keyword },
      );
    const host = await renderResults(
      withResult({
        rows: [
          strong(0, MIN_QUERY_IMPRESSIONS - 1, "below the floor"),
          strong(1, MIN_QUERY_IMPRESSIONS, "at the floor"),
          // Not reachable from today's report builder, which fills the query
          // impressions on every `observed_strong` row. Asserted anyway: the
          // floor is a positive assertion, so a row carrying no count has to
          // fail it rather than pass it.
          strong(2, null, "no count at all"),
        ],
      }),
      { selectedProperty: "sc-domain:example.com" },
    );
    const finder = (keyword: string): Element | null =>
      tableRow(host, keyword).querySelector(
        '[data-row-action="open-opportunity-finder"]',
      );

    // `observed_strong` asks for ten impressions; seo-quick-wins drops every
    // query under its own floor before it builds an evidence table, so the
    // button would open a report that provably cannot show this keyword.
    expect(MIN_QUERY_IMPRESSIONS).toBeGreaterThan(10);
    expect(finder("below the floor")).toBeNull();
    expect(finder("no count at all")).toBeNull();
    expect(finder("at the floor")).toBeInstanceOf(HTMLAnchorElement);

    // A row that no longer qualifies falls through to the action it would
    // otherwise have had, rather than losing its cell.
    expect(
      tableRow(host, "below the floor")
        .querySelector('[data-row-action="open-observed-page"]')
        ?.getAttribute("href"),
    ).toBe("https://example.com/below-the-floor");
  });
});
