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
  type DailyBriefingLimitationCode,
  type DailyBriefingPropertyTrend,
  type DailyBriefingQueryObservation,
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
    pageAttributionWithheld: 0,
    selectedQueryChanges: 0,
    propertyTrendShown: false,
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
    expect(noise?.textContent).toContain("17 visible queries");
    expect(noise?.textContent).toContain("2 reached the evaluation sample floor");
    expect(noise?.textContent).toContain("0 strict query/page changes");
    expect(noise?.textContent).toContain("0 observations are shown");
    expect(noise?.textContent).toContain("0 site-wide trends are shown");
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
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');

    expect(host.querySelectorAll("[data-change]")).toHaveLength(3);
    expect(noise?.textContent).toContain("3 strict query/page changes");
    expect(noise?.textContent).not.toContain("4 strict query/page changes");
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
        propertyTrend: propertyTrend(),
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');
    const funnel = host.querySelector("[data-signal-funnel]");

    expect(noise?.textContent).toContain(
      "540 visible queries: 2 reached the evaluation sample floor; 0 strict query/page changes were selected; 0 observations are shown; 1 site-wide trend is shown",
    );
    expect(noise?.textContent).toContain("18 queries had 50–99 impressions");
    expect(noise?.textContent).toContain("observation-only");
    expect(noise?.textContent).toContain("cannot trigger an action");
    expect(funnel?.textContent).toContain("Independent signal paths");
    expect(funnel?.textContent).toContain("not additive");
    expect(funnel?.textContent).toContain("CTR baseline");
    expect(funnel?.textContent).toContain("Not evaluated");
    expect(funnel?.querySelectorAll("[data-signal-lane]")).toHaveLength(7);
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
    const funnel = host.querySelector("[data-signal-funnel]");

    expect(noise?.textContent).toContain("Visible-query signal funnel unavailable");
    expect(noise?.textContent).toContain("no zeroes were inferred");
    expect(noise?.textContent).not.toContain("null");
    expect(noise?.textContent).not.toMatch(/\b0\b/);
    expect(funnel?.textContent).not.toContain("null");
    expect(funnel?.textContent).not.toMatch(/\b0\b/);
    expect(funnel?.querySelectorAll("[data-signal-lane]")).toHaveLength(7);
  });

  it("reports independent signal lanes without implying they add up", async () => {
    const host = await renderResults(
      envelope({
        signalFunnel: signalFunnel({
          ctrBaselineRows: 1,
          clickOpportunityCandidates: 2,
          stableDeclineCandidates: 3,
          pageOneBandCandidates: 3,
          positionDeclineCandidates: 3,
          firstObservedCandidates: 4,
          pageAttributionWithheld: 5,
        }),
      }),
    );
    const funnel = host.querySelector("[data-signal-funnel]");

    expect(funnel?.textContent).toContain("These lanes are independent");
    expect(funnel?.textContent).toContain("do not add the counts together");
    expect(
      funnel?.querySelector('[data-signal-lane="ctr-baseline"]')?.textContent,
    ).toContain("1");
    expect(
      funnel?.querySelector('[data-signal-lane="click-opportunity"]')
        ?.textContent,
    ).toContain("2");
    expect(
      funnel?.querySelector('[data-signal-lane="stable-decline"]')?.textContent,
    ).toContain("3");
    expect(
      funnel?.querySelector('[data-signal-lane="first-observed"]')?.textContent,
    ).toContain("4");
    expect(
      funnel?.querySelector('[data-signal-lane="page-attribution"]')
        ?.textContent,
    ).toContain("5");
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
  ];

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
        queryWatchlist: { evidence: "observed", items: [watch] },
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
        queryWatchlist: { evidence: "observed", items: [watch] },
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
      host.querySelector('[data-result-section="noise"]')?.textContent,
    ).toContain("1 site-wide trend is shown");
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
        queryWatchlist: { evidence: "observed", items: [] },
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
        queryWatchlist: {
          evidence: "partial",
          items: [observation("sample_floor_reached", 99)],
        },
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
        queryWatchlist: { evidence: "unavailable", items: [] },
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
      "No automated handoff is justified by the evidence available in this run",
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
