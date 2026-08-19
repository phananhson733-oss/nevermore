// @vitest-environment jsdom
// @input  -- complete and deliberately degraded v3 reports
// @output -- proof every number is rendered beside its own denominator
// @pos    -- component test for the only rendering of GEO evidence

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json";
import type { GeoConfirmedAliasV1 } from "../../../lib/agents/geo-context";
import type { GeoProviderObservation } from "../../../lib/agents/geo-provider";
import type { GeoQueryUnitV1 } from "../../../lib/agents/geo-query-contract";
import type {
  GeoQuestionObservationV3,
  GeoReportDataV3,
  GeoSurfaceProvenanceV1,
} from "../../../lib/agents/geo-report-contract";
import {
  deriveGeoRunCoverage,
  geoReportContentHash,
} from "../../../lib/agents/geo-report-derive";
import {
  assembleQuestion,
  observeToSample,
  type GeoSamplingContext,
} from "../../../lib/agents/geo-sampling";
import { GeoReportView } from "./geo-report-view";

const ALIASES: readonly GeoConfirmedAliasV1[] = [
  { alias: "Acme Analytics", source: "profile_product_name" },
];

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: ALIASES,
  aliasScope: "supported",
};

const PROBE: GeoQueryUnitV1 = {
  queryId: "core-category_discovery",
  slot: "category_discovery",
  text: "What are the top seo tools right now?",
  cohort: "core",
  mode: "retrieval_probe",
  brandStance: "unbranded",
  buyerStage: "awareness",
  marketCode: "US",
  queryLanguageTag: "en",
  timeSensitive: true,
  asOf: "2026-08-18T09:00:00.000Z",
  expectedAssetTypes: ["blog_guide"],
  source: "profile",
  userConfirmed: true,
  templateId: "geo.retrieval.category_top",
  templateVersion: "1",
  retrievalTriggerClause: null,
  samplesPlanned: 3,
};

const NATURAL: GeoQueryUnitV1 = {
  ...PROBE,
  queryId: "core-brand_comparison",
  slot: "brand_comparison",
  text: "How does Acme Analytics compare to other seo tools?",
  mode: "natural_demand",
  brandStance: "brand",
  buyerStage: "decision",
  timeSensitive: false,
  asOf: null,
  templateId: "geo.natural.brand_comparison",
  samplesPlanned: 1,
};

function observation(
  overrides: Partial<GeoProviderObservation> = {},
): GeoProviderObservation {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: true,
    answerText: "Acme Analytics and others cover this.",
    citations: [
      {
        url: "https://acme.test/pricing?utm_source=openai",
        title: "Acme pricing",
        annotationText: "([acme.test](https://acme.test/pricing))",
        providerOutputItemIndex: 1,
        sectionIndex: 0,
        annotationOrdinal: 0,
        startIndex: 0,
        endIndex: 4,
        spanBasis: "provider_message_section_text",
      },
      {
        url: "https://rival.test/overview",
        title: "Rival overview",
        annotationText: null,
        providerOutputItemIndex: 1,
        sectionIndex: 0,
        annotationOrdinal: 1,
        startIndex: null,
        endIndex: null,
        spanBasis: "provider_message_section_text",
      },
    ],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
    ...overrides,
  };
}

const PROVENANCE: GeoSurfaceProvenanceV1 = {
  collector: "dataforseo",
  upstream: "openai",
  surface: "dataforseo_chat_gpt_llm_responses_api",
  searchModeRequested: "web_search_permitted",
  modelRequested: "gpt-5-2025-08-07",
  modelObserved: ["gpt-5-2025-08-07"],
  maxOutputTokensRequested: 4_096,
  webSearchCountryIsoCodeRequested: "US",
  calibrationMarket: "US",
  triggerCalibrationScope: "calibrated_market",
  queryLanguageTag: "en",
  retrievalSamplesPerProbe: 3,
  naturalDemandSamplesPerQuery: 1,
  knownCostUsdMicros: 182_800,
  costComplete: true,
  unknownCostSamples: 0,
};

async function buildReport({
  searched = true,
}: { readonly searched?: boolean } = {}): Promise<GeoReportDataV3> {
  const probeSamples = [1, 2, 3].map((index) =>
    observeToSample(
      {
        queryIndex: 0,
        sampleIndex: index,
        sampleId: `${PROBE.queryId}-s${index}`,
      },
      PROBE,
      observation({ webSearchPerformed: searched }),
      CONTEXT,
    ),
  );
  const naturalSamples = [
    observeToSample(
      { queryIndex: 1, sampleIndex: 1, sampleId: `${NATURAL.queryId}-s1` },
      NATURAL,
      observation({ webSearchPerformed: false, citations: [] }),
      CONTEXT,
    ),
  ];
  const questions: readonly GeoQuestionObservationV3[] = [
    assembleQuestion(PROBE, probeSamples),
    assembleQuestion(NATURAL, naturalSamples),
  ];
  const limitations = searched
    ? (["report_contents_not_persisted", "no_paired_recheck"] as const)
    : ([
        "report_contents_not_persisted",
        "no_paired_recheck",
        "degraded_retrieval_trigger",
      ] as const);
  const run = {
    schemaVersion: "agent_geo_report.v3",
    runId: "run-01",
    sampledAt: "2026-08-18T09:05:00.000Z",
    targetHost: "acme.test",
    contextHash: `sha256:${"a".repeat(64)}`,
    querySetContentHash: `sha256:${"b".repeat(64)}`,
    provenance: PROVENANCE,
  } as const;

  return {
    run: {
      agent: "geo",
      mode: "authenticated_agent",
      persistence: "report_contents_not_persisted",
      ...run,
      reportContentHash: await geoReportContentHash(run, questions, [
        ...limitations,
      ]),
    },
    coverage: deriveGeoRunCoverage(questions),
    questions,
    limitations: [...limitations],
  };
}

describe("GeoReportView", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  /** The overview figure printed under a given label. */
  function numberUnder(label: string): string | undefined {
    const term = [...host.querySelectorAll("dt")].find(
      (node) => node.textContent?.trim() === label,
    );
    return term?.parentElement?.querySelector("dd")?.textContent?.trim();
  }

  function render(report: GeoReportDataV3): void {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{ agents: en.agents }}
        >
          <GeoReportView
            report={report}
            locale="en"
            onRestart={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("shows the collector and the upstream separately", async () => {
    render(await buildReport());

    // Never rendered as if the visitor had asked ChatGPT themselves.
    expect(host.textContent).toContain("dataforseo");
    expect(host.textContent).toContain("openai");
    expect(host.textContent).toContain("dataforseo_chat_gpt_llm_responses_api");
    expect(host.textContent).toContain("4096");
  });

  it("renders the exact cited URL, not a host chip", async () => {
    render(await buildReport());
    const links = [...host.querySelectorAll("a")];

    expect(links.map((link) => link.getAttribute("href"))).toContain(
      "https://acme.test/pricing?utm_source=openai",
    );
    for (const link of links) {
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("labels only the citations that are the customer's own", async () => {
    // Ownership can only be "target" or "unknown" and source type only
    // "owned_page" or "unknown", so labelling the unknown case put the same two
    // grey chips on every third-party row — the first thing the eye hit, and
    // never a fact about the row. Found by reading the first real report,
    // 2026-08-18.
    render(await buildReport());
    const text = host.textContent ?? "";

    expect(text).toContain("Your site");
    expect(text).toContain("Your page");
    expect(text).not.toContain("Ownership unknown");
    expect(text).not.toContain("Source type unknown");
    // The third-party citation is still shown in full, just unlabelled.
    expect(text).toContain("https://rival.test/overview");
    expect(text).toContain("Rival overview");
  });

  // The single most actionable fact in the run — which hosts the answers keep
  // reaching for — was only derivable by scrolling five screens and counting by
  // hand. Added 2026-08-18 after reading the first real report.
  it("aggregates who the answers cited, against the same denominator", async () => {
    render(await buildReport());
    // Scoped to the table. Both hosts already appear in the identity and
    // per-sample rows, so an unscoped substring match stays green with the
    // table's body removed.
    const table = host.querySelector('[data-testid="geo-sources-retrieval_probe"]');
    const text = table?.textContent ?? "";

    expect(host.textContent).toContain("Who these answers actually cited");
    expect(text).toContain("acme.test");
    expect(text).toContain("rival.test");
    // The fixture's retrieval probe has three citation-evaluable samples, and
    // that exact number has to be the one printed — a loose \d+ passes on the
    // run total, which is the blend this table exists to avoid.
    expect(text).toContain("3 citation-evaluable samples");
    expect(text).toContain("acme.test is among them.");
  });

  // Regression: the first version totalled both modes into one denominator,
  // treating one repeat of a three-sample probe as interchangeable with a whole
  // one-shot question. Found by cross-model review on 2026-08-18.
  it("keeps the two modes' source tables apart", async () => {
    render(await buildReport());
    const retrieval = host.querySelector(
      '[data-testid="geo-sources-retrieval_probe"]',
    );
    const natural = host.querySelector(
      '[data-testid="geo-sources-natural_demand"]',
    );

    // The retrieval half counts its own three samples. The natural-demand
    // question in this fixture cited nobody, so its table says so rather than
    // borrowing the retrieval denominator.
    expect(retrieval?.textContent).toContain("3 citation-evaluable samples");
    expect(natural?.textContent).toContain(
      "No citation-evaluable sample cited anything",
    );
    expect(natural?.textContent).not.toContain("citation-evaluable samples.");
    // And no blended total exists anywhere: four scheduled samples across the
    // two modes must never become one denominator.
    expect(host.textContent).not.toContain("4 citation-evaluable samples");
  });

  it("does not label what any cited host is", async () => {
    // A URL does not say whether a page is a review, a marketplace, a community
    // thread or a vendor's own marketing. The sampler already refuses to guess
    // that; the aggregate must not reintroduce it.
    render(await buildReport());
    const text = host.textContent ?? "";

    for (const invented of ["Community", "Marketplace", "Editorial", "Vendor"]) {
      expect(text).not.toContain(invented);
    }
  });

  it("does not print an annotation that only restates its own link", async () => {
    // The provider's annotation is normally the markdown link itself, so every
    // row showed the same address twice.
    render(await buildReport());

    expect(host.textContent).not.toContain("Answer annotation");
  });

  it("puts the probe verdict on the question, not on one sample", async () => {
    // It is derived from every sample of the question at once. Rendered in the
    // per-sample row it sat beside "Searched" and read as a contradiction.
    const text =
      (render(await buildReport({ searched: false })), host.textContent) ?? "";
    const questionLine = text.slice(0, text.indexOf("Sample 1"));

    expect(questionLine).toContain("Never searched");
  });

  it("opens with four numbers, and counts never-searched over probes alone", async () => {
    // The fixture: one retrieval probe of three samples where the middle one
    // never searched, plus a one-shot natural-demand question. A run-level
    // "never searched" would be tempted to count the natural-demand answer,
    // which was never expected to search — reporting a working instrument as a
    // broken one. It is counted over probes and says so.
    render(await buildReport());
    const text = host.textContent ?? "";

    expect(text).toContain("Current ChatGPT snapshot");
    expect(text).toContain("Attempted");
    expect(text).toContain("Observed");
    expect(text).toContain("Never searched");
    expect(text).toContain("Retrieval probes only");
    // The number, not only the label. This fixture has three probe samples
    // that all searched and one natural-demand answer that did not, so the
    // honest count is zero — and a run-level subtraction would print one.
    expect(numberUnder("Never searched")).toBe("0");
    expect(numberUnder("Attempted")).toBe("4");
    expect(numberUnder("Observed")).toBe("4");
    // The four boundaries are beside the numbers, not only at the foot of the
    // page where a caveat is read after the number it qualifies.
    expect(text).toContain("Unavailable is not zero");
    expect(text).toContain("Citation is not recommendation");
    expect(text).toContain("No overall number");
    // The per-mode tables are still on the page, one disclosure down: the two
    // denominators are the reason this report exists.
    expect(text).toContain("See the per-mode detail");
    expect(text).toContain("Citations · retrieval probes");
    expect(text).toContain("Citations · natural demand");
  });

  it("counts a probe that never searched, and still ignores the one-shot question", async () => {
    // The mirror fixture: now the three probe samples are the ones that did not
    // search. Three, not four — the natural-demand answer never searched either
    // and was never expected to.
    render(await buildReport({ searched: false }));

    expect(numberUnder("Never searched")).toBe("3");
    expect(numberUnder("Attempted")).toBe("4");
  });

  it("keeps retrieval and natural-demand denominators apart", async () => {
    render(await buildReport());
    const text = host.textContent ?? "";

    expect(text).toContain("Search execution · retrieval probes");
    expect(text).toContain("Search execution · natural demand");
    expect(text).toContain("Citations · retrieval probes");
    expect(text).toContain("Citations · natural demand");
    expect(text).toContain("Mentions · unprompted questions");
    expect(text).toContain("Mentions · prompted questions");
  });

  it("states only mode-agnostic facts about the run as a whole", async () => {
    // A run-level "named in 4 of 18" would blend three prompted repetitions
    // with one unprompted discovery. The totals block carries no numerator at
    // all — only how many calls were planned, answered and lost.
    render(await buildReport());
    const totals = host.textContent?.slice(
      host.textContent.indexOf("Every planned call"),
      host.textContent.indexOf("Search execution · retrieval probes"),
    );

    expect(totals).toContain("Scheduled");
    expect(totals).toContain("Answered");
    expect(totals).toContain("No usable answer");
    expect(totals).not.toContain("Cited your site");
    expect(totals).not.toContain("Named your site");
    expect(totals).not.toContain("Searched");
  });

  it("says recommendation was not evaluated on every sample", async () => {
    render(await buildReport());

    expect(host.textContent).toContain("Recommendation not evaluated");
    // Never rendered as a negative finding.
    expect(host.textContent).not.toContain("not recommended");
  });

  it("labels the mention excerpt as generated text rather than a citation", async () => {
    render(await buildReport());

    expect(host.textContent).toContain("Generated-answer excerpt");
    expect(host.textContent).toContain(
      "It is not a citation and not an excerpt of any source page",
    );
  });

  it("renders the degraded banner when a probe never searched", async () => {
    render(await buildReport({ searched: false }));

    expect(host.textContent).toContain("Degraded run");
    expect(host.textContent).toContain("instrumentation failure");
    expect(host.textContent).toContain("Never searched");
    // The state is on the overview too, where it is read before any number
    // below it. The banner is the reason; this is the one word for it.
    expect(host.textContent).toContain("Partially available");
    expect(host.textContent).not.toContain("Fully available");
  });

  it("calls a clean run fully available", async () => {
    render(await buildReport());

    expect(host.textContent).toContain("Fully available");
    expect(host.textContent).not.toContain("Partially available");
    expect(host.textContent).not.toContain("Degraded run");
  });

  it("keeps a trigger-failed probe out of the citation denominator", async () => {
    const report = await buildReport({ searched: false });
    render(report);

    const probe = report.questions[0]!;
    expect(probe.counts.citationEvaluableSamples).toBe(0);
    // Named, because this line sits directly above everyone else's citations.
    expect(host.textContent).toContain(
      "acme.test cited in 0 of 0 citation-evaluable samples",
    );
  });

  it("states the persistence boundary exactly", async () => {
    render(await buildReport());

    expect(host.textContent).toContain(
      "Report contents, provider answers and evidence are not stored server-side",
    );
    expect(host.textContent).toContain("existing credits system");
  });

  it("avoids the words the contract cannot support", async () => {
    render(await buildReport());
    const text = host.textContent ?? "";

    for (const forbidden of [
      "never cited",
      "not present",
      "visibility score",
      "geo score",
      "not recommended",
      "source says",
      "verified context",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
    // "Ranking" appears exactly once, and only inside the sentence that denies
    // it. Asserted rather than banned so the denial cannot quietly disappear.
    expect(text).toContain(
      "not a recommendation, a ranking or a traffic estimate",
    );
    expect(text.toLowerCase().split("ranking").length - 1).toBe(1);
  });
});
