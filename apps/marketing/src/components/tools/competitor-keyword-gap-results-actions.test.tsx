// @vitest-environment jsdom
// @input  -- production-shaped competitor-gap envelopes, with and without a selected GSC property
// @output -- the one recommended action each lane offers, the private handoff it writes, and the two exports
// @pos    -- action-and-export verification for the Marketing competitor keyword gap results surface

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useTranslations } from "next-intl";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";
import { CsvExportButton } from "./competitor-keyword-gap-csv-button";
import type { Translate } from "./competitor-keyword-gap-results-shared";
import {
  BASE,
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

/**
 * jsdom has the two object-URL functions but no download, so the file is
 * captured where the browser would have taken it: the blob handed to
 * `createObjectURL` and the anchor's own `download` attribute.
 */
function stubDownloads(): {
  readonly blobs: readonly Blob[];
  readonly downloads: readonly {
    readonly href: string;
    readonly name: string;
  }[];
  readonly revoked: readonly string[];
} {
  const blobs: Blob[] = [];
  const downloads: { href: string; name: string }[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    (blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return "blob:competitor-keyword-gap";
    },
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download });
  });
  return { blobs, downloads, revoked };
}

describe("CompetitorKeywordGapResults actions and exports", () => {
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
      "actions.handoffFailedOnPage",
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

  it("hands a strong row to the Opportunity Finder and opens a partial row's page", async () => {
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

    // A row already ranking is not missing a page audit, it is missing clicks,
    // so the strong row goes to the Opportunity Finder rather than the checker.
    expect(
      tableRow(host, "strong sufficient").querySelector(
        '[data-row-action="open-opportunity-finder"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement);
    expect(
      tableRow(host, "strong sufficient").querySelector(
        '[data-row-action="open-checker"]',
      ),
    ).toBeNull();
    const pageLink = tableRow(host, "partial page").querySelector(
      '[data-row-action="open-observed-page"]',
    ) as HTMLAnchorElement;
    expect(pageLink).toBeInstanceOf(HTMLAnchorElement);
    expect(pageLink.getAttribute("href")).toBe("https://example.com/partial");
    expect(pageLink.getAttribute("target")).toBe("_blank");
    expect(pageLink.getAttribute("rel")).toContain("noopener");
    expect(
      tableRow(host, "unsafe page").querySelector(
        '[data-row-action="open-observed-page"]',
      ),
    ).toBeNull();
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
    expect(host.querySelector('[data-row-action="open-checker"]')).toBeNull();
  });

  it("offers the property control for the lane with no GSC evidence, and no copy control anywhere", async () => {
    const focusProperty = vi.fn();
    const host = await renderResults(
      withResult({
        rows: [
          row(0, {
            keyword: "content gap target",
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
      [...tableRow(host, "focus target").querySelectorAll("button")].find(
        (button) => button.textContent?.includes("actions.focusProperty"),
      ) ?? null,
    );
    expect(focusProperty).toHaveBeenCalledOnce();

    // The row-level clipboard action is gone: the CSV export carries every row,
    // so a per-row copy would be a second, quieter way to take one out.
    expect(host.querySelector('[data-row-action="copy-keyword"]')).toBeNull();
    expect(host.textContent).not.toContain("actions.copyKeyword");
    expect(writeTextMock).not.toHaveBeenCalled();
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

  it("offers the Opportunity Finder for an observed-strong row with a property and hands it the property only", async () => {
    const strongReview = rowWithGsc(
      0,
      {
        queryStatus: "observed_strong",
        evidenceBasis: "query",
        queryImpressions: 900,
        queryPosition: 4.1,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/ranking",
        pageImpressions: 880,
        pagePosition: 4.2,
        queryPageCoverage: 0.95,
        nextStep: "review_existing_query",
      },
      { keyword: "strong review" },
    );
    // Not reachable from today's report builder, which only files an
    // observed_weak row under optimize_existing. Asserted anyway: a strong row
    // must never become an On-Page audit of a page that already ranks.
    const strongOptimize = rowWithGsc(
      1,
      {
        queryStatus: "observed_strong",
        evidenceBasis: "query",
        queryImpressions: 700,
        queryPosition: 5,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/also-ranking",
        pageImpressions: 690,
        pagePosition: 5.1,
        queryPageCoverage: 0.95,
        nextStep: "optimize_existing",
      },
      { keyword: "strong optimize" },
    );
    const weak = rowWithGsc(
      2,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 120,
        queryPosition: 26,
        pageStatus: "observed_sufficient",
        pageUrl: "https://example.com/weak",
        pageImpressions: 110,
        pagePosition: 27,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      { keyword: "weak optimize" },
    );
    const rows = [strongReview, strongOptimize, weak];
    const host = await renderResults(withResult({ rows }), {
      selectedProperty: "sc-domain:example.com",
    });
    const finder = (keyword: string): HTMLAnchorElement | null =>
      tableRow(host, keyword).querySelector<HTMLAnchorElement>(
        '[data-row-action="open-opportunity-finder"]',
      );

    expect(finder("strong review")?.textContent).toBe(
      "actions.openOpportunityFinder",
    );
    expect(finder("strong optimize")).toBeInstanceOf(HTMLAnchorElement);
    expect(finder("weak optimize")).toBeNull();
    expect(
      tableRow(host, "weak optimize").querySelector(
        '[data-row-action="open-checker"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement);

    const link = finder("strong review") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/tools/seo-quick-wins");
    expect(link.getAttribute("href")).not.toContain("?");
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(link);

    const stored = JSON.parse(
      String(sessionStorage.getItem(TOOL_HANDOFF_KEY)),
    ) as Readonly<Record<string, unknown>>;
    expect(stored.source).toBe("competitor-keyword-gap");
    expect(stored.destination).toBe("seo-quick-wins");
    expect(stored.scope).toBe("property");
    expect(stored.property).toBe("sc-domain:example.com");
    // The destination selects a property and reads nothing else, so carrying
    // the keyword would put a value on the wire that no surface reads.
    expect(stored.query).toBeNull();
    expect(stored.page).toBeNull();
    expect(stored.marketCode).toBe("US");
    expect(stored.languageCode).toBe("en");
    expect(String(stored.evidenceId).length).toBeLessThanOrEqual(256);

    await unmountResults();

    // No property, no destination: the Finder cannot run without one, so the
    // row falls back to opening the page Search Console attributed.
    const withoutProperty = await renderResults(withResult({ rows }), {
      selectedProperty: "",
    });
    expect(
      withoutProperty.querySelector(
        '[data-row-action="open-opportunity-finder"]',
      ),
    ).toBeNull();
    expect(
      tableRow(withoutProperty, "strong review").querySelector(
        '[data-row-action="open-observed-page"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement);
  });

  it("cancels the Opportunity Finder navigation and names that destination when storage fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
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
              pageStatus: "observed_sufficient",
              pageUrl: "https://example.com/ranking",
              pageImpressions: 880,
              pagePosition: 4.2,
              queryPageCoverage: 0.95,
              nextStep: "review_existing_query",
            },
            { keyword: "strong review" },
          ),
        ],
      }),
      { selectedProperty: "sc-domain:example.com" },
    );

    expect(
      await click(
        host.querySelector('[data-row-action="open-opportunity-finder"]'),
      ),
    ).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "actions.handoffFailedOpportunityFinder",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain(
      "actions.handoffFailedOnPage",
    );
  });

  it("renders no action at all for a content-gap row with no competitor page", async () => {
    const host = await renderResults(
      withResult({ rows: [row(0, { keyword: "gap without a page" })] }),
    );
    const cell = tableRow(host, "gap without a page").querySelector(
      "td:last-child",
    );

    // The row is still on screen and still in the export; what it does not get
    // is a control that would go nowhere.
    expect(cell?.querySelectorAll("a, button")).toHaveLength(0);
    expect(cell?.textContent).toBe("");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("exports every returned row and says so in the label while the table shows ten", async () => {
    const captured = stubDownloads();
    const host = await renderResults(withResult({ rows: productionRows() }));
    const exportButton = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>('[data-export-csv]');

    // Two exports sit side by side and do different things, so each names its
    // own number: the plan copies the ten rows on screen, this carries all 100.
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(exportButton()?.textContent).toBe("actions.exportCsv:count=100");
    expect(
      host.querySelector('[data-row-action="copy-plan"]')?.textContent,
    ).toContain("actions.copyPlan:count=10");

    // A lane filter narrows the table and the plan; it never narrows the file.
    await click(
      host.querySelector('[data-next-step-filter="verify_own_coverage"]'),
    );
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(exportButton()?.textContent).toBe("actions.exportCsv:count=100");
    expect(
      host.querySelector('[data-row-action="copy-plan"]')?.textContent,
    ).toContain("actions.copyPlan:count=2");

    await click(exportButton());
    expect(captured.blobs).toHaveLength(1);
    expect(captured.blobs[0]?.type).toBe("text/csv;charset=utf-8");
    const text = await (captured.blobs[0] as Blob).text();
    const lines = text.split("\r\n");
    expect(lines).toHaveLength(101);
    expect(lines[0]).toContain("capturedAt,siteDomain,marketCode");
    // A row the table never showed, in a lane the filter excluded.
    expect(text).toContain("content-gap-87");
    expect(text).toContain("optimize-00");
    expect(captured.downloads).toEqual([
      {
        href: "blob:competitor-keyword-gap",
        name: "competitor-keyword-gap-example.com-2026-08-24.csv",
      },
    ]);

    // Released on the next tick, not in the same task: Safari has revoked the
    // blob out from under its own download when the two happen together.
    expect(captured.revoked).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captured.revoked).toEqual(["blob:competitor-keyword-gap"]);
  });

  it("disables the export when the run returned no rows", async () => {
    stubDownloads();
    const t = useTranslations() as unknown as Translate;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CsvExportButton result={{ ...BASE.result, rows: [] }} t={t} />,
      );
    });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-export-csv]',
    );

    expect(button?.textContent).toBe("actions.exportCsv:count=0");
    expect(button?.disabled).toBe(true);
    await click(button);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
