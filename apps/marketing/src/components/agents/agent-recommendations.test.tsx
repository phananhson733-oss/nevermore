// @vitest-environment jsdom
// @input  -- evaluated v2 checks, preserved evidence, and controlled selection
// @output -- regression coverage for differentiated Stage 03 -> 04 interaction
// @pos    -- component contract guard for the Agent recommendation row

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentRecommendations } from "./agent-recommendations";

function record(id: string, affected: number): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    unit: "pages",
    tested: 12,
    affected,
    observations: [
      {
        url: "https://example.com/target",
        values: [{ label: "title", value: `${id} evidence` }],
      },
    ],
    limitation: null,
  };
}

function check({
  id,
  title,
  primaryAgent,
  recordId,
  result = "warning",
}: {
  readonly id: string;
  readonly title: string;
  readonly primaryAgent: "seo" | "tech";
  readonly recordId?: string;
  readonly result?: "blocker" | "warning" | "tip" | "excluded";
}): AgentAuditEvaluatedCheck {
  const evidenceRecordIds = recordId ? [recordId] : [];
  return {
    check: {
      id,
      scope: "page",
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
    engine: evidenceRecordIds.length > 0 ? "ready" : "not-integrated",
    truth: evidenceRecordIds.length > 0 ? "observed" : "unavailable",
    measurement:
      evidenceRecordIds.length > 0
        ? { en: `${title} observed`, zh: `已观测 ${title}` }
        : null,
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
    result: "excluded",
  }),
];

const records = [record("title_signal", 2), record("canonical_signal", 3)];

function profile(agent: "seo" | "tech") {
  return confirmAgentProfile(
    updateAgentProfile(createAgentProfileDraft(agent, "astrologywiki.com"), {
      country: "CN",
      locale: "zh-CN",
      targetQuery: "免费星盘计算",
    }),
  );
}

describe("AgentRecommendations", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(
    agent: "seo" | "tech",
    selectedRecommendationId: string | null,
    onSelectRecommendation = vi.fn(),
  ) {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{
            agents: en.agents,
            tools: { seoAudit: en.tools.seoAudit },
          }}
        >
          <AgentRecommendations
            agent={agent}
            locale="en"
            targetUrl="https://example.com/target"
            evaluatedChecks={checks}
            records={records}
            profile={profile(agent)}
            selectedRecommendationId={selectedRecommendationId}
            onSelectRecommendation={onSelectRecommendation}
          />
        </NextIntlClientProvider>,
      );
    });
    return onSelectRecommendation;
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
    const rankedChecks = [
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
    ];
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{
            agents: en.agents,
            tools: { seoAudit: en.tools.seoAudit },
          }}
        >
          <AgentRecommendations
            agent="seo"
            locale="en"
            targetUrl="https://example.com/target"
            evaluatedChecks={rankedChecks}
            records={[
              record("wide_warning", 100),
              record("narrow_blocker", 1),
            ]}
            profile={profile("seo")}
            selectedRecommendationId={null}
            onSelectRecommendation={vi.fn()}
          />
        </NextIntlClientProvider>,
      );
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
    const solution = host.querySelector<HTMLElement>(
      "#tech-selected-solution",
    );
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

  it("gives SEO and Tech different recommendations and solutions from the same checks", () => {
    render("seo", "seo:page:1.4");
    const seoText = host.textContent ?? "";
    const seoPreview = host.querySelector("pre")?.textContent ?? "";

    render("tech", "tech:page:1.4");
    const techText = host.textContent ?? "";
    const techPreview = host.querySelector("pre")?.textContent ?? "";

    expect(seoText).toContain("SEO Agent decision");
    expect(seoText).toContain("AstrologyWiki");
    expect(seoText).toContain("Generate Free Birth Chart");
    expect(seoText).toContain("免费星盘计算");
    expect(techText).toContain("Tech Agent fix review");
    expect(techText).toContain(
      "Evaluate crawlability and reliability of the public birth-chart experience",
    );
    expect(seoPreview).toContain("technical issue brief");
    expect(techPreview).toContain('rel="canonical"');
    expect(seoPreview).not.toBe(techPreview);
  });

  it("renders excluded source-gated checks as unavailable investigation, not an actionable fix", () => {
    render("tech", "tech:page:8.1");
    const solution = host.querySelector<HTMLElement>(
      "#tech-selected-solution",
    );
    const text = solution?.textContent ?? "";

    expect(text).toContain("Evidence unavailable");
    expect(text).toContain("Unavailable investigation");
    expect(text).not.toContain("Apply fix");
    expect(text).not.toContain("Create PR");
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
