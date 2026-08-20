// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";
import type { AgentSolutionTemplate } from "./agent-solution-templates";
import { AgentAiActionCopy } from "./agent-ai-action-copy";

const TARGET_URL = "https://astrologywiki.com/target";

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

function check(
  truth: AgentAuditEvaluatedCheck["truth"] = "observed",
): AgentAuditEvaluatedCheck {
  const engine: AgentAuditEvaluatedCheck["engine"] =
    truth === "source-gated"
      ? "access-required"
      : truth === "unavailable" || truth === "illustrative"
        ? "not-integrated"
        : "ready";
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
      primaryAgent: "seo",
      engine,
      evidenceRecordIds: ["title"],
      issueRules: [],
      boundary: {
        en: "Only the bounded public evidence in this run was inspected.",
        zh: "仅检查本次运行中有边界的公开证据。",
      },
    },
    result: "warning",
    engine,
    truth,
    measurement:
      truth === "observed"
        ? {
            en: "Observed title does not contain the target query",
            zh: "已观测标题未包含目标词",
          }
        : null,
    evidenceRecordIds: ["title"],
    scoreValue: null,
    scoreContribution: 0,
  };
}

function profile(
  agent: "seo" | "tech" = "seo",
  targetUrl = TARGET_URL,
) {
  return confirmAgentProfile(
    updateAgentProfile(createAgentProfileDraft(agent, targetUrl), {
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
    }),
  );
}

function solution(): AgentSolutionTemplate {
  return {
    agent: "seo",
    kind: "search-presentation",
    presentation: "content",
    preview: [
      "search presentation draft",
      `  page: ${TARGET_URL}`,
      "  observed title: current title",
      "  new title: [fill in]",
    ].join("\n"),
    recommendationKey: "recommendations.seo.kinds.searchPresentation.recommendation",
    applicableContextKey: "recommendations.seo.applicableContext",
    validationKeys: [
      "recommendations.seo.kinds.searchPresentation.validation1",
      "recommendations.seo.kinds.searchPresentation.validation2",
      "recommendations.seo.kinds.searchPresentation.validation3",
    ],
    impactSurfaceKey: "recommendations.seo.kinds.searchPresentation.impactSurface",
    risksKey: "recommendations.seo.kinds.searchPresentation.risks",
    limitsKey: "recommendations.seo.kinds.searchPresentation.limits",
  };
}

const CONTENT = {
  recommendation:
    "Rewrite the title so it answers the intended search decision.",
  applicableContext:
    "This recommendation applies to the confirmed product, query, locale and device in this run.",
  validation: [
    "Check the rendered title on the live page.",
    "Confirm the revised title still matches the visible H1.",
    "Re-run the audit and compare the title observation.",
  ],
  impact:
    "This affects the first search impression and whether the page is obviously relevant.",
  risks:
    "An over-optimized title can drift away from the page's real promise.",
  limits: "This run did not prove click-through rate or ranking change.",
} as const;

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

function techSolution(): AgentSolutionTemplate {
  return {
    ...solution(),
    agent: "tech",
    recommendationKey:
      "recommendations.tech.kinds.searchPresentation.recommendation",
    applicableContextKey: "recommendations.tech.applicableContext",
    validationKeys: [
      "recommendations.tech.kinds.searchPresentation.validation1",
      "recommendations.tech.kinds.searchPresentation.validation2",
      "recommendations.tech.kinds.searchPresentation.validation3",
    ],
    impactSurfaceKey:
      "recommendations.tech.kinds.searchPresentation.impactSurface",
    risksKey: "recommendations.tech.kinds.searchPresentation.risks",
    limitsKey: "recommendations.tech.kinds.searchPresentation.limits",
  };
}

interface RenderOverrides {
  readonly selectedCheck?: AgentAuditEvaluatedCheck;
  readonly targetUrl?: string;
  readonly runProfile?: ReturnType<typeof profile>;
  readonly runSolution?: AgentSolutionTemplate;
  readonly content?: typeof CONTENT | {
    readonly recommendation: string;
    readonly applicableContext: string;
    readonly validation: readonly string[];
    readonly impact: string;
    readonly risks: string;
    readonly limits: string;
  };
}

describe("AgentAiActionCopy", () => {
  let host: HTMLDivElement;
  let root: Root;
  let intlErrors: unknown[];

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    intlErrors = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(overrides: RenderOverrides = {}): void {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={MESSAGES}
          onError={(error) => {
            intlErrors.push(error);
          }}
        >
          <AgentAiActionCopy
            locale="en"
            selectedCheck={overrides.selectedCheck ?? check()}
            evidenceRecords={RECORDS}
            targetUrl={overrides.targetUrl ?? TARGET_URL}
            profile={overrides.runProfile ?? profile()}
            solution={overrides.runSolution ?? solution()}
            content={overrides.content ?? CONTENT}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("copies distinct Chatbot and Code Agent briefs whose preview matches the exact copied text", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    const fetchSpy = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", fetchSpy);

    render();

    const details = host.querySelectorAll("details");
    const preview = host.querySelector<HTMLPreElement>(
      '[data-testid="agent-ai-copy-preview-chatbot"]',
    );
    const codePreview = host.querySelector<HTMLPreElement>(
      '[data-testid="agent-ai-copy-preview-code-agent"]',
    );
    expect(preview?.textContent).toContain("decision-ready remediation plan");

    const chatbot = [...host.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Copy task for Chatbot"),
    );
    const codeAgent = [...host.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Copy task for Code Agent"),
    );
    expect(chatbot).toBeDefined();
    expect(codeAgent).toBeDefined();

    await act(async () => chatbot?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => codeAgent?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText.mock.calls[0]?.[0]).toBe(preview?.textContent ?? "");
    expect(writeText.mock.calls[1]?.[0]).toBe(codePreview?.textContent ?? "");
    expect(codePreview?.textContent).toContain("Inspect the supplied repository before choosing files.");
    expect(writeText.mock.calls[0]?.[0]).not.toBe(writeText.mock.calls[1]?.[0]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Copied");
    expect(details).toHaveLength(2);
    expect(intlErrors).toEqual([]);
    const liveRegion = host.querySelector('[role="status"]');
    expect(liveRegion?.getAttribute("aria-live")).toBe("polite");
  });

  it.each(["denied", "undefined"] as const)(
    "renders the identical fallback textarea when clipboard access is %s",
    async (clipboardState) => {
      vi.stubGlobal(
        "navigator",
        clipboardState === "denied"
          ? {
              clipboard: {
                writeText: vi
                  .fn<(_: string) => Promise<void>>()
                  .mockRejectedValue(new Error("denied")),
              },
            }
          : {},
      );

      render();

      const chatbot = [...host.querySelectorAll("button")].find((entry) =>
        entry.textContent?.includes("Copy task for Chatbot"),
      );
      const preview = host.querySelector<HTMLPreElement>(
        '[data-testid="agent-ai-copy-preview-chatbot"]',
      );
      await act(async () =>
        chatbot?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );

      const fallback = host.querySelector<HTMLTextAreaElement>(
        '[data-testid="agent-ai-copy-fallback"]',
      );
      expect(fallback).not.toBeNull();
      expect(fallback?.readOnly).toBe(true);
      expect(fallback?.value).toBe(preview?.textContent ?? "");
      expect(host.textContent).toContain("Clipboard access was denied");
      expect(intlErrors).toEqual([]);
    },
  );

  it.each(["source-gated", "unavailable", "illustrative"] as const)(
    "offers a Chatbot investigation brief and withholds Code Agent when truth is %s",
    async (truth) => {
      const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render({ selectedCheck: check(truth) });

      const chatbot = [...host.querySelectorAll("button")].find((entry) =>
        entry.textContent?.includes("Copy task for Chatbot"),
      );
      const codeAgent = [...host.querySelectorAll("button")].find((entry) =>
        entry.textContent?.includes("Copy task for Code Agent"),
      );
      expect(chatbot?.hasAttribute("disabled")).toBe(false);
      expect(codeAgent?.hasAttribute("disabled")).toBe(true);
      expect(host.textContent).toContain("Investigation only");
      expect(host.textContent).toContain("investigation brief");
      expect(host.textContent).toContain(
        "Code Agent implementation copy is unavailable",
      );
      expect(
        host.querySelector('[data-testid="agent-ai-copy-investigation-badge"]'),
      ).not.toBeNull();
      await act(async () =>
        chatbot?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0]).toContain("investigation brief");
      expect(intlErrors).toEqual([]);
    },
  );

  it("localizes context-invalid rejection, disables both actions, and does not call it investigation", () => {
    render({ targetUrl: "https://astrologywiki.com/different-target" });

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(host.textContent).toContain("confirmed run context is no longer valid");
    expect(host.textContent).not.toContain("copyTaskRefusal.context_invalid");
    expect(host.textContent).not.toContain("Investigation only");
    expect(host.textContent).toContain("Copy unavailable");
    expect(
      host.querySelector('[data-testid="agent-ai-copy-investigation-badge"]'),
    ).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("localizes serialized-too-large rejection without mislabeling it as investigation", () => {
    render({
      content: {
        ...CONTENT,
        recommendation: "oversized selected issue ".repeat(32 * 1024),
      },
    });

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(host.textContent).toContain("exceeded the safe copy budget");
    expect(host.textContent).not.toContain("Investigation only");
    expect(host.textContent).toContain("Copy unavailable");
    expect(
      host.querySelector('[data-testid="agent-ai-copy-investigation-badge"]'),
    ).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("fails closed when the component is accidentally rendered for a Tech run", () => {
    render({ runProfile: profile("tech"), runSolution: techSolution() });

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(host.textContent).toContain("confirmed run context is no longer valid");
    expect(host.textContent).not.toContain("Investigation only");
    expect(
      host.querySelector('[data-testid="agent-ai-copy-investigation-badge"]'),
    ).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("keeps every copy-control message complete and aligned in English and Chinese", () => {
    const english = en.agents.workbench.recommendations;
    const chinese = zh.agents.workbench.recommendations;
    const scalarKeys = [
      "copyTaskTitle",
      "copyTaskIntro",
      "copyTaskChatbot",
      "copyTaskCodeAgent",
      "copyTaskChatbotShort",
      "copyTaskCodeAgentShort",
      "copyTaskPreviewChatbot",
      "copyTaskPreviewCodeAgent",
      "copyTaskCopied",
      "copyTaskFailed",
      "copyTaskFallbackAria",
      "copyTaskInvestigationOnly",
      "copyTaskUnavailable",
      "copyTaskCodeAgentUnavailable",
    ] as const;

    for (const key of scalarKeys) {
      expect(english[key]).toBeTypeOf("string");
      expect(english[key]).not.toBe("");
      expect(chinese[key]).toBeTypeOf("string");
      expect(chinese[key]).not.toBe("");
    }
    expect(Object.keys(english.copyTaskRefusal).sort()).toEqual([
      "context_invalid",
      "evidence_unavailable",
      "serialized_too_large",
    ]);
    expect(Object.keys(chinese.copyTaskRefusal).sort()).toEqual(
      Object.keys(english.copyTaskRefusal).sort(),
    );
    for (const message of Object.values(english.copyTaskRefusal)) {
      expect(message).not.toBe("");
    }
    for (const message of Object.values(chinese.copyTaskRefusal)) {
      expect(message).not.toBe("");
    }
  });
});
