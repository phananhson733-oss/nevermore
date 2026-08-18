// @vitest-environment jsdom
// @input  -- evaluated v2 checks, preserved evidence, and controlled selection
// @output -- regression coverage for differentiated Stage 03 -> 04 interaction
// @pos    -- component contract guard for the Agent recommendation row

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoAuditEvidenceValue, SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentRecommendations } from "./agent-recommendations";

function record(
  id: string,
  affected: number,
  values: readonly { label: string; value: SeoAuditEvidenceValue }[] = [
    { label: "title", value: `${id} evidence` },
  ],
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    unit: "pages",
    population: "every_collected_page" as const,
    tested: 12,
    affected,
    observations: [
      {
        url: "https://example.com/target",
        values: [...values],
      },
    ],
    limitation: null,
  } as unknown as SeoAuditRecord;
}

function check({
  id,
  title,
  primaryAgent,
  recordId,
  result = "warning",
  engine,
  truth,
  measurement,
  scope = "page",
}: {
  readonly id: string;
  readonly title: string;
  readonly primaryAgent: "seo" | "tech";
  readonly scope?: "site" | "page";
  readonly recordId?: string;
  readonly result?: "blocker" | "warning" | "tip" | "excluded";
  readonly engine?: string;
  readonly truth?: string;
  readonly measurement?: { readonly en: string; readonly zh: string } | null;
}): AgentAuditEvaluatedCheck {
  const evidenceRecordIds = recordId ? [recordId] : [];
  const evidenced = evidenceRecordIds.length > 0;
  return {
    check: {
      id,
      scope,
      groupId: id.split(".")[0] ?? id,
      title: { en: title, zh: `${title} 中文` },
      impact: {
        en: `${title} can affect the relevant decision surface.`,
        zh: `${title} 可能影响相关决策面。`,
      },
      howToFix: {
        en: `Review and correct ${title} with the owning context.`,
        zh: `结合归属上下文审查并修复 ${title}。`,
      },
      threshold: { en: "Expected threshold", zh: "预期阈值" },
      thresholdAuthority: "official",
      dataSource: { en: "Public static HTML", zh: "公开静态 HTML" },
      scoreWeight: 1,
      blocking: result === "blocker",
      primaryAgent,
      evidenceRecordIds,
    },
    result,
    engine: engine ?? (evidenced ? "ready" : "not-integrated"),
    truth: truth ?? (evidenced ? "observed" : "unavailable"),
    measurement:
      measurement === undefined
        ? evidenced
          ? { en: `${title} observed`, zh: `已观测 ${title}` }
          : null
        : measurement,
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

const checks = [
  check({
    id: "2.3",
    title: "Target query in title",
    primaryAgent: "seo",
    recordId: "title_signal",
  }),
  check({
    id: "1.4",
    title: "Canonical target",
    primaryAgent: "tech",
    recordId: "canonical_signal",
  }),
  check({
    id: "8.1",
    title: "LCP field data",
    primaryAgent: "tech",
    engine: "not-integrated",
    truth: "unavailable",
  }),
];

const records = [
  record("title_signal", 2),
  record("canonical_signal", 3, [
    { label: "canonical_target", value: "https://example.com/" },
  ]),
];

function profile(agent: "seo" | "tech") {
  return confirmAgentProfile(
    updateAgentProfile(createAgentProfileDraft(agent, "astrologywiki.com"), {
      country: "CN",
      locale: "zh-CN",
      targetQuery: "免费星盘计算",
    }),
  );
}

const MESSAGES = {
  agents: en.agents,
  tools: { seoAudit: en.tools.seoAudit },
};

function selectSpy() {
  return vi.fn<(recommendationId: string) => void>();
}

type SelectSpy = ReturnType<typeof selectSpy>;

const RECOMMENDATION_COPY = en.agents.workbench.recommendations;
const DIAGNOSIS_COPY = en.agents.workbench.diagnosis;
const PROFILE_OPTIONS = en.agents.workbench.profile.options;

describe("AgentRecommendations", () => {
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

  function renderWith({
    agent,
    selectedRecommendationId,
    evaluatedChecks = checks,
    evidence = records,
    onSelectRecommendation = selectSpy(),
  }: {
    readonly agent: "seo" | "tech";
    readonly selectedRecommendationId: string | null;
    readonly evaluatedChecks?: readonly AgentAuditEvaluatedCheck[];
    readonly evidence?: readonly SeoAuditRecord[];
    readonly onSelectRecommendation?: SelectSpy;
  }) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={MESSAGES}>
          <AgentRecommendations
            agent={agent}
            locale="en"
            targetUrl="https://example.com/target"
            evaluatedChecks={evaluatedChecks}
            records={evidence}
            targetPageExtract={null}
            profile={profile(agent)}
            selectedRecommendationId={selectedRecommendationId}
            onSelectRecommendation={onSelectRecommendation}
          />
        </NextIntlClientProvider>,
      );
    });
    return onSelectRecommendation;
  }

  function render(
    agent: "seo" | "tech",
    selectedRecommendationId: string | null,
    onSelectRecommendation = selectSpy(),
  ) {
    return renderWith({
      agent,
      selectedRecommendationId,
      onSelectRecommendation,
    });
  }

  function textOf(testId: string): string {
    return (
      host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
        ?.textContent ?? ""
    );
  }

  function solutionCopy(): readonly string[] {
    return [
      "agent-solution-recommendation",
      "agent-solution-validation",
      "agent-solution-impact",
      "agent-solution-risks",
      "agent-solution-limits",
    ].map(textOf);
  }

  it("renders controlled recommendation rows with aria-pressed and aria-controls", () => {
    render("seo", "seo:page:2.3");

    const selected = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-recommendation-seo:page:2.3"]',
    );
    const other = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-recommendation-seo:page:1.4"]',
    );
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(other?.getAttribute("aria-pressed")).toBe("false");
    expect(selected?.getAttribute("aria-controls")).toBe(
      "seo-selected-solution",
    );
    expect(host.querySelector("#seo-selected-solution")).not.toBeNull();
  });

  it("ranks an evidenced blocker before a wider warning and keeps reach secondary", () => {
    renderWith({
      agent: "seo",
      selectedRecommendationId: null,
      evaluatedChecks: [
        check({
          id: "2.3",
          title: "Wide metadata warning",
          primaryAgent: "seo",
          recordId: "wide_warning",
        }),
        check({
          id: "1.1",
          title: "Narrow status blocker",
          primaryAgent: "tech",
          recordId: "narrow_blocker",
          result: "blocker",
        }),
      ],
      evidence: [record("wide_warning", 100), record("narrow_blocker", 1)],
    });

    const list = host.querySelector('[data-stage="03"]');
    const labels = [
      ...(list?.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="agent-recommendation-"]',
      ) ?? []),
    ].map((button) => button.textContent ?? "");
    expect(labels[0]).toContain("Narrow status blocker");
    expect(labels[1]).toContain("Wide metadata warning");
  });

  it("selecting a Stage 03 row requests the matching Stage 04 solution", () => {
    const onSelect = render("seo", "seo:page:2.3");
    const canonical = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-recommendation-seo:page:1.4"]',
    );

    act(() => canonical?.click());

    expect(onSelect).toHaveBeenCalledWith("seo:page:1.4");
  });

  it("renders all required Selected Solution fields and an explicit preview-only boundary", () => {
    render("tech", "tech:page:1.4");
    const solution = host.querySelector<HTMLElement>("#tech-selected-solution");
    const text = solution?.textContent ?? "";

    for (const label of [
      "Issue & why",
      "Evidence",
      "Fix preview",
      "Applicable context",
      "Validation steps",
      "Impact surface",
      "Risks",
      "Limits / unknowns",
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('rel="canonical"');
    expect(text).toContain("Preview only");
    expect(text).toContain("has not edited, applied, created a PR");
    expect(text).toContain("published, or deployed");
  });

  it("gives SEO and Tech different solution shapes and copy from the same check", () => {
    render("seo", "seo:page:1.4");
    const seoCopy = solutionCopy();
    const seoPreview = host.querySelector("pre")?.textContent ?? "";
    const seoContext = host.textContent ?? "";

    render("tech", "tech:page:1.4");
    const techCopy = solutionCopy();
    const techPreview = host.querySelector("pre")?.textContent ?? "";
    const techContext = host.textContent ?? "";

    expect(seoContext).toContain("AstrologyWiki");
    expect(seoContext).toContain("Generate Free Birth Chart");
    expect(seoContext).toContain("免费星盘计算");
    expect(techContext).toContain(
      "Evaluate crawlability and reliability of the public birth-chart experience",
    );
    expect(seoPreview).toContain("technical issue brief");
    expect(techPreview).toContain('rel="canonical"');
    expect(seoPreview).not.toBe(techPreview);
    for (const [index, copy] of seoCopy.entries()) {
      expect(copy).not.toBe("");
      expect(copy).not.toBe(techCopy[index]);
    }
  });

  it("gives two different Tech solution kinds their own advice, validation, risks, and limits", () => {
    const canonicalChecks = [
      check({
        id: "1.4",
        title: "Canonical target",
        primaryAgent: "tech",
        recordId: "canonical_signal",
      }),
    ];
    const redirectChecks = [
      check({
        id: "1.6",
        title: "Redirect chain length",
        primaryAgent: "tech",
        recordId: "redirect_signal",
      }),
    ];
    const redirectRecords = [
      record("redirect_signal", 1, [
        { label: "redirect_hops", value: 3 },
        { label: "final_url", value: "https://example.com/final" },
      ]),
    ];

    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.4",
      evaluatedChecks: canonicalChecks,
    });
    const canonicalCopy = solutionCopy();

    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.6",
      evaluatedChecks: redirectChecks,
      evidence: redirectRecords,
    });
    const redirectCopy = solutionCopy();

    for (const [index, copy] of canonicalCopy.entries()) {
      expect(copy).not.toBe("");
      expect(copy).not.toBe(redirectCopy[index]);
    }
  });

  it("fills the fix preview with this run's own measured values instead of placeholders", () => {
    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.6",
      evaluatedChecks: [
        check({
          id: "1.6",
          title: "Redirect chain length",
          primaryAgent: "tech",
          recordId: "redirect_signal",
        }),
      ],
      evidence: [
        record("redirect_signal", 1, [
          { label: "redirect_hops", value: 3 },
          { label: "final_url", value: "https://example.com/final" },
        ]),
      ],
    });
    const preview = host.querySelector("pre")?.textContent ?? "";

    expect(preview).toContain("https://astrologywiki.com/");
    expect(preview).toContain("Redirect chain length observed");
    expect(preview).toContain("observed hops: 3");
    expect(preview).toContain("https://example.com/final");
    expect(preview).not.toContain("[legacy path]");
    expect(preview).not.toContain("[host]");
    expect(preview).not.toContain("[confirmed query]");
  });

  it("localizes result, engine, truthfulness, and page context instead of raw enum tokens", () => {
    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.4",
      evaluatedChecks: [
        check({
          id: "1.4",
          title: "Canonical target",
          primaryAgent: "tech",
          recordId: "canonical_signal",
          engine: "needs-supplement",
          truth: "source-gated",
        }),
      ],
    });

    const states = textOf("agent-solution-states");
    expect(states).toContain(DIAGNOSIS_COPY.results.warning);
    expect(states).toContain(DIAGNOSIS_COPY.engines.needsSupplement);
    expect(states).toContain(DIAGNOSIS_COPY.truth.sourceGated);
    expect(states).not.toContain("needs-supplement");
    expect(states).not.toContain("source-gated");

    const solution =
      host.querySelector<HTMLElement>("#tech-selected-solution")?.textContent ??
      "";
    expect(solution).toContain(
      [
        PROFILE_OPTIONS.pageType.homepage,
        PROFILE_OPTIONS.device.mobile,
        PROFILE_OPTIONS.auditScope["site-first"],
      ].join(" · "),
    );
    expect(solution).not.toContain("site-first");

    const row =
      host.querySelector<HTMLElement>(
        '[data-testid="agent-recommendation-tech:page:1.4"]',
      )?.textContent ?? "";
    expect(row).toContain(`P1 · ${DIAGNOSIS_COPY.results.warning}`);
  });

  it("renders source-gated checks as unavailable investigation, not an actionable fix", () => {
    render("tech", "tech:page:8.1");
    const solution = host.querySelector<HTMLElement>("#tech-selected-solution");
    const text = solution?.textContent ?? "";

    expect(textOf("agent-solution-boundary")).toContain(
      RECOMMENDATION_COPY.unavailableInvestigation,
    );
    expect(text).toContain(RECOMMENDATION_COPY.evidenceUnavailable);
    expect(
      host
        .querySelector('[data-testid="agent-evidence-empty"]')
        ?.getAttribute("data-presence"),
    ).toBe("source-gated");
    expect(text).not.toContain("Apply fix");
    expect(text).not.toContain("Create PR");
  });

  it("explains a not-observed check instead of contradicting its own measured value", () => {
    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.5",
      evaluatedChecks: [
        check({
          id: "1.5",
          title: "Included in sitemap",
          primaryAgent: "tech",
          engine: "ready",
          truth: "not-observed",
          measurement: {
            en: "0 of 12 inspected pages affected",
            zh: "12 个已检查页面中 0 个受影响",
          },
        }),
      ],
      evidence: [],
    });

    const empty = host.querySelector('[data-testid="agent-evidence-empty"]');
    expect(empty?.getAttribute("data-presence")).toBe("not-observed");
    const solution =
      host.querySelector<HTMLElement>("#tech-selected-solution")?.textContent ??
      "";
    expect(solution).toContain("0 of 12 inspected pages affected");
    expect(solution).not.toContain(RECOMMENDATION_COPY.evidenceUnavailable);
    expect(textOf("agent-solution-boundary")).toContain(
      RECOMMENDATION_COPY.previewOnly,
    );
    expect(textOf("agent-solution-boundary")).not.toContain(
      RECOMMENDATION_COPY.unavailableInvestigation,
    );
  });

  it("keeps a page-level check without a matching observation out of the source-gated wording", () => {
    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:page:1.4",
      evaluatedChecks: [
        check({
          id: "1.4",
          title: "Canonical target",
          primaryAgent: "tech",
          recordId: "canonical_signal",
          engine: "ready",
          truth: "observed",
        }),
      ],
      evidence: [
        {
          ...record("canonical_signal", 1),
          observations: [
            {
              url: "https://example.com/other",
              values: [{ label: "canonical_target", value: null }],
            },
          ],
        } as unknown as SeoAuditRecord,
      ],
    });

    expect(
      host
        .querySelector('[data-testid="agent-evidence-empty"]')
        ?.getAttribute("data-presence"),
    ).toBe("not-captured");
  });

  it("still shows preserved observations when the record itself is not a confirmed hit", () => {
    renderWith({
      agent: "tech",
      selectedRecommendationId: "tech:site:C2",
      evaluatedChecks: [
        check({
          id: "C2",
          title: "Broken link count",
          primaryAgent: "tech",
          recordId: "internal_target_http_error",
          scope: "site",
          engine: "ready",
          truth: "observed",
        }),
      ],
      evidence: [
        {
          ...record("internal_target_http_error", 0, [
            { label: "final_status", value: 404 },
          ]),
          state: "unverified",
        } as unknown as SeoAuditRecord,
      ],
    });

    expect(
      host.querySelector('[data-testid="agent-evidence-empty"]'),
    ).toBeNull();
    const solution =
      host.querySelector<HTMLElement>("#tech-selected-solution")?.textContent ??
      "";
    expect(solution).toContain("https://example.com/target");
    expect(solution).toContain("404");
  });

  it("exposes the 39/61 desktop grid with Stage 03 before Stage 04 in DOM order", () => {
    render("seo", "seo:page:2.3");
    const row = host.querySelector('[data-testid="agent-recommendation-row"]');
    const stages = [...(row?.children ?? [])].map((child) =>
      child.getAttribute("data-stage"),
    );

    expect(row?.className).toContain("minmax(260px,0.39fr)");
    expect(row?.className).toContain("minmax(0,0.61fr)");
    expect(stages).toEqual(["03", "04"]);
  });
});
