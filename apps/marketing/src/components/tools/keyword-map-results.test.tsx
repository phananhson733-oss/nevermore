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
  FUNNEL_COLUMNS,
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

/**
 * The bundle's copy as react-dom writes it into markup.
 *
 * react escapes `&`, `<`, `>`, `"` and `'` in text children, so a string with
 * an apostrophe never appears in the output verbatim. Comparing against the
 * raw bundle value makes `toContain` fail and — worse — makes `not.toContain`
 * pass for copy that is right there on the page.
 */
function asRendered(copy: string): string {
  return copy
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
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

/**
 * The one tile carrying `label`, as markup.
 *
 * Asserting that a label and a number both appear somewhere on the page proves
 * nothing about which number sits under which label — the counts could be
 * swapped, or all three could be the same value, and the assertion would hold.
 */
function tileFor(markup: string, label: string): string {
  const at = markup.indexOf(asRendered(label));
  expect(at, `no tile labelled ${label}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf('<div class="px-3', at);
  expect(start, `${label} is not inside a tile`).toBeGreaterThan(-1);
  return markup.slice(start, at);
}

describe("keyword map results", () => {
  it.each(["en", "zh"] as const)("renders a full run in %s", (locale) => {
    const markup = render(locale);
    expect(markup).toContain("dental billing software");
    expect(markup).toContain("acme.test");
    // next-intl renders a key it cannot resolve as the dotted path rather than
    // throwing, so a hole in one bundle is invisible to any assertion about
    // the data. The namespace prefix appearing at all IS the hole.
    expect(markup).not.toContain("tools.keywordMap.");
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
    const tile = tileFor(markup, en.tools.keywordMap.funnel.alreadyCovered);
    expect(tile).toContain(asRendered(en.tools.keywordMap.notMeasured));
    expect(tile).not.toContain(">0<");
  });

  it("blanks the page-one tiles when the sampling stage did not run", () => {
    // The payload does not carry null for these: a failed stage leaves both at
    // 0, which reads as "we opened twenty page ones and found nothing" on the
    // same card whose verdict says nobody opened any.
    const markup = render(
      "en",
      result({
        availability: "partial",
        unavailableStages: ["serp_sample"],
        funnel: { ...FUNNEL, serpSampled: 0, winnableEvidence: 0 },
      }),
    );
    for (const step of ["serpSampled", "winnableEvidence"] as const) {
      const tile = tileFor(markup, en.tools.keywordMap.funnel[step]);
      expect(tile, step).toContain(asRendered(en.tools.keywordMap.notMeasured));
      expect(tile, step).not.toContain(">0<");
    }
  });

  it("keeps a capped sample's real counts, because they were measured", () => {
    // `serp_sample_cost_capped` means fewer page ones than wanted, not none.
    // Blanking a partial measurement is its own kind of lie.
    const markup = render(
      "en",
      result({
        availability: "partial",
        unavailableStages: ["serp_sample_cost_capped"],
      }),
    );
    expect(tileFor(markup, en.tools.keywordMap.funnel.serpSampled)).toContain(
      ">20<",
    );
  });

  it("keeps priced-at-zero and no-provider-data as separate gates", () => {
    // Collapsing them is the mistake the three-state volume design exists to
    // prevent. Each label is checked against ITS OWN number: three labels and
    // three numbers all present somewhere would also hold if the values were
    // swapped or all three read the same total.
    const markup = render("en");
    const expected = {
      explicitZero: FUNNEL.explicitZero,
      providerNoData: FUNNEL.providerNoData,
      volumePositive: FUNNEL.volumePositive,
    } as const;
    for (const [step, value] of Object.entries(expected)) {
      expect(
        tileFor(markup, en.tools.keywordMap.funnel[step as keyof typeof expected]),
        step,
      ).toContain(`>${value}<`);
    }
  });

  it("names the two demand states apart in the withheld list too", () => {
    // The funnel splitting them at aggregate level is no use to someone
    // deciding about one term: a priced zero is finished, a provider silence
    // is still open, and they used to share one line.
    const markup = render(
      "en",
      result({
        withheld: [
          {
            keyword: "priced at zero",
            discoveryBasis: "traditional_expansion",
            reason: "volume_priced_at_zero",
          },
          {
            keyword: "never priced",
            discoveryBasis: "traditional_expansion",
            reason: "volume_not_returned",
          },
        ],
      }),
    );
    expect(markup).toContain(
      asRendered(en.tools.keywordMap.withheld.volume_priced_at_zero),
    );
    expect(markup).toContain(
      asRendered(en.tools.keywordMap.withheld.volume_not_returned),
    );
  });

  it("keeps the funnel grid divisible by its column count", () => {
    // The tiles are separated by a 1px gap over the container's colour, so a
    // column the last row does not fill renders as a slab of divider colour.
    // Adding a tenth gate without changing the grid brings that back, and it
    // is invisible in a fixture short enough to fit one row.
    expect(FUNNEL_STEPS.length).toBeGreaterThan(0);
    expect(funnelGridDividesEvenly()).toBe(true);
    // And that the constant is the column count the page actually uses.
    // Checking divisibility alone guards an arithmetic fact about a number no
    // stylesheet reads: `grid-cols-4` in the JSX would leave it true.
    expect(render("en")).toContain(`grid-cols-${FUNNEL_COLUMNS}`);
  });

  it("explains a run that produced no rows", () => {
    const markup = render(
      "en",
      result({ rows: [], funnel: { ...FUNNEL, shown: 0 } }),
    );
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyTitle));
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyBody));
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.lane.seo.title));
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.lane.geo.title));
  });

  it("does not say the gates dropped candidates a gate never saw", () => {
    // Empty because every gate ran and rejected everything is a finding.
    // Empty because a stage failed is a hole. The default body claims the
    // first, and on a partial run that dresses missing evidence as a result.
    const markup = render(
      "en",
      result({
        rows: [],
        availability: "partial",
        unavailableStages: ["serp_sample"],
        funnel: { ...FUNNEL, shown: 0, serpSampled: 0 },
      }),
    );
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyBodyPartial));
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.emptyBody));
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
            reason: "volume_not_returned",
          },
        ],
      }),
    );
    const advice = markup.indexOf(asRendered(en.tools.keywordMap.nextSteps.add_seed_keywords));
    const table = markup.indexOf(asRendered(en.tools.keywordMap.lane.seo.title));
    const withheld = markup.indexOf(asRendered(en.tools.keywordMap.withheldTitle));
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
    expect(markup).toContain(asRendered(en.tools.keywordMap.clustersTitle));
    expect(markup).not.toContain("orthodontic intake");
    // The heading alone would survive `groups.map` being deleted, leaving an
    // empty card that still passes a test named for the grouping.
    expect(markup).toContain(">dental billing<");
    expect(markup).toContain(">dental billing software<");
    expect(markup).toContain(">dental billing service<");
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
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.clustersTitle));
  });

  it("never shows a visitor a key path, whatever the payload names", () => {
    // The reason is a deploy, not a type. A tab holds the bundle it loaded;
    // this tool's second request lands minutes later, so a run started before
    // a release and finished after it asks an old bundle to name a value only
    // the new one has. Observed on 2026-08-11: the first real run after
    // splitting `no_measured_demand` rendered
    // "tools.keywordMap.withheld.volume_not_returned  48" on screen.
    //
    // Every field here is typed as a closed union, which is exactly the
    // reasoning that left them unguarded — completeness holds within one
    // build, and the two sides of this are two builds.
    const markup = render(
      "en",
      result({
        availability: "a_state_from_a_newer_build" as never,
        rows: [
          {
            ...seoRow("dental billing software"),
            coverage: "a_coverage_from_a_newer_build" as never,
            nextChecks: ["a_check_from_a_newer_build" as never],
          },
        ],
        withheld: [
          {
            keyword: "dental billing pricing",
            discoveryBasis: "traditional_expansion",
            reason: "a_reason_from_a_newer_build" as never,
          },
        ],
      }),
    );
    expect(markup).not.toContain("tools.keywordMap.");
    for (const value of [
      "a_state_from_a_newer_build",
      "a_coverage_from_a_newer_build",
      "a_check_from_a_newer_build",
      "a_reason_from_a_newer_build",
    ]) {
      expect(markup, value).toContain(value);
    }
  });

  it("names a market, language or stage the bundle never learned", () => {
    // The API validates marketCode and languageCode only as non-empty strings,
    // and `unavailableStages` / `nextStepSuggestions` are plain string arrays.
    // next-intl renders a missing key as its dotted path, so without a
    // fallback the report reads "market tools.keywordMap.markets.PT" after the
    // visitor waited two minutes and a provider bill for it.
    const markup = render(
      "en",
      result({
        marketCode: "PT",
        languageCode: "pt",
        availability: "partial",
        unavailableStages: ["a_stage_added_after_this_bundle"],
        nextStepSuggestions: ["a_step_added_after_this_bundle"],
      }),
    );
    // Asserting the code alone would pass on the broken output too: the key
    // path CONTAINS the code. The absence of the key path is the whole test.
    expect(markup).not.toContain("tools.keywordMap.");
    expect(markup).toContain("for PT / pt");
    expect(markup).toContain("a_stage_added_after_this_bundle");
    expect(markup).toContain("a_step_added_after_this_bundle");
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
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.nextStepsTitle));
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.availability.available));
  });
});
