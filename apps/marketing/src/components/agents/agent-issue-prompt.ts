// @input  -- one projected issue plus the provenance of the run it came from
// @output -- bounded plain-text handoff for a single issue, in the reader's locale
// @pos    -- pure text builder; reads no session, storage, or network state

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditLocalizedText } from "@sf/public-tools/agent-audit";

import type { AgentIssue } from "./agent-issue-model";

/**
 * Longest observation value copied verbatim.
 *
 * Observation values hold page content — a title, a heading, a link target. A
 * bound keeps the handoff reviewable and stops an unexpectedly large value from
 * turning a prompt into a document dump.
 */
export const AGENT_ISSUE_VALUE_CHAR_LIMIT = 160;

type PromptLocale = "en" | "zh";

export interface AgentIssuePromptRun {
  readonly completedAt: string;
  readonly sourceTool: string;
  readonly schemaVersion: string;
}

export interface BuildAgentIssuePromptInput {
  readonly issue: AgentIssue;
  readonly locale: string;
  readonly run: AgentIssuePromptRun;
  /** The page this run was about, when one page was the subject. */
  readonly targetUrl?: string;
}

const LABELS = {
  zh: {
    repairIntro:
      "以下是一次 SEO 审计中的单个问题。请只处理这一个问题，不要推断其他页面或其他检查项的状态。",
    investigationIntro:
      "以下是一次 SEO 审计中未能取得数据的单个检查项。本次运行未取得该来源的数据，因此没有得出任何结论。请只梳理确认证据所需的调查顺序，不要提出或执行修复。",
    check: "检查项",
    severity: "严重度",
    rule: "判定规则",
    measured: "本次测量",
    affected: "受影响 URL",
    affectedSite: "影响范围：站点级，本次观测未定位到具体 URL",
    affectedMore: (shown: number, total: number, rest: number) =>
      `以上为 ${total} 个受影响 URL 中的前 ${shown} 个，另有 ${rest} 个未列出`,
    evidence: "证据",
    evidenceRecord: "记录",
    evidenceTested: "已测",
    evidenceAffected: "命中",
    limitation: "证据限制",
    boundary: "证据边界",
    repairTask: "任务",
    repairSteps: "参考修复方向",
    investigationTask: "调查任务",
    investigationSteps: "候选调查方向（未经证据确认，不得据此直接修改站点）",
    unavailableNote:
      "该检查项的受影响范围本次不可得。不可得不等于 0，请不要把它当作「没有问题」。",
    rules: [
      "只针对上面列出的这一个问题作答。",
      "不要假设本产品的框架、目录结构或文件路径；先要求我确认真实的实现位置。",
      "如果上面的证据不足以判断，请直接说明还缺什么，不要猜测。",
    ],
    investigationRules: [
      "不要声称该问题已经存在或已经排除——本次运行没有得出结论。",
      "先列出确认该结论所需的证据与获取顺序，再说明每一步能排除什么。",
      "不要假设本产品的框架、目录结构或文件路径。",
    ],
    provenance: "来源",
    provenanceLine: (run: AgentIssuePromptRun) =>
      `${run.sourceTool} · ${run.schemaVersion} · 观测时间 ${run.completedAt}`,
    target: "本次目标",
    severities: {
      blocker: "阻断",
      warning: "警告",
      suggestion: "建议",
    },
  },
  en: {
    repairIntro:
      "Below is a single issue from one SEO audit. Work on this issue only; do not infer the state of any other page or check.",
    investigationIntro:
      "Below is a single check from an SEO audit that could not be answered. This run obtained no data from that source and therefore reached no conclusion. Map out the investigation needed to establish the evidence; do not propose or apply a repair.",
    check: "Check",
    severity: "Severity",
    rule: "Decision rule",
    measured: "Measured this run",
    affected: "Affected URLs",
    affectedSite:
      "Scope: site level. This observation resolved to no individual URL.",
    affectedMore: (shown: number, total: number, rest: number) =>
      `Listed ${shown} of ${total} affected URLs; ${rest} more not listed`,
    evidence: "Evidence",
    evidenceRecord: "record",
    evidenceTested: "tested",
    evidenceAffected: "affected",
    limitation: "Evidence limitation",
    boundary: "Evidence boundary",
    repairTask: "Task",
    repairSteps: "Suggested direction",
    investigationTask: "Investigation task",
    investigationSteps:
      "Candidate directions (unconfirmed by evidence; do not change the site on this basis)",
    unavailableNote:
      "The affected population is unavailable for this check. Unavailable is not zero; do not read it as 'no problem'.",
    rules: [
      "Answer only for the single issue above.",
      "Do not assume this product's framework, directory layout, or file paths; ask me to confirm the real implementation location first.",
      "If the evidence above is not enough to decide, say what is missing rather than guessing.",
    ],
    investigationRules: [
      "Do not claim the issue is present or ruled out — this run reached no conclusion.",
      "List the evidence needed and the order to obtain it, then say what each step rules out.",
      "Do not assume this product's framework, directory layout, or file paths.",
    ],
    provenance: "Source",
    provenanceLine: (run: AgentIssuePromptRun) =>
      `${run.sourceTool} · ${run.schemaVersion} · observed ${run.completedAt}`,
    target: "Run target",
    severities: {
      blocker: "Blocker",
      warning: "Warning",
      suggestion: "Suggestion",
    },
  },
} as const;

function promptLocale(locale: string): PromptLocale {
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function text(value: AgentAuditLocalizedText, locale: PromptLocale): string {
  return value[locale];
}

/** Keep a value reviewable, and say when it was cut rather than cutting silently. */
function boundedValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const raw = String(value);
  if (raw.length <= AGENT_ISSUE_VALUE_CHAR_LIMIT) return raw;
  return `${raw.slice(0, AGENT_ISSUE_VALUE_CHAR_LIMIT)}…`;
}

function evidenceLines(
  records: readonly SeoAuditRecord[],
  locale: PromptLocale,
): readonly string[] {
  const labels = LABELS[locale];
  return records.flatMap((record) => {
    const head = `- ${labels.evidenceRecord} ${record.id} · ${labels.evidenceTested} ${record.tested} · ${labels.evidenceAffected} ${record.affected}`;
    const values = record.observations
      .flatMap((observation) => observation.values)
      .slice(0, 6)
      .map(
        (entry) => `    ${entry.label}: ${boundedValue(entry.value)}`,
      );
    const limitation =
      record.limitation === null
        ? []
        : [`    ${labels.limitation}: ${record.limitation}`];
    return [head, ...values, ...limitation];
  });
}

/**
 * Build the text one issue hands to an assistant.
 *
 * Two modes, because two different things are true. A repair prompt carries an
 * observed finding and may ask for a fix. An investigation prompt carries a
 * check whose source never answered: it states that no conclusion was reached
 * and asks only for the evidence path, so a gated check cannot be laundered
 * into a repair order.
 *
 * Everything in the output comes from the issue and the run's provenance. No
 * session, account, credential, or raw response body is reachable from here.
 */
export function buildAgentIssuePrompt({
  issue,
  locale,
  run,
  targetUrl,
}: BuildAgentIssuePromptInput): string {
  const lang = promptLocale(locale);
  const labels = LABELS[lang];
  const check = issue.check.check;
  const investigation = issue.copyMode === "investigation";

  const lines: string[] = [
    investigation ? labels.investigationIntro : labels.repairIntro,
    "",
    `${labels.check}: ${check.id} · ${text(check.title, lang)}`,
  ];

  if (issue.severity !== null) {
    lines.push(`${labels.severity}: ${labels.severities[issue.severity]}`);
  }
  if (targetUrl !== undefined) {
    lines.push(`${labels.target}: ${targetUrl}`);
  }

  lines.push(`${labels.rule}: ${text(check.threshold, lang)}`);

  const measurement = issue.check.measurement;
  if (measurement !== null && measurement !== undefined) {
    lines.push(`${labels.measured}: ${text(measurement, lang)}`);
  }

  lines.push("");

  if (investigation || issue.affected.mode === "unavailable") {
    lines.push(labels.unavailableNote, "");
  } else if (issue.affected.mode === "site-scope") {
    lines.push(labels.affectedSite, "");
  } else if (issue.affected.urls.length > 0) {
    lines.push(`${labels.affected}:`);
    for (const url of issue.affected.urls) lines.push(`- ${url}`);
    if (issue.affected.overflowCount > 0) {
      lines.push(
        labels.affectedMore(
          issue.affected.urls.length,
          issue.affected.totalCount ?? issue.affected.urls.length,
          issue.affected.overflowCount,
        ),
      );
    }
    lines.push("");
  }

  const evidence = evidenceLines(issue.evidenceRecords, lang);
  if (evidence.length > 0) {
    lines.push(`${labels.evidence}:`, ...evidence, "");
  }

  lines.push(`${labels.boundary}: ${text(check.boundary, lang)}`, "");

  lines.push(
    investigation ? `${labels.investigationTask}:` : `${labels.repairTask}:`,
  );
  lines.push(
    investigation
      ? `${labels.investigationSteps}: ${text(check.howToFix, lang)}`
      : `${labels.repairSteps}: ${text(check.howToFix, lang)}`,
  );
  lines.push("");

  for (const rule of investigation ? labels.investigationRules : labels.rules) {
    lines.push(`- ${rule}`);
  }

  lines.push("", `${labels.provenance}: ${labels.provenanceLine(run)}`);

  return lines.join("\n");
}
