// @vitest-environment jsdom
// @input  -- production-shaped v3 competitor-gap envelopes with competitor pages, pre-screen bands, and SERP snapshots
// @output -- linked competitor chips, pre-screen band chips, snapshot and traffic chips, the sample rule, and the GSC zero-row limitation
// @pos    -- v3 signal-surface verification for the Marketing competitor keyword gap tool

import { describe, expect, it, vi } from "vitest";
import {
  BASE,
  installResultsHarness,
  renderResults,
  row,
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
    expect(trafficChip?.textContent?.trim()).toBe(
      "signals.competitorTraffic:value=812",
    );
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
    // The basis is VISIBLE on the chip, in short form. It has to be: three of
    // the reasons that produce a band come from this tool's own text and URL
    // heuristics rather than the provider, so a single column-level "estimate"
    // badge would state the wrong source for those rows.
    expect(
      prioritizedChip
        ?.querySelector('[data-pre-screen-basis="dfs_estimate"]')
        ?.textContent?.trim(),
    ).toBe("preScreen.basisShort.dfs_estimate");
    expect(
      brandChip
        ?.querySelector('[data-pre-screen-basis="tool_heuristic"]')
        ?.textContent?.trim(),
    ).toBe("preScreen.basisShort.tool_heuristic");
    // The long sentence and the reason stay in the title only.
    expect(host.querySelector("[data-pre-screen-reason]")).toBeNull();
    expect(host.textContent).not.toContain("preScreen.basis.");
    expect(host.textContent).not.toContain("preScreen.reason");
  });

  it("shows a dated AI Overview snapshot chip only when the snapshot lists it", async () => {
    const undated = row(3, {
      keyword: "undated snapshot",
      serpSnapshot: { itemTypes: ["ai_overview"], updatedAt: null },
    });
    // The guard only pins updatedAt to string | null; a provider format drift
    // falls back to the undated label rather than throwing in the formatter.
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
      "signals.aiOverviewSnapshotUndated",
    );
    expect(unreadableChip?.textContent).not.toContain("not-a-date");
  });

  it("offers the competitor page it will open, and no control at all when there is none", async () => {
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

    expect(open).toBeInstanceOf(HTMLAnchorElement);
    // One control per row, asserted as a COUNT. `querySelector` plus `toBe`
    // only proved which control came first, so a second one added after it
    // left this green.
    const controls = knownRow.querySelectorAll(
      "td:last-child a, td:last-child button",
    );
    expect(controls).toHaveLength(1);
    expect(controls[0]).toBe(open);
    expect(open.getAttribute("href")).toBe("https://beta.example/best");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    // The label names the competitor it is about to open, so a reader
    // scanning the column can tell one row's destination from the next.
    expect(open.textContent?.trim()).toBe(
      "actions.openCompetitorPageNamed:domain=beta.example",
    );
    // The best-rank competitor has no page here, so the link falls back to
    // any competitor page with a safe URL.
    const fallbackOpen = fallbackRow.querySelector(
      '[data-row-action="open-competitor-page"]',
    );
    expect(fallbackOpen?.getAttribute("href")).toBe(
      "https://alpha.example/fallback",
    );
    expect(fallbackOpen?.textContent?.trim()).toBe(
      "actions.openCompetitorPageNamed:domain=alpha.example",
    );
    // No competitor page means nothing to open. The row stays on screen and in
    // the CSV export; what it does not get is a button that goes nowhere.
    expect(
      unknownRow.querySelector('[data-row-action="open-competitor-page"]'),
    ).toBeNull();
    expect(
      unknownRow.querySelectorAll("td:last-child a, td:last-child button"),
    ).toHaveLength(0);
    expect(host.querySelector('[data-row-action="copy-keyword"]')).toBeNull();
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

    await unmountResults();

    const forty = await renderResults(
      withResult({ overlayStatus: "available", gscQueryRowCount: 40 }),
    );
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
    expect(notRequested.textContent).not.toContain("limitations.gscNoRows");
  });
});
