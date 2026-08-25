// @input  -- nothing at runtime; a production-shaped v3 competitor-gap envelope and a React DOM mount of the results surface
// @output -- the BASE envelope, row and result builders, one isolated mount per test, and DOM query helpers
// @pos    -- shared harness for the Marketing competitor gap results surface tests; not collected as a test itself

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";
import { CompetitorKeywordGapResults } from "./competitor-keyword-gap-results";

export const BASE: CompetitorKeywordGapEnvelope = {
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
export const writeTextMock = vi.fn();

/** Unmounts the current surface and clears the document; the next renderResults starts clean. */
export async function unmountResults(): Promise<void> {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
}

/** Registers per-test mount, clipboard, and session isolation; call once at the top of a test file. */
export function installResultsHarness(): void {
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
    await unmountResults();
    vi.restoreAllMocks();
  });
}

export function row(
  index: number,
  overrides: Partial<CompetitorKeywordGapRow> = {},
): CompetitorKeywordGapRow {
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

export function withResult(
  result: Partial<CompetitorKeywordGapEnvelope["result"]>,
  status: CompetitorKeywordGapEnvelope["run"]["status"] = BASE.run.status,
): CompetitorKeywordGapEnvelope {
  return {
    run: { ...BASE.run, status },
    result: { ...BASE.result, ...result },
  };
}

export function rowWithGsc(
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

export function productionRows(): readonly CompetitorKeywordGapRow[] {
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

export async function renderResults(
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

export async function click(element: Element | null): Promise<boolean> {
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

export function tableRow(
  host: HTMLElement,
  keyword: string,
): HTMLTableRowElement {
  const result = [
    ...host.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ].find((candidate) => candidate.textContent?.includes(keyword));
  if (result === undefined) throw new Error(`No row for ${keyword}`);
  return result;
}

export function buttonFor(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (result === undefined) throw new Error(`No button for ${label}`);
  return result;
}
