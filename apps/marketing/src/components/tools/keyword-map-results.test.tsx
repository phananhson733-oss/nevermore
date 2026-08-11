// @input  -- keyword map results rendered through the real message bundles
// @output -- a failing test when an unread sample renders as a count, when a run
//            with no rows renders as a blank, or when the advice sinks below the evidence
// @pos    -- the guard on the report surface's reading order and its honest absences
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type {
  KeywordOpportunityFunnel,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
} from "@sf/public-tools/keyword-opportunity/types";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import {
  FUNNEL_STEPS,
  KeywordMapResults,
  funnelGridDividesEvenly,
} from "./keyword-map-results.tsx";

const FUNNEL: KeywordOpportunityFunnel = {
  generated: 150,
  deduplicated: 150,
  providerReturned: 41,
  volumePositive: 30,
  explicitZero: 11,
  providerNoData: 109,
  alreadyCovered: 0,
  serpSampled: 20,
  winnableEvidence: 10,
  shown: 2,
};

function seoRow(keyword: string): KeywordOpportunityRow {
  return {
    keyword,
    lane: "seo",
    discoveryBasis: "site_proposition",
    questionForm: false,
    propositionIndex: 0,
    validation: {
      availability: "available",
      volume: 320,
      difficulty: 14,
      intent: "commercial",
      serpFeatures: [],
    },
    serp: {
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 8,
      topTenDomains: ["example.com"],
      isEstimate: false,
    },
    coverage: "not_observed_in_gsc_query_sample",
    supportingPageUrl: null,
    nextChecks: ["read_page_one_intent"],
    clusterId: "cluster-1",
  };
}

function result(
  overrides: Partial<KeywordOpportunityResult> = {},
): KeywordOpportunityResult {
  return {
    availability: "available",
    marketCode: "US",
    languageCode: "en",
    context: {
      siteUrl: "https://acme.test",
      pagesFetched: 14,
      productPagesFetched: 3,
      propositions: [
        { statement: "Billing for dental clinics", sourceUrl: "https://acme.test/" },
      ],
      contextSufficient: true,
      stopReason: "page_budget_reached",
    },
    rows: [seoRow("dental billing software"), seoRow("dental billing service")],
    withheld: [],
    clusters: [],
    funnel: FUNNEL,
    unavailableStages: [],
    nextStepSuggestions: [],
    ...overrides,
  };
}

function render(
  locale: "en" | "zh",
  value: KeywordOpportunityResult = result(),
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <KeywordMapResults result={value} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe("keyword map results", () => {
  it.each(["en", "zh"] as const)("renders a full run in %s", (locale) => {
    // A MISSING_MESSAGE throws at render, so this is the cheapest proof that a
    // locale can show the surface at all.
    const markup = render(locale);
    expect(markup).toContain("dental billing software");
    expect(markup).toContain("acme.test");
  });

  it("says the coverage sample was never read instead of counting zero", () => {
    // The single fact this report exists to protect. `null` is "nobody looked";
    // rendering it as a count would answer a question nobody asked, in the one
    // place readers skim.
    const markup = render(
      "en",
      result({
        funnel: { ...FUNNEL, alreadyCovered: null },
        availability: "partial",
        unavailableStages: ["gsc_coverage"],
      }),
    );
    const label = en.tools.keywordMap.funnel.alreadyCovered;
    const tile = markup.slice(
      markup.lastIndexOf("<div", markup.indexOf(label)),
      markup.indexOf(label),
    );
    expect(tile).toContain(en.tools.keywordMap.notMeasured);
    expect(tile).not.toContain(">0<");
  });

  it("keeps priced-at-zero and no-provider-data as separate gates", () => {
    // Collapsing them is the mistake the three-state volume design exists to
    // prevent, and a surface that shows only their sum has made it for us.
    const markup = render("en");
    expect(markup).toContain(en.tools.keywordMap.funnel.explicitZero);
    expect(markup).toContain(en.tools.keywordMap.funnel.providerNoData);
    expect(markup).toContain(en.tools.keywordMap.funnel.volumePositive);
  });

  it("keeps the funnel grid divisible by its column count", () => {
    // The tiles are separated by a 1px gap over the container's colour, so a
    // column the last row does not fill renders as a slab of divider colour.
    // Adding a tenth gate without changing the grid brings that back, and it
    // is invisible in a fixture short enough to fit one row.
    expect(FUNNEL_STEPS.length).toBeGreaterThan(0);
    expect(funnelGridDividesEvenly()).toBe(true);
  });

  it("explains a run that produced no rows", () => {
    const markup = render("en", result({ rows: [], funnel: { ...FUNNEL, shown: 0 } }));
    expect(markup).toContain(en.tools.keywordMap.emptyTitle);
    expect(markup).not.toContain(en.tools.keywordMap.lane.seo.title);
    expect(markup).not.toContain(en.tools.keywordMap.lane.geo.title);
  });

  it("puts the suggestions above the tables, not below the withheld list", () => {
    // They are only ever populated by a degraded run, so they answer the first
    // question a thin report raises. Below the withheld list is the furthest
    // point on the page from the reader who needs them.
    const markup = render(
      "en",
      result({
        availability: "insufficient_evidence",
        nextStepSuggestions: ["add_seed_keywords"],
        withheld: [
          {
            keyword: "dental billing pricing",
            discoveryBasis: "traditional_expansion",
            reason: "no_measured_demand",
          },
        ],
      }),
    );
    const advice = markup.indexOf(en.tools.keywordMap.nextSteps.add_seed_keywords);
    const table = markup.indexOf(en.tools.keywordMap.lane.seo.title);
    const withheld = markup.indexOf(en.tools.keywordMap.withheldTitle);
    expect(advice).toBeGreaterThan(-1);
    expect(advice).toBeLessThan(table);
    expect(table).toBeLessThan(withheld);
  });

  it("groups only the clusters that hold more than one term", () => {
    // Every unmatched keyword becomes its own cluster in the payload. Rendering
    // those turns "terms that could share a page" into a second results table.
    const markup = render(
      "en",
      result({
        clusters: [
          {
            id: "cluster-1",
            label: "dental billing",
            keywords: ["dental billing software", "dental billing service"],
          },
          { id: "cluster-2", label: "orthodontic intake", keywords: ["orthodontic intake"] },
        ],
      }),
    );
    expect(markup).toContain(en.tools.keywordMap.clustersTitle);
    expect(markup).not.toContain("orthodontic intake");
  });

  it("hides the cluster section when nothing groups", () => {
    const markup = render(
      "en",
      result({
        clusters: [
          { id: "cluster-1", label: "dental billing software", keywords: ["dental billing software"] },
        ],
      }),
    );
    expect(markup).not.toContain(en.tools.keywordMap.clustersTitle);
  });

  it("carries an exit card, because the shell drops its own once connected", () => {
    // ConnectedToolPage hides the "public tools you can run first" aside for a
    // connected visitor on the grounds that the report has its own. Without
    // this, a finished run is the one page on the site with nowhere to go.
    expect(render("en")).toContain('href="/tools/seo-audit"');
    expect(render("zh")).toContain('href="/zh/tools/internal-link-audit"');
  });

  it("stays silent when a complete run has nothing to suggest", () => {
    const markup = render("en");
    expect(markup).not.toContain(en.tools.keywordMap.nextStepsTitle);
    expect(markup).not.toContain(en.tools.keywordMap.availability.available);
  });
});
