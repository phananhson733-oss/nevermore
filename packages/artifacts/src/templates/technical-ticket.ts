/**
 * Deterministic technical_ticket template (spec §10.1). Produces markdown with
 * all required `## ` sections — including Validation and Rollback, which are
 * always emitted so a high-risk change (spec §9.3 step 8) is never missing them.
 * The output round-trips through the technical_ticket validator in both locales.
 */

import type { ArtifactPromptInput, EvidenceExcerpt } from "../types.ts";
import { TECHNICAL_TICKET_SECTIONS } from "../validators/sections.ts";
import { bullets, checklist, clean, isZh, numbered, pick, renderMarkdown } from "./util.ts";

function evidenceLines(evidence: readonly EvidenceExcerpt[], zh: boolean): string[] {
  return evidence.map((e) => {
    const grade = pick(zh, `等级 ${clean(e.grade)}`, `grade ${clean(e.grade)}`);
    const observed = pick(zh, `观测于 ${clean(e.observedAt)}`, `observed ${clean(e.observedAt)}`);
    return `[${clean(e.evidenceId)}] ${clean(e.claim)} (${grade}, ${observed})`;
  });
}

function evidenceIds(evidence: readonly EvidenceExcerpt[], zh: boolean): string {
  const ids = evidence.map((e) => clean(e.evidenceId)).filter((id) => id.length > 0);
  if (ids.length === 0) {
    return pick(zh, "无", "none");
  }
  return ids.join(zh ? "、" : ", ");
}

function sectionBody(key: string, input: ArtifactPromptInput, zh: boolean): string {
  const { action, finding, evidence } = input;
  switch (key) {
    case "problem": {
      const severity = pick(
        zh,
        `严重度：${clean(finding.severity)}；置信度：${clean(finding.confidence)}。`,
        `Severity: ${clean(finding.severity)}; confidence: ${clean(finding.confidence)}.`,
      );
      return `${clean(action.title)}\n\n${clean(finding.summary)}\n\n${severity}`;
    }
    case "affectedScope": {
      const domain = pick(zh, `受影响的域：${clean(finding.domain)}。`, `Affected domain: ${clean(finding.domain)}.`);
      const scope = bullets(
        finding.subjectRefs,
        pick(zh, "补充受影响的 URL 或资源。", "Add the affected URLs or resources."),
      );
      return `${domain}\n\n${scope}`;
    }
    case "evidence":
      return bullets(
        evidenceLines(evidence, zh),
        pick(
          zh,
          "尚无证据摘录；实施前必须引用已确认的 Finding 与数值，不得补造。",
          "No evidence excerpts provided; cite confirmed findings and numbers before implementing, never fabricate.",
        ),
      );
    case "implementationSteps":
      return numbered(
        [
          clean(action.description),
          pick(zh, "对照上方影响范围核对每一处改动。", "Verify each change against the affected scope above."),
          pick(zh, "对照引用的 Evidence 复核结果。", "Re-check the outcome against the cited Evidence."),
        ],
        pick(zh, "补充实施步骤。", "Add the implementation steps."),
      );
    case "acceptanceTests":
      return checklist([
        pick(
          zh,
          `达成预期成果：${clean(action.expectedOutcome)}`,
          `Meets the expected outcome: ${clean(action.expectedOutcome)}`,
        ),
        pick(zh, "受影响范围内无回归", "No regressions across the affected scope"),
        pick(zh, "引用的 Evidence 指标已复验", "Cited Evidence metrics re-verified"),
      ]);
    case "risk": {
      const base = pick(
        zh,
        `风险等级：${clean(action.risk)}；工作量：${clean(action.effort)}。`,
        `Risk level: ${clean(action.risk)}; effort: ${clean(action.effort)}.`,
      );
      if (input.requiresValidationRollback) {
        const note = pick(
          zh,
          "这是高风险技术改动：不得自动置为 ready，必须完成下方 Validation 与 Rollback。",
          "This is a high-risk change: it must not be auto-set ready; complete the Validation and Rollback sections below.",
        );
        return `${base}\n\n${note}`;
      }
      return base;
    }
    case "validation":
      return pick(
        zh,
        `重新运行「${clean(finding.domain)}」域的检查并确认：${clean(action.expectedOutcome)}。对照 Evidence 复验：${evidenceIds(evidence, zh)}。`,
        `Re-run the ${clean(finding.domain)} domain checks and confirm: ${clean(action.expectedOutcome)}. Validate against Evidence: ${evidenceIds(evidence, zh)}.`,
      );
    case "rollback":
      return pick(
        zh,
        "若验证失败，回滚本次改动集并恢复先前配置，并在变更日志中记录回滚。",
        "If validation fails, revert this change set, restore the previous configuration, and record the rollback in the change log.",
      );
    default:
      return pick(zh, "待补充。", "To be completed.");
  }
}

export function build(input: ArtifactPromptInput): string {
  const zh = isZh(input.outputLocale);
  const sections = TECHNICAL_TICKET_SECTIONS.map((def) => ({
    heading: zh ? def.zh : def.en,
    body: sectionBody(def.key, input, zh),
  }));
  return renderMarkdown(sections);
}
