/**
 * Audit artifacts (plan Task 11; jsx:692-714). Bodies are unstamped (R5). The
 * fix task is a prompt: its title and instructions are fixed text, and every
 * site or finding field sits in an announced data block (R6). Findings are
 * sample data, so the prompt calls them sample observations and asks for a
 * reproduction first (R10).
 */
import { SEVERITIES } from "../../enums.ts";
import type { AuditReport, Finding, Profile } from "../../types.ts";
import { toCsv } from "../csv.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { ENGINE_LABEL, SEVERITY_ZH } from "../labels-zh.ts";
import { domainOf } from "../text.ts";
import { joinParts } from "./compose.ts";

export interface FixTaskInput {
  readonly report: AuditReport;
  readonly profile: Profile;
  readonly stack: string;
}

const TICKET_HEADER = [
  "id",
  "category",
  "issue",
  "severity",
  "engine",
  "page",
  "detected",
  "expected",
  "fix",
] as const;

/** Severity and engine columns carry ids (R7), so the export filters the same in any locale. */
export function ticketCsv(findings: readonly Finding[]): string {
  return toCsv(
    TICKET_HEADER,
    findings.map((f) => [
      f.id,
      f.cat,
      f.t,
      f.sev,
      f.eng,
      f.page,
      f.found,
      f.expect,
      f.fix,
    ]),
  );
}

function findingData(finding: Finding): unknown {
  return {
    id: finding.id,
    severity: SEVERITY_ZH[finding.sev],
    engine: ENGINE_LABEL[finding.eng],
    title: finding.t,
    page: finding.page,
    sampleObservation: finding.found,
    expected: finding.expect,
    suggestion: finding.fix,
  };
}

function executionSteps(): string {
  // Spelled from the same labels as the findings block, so the order cannot drift from the data.
  const order = SEVERITIES.map((severity) => SEVERITY_ZH[severity]).join(" → ");
  return [
    "1. 先只读扫描仓库，为每个问题定位到具体文件与行号，不要直接改。",
    "2. 输出改动计划：问题 ID → 文件路径 → 改什么 → 风险 → 验证方式。",
    `3. 我确认后按 ${order} 分批提交，一个问题一个 commit。`,
    "4. 模板级问题优先于单页修补；不要为通过检查造用户看不见的内容。",
    "5. 每条给出我能自己复跑的验收方法（命令、URL 或校验器）。",
  ].join("\n");
}

export function fixTaskPrompt({ report, profile, stack }: FixTaskInput): string {
  const site = {
    url: profile.url,
    domain: domainOf(profile.url),
    brand: profile.brand,
    positioning: profile.positioning,
    stack,
    auditedAt: report.at,
    score: report.score,
    findingCount: report.findings.length,
  };
  return joinParts([
    "# 任务：修复站点的 SEO / GEO 技术问题",
    "以下问题由示例数据生成，先逐条在仓库里复现；复现不了的直接丢弃，不要为了“修复”去制造改动。",
    "## 站点",
    dataSection(fenceJson(site)),
    "## 问题清单",
    dataSection(fenceJson(report.findings.map(findingData))),
    "## 执行要求",
    executionSteps(),
  ]);
}
