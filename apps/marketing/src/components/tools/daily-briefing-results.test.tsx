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
  type DailyBriefingPageAction,
  type DailyBriefingPageChange,
  type DailyBriefingQueryObservation,
  type DailyBriefingSuggestedCheck,
  type DailyBriefingProvisionalMoves,
  type DailyBriefingQueryWatchlist,
  type DailyBriefingRowAccounting,
  type DailyBriefingSignalFunnel,
} from "@sf/public-tools";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

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
  trend: {
    daily: {
      rows: completeDateRows().map((row) => ({
        key: row.date,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      })),
      firstIncompleteDate: null,
      firstIncompleteHour: null,
    },
    hourly: {
      rows: [
        { key: "2026-08-24T17:00:00", clicks: 2, impressions: 40, position: 8.5 },
        { key: "2026-08-24T18:00:00", clicks: 3, impressions: 70, position: 8.1 },
        { key: "2026-08-24T19:00:00", clicks: 4, impressions: 90, position: 7.8 },
      ],
      firstIncompleteDate: null,
      firstIncompleteHour: null,
    },
  },
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
    firstObservedLeadingCandidates: 0,
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
      first_observed_leading: "not_applicable",
    },
    // Page evidence defaults to unread, so a fixture that says nothing about
    // pages does not assert the property has none.
    pairedPageRows: null,
    pageFloorRows: null,
    pageLanes: {
      page_impression_collapse: "unavailable",
      page_click_decline: "unavailable",
      page_first_observed: "unavailable",
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
      first_observed_leading: laneRows(540),
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

const PAGE_CHANGE_URL = "https://example.com/guide";
const CHECK_QUERY = "messi zodiac sign";
const CHECK_PAGE = "https://example.com/wiki/messi";

function pageChange(
  overrides: Partial<DailyBriefingPageChange> = {},
): DailyBriefingPageChange {
  return {
    kind: "page_click_decline",
    evidence: "observed",
    page: PAGE_CHANGE_URL,
    current: { page: PAGE_CHANGE_URL, clicks: 8, impressions: 380, position: 9.4 },
    previous: { page: PAGE_CHANGE_URL, clicks: 20, impressions: 400, position: 9.1 },
    clickChange: -12,
    clickChangeRatio: -0.6,
    impressionChange: -20,
    impressionChangeRatio: -0.05,
    positionDelta: 0.3,
    noiseFloor: {
      basis: "clicks",
      observedChange: -12,
      minimumForAction: 2 * Math.sqrt(20),
      cleared: true,
    },
    ...overrides,
  };
}

function pageAction(
  overrides: Partial<DailyBriefingPageAction> = {},
): DailyBriefingPageAction {
  return {
    kind: "page_click_decline",
    destination: "traffic-drop-diagnosis",
    page: PAGE_CHANGE_URL,
    ...overrides,
  };
}

function checkableObservation(
  overrides: Partial<DailyBriefingQueryObservation> = {},
): DailyBriefingQueryObservation {
  return {
    kind: "sample_floor_reached",
    band: "page_one",
    query: CHECK_QUERY,
    page: CHECK_PAGE,
    pageEvidence: "observed",
    current: { query: CHECK_QUERY, clicks: 0, impressions: 185, position: 8.2 },
    previous: null,
    previousBelowFloor: null,
    positionDelta: null,
    ...overrides,
  };
}

function suggestedCheck(
  overrides: Partial<DailyBriefingSuggestedCheck> = {},
): DailyBriefingSuggestedCheck {
  return {
    query: CHECK_QUERY,
    page: CHECK_PAGE,
    band: "page_one",
    sampleKind: "sample_floor_reached",
    destination: "on-page-seo-check",
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
  // The privacy-mode test replaces the sessionStorage getter with one that
  // throws. Without this, every test declared after it inherits a broken
  // global and its handoff clicks fail silently — which is exactly how it
  // was found.
  vi.restoreAllMocks();
});

async function renderResults(
  report: DailyBriefingEnvelope = envelope(),
  renderLocale: "en" | "zh" = "en",
) {
  const messages = renderLocale === "zh" ? zh : en;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale={renderLocale}
        timeZone="UTC"
        messages={{ tools: { dailyBriefing: messages.tools.dailyBriefing } }}
      >
        <DailyBriefingResults
          locale={renderLocale}
          property={PROPERTY}
          envelope={report}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

async function renderZhResults(
  report: DailyBriefingEnvelope = envelope(),
) {
  return renderResults(report, "zh");
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

describe("DailyBriefingResults trend and evidence facts", () => {
  it("leads with the default 24h trend and removes the run-status facts and old KPI block", async () => {
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

    // The chart owns the four KPI values now. The old run-complete message and
    // facts/KPI panels were status noise ahead of the actual briefing.
    expect(order).toEqual([
      "trend",
      "changes",
      "actions",
      "manual",
      "evidence",
      "noise",
      "limitations",
      "methodology",
    ]);
    expect(host.textContent).not.toContain("Daily briefing complete");
    expect(host.querySelector('[data-result-section="facts"]')).toBeNull();
    expect(host.querySelector('[data-result-section="kpis"]')).toBeNull();
    expect(host.querySelector('[data-trend-period="24h"]')).not.toBeNull();
    expect(host.querySelector('[data-trend-period="24h"]')?.getAttribute("aria-pressed")).toBe("true");
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

  it("does not count the hidden site trend in the evidence-fold summary", async () => {
    const host = await renderResults(
      envelope({
        propertyTrend: propertyTrend(),
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
        queryWatchlist: watchlist("observed", [], { candidates: 8 }),
      }),
    );
    const summary = host.querySelector("[data-evidence-fold-summary]");

    expect(summary?.textContent).toContain("0 query changes");
    expect(summary?.textContent).toContain("0/8 observation candidates shown");
    expect(summary?.textContent).not.toContain("site trend observation");
    expect(summary?.textContent).not.toContain("site trend not readable");
    expect(summary?.textContent).not.toContain("below the threshold");
  });

  it("renders the four colour-linked chart metric cards instead of comparison KPI cards", async () => {
    const host = await renderResults(
      envelope({ mode: "change_detection", cadence: "daily" }),
    );
    const cards = [...host.querySelectorAll("[data-trend-metric]")];
    const expectedTokens = {
      clicks: "var(--gsc-clicks)",
      impressions: "var(--gsc-impressions)",
      ctr: "var(--gsc-ctr)",
      position: "var(--gsc-position)",
    } as const;

    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.getAttribute("aria-pressed")).toBe("true");
    }
    for (const [metric, token] of Object.entries(expectedTokens)) {
      const card = host.querySelector<HTMLElement>(`[data-trend-metric="${metric}"]`);
      const line = host.querySelector<SVGPathElement>(
        `[data-trend-chart] path[stroke="${token}"]`,
      );

      expect(card?.getAttribute("style")).toContain(token);
      expect(line?.getAttribute("stroke")).toBe(token);
    }
    expect(host.querySelector('[data-trend-chart]')).not.toBeNull();
    expect(host.textContent).not.toContain("Latest complete day");
    expect(host.textContent).not.toContain("Current complete 7 days");
  });

  it("withholds the trend average when a bucket with traffic has no position", async () => {
    // The GSC reader coerces a missing position to 0, and this chart draws
    // smaller positions higher. Averaged over every impression, a single such
    // bucket dragged the KPI below every point it summarised and plotted a
    // line above all of them; averaged over only the buckets that had one, it
    // reported 8.0 for a period where 90% of the impressions sat at an unknown
    // position.
    const withGap: DailyBriefingEnvelope = {
      ...BASE_ENVELOPE,
      result: {
        ...BASE_ENVELOPE.result,
        propertyTrend: { change: null, action: null, noiseFloor: null },
        trend: {
          ...BASE_ENVELOPE.result.trend,
          hourly: {
            ...BASE_ENVELOPE.result.trend.hourly,
            points: [
              {
                key: "2026-08-24T17:00:00",
                clicks: 2,
                impressions: 100,
                ctr: 0.02,
                position: 8,
              },
              {
                key: "2026-08-24T18:00:00",
                clicks: 3,
                impressions: 900,
                ctr: 0.0033,
                position: 0,
              },
            ],
          },
        },
      },
    };
    const host = await renderResults(withGap);
    const card = host.querySelector<HTMLElement>(
      '[data-trend-metric="position"]',
    );

    // Asserted positively as well: a card that vanished, or that printed some
    // fourth wrong number, would satisfy the three negatives on its own.
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("—");
    expect(card?.textContent).not.toContain("0.8");
    expect(card?.textContent).not.toContain("0.0");
    expect(card?.textContent).not.toContain("8.0");
    // Clicks and impressions are complete, so they are still reported.
    expect(
      host.querySelector('[data-trend-metric="impressions"]')?.textContent,
    ).toContain("1,000");
  });

  it("keeps the 24h chart available regardless of briefing action cadence", async () => {
    const host = await renderResults(
      envelope({ cadence: "weekly" }),
    );

    expect(host.querySelector('[data-trend-period="24h"]')).not.toBeNull();
    expect(host.querySelector('[data-trend-period="24h"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll('[data-trend-metric]')).toHaveLength(4);
  });

  it("switches trend windows and lets a metric card hide only its matching line", async () => {
    const host = await renderResults();
    const sevenDays = buttonWith(host, "7 days");
    const clicks = host.querySelector<HTMLButtonElement>(
      '[data-trend-metric="clicks"]',
    );

    await click(sevenDays);
    expect(sevenDays.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-trend-period="24h"]')?.getAttribute("aria-pressed")).toBe("false");

    await click(clicks!);
    expect(clicks?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[data-trend-chart] path[stroke="var(--gsc-clicks)"]')).toBeNull();
    expect(host.querySelector('[data-trend-chart] path[stroke="var(--gsc-ctr)"]')).not.toBeNull();
  });

  it("renders an unavailable trend as unavailable rather than substituting zero", async () => {
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
      envelope({
        day: unavailable,
        weekly: unavailable,
        cadence: "weekly",
        trend: {
          daily: { evidence: "unavailable", points: [], firstIncompleteDate: null, firstIncompleteHour: null },
          hourly: { evidence: "unavailable", points: [], firstIncompleteDate: null, firstIncompleteHour: null },
        },
      }),
    );

    expect(host.textContent).toContain("Unavailable");
    expect(host.textContent).toContain("Hourly trend is temporarily unavailable");
    expect(host.textContent).not.toContain("0 clicks");
  });

  it("does not turn a successful empty trend response into zero traffic", async () => {
    const host = await renderResults(
      envelope({
        trend: {
          daily: {
            evidence: "observed",
            points: [],
            firstIncompleteDate: null,
            firstIncompleteHour: null,
          },
          hourly: {
            evidence: "partial",
            points: [],
            firstIncompleteDate: null,
            firstIncompleteHour: null,
          },
        },
      }),
    );
    const cards = [...host.querySelectorAll("[data-trend-metric] strong")];

    expect(cards.map((card) => card.textContent)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
    expect(host.textContent).toContain("No hourly data points were returned");
  });

  it("uses exact clock and calendar windows instead of the last N returned rows", async () => {
    const host = await renderResults(
      envelope({
        trend: {
          daily: {
            evidence: "observed",
            points: [
              { key: "2026-08-17", clicks: 100, impressions: 1_000, ctr: 0.1, position: 8 },
              { key: "2026-08-18", clicks: 3, impressions: 100, ctr: 0.03, position: 7 },
            ],
            firstIncompleteDate: null,
            firstIncompleteHour: null,
          },
          hourly: {
            evidence: "partial",
            points: [
              { key: "2026-08-23T13:00:00-07:00", clicks: 100, impressions: 1_000, ctr: 0.1, position: 8 },
              { key: "2026-08-24T12:00:00-07:00", clicks: 3, impressions: 100, ctr: 0.03, position: 7 },
            ],
            firstIncompleteDate: null,
            firstIncompleteHour: "2026-08-24T12:00:00-07:00",
          },
        },
      }),
    );
    const clicks = host.querySelector('[data-trend-metric="clicks"] strong');

    expect(clicks?.textContent).toBe("3");

    await click(buttonWith(host, "7 days"));
    expect(clicks?.textContent).toBe("3");
  });

  it("uses real fractional ranges and breaks offset-hour lines across missing buckets", async () => {
    const host = await renderResults(
      envelope({
        trend: {
          ...BASE_ENVELOPE.result.trend,
          hourly: {
            evidence: "partial",
            points: [
              { key: "2026-08-24T10:00:00-07:00", clicks: 1, impressions: 200, ctr: 0.005, position: 8.5 },
              { key: "2026-08-24T12:00:00-07:00", clicks: 3, impressions: 200, ctr: 0.015, position: 8.1 },
            ],
            firstIncompleteDate: null,
            firstIncompleteHour: "2026-08-24T10:00:00-07:00",
          },
        },
      }),
    );
    const ctrPath = host.querySelector(
      '[data-trend-chart] path[stroke="var(--gsc-ctr)"]',
    );
    const path = ctrPath?.getAttribute("d") ?? "";

    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain(" L");
    expect(path).toContain(",18.0");
    expect(path).toContain(",292.0");
  });

  it("offers every selected point as a keyboard-accessible data table", async () => {
    const host = await renderResults();
    const table = host.querySelector("[data-trend-table] table");

    expect(table).not.toBeNull();
    expect(table?.textContent).toContain("Clicks");
    expect(table?.textContent).toContain("Impressions");
    expect(table?.textContent).toContain("Avg CTR");
    expect(table?.textContent).toContain("Avg position");
    expect(table?.textContent).toContain("2026-08-23T14:00:00-07:00");
    expect(table?.textContent).toContain("2026-08-24T17:00:00");
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
          firstObservedLeadingCandidates: null,
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
    // Eleven paths: the CTR baseline, six query lanes, three page lanes and
    // the page-attribution line. Counted literally so that adding a lane
    // without deciding what it says here fails right at this assertion.
    expect(paths?.querySelectorAll("[data-signal-path]")).toHaveLength(11);
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
            first_observed_leading: "unavailable",
          },
        }),
        rowAccounting: rowAccounting({
          byLane: {
            click_opportunity: laneRows(540),
            stable_position_click_decline: laneRows(540),
            average_position_crossed_page_one_band: laneRows(538, 2, 0),
            actionable_position_decline: laneRows(540),
            first_observed: laneRows(540),
            first_observed_leading: laneRows(540),
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
          firstObservedLeadingCandidates: null,
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
    const outcomes = [
      ...(paths?.querySelectorAll("[data-path-outcome]") ?? []),
      ...(paths?.querySelectorAll("[data-selection-not-shown]") ?? []),
    ];
    // Asserted, not assumed: a loop over a selector that stopped matching
    // would otherwise pass by making no assertion at all.
    // The eleven signal paths plus the two per-population selection lines.
    expect(outcomes).toHaveLength(13);
    for (const outcome of outcomes) {
      expect(outcome.textContent).not.toContain("null");
      expect(outcome.textContent).not.toMatch(/\b0\b/);
    }
    expect(paths?.textContent).not.toContain("query rows, and every");
    expect(paths?.querySelectorAll("[data-signal-path]")).toHaveLength(11);
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
            first_observed_leading: "evaluated",
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
            first_observed_leading: laneRows(8, 0, 4),
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

/**
 * Every link out of this briefing that lands on one of our own tools opens a
 * new tab and keeps its opener.
 *
 * Written as a sweep of the rendered output rather than a list of the
 * `data-*` hooks, because the failure this guards against is a NEW handoff
 * link added without them: a list would go on passing while the new link
 * navigated this tab away. The briefing is not recoverable -- nothing is
 * persisted, the URL carries no state, and the run spent one of the property's
 * hourly Search Console slots -- and the handoff itself rides session storage,
 * which a new tab receives only when it has an opener. `noopener` here means
 * the destination reads nothing.
 */
function expectToolLinksOpenInANewTab(host: HTMLElement): void {
  // Resolved against an origin, not matched on a leading slash. `href^='/'`
  // was the wrong shape for what this sweep claims to check: `//evil.example/`
  // starts with a slash and is cross-origin, so a protocol-relative href would
  // have been swept up and asserted to carry `rel="opener"` -- the one
  // combination this guard exists to prevent. Unreachable today (the locale
  // layout whitelists `locale` against `routing.locales` before any of this
  // renders) but the predicate should match the claim, not the current luck.
  const origin = "https://gengrowth.test";
  const links = [...host.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
    (link) => {
      const href = link.getAttribute("href") ?? "";
      try {
        const resolved = new URL(href, origin);
        return resolved.origin === origin && resolved.pathname.includes("/tools/");
      } catch {
        return false;
      }
    },
  );

  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.getAttribute("target")).toBe("_blank");
    // Asserted exactly: the string "noopener" contains "opener".
    expect(link.getAttribute("rel")).toBe("opener");
    expect(link.getAttribute("rel")).not.toContain("noopener");
  }
}

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

    expectToolLinksOpenInANewTab(host);

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

  it("does not render cadence rationale after the status cards were removed", async () => {
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
            first_observed_leading: "not_applicable",
          },
        }),
      }),
    );

    expect(host.querySelector('[data-result-section="facts"]')).toBeNull();
    expect(host.querySelector('[data-result-section="trend"]')).not.toBeNull();
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

  it("states the selection rules that stand between a candidate and a row", async () => {
    const host = await renderResults(
      envelope({
        changes: [change("click_opportunity", 1)],
        rowAccounting: rowAccounting({ notSelectedVisibleRows: 4 }),
      }),
    );
    const rules = host.querySelector("[data-selection-rules]");

    // Passing both stated lines is not sufficient; three presentation rules
    // stand between a candidate and the table, and they were stated nowhere.
    expect(rules?.textContent).toContain("One row per query");
    expect(rules?.textContent).toContain("at most three query rows");
    expect(rules?.textContent).toContain("gives up its place");
    expect(
      host.querySelector('[data-selection-not-shown="query"]')?.textContent,
    ).toContain("4 further query records");
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
      envelope({
        mode: "current_position_watchlist",
        // With rows to list. The sentence is about what the table below it
        // contains, so an empty table needs the other one.
        queryWatchlist: watchlist("observed", [
          observation("sample_floor_reached", 1),
        ]),
      }),
    );
    // The remaining review guidance still names the real reason, without a
    // redundant cadence card ahead of the chart.
    expect(host.textContent).toContain(
      "There is no comparable prior window this run",
    );
    expect(host.textContent).not.toContain("position-first");
  });

  it("does not promise current positions when the watchlist could state none", async () => {
    // The engine falls back to this mode whenever no lane could be evaluated,
    // whether or not any position turned out to be statable — a run whose
    // positions were all unmeasured opened with "only current-window positions
    // are listed" above a table listing none.
    const host = await renderResults(
      envelope({
        mode: "current_position_watchlist",
        queryWatchlist: watchlist("observed"),
      }),
    );

    expect(host.textContent).not.toContain(
      "There is no comparable prior window this run",
    );
    expect(host.textContent).toContain("no current position could be stated");
  });

  it("humanizes every limitation and never renders a raw machine code", async () => {
    const host = await renderResults(envelope({ limitations: LIMITATIONS }));

    expect(host.textContent).toContain("required complete dates were missing");
    expect(host.textContent).toContain("brand list was not explicitly confirmed");
    for (const code of LIMITATIONS) {
      expect(host.textContent).not.toContain(code);
    }
  });

  it("hides the duplicate site-wide trend while preserving its exact property action", async () => {
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
    const propertyAction = host.querySelector<HTMLElement>(
      '[data-result-section="actions"] [data-property-action]',
    );

    expect(table).not.toBeNull();
    expect(host.querySelector("[data-site-trend]")).toBeNull();
    expect(host.querySelector('[data-result-section="site-trend"]')).toBeNull();
    expect(host.querySelector("[data-property-change]")).toBeNull();
    expect(table?.textContent).toContain(watch.query);
    expect(propertyAction).not.toBeNull();
    expect(propertyAction?.textContent).toContain(
      "Diagnose the property-wide click decline",
    );
    expect(propertyAction?.textContent).toContain("49 → 35");
    expect(propertyAction?.textContent).toContain("5,285 → 4,109");
    expect(propertyAction?.textContent).toContain("13.2 → 15.1");
    expect(
      propertyAction?.querySelector("[data-action-link]")?.getAttribute("href"),
    ).toBe("/tools/traffic-drop-diagnosis");
  });

  it("does not repeat a non-actionable property movement below the action floor", async () => {
    const host = await renderResults(
      envelope({
        propertyTrend: propertyTrend({
          action: null,
          noiseFloor: {
            basis: "clicks",
            observedChange: -3,
            minimumForAction: 2 * Math.sqrt(49),
            cleared: false,
          },
        }),
        signalFunnel: signalFunnel({ propertyTrendShown: true }),
      }),
    );

    expect(host.querySelector('[data-result-section="trend"]')).not.toBeNull();
    expect(host.querySelector("[data-site-trend]")).toBeNull();
    expect(host.querySelector('[data-result-section="site-trend"]')).toBeNull();
    expect(host.querySelector("[data-property-action]")).toBeNull();
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

  it("keeps unavailable property positions honest in the property action", async () => {
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
    const row = host.querySelector<HTMLElement>("[data-property-action]");

    expect(row?.textContent).toContain("Unavailable → Unavailable");
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
      "1 within this group",
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

    expect(host.textContent).toContain("The property moved up week over week");
    expect(host.querySelector("[data-site-trend]")).toBeNull();
    expect(link?.getAttribute("href")).toBe("/tools/seo-quick-wins");
    expect(link?.getAttribute("href")).not.toContain(PROPERTY);
  });

  it("keeps the property action alongside an exact query action without a duplicate trend card", async () => {
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
    expect(host.querySelectorAll("[data-action-row]")).toHaveLength(2);
    const propertyAction = host.querySelector("[data-property-action]");

    expect(propertyAction).not.toBeNull();
    // Each group orders itself. A sequence running 1, 2, 3 through query,
    // page and property actions would read as one priority order over three
    // different populations, and nothing measured supports that ordering.
    expect(propertyAction?.getAttribute("data-action-rank")).toBe("1");
    expect(host.querySelector("[data-site-trend]")).toBeNull();
    expect(host.querySelector('[data-result-section="site-trend"]')).toBeNull();
    expect(
      host.querySelector("[data-evidence-fold-summary]")?.textContent,
    ).not.toContain("site trend observation");
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
    const header = table?.querySelector<HTMLElement>(
      "[data-review-table-header]",
    );
    const columnHeaders = [
      ...(table?.querySelectorAll<HTMLElement>('[role="columnheader"]') ?? []),
    ];

    expect(table).not.toBeNull();
    expect(header?.className).toContain("min-h-[50px]");
    expect(header?.className).toContain("md:px-[14px]");
    expect(header?.className).toContain("md:py-[13px]");
    expect(columnHeaders.every((cell) => cell.className.includes("text-[12px]"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => cell.className.includes("font-semibold"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => cell.className.includes("font-sans"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => cell.className.includes("tracking-[0.02em]"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => cell.className.includes("normal-case"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => !cell.className.includes("font-mono"))).toBe(
      true,
    );
    expect(columnHeaders.every((cell) => !cell.className.includes("uppercase"))).toBe(
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
    expect(table?.querySelectorAll('[role="row"]')).toHaveLength(5);
    const queryGroup = table?.querySelector<HTMLElement>(
      '[data-review-group="query"]',
    );
    expect(queryGroup?.querySelector("h4")?.textContent).toBe("Query records");
    expect(queryGroup?.textContent).toContain("3 records");
    expect(
      queryGroup?.querySelector('[role="cell"]')?.getAttribute("aria-colspan"),
    ).toBe("5");
    expect(table?.querySelector('[data-review-group="page"]')).toBeNull();
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
    expect(host.textContent).toContain("Clicks trail this property's own baseline for the same position band");
    expect(host.textContent).toContain("Not observed in the comparison window");
    expect(host.textContent).toContain("not proof of new indexing");
    expect(host.textContent).not.toContain("click_opportunity");
    expect(host.textContent).not.toContain("first_observed");
    expect(host.textContent).not.toContain("evidence query 4");
  });

  it("renders the page population heading independently of query records", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        pageChanges: [pageChange()],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const table = host.querySelector('[role="table"]');
    const pageGroup = table?.querySelector<HTMLElement>(
      '[data-review-group="page"]',
    );

    expect(table?.querySelector('[data-review-group="query"]')).toBeNull();
    expect(pageGroup?.querySelector("h4")?.textContent).toBe(
      "Page-dimension records",
    );
    expect(pageGroup?.textContent).toContain("1 record");
    expect(pageGroup?.textContent).not.toContain("1 records");
    expect(
      pageGroup?.querySelector('[role="cell"]')?.getAttribute("aria-colspan"),
    ).toBe("5");
    expect(pageGroup?.querySelector("h4")?.className).toContain("text-[15px]");
    expect(pageGroup?.querySelector("h4")?.className).toContain("font-semibold");
    expect(pageGroup?.querySelector("span")?.className).toContain("text-[13px]");
    expect(pageGroup?.className).toContain("bg-brand-panel-raised");
    expect(pageGroup?.className).not.toContain("shadow");
    expect(pageGroup?.className).not.toContain("gradient");
  });

  it("keeps both population headings ordered and every desktop row aligned to one template", async () => {
    const strict = change("stable_position_click_decline", 1);
    const move = provisionalMove("provisional_page_one_band_entry", 2);
    const watch = observation("sample_floor_reached", 3);
    const host = await renderResults(
      envelope({
        changes: [strict],
        provisionalMoves: provisionalMoves([move]),
        queryWatchlist: watchlist("observed", [watch]),
        pageChanges: [pageChange()],
      }),
    );
    const table = host.querySelector<HTMLElement>('[role="table"]');
    const header = table?.querySelector<HTMLElement>(
      "[data-review-table-header]",
    );
    const gridTemplate = header?.className
      .split(" ")
      .find((className) => className.startsWith("md:grid-cols-"));
    const groups = [
      ...(table?.querySelectorAll<HTMLElement>("[data-review-group]") ?? []),
    ];
    const rows = [
      ...(table?.querySelectorAll<HTMLElement>("[data-review-row]") ?? []),
    ];

    expect(table?.querySelector("[data-review-table-scroll]")?.className).toContain(
      "overflow-x-auto",
    );
    expect(table?.querySelector("[data-review-table-content]")?.className).toContain(
      "md:min-w-[860px]",
    );
    expect(table?.className).not.toContain("min-w-[860px]");
    expect(gridTemplate).toBe(
      "md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.9fr)_minmax(0,0.68fr)_minmax(0,0.72fr)_minmax(0,1.55fr)]",
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.className.includes(gridTemplate ?? "missing"))).toBe(
      true,
    );
    expect(groups.map((group) => group.getAttribute("data-review-group"))).toEqual([
      "query",
      "page",
    ]);
    expect(groups[0]?.textContent).toContain("3 records");
    expect(groups[1]?.textContent).toContain("1 record");
    expect(groups[1]?.textContent).not.toContain("1 records");
    expect(
      groups.map((group) =>
        group.querySelector('[role="cell"]')?.getAttribute("aria-colspan"),
      ),
    ).toEqual(["5", "5"]);
    expect(
      [...table!.querySelectorAll("[data-review-row], [data-review-group]")].map(
        (node) =>
          node.getAttribute("data-review-group") ??
          (node.hasAttribute("data-page-change") ? "page-row" : "query-row"),
      ),
    ).toEqual([
      "query",
      "query-row",
      "query-row",
      "query-row",
      "page",
      "page-row",
    ]);
  });

  it("renders the query-only population heading and plural count in Chinese", async () => {
    const host = await renderZhResults(
      envelope({
        changes: [1, 2, 3].map((index) =>
          change("stable_position_click_decline", index),
        ),
        pageChanges: [],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const queryGroup = host.querySelector<HTMLElement>(
      '[data-review-group="query"]',
    );

    expect(queryGroup?.querySelector("h4")?.textContent).toBe("查询词记录");
    expect(queryGroup?.textContent).toContain("3 条记录");
    expect(host.querySelector('[data-review-group="page"]')).toBeNull();
  });

  it("renders the page-only population heading and singular count in Chinese", async () => {
    const host = await renderZhResults(
      envelope({
        changes: [],
        pageChanges: [pageChange()],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const pageGroup = host.querySelector<HTMLElement>(
      '[data-review-group="page"]',
    );

    expect(host.querySelector('[data-review-group="query"]')).toBeNull();
    expect(pageGroup?.querySelector("h4")?.textContent).toBe("页面维度记录");
    expect(pageGroup?.textContent).toContain("1 条记录");
  });

  it("orders both Chinese population headings with their displayed counts", async () => {
    const strict = change("stable_position_click_decline", 1);
    const host = await renderZhResults(
      envelope({
        changes: [strict],
        queryWatchlist: watchlist("observed", [
          observation("sample_floor_reached", 2),
        ]),
        pageChanges: [pageChange()],
      }),
    );
    const groups = [
      ...host.querySelectorAll<HTMLElement>("[data-review-group]"),
    ];

    expect(groups.map((group) => group.getAttribute("data-review-group"))).toEqual([
      "query",
      "page",
    ]);
    expect(groups[0]?.querySelector("h4")?.textContent).toBe("查询词记录");
    expect(groups[0]?.textContent).toContain("2 条记录");
    expect(groups[1]?.querySelector("h4")?.textContent).toBe("页面维度记录");
    expect(groups[1]?.textContent).toContain("1 条记录");
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
      expect(rank?.getAttribute("aria-label")).toBe(`${index + 1} within this group`);
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
    expectToolLinksOpenInANewTab(host);
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
    const changes = host.querySelector('[data-result-section="changes"]');

    expect(host.querySelector('[data-result-section="facts"]')).toBeNull();
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

  it("counts page candidates in the not-shown line, not only query ones", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        rowAccounting: rowAccounting({ notSelectedVisibleRows: 0 }),
        pageAccounting: {
          evidence: "observed",
          observedRows: 6,
          previousObservedRows: 6,
          notSelectedVisibleRows: 2,
          unreadableRows: 0,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(2, 0, 4),
            page_first_observed: laneRows(6, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const queryLine = host.querySelector('[data-selection-not-shown="query"]');
    const pageLine = host.querySelector('[data-selection-not-shown="page"]');

    // One line per population, never their sum: the query side really did show
    // everything, and the page side did not.
    expect(queryLine?.textContent).toBe(
      en.tools.dailyBriefing.evidence.paths.selectionAllShownQuery,
    );
    expect(pageLine?.textContent).toContain("2 further page records");
  });

  it.each([
    ["the query side", null, 0, "UnavailableQuery", "AllShownPage"],
    ["the page side", 0, null, "AllShownQuery", "UnavailablePage"],
  ])("withholds a not-shown count it could not measure on %s", async (
    _label,
    queryCount,
    pageCount,
    queryKey,
    pageKey,
  ) => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        rowAccounting: rowAccounting({ notSelectedVisibleRows: queryCount }),
        pageAccounting: {
          evidence: "observed",
          observedRows: 2,
          previousObservedRows: 2,
          notSelectedVisibleRows: pageCount,
          unreadableRows: 0,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(2, 0, 0),
            page_first_observed: laneRows(2, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const copy = en.tools.dailyBriefing.evidence.paths as unknown as Readonly<
      Record<string, string>
    >;

    // A null on one side is not a zero on the other, in either direction, and
    // summing them produced an exact-looking total out of one unknown.
    expect(
      host.querySelector('[data-selection-not-shown="query"]')?.textContent,
    ).toBe(copy[`selection${queryKey}`]);
    expect(
      host.querySelector('[data-selection-not-shown="page"]')?.textContent,
    ).toBe(copy[`selection${pageKey}`]);
  });

  it("names a row it could not read rather than shrinking the denominator", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        // Three readable rows below the floor plus two unreadable ones: the
        // lanes did establish they had nothing to measure, so the split
        // renders rather than the "could not look" sentence.
        laneCapability: laneCapability({
          pageLanes: {
            page_impression_collapse: "not_applicable",
            page_click_decline: "not_applicable",
            page_first_observed: "not_applicable",
          },
        }),
        pageAccounting: {
          evidence: "observed",
          observedRows: 5,
          previousObservedRows: 5,
          notSelectedVisibleRows: 0,
          unreadableRows: 2,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(5, 0, 0),
            page_first_observed: laneRows(5, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const intro = host.querySelector("[data-page-rows-intro]");
    const paths = host.querySelector("[data-signal-paths]");

    expect(intro?.textContent).toContain("5 page records returned");
    expect(intro?.textContent).toContain(
      "2 of them did not become a usable page record",
    );
    // Named accurately: a duplicated URL is rejected for being duplicated, not
    // for figures that contradict each other.
    expect(intro?.textContent).toContain("returned more than once");
    expect(intro?.textContent).toContain("None of the three paths evaluated them");
    // And the lanes must carry them, not just the sentence above: an
    // unreadable row is a row neither lane could ask about.
    for (const id of ["page-click-decline", "page-first-observed"]) {
      expect(
        paths?.querySelector(`[data-signal-path="${id}"]`)?.textContent,
      ).toContain("5 not evaluated");
    }
  });

  it("does not mention the hidden site trend when the weekly comparison was unread", async () => {
    const base = envelope();
    const host = await renderResults({
      ...base,
      result: {
        ...base.result,
        weekly: { ...base.result.weekly, evidence: "unavailable" },
        propertyTrend: { change: null, action: null, noiseFloor: null },
        queryWatchlist: watchlist("observed"),
      },
    });
    const summary = host.querySelector("[data-evidence-fold-summary]");

    expect(summary?.textContent).not.toContain("site trend not readable");
    expect(summary?.textContent).not.toContain("site trend observation");
  });

  it("orders each action group from one instead of ranking across them", async () => {
    const source = change("click_opportunity", 1);
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [action(source, "seo-quick-wins")],
        pageChanges: [pageChange()],
        pageActions: [pageAction()],
        propertyTrend: propertyTrend(),
        queryWatchlist: watchlist("observed"),
      }),
    );
    const ranks = [
      ...host.querySelectorAll<HTMLElement>("[data-action-row]"),
    ].map((row) => row.getAttribute("data-action-rank"));

    // Three actions over three populations, each numbered within its own.
    expect(ranks).toEqual(["1", "1", "1"]);
    // And the grouping is on screen, not only in the numbering: without a
    // visible boundary, query action 3 still reads as ranked above page
    // action 1 under a heading that claims a certainty order.
    expect(
      [...host.querySelectorAll("[data-action-group]")].map((node) =>
        node.getAttribute("data-action-group"),
      ),
    ).toEqual(["query", "page", "property"]);
    // The boundary has to be readable, not only queryable: each group carries
    // its own visible label, which is what a reader has instead of the
    // sentence this section used to open with.
    const actionsText = host.querySelector(
      '[data-result-section="actions"]',
    )?.textContent;
    expect(actionsText).toContain("Query evidence");
    expect(actionsText).toContain("Page evidence");
    expect(actionsText).toContain("Property evidence");
  });

  it("renders both budgets at once without either capping the other", async () => {
    const queryChanges = [1, 2, 3].map((index) =>
      change("stable_position_click_decline", index),
    );
    const host = await renderResults(
      envelope({
        changes: queryChanges,
        actions: queryChanges.map((source) =>
          action(source, "traffic-drop-diagnosis"),
        ),
        pageChanges: [
          pageChange(),
          pageChange({ page: "https://example.com/second" }),
        ],
        pageActions: [
          pageAction(),
          pageAction({ page: "https://example.com/second" }),
        ],
        queryWatchlist: watchlist("observed"),
      }),
    );

    // Three query rows saturate the query budget. Slicing page rows from what
    // the query rows left over would show none of these.
    expect(host.querySelectorAll("[data-change]")).toHaveLength(3);
    expect(host.querySelectorAll("[data-page-change]")).toHaveLength(2);
    expect(host.querySelectorAll("[data-action-row]")).toHaveLength(5);
    expect(host.querySelector('[data-review-group="page"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll("[data-page-row-rank]")].map(
        (badge) => badge.textContent,
      ),
    ).toEqual(["01", "02"]);
  });

  it("does not print the query read's failure over a measured page result", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        pageChanges: [],
        pageActions: [],
        queryWatchlist: watchlist("unavailable"),
        // The reachable asymmetric case: a page whose prior window holds 50
        // impressions is settled as not-new by the first-observed lane, while
        // the decline lane cannot ask against a window that small. Only one
        // path settled the row, so the message may only claim "at least one".
        pageAccounting: {
          evidence: "observed",
          observedRows: 1,
          previousObservedRows: 1,
          notSelectedVisibleRows: 0,
          unreadableRows: 0,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(1, 0, 0),
            page_first_observed: laneRows(0, 1, 0),
          },
        },
      }),
    );
    const card = host.querySelector("[data-change-empty]");

    // The page paths ran and found nothing. Saying comparable query/page
    // evidence is unavailable prints one dimension's failure over the other's
    // measured result.
    expect(card?.textContent).toBe(
      en.tools.dailyBriefing.review.unavailableQueryRead,
    );
  });

  it("does not say a path judged rows when it settled none of them", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        laneCapability: laneCapability({
          pageLanes: {
            page_impression_collapse: "partially_readable",
            page_click_decline: "partially_readable",
            page_first_observed: "partially_readable",
          },
        }),
        pageAccounting: {
          evidence: "observed",
          observedRows: 1,
          previousObservedRows: 1,
          notSelectedVisibleRows: 0,
          unreadableRows: 1,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(1, 0, 0),
            page_first_observed: laneRows(1, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const line = host.querySelector(
      '[data-signal-path="page-click-decline"] [data-path-outcome]',
    );

    // "This path judged the ones it could read" is false of a path whose only
    // row was unreadable.
    expect(line?.textContent).toContain(
      en.tools.dailyBriefing.evidence.paths.lanePartiallyReadableNone,
    );
    expect(line?.textContent).not.toContain(
      en.tools.dailyBriefing.evidence.paths.lanePartiallyReadable,
    );
  });

  it("shows a vanished page's counts as zero and its position as unmeasured", async () => {
    const gone = pageChange({
      kind: "page_impression_collapse",
      current: null,
      clickChange: -20,
      clickChangeRatio: -1,
      impressionChange: -400,
      impressionChangeRatio: -1,
      positionDelta: null,
      noiseFloor: {
        basis: "impressions",
        observedChange: -400,
        minimumForAction: 2 * Math.sqrt(400),
        cleared: true,
      },
    });
    const host = await renderResults(
      envelope({
        pageChanges: [gone],
        pageActions: [
          {
            kind: "page_impression_collapse",
            destination: "traffic-drop-diagnosis",
            page: PAGE_CHANGE_URL,
          },
        ],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const row = host.querySelector('[data-review-group="page"]')?.parentElement;
    const text = host.textContent ?? "";

    // Clicks are a count the complete window proves: twenty, then none.
    expect(text).toContain("20 → 0");
    // The position is not. Rendering the prior 9.1 against a fabricated 0.0
    // is the one number this lane must never print.
    expect(text).not.toContain("9.1 → 0.0");
    expect(text).toContain(`9.1 → ${en.tools.dailyBriefing.kpis.unavailable}`);
    expect(row).not.toBeNull();
  });

  it("puts the impressions a collapse is named after on its action card", async () => {
    // The page review table compares clicks and position only. Before this,
    // the action card printed the current window alone, so the prior-window
    // impressions — the single number this lane's title, threshold and name
    // all refer to — appeared nowhere on the page, and the card could not be
    // checked against the claim it made.
    const gone = pageChange({
      kind: "page_impression_collapse",
      current: null,
      clickChange: -20,
      clickChangeRatio: -1,
      impressionChange: -400,
      impressionChangeRatio: -1,
      positionDelta: null,
      noiseFloor: {
        basis: "impressions",
        observedChange: -400,
        minimumForAction: 2 * Math.sqrt(400),
        cleared: true,
      },
    });
    const host = await renderResults(
      envelope({
        pageChanges: [gone],
        pageActions: [
          pageAction({
            kind: "page_impression_collapse",
            destination: "traffic-drop-diagnosis",
          }),
        ],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const weekly = host.querySelector(
      "[data-page-action] [data-page-action-weekly]",
    );

    expect(weekly).not.toBeNull();
    expect(weekly?.textContent).toContain("400 → 0");
    expect(weekly?.textContent).toContain("20 → 0");
    // Still never a position invented for a window that measured none.
    expect(weekly?.textContent).not.toContain("9.1 → 0.0");
    expect(weekly?.textContent).toContain(
      `9.1 → ${en.tools.dailyBriefing.kpis.unavailable}`,
    );
  });

  it("refuses to print a zero average position as a rank", async () => {
    // The page-row validator accepts position >= 0 and the engine's own lanes
    // guard with > 0 before computing a delta, so a zero arrives here meaning
    // "never measured". Rendered with toFixed it became 0.0 — a rank better
    // than first, sitting in the same arrow as a measured one.
    const unmeasured = pageChange({
      current: {
        page: PAGE_CHANGE_URL,
        clicks: 8,
        impressions: 380,
        position: 0,
      },
    });
    const host = await renderResults(
      envelope({
        pageChanges: [unmeasured],
        pageActions: [pageAction()],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const text = host.textContent ?? "";

    expect(text).not.toContain("9.1 → 0.0");
    expect(text).toContain(`9.1 → ${en.tools.dailyBriefing.kpis.unavailable}`);
  });

  it("names the prior window as unobserved on a page it saw for the first time", async () => {
    const first = pageChange({
      kind: "page_first_observed",
      previous: null,
      clickChange: null,
      clickChangeRatio: null,
      impressionChange: null,
      impressionChangeRatio: null,
      positionDelta: null,
      noiseFloor: null,
    });
    const host = await renderResults(
      envelope({
        pageChanges: [first],
        pageActions: [
          pageAction({
            kind: "page_first_observed",
            destination: "on-page-seo-check",
          }),
        ],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const weekly = host.querySelector(
      "[data-page-action] [data-page-action-weekly]",
    );

    // An absent prior window is said, not printed as a zero it never measured.
    const notObserved = en.tools.dailyBriefing.changes.notObserved;
    expect(weekly?.textContent).toContain(`${notObserved} → 380`);
    expect(weekly?.textContent).not.toContain("0 → 380");
  });

  it("states the prior-window total the collapse split is counted against", async () => {
    const host = await renderResults(
      envelope({
        pageChanges: [pageChange()],
        pageActions: [pageAction()],
        pageAccounting: {
          evidence: "observed",
          observedRows: 1,
          previousObservedRows: 4,
          notSelectedVisibleRows: 0,
          unreadableRows: 0,
          byLane: {
            page_impression_collapse: laneRows(1, 1, 2),
            page_click_decline: laneRows(0, 0, 1),
            page_first_observed: laneRows(1, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const intro = host.querySelector("[data-page-previous-rows-intro]");

    // Without it the collapse split reads as an arithmetic error: its three
    // numbers add to four beside a stated total of one.
    expect(intro?.textContent).toContain("4 page records");
  });

  it("names this property's own rate on the zero-click checks", async () => {
    const host = await renderResults(
      envelope({
        pageChecks: {
          evidence: "observed",
          baseline: {
            ctr: 0.01,
            impressions: 10_000,
            clicks: 100,
            brandQueriesExcluded: 0,
          },
          blockers: [],
          items: [
            {
              page: PAGE_CHANGE_URL,
              impressions: 500,
              position: 5,
              expectedClicks: 5,
              destination: "on-page-seo-check",
            },
          ],
          examinedRows: 4,
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const block = host.querySelector("[data-page-checks]");

    expect(block?.querySelectorAll("[data-page-check-row]")).toHaveLength(1);
    // The rate is the whole claim, so it is on screen rather than implied.
    expect(block?.textContent).toContain("1.0%");
    expect(block?.textContent).toContain("500");
    expect(block?.textContent).toContain("5.0");
    // And it is named as this property's own, not as a benchmark.
    expect(block?.textContent).toContain("this property's own");
    // The gate the list applies is disclosed, so a page with volume and no
    // clicks that is missing from the list has a stated reason to be.
    expect(block?.textContent).toContain("outside the 1-10 band");
    // Named as the gate the engine applies rather than generalised into an
    // impressions floor: the branch compares expected clicks, and at another
    // property's rate the same impression count lands on either side of it.
    expect(block?.textContent).toContain("fewer than 3 clicks");
    // A page the engine excluded because it already produced a candidate may
    // never have reached the screen — the two-row page budget cuts the rest —
    // so the reason may not say the reader saw it above.
    expect(block?.textContent).toContain("the row budget never showed");
    // And rows dropped before the four reasons ever applied are outside all of
    // them, so the count has to name itself as the usable population.
    expect(block?.textContent).toContain("usable page records");
    // The button carries a page and no query. On-Page Checker runs that way;
    // what it does not do is test keyword placement or publish an overall
    // score, and the line beside the buttons says which.
    expect(
      block?.querySelector("[data-page-checks-handoff]")?.textContent,
    ).toContain("does not test keyword placement or publish an overall score");
    // And the population it read, so the list is not mistaken for the whole
    // page dimension.
    expect(
      block?.querySelector("[data-page-checks-examined]")?.textContent,
    ).toContain("4 usable page records");
  });

  it("renders a fourth change when it is the leading appearance", async () => {
    // The engine gives that lane a slot of its own. A page that reapplies the
    // three-row cap to the whole list removes exactly that row — it always
    // sorts last — and then reports that every candidate is in the table.
    const crossings = [1, 2, 3].map((index) =>
      change("average_position_crossed_page_one_band", index),
    );
    const leading = change("first_observed_leading", 4);
    const host = await renderResults(
      envelope({
        changes: [...crossings, leading],
        actions: [
          ...crossings.map((source) => action(source, "on-page-seo-check")),
          action(leading, "on-page-seo-check"),
        ],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const rows = [...host.querySelectorAll("[data-review-row]")];
    const actionRows = [...host.querySelectorAll("[data-action-row]")];

    expect(host.textContent).toContain(leading.query);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // And its action is on the page, not cut with the row.
    expect(actionRows).toHaveLength(4);
  });

  it("labels the routine items as routine and counts them", async () => {
    const host = await renderResults(
      envelope({
        pageChecks: {
          evidence: "observed",
          baseline: {
            ctr: 0.01,
            impressions: 10_000,
            clicks: 100,
            brandQueriesExcluded: 0,
          },
          blockers: [],
          items: [
            {
              page: PAGE_CHANGE_URL,
              impressions: 500,
              position: 5,
              expectedClicks: 5,
              destination: "on-page-seo-check",
            },
          ],
          examinedRows: 4,
        },
        // One from each routine population, so the count is a real sum rather
        // than one list's length wearing a total's name.
        suggestedChecks: {
          evidence: "observed",
          items: [suggestedCheck()],
          notCheckable: 0,
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const label = host.querySelector('[data-action-group="routine"]');

    // Two counts, one per population, never a sum: queries and pages measure
    // different things here as everywhere else on this page.
    expect(label?.textContent).toContain("Routine");
    expect(label?.textContent).toMatch(/1 queries/);
    expect(label?.textContent).toMatch(/1 pages/);
    expect(label?.textContent).not.toMatch(/\b2\b/);
    // And it is a separate group from the triggered ones, not a fourth one
    // in the same list.
    expect(
      [...host.querySelectorAll("[data-action-group]")].map((node) =>
        node.getAttribute("data-action-group"),
      ),
    ).toContain("routine");
  });

  it("never reads an unavailable routine population as a count of zero", async () => {
    const host = await renderResults(
      envelope({
        suggestedChecks: {
          evidence: "observed",
          items: [suggestedCheck()],
          notCheckable: 0,
        },
        // Unavailable, and by contract it carries an empty item list. Reading
        // that list's length is how "we could not look" became "we looked and
        // there were none".
        pageChecks: {
          evidence: "unavailable",
          baseline: null,
          blockers: ["brand_terms_not_confirmed"],
          items: [],
          examinedRows: null,
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const label = host.querySelector('[data-action-group="routine"]');

    expect(label?.textContent).toMatch(/1 queries/);
    expect(label?.textContent).not.toMatch(/0 pages/);
    expect(label?.textContent).toContain(en.tools.dailyBriefing.kpis.unavailable);
  });

  it("keeps the routine heading over an explanation with no items under it", async () => {
    const host = await renderResults(
      envelope({
        // No checks, only the sentence explaining rows that could not become
        // one. It is still routine work, and it still needs a heading.
        suggestedChecks: {
          evidence: "observed",
          items: [],
          notCheckable: 3,
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    const label = host.querySelector('[data-action-group="routine"]');

    expect(label).not.toBeNull();
    expect(label?.textContent).toMatch(/0 queries/);
    expect(
      host.querySelector("[data-checks-not-checkable]")?.textContent,
    ).toContain("3");
  });

  it("shows no routine label when nothing routine is offered", async () => {
    const host = await renderResults(
      envelope({
        pageChecks: {
          evidence: "unavailable",
          baseline: null,
          blockers: ["brand_terms_not_confirmed"],
          items: [],
          examinedRows: null,
        },
        queryWatchlist: watchlist("unavailable"),
      }),
    );

    expect(host.querySelector('[data-action-group="routine"]')).toBeNull();
  });

  it("shows no zero-click block when the check could not run", async () => {
    const host = await renderResults(
      envelope({
        pageChecks: {
          evidence: "unavailable",
          baseline: null,
          blockers: ["brand_terms_not_confirmed"],
          items: [],
          examinedRows: null,
        },
        queryWatchlist: watchlist("observed"),
      }),
    );

    expect(host.querySelector("[data-page-checks]")).toBeNull();
  });

  it("keeps the chart when a page lane settled nothing", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        mode: "change_detection",
        cadence: "weekly",
        laneCapability: laneCapability({
          pageLanes: {
            page_impression_collapse: "not_applicable",
            page_click_decline: "partially_readable",
            page_first_observed: "not_applicable",
          },
        }),
        pageAccounting: {
          evidence: "observed",
          observedRows: 1,
          previousObservedRows: 1,
          notSelectedVisibleRows: 0,
          unreadableRows: 1,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(1, 0, 0),
            page_first_observed: laneRows(1, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    expect(host.querySelector('[data-result-section="facts"]')).toBeNull();
    expect(host.querySelector('[data-result-section="trend"]')).not.toBeNull();
  });

  it("does not say the page paths settled anything when they settled nothing", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        pageChanges: [],
        pageActions: [],
        queryWatchlist: watchlist("unavailable"),
        // The read succeeded and its one record was unreadable. "Its paths
        // settled the records in it" would describe a run that settled none.
        pageAccounting: {
          evidence: "observed",
          observedRows: 1,
          previousObservedRows: 1,
          notSelectedVisibleRows: 0,
          unreadableRows: 1,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(1, 0, 0),
            page_first_observed: laneRows(1, 0, 0),
          },
        },
      }),
    );

    expect(host.querySelector("[data-change-empty]")?.textContent).toBe(
      en.tools.dailyBriefing.review.unavailable,
    );
  });

  it("keeps every query row inside the query boundary, page rows after it", async () => {
    const source = change("stable_position_click_decline", 1);
    const host = await renderResults(
      envelope({
        changes: [source],
        actions: [],
        pageChanges: [pageChange()],
        pageActions: [pageAction()],
        // A row on the query side that renders AFTER the page rows would have
        // under the old single mid-table heading.
        queryWatchlist: watchlist("observed", [checkableObservation()]),
      }),
    );
    const groups = [
      ...host.querySelectorAll("[data-review-row], [data-review-group]"),
    ].map(
      (row) =>
        row.getAttribute("data-review-group") ??
        (row.hasAttribute("data-page-change") ? "page-row" : "query-row"),
    );

    // A single heading in the middle left the query observation rendering
    // below it, where it reads as part of the page population.
    expect(groups[0]).toBe("query");
    expect(groups).toEqual([
      "query",
      "query-row",
      "query-row",
      "page",
      "page-row",
    ]);
  });

  it("names a page change as a whole page instead of inventing a query", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        pageChanges: [pageChange()],
        pageActions: [pageAction()],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const row = host.querySelector("[data-page-change]");

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Page clicks fell");
    expect(row?.textContent).toContain("Whole page, across every query");
    expect(row?.textContent).toContain(PAGE_CHANGE_URL);
    expect(row?.textContent).toContain("20 → 8");
    // Stated as the exact composition of the cell rather than a blocklist:
    // the queries behind a page move are anonymized, so ANY query text here
    // would be invented, and naming the ones we happen to expect would miss
    // the ones we do not.
    const queryPageCell = [...(row?.querySelectorAll('[role="cell"]') ?? [])][1];
    expect(queryPageCell?.textContent).toBe(
      `${en.tools.dailyBriefing.review.columns.queryPage}` +
        `${en.tools.dailyBriefing.review.pageScope}${PAGE_CHANGE_URL}`,
    );
  });

  it("hands a page action off with a page scope and no query", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        pageChanges: [pageChange()],
        pageActions: [pageAction()],
        queryWatchlist: watchlist("observed"),
      }),
    );
    const row = host.querySelector<HTMLElement>(
      "[data-action-row][data-page-action]",
    );
    const link = row?.querySelector<HTMLAnchorElement>("[data-action-link]");
    expect(row?.getAttribute("data-action-rank")).toBe("1");
    expect(row?.textContent).toContain("Diagnose this page's click decline");
    expect(link?.getAttribute("href")).toBe("/tools/traffic-drop-diagnosis");
    expect(link?.getAttribute("href")).not.toContain(PAGE_CHANGE_URL);

    link?.addEventListener("click", (event) => event.preventDefault());
    await click(link!);

    expect(writeToolHandoffMock).toHaveBeenCalledOnce();
    expect(writeToolHandoffMock.mock.calls[0]?.[2]).toEqual({
      source: "daily-search-briefing",
      destination: "traffic-drop-diagnosis",
      scope: "page",
      property: PROPERTY,
      query: null,
      page: PAGE_CHANGE_URL,
      evidenceId: "daily:page:page_click_decline",
    });
  });

  it("offers checks under the empty action panel instead of leaving it alone", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        // Two shown rows, one of which became a check. The count below then
        // describes the other one instead of restating the fixture.
        queryWatchlist: watchlist("observed", [
          checkableObservation(),
          checkableObservation({
            query: "buried term",
            band: "far",
            page: "https://example.com/buried",
          }),
        ]),
        suggestedChecks: {
          evidence: "observed",
          items: [suggestedCheck()],
          notCheckable: 1,
        },
      }),
    );
    const empty = host.querySelector("[data-action-empty]");
    const checks = host.querySelector("[data-suggested-checks]");

    // Both, not one or the other. The empty panel is still true — no strict
    // evidence backs an action — and it is no longer the last word on a page
    // that just listed a row worth opening.
    expect(empty).not.toBeNull();
    expect(checks).not.toBeNull();
    // Scoped to the query, so a page-level finding on the same URL does not
    // read as contradicted by it.
    expect(checks?.textContent).toContain("No query-level change known");
    // Carried by the per-row label now that the section opens straight into
    // the rows: a check states where a query sits and claims no change.
    expect(checks?.textContent).toContain(
      "Where this query currently sits, not evidence of change",
    );
    expect(checks?.textContent).toContain(CHECK_QUERY);
    expect(checks?.textContent).toContain(CHECK_PAGE);
    expect(
      host.querySelector("[data-checks-not-checkable]")?.textContent,
    ).toContain("Another 1 shown rows carry no check");
    // A check is never counted as an action, here or downstream.
    expect(host.querySelectorAll("[data-action-row]")).toHaveLength(0);
  });

  it("marks a check handoff as a check rather than an action index", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        queryWatchlist: watchlist("observed", [checkableObservation()]),
        suggestedChecks: {
          evidence: "observed",
          items: [suggestedCheck()],
          notCheckable: 0,
        },
      }),
    );
    const link = host.querySelector<HTMLAnchorElement>("[data-check-link]");

    expect(link?.getAttribute("href")).toBe("/tools/on-page-seo-check");
    link?.addEventListener("click", (event) => event.preventDefault());
    await click(link!);

    expect(writeToolHandoffMock.mock.calls[0]?.[2]).toEqual({
      source: "daily-search-briefing",
      destination: "on-page-seo-check",
      scope: "query_page",
      property: PROPERTY,
      query: CHECK_QUERY,
      page: CHECK_PAGE,
      evidenceId: "daily:check:sample_floor_reached",
    });
  });

  it("keeps the chart when a page click lane ran", async () => {
    const host = await renderResults(
      envelope({
        mode: "change_detection",
        cadence: "weekly",
        changes: [],
        actions: [],
        laneCapability: laneCapability({
          pageLanes: {
            page_impression_collapse: "not_applicable",
            page_click_decline: "evaluated",
            page_first_observed: "not_applicable",
          },
        }),
        // The accounting has to agree with the state: a lane that settled no
        // row has not evaluated a click lane, whatever its state string says.
        pageAccounting: {
          evidence: "observed",
          observedRows: 4,
          previousObservedRows: 4,
          notSelectedVisibleRows: 0,
          unreadableRows: 0,
          byLane: {
            page_impression_collapse: laneRows(0, 0, 0),
            page_click_decline: laneRows(0, 4, 0),
            page_first_observed: laneRows(4, 0, 0),
          },
        },
        queryWatchlist: watchlist("observed"),
      }),
    );
    expect(host.querySelector('[data-result-section="facts"]')).toBeNull();
    expect(host.querySelector('[data-result-section="trend"]')).not.toBeNull();
  });

  it("still explains the gap when every shown row failed to become a check", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        queryWatchlist: watchlist("observed", [
          checkableObservation({ page: null, pageEvidence: "unavailable" }),
        ]),
        suggestedChecks: {
          evidence: "observed",
          items: [],
          notCheckable: 1,
        },
      }),
    );

    // The row is on screen and carries no check. Gating the whole panel on
    // having checks hid the one sentence that explains why.
    expect(
      host.querySelector("[data-checks-not-checkable]")?.textContent,
    ).toContain("Another 1 shown rows carry no check");
    expect(host.querySelector("[data-check-row]")).toBeNull();
  });

  it("says nothing about a gap it never measured", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        queryWatchlist: watchlist("partial"),
        suggestedChecks: {
          evidence: "partial",
          items: [],
          notCheckable: null,
        },
      }),
    );

    // null is not zero. "No shown row failed to become a check" would be a
    // finding about rows this run never displayed.
    expect(host.querySelector("[data-suggested-checks]")).toBeNull();
    expect(host.querySelector("[data-checks-not-checkable]")).toBeNull();
  });

  it("says nothing about checks when none could be offered", async () => {
    const host = await renderResults(
      envelope({
        changes: [],
        actions: [],
        queryWatchlist: watchlist("observed"),
        suggestedChecks: {
          evidence: "observed",
          items: [],
          notCheckable: 0,
        },
      }),
    );

    expect(host.querySelector("[data-suggested-checks]")).toBeNull();
    expect(host.querySelector("[data-action-empty]")).not.toBeNull();
  });
});
