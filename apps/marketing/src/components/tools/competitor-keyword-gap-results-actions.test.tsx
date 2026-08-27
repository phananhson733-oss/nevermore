// @vitest-environment jsdom
// @input  -- production-shaped competitor-gap envelopes, with and without a selected GSC property
// @output -- the one recommended action each lane offers, the private handoff it writes, and the capped CSV export
// @pos    -- action-and-export verification for the Marketing competitor keyword gap results surface

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useTranslations } from "next-intl";
import { COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS } from "@sf/public-tools/competitor-keyword-gap/csv";
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
    // This run is a manual snapshot with no persistence: navigating this tab
    // away discards a paid report and Back returns to an empty form. So the
    // handoff opens a new tab -- and keeps an opener, which is the part that is
    // easy to "fix" into a bug. Session storage is copied into a new tab only
    // when that tab has an opener, and `target="_blank"` is noopener by default
    // in current browsers, so `noopener` here would deliver the visitor to a
    // destination that reads nothing and looks like it lost the property.
    // Measured in Chromium and WebKit. Asserted exactly, because the string
    // "noopener" contains "opener".
    expect(checker.getAttribute("target")).toBe("_blank");
    expect(checker.getAttribute("rel")).toBe("opener");
    expect(checker.getAttribute("rel")).not.toContain("noopener");
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
    // The opposite call, on purpose: this one leaves our origin and carries no
    // handoff, so it gets the full noopener/noreferrer treatment.
    expect(pageLink.getAttribute("rel")).toContain("noopener");
    expect(pageLink.getAttribute("rel")).toContain("noreferrer");
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
    // Same reasoning as the checker link above: a new tab that keeps its
    // opener, because the handoff rides session storage.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("opener");
    expect(link.getAttribute("rel")).not.toContain("noopener");
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

  it("names the row count the file will hold, and nothing about the cut", async () => {
    const captured = stubDownloads();
    const host = await renderResults(withResult({ rows: productionRows() }));
    const exportButton = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>("[data-export-csv]");

    // 100 rows, under the cap. The count is now the only thing the surface
    // says about the file: the sentence naming the basis of the cut was removed
    // by decision, and this asserts the absence so it does not drift back.
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(exportButton()?.textContent).toBe("actions.exportCsv:count=100");
    expect(host.querySelector("[data-export-csv-basis]")).toBeNull();
    // Complete run, so no missing-competitor warning.
    expect(host.querySelector("[data-export-csv-partial]")).toBeNull();

    await click(exportButton());
    expect(captured.blobs).toHaveLength(1);
    expect(captured.blobs[0]?.type).toBe("text/csv;charset=utf-8");
    const text = await (captured.blobs[0] as Blob).text();

    // Reading order is a display choice; the file has its own rule, and this
    // proves it with the BYTES rather than the button text. Asserting the
    // label was unchanged would pass just as happily if the export silently
    // followed the toggle, which is the thing being ruled out.
    await click(host.querySelector('[data-sort-toggle="position"]'));
    expect(exportButton()?.textContent).toBe("actions.exportCsv:count=100");
    await click(exportButton());
    expect(captured.blobs).toHaveLength(2);
    expect(await (captured.blobs[1] as Blob).text()).toBe(text);

    const lines = text.split("\r\n");
    expect(lines).toHaveLength(101);
    // The two fields this surface's claims rest on: the keyword the file is a
    // list of, and the estimate the cut is made on. The column SET and its
    // order belong to the export module's own suite, so pinning them here
    // would only break this test when that one changes on purpose.
    expect(lines[0]?.split(",")).toEqual(
      expect.arrayContaining(["keyword", "searchVolume"]),
    );
    // A row the collapsed table never showed.
    expect(text).toContain("content-gap-87");
    expect(text).toContain("optimize-00");
    expect(captured.downloads).toEqual([
      {
        href: "blob:competitor-keyword-gap",
        name: "competitor-keyword-gap-example.com-2026-08-24.csv",
      },
      {
        href: "blob:competitor-keyword-gap",
        name: "competitor-keyword-gap-example.com-2026-08-24.csv",
      },
    ]);

    // Both object URLs are released once their ticks have run. WHEN each one
    // runs relative to the other is not asserted here: an earlier version
    // counted one revoke at this point, which held only while the first
    // download's timer had fired and the second's had not -- a race between two
    // zero-delay timers and the awaits above, and it failed about one run in
    // ten. The same-task property it was reaching for is pinned deterministically
    // in the test below.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captured.revoked).toEqual([
      "blob:competitor-keyword-gap",
      "blob:competitor-keyword-gap",
    ]);
  });

  it("releases the object URL on a later task, never the one that clicked", async () => {
    // Safari has revoked the blob out from under its own download when the
    // create, the click and the revoke happen in one task. Fake timers are what
    // make this an assertion rather than a bet: a real zero-delay timer may or
    // may not have run by the time the next line executes, while a fake one
    // provably has not until it is advanced.
    vi.useFakeTimers();
    try {
      const captured = stubDownloads();
      const host = await renderResults(withResult({ rows: productionRows() }));

      await click(host.querySelector("[data-export-csv]"));

      expect(captured.downloads).toHaveLength(1);
      expect(captured.revoked).toEqual([]);

      vi.runAllTimers();
      expect(captured.revoked).toEqual(["blob:competitor-keyword-gap"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the cap, not the run, once a run returns more rows than the file holds", async () => {
    const captured = stubDownloads();
    const overCap = Array.from(
      { length: COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS + 53 },
      (_, index) => row(index),
    );
    const host = await renderResults(withResult({ rows: overCap }));
    const exportButton = host.querySelector<HTMLButtonElement>(
      "[data-export-csv]",
    );

    // The run returned 203 rows and the file will carry 150 of them. The old
    // label said "export all 203 rows as CSV", which the file simply was not.
    expect(
      host.querySelector('[data-summary-metric="returned-gap-rows"]')
        ?.textContent,
    ).toContain("203");
    expect(exportButton?.textContent).toBe(
      `actions.exportCsv:count=${String(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS)}`,
    );

    await click(exportButton);
    const text = await (captured.blobs[0] as Blob).text();
    expect(text.split("\r\n")).toHaveLength(
      COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS + 1,
    );
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
