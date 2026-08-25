// @vitest-environment jsdom
// @input  -- deterministic Daily Briefing results, quota facts, and tab-scoped handoff writes
// @output -- honest KPI, evidence, action, limitation, and manual-check rendering
// @pos    -- result-artifact contract for the GSC Daily Briefing client surface

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDailyBriefing,
  type DailyBriefingAction,
  type DailyBriefingChange,
  type DailyBriefingEnvelope,
  type DailyBriefingLaneCapability,
  type DailyBriefingLimitationCode,
  type DailyBriefingPropertyTrend,
  type DailyBriefingProvisionalMove,
  type DailyBriefingQueryObservation,
  type DailyBriefingProvisionalMoves,
  type DailyBriefingQueryWatchlist,
  type DailyBriefingRowAccounting,
  type DailyBriefingSignalFunnel,
} from "@sf/public-tools";
import en from "../../i18n/messages/en.json";

const { writeToolHandoffMock } = vi.hoisted(() => ({
  writeToolHandoffMock: vi.fn(),
}));

vi.mock("../../lib/tools/tool-handoff", () => ({
  writeToolHandoff: writeToolHandoffMock,
}));

const { DailyBriefingResults } = await import("./daily-briefing-results.tsx");

const PROPERTY = "sc-domain:example.com";
let root: Root | null = null;

const PREVIOUS_DATES = [
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
] as const;
const CURRENT_DATES = [
  "2026-08-15",
  "2026-08-16",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
] as const;

function completeDateRows() {
  return [
    ...PREVIOUS_DATES.map((date) => ({
      date,
      clicks: 8,
      impressions: 100,
      position: 9,
    })),
    ...CURRENT_DATES.map((date, index) => ({
      date,
      clicks: index === 6 ? 20 : 10,
      impressions: index === 6 ? 300 : 200,
      position: index === 6 ? 7 : 8,
    })),
  ];
}

const BASE_ENVELOPE: DailyBriefingEnvelope = buildDailyBriefing({
  now: new Date("2026-08-24T20:00:00.000Z"),
  dateRows: completeDateRows(),
  currentQueryEvidence: null,
  previousQueryEvidence: null,
  brandTerms: [],
  brandTermsConfirmed: false,
});

function change(
  kind: DailyBriefingChange["kind"],
  index: number,
  overrides: Partial<DailyBriefingChange> = {},
): DailyBriefingChange {
  const query = `evidence query ${index}`;
  const page = `https://example.com/page-${index}`;
  return {
    kind,
    evidence: kind === "first_observed" ? "not_observed" : "observed",
    query,
    page,
    pageEvidence: "observed",
    current: { query, clicks: 12, impressions: 240, position: 8.2 },
    previous:
      kind === "first_observed"
        ? null
        : { query, clicks: 20, impressions: 250, position: 8 },
    clickChange: kind === "first_observed" ? null : -8,
    clickChangeRatio: kind === "first_observed" ? null : -0.4,
    positionDelta: kind === "first_observed" ? null : 0.2,
    baselineCtr: kind === "click_opportunity" ? 0.1 : null,
    clickGap: kind === "click_opportunity" ? 12 : null,
    ...overrides,
  };
}

function action(
  source: DailyBriefingChange,
  destination: DailyBriefingAction["destination"],
): DailyBriefingAction {
  return {
    kind: source.kind,
    destination,
    query: source.query,
    page: source.page ?? "",
  };
}

function envelope(
  overrides: Partial<DailyBriefingEnvelope["result"]> = {},
): DailyBriefingEnvelope {
  return {
    ...BASE_ENVELOPE,
    result: {
      ...BASE_ENVELOPE.result,
      propertyTrend: { change: null, action: null, noiseFloor: null },
      ...overrides,
    },
  };
}

function signalFunnel(
  overrides: Partial<DailyBriefingSignalFunnel> = {},
): DailyBriefingSignalFunnel {
  return {
    evidence: "observed",
    observedQueryRows: 540,
    observationCandidates: 18,
    actionEligibleQueries: 2,
    ctrBaselineRows: 0,
    clickOpportunityCandidates: 0,
    stableDeclineCandidates: 0,
    pageOneBandCandidates: 0,
    positionDeclineCandidates: 0,
    firstObservedCandidates: 0,
    provisionalMoveCandidates: 0,
    pageAttributionWithheld: 0,
    selectedQueryChanges: 0,
    propertyTrendShown: false,
    ...overrides,
  };
}

function laneCapability(
  overrides: Partial<DailyBriefingLaneCapability> = {},
): DailyBriefingLaneCapability {
  return {
    evidence: "observed",
    clickDeclineCapableQueries: 0,
    ctrOpportunityCapableQueries: 0,
    strictPairedPositionQueries: 0,
    provisionalPairedPositionQueries: 0,
    currentFloorOnlyQueries: 0,
    ctrLane: {
      state: "not_applicable",
      blockers: ["brand_terms_not_confirmed"],
      usableBaselineBands: 0,
    },
    lanes: {
      click_opportunity: "not_applicable",
      stable_position_click_decline: "not_applicable",
      average_position_crossed_page_one_band: "not_applicable",
      actionable_position_decline: "not_applicable",
      first_observed: "not_applicable",
    },
    ...overrides,
  };
}

function laneRows(
  notEvaluated: number,
  evaluatedNoSignal = 0,
  candidates = 0,
) {
  return { notEvaluated, evaluatedNoSignal, candidates };
}

function rowAccounting(
  overrides: Partial<DailyBriefingRowAccounting> = {},
): DailyBriefingRowAccounting {
  return {
    evidence: "observed",
    observedRows: 540,
    notSelectedVisibleRows: 0,
    byLane: {
      click_opportunity: laneRows(540),
      stable_position_click_decline: laneRows(540),
      average_position_crossed_page_one_band: laneRows(540),
      actionable_position_decline: laneRows(540),
      first_observed: laneRows(540),
    },
    ...overrides,
  };
}

function provisionalMove(
  kind: DailyBriefingProvisionalMove["kind"],
  index: number,
  overrides: Partial<DailyBriefingProvisionalMove> = {},
): DailyBriefingProvisionalMove {
  const query = `provisional query ${index}`;
  return {
    kind,
    evidence: "observed",
    query,
    page: `https://example.com/provisional-${index}`,
    pageEvidence: "observed",
    current: { query, clicks: 0, impressions: 180, position: 9.7 },
    previous: { query, clicks: 0, impressions: 70, position: 11.8 },
    positionDelta: -2.1,
    ...overrides,
  };
}

function provisionalMoves(
  items: readonly DailyBriefingProvisionalMove[] = [],
  overrides: Partial<DailyBriefingProvisionalMoves> = {},
): DailyBriefingProvisionalMoves {
  return {
    evidence: "observed",
    items,
    candidates: items.length,
    priorWindowImpressionRange: [50, 99],
    ...overrides,
  };
}

function watchlist(
  evidence: DailyBriefingQueryWatchlist["evidence"],
  items: readonly DailyBriefingQueryObservation[] = [],
  overrides: Partial<DailyBriefingQueryWatchlist> = {},
): DailyBriefingQueryWatchlist {
  return {
    evidence,
    items,
    // Counts stay null when nothing was read: a withheld count of zero would
    // claim we looked and found nothing to withhold.
    candidates: evidence === "observed" ? items.length : null,
    withheldByBand:
      evidence === "observed"
        ? { page_one: 0, near_page_one: 0, mid: 0, far: 0 }
        : null,
    withheldByKind:
      evidence === "observed"
        ? { sample_floor_reached: 0, sample_building: 0 }
        : null,
    ...overrides,
  };
}

function propertyTrend(
  overrides: Partial<DailyBriefingPropertyTrend> = {},
): DailyBriefingPropertyTrend {
  return {
    change: {
      kind: "sitewide_click_decline",
      evidence: "observed",
      query: null,
      page: null,
      current: {
        clicks: 35,
        impressions: 4_109,
        ctr: 35 / 4_109,
        position: 15.1,
      },
      previous: {
        clicks: 49,
        impressions: 5_285,
        ctr: 49 / 5_285,
        position: 13.2,
      },
      clickChange: -14,
      clickChangeRatio: -14 / 49,
      impressionChange: -1_176,
      impressionChangeRatio: -1_176 / 5_285,
      positionDelta: 1.9,
    },
    action: {
      kind: "sitewide_click_decline",
      destination: "traffic-drop-diagnosis",
    },
    noiseFloor: {
      basis: "clicks",
      observedChange: -14,
      minimumForAction: 2 * Math.sqrt(49),
      cleared: true,
    },
    ...overrides,
  };
}

function observation(
  kind: DailyBriefingQueryObservation["kind"],
  index: number,
  overrides: Partial<DailyBriefingQueryObservation> = {},
): DailyBriefingQueryObservation {
  const query = `watch query ${index}`;
  return {
    kind,
    band: "page_one",
    query,
    page: `https://example.com/watch-${index}`,
    pageEvidence: "observed",
    current: { query, clicks: 12, impressions: 120, position: 9.2 },
    previousBelowFloor: null,
    previous: { query, clicks: 8, impressions: 110, position: 9.5 },
    positionDelta: -0.3,
    ...overrides,
  };
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  writeToolHandoffMock.mockReset();
  writeToolHandoffMock.mockReturnValue(true);
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function renderResults(
  report: DailyBriefingEnvelope = envelope(),
  rateLimit: { readonly remaining: number | null; readonly limit: number } | null = {
    remaining: 7,
    limit: 10,
  },
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={{ tools: { dailyBriefing: en.tools.dailyBriefing } }}
      >
        <DailyBriefingResults
          locale="en"
          property={PROPERTY}
          envelope={report}
          rateLimit={rateLimit}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const candidate = [...host.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!candidate) throw new Error(`no button containing ${text}`);
  return candidate as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

describe("DailyBriefingResults KPI and evidence facts", () => {
  it("leads with what to look at and folds the method statement to the end", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          observedQueryRows: 17,
          actionEligibleQueries: 2,
        }),
        laneCapability: laneCapability({ currentFloorOnlyQueries: 2 }),
        rowAccounting: rowAccounting({ observedRows: 17 }),
      }),
    );
    const order = [...host.querySelectorAll("[data-result-section]")].map(
      (node) => node.getAttribute("data-result-section"),
    );
    const noise = host.querySelector('[data-result-section="noise"]');

    // No site-wide trend cleared its gates in this fixture, so the reading
    // path runs KPIs -> what to look at -> actions, and the noise strip is
    // nested inside the collapsed explanation near the end.
    expect(order).toEqual([
      "facts",
      "kpis",
      "changes",
      "actions",
      "manual",
      "evidence",
      "noise",
      "limitations",
      "methodology",
    ]);
    // The strip that used to open the results now lives inside the collapsed
    // explanation, so the page no longer answers for itself before it reports.
    expect(
      host.querySelector('[data-result-section="evidence"] [data-result-section="noise"]'),
    ).not.toBeNull();
    expect(host.querySelector("[data-evidence-details]")).not.toBeNull();
    expect(noise?.textContent).toContain("Noise filter on");
    // The sample floor and the comparison conditions are separate facts. The
    // strip used to report the first and label it the second.
    expect(noise?.textContent).toContain("17 query rows in the current window");
    expect(noise?.textContent).toContain("2 of them at 100 impressions");
    expect(noise?.textContent).toContain(
      "0 support a strict two-window position comparison",
    );
    expect(noise?.textContent).toContain(
      "2 have no comparable prior window at all",
    );
    expect(noise?.textContent).not.toContain("evaluation sample floor");
  });

  it("reports the number of changes actually shown after the three-row cap", async () => {
    const host = await renderResults(
      envelope({
        changes: [
          change("click_opportunity", 1),
          change("stable_position_click_decline", 2),
          change("first_observed", 3),
          change("first_observed", 4),
        ],
        signalFunnel: signalFunnel({ selectedQueryChanges: 3 }),
        queryWatchlist: watchlist("observed"),
      }),
    );
    const summary = host.querySelector("[data-evidence-fold-summary]");

    expect(host.querySelectorAll("[data-change]")).toHaveLength(3);
    expect(summary?.textContent).toContain("3 query changes");
    expect(summary?.textContent).not.toContain("4 query changes");
  });

  it("counts the site trend in the fold summary instead of calling it nothing", async () => {
    const host = await renderResults(
      envelope({
        propertyTrend: propertyTrend(),
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
        queryWatchlist: watchlist("observed", [], { candidates: 8 }),
      }),
    );
    const summary = host.querySelector("[data-evidence-fold-summary]");

    // "0 changes" over a page that also says the site declined was the copy
    // this line replaces.
    expect(summary?.textContent).toContain("0 query changes");
    expect(summary?.textContent).toContain("1 site trend observation");
    expect(summary?.textContent).toContain("0/8 observation candidates shown");
    expect(summary?.textContent).not.toContain("below the threshold");
  });

  it("renders four metric cards with latest-day and seven-day values", async () => {
    // Day-level values are shown only on a daily briefing, which requires a
    // click lane that could actually be evaluated.
    const host = await renderResults(
      envelope({ mode: "change_detection", cadence: "daily" }),
    );
    const cards = [...host.querySelectorAll("[data-kpi]")];

    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.textContent).toContain("Latest complete day");
      expect(card.textContent).toContain("Current complete 7 days");
      expect(card.textContent).toContain("Change");
    }
    expect(cards[0]?.textContent).toContain("20");
    expect(cards[0]?.textContent).toContain("80");
    expect(host.textContent).toContain("exposure-weighted");
  });

  it("suppresses day-level interpretation for weekly cadence", async () => {
    const host = await renderResults(
      envelope({ cadence: "weekly" }),
    );
    const cards = [...host.querySelectorAll("[data-kpi]")];

    expect(host.textContent).toContain(
      "Day-level interpretation is unavailable for this cadence.",
    );
    expect(host.querySelectorAll('[data-kpi-period="day"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-kpi-period="week"]')).toHaveLength(4);
    for (const card of cards) {
      expect(card.textContent).not.toContain("Latest complete day");
      expect(card.textContent).toContain("Current complete 7 days");
    }
  });

  it("renders null KPI and quota facts as unavailable rather than zero", async () => {
    const unavailable = {
      evidence: "unavailable" as const,
      current: null,
      previous: null,
      delta: {
        clicks: null,
        clicksRatio: null,
        impressions: null,
        impressionsRatio: null,
        ctr: null,
        position: null,
      },
    };
    const host = await renderResults(
      envelope({ day: unavailable, weekly: unavailable, cadence: "weekly" }),
      { remaining: null, limit: 10 },
    );

    expect(host.textContent).toContain("Unavailable");
    expect(host.textContent).toContain(
      "Remaining shared runs are unavailable; this is not zero.",
    );
    expect(host.textContent).not.toContain("0/10");
  });

  it("labels a filtered count as prefix-only and keeps missing coverage honest", async () => {
    const currentCoverage = {
      ...BASE_ENVELOPE.result.coverage.current,
      evidence: "unavailable" as const,
      eligibleQueries: 0,
      coveredQueries: 0,
    };
    const currentAnonymization = {
      ...BASE_ENVELOPE.result.anonymization.current,
      evidence: "unavailable" as const,
      missingImpressionShare: null,
      missingClickShare: null,
    };
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          evidence: "partial",
          observedQueryRows: 17,
          observationCandidates: null,
          actionEligibleQueries: null,
          ctrBaselineRows: null,
          clickOpportunityCandidates: null,
          stableDeclineCandidates: null,
          pageOneBandCandidates: null,
          positionDeclineCandidates: null,
          firstObservedCandidates: null,
          pageAttributionWithheld: null,
        }),
        coverage: {
          ...BASE_ENVELOPE.result.coverage,
          current: currentCoverage,
        },
        anonymization: {
          ...BASE_ENVELOPE.result.anonymization,
          current: currentAnonymization,
        },
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');

    expect(noise).not.toBeNull();
    expect(noise?.textContent).toContain("17 visible rows in the observed prefix");
    expect(noise?.textContent).toContain("observed prefix");
    expect(noise?.textContent).toContain("not property-wide");
    expect(noise?.textContent).toContain(
      "downstream candidate counts are unavailable",
    );
    expect(noise?.textContent).not.toContain("0 query/page signals");
    expect(host.textContent).toContain(
      "Comparable query-to-page coverage is unavailable",
    );
    expect(host.textContent).toContain("withheld share is unavailable");
  });

  it("renders the observed signal funnel and labels 50–99 impressions observation-only", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          observedQueryRows: 540,
          observationCandidates: 18,
          actionEligibleQueries: 2,
          ctrBaselineRows: null,
          selectedQueryChanges: 0,
          propertyTrendShown: true,
        }),
        laneCapability: laneCapability(),
        rowAccounting: rowAccounting(),
        propertyTrend: propertyTrend(),
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');
    const paths = host.querySelector("[data-signal-paths]");

    expect(noise?.textContent).toContain(
      "540 query rows in the current window, 2 of them at 100 impressions",
    );
    expect(noise?.textContent).toContain("18 queries had 50–99 impressions");
    expect(noise?.textContent).toContain("observation-only");
    expect(paths?.textContent).toContain("Signal evaluation and suppression");
    expect(paths?.textContent).toContain("cannot be added together");
    // Every path carries its own requirement, so a reader can check why it
    // did or did not run instead of reading a badge that says "observed".
    expect(paths?.textContent).toContain("Requires:");
    expect(paths?.querySelectorAll("[data-signal-path]")).toHaveLength(7);
  });

  it("tells a path that could not run from a path that found nothing", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          observedQueryRows: 540,
          pageAttributionWithheld: 0,
        }),
        laneCapability: laneCapability({
          strictPairedPositionQueries: 2,
          lanes: {
            click_opportunity: "not_applicable",
            stable_position_click_decline: "not_applicable",
            average_position_crossed_page_one_band: "evaluated",
            actionable_position_decline: "not_applicable",
            first_observed: "unavailable",
          },
        }),
        rowAccounting: rowAccounting({
          byLane: {
            click_opportunity: laneRows(540),
            stable_position_click_decline: laneRows(540),
            average_position_crossed_page_one_band: laneRows(538, 2, 0),
            actionable_position_decline: laneRows(540),
            first_observed: laneRows(540),
          },
        }),
      }),
    );
    const paths = host.querySelector("[data-signal-paths]");
    const crossing = paths?.querySelector('[data-signal-path="page-one-band"]');
    const firstObserved = paths?.querySelector(
      '[data-signal-path="first-observed"]',
    );

    expect(crossing?.getAttribute("data-path-state")).toBe("evaluated");
    expect(crossing?.textContent).toContain(
      "538 not evaluated · 2 evaluated with no signal · 0 produced a candidate",
    );
    // The lane that stands on the page attachment says it could not look,
    // rather than reporting a comparison it never made.
    expect(firstObserved?.getAttribute("data-path-state")).toBe("unavailable");
    expect(firstObserved?.textContent).toContain("could not be read this run");
    expect(firstObserved?.textContent).not.toMatch(/\b540\b/);
  });

  it("keeps unavailable funnel counts unavailable rather than rendering null as zero", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          evidence: "unavailable",
          observedQueryRows: null,
          observationCandidates: null,
          actionEligibleQueries: null,
          ctrBaselineRows: null,
          clickOpportunityCandidates: null,
          stableDeclineCandidates: null,
          pageOneBandCandidates: null,
          positionDeclineCandidates: null,
          firstObservedCandidates: null,
          pageAttributionWithheld: null,
        }),
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');
    const paths = host.querySelector("[data-signal-paths]");

    expect(noise?.textContent).toContain("Visible-query signal funnel unavailable");
    expect(noise?.textContent).toContain("no zeroes were inferred");
    expect(noise?.textContent).not.toContain("null");
    expect(noise?.textContent).not.toMatch(/\b0\b/);
    expect(paths?.textContent).not.toContain("null");
    // Scoped to the outcome lines: those are the rendered counts. The static
    // requirement and hit-condition copy legitimately names thresholds such
    // as 0.5, which is a constant, not a measurement.
    for (const outcome of paths?.querySelectorAll("[data-path-outcome]") ?? []) {
      expect(outcome.textContent).not.toContain("null");
      expect(outcome.textContent).not.toMatch(/\b0\b/);
    }
    expect(paths?.querySelectorAll("[data-signal-path]")).toHaveLength(7);
  });

  it("accounts for every observed row inside each evaluation path", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          observedQueryRows: 12,
          pageAttributionWithheld: 5,
        }),
        laneCapability: laneCapability({
          ctrLane: {
            state: "evaluated",
            blockers: [],
            usableBaselineBands: 3,
          },
          lanes: {
            click_opportunity: "evaluated",
            stable_position_click_decline: "evaluated",
            average_position_crossed_page_one_band: "not_applicable",
            actionable_position_decline: "not_applicable",
            first_observed: "evaluated",
          },
        }),
        rowAccounting: rowAccounting({
          observedRows: 12,
          byLane: {
            click_opportunity: laneRows(9, 1, 2),
            stable_position_click_decline: laneRows(6, 3, 3),
            average_position_crossed_page_one_band: laneRows(12),
            actionable_position_decline: laneRows(12),
            first_observed: laneRows(8, 0, 4),
          },
        }),
      }),
    );
    const paths = host.querySelector("[data-signal-paths]");
    const textOf = (id: string) =>
      paths?.querySelector(`[data-signal-path="${id}"]`)?.textContent ?? "";

    expect(paths?.textContent).toContain("12 query rows");
    expect(textOf("ctr-baseline")).toContain("3 usable position bands");
    expect(textOf("click-opportunity")).toContain(
      "9 not evaluated · 1 evaluated with no signal · 2 produced a candidate",
    );
    expect(textOf("stable-decline")).toContain(
      "6 not evaluated · 3 evaluated with no signal · 3 produced a candidate",
    );
    // A path with nothing to measure reports twelve untested rows, not twelve
    // rows it cleared.
    expect(textOf("position-decline")).toContain(
      "12 not evaluated · 0 evaluated with no signal · 0 produced a candidate",
    );
    expect(textOf("page-attribution")).toContain("5 records");
  });

});

describe("DailyBriefingResults changes, actions, and limitations", () => {
  const LIMITATIONS: readonly DailyBriefingLimitationCode[] = [
    "daily_data_incomplete",
    "daily_rows_omitted",
    "query_evidence_unavailable",
    "property_totals_unavailable",
    "query_evidence_partial",
    "query_page_coverage_below_floor",
    "aggregation_basis_mismatch",
    "anonymization_gap_uncomputable",
    "brand_terms_not_confirmed",
    "property_change_inside_noise_floor",
  ];

  it("shows a provisional move as an observation, never as an action", async () => {
    const move = provisionalMove("provisional_page_one_band_entry", 1);
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        changes: [],
        actions: [],
        provisionalMoves: provisionalMoves([move]),
      }),
    );
    const row = host.querySelector("[data-provisional-row]");

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain(move.query);
    expect(row?.textContent).toContain("Possible move into the 1-10 band");
    // The prior window is why this is not a change, so the row says so.
    expect(row?.textContent).toContain("prior window carries only 70");
    // No action row, no action rank, and the empty action panel still shows.
    expect(host.querySelectorAll("[data-action-row]")).toHaveLength(0);
    expect(host.querySelector("[data-action-empty]")).not.toBeNull();
    expect(host.querySelector("[data-provisional-note-intro]")?.textContent)
      .toContain("observations only");
  });

  it("keeps provisional wording clear of established-change language", async () => {
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        provisionalMoves: provisionalMoves([
          provisionalMove("provisional_actionable_position_decline", 2, {
            current: {
              query: "provisional query 2",
              clicks: 0,
              impressions: 180,
              position: 24,
            },
            previous: {
              query: "provisional query 2",
              clicks: 0,
              impressions: 60,
              position: 20,
            },
            positionDelta: 4,
          }),
        ]),
      }),
    );
    const row = host.querySelector("[data-provisional-row]");

    for (const banned of ["Material", "material", "opportunity is established"]) {
      expect(row?.textContent).not.toContain(banned);
    }
    expect(host.textContent).toContain(
      "No strict change path could be evaluated this run",
    );
    // Neither the cadence explanation nor the intro may promise that a
    // movement is listed: the mode proves only that a comparison was possible.
    expect(host.textContent).not.toContain("provisional position movement and a watchlist");
    // The mode proves only that a provisional comparison was possible, so the
    // intro must not promise that a movement is listed below it.
    expect(host.textContent).not.toContain("what follows is");
  });

  it("hands off a provisional page check without counting it as an action", async () => {
    writeToolHandoffMock.mockReturnValue(true);
    const move = provisionalMove("provisional_page_one_band_entry", 3);
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        provisionalMoves: provisionalMoves([move]),
      }),
    );
    const link = host.querySelector<HTMLAnchorElement>(
      "[data-provisional-check-link]",
    )!;

    await act(async () => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(writeToolHandoffMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({
        destination: "on-page-seo-check",
        page: move.page,
        query: move.query,
        evidenceId: "daily:provisional:provisional_page_one_band_entry",
      }),
    );
  });

  it("calls an under-floor prior window too small rather than unobserved", async () => {
    const host = await renderResults(
      envelope({
        queryWatchlist: watchlist("observed", [
          observation("sample_floor_reached", 7, {
            previous: null,
            previousBelowFloor: 49,
            positionDelta: null,
          }),
        ]),
      }),
    );
    const row = host.querySelector("[data-observation-row]");

    // Search Console did observe that week; it is the comparison that the
    // sample cannot carry, and the two are different facts.
    expect(row?.textContent).toContain("prior window too small");
    expect(row?.textContent).not.toContain("Not observed");
  });

  it("says which withheld observations cleared the threshold and lost the cut", async () => {
    const host = await renderResults(
      envelope({
        queryWatchlist: watchlist(
          "observed",
          [observation("sample_building", 1)],
          {
            candidates: 4,
            withheldByBand: { page_one: 0, near_page_one: 0, mid: 1, far: 2 },
            withheldByKind: { sample_floor_reached: 1, sample_building: 2 },
          },
        ),
      }),
    );
    const withheld = host.querySelector("[data-observations-withheld]");

    expect(withheld?.textContent).toContain("3 more observation candidates");
    expect(withheld?.textContent).toContain("1 mid-band");
    expect(withheld?.textContent).toContain("2 far");
    // "They cleared every threshold" is true of one sample tier and false of
    // the other, so the sentence names both instead of asserting either.
    expect(withheld?.textContent).toContain(
      "1 of them had reached the strict 100-impression sample floor",
    );
    expect(withheld?.textContent).toContain("2 sit at 50-99 impressions");
    expect(withheld?.textContent).not.toContain("not below a threshold");
  });

  it("names the lane, not the sample, when only position paths ran", async () => {
    const host = await renderResults(
      envelope({
        mode: "change_detection",
        cadence: "weekly",
        laneCapability: laneCapability({
          strictPairedPositionQueries: 2,
          lanes: {
            click_opportunity: "not_applicable",
            stable_position_click_decline: "not_applicable",
            average_position_crossed_page_one_band: "evaluated",
            actionable_position_decline: "not_applicable",
            first_observed: "not_applicable",
          },
        }),
      }),
    );

    // The weekly-because-small-sample sentence names a gate this run never
    // hit: the property can have plenty of impressions and still have no
    // click lane to evaluate.
    expect(host.textContent).toContain("Only position paths could be evaluated");
    expect(host.textContent).not.toContain("the sample or complete-day comparison");
  });

  it("does not claim there is nothing to hand off while offering a page check", async () => {
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        actions: [],
        provisionalMoves: provisionalMoves([
          provisionalMove("provisional_page_one_band_entry", 9),
        ]),
      }),
    );
    const empty = host.querySelector("[data-action-empty]");

    expect(host.querySelector("[data-provisional-check-link]")).not.toBeNull();
    expect(empty?.textContent).toContain("observational and is not counted");
  });

  it("does not point at a page check when no provisional row carries a page", async () => {
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        actions: [],
        provisionalMoves: provisionalMoves([
          provisionalMove("provisional_page_one_band_entry", 11, {
            page: null,
            pageEvidence: "unavailable",
          }),
        ]),
      }),
    );
    const empty = host.querySelector("[data-action-empty]");

    expect(host.querySelector("[data-provisional-check-link]")).toBeNull();
    expect(empty?.textContent).toContain("is an observation");
    expect(empty?.textContent).not.toContain("page check offered");
  });

  it("does not deny every handoff when the row budget hides a provisional move", async () => {
    const host = await renderResults(
      envelope({
        mode: "position_observation",
        actions: [],
        // The budget showed none of them, but a hidden candidate can still
        // carry a page, so "no handoff is justified" would be false.
        provisionalMoves: provisionalMoves([], { candidates: 2 }),
      }),
    );
    const empty = host.querySelector("[data-action-empty]");

    expect(empty?.textContent).toContain(
      "2 provisional position moves were left out by the row budget",
    );
    expect(empty?.textContent).not.toContain("No automated handoff");
  });

  it("counts one withheld sample-building row with singular grammar", async () => {
    const host = await renderResults(
      envelope({
        queryWatchlist: watchlist(
          "observed",
          [observation("sample_building", 21)],
          {
            candidates: 3,
            withheldByBand: { page_one: 0, near_page_one: 0, mid: 0, far: 2 },
            withheldByKind: { sample_floor_reached: 1, sample_building: 1 },
          },
        ),
      }),
    );
    const withheld = host.querySelector("[data-observations-withheld]");

    expect(withheld?.textContent).toContain("1 sits at 50-99 impressions");
    expect(withheld?.textContent).not.toContain("1 sit at 50-99");
  });

  it("never prints an unread observation count as a total of zero", async () => {
    const host = await renderResults(
      envelope({ queryWatchlist: watchlist("unavailable") }),
    );
    const summary = host.querySelector("[data-evidence-fold-summary]");

    // Not one query-derived zero may appear: the rows were never read.
    expect(summary?.textContent).toContain(
      "query evidence unavailable, so change and observation counts are unavailable",
    );
    expect(summary?.textContent).not.toContain("query changes");
    expect(summary?.textContent).not.toContain("0/0");
  });

  it("explains a current-window watchlist run in its own terms", async () => {
    const host = await renderResults(
      envelope({ mode: "current_position_watchlist" }),
    );
    // Both the cadence explanation and the review intro must name the real
    // reason: not "no click signal", which was the only reason v2 could give.
    expect(host.textContent).toContain(
      "No query on this property has a comparable prior window",
    );
    expect(host.textContent).toContain(
      "There is no comparable prior window this run",
    );
    expect(host.textContent).not.toContain("position-first");
  });

  it("humanizes every limitation and never renders a raw machine code", async () => {
    const host = await renderResults(envelope({ limitations: LIMITATIONS }));

    expect(host.textContent).toContain("required complete dates were missing");
    expect(host.textContent).toContain("brand list was not explicitly confirmed");
    for (const code of LIMITATIONS) {
      expect(host.textContent).not.toContain(code);
    }
  });

  it("renders the site-wide trend outside the query-page review table", async () => {
    const fallback = propertyTrend();
    const watch = observation("sample_floor_reached", 1);
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        propertyTrend: fallback,
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
        queryWatchlist: watchlist("observed", [watch]),
      }),
    );
    const table = host.querySelector('[role="table"]');
    const row = host.querySelector<HTMLElement>("[data-site-trend]");
    const cells = [
      ...(row?.querySelectorAll<HTMLElement>('[role="cell"]') ?? []),
    ];

    expect(table).not.toBeNull();
    expect(row).not.toBeNull();
    expect(table?.contains(row)).toBe(false);
    expect(host.querySelector("[data-property-change]")).toBeNull();
    expect(table?.textContent).toContain(watch.query);
    expect(row?.textContent).toContain("Site-wide trend");
    expect(row?.textContent).toContain("Property clicks declined materially");
    expect(row?.textContent).toContain("49 → 35");
    expect(row?.textContent).toContain("5,285 → 4,109");
    expect(row?.textContent).toContain("13.2 → 15.1");
    expect(row?.textContent).toContain(
      "Observed weekly deltas: clicks -14, impressions -1,176, average position +1.9",
    );
    expect(row?.textContent).toContain(
      "Query/page evidence did not support a specific attribution",
    );
    expect(
      row?.querySelector("[data-site-trend-action-link]")?.getAttribute("href"),
    ).toBe("#daily-briefing-actions");
    expect(row?.querySelector("[data-action-link]")).toBeNull();
    expect(cells).toHaveLength(0);
  });

  it("renders strict changes first and fills only the remaining review rows with observations", async () => {
    const strict = change("stable_position_click_decline", 1);
    const host = await renderResults(
      envelope({
        changes: [strict],
        actions: [action(strict, "traffic-drop-diagnosis")],
        queryWatchlist: {
          evidence: "observed",
          items: [
            observation("sample_floor_reached", 2),
            observation("sample_building", 3),
            observation("sample_building", 4),
          ],
          candidates: null,
          withheldByBand: null,
          withheldByKind: null,
        },
      }),
    );
    const rows = [
      ...host.querySelectorAll<HTMLElement>("[data-review-row]"),
    ];

    expect(rows).toHaveLength(3);
    expect(rows[0]?.hasAttribute("data-change")).toBe(true);
    expect(rows[0]?.textContent).toContain(strict.query);
    expect(rows[1]?.hasAttribute("data-observation-row")).toBe(true);
    expect(rows[1]?.textContent).toContain("watch query 2");
    expect(rows[1]?.textContent).toContain("Observation");
    expect(rows[1]?.textContent).toContain(
      "Already inside the 1-10 average position band",
    );
    expect(rows[2]?.textContent).toContain("watch query 3");
    expect(rows[2]?.textContent).toContain("Building sample");
    expect(host.textContent).not.toContain("watch query 4");
  });

  it("keeps observation rows non-actionable when page attribution is unavailable", async () => {
    const watch = observation("sample_building", 1, {
      page: null,
      pageEvidence: "unavailable",
      previous: null,
    });
    const host = await renderResults(
      envelope({
        queryWatchlist: watchlist("observed", [watch]),
      }),
    );
    const row = host.querySelector<HTMLElement>("[data-observation-row]");

    expect(row?.textContent).toContain("Primary page evidence unavailable");
    expect(row?.textContent).toContain("Not observed → 12");
    expect(row?.querySelector("[data-action-link]")).toBeNull();
    expect(writeToolHandoffMock).not.toHaveBeenCalled();
  });

  it("renders unavailable property positions without inventing a rank", async () => {
    const fallback = propertyTrend();
    const baseChange = fallback.change;
    if (baseChange === null) throw new Error("fixture must carry a change");
    const host = await renderResults(
      envelope({
        propertyTrend: {
          ...fallback,
          change: {
            ...baseChange,
            current: { ...baseChange.current, position: null },
            previous: { ...baseChange.previous, position: null },
            positionDelta: null,
          },
        },
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
      }),
    );
    const row = host.querySelector<HTMLElement>("[data-site-trend]");

    expect(row?.textContent).toContain("Unavailable → Unavailable");
    expect(row?.textContent).toContain("average position Unavailable");
    expect(row?.textContent).not.toContain("null");
    expect(row?.textContent).not.toContain("NaN");
  });

  it("renders one ranked property action and writes a private property-scope handoff", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        propertyTrend: propertyTrend(),
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
      }),
    );
    const row = host.querySelector<HTMLElement>(
      "[data-action-row][data-property-action]",
    );
    const links = [
      ...(row?.querySelectorAll<HTMLAnchorElement>("[data-action-link]") ?? []),
    ];

    expect(row?.getAttribute("data-action-rank")).toBe("1");
    expect(row?.querySelector("[data-action-rank-badge]")?.getAttribute("aria-label")).toBe(
      "Rank 1",
    );
    expect(row?.textContent).toContain("Diagnose the property-wide click decline");
    expect(row?.textContent).toContain(PROPERTY);
    expect(row?.textContent).toContain("49 → 35");
    expect(row?.textContent).toContain("5,285 → 4,109");
    expect(row?.textContent).toContain("13.2 → 15.1");
    expect(row?.textContent).not.toContain("Query:");
    expect(row?.textContent).not.toContain("Page:");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "/tools/traffic-drop-diagnosis",
    );
    expect(links[0]?.getAttribute("href")).not.toContain(PROPERTY);

    links[0]?.addEventListener("click", (event) => event.preventDefault());
    await click(links[0]!);

    expect(writeToolHandoffMock).toHaveBeenCalledOnce();
    expect(writeToolHandoffMock.mock.calls[0]?.[2]).toEqual({
      source: "daily-search-briefing",
      destination: "traffic-drop-diagnosis",
      scope: "property",
      property: PROPERTY,
      query: null,
      page: null,
      evidenceId: "daily:property:sitewide_click_decline",
    });
    expect(
      (writeToolHandoffMock.mock.calls[0]?.[2] as { evidenceId: string })
        .evidenceId.length,
    ).toBeLessThanOrEqual(256);
  });

  it("routes a property visibility gain to Quick Wins without URL evidence", async () => {
    const base = propertyTrend();
    const baseGainChange = base.change;
    if (baseGainChange === null) throw new Error("fixture must carry a change");
    const host = await renderResults(
      envelope({
        propertyTrend: {
          change: {
            ...baseGainChange,
            kind: "sitewide_visibility_gain",
            current: {
              clicks: 100,
              impressions: 10_000,
              ctr: 0.01,
              position: 8,
            },
            previous: {
              clicks: 50,
              impressions: 7_000,
              ctr: 50 / 7_000,
              position: 10.5,
            },
            clickChange: 50,
            clickChangeRatio: 1,
            impressionChange: 3_000,
            impressionChangeRatio: 3_000 / 7_000,
            positionDelta: -2.5,
          },
          action: {
            kind: "sitewide_visibility_gain",
            destination: "seo-quick-wins",
          },
          noiseFloor: {
            basis: "clicks",
            observedChange: 50,
            minimumForAction: 2 * Math.sqrt(50),
            cleared: true,
          },
        },
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
      }),
    );
    const link = host.querySelector<HTMLAnchorElement>(
      "[data-property-action] [data-action-link]",
    );

    expect(host.textContent).toContain("Property visibility improved materially");
    expect(host.textContent).toContain("Inspect the property-wide visibility gain");
    expect(link?.getAttribute("href")).toBe("/tools/seo-quick-wins");
    expect(link?.getAttribute("href")).not.toContain(PROPERTY);
  });

  it("shows the property trend alongside an exact query action", async () => {
    const source = change("click_opportunity", 1);
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [action(source, "seo-quick-wins")],
        propertyTrend: propertyTrend(),
        signalFunnel: signalFunnel({
          selectedQueryChanges: 1,
          propertyTrendShown: true,
        }),
        queryWatchlist: watchlist("observed"),
      }),
    );

    expect(host.querySelectorAll("[data-change]")).toHaveLength(1);
    expect(host.textContent).toContain(source.query);
    // The query signal keeps the first action slot; the site-wide fact keeps
    // its own place instead of being deleted by it.
    expect(host.querySelectorAll("[data-action-row]")).toHaveLength(2);
    const propertyAction = host.querySelector("[data-property-action]");

    expect(propertyAction).not.toBeNull();
    expect(propertyAction?.getAttribute("data-action-rank")).toBe("2");
    expect(host.querySelector("[data-site-trend]")).not.toBeNull();
    expect(
      host.querySelector("[data-evidence-fold-summary]")?.textContent,
    ).toContain("1 site trend observation");
  });

  it("blocks property-action navigation when the private handoff cannot be stored", async () => {
    writeToolHandoffMock.mockReturnValue(false);
    const host = await renderResults(
      envelope({
        propertyTrend: propertyTrend(),
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
      }),
    );
    const link = host.querySelector<HTMLAnchorElement>(
      "[data-property-action] [data-action-link]",
    )!;
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("navigation was stopped");
    expect(link.getAttribute("href")).toBe("/tools/traffic-drop-diagnosis");
    expect(link.getAttribute("href")).not.toContain(PROPERTY);
  });

  it("humanizes change kinds and evidence while capping the artifact at three", async () => {
    const changes = [
      change("click_opportunity", 1),
      change("stable_position_click_decline", 2),
      change("first_observed", 3),
      change("first_observed", 4),
    ];
    const host = await renderResults(envelope({ changes }));

    const table = host.querySelector('[role="table"]');
    const rows = [...host.querySelectorAll<HTMLElement>("[data-change]")];
    const header = table?.querySelector<HTMLElement>('[role="row"]');
    const columnHeaders = [
      ...(table?.querySelectorAll<HTMLElement>('[role="columnheader"]') ?? []),
    ];

    expect(table).not.toBeNull();
    expect(header?.className).toContain("py-4");
    expect(columnHeaders.every((cell) => cell.className.includes("text-[11px]"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => cell.className.includes("font-semibold"))).toBe(
      true,
    );
    expect(
      [...host.querySelectorAll('[role="columnheader"]')].map((cell) =>
        cell.textContent?.trim(),
      ),
    ).toEqual([
      "Status",
      "Query / Page",
      "Clicks",
      "Position",
      "Interpretation",
    ]);
    expect(rows).toHaveLength(3);
    expect(table?.querySelectorAll('[role="row"]')).toHaveLength(4);
    for (const row of rows) {
      expect(row.tagName).toBe("DIV");
      expect(row.getAttribute("role")).toBe("row");
      expect(row.querySelectorAll('[role="cell"]')).toHaveLength(5);
    }
    expect(rows[0]?.textContent?.split("evidence query 1")).toHaveLength(2);
    expect(rows[0]?.textContent?.split("https://example.com/page-1")).toHaveLength(
      2,
    );
    expect(host.textContent).toContain("20 → 12");
    expect(host.textContent).toContain("8.0 → 8.2");
    expect(host.textContent).toContain("Visibility rose beyond the clicks it earned");
    expect(host.textContent).toContain("Not observed in the comparison window");
    expect(host.textContent).toContain("not proof of new indexing");
    expect(host.textContent).not.toContain("click_opportunity");
    expect(host.textContent).not.toContain("first_observed");
    expect(host.textContent).not.toContain("evidence query 4");
  });

  it("renders a first-observed baseline as not observed rather than zero", async () => {
    const host = await renderResults(
      envelope({ changes: [change("first_observed", 1)] }),
    );
    const row = host.querySelector("[data-change]") as HTMLElement;
    const cells = [...row.querySelectorAll<HTMLElement>('[role="cell"]')];

    expect(cells[2]?.textContent).toContain("Not observed → 12");
    expect(cells[3]?.textContent).toContain("Not observed → 8.2");
    expect(row.textContent).not.toContain("0 → 12");
    expect(row.textContent).not.toContain("0.0 → 8.2");
  });

  it("renders unavailable positions without fabricating a numeric rank", async () => {
    const source = change("stable_position_click_decline", 1, {
      current: {
        query: "evidence query 1",
        clicks: 12,
        impressions: 240,
        position: Number.NaN,
      },
      previous: {
        query: "evidence query 1",
        clicks: 20,
        impressions: 250,
        position: Number.POSITIVE_INFINITY,
      },
    });
    const host = await renderResults(envelope({ changes: [source] }));
    const row = host.querySelector("[data-change]") as HTMLElement;
    const position = row.querySelectorAll<HTMLElement>('[role="cell"]')[3];

    expect(position?.textContent).toContain("Unavailable → Unavailable");
    expect(position?.textContent).not.toContain("NaN");
    expect(position?.textContent).not.toContain("Infinity");
  });

  it("keeps a bordered explanatory panel when no change clears the gates", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        propertyTrend: { change: null, action: null, noiseFloor: null },
        signalFunnel: signalFunnel(),
        queryWatchlist: watchlist("observed"),
      }),
    );
    const section = host.querySelector('[data-result-section="changes"]');
    const empty = section?.querySelector("[data-change-empty]");

    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain(
      "No strict change or query observation reached the available display floors",
    );
    expect(empty?.textContent).toContain("not proof that nothing changed");
    expect(section?.querySelector('[role="table"]')).toBeNull();
    expect(section?.querySelector("[data-change]")).toBeNull();
  });

  it("distinguishes partial and unavailable watchlist evidence", async () => {
    const partialHost = await renderResults(
      envelope({
        queryWatchlist: watchlist("partial", [
          observation("sample_floor_reached", 99),
        ]),
      }),
    );
    expect(partialHost.querySelector("[data-change-empty]")?.textContent).toContain(
      "query read is partial",
    );
    expect(partialHost.textContent).not.toContain("watch query 99");

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

    const unavailableHost = await renderResults(
      envelope({
        queryWatchlist: watchlist("unavailable"),
      }),
    );
    expect(
      unavailableHost.querySelector("[data-change-empty]")?.textContent,
    ).toContain("Comparable query/page evidence is unavailable");
    expect(unavailableHost.textContent).not.toContain("null");
  });

  it("renders only matched actions, caps them at three, and uses internal links", async () => {
    const changes = [
      change("click_opportunity", 1),
      change("stable_position_click_decline", 2),
      change("first_observed", 3),
    ];
    const actions = [
      action(changes[0]!, "seo-quick-wins"),
      action(changes[1]!, "traffic-drop-diagnosis"),
      action(changes[2]!, "on-page-seo-check"),
      {
        kind: "first_observed" as const,
        destination: "on-page-seo-check" as const,
        query: "no matching change",
        page: "https://private.example/unmatched",
      },
    ];
    const host = await renderResults(envelope({ changes, actions }));
    const list = host.querySelector("[data-actions-list]");
    const rows = [...host.querySelectorAll("[data-action-row]")];
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-action-link]")];

    expect(list).not.toBeNull();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("data-action-rank"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    for (const [index, row] of rows.entries()) {
      const rank = row.querySelector("[data-action-rank-badge]");
      expect(rank).not.toBeNull();
      expect(rank?.getAttribute("aria-label")).toBe(`Rank ${index + 1}`);
      expect(rank?.textContent?.trim()).toBe(String(index + 1));
      expect(row.querySelector("[data-action-evidence]")).not.toBeNull();
      expect(row.querySelectorAll("[data-action-link]")).toHaveLength(1);
    }
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tools/seo-quick-wins",
      "/tools/traffic-drop-diagnosis",
      "/tools/on-page-seo-check",
    ]);
    expect(host.innerHTML).not.toContain("no%20matching%20change");
    expect(host.innerHTML).not.toContain("private.example");
  });

  it("keeps a full explanatory action panel when no action matches evidence", async () => {
    const source = change("click_opportunity", 1);
    const unmatchedQuery = "private unmatched query";
    const unmatchedPage = "https://private.example/unmatched-only";
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [
          {
            kind: source.kind,
            destination: "seo-quick-wins",
            query: unmatchedQuery,
            page: unmatchedPage,
          },
        ],
      }),
    );
    const section = host.querySelector('[data-result-section="actions"]');
    const empty = section?.querySelector("[data-action-empty]");

    expect(section).not.toBeNull();
    expect(empty).not.toBeNull();
    expect(empty?.tagName).toBe("DIV");
    expect(empty?.className).toContain("border");
    expect(empty?.textContent).toContain(
      "No action carries strict evidence this run",
    );
    expect(section?.querySelector("[data-actions-list]")).toBeNull();
    expect(section?.querySelector("[data-action-link]")).toBeNull();
    expect(host.textContent).not.toContain(unmatchedQuery);
    expect(host.innerHTML).not.toContain(unmatchedPage);
  });

  it("uses a bounded deterministic evidence id even for long private values", async () => {
    const longQuery = "q".repeat(500);
    const longPage = `https://example.com/${"p".repeat(1_950)}`;
    const source = change("click_opportunity", 1, {
      query: longQuery,
      page: longPage,
      current: {
        query: longQuery,
        clicks: 12,
        impressions: 240,
        position: 8,
      },
      previous: {
        query: longQuery,
        clicks: 10,
        impressions: 200,
        position: 8,
      },
    });
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [action(source, "seo-quick-wins")],
      }),
    );

    const link = host.querySelector("[data-action-link]") as HTMLElement;
    link.addEventListener("click", (event) => event.preventDefault());
    await click(link);

    expect(writeToolHandoffMock).toHaveBeenCalledOnce();
    const payload = writeToolHandoffMock.mock.calls[0]?.[2] as {
      readonly scope: string;
      readonly evidenceId: string;
      readonly query: string;
      readonly page: string;
    };
    expect(payload.scope).toBe("query_page");
    expect(payload.evidenceId).toBe("daily:0:click_opportunity");
    expect(payload.evidenceId.length).toBeLessThanOrEqual(256);
    expect(payload.query).toBe(longQuery);
    expect(payload.page).toBe(longPage);
  });

  it("prevents navigation and explains locally when private handoff storage fails", async () => {
    writeToolHandoffMock.mockReturnValue(false);
    const source = change("click_opportunity", 1);
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [action(source, "seo-quick-wins")],
      }),
    );
    const link = host.querySelector("[data-action-link]") as HTMLAnchorElement;
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("navigation was stopped");
    expect(link.getAttribute("href")).toBe("/tools/seo-quick-wins");
    expect(link.getAttribute("href")).not.toContain(source.query);
    expect(link.getAttribute("href")).not.toContain(source.page);
  });

  it("fails closed when privacy mode makes the sessionStorage getter throw", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("storage access denied");
    });
    const source = change("click_opportunity", 1);
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [action(source, "seo-quick-wins")],
      }),
    );
    const link = host.querySelector("[data-action-link]") as HTMLAnchorElement;
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    await expect(
      act(async () => {
        link.dispatchEvent(event);
        await Promise.resolve();
      }),
    ).resolves.toBeUndefined();

    expect(event.defaultPrevented).toBe(true);
    expect(writeToolHandoffMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("navigation was stopped");
    expect(link.getAttribute("href")).toBe("/tools/seo-quick-wins");
  });
});

describe("DailyBriefingResults page-local manual checks", () => {
  it("starts unconfirmed, marks each check locally, and uses safe external links", async () => {
    const host = await renderResults();
    const external = [...host.querySelectorAll<HTMLAnchorElement>("[data-manual-link]")];

    expect(host.textContent).toContain("Not confirmed on this page");
    expect(external).toHaveLength(2);
    for (const link of external) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
    }

    await click(buttonWith(host, "Mark checked for this page"));
    expect(host.textContent).toContain("Marked on this page: no notification seen");
    expect(host.textContent).toContain("Not confirmed on this page");
  });
});

describe("DailyBriefingResults unread query evidence", () => {
  it("explains that the lanes never ran rather than blaming the sample", async () => {
    const host = await renderResults(
      envelope({ mode: "unavailable", cadence: "weekly" }),
    );
    const facts = host.querySelector('[data-result-section="facts"]');
    const changes = host.querySelector('[data-result-section="changes"]');

    expect(facts?.textContent).toContain("query evidence could not be read");
    expect(facts?.textContent).not.toContain(
      "Daily interpretation is suppressed because the sample",
    );
    expect(changes?.textContent).toContain("none of the lanes below were run");
    expect(changes?.textContent).not.toContain("Strict changes appear first");
  });
});

describe("DailyBriefingResults folded explanation", () => {
  it("labels the fold with the question it answers", async () => {
    const host = await renderResults();
    const details = host.querySelector("[data-evidence-details]");

    // The section holds the noise strip, the signal funnel, coverage and
    // anonymization. A reader opens it to find out why the briefing was
    // thin, not to read the name of a threshold.
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Why there were not more signals",
    );
  });
});
