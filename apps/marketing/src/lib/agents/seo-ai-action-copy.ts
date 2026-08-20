// @input  -- one selected Agent issue, its exact evidence, the confirmed run context, and localized solution copy
// @output -- one bounded Markdown task packet for a Chatbot or Code Agent
// @pos    -- deterministic SEO Stage 04 action handoff; clipboard only, never an executor

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  agentAffectedObservations,
  type AgentAffectedObservation,
} from "../../components/agents/agent-evidence-observations";
import type { AgentProfileDraft } from "../../components/agents/agent-profile";
import type { AgentSolutionTemplate } from "../../components/agents/agent-solution-templates";
import { withinBriefBudget } from "../copy-brief/budget";
import {
  fencedJson,
  UNTRUSTED_DATA_NOTICE,
} from "../copy-brief/fenced-json";

export const SEO_AI_ACTION_COPY_SCHEMA_VERSION =
  "seo_ai_action_copy.v1" as const;
export const SEO_AI_ACTION_COPY_MAX_BYTES = 32 * 1024;

export type SeoAiActionAudience = "chatbot" | "code_agent";
export type SeoAiActionCopyLocale = "en" | "zh";

export interface SeoAiActionCopyContent {
  readonly recommendation: string;
  readonly applicableContext: string;
  readonly validation: readonly [string, string, string] | readonly string[];
  readonly impact: string;
  readonly risks: string;
  readonly limits: string;
}

export interface BuildSeoAiActionCopyInput {
  readonly audience: SeoAiActionAudience;
  readonly locale: SeoAiActionCopyLocale;
  readonly selectedCheck: AgentAuditEvaluatedCheck;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  readonly targetUrl: string;
  readonly profile: AgentProfileDraft;
  readonly solution: AgentSolutionTemplate;
  readonly content: SeoAiActionCopyContent;
}

export type BuildSeoAiActionCopyResult =
  | { readonly ok: true; readonly markdown: string; readonly includedUrls: number; readonly omittedUrls: number }
  | { readonly ok: false; readonly reason: "evidence_unavailable" | "serialized_too_large" };

interface CopyChrome {
  readonly title: string;
  readonly modeLabel: string;
  readonly dataHeading: string;
  readonly instructionsHeading: string;
  readonly responseHeading: string;
  readonly chatbotMode: string;
  readonly codeAgentMode: string;
  readonly investigationMode: string;
  readonly instructions: Readonly<Record<SeoAiActionAudience, readonly string[]>>;
  readonly investigationInstructions: readonly string[];
  readonly responseFormat: Readonly<Record<SeoAiActionAudience, readonly string[]>>;
}

const CHROME: Readonly<Record<SeoAiActionCopyLocale, CopyChrome>> = {
  en: {
    title: "SEO selected issue task for AI",
    modeLabel: "Task packet",
    dataHeading: "Selected issue data",
    instructionsHeading: "What to do",
    responseHeading: "Answer in this format",
    chatbotMode: "decision-ready remediation plan",
    codeAgentMode: "implementation brief",
    investigationMode: "investigation brief",
    instructions: {
      chatbot: [
        "Produce a decision-ready remediation plan or final copy proposal for this one issue.",
        "If several URLs share the same owner, say so and prefer one shared-template treatment over page-by-page duplication.",
        "List every fact you need from the user instead of inventing missing claims, data, file paths, or implementation ownership.",
        "Do not claim that anything was edited, shipped, deployed, or validated unless the data packet explicitly says it happened.",
        "Do not open pull requests, publish content, or change production systems.",
      ],
      code_agent: [
        "Inspect the supplied repository before choosing files.",
        "Map each affected URL to its route, template, or content owner before proposing a change.",
        "Prefer one shared-template fix when the repeated pattern points to a shared owner.",
        "Implement the minimal change, add focused tests, and run the relevant checks.",
        "Do not invent file paths, claims, prices, data, or deployment state.",
        "Do not commit, push, deploy, or alter production without separate explicit authority.",
      ],
    },
    investigationInstructions: [
      "Use this as an investigation brief, not an implementation claim.",
      "State which source, permission, or observation is missing before suggesting a fix.",
      "Do not invent repository locations, numbers, or page facts that were not observed.",
    ],
    responseFormat: {
      chatbot: [
        "1. The recommended action for this issue, and whether it is per-URL or shared-template.",
        "2. The facts the user must provide before the action is safe.",
        "3. The validation checklist and any unsupported assumptions.",
        "4. What you did not do, and why.",
      ],
      code_agent: [
        "1. Files or routes inspected and how each affected URL maps to them.",
        "2. The minimal change to make, with focused tests and commands to run.",
        "3. Validation results, unresolved facts, and any remaining risks.",
        "4. What you refused to do because authority was not granted.",
      ],
    },
  },
  zh: {
    title: "SEO 单个问题交给 AI 的任务包",
    modeLabel: "任务包",
    dataHeading: "选中问题数据",
    instructionsHeading: "请 AI 执行",
    responseHeading: "请按这个格式返回",
    chatbotMode: "决策级修复方案",
    codeAgentMode: "实施任务包",
    investigationMode: "排查任务包",
    instructions: {
      chatbot: [
        "只针对这一个问题输出可决策的修复方案或最终文案方案。",
        "如果多条 URL 指向同一归属，明确指出并优先给共享模板/共享路由方案，不要机械逐页复制。",
        "把需要用户补充的事实单独列出来，不要编造缺失的主张、数据、文件路径或实现归属。",
        "除非数据包里明确写明已经发生，否则不要声称已编辑、已上线、已部署或已验证。",
        "不要开 PR、发布内容，也不要修改生产系统。",
      ],
      code_agent: [
        "先检查提供的仓库，再决定改哪些文件。",
        "先把每个受影响 URL 映射到它的路由、模板或内容归属，再提出变更。",
        "如果重复模式指向共享归属，优先做一次共享模板修复。",
        "实现最小改动，补聚焦测试，并运行相关检查。",
        "不要编造文件路径、事实、价格、数据或部署状态。",
        "没有单独授权时，不要 commit、push、deploy，也不要改生产环境。",
      ],
    },
    investigationInstructions: [
      "把它当作排查任务，不要把它写成已经可以实施的结论。",
      "先说明缺的是哪一个数据源、权限或观测，再给出下一步排查建议。",
      "不要编造仓库位置、数字或未观测到的页面事实。",
    ],
    responseFormat: {
      chatbot: [
        "1. 这一个问题的建议动作，以及它是逐页处理还是共享模板处理。",
        "2. 在动作安全之前，用户还必须提供哪些事实。",
        "3. 验证清单和任何尚未被数据支持的假设。",
        "4. 你没有做的事，以及原因。",
      ],
      code_agent: [
        "1. 检查了哪些文件或路由，以及每个受影响 URL 如何映射到它们。",
        "2. 最小改动方案、聚焦测试和需要运行的命令。",
        "3. 验证结果、未解决事实和剩余风险。",
        "4. 哪些事因为没有授权而拒绝执行。",
      ],
    },
  },
};

function localized(
  value: Readonly<Record<SeoAiActionCopyLocale, string>> | string | null,
  locale: SeoAiActionCopyLocale,
): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value[locale];
}

function truthPreventsImplementation(
  truth: AgentAuditEvaluatedCheck["truth"],
): boolean {
  return (
    truth === "source-gated" ||
    truth === "unavailable" ||
    truth === "illustrative"
  );
}

function observationPayload(
  observation: AgentAffectedObservation,
  locale: SeoAiActionCopyLocale,
): {
  readonly url: string | null;
  readonly recordGroups: readonly {
    readonly recordId: string;
    readonly source: string;
    readonly truth: string;
    readonly values: readonly { readonly label: string; readonly value: string | number | boolean | null }[];
  }[];
} {
  return {
    url: observation.url,
    recordGroups: observation.recordGroups.map((group) => ({
      recordId: group.recordId,
      source: group.source[locale],
      truth: group.truth,
      values: group.values.map((value) => ({
        label: value.label,
        value: value.value,
      })),
    })),
  };
}

function buildPayload(
  input: BuildSeoAiActionCopyInput,
  observations: readonly AgentAffectedObservation[],
  includedUrls: number,
  omittedUrls: number,
) {
  const locale = input.locale;
  const check = input.selectedCheck.check;
  const urlObservations = observations.filter((entry) => entry.url !== null);
  const siteLevelCount = observations.length - urlObservations.length;

  return {
    schemaVersion: SEO_AI_ACTION_COPY_SCHEMA_VERSION,
    audience: input.audience,
    mode:
      input.audience === "chatbot" && truthPreventsImplementation(input.selectedCheck.truth)
        ? "investigation"
        : "implementation",
    selectedCheck: {
      id: check.id,
      groupId: check.groupId,
      scope: check.scope,
      title: localized(check.title, locale),
      result: input.selectedCheck.result,
      engine: input.selectedCheck.engine,
      truth: input.selectedCheck.truth,
      measurement: localized(input.selectedCheck.measurement, locale),
      threshold: localized(check.threshold, locale),
      thresholdAuthority: check.thresholdAuthority,
      dataSource: localized(check.dataSource, locale),
      issue: localized(check.impact, locale),
      howToFix: localized(check.howToFix, locale),
    },
    target: {
      targetUrl: input.targetUrl,
      country: input.profile.country,
      locale: input.profile.locale,
      device: input.profile.device,
      pageType: input.profile.pageType,
      auditScope: input.profile.auditScope,
      targetQuery: input.profile.targetQuery,
    },
    affected: {
      includedUrls,
      omittedUrls,
      siteLevelCount,
      observations: [
        ...urlObservations
          .slice(0, includedUrls)
          .map((observation) => observationPayload(observation, locale)),
        ...observations
          .filter((entry) => entry.url === null)
          .map((observation) => observationPayload(observation, locale)),
      ],
    },
    confirmedContext: {
      productName: input.profile.productName,
      primaryIcp: input.profile.primaryIcp,
      primaryCta: input.profile.primaryCta,
      firstOutcome: input.profile.firstOutcome,
      directCompetitors: input.profile.directCompetitors,
      indirectAlternatives: input.profile.indirectAlternatives,
    },
    proposedChange: {
      kind: input.solution.kind,
      presentation: input.solution.presentation,
      recommendation: input.content.recommendation,
      applicableContext: input.content.applicableContext,
      preview: input.solution.preview,
      validation: [...input.content.validation],
      impact: input.content.impact,
      risks: input.content.risks,
      limits: input.content.limits,
    },
    authority: {
      writesToRepository: false,
      writesToProduction: false,
      commitAllowed: false,
      pushAllowed: false,
      deployAllowed: false,
    },
  };
}

function renderMarkdown(
  chrome: CopyChrome,
  input: BuildSeoAiActionCopyInput,
  payload: ReturnType<typeof buildPayload>,
): string {
  const modeLabel =
    payload.mode === "investigation"
      ? chrome.investigationMode
      : input.audience === "chatbot"
        ? chrome.chatbotMode
        : chrome.codeAgentMode;
  const instructionList =
    payload.mode === "investigation"
      ? chrome.investigationInstructions
      : chrome.instructions[input.audience];

  return [
    `# ${chrome.title}`,
    "",
    `${chrome.modeLabel}: ${modeLabel}`,
    "",
    `> ${UNTRUSTED_DATA_NOTICE[input.locale]}`,
    "",
    `## ${chrome.dataHeading}`,
    fencedJson(payload),
    "",
    `## ${chrome.instructionsHeading}`,
    ...instructionList.map((item) => `- ${item}`),
    "",
    `## ${chrome.responseHeading}`,
    ...chrome.responseFormat[input.audience].map((item) => `- ${item}`),
  ].join("\n");
}

export function buildSeoAiActionCopy(
  input: BuildSeoAiActionCopyInput,
): BuildSeoAiActionCopyResult {
  if (
    input.audience === "code_agent" &&
    truthPreventsImplementation(input.selectedCheck.truth)
  ) {
    return { ok: false, reason: "evidence_unavailable" };
  }

  const chrome = CHROME[input.locale];
  const observations = agentAffectedObservations(
    input.selectedCheck,
    input.evidenceRecords,
    input.targetUrl,
  );
  const urlObservations = observations.filter((entry) => entry.url !== null);

  let includedUrls = urlObservations.length;
  while (includedUrls >= 0) {
    const payload = buildPayload(
      input,
      observations,
      includedUrls,
      urlObservations.length - includedUrls,
    );
    const markdown = renderMarkdown(chrome, input, payload);
    if (withinBriefBudget(markdown, SEO_AI_ACTION_COPY_MAX_BYTES)) {
      return {
        ok: true,
        markdown,
        includedUrls,
        omittedUrls: urlObservations.length - includedUrls,
      };
    }
    includedUrls -= 1;
  }

  return { ok: false, reason: "serialized_too_large" };
}
