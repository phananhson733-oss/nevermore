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
    page: source.page,
  };
}

function envelope(
  overrides: Partial<DailyBriefingEnvelope["result"]> = {},
): DailyBriefingEnvelope {
  return {
    ...BASE_ENVELOPE,
    result: { ...BASE_ENVELOPE.result, ...overrides },
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
  report: DailyBriefingEnvelope = BASE_ENVELOPE,
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
  it("puts the noise summary and decision sections directly after KPIs", async () => {
    const host = await renderResults(
      envelope({
        filteredObservedRows: 17,
        countComplete: true,
      }),
    );
    const order = [...host.querySelectorAll("[data-result-section]")].map(
      (node) => node.getAttribute("data-result-section"),
    );
    const noise = host.querySelector('[data-result-section="noise"]');

    expect(order).toEqual([
      "facts",
      "kpis",
      "noise",
      "changes",
      "actions",
      "manual",
      "evidence",
      "limitations",
      "methodology",
    ]);
    expect(noise?.textContent).toContain("Noise filter on");
    expect(noise?.textContent).toContain("17 observed query rows");
    expect(noise?.textContent).toContain("0 changes cleared the threshold");
  });

  it("reports the number of changes actually shown after the three-row cap", async () => {
    const host = await renderResults(
      envelope({
        countComplete: true,
        changes: [
          change("click_opportunity", 1),
          change("stable_position_click_decline", 2),
          change("first_observed", 3),
          change("first_observed", 4),
        ],
      }),
    );
    const noise = host.querySelector('[data-result-section="noise"]');

    expect(host.querySelectorAll("[data-change]")).toHaveLength(3);
    expect(noise?.textContent).toContain("3 changes cleared the threshold");
    expect(noise?.textContent).not.toContain("4 changes cleared the threshold");
  });

  it("renders four metric cards with latest-day and seven-day values", async () => {
    const host = await renderResults();
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
        filteredObservedRows: 17,
        countComplete: false,
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
    expect(noise?.textContent).toContain("17 rows in the observed prefix");
    expect(noise?.textContent).toContain("observed prefix");
    expect(noise?.textContent).toContain("not property-wide");
    expect(noise?.textContent).toContain(
      "0 changes cleared the available evidence gates",
    );
    expect(host.textContent).toContain(
      "Comparable query-to-page coverage is unavailable",
    );
    expect(host.textContent).toContain("withheld share is unavailable");
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

    expect(table).not.toBeNull();
    expect(
      [...host.querySelectorAll('[role="columnheader"]')].map((cell) =>
        cell.textContent?.trim(),
      ),
    ).toEqual([
      "Change",
      "Query / Page",
      "Clicks",
      "Position",
      "Interpretation",
    ]);
    expect(rows).toHaveLength(3);
    expect(table?.querySelectorAll('[role="row"]')).toHaveLength(4);
    for (const row of rows) {
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
    const host = await renderResults(envelope({ changes: [] }));
    const section = host.querySelector('[data-result-section="changes"]');
    const empty = section?.querySelector("[data-change-empty]");

    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain(
      "No change cleared the evidence floor in this run",
    );
    expect(section?.querySelector('[role="table"]')).toBeNull();
    expect(section?.querySelector("[data-change]")).toBeNull();
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
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-action-link]")];

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tools/seo-quick-wins",
      "/tools/traffic-drop-diagnosis",
      "/tools/on-page-seo-check",
    ]);
    expect(host.innerHTML).not.toContain("no%20matching%20change");
    expect(host.innerHTML).not.toContain("private.example");
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
      readonly evidenceId: string;
      readonly query: string;
      readonly page: string;
    };
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
