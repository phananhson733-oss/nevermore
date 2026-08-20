// @vitest-environment jsdom
// @input  -- selected evaluated checks plus the joined neutral audit ledger
// @output -- exact, deduplicated affected observations shared by Stage 02 and Stage 04
// @pos    -- regression guard for URL-level evidence truth and bounded disclosure

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SeoAuditEvidenceValue,
  SeoAuditRecord,
} from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import type {
  AgentAuditCheckView,
  AgentAuditScopeView,
  AgentAuditViewModel,
} from "./agent-audit-model";
import { AgentDiagnosis } from "./agent-diagnosis";
import {
  AgentEvidenceDetails,
  agentAffectedObservations,
} from "./agent-evidence-details";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentRecommendations } from "./agent-recommendations";
import { rankAgentRecommendations } from "./agent-result-helpers";

const TARGET_URL = "https://example.com/target";

function record(
  id: string,
  observations: SeoAuditRecord["observations"],
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: observations.length > 0 ? "observed" : "not_observed",
    unit: "pages",
    population: "every_collected_page",
    targetTested: null,
    tested: 12,
    affected: observations.length,
    observations,
    limitation: null,
  };
}

function observation(
  url: string | null,
  label: string,
  value: SeoAuditEvidenceValue,
): SeoAuditRecord["observations"][number] {
  return { url, values: [{ label, value }] };
}

function evaluatedCheck({
  id = "2.3",
  scope = "site",
  evidenceRecordIds,
  truth = "observed",
}: {
  readonly id?: string;
  readonly scope?: "site" | "page";
  readonly evidenceRecordIds: readonly string[];
  readonly truth?: AgentAuditEvaluatedCheck["truth"];
}): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope,
      groupId: id.split(".")[0] ?? id,
      title: { en: "Target query in title", zh: "Title 包含目标词" },
      impact: {
        en: "This condition changes how the page is understood.",
        zh: "该状态会影响页面理解。",
      },
      howToFix: {
        en: "Review the affected page or its shared template.",
        zh: "检查受影响页面或其共享模板。",
      },
      threshold: { en: "Reviewed rule", zh: "审阅规则" },
      thresholdAuthority: "industry",
      dataSource: { en: "Public static HTML", zh: "公开静态 HTML" },
      scoreWeight: 1,
      scored: true,
      blocking: false,
      inventoryReady: true,
      primaryAgent: "seo",
      evidenceRecordIds,
    },
    result: evidenceRecordIds.length > 0 ? "warning" : "excluded",
    engine: evidenceRecordIds.length > 0 ? "ready" : "not-integrated",
    truth,
    measurement:
      evidenceRecordIds.length > 0
        ? { en: "Observed", zh: "已观测" }
        : null,
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

function checkView(): AgentAuditCheckView {
  return {
    id: "2.3",
    title: "Target query in title",
    result: "warning",
    engine: "ready",
    truth: "observed",
    measurement: "Observed",
    threshold: "Reviewed rule",
    thresholdAuthority: "industry",
    scoreWeight: 1,
    scored: true,
    blocking: false,
    impact: "This condition changes how the page is understood.",
    howToFix: "Review the affected page or its shared template.",
    dataSource: "Public static HTML",
    scoreContribution: 0,
    boundary: "Bounded crawl only.",
  };
}

function scopeView(checks: readonly AgentAuditCheckView[]): AgentAuditScopeView {
  return {
    total: checks.length,
    evaluated: checks.length,
    excluded: 0,
    blockers: 0,
    health: checks.length > 0 ? 80 : null,
    healthDimmed: false,
    enginesReady: checks.length,
    inventoryReady: checks.length,
    groups:
      checks.length === 0
        ? []
        : [
            {
              id: "2",
              title: "Search presentation",
              total: checks.length,
              evaluated: checks.length,
              checks,
            },
          ],
  };
}

function diagnosisModel(
  check: AgentAuditEvaluatedCheck,
): AgentAuditViewModel {
  const view = checkView();
  return {
    agent: "seo",
    locale: "en",
    context: {
      reviewState: "confirmed",
      productName: "Example",
      primaryIcp: "Search visitors",
      country: "US",
      locale: "en-US",
      device: "desktop",
      pageType: "homepage",
      targetQuery: "example query",
      auditScope: "site-first",
    },
    defaults: { siteGroupId: "2", pageGroupId: "page" },
    scopes: { site: scopeView([view]), page: scopeView([]) },
    headingPreset: {
      pageType: "homepage",
      h2: { min: 3, max: 8 },
      h3: { min: 0, max: 12 },
      substanceWords: 80,
      blocker: false,
    },
    provenance: {
      availability: "available",
      sourceTool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v17",
      persistence: "none",
      completedAt: "2026-08-20T00:00:00.000Z",
    },
    evaluatedChecks: [check],
    searchSource: {
      state: "connected",
      property: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
    },
  } as AgentAuditViewModel;
}

const MESSAGES = {
  agents: en.agents,
  tools: { seoAudit: en.tools.seoAudit },
};

describe("agentAffectedObservations", () => {
  it("merges canonically equal URLs across sibling records in first-seen order", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["second", "first"] });
    const source = check.check.dataSource;
    const records = [
      record("first", [
        observation("https://example.com/page", "title", "First title"),
      ]),
      record("second", [
        observation(
          "https://example.com/page#captured-section",
          "canonical_target",
          "https://example.com/page",
        ),
      ]),
    ];

    expect(agentAffectedObservations(check, records)).toEqual([
      {
        url: "https://example.com/page#captured-section",
        recordGroups: [
          {
            recordId: "second",
            values: [
              {
                label: "canonical_target",
                value: "https://example.com/page",
              },
            ],
            source,
            truth: "observed",
          },
          {
            recordId: "first",
            values: [{ label: "title", value: "First title" }],
            source,
            truth: "observed",
          },
        ],
      },
    ]);
  });

  it("keeps null observations site-level instead of inventing the target URL", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["site"] });

    expect(
      agentAffectedObservations(
        check,
        [record("site", [observation(null, "fetched", true)])],
        TARGET_URL,
      ),
    ).toMatchObject([
      {
        url: null,
        recordGroups: [
          {
            recordId: "site",
            values: [{ label: "fetched", value: true }],
          },
        ],
      },
    ]);
  });

  it("uses the existing comparable-URL semantics for page-scope filtering", () => {
    const check = evaluatedCheck({
      scope: "page",
      evidenceRecordIds: ["page"],
    });
    const records = [
      record("page", [
        observation(`${TARGET_URL}#details`, "title", "Target title"),
        observation("https://example.com/other", "title", "Other title"),
        observation(null, "fetched", true),
      ]),
    ];

    expect(
      agentAffectedObservations(check, records, `${TARGET_URL}#ignored`),
    ).toMatchObject([
      {
        url: `${TARGET_URL}#details`,
        recordGroups: [
          {
            recordId: "page",
            values: [{ label: "title", value: "Target title" }],
          },
        ],
      },
    ]);
  });
});

describe("affected URL reach", () => {
  it("counts hash variants once so ranking matches the grouped observation rows", () => {
    const hashVariants = evaluatedCheck({
      id: "2.3",
      evidenceRecordIds: ["hash-one", "hash-two"],
    });
    const twoPages = evaluatedCheck({
      id: "2.4",
      evidenceRecordIds: ["two-pages"],
    });
    const ranked = rankAgentRecommendations(
      "seo",
      [hashVariants, twoPages],
      [
        record("hash-one", [
          observation("https://example.com/same#one", "title", "One"),
        ]),
        record("hash-two", [
          observation("https://example.com/same", "title", "Two"),
        ]),
        record("two-pages", [
          observation("https://example.com/first", "title", "First"),
          observation("https://example.com/second", "title", "Second"),
        ]),
      ],
      { limit: 3 },
    );

    expect(ranked.map((item) => item.check.check.id)).toEqual(["2.4", "2.3"]);
    expect(
      ranked.find((item) => item.check.check.id === "2.3")?.reach,
    ).toBe(1);
  });

  it("still counts distinct unparseable non-empty values and Site-level evidence honestly", () => {
    const check = evaluatedCheck({
      id: "2.5",
      evidenceRecordIds: ["invalid-values"],
    });
    const [recommendation] = rankAgentRecommendations(
      "seo",
      [check],
      [
        record("invalid-values", [
          observation("not a url", "title", "First"),
          observation("not a url", "title", "Duplicate"),
          observation("another invalid value", "title", "Second"),
          observation(null, "groups_observed", 1),
        ]),
      ],
      { limit: 3 },
    );

    expect(recommendation?.reach).toBe(3);
  });
});

describe("AgentEvidenceDetails", () => {
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
    vi.restoreAllMocks();
  });

  function renderEvidence(
    check: AgentAuditEvaluatedCheck,
    records: readonly SeoAuditRecord[],
    targetUrl = TARGET_URL,
  ): void {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={MESSAGES}
        >
          <AgentEvidenceDetails
            check={check}
            records={records}
            targetUrl={targetUrl}
            locale="en"
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("renders an explicit empty observation state", () => {
    renderEvidence(
      evaluatedCheck({ evidenceRecordIds: [], truth: "partial" }),
      [],
    );

    expect(
      host.querySelector('[data-testid="agent-evidence-empty"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("No displayable observation");
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows Site-level evidence without creating a URL link", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["site"] });
    renderEvidence(check, [
      record("site", [observation(null, "groups_observed", 2)]),
    ]);

    expect(host.textContent).toContain("Site-level observation");
    expect(host.textContent).toContain("Evidence record");
    expect(host.textContent).toContain("Public static HTML");
    expect(host.textContent).toContain("Observed");
    expect(
      host.querySelector('[data-testid="agent-evidence-details"] h5')
        ?.textContent,
    ).toBe("Affected URLs (0)");
    expect(host.textContent).toContain("Showing 1 of 1");
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });

  it("counts only URL rows in a mixed heading while retaining the Site-level row", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["mixed"] });
    renderEvidence(check, [
      record("mixed", [
        observation(null, "groups_observed", 2),
        observation("https://example.com/affected", "title", "Affected"),
      ]),
    ]);

    expect(
      host.querySelector('[data-testid="agent-evidence-details"] h5')
        ?.textContent,
    ).toBe("Affected URLs (1)");
    expect(host.textContent).toContain("Showing 2 of 2");
    expect(host.textContent).toContain("Site-level observation");
    expect(host.textContent).toContain("https://example.com/affected");
    expect(
      host.querySelectorAll('[data-testid="agent-affected-observation"]'),
    ).toHaveLength(2);
  });

  it("shows the catalog record title while retaining a safe raw-id fallback", () => {
    const missingMessage = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const check = evaluatedCheck({
      evidenceRecordIds: ["title_missing", "unknown_record"],
    });
    renderEvidence(check, [
      record("title_missing", [
        observation("https://example.com/titled", "title", null),
      ]),
      record("unknown_record", [
        observation("https://example.com/fallback", "title", null),
      ]),
    ]);

    expect(host.textContent).toContain("Title not present");
    expect(host.textContent).toContain("title_missing");
    expect(host.textContent).toContain("unknown_record");
    expect(missingMessage).not.toHaveBeenCalled();
  });

  it("shows five rows by default and exposes then collapses the full set", async () => {
    const records = Array.from({ length: 7 }, (_, index) =>
      record(`record-${index + 1}`, [
        observation(
          `https://example.com/page-${index + 1}`,
          "title",
          `Title ${index + 1}`,
        ),
      ]),
    );
    const check = evaluatedCheck({
      evidenceRecordIds: records.map((item) => item.id),
    });
    renderEvidence(check, records);

    expect(
      host.querySelectorAll('[data-testid="agent-affected-observation"]'),
    ).toHaveLength(5);
    expect(
      host.querySelector('[data-testid="agent-evidence-details"] h5')
        ?.textContent,
    ).toBe("Affected URLs (7)");
    expect(host.textContent).toContain("Showing 5 of 7");
    const showAll = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-evidence-toggle"]',
    );
    expect(showAll?.textContent).toContain("Show all 7");

    await act(async () => showAll?.click());

    expect(
      host.querySelectorAll('[data-testid="agent-affected-observation"]'),
    ).toHaveLength(7);
    expect(host.textContent).toContain("Showing 7 of 7");
    const collapse = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-evidence-toggle"]',
    );
    expect(collapse?.textContent).toContain("Show first 5");

    await act(async () => collapse?.click());

    expect(
      host.querySelectorAll('[data-testid="agent-affected-observation"]'),
    ).toHaveLength(5);
  });

  it("opens only valid HTTP observations with safe new-tab attributes", () => {
    const check = evaluatedCheck({
      evidenceRecordIds: ["safe", "unsafe"],
    });
    renderEvidence(check, [
      record("safe", [
        observation("https://example.com/safe", "title", "Safe"),
      ]),
      record("unsafe", [
        observation("javascript:alert(1)", "title", "Unsafe"),
      ]),
    ]);

    const links = host.querySelectorAll<HTMLAnchorElement>("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/safe");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
    expect(links[0]?.getAttribute("rel")).toContain("noreferrer");
    expect(host.textContent).toContain("javascript:alert(1)");
  });

  it("is wired into the focused Stage 02 detail", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["stage-2"] });
    const records = [
      record("stage-2", [
        observation("https://example.com/stage-2", "title", "Stage 2"),
      ]),
    ];

    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={MESSAGES}
        >
          <AgentDiagnosis
            model={diagnosisModel(check)}
            scope="site"
            selectedGroupId="2"
            selectedCheckId="2.3"
            records={records}
            targetUrl={TARGET_URL}
            onScopeChange={() => undefined}
            onGroupChange={() => undefined}
            onCheckChange={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });

    const detail = host.querySelector('[data-testid="diagnosis-focused-detail"]');
    expect(
      detail?.querySelector('[data-testid="agent-evidence-details"]'),
    ).not.toBeNull();
    expect(detail?.textContent).toContain("https://example.com/stage-2");
  });

  it("is wired into the selected Stage 04 solution", () => {
    const check = evaluatedCheck({ evidenceRecordIds: ["stage-4"] });
    const records = [
      record("stage-4", [
        observation("https://example.com/stage-4", "title", "Stage 4"),
      ]),
    ];
    const profile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("seo", "example.com/target"),
        { country: "US", locale: "en-US", targetQuery: "example query" },
      ),
    );

    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={MESSAGES}
        >
          <AgentRecommendations
            agent="seo"
            locale="en"
            targetUrl={TARGET_URL}
            evaluatedChecks={[check]}
            records={records}
            targetPageExtract={null}
            profile={profile}
            selectedRecommendationId={null}
            onSelectRecommendation={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });

    const detail = host.querySelector('[data-testid="agent-selected-solution"]');
    expect(
      detail?.querySelector('[data-testid="agent-evidence-details"]'),
    ).not.toBeNull();
    expect(detail?.textContent).toContain("https://example.com/stage-4");
  });
});
