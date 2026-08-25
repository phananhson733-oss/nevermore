// @vitest-environment jsdom
// @input  -- production-shaped competitor-gap envelopes
// @output -- compact six-column results, qualified actions, and bounded evidence rendering
// @pos    -- result-surface verification for the Marketing competitor keyword gap tool

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";
import { CompetitorKeywordGapResults } from "./competitor-keyword-gap-results";

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

const BASE: CompetitorKeywordGapEnvelope = {
  run: {
    tool: "competitor_keyword_gap",
    schemaVersion: "competitor_keyword_gap.v3",
    mode: "public_preview",
    scope: "site",
    persistence: "none",
    completedAt: "2026-08-24T12:00:00.000Z",
    status: "complete",
  },
  result: {
    capturedAt: "2026-08-24T12:00:00.000Z",
    siteDomain: "example.com",
    competitorDomains: ["alpha.example", "beta.example"],
    marketCode: "US",
    languageCode: "en",
    sampleRule: {
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    },
    requestedCompetitors: 2,
    completedCompetitors: 2,
    unavailableCompetitors: 0,
    competitors: [
      {
        domain: "alpha.example",
        status: "complete",
        returnedRows: 2,
        totalCount: 2,
        truncated: false,
        failureCode: null,
      },
      {
        domain: "beta.example",
        status: "complete",
        returnedRows: 1,
        totalCount: 1,
        truncated: false,
        failureCode: null,
      },
    ],
    rows: [
      {
        keyword: "approval workflow software",
        competitorRanks: { "alpha.example": 4, "beta.example": 9 },
        competitorPages: {
          "alpha.example": {
            url: "https://alpha.example/approvals",
            title: "Alpha approvals",
            etv: 812.4,
          },
          "beta.example": { url: null, title: null, etv: null },
        },
        competitorCount: 2,
        bestCompetitorRank: 4,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 2900 },
        cpc: { availability: "explicit_zero", value: 0 },
        keywordDifficulty: { availability: "provider_no_data", value: null },
        providerIntent: "commercial",
        coreKeyword: "approval workflow",
        searchVolumeTrend: { monthly: 4, quarterly: -2, yearly: 11 },
        serpSnapshot: {
          itemTypes: ["organic", "ai_overview"],
          updatedAt: "2026-05-14T18:17:21.000Z",
        },
        preScreen: {
          band: "unbanded",
          basis: "dfs_estimate",
          reason: "dfs_metric_missing",
        },
        gsc: {
          queryStatus: "observed_weak",
          evidenceBasis: "query",
          queryImpressions: 318,
          queryPosition: 34,
          pageStatus: "observed_sufficient",
          pageUrl: "https://example.com/product",
          pageImpressions: 300,
          pagePosition: 12.4,
          queryPageCoverage: 0.94,
          nextStep: "optimize_existing",
        },
      },
      {
        keyword: "approval policy template",
        competitorRanks: { "alpha.example": 12 },
        competitorPages: {
          "alpha.example": {
            url: "https://alpha.example/templates/approval-policy",
            title: "Approval policy template",
            etv: 120,
          },
        },
        competitorCount: 1,
        bestCompetitorRank: 12,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "explicit_zero", value: 0 },
        cpc: { availability: "provider_no_data", value: null },
        keywordDifficulty: { availability: "available", value: 17 },
        providerIntent: null,
        coreKeyword: null,
        searchVolumeTrend: null,
        serpSnapshot: {
          itemTypes: ["organic"],
          updatedAt: "2026-05-14T18:17:21.000Z",
        },
        preScreen: {
          band: "stretch",
          basis: "dfs_estimate",
          reason: "kd_mid_rank_top20",
        },
        gsc: {
          queryStatus: "not_observed_in_gsc_query_sample",
          evidenceBasis: null,
          queryImpressions: null,
          queryPosition: null,
          pageStatus: "not_observed_in_gsc_query_page_sample",
          pageUrl: null,
          pageImpressions: null,
          pagePosition: null,
          queryPageCoverage: null,
          nextStep: "review_content_gap",
        },
      },
    ],
    resultTruncated: false,
    overlayStatus: "available",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
    gscQueryRowCount: 2,
    gscQueryPageRowCount: 2,
  },
};

let root: Root | null = null;
const writeTextMock = vi.fn();

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function row(
  index: number,
  overrides: Partial<
    CompetitorKeywordGapEnvelope["result"]["rows"][number]
  > = {},
): CompetitorKeywordGapEnvelope["result"]["rows"][number] {
  return {
    keyword: `keyword ${String(index).padStart(2, "0")}`,
    competitorRanks: { "alpha.example": index + 1 },
    competitorPages: { "alpha.example": { url: null, title: null, etv: null } },
    competitorCount: 1,
    bestCompetitorRank: index + 1,
    ownState: "not_observed_in_provider_rankings",
    searchVolume: { availability: "available", value: 1000 + index },
    cpc: { availability: "available", value: 1 + index / 10 },
    keywordDifficulty: { availability: "available", value: 20 + index },
    providerIntent: "commercial",
    coreKeyword: null,
    searchVolumeTrend: null,
    serpSnapshot: null,
    preScreen: {
      band: "stretch",
      basis: "dfs_estimate",
      reason: "kd_mid_rank_top20",
    },
    gsc: {
      queryStatus: "not_observed_in_gsc_query_sample",
      evidenceBasis: null,
      queryImpressions: null,
      queryPosition: null,
      pageStatus: "not_observed_in_gsc_query_page_sample",
      pageUrl: null,
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
      nextStep: "review_content_gap",
    },
    ...overrides,
  };
}

function withResult(
  result: Partial<CompetitorKeywordGapEnvelope["result"]>,
  status: CompetitorKeywordGapEnvelope["run"]["status"] = BASE.run.status,
): CompetitorKeywordGapEnvelope {
  return {
    run: { ...BASE.run, status },
    result: { ...BASE.result, ...result },
  };
}

function rowWithGsc(
  index: number,
  gsc: Partial<CompetitorKeywordGapRow["gsc"]>,
  overrides: Partial<Omit<CompetitorKeywordGapRow, "gsc">> = {},
): CompetitorKeywordGapRow {
  const base = row(index);
  return {
    ...base,
    ...overrides,
    gsc: { ...base.gsc, ...gsc },
  };
}

function productionRows(): readonly CompetitorKeywordGapRow[] {
  const optimize = Array.from({ length: 5 }, (_, index) =>
    rowWithGsc(
      index,
      {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 100 + index * 100,
        queryPosition: 20 + index,
        pageStatus: "observed_sufficient",
        pageUrl: `https://example.com/optimize/${index}`,
        pageImpressions: 90 + index * 90,
        pagePosition: 19 + index,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
      { keyword: `optimize-${String(index).padStart(2, "0")}` },
    ),
  );
  const reviewExisting = Array.from({ length: 5 }, (_, index) =>
    rowWithGsc(
      index + 5,
      {
        queryStatus: index === 0 ? "observed_strong" : "observed_weak",
        evidenceBasis: index === 4 ? "query_page" : "query",
        queryImpressions: index === 4 ? null : 500 - index * 30,
        queryPosition: index === 4 ? null : 5 + index,
        pageStatus: index === 0 ? "observed_sufficient" : "observed_partial",
        pageUrl: `https://example.com/review/${index}`,
        pageImpressions: 200 - index * 10,
        pagePosition: 6 + index,
        queryPageCoverage: index === 0 ? 0.9 : 0.5,
        nextStep: "review_existing_query",
      },
      { keyword: `review-existing-${String(index).padStart(2, "0")}` },
    ),
  );
  const contentGap = Array.from({ length: 88 }, (_, index) =>
    rowWithGsc(
      index + 10,
      {},
      { keyword: `content-gap-${String(index).padStart(2, "0")}` },
    ),
  );
  const verify = Array.from({ length: 2 }, (_, index) =>
    rowWithGsc(
      index + 98,
      {
        queryStatus: "gsc_query_sample_not_read",
        pageStatus: "gsc_query_page_sample_not_read",
        nextStep: "verify_own_coverage",
      },
      { keyword: `verify-${String(index).padStart(2, "0")}` },
    ),
  );
  return [...optimize, ...reviewExisting, ...contentGap, ...verify];
}

async function renderResults(
  envelope: CompetitorKeywordGapEnvelope = BASE,
  options?: {
    readonly locale?: string;
    readonly selectedProperty?: string;
    readonly onFocusProperty?: () => void;
  },
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <CompetitorKeywordGapResults
        envelope={envelope}
        locale={options?.locale ?? "en"}
        selectedProperty={options?.selectedProperty ?? "sc-domain:example.com"}
        onFocusProperty={options?.onFocusProperty ?? vi.fn()}
      />,
    );
  });
  return host;
}

async function click(element: Element | null): Promise<boolean> {
  if (!(element instanceof HTMLElement)) {
    expect(element, "expected clickable element").not.toBeNull();
    return true;
  }
  let allowed = true;
  await act(async () => {
    allowed = element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
  return allowed;
}

function tableRow(host: HTMLElement, keyword: string): HTMLTableRowElement {
  const result = [
    ...host.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ].find((candidate) => candidate.textContent?.includes(keyword));
  if (result === undefined) throw new Error(`No row for ${keyword}`);
  return result;
}

function buttonFor(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (result === undefined) throw new Error(`No button for ${label}`);
  return result;
}

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

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

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
    const withoutTraffic = tableRow(host, "approval policy template");
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

    expect(
      withTraffic.querySelector("[data-competitor-traffic]")?.textContent,
    ).toContain("signals.competitorTraffic:value=812");
    expect(
      withoutTraffic.querySelector("[data-competitor-traffic]")?.textContent,
    ).toContain("signals.competitorTraffic:value=120");

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
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
  });

  it("shows a dated AI Overview snapshot chip only when the snapshot lists it", async () => {
    const undated = row(3, {
      keyword: "undated snapshot",
      serpSnapshot: { itemTypes: ["ai_overview"], updatedAt: null },
    });
    const host = await renderResults(
      withResult({ rows: [...BASE.result.rows, undated, row(4)] }),
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
    expect(
      fallbackRow
        .querySelector('[data-row-action="open-competitor-page"]')
        ?.getAttribute("href"),
    ).toBe("https://alpha.example/fallback");
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
    expect(host.querySelectorAll("[data-pre-screen-filter]")).toHaveLength(6);

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

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

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

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

    const notRequested = await renderResults(
      withResult({ overlayStatus: "not_requested", gscQueryRowCount: null }),
    );
    expect(notRequested.querySelector("[data-gsc-query-rows]")).toBeNull();
    expect(notRequested.textContent).not.toContain("limitations.gscNoRows");
  });
});
