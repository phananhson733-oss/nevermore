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

  it("labels a non-target citation as ownership unknown", async () => {
    render(await buildReport());

    expect(host.textContent).toContain("Ownership unknown");
    expect(host.textContent).toContain("Your site");
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
  });

  it("keeps a trigger-failed probe out of the citation denominator", async () => {
    const report = await buildReport({ searched: false });
    render(report);

    const probe = report.questions[0]!;
    expect(probe.counts.citationEvaluableSamples).toBe(0);
    expect(host.textContent).toContain(
      "Cited in 0 of 0 citation-evaluable samples",
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
