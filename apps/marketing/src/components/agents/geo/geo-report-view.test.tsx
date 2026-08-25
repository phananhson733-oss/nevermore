// @vitest-environment jsdom
// @input  -- complete and deliberately degraded v3 reports
// @output -- proof every number is rendered beside its own denominator
// @pos    -- component test for the only rendering of GEO evidence

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json";
import zh from "../../../i18n/messages/zh.json";
import { deriveGeoSourceLandscape } from "../../../lib/agents/geo-source-landscape";
import type {
  GeoConfirmedAliasV1,
  GeoContextSnapshotV1,
} from "../../../lib/agents/geo-context";
import type { GeoProviderObservation } from "../../../lib/agents/geo-provider";
import type {
  GeoQuerySetV1,
  GeoQueryUnitV1,
} from "../../../lib/agents/geo-query-contract";
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
import { confirmGeoContext } from "../../../lib/agents/geo-context";
import { buildGeoCoreQuerySet } from "../../../lib/agents/geo-questions";
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
    const table = host.querySelector(
      '[data-testid="geo-sources-retrieval_probe"]',
    );
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

    for (const invented of [
      "Community",
      "Marketplace",
      "Editorial",
      "Vendor",
    ]) {
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

  /**
   * The confirmed context and query set the solutions panel needs.
   *
   * Without a capture that panel does not render at all, so any assertion about
   * where the solutions sit would be about two other sections entirely.
   */
  async function capture(): Promise<{
    readonly context: GeoContextSnapshotV1;
    readonly querySet: GeoQuerySetV1;
  }> {
    const confirmed = await confirmGeoContext(
      {
        targetUrl: "https://acme.test/",
        productName: "Acme Analytics",
        brandAliases: [
          {
            alias: "Acme Analytics",
            source: "profile_product_name",
            confirmed: true,
          },
        ],
        category: "seo",
        categoryConfirmed: true,
        buyer: "ceo",
        user: "",
        jtbd: "",
        useCases: [],
        outcomes: [],
        barriers: [],
        directCompetitors: [],
        indirectAlternatives: [],
        marketCode: "US",
        targetQueryLanguage: "en",
        sourceProfileVersion: "geo-context.local.v1",
        sourceSummary: [
          { field: "category", source: "user_edit", limitationCode: null },
        ],
      },
      () => new Date("2026-08-19T09:00:00.000Z"),
    );
    if (!confirmed.ok) throw new Error("fixture context");
    const built = await buildGeoCoreQuerySet(
      confirmed.snapshot,
      () => new Date("2026-08-19T09:00:00.000Z"),
    );
    if (!built.ok) throw new Error("fixture query set");
    return { context: confirmed.snapshot, querySet: built.querySet };
  }

  it("renders the sections in the order the report was approved in", async () => {
    // Eight questions at three samples each filled several screens before a
    // reader reached the part that says what to do. The evidence is the proof,
    // not the point.
    const report = await buildReport();
    const captured = await capture();
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{ agents: en.agents }}
        >
          <GeoReportView
            report={report}
            capture={captured}
            locale="en"
            onRestart={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = host.textContent ?? "";

    expect(text).toContain("What to do about it");
    /*
     * The whole approved order, not the two adjacent pairs.
     *
     * The earlier version pinned overview < problems and solutions < per-
     * question, which left the source table and the copy block free to move
     * anywhere — including past the per-question detail — with this test still
     * green. The order is: overview, sources, problems, solutions, copy,
     * per-question, limitations.
     */
    const order = [
      "What this run reached",
      "Who these answers actually cited",
      "What this run found",
      "What to do about it",
      "Copy report for AI",
      "Question by question",
      "What this cannot tell you",
    ];

    /*
     * Matched against heading elements, not the page's whole text.
     *
     * Two of these strings appear twice on the page: "Copy report for AI" is
     * the section heading and the button inside it, and "Question by question"
     * is the eyebrow above its own title. A first-substring search over
     * `textContent` would then keep passing after the real heading moved or
     * was deleted, because the other copy still sits in roughly the right
     * place.
     */
    const headings = [...host.querySelectorAll("h2, h3, h4")];
    const nodes = order.map((title) => {
      const node = headings.find(
        (candidate) => candidate.textContent?.trim() === title,
      );
      expect(node, `no heading element reads "${title}"`).toBeDefined();
      return node!;
    });
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1]!;
      const current = nodes[index]!;
      const relation = previous.compareDocumentPosition(current);
      expect(
        relation & Node.DOCUMENT_POSITION_FOLLOWING,
        `"${order[index]}" must come after "${order[index - 1]}"`,
      ).toBeTruthy();
    }
  });

  it("lists the URLs observed on a cited host, one click down", async () => {
    const report = await buildReport();
    render(report);

    // The table aggregates to the host, so "acme.test cited in 3 of 3" cannot
    // say whether that was one page three times or three pages once. The
    // disclosure that answers it had a contract field, a derivation and both
    // translations for weeks, and no renderer.
    const sources = deriveGeoSourceLandscape(report);
    const withUrls = Object.values(sources.byMode)
      .flatMap((mode) => mode.sources)
      .filter((source) => source.urls.length > 0);
    expect(withUrls.length).toBeGreaterThan(0);

    const summaries = [...host.querySelectorAll("summary")].map((node) =>
      node.textContent?.trim(),
    );
    expect(summaries).toContain("Show the one URL on this host");

    for (const url of withUrls[0]!.urls) {
      expect(host.textContent).toContain(url);
    }
  });

  /*
   * The same report in the other locale.
   *
   * Every other test here renders `en`, and next-intl renders a missing key as
   * its own path rather than throwing — so a zh key deleted or renamed would
   * ship a report with `agents.geo.results.overviewTitle` printed in it and
   * this file would stay green.
   */
  it("renders the same report in Chinese without leaking a key path", async () => {
    const report = await buildReport();
    const captured = await capture();
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="zh"
          timeZone="UTC"
          messages={{ agents: zh.agents }}
        >
          <GeoReportView
            report={report}
            capture={captured}
            locale="zh"
            onRestart={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = host.textContent ?? "";

    expect(text).toContain("这些回答实际在引谁");
    expect(text).toContain("检测到的 GEO 问题");
    expect(text).toContain("逐题结果");
    // A rendered key path is what a missing translation looks like on screen.
    expect(text).not.toMatch(/agents\.geo\./);
  });

  it("shows one line per sample and keeps the exact evidence one click down", async () => {
    render(await buildReport());

    // The compact row: which try, what came of it, which hosts.
    const rows = host.querySelectorAll('[data-testid="geo-sample-row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(host.textContent).toContain("Sample 1");
    // Nothing was dropped to get there — the exact URL is still rendered,
    // inside the disclosure.
    expect(host.textContent).toContain("Open this question's full evidence");
    expect(
      [...host.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toContain("https://acme.test/pricing?utm_source=openai");
  });

  it("names why a sample could not be counted rather than six labels", async () => {
    // A probe that never searched is out of the denominator, and that is the
    // fact that decides how to read the ratio above it.
    render(await buildReport({ searched: false }));
    const compact = [...host.querySelectorAll('[data-testid="geo-sample-row"]')]
      .map((row) => row.textContent ?? "")
      .join("\n");

    expect(compact).toContain("No web search");
    // The full six are still available, just not the default.
    expect(compact).not.toContain("Recommendation not evaluated");
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

    expect(host.textContent).toContain("never triggered a web search");
    // The causal claim is earned here: this probe's wording was calibrated to
    // reach the live web and did not, on any sample.
    expect(host.textContent).toContain("instrument problem");
    expect(host.textContent).toContain("Never searched");
    // And the other case did not happen, so its sentence is absent.
    expect(host.textContent).not.toContain("on some samples and not others");
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

  it("does not call a mixed trigger an instrument failure", async () => {
    // A run where nothing failed outright and four probes searched on some
    // tries printed "0 probes never searched ... this is an instrumentation
    // failure": a zero-valued clause and a claim about cause that nothing
    // established. Only `trigger_failed` is defined as an instrument failure;
    // searching on two tries out of three is the surface being
    // non-deterministic, which is why three samples are taken.
    const report = await buildReport();
    const mixed: GeoReportDataV3 = {
      ...report,
      coverage: {
        ...report.coverage,
        triggerFailedProbes: 0,
        degradedProbes: 4,
      },
    };
    render(mixed);
    const text = host.textContent ?? "";

    expect(text).toContain("on some samples and not others");
    expect(text).toContain("the question was still measured");
    // Neither the cause nor the empty clause.
    expect(text).not.toContain("instrument problem");
    expect(text).not.toContain("never triggered a web search");
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
    // Where the retained metadata actually lives. The credits system was named
    // here for a year and never touched a GEO run: no CreditToolSlug, no ledger
    // row, no import. Naming a system that is not involved is the same defect
    // as naming a persistence that does not happen.
    expect(host.textContent).toContain("retained server-side");
    expect(host.textContent).not.toContain("credits system");
    // What the restore feature actually offers: eligibility to be restored in
    // this tab, for up to fifteen minutes, where the browser permits storage.
    // Not a retention promise — nothing deletes the report at fifteen minutes,
    // and nothing guarantees the write succeeded.
    expect(host.textContent).toContain("where the browser allows it");
    expect(host.textContent).toContain("up to fifteen minutes");
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
