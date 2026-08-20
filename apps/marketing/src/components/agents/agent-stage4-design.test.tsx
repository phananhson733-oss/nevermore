// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import { AgentRecommendations } from "./agent-recommendations";

const TARGET_URL = "https://astrologywiki.com/target";

function record(
  id: string,
  observations: SeoAuditRecord["observations"],
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    unit: "pages",
    population: "every_collected_page",
    targetTested: null,
    tested: 12,
    affected: observations.length,
    observations,
    limitation: null,
  };
}

function check(
  primaryAgent: "seo" | "tech" = "seo",
): AgentAuditEvaluatedCheck {
  return {
    check: {
      id: "2.3",
      scope: "page",
      groupId: "2",
      title: { en: "Target query in title", zh: "Title 包含目标词" },
      impact: {
        en: "Searchers will not see the intended decision in the title.",
        zh: "搜索者无法从标题里看到预期决策。",
      },
      howToFix: {
        en: "Revise the title where this route is owned.",
        zh: "在路由归属处调整标题。",
      },
      threshold: { en: "Reviewed rule", zh: "审阅规则" },
      thresholdAuthority: "industry",
      dataSource: { en: "Public static HTML", zh: "公开静态 HTML" },
      scoreWeight: 1,
      scored: true,
      blocking: false,
      blockerEvidenceRecordIds: [],
      failureResult: "warning",
      inventoryReady: true,
      primaryAgent,
      engine: "ready",
      evidenceRecordIds: ["title"],
      issueRules: [],
      boundary: {
        en: "Only the bounded public evidence in this run was inspected.",
        zh: "仅检查本次运行中有边界的公开证据。",
      },
    },
    result: "warning",
    engine: "ready",
    truth: "observed",
    measurement: {
      en: "Observed title does not contain the target query",
      zh: "已观测标题未包含目标词",
    },
    evidenceRecordIds: ["title"],
    scoreValue: null,
    scoreContribution: 0,
  };
}

function profile(agent: "seo" | "tech" = "seo") {
  return confirmAgentProfile(
    updateAgentProfile(
      createAgentProfileDraft(agent, TARGET_URL),
      {
        productName: "Example Product",
        primaryIcp: "Search visitors",
        primaryCta: "Start free",
        firstOutcome: "Generate the right page",
        country: "US",
        locale: "en-US",
        device: "desktop",
        pageType: "homepage",
        targetQuery: "birth chart calculator",
        auditScope: "site-first",
      },
    ),
  );
}

const RECORDS = [
  record("title", [
    {
      url: TARGET_URL,
      values: [{ label: "title", value: "current title" }],
    },
  ]),
];

const MESSAGES = {
  agents: en.agents,
  tools: { seoAudit: en.tools.seoAudit },
};

describe("Agent Stage 04 design contract", () => {
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

  function render({
    agent = "seo",
    primaryAgent = "seo",
  }: {
    readonly agent?: "seo" | "tech";
    readonly primaryAgent?: "seo" | "tech";
  } = {}) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={MESSAGES}>
          <AgentRecommendations
            agent={agent}
            locale="en"
            targetUrl={TARGET_URL}
            evaluatedChecks={[check(primaryAgent)]}
            records={RECORDS}
            targetPageExtract={null}
            profile={profile(agent)}
            selectedRecommendationId={null}
            onSelectRecommendation={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("stacks Stage 03 and Stage 04 vertically and gives Stage 04 the approved hierarchy", () => {
    render();

    const wrapper = host.querySelector('[data-testid="agent-recommendation-row"]');
    expect(wrapper?.getAttribute("data-layout")).toBe("vertical");
    expect(wrapper?.className).not.toContain("min-[981px]:grid-cols-[");

    const stage4 = host.querySelector('[data-testid="agent-selected-solution"]');
    const stage4Header = host.querySelector('[data-testid="agent-stage4-header"]');
    const stage4HeaderLayout = host.querySelector(
      '[data-testid="agent-stage4-header-layout"]',
    );
    const stage4Body = host.querySelector('[data-testid="agent-stage4-body"]');
    const stage4AiHandoff = host.querySelector(
      '[data-testid="agent-stage4-ai-handoff"]',
    );
    const stage4Title = host.querySelector('[data-testid="agent-stage4-title"]');
    const stage4Eyebrow = host.querySelector('[data-testid="agent-stage4-eyebrow"]');
    const issueTitle = host.querySelector('[data-testid="agent-stage4-issue-title"]');
    const index = host.querySelector('[data-testid="agent-stage4-index"]');
    const accent = host.querySelector('[data-testid="agent-stage4-accent"]');
    const boundary = host.querySelector('[data-testid="agent-solution-boundary"]');

    expect(stage4).not.toBeNull();
    expect(stage4?.className).toContain("w-full");
    expect(accent?.className).toContain("w-0.5");
    expect(stage4Header?.textContent).toContain(
      "Review one solution before implementation",
    );
    expect(stage4Header?.textContent).toContain("Preview only");
    expect(stage4Eyebrow?.textContent).toContain(
      "Stage 04 · Selected solution & validation",
    );
    expect(index?.textContent).toContain("04");
    expect(issueTitle?.textContent).toContain("Target query in title");
    expect(stage4Header?.textContent).not.toContain("Target query in title");
    expect(stage4Title?.className).toContain("text-[26px]");
    expect(stage4Title?.className).toContain("md:text-[32px]");
    expect(stage4Title?.className).toContain("leading-[1.14]");
    expect(issueTitle?.className).toContain("text-[18px]");
    expect(issueTitle?.className).toContain("md:text-[19px]");
    expect(issueTitle?.className).toContain("leading-[1.25]");
    expect(stage4Header?.className).toContain("px-[18px]");
    expect(stage4Header?.className).toContain("py-[22px]");
    expect(stage4Header?.className).toContain("md:px-8");
    expect(stage4Header?.className).toContain("md:pt-[30px]");
    expect(stage4Header?.className).toContain("md:pb-[26px]");
    expect(stage4HeaderLayout).not.toBeNull();
    expect(stage4HeaderLayout?.className ?? "").toContain(
      "md:grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(boundary?.className).toContain("justify-self-start");
    expect(boundary?.className).toContain("md:justify-self-end");
    expect(stage4Body?.className).toContain("lg:grid-cols-2");
    expect(stage4Body?.className).toContain("px-[18px]");
    expect(stage4Body?.className).toContain("py-[22px]");
    expect(stage4Body?.className).toContain("md:px-8");
    expect(stage4Body?.className).toContain("md:py-[30px]");

    const issueSection = host.querySelector('[data-testid="agent-stage4-issue"]');
    const sectionHeading = issueSection?.querySelector(":scope > h4");
    const issueParagraphs = [
      ...(issueSection?.querySelectorAll("p") ?? []),
    ];
    const evidenceSection = host.querySelector(
      '[data-testid="agent-stage4-evidence"]',
    );
    const evidenceLabel = evidenceSection?.querySelector(
      '[data-testid="agent-stage4-evidence-label"]',
    );
    const evidenceValue = evidenceSection?.querySelector(
      '[data-testid="agent-stage4-evidence-value"]',
    );
    const evidenceDetails = evidenceSection?.querySelector(
      '[data-testid="agent-evidence-details"]',
    );
    const draftFrame = host.querySelector('[data-testid="agent-stage4-draft"]');
    const aiAction = host.querySelector('[data-testid="agent-ai-action-copy"]');
    const validation = host.querySelector(
      '[data-testid="agent-solution-validation"]',
    );
    const fixPreview = host.querySelector(
      '[data-testid="agent-solution-preview"]',
    );
    expect(sectionHeading?.className).toContain("text-[14px]");
    expect(sectionHeading?.className).toContain("leading-[1.4]");
    expect(issueParagraphs.length).toBeGreaterThan(0);
    for (const paragraph of issueParagraphs) {
      expect(paragraph.className).toContain("!text-[13px]");
      expect(paragraph.className).toContain("!leading-[1.65]");
    }
    expect(validation?.className).toContain("[&_li]:!text-[13px]");
    expect(validation?.className).toContain("[&_li]:!leading-[1.65]");
    expect(evidenceLabel?.className).toContain("font-mono");
    expect(evidenceLabel?.className).toContain("text-[10px]");
    expect(evidenceValue?.className).toContain("text-[12px]");
    expect(evidenceValue?.className).toContain("leading-[1.65]");
    expect(evidenceDetails?.className).toContain(
      "[&_p]:!leading-[1.65]",
    );
    expect(draftFrame?.className).toContain("[&_p]:!leading-[1.65]");
    expect(aiAction?.className).toContain("[&_p]:!leading-[1.65]");
    expect(fixPreview?.className).toContain("text-[12px]");
    expect(fixPreview?.className).toContain("leading-[1.65]");

    const directStageOrder = [...(stage4?.children ?? [])]
      .map((child) => child.getAttribute("data-testid"))
      .filter((testId) =>
        [
          "agent-stage4-header",
          "agent-stage4-ai-handoff",
          "agent-stage4-body",
        ].includes(testId ?? ""),
      );
    expect(directStageOrder).toEqual([
      "agent-stage4-header",
      "agent-stage4-ai-handoff",
      "agent-stage4-body",
    ]);
    expect(stage4?.querySelectorAll('[data-testid="agent-ai-action-copy"]')).toHaveLength(1);
    expect(stage4AiHandoff?.parentElement).toBe(stage4);
    expect(stage4AiHandoff?.nextElementSibling).toBe(stage4Body);
    expect(stage4Body?.contains(aiAction ?? null)).toBe(false);
    expect(stage4AiHandoff?.className).toContain("border-b");
    expect(stage4AiHandoff?.className).toContain("px-[18px]");
    expect(stage4AiHandoff?.className).toContain("py-[22px]");
    expect(stage4AiHandoff?.className).toContain("md:px-8");
    expect(stage4AiHandoff?.className).toContain("md:py-[26px]");

    for (const testId of [
      "agent-stage4-issue",
      "agent-stage4-evidence",
      "agent-stage4-draft",
      "agent-stage4-context",
      "agent-solution-validation",
      "agent-solution-impact",
      "agent-solution-risks",
      "agent-solution-limits",
    ]) {
      expect(
        stage4Body?.querySelector(`[data-testid="${testId}"]`),
        `${testId} must remain in the two-column body`,
      ).not.toBeNull();
    }
  });

  it("keeps the AI action packet SEO-only while allowing subordinate technical checks inside SEO", () => {
    render({ agent: "tech", primaryAgent: "tech" });
    expect(
      host.querySelector('[data-testid="agent-ai-action-copy"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="agent-stage4-ai-handoff"]'),
    ).toBeNull();

    render({ agent: "seo", primaryAgent: "tech" });
    const actionPacket = host.querySelector(
      '[data-testid="agent-ai-action-copy"]',
    );
    expect(actionPacket).not.toBeNull();
    expect(
      host.querySelector('[data-testid="agent-stage4-ai-handoff"]')
        ?.parentElement,
    ).toBe(host.querySelector('[data-testid="agent-selected-solution"]'));
    expect(
      host.querySelectorAll('[data-testid="agent-ai-action-copy"]'),
    ).toHaveLength(1);
    expect(
      host.querySelector('[data-testid="agent-stage4-issue-title"]')?.textContent,
    ).toContain("Target query in title");
  });

  it("uses the same resolved solution copy in the visible repair and the selected-issue AI preview", () => {
    render();

    const recommendation = host.querySelector(
      '[data-testid="agent-solution-recommendation"]',
    )?.textContent;
    const preview = host.querySelector(
      '[data-testid="agent-ai-copy-preview-chatbot"]',
    )?.textContent;

    expect(recommendation).toBeTruthy();
    expect(preview).toContain(recommendation);
  });
});
