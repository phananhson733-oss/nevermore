// @vitest-environment jsdom
// @input  -- complete, partial, unavailable, and empty competitor-gap envelopes
// @output -- honest DFS/GSC summary, metric, rank, link, truncation, and table semantics
// @pos    -- read-only result contract for the Marketing competitor keyword gap tool

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorKeywordGapEnvelope } from "@sf/public-tools/competitor-keyword-gap";

type ResultsProps = {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
};

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, values?: Readonly<Record<string, unknown>>) => {
      const rendered = values
        ? Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")
        : "";
      return rendered === "" ? key : `${key}:${rendered}`;
    },
}));

let Results: ComponentType<ResultsProps>;
try {
  const modulePath = "./competitor-keyword-gap-results.tsx";
  ({ CompetitorKeywordGapResults: Results } = await import(
    /* @vite-ignore */ modulePath
  ));
} catch {
  const MissingResults: ComponentType<ResultsProps> = () => <div />;
  Results = MissingResults;
}

const BASE: CompetitorKeywordGapEnvelope = {
  run: {
    tool: "competitor_keyword_gap",
    schemaVersion: "competitor_keyword_gap.v1",
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
        competitorCount: 2,
        bestCompetitorRank: 4,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 2900 },
        cpc: { availability: "explicit_zero", value: 0 },
        keywordDifficulty: {
          availability: "provider_no_data",
          value: null,
        },
        providerIntent: "commercial",
        gsc: {
          queryStatus: "observed_weak",
          queryImpressions: 318,
          queryPosition: 34,
          pageUrl: "https://example.com/product",
          nextStep: "optimize_existing",
        },
      },
      {
        keyword: "approval policy template",
        competitorRanks: { "alpha.example": 12 },
        competitorCount: 1,
        bestCompetitorRank: 12,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "explicit_zero", value: 0 },
        cpc: { availability: "provider_no_data", value: null },
        keywordDifficulty: { availability: "available", value: 17 },
        providerIntent: null,
        gsc: {
          queryStatus: "not_observed_in_gsc_query_sample",
          queryImpressions: null,
          queryPosition: null,
          pageUrl: "javascript:alert(1)",
          nextStep: "review_content_gap",
        },
      },
    ],
    resultTruncated: false,
    overlayStatus: "available",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
  },
};

let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function renderResults(
  envelope: CompetitorKeywordGapEnvelope = BASE,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Results envelope={envelope} locale="en" />);
  });
  return host;
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

describe("CompetitorKeywordGapResults", () => {
  it("renders the captured site-versus-competitors scope before its source legend", async () => {
    const host = await renderResults();
    const scope = host.querySelector("[data-scope-strip]");
    const legend = host.querySelector("[data-source-legend]");

    expect(host.querySelector('[data-run-status="complete"]')).not.toBeNull();
    expect(scope).not.toBeNull();
    expect(scope?.textContent).toContain("example.com");
    expect(scope?.querySelector("[data-scope-versus]")?.textContent).toBe(
      "summary.versus",
    );
    expect(scope?.textContent).toContain("alpha.example");
    expect(scope?.textContent).toContain("beta.example");
    expect(scope?.textContent).toContain("US");
    expect(scope?.textContent).toContain("en");
    expect(scope?.querySelector("time")?.getAttribute("datetime")).toBe(
      BASE.result.capturedAt,
    );
    expect(legend?.querySelector('[data-source="dfs"]')?.textContent).toContain(
      "sources.dfs",
    );
    expect(legend?.querySelector('[data-source="gsc"]')?.textContent).toContain(
      "sources.gsc",
    );
    expect(
      scope !== null && legend !== null
        ? Boolean(
            scope.compareDocumentPosition(legend) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
  });

  it("renders three stable overview metrics without turning returned rows into a total", async () => {
    const host = await renderResults();
    const rows = host.querySelector(
      '[data-summary-metric="returned-gap-rows"]',
    );
    const competitors = host.querySelector(
      '[data-summary-metric="completed-competitors"]',
    );
    const gsc = host.querySelector(
      '[data-summary-metric="gsc-observed-rows"]',
    );

    expect(host.querySelectorAll("[data-summary-metric]")).toHaveLength(3);
    expect(rows?.textContent).toContain("overview.returnedGapRows");
    expect(rows?.textContent).toContain("2");
    expect(rows?.textContent).toContain("overview.returnedGapRowsBody");
    expect(competitors?.textContent).toContain("2 / 2");
    expect(gsc?.textContent).toContain("1");
  });

  it.each(["not_requested", "unavailable"] as const)(
    "shows the GSC overview metric as unavailable when the overlay is %s",
    async (overlayStatus) => {
      const host = await renderResults(withResult({ overlayStatus }));
      const gsc = host.querySelector(
        '[data-summary-metric="gsc-observed-rows"]',
      );

      expect(gsc?.textContent).toContain("—");
      expect(gsc?.textContent).toContain(`sources.status.${overlayStatus}`);
    },
  );

  it("keeps provider null distinct from explicit zero and renders every competitor rank", async () => {
    const host = await renderResults();
    const firstRow = host.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    const secondRow = host.querySelectorAll("tbody tr")[1] as HTMLTableRowElement;

    expect(firstRow.textContent).toContain("2,900");
    expect(firstRow.textContent).toContain("0");
    expect(firstRow.textContent).toContain("—");
    expect(
      firstRow.querySelectorAll("[data-competitor-rank]"),
    ).toHaveLength(2);
    expect(firstRow.textContent).toContain("alpha.example");
    expect(firstRow.textContent).toContain("#4");
    expect(firstRow.textContent).toContain("beta.example");
    expect(firstRow.textContent).toContain("#9");
    expect(firstRow.textContent).toContain("intent.commercial");
    expect(firstRow.textContent).toContain("metrics.searchVolume");
    expect(firstRow.textContent).toContain("metrics.cpc");
    expect(secondRow.textContent).toContain("0");
  });

  it("renders GSC facts, a safe page link, and plain-text recommendations without action CTAs", async () => {
    const host = await renderResults();
    const rows = host.querySelectorAll("tbody tr");
    const safeLink = rows[0]?.querySelector("a");
    const recommendation = rows[0]?.querySelector("td:last-child");

    expect(rows[0]?.textContent).toContain("gsc.observed_weak");
    expect(rows[0]?.textContent).toContain("318");
    expect(rows[0]?.textContent).toContain("34");
    expect(safeLink?.getAttribute("href")).toBe("https://example.com/product");
    expect(safeLink?.getAttribute("rel")).toContain("noopener");
    expect(recommendation?.textContent).toContain(
      "nextSteps.optimize_existing",
    );
    expect(recommendation?.querySelector("a, button")).toBeNull();
    expect(rows[1]?.textContent).toContain(
      "gsc.not_observed_in_gsc_query_sample",
    );
    expect(rows[1]?.textContent).toContain("nextSteps.review_content_gap");
    expect(rows[1]?.querySelector("a")).toBeNull();
  });

  it("renders semantic table structure with overflow constrained to its wrapper", async () => {
    const host = await renderResults();
    const table = host.querySelector("table") as HTMLTableElement;
    const wrapper = table.parentElement as HTMLElement;

    expect(table.querySelector("caption")?.textContent).toContain(
      "table.caption",
    );
    expect(table.querySelector("thead")).not.toBeNull();
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(5);
    expect(
      [...table.querySelectorAll('thead th[scope="col"]')].map((header) =>
        header.textContent?.trim(),
      ),
    ).toEqual([
      "table.keyword",
      "table.dfsEstimates",
      "table.competitorRanks",
      "table.ownSiteGsc",
      "table.recommendation",
    ]);
    expect(wrapper.classList.contains("overflow-x-auto")).toBe(true);
    expect(wrapper.tabIndex).toBe(0);
    expect(wrapper.getAttribute("aria-labelledby")).toBe(
      "competitor-keyword-gap-table-title",
    );
    expect(
      host.querySelector("#competitor-keyword-gap-table-title")?.textContent,
    ).toContain("table.title");
    expect(wrapper.className).toContain("focus-visible:outline-2");
    expect(table.className).toContain("min-w-[760px]");
    expect(host.firstElementChild?.className).not.toContain("overflow-x-auto");
  });

  it("moves technical coverage after the table and opens it for partial or truncated evidence", async () => {
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

    expect(host.textContent).toContain("status.partial");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(true);
    expect(details?.textContent).toContain("coverage.unavailable");
    expect(details?.textContent).toContain("coverage.truncated");
    expect(details?.textContent).toContain(
      "coverage.failure:code=keyword_source_unavailable",
    );
    expect(details?.textContent).toContain("limitations.resultTruncated");
    expect(details?.textContent).toContain("limitations.gscQueryTruncated");
    expect(details?.textContent).toContain(
      "limitations.gscQueryPageTruncated",
    );
    expect(
      table !== null && details !== null
        ? Boolean(
            table.compareDocumentPosition(details) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
  });

  it("keeps complete warning-free technical coverage collapsed by default", async () => {
    const host = await renderResults();
    const details = host.querySelector("details[data-coverage-details]");

    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("coverage.scope");
    expect(details?.textContent).toContain("alpha.example");
    expect(details?.textContent).toContain("beta.example");
  });

  it("always states four durable evidence boundaries after technical coverage", async () => {
    const host = await renderResults();
    const details = host.querySelector("details[data-coverage-details]");
    const boundaries = host.querySelector("[data-evidence-boundaries]");

    expect(boundaries).not.toBeNull();
    expect(boundaries?.querySelectorAll("li")).toHaveLength(4);
    for (const key of [
      "boundaries.dfsEstimates",
      "boundaries.gscOwnSample",
      "boundaries.competitorOutcomesUnavailable",
      "boundaries.manualSnapshot",
    ]) {
      expect(boundaries?.textContent).toContain(key);
    }
    expect(
      details !== null && boundaries !== null
        ? Boolean(
            details.compareDocumentPosition(boundaries) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
  });

  it("distinguishes an honest empty result from an unavailable run", async () => {
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
  });
});
