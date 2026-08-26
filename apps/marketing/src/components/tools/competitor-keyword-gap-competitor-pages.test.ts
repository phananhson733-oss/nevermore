// @input  -- v3 competitor gap rows carrying provider page URLs
// @output -- a failing test when the action label and the link destination can disagree
// @pos    -- unit cover for the row derivations behind the competitor action button

import { describe, expect, it } from "vitest";
import type { CompetitorKeywordGapRow } from "@sf/public-tools/competitor-keyword-gap";

import {
  bestCompetitorPageHost,
  bestCompetitorPageUrl,
} from "./competitor-keyword-gap-competitor-pages";

function rowWithPage(domain: string, url: string | null): CompetitorKeywordGapRow {
  return {
    keyword: "approval workflow",
    competitorRanks: { [domain]: 4 },
    competitorPages: { [domain]: { url, title: null, etv: null } },
    competitorCount: 1,
    bestCompetitorRank: 4,
    ownState: "not_observed_in_provider_rankings",
    searchVolume: { availability: "available", value: 100 },
    cpc: { availability: "provider_no_data", value: null },
    keywordDifficulty: { availability: "provider_no_data", value: null },
    providerIntent: null,
    coreKeyword: null,
    searchVolumeTrend: null,
    serpSnapshot: null,
    preScreen: {
      band: "unbanded",
      basis: "dfs_estimate",
      reason: "dfs_metric_missing",
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
  };
}

describe("bestCompetitorPageHost", () => {
  it("names the host the link opens, not the competitor it is filed under", () => {
    // The provider reports whatever URL ranked for the competitor it was
    // asked about; that URL is not bound to the competitor's own hostname.
    // Reading the map key would label a redirector as the competitor.
    const row = rowWithPage("beta.example", "https://tracking.example/landing");

    expect(bestCompetitorPageUrl(row)).toBe("https://tracking.example/landing");
    expect(bestCompetitorPageHost(row)).toBe("tracking.example");
  });

  it("strips a leading www. only when something is left behind", () => {
    expect(
      bestCompetitorPageHost(rowWithPage("a.example", "https://www.a.example/x")),
    ).toBe("a.example");
    // `https://www./path` parses and passes the URL safety checks. Stripping
    // unconditionally left an empty label on a live link -- an action naming
    // nowhere at all.
    expect(
      bestCompetitorPageHost(rowWithPage("a.example", "https://www./path")),
    ).toBeNull();
  });

  it("returns null when no competitor page has a safe URL", () => {
    expect(bestCompetitorPageHost(rowWithPage("a.example", null))).toBeNull();
    expect(
      bestCompetitorPageHost(
        rowWithPage("a.example", "javascript:alert(1)"),
      ),
    ).toBeNull();
  });
});
