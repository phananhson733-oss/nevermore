/**
 * Deterministic content_brief template (spec §10.1). Produces markdown with all
 * required `## ` sections, populated from the allowlisted prompt input. The
 * output round-trips through the content_brief validator in both locales.
 */

import type { ArtifactPromptInput, EvidenceExcerpt } from "../types.ts";
import { CONTENT_BRIEF_SECTIONS } from "../validators/sections.ts";
import {
  bullets,
  checklist,
  clean,
  deriveTargetQueries,
  isZh,
  pick,
  renderMarkdown,
} from "./util.ts";

function evidenceLines(evidence: readonly EvidenceExcerpt[], zh: boolean): string[] {
  return evidence.map((e) => {
    const grade = pick(zh, `等级 ${clean(e.grade)}`, `grade ${clean(e.grade)}`);
    const observed = pick(zh, `观测于 ${clean(e.observedAt)}`, `observed ${clean(e.observedAt)}`);
    return `[${clean(e.evidenceId)}] ${clean(e.claim)} (${grade}, ${observed})`;
  });
}

function sectionBody(key: string, input: ArtifactPromptInput, zh: boolean): string {
  const { icp, action, finding, evidence } = input;
  switch (key) {
    case "objective": {
      const outcome = pick(
        zh,
        `预期成果：${clean(action.expectedOutcome)}`,
        `Expected outcome: ${clean(action.expectedOutcome)}`,
      );
      return `${clean(action.title)}\n\n${clean(finding.summary)}\n\n${outcome}`;
    }
    case "audience": {
      const head = pick(
        zh,
        `面向 ${clean(icp.productName)} 的目标受众：${clean(icp.oneLineDescription)}。`,
        `Primary audience for ${clean(icp.productName)}: ${clean(icp.oneLineDescription)}.`,
      );
      const uses = bullets(
        icp.useCases,
        pick(zh, "补充目标受众的核心使用场景。", "Add the core use cases for the target audience."),
      );
      return `${head}\n\n${uses}`;
    }
    case "searchIntent":
      return pick(
        zh,
        `围绕「${clean(finding.domain)}」域的搜索意图：${clean(finding.summary)}`,
        `Search intent for the ${clean(finding.domain)} domain: ${clean(finding.summary)}`,
      );
    case "targetQueries":
      return bullets(
        deriveTargetQueries(input),
        pick(
          zh,
          "根据确认的 Finding 与 ICP 用例补充目标查询。",
          "Add target queries from the confirmed finding and ICP use cases.",
        ),
      );
    case "outline":
      return bullets(
        [
          pick(zh, "引言：点明搜索意图与读者问题", "Introduction: state the search intent and reader problem"),
          pick(zh, "核心章节：逐一覆盖目标查询", "Core sections: cover each target query in turn"),
          pick(zh, "证据与实例：引用下方 Evidence", "Evidence and examples: cite the Evidence below"),
          pick(zh, "差异化论证：突出产品独特价值", "Differentiation: highlight the product's unique value"),
          pick(zh, "转化收尾：引导至主转化路径", "Conversion close: lead into the primary conversion path"),
        ],
        pick(zh, "补充内容大纲。", "Add the content outline."),
      );
    case "evidence":
      return bullets(
        evidenceLines(evidence, zh),
        pick(
          zh,
          "尚无证据摘录；发布前必须引用已确认的 Finding 与数值，不得补造。",
          "No evidence excerpts provided; cite confirmed findings and numbers before publishing, never fabricate.",
        ),
      );
    case "conversionPath": {
      const conv = icp.primaryConversion;
      const target = conv?.targetUrl ? ` → ${clean(conv.targetUrl)}` : "";
      const head = conv
        ? pick(
            zh,
            `主转化：${clean(conv.label)}（类型 ${clean(conv.type)}）${target}`,
            `Primary conversion: ${clean(conv.label)} (type ${clean(conv.type)})${target}`,
          )
        : pick(zh, "尚未定义主转化路径；请补充明确的 CTA。", "No primary conversion defined; add an explicit CTA.");
      const offers = bullets(
        icp.offers,
        pick(zh, "补充与本内容相关的产品/服务。", "Add the offers relevant to this content."),
      );
      return `${head}\n\n${offers}`;
    }
    case "proofRequirements": {
      const rule = pick(
        zh,
        "每条事实性主张必须引用上方 Evidence（等级 A–C），未知数值写「待确认」，不得补造。",
        "Every factual claim must cite the Evidence above (grade A–C); mark unknown numbers as unknown and never fabricate.",
      );
      const diffs = bullets(
        icp.differentiators,
        pick(zh, "补充需要证明的差异化主张。", "Add the differentiators that require proof."),
      );
      return `${rule}\n\n${diffs}`;
    }
    case "acceptanceChecklist":
      return checklist([
        pick(zh, "覆盖全部目标主题与查询", "Covers all target topics and queries"),
        pick(zh, "每条主张都引用了 Evidence", "Every claim cites an Evidence excerpt"),
        pick(zh, "包含主转化路径 CTA", "Includes the primary conversion CTA"),
        pick(
          zh,
          `达成预期成果：${clean(action.expectedOutcome)}`,
          `Meets the expected outcome: ${clean(action.expectedOutcome)}`,
        ),
        pick(zh, "证明与来源要求已满足", "Proof and source requirements satisfied"),
      ]);
    default:
      return pick(zh, "待补充。", "To be completed.");
  }
}

export function build(input: ArtifactPromptInput): string {
  const zh = isZh(input.outputLocale);
  const sections = CONTENT_BRIEF_SECTIONS.map((def) => ({
    heading: zh ? def.zh : def.en,
    body: sectionBody(def.key, input, zh),
  }));
  return renderMarkdown(sections);
}
