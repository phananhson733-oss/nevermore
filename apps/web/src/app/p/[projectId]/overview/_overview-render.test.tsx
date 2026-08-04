/**
 * The Overview screen's customer contract is almost entirely *which branch it
 * renders*: a failed read must not be reported as a missing audit, a lens with
 * no coverage must not be reported as zero, and an observation must not consume
 * a decision slot. None of that is reachable from the pure view-model, so these
 * tests drive the real client component through `react-dom/server` with only
 * the data hooks stubbed.
 *
 * Every stub is shaped like a settled TanStack Query result. Assertions are
 * anchored on `data-*` attributes and on the shipped English copy, never on CSS
 * module class names, whose hashes change with any edit to the stylesheet.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { getMessages } from "@sf/i18n";
import { NextIntlClientProvider } from "next-intl";
import {
  CONTENT_DECAY_LIMITATIONS,
  CONTENT_DECAY_MIN_PREVIOUS_CLICKS,
} from "@sf/engine";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  useWorkspaceView: vi.fn(),
  useProductProfile: vi.fn(),
  useGrowthMapUrls: vi.fn(),
  useGrowthMapUrlDetail: vi.fn(),
  useProjectSources: vi.fn(),
  useProjectGrowthAudit: vi.fn(),
  useCreateGrowthAuditRun: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceView: mocks.useWorkspaceView,
  useProductProfile: mocks.useProductProfile,
}));
vi.mock("@/lib/api/hooks-growth-map", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGrowthMapUrls: mocks.useGrowthMapUrls,
  useGrowthMapUrlDetail: mocks.useGrowthMapUrlDetail,
}));
vi.mock("@/lib/api/hooks-sources", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectSources: mocks.useProjectSources,
}));
vi.mock("@/lib/api/hooks-audit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectGrowthAudit: mocks.useProjectGrowthAudit,
  useCreateGrowthAuditRun: mocks.useCreateGrowthAuditRun,
}));

const { OverviewClient } = await import("./_overview.tsx");

const PROJECT_ID = "00000000-0000-4000-8000-000000000700";
const RUN_ID = "00000000-0000-4000-8000-000000000701";
const SITE_PAGE_ID = "00000000-0000-4000-8000-000000000703";
const FINDING_ID = "00000000-0000-4000-8000-000000000705";
const TOP_TITLE = "The product page points to the wrong canonical URL.";

const COPY = {
  queueLoadFailed: "The work items could not be read this time.",
  queueUnavailable:
    "The work queue is unavailable until a frozen audit can be identified.",
  contentHealth: "Content health signals",
  contentHealthNote: "they do not take one of the three decision slots above",
  limitationsTitle: "Why this coverage is incomplete",
  lensLoading: "Loading the project-wide opportunity mix…",
  lensError: "The project-wide opportunity mix could not be loaded.",
  lensNoData: "The current frozen audit has no Opportunity to classify.",
  toReview: "Customer decisions, one by one",
  healthLimitationsTitle: "How these signals are decided",
} as const;

/* ------------------------------------------------------------------ stubs */

interface QueryStub {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly isFetching: boolean;
  readonly data: unknown;
  readonly error: unknown;
  readonly refetch: () => void;
}

function settled(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    data: undefined,
    error: null,
    refetch: () => undefined,
    ...overrides,
  };
}

function loadingQuery(): QueryStub {
  return settled({ isPending: true, isSuccess: false });
}

function failedQuery(error: unknown): QueryStub {
  return settled({ isError: true, isSuccess: false, error });
}

function apiError(status: number, code: string): ApiError {
  return new ApiError({
    type: "about:blank",
    title: "Problem",
    status,
    code,
    detail: "Mocked problem response.",
    requestId: "00000000-0000-4000-8000-0000000000ff",
  });
}

/* --------------------------------------------------------------- fixtures */

function portfolioItem(overrides: Record<string, unknown> = {}) {
  return {
    sitePageId: SITE_PAGE_ID,
    normalizedUrl: "https://example.test/product",
    title: "RelayOps product",
    findingIds: [FINDING_ID],
    reviewableFindingIds: [FINDING_ID],
    priority: { availability: "available", value: "high" },
    delta: { availability: "unavailable", value: null },
    coverage: { availability: "available", limitations: [] },
    ...overrides,
  };
}

function portfolio(
  input: {
    readonly items?: readonly unknown[];
    readonly coverage?: string;
    readonly limitations?: readonly string[];
  } = {},
) {
  return {
    diagnosticRunId: RUN_ID,
    data: input.items ?? [portfolioItem()],
    meta: {
      hasNext: false,
      coverage: {
        availability: input.coverage ?? "available",
        limitations: input.limitations ?? [],
      },
    },
  };
}

function detail(item: Record<string, unknown> = portfolioItem()) {
  return {
    diagnosticRunId: RUN_ID,
    data: {
      ...item,
      diagnosticRunId: RUN_ID,
      findings: [
        {
          findingId: FINDING_ID,
          diagnosticRunId: RUN_ID,
          ruleId: "TECH-CANONICAL-002",
          title: TOP_TITLE,
          severity: "high",
          reviewState: "unreviewed",
          active: true,
        },
      ],
    },
  };
}

function reminder(index: number, findingId?: string) {
  return {
    findingId: findingId ?? `00000000-0000-4000-8000-00000000080${index}`,
    sitePageId: SITE_PAGE_ID,
    summary: `Stale decision ${index}`,
    summaryLocale: "en",
    staleForDays: 12 + index,
  };
}

function action(index: number) {
  return {
    id: `00000000-0000-4000-8000-00000000090${index}`,
    status: "planned",
    title: `Project work ${index}`,
  };
}

function decayAlert(index: number) {
  return {
    sitePageId: `00000000-0000-4000-8000-00000000091${index}`,
    normalizedUrl: `https://example.test/decayed-${index}`,
    currentMonth: "2026-06",
    triggers: ["traffic_decline"],
    rankTrend: null,
    trafficTrend: {
      previousMonth: "2026-05",
      currentMonth: "2026-06",
      previousClicks: 500,
      currentClicks: 350,
      changeRatio: -0.3,
    },
  };
}

function workspace(
  input: {
    readonly topActions?: readonly unknown[];
    readonly decisionReminders?: readonly unknown[];
    readonly contentDecayAlerts?: readonly unknown[];
    readonly contentDecayLimitations?: readonly string[];
  } = {},
) {
  return {
    project: { projectName: "E2E Critical Flow" },
    frozenDiagnosticRunId: RUN_ID,
    topActions: input.topActions ?? [],
    decisionReminders: input.decisionReminders ?? [],
    contentDecayMonitor: {
      alerts: input.contentDecayAlerts ?? [],
      // The DTO always carries limitations; an empty array is the honest
      // default so a fixture never implies the engine disclosed nothing.
      limitations: input.contentDecayLimitations ?? [],
    },
  };
}

function lens(lensId: string, coverageState: string, findingCount: number) {
  return { lensId, coverageState, findingCount, evidenceCount: 3 };
}

const COMPLETE_LENSES = [
  lens("site_health", "available", 4),
  lens("search_ai_visibility", "available", 3),
  lens("demand_competition", "available", 1),
];

/* ----------------------------------------------------------------- render */

interface Scenario {
  readonly workspaceQuery?: QueryStub;
  readonly portfolioQuery?: QueryStub;
  readonly detailQuery?: QueryStub;
  readonly auditQuery?: QueryStub;
}

function render(scenario: Scenario = {}): string {
  mocks.useWorkspaceView.mockReturnValue(
    scenario.workspaceQuery ?? settled({ data: workspace() }),
  );
  mocks.useGrowthMapUrls.mockReturnValue(
    scenario.portfolioQuery ?? settled({ data: portfolio() }),
  );
  mocks.useGrowthMapUrlDetail.mockReturnValue(
    scenario.detailQuery ?? settled({ data: detail() }),
  );
  mocks.useProjectGrowthAudit.mockReturnValue(
    scenario.auditQuery ?? settled({ data: { lenses: COMPLETE_LENSES } }),
  );
  mocks.useProjectSources.mockReturnValue(settled({ data: [] }));
  mocks.useProductProfile.mockReturnValue(settled({ data: {} }));
  mocks.useCreateGrowthAuditRun.mockReturnValue({
    mutate: () => undefined,
    isPending: false,
    isSuccess: false,
    isError: false,
  });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <OverviewClient projectId={PROJECT_ID} />
    </NextIntlClientProvider>,
  );
}

/** The one `<section>` carrying a marker; Overview never nests sections. */
function sectionWith(html: string, marker: string): string {
  const chunk = html.split("<section ").find((part) => part.includes(marker));
  if (chunk === undefined) {
    throw new Error(`No Overview <section> contains ${marker}`);
  }
  return chunk.slice(0, chunk.indexOf("</section>"));
}

function lensRow(html: string, lensId: string): string {
  const start = html.indexOf(`data-lens="${lensId}"`);
  if (start < 0) throw new Error(`No lens row rendered for ${lensId}`);
  return html.slice(start, html.indexOf("</div>", start));
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function priorityCard(html: string): string {
  return sectionWith(html, ">PRIORITY<");
}

function portfolioCard(html: string): string {
  return sectionWith(html, ">URL PORTFOLIO<");
}

/* ------------------------------------------------------------------ tests */

describe("Overview decision list", () => {
  it("caps the list at three rows no matter how much work is pending", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            decisionReminders: [reminder(1), reminder(2), reminder(3)],
            topActions: [action(1), action(2), action(3), action(4)],
          }),
        }),
      }),
    );

    expect(countOf(html, "data-decision-kind=")).toBe(3);
    expect(html).toContain('data-decision-kind="opportunity"');
    expect(html).toContain(TOP_TITLE);
    expect(html).toContain("Stale decision 1");
    expect(html).toContain("Stale decision 2");
    expect(html).not.toContain("Stale decision 3");
    expect(html).not.toContain("Project work 1");
    expect(countOf(html, ">01<")).toBe(1);
    expect(countOf(html, ">03<")).toBe(1);
    expect(html).not.toContain(">04<");
  });

  it("keeps content-decay warnings out of the three decision slots", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            decisionReminders: [reminder(1), reminder(2)],
            contentDecayAlerts: [decayAlert(1), decayAlert(2), decayAlert(3)],
          }),
        }),
      }),
    );

    expect(countOf(html, "data-decision-kind=")).toBe(3);
    expect(countOf(html, "data-content-decay-alert")).toBe(3);
    expect(html).toContain(COPY.contentHealth);
    expect(html).toContain(COPY.contentHealthNote);
    expect(html).toContain("Stale decision 1");
    expect(html).toContain("Stale decision 2");
    // Every warning survives the cap, and all of them sit below the decisions.
    expect(html.indexOf("data-content-decay-alert")).toBeGreaterThan(
      html.lastIndexOf("data-decision-kind="),
    );
  });

  it("carries the click sample beside the decay percentage", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({ contentDecayAlerts: [decayAlert(1)] }),
        }),
      }),
    );

    expect(html).toContain(
      "latest 28-day clicks fell from 500 to 350, down 30% month over month",
    );
  });

  it("renders no content-health block when nothing decayed", () => {
    const html = priorityCard(render());

    expect(html).not.toContain(COPY.contentHealth);
    expect(html).not.toContain("data-content-decay-alert");
  });

  it("lists a Finding once when it is both top Opportunity and stale decision", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            decisionReminders: [reminder(1, FINDING_ID), reminder(2)],
            topActions: [action(1)],
          }),
        }),
      }),
    );

    expect(countOf(html, "data-decision-kind=")).toBe(3);
    expect(html).not.toContain("Stale decision 1");
    expect(html).toContain("Stale decision 2");
    expect(html).toContain("Project work 1");
  });
});

describe("Overview work-run notice", () => {
  it("reports a failed portfolio read as retryable, never as a missing audit", () => {
    const html = priorityCard(
      render({
        portfolioQuery: failedQuery(apiError(503, "DEPENDENCY_UNAVAILABLE")),
      }),
    );

    expect(html).toContain(COPY.queueLoadFailed);
    expect(html).not.toContain(COPY.queueUnavailable);
  });

  it("claims a missing frozen audit only when the audit itself is absent", () => {
    const html = priorityCard(
      render({
        portfolioQuery: failedQuery(
          apiError(404, "GROWTH_MAP_AUDIT_NOT_FOUND"),
        ),
      }),
    );

    expect(html).toContain(COPY.queueUnavailable);
    expect(html).not.toContain(COPY.queueLoadFailed);
  });

  it("offers exactly one recovery for one failed read", () => {
    const html = priorityCard(
      render({
        portfolioQuery: failedQuery(apiError(503, "DEPENDENCY_UNAVAILABLE")),
      }),
    );

    expect(countOf(html, ">Retry<")).toBe(1);
  });
});

describe("Overview coverage limitations", () => {
  const LIMITATIONS = [
    "Additional URLs exist beyond this bounded page.",
    "GA4 has no canonical snapshot for this URL.",
  ] as const;

  it("names every reason behind a degraded coverage grade", () => {
    const html = portfolioCard(
      render({
        portfolioQuery: settled({
          data: portfolio({ coverage: "partial", limitations: LIMITATIONS }),
        }),
      }),
    );

    expect(html).toContain("Partial coverage");
    expect(html).toContain(COPY.limitationsTitle);
    for (const limitation of LIMITATIONS) expect(html).toContain(limitation);
  });

  it("keeps the reasons outside the four-metric definition list", () => {
    const html = portfolioCard(
      render({
        portfolioQuery: settled({
          data: portfolio({ coverage: "partial", limitations: LIMITATIONS }),
        }),
      }),
    );

    expect(html.indexOf(COPY.limitationsTitle)).toBeGreaterThan(
      html.indexOf("</dl>"),
    );
    expect(countOf(html, "<dt>")).toBe(4);
  });

  it("renders no reason list when coverage carries no limitation", () => {
    const html = portfolioCard(render());

    expect(html).toContain("Coverage available");
    expect(html).not.toContain(COPY.limitationsTitle);
  });
});

describe("Overview project-wide opportunity mix", () => {
  it("separates the whole-project scope from the loaded-page stats", () => {
    const html = portfolioCard(render());

    expect(html).toContain("Loaded page only");
    expect(html).toContain("Project-wide opportunity mix");
    expect(html).toContain("Counts the whole project, not only the loaded page");
    expect(html.indexOf("Loaded page only")).toBeLessThan(
      html.indexOf("Project-wide opportunity mix"),
    );
  });

  it("shows a terminating loading state without any count", () => {
    const html = portfolioCard(render({ auditQuery: loadingQuery() }));

    expect(html).toContain(COPY.lensLoading);
    expect(html).not.toContain("data-lens=");
    expect(html).not.toContain(COPY.lensError);
    expect(html).not.toContain(COPY.lensNoData);
  });

  it("shows a retryable error state for a failed audit read", () => {
    const html = portfolioCard(
      render({
        auditQuery: failedQuery(apiError(503, "DEPENDENCY_UNAVAILABLE")),
      }),
    );

    expect(html).toContain(COPY.lensError);
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("data-lens=");
    expect(html).not.toContain(COPY.lensNoData);
  });

  it("treats a never-run audit as no_data instead of a failure", () => {
    const html = portfolioCard(
      render({ auditQuery: failedQuery(apiError(404, "NOT_FOUND")) }),
    );

    expect(html).toContain(COPY.lensNoData);
    expect(html).not.toContain(COPY.lensError);
    expect(html).not.toContain("data-lens=");
  });

  it("renders an uncovered lens as a dash and never as zero", () => {
    const html = portfolioCard(
      render({
        auditQuery: settled({
          data: {
            lenses: [
              lens("site_health", "available", 4),
              lens("search_ai_visibility", "available", 3),
              lens("demand_competition", "no_data", 0),
            ],
          },
        }),
      }),
    );
    const uncovered = lensRow(html, "demand_competition");

    expect(uncovered).toContain('data-coverage="no_data"');
    expect(uncovered).toContain("—");
    expect(uncovered).not.toMatch(/<strong[^>]*>\s*\d/u);
    expect(uncovered).toContain('title="Unavailable"');
  });

  it("withholds the project total when any lens count is unknown", () => {
    const html = portfolioCard(
      render({
        auditQuery: settled({
          data: {
            lenses: [
              lens("site_health", "available", 4),
              lens("search_ai_visibility", "available", 3),
              lens("demand_competition", "no_data", 0),
            ],
          },
        }),
      }),
    );

    expect(html).not.toContain("in total");
    expect(html).toContain('title="Unavailable"');
  });

  it("states the project total once every lens count is known", () => {
    const html = portfolioCard(render());

    expect(html).toContain("8 Opportunities in total");
    expect(lensRow(html, "site_health")).toContain("<strong>4</strong>");
    expect(lensRow(html, "search_ai_visibility")).toContain(
      "<strong>3</strong>",
    );
    expect(lensRow(html, "demand_competition")).toContain("<strong>1</strong>");
  });

  it("keeps a covered zero as a real zero", () => {
    const html = portfolioCard(
      render({
        auditQuery: settled({
          data: {
            lenses: [
              lens("site_health", "available", 0),
              lens("search_ai_visibility", "available", 0),
              lens("demand_competition", "available", 0),
            ],
          },
        }),
      }),
    );

    expect(lensRow(html, "site_health")).toContain("<strong>0</strong>");
    expect(html).toContain("0 Opportunities in total");
  });
});

describe("Overview review entry point", () => {
  it("links the to-review description to a concrete Finding", () => {
    const html = portfolioCard(render());
    const cell = html.slice(
      html.indexOf("Findings to review"),
      html.indexOf("</dl>"),
    );

    expect(cell).toMatch(
      new RegExp(
        `<small><a[^>]*href="[^"]*selectedSitePageId=${SITE_PAGE_ID}&amp;findingId=${FINDING_ID}"`,
        "u",
      ),
    );
    expect(cell).toContain(COPY.toReview);
  });

  it("drops the link when the loaded page has nothing left to review", () => {
    const html = portfolioCard(
      render({
        portfolioQuery: settled({
          data: portfolio({
            items: [portfolioItem({ reviewableFindingIds: [] })],
          }),
        }),
      }),
    );
    const cell = html.slice(
      html.indexOf("Findings to review"),
      html.indexOf("</dl>"),
    );

    expect(cell).toContain(COPY.toReview);
    expect(cell).not.toContain("<a");
    expect(cell).not.toContain("findingId=");
  });
});

describe("Overview content-health limitations", () => {
  it("discloses the click floor that decides whether a warning is shown", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            contentDecayAlerts: [decayAlert(0)],
            contentDecayLimitations: [CONTENT_DECAY_LIMITATIONS.minimumSample],
          }),
        }),
      }),
    );

    expect(html).toContain(COPY.healthLimitationsTitle);
    // The threshold reaches the customer as a number, not as prose only the
    // engine can see. English copy intentionally matches the engine wording,
    // so the proof that this went through i18n rather than the raw sentence
    // is the zh-CN assertion in e2e/overview-read-model.mock.spec.ts.
    expect(html).toContain(String(CONTENT_DECAY_MIN_PREVIOUS_CLICKS));
    expect(html).toContain("</summary>");
  });

  it("renders limitation wording it does not own verbatim", () => {
    const foreign = "A provider caveat the Overview never authored.";
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            contentDecayAlerts: [decayAlert(0)],
            contentDecayLimitations: [foreign],
          }),
        }),
      }),
    );

    expect(html).toContain(foreign);
  });

  it("renders no disclosure when the engine reported no limitation", () => {
    const html = priorityCard(
      render({
        workspaceQuery: settled({
          data: workspace({
            contentDecayAlerts: [decayAlert(0)],
            contentDecayLimitations: [],
          }),
        }),
      }),
    );

    expect(html).not.toContain(COPY.healthLimitationsTitle);
  });
});
