import type { GeoKnowledgeUnavailableReason } from "../../lib/geo-tools/kb-knowledge-pack-contract.ts";

export interface GeoKnowledgePackCopy {
  readonly sections: {
    readonly entity: string;
    readonly facts: string;
    readonly qa: string;
    readonly comparisons: string;
    readonly scope: string;
    readonly evidence: string;
    readonly machine: string;
    readonly coverage: string;
  };
  readonly fields: Record<string, string>;
  readonly factTypes: Record<string, string>;
  readonly intents: Record<string, string>;
  readonly scopeGroups: Record<string, string>;
  readonly evidenceGroups: Record<string, string>;
  readonly machineFields: Record<string, string>;
  readonly machineStatuses: Record<string, string>;
  readonly coverageStatuses: Record<string, string>;
  readonly comparisonStatuses: Record<string, string>;
  readonly unavailable: Record<GeoKnowledgeUnavailableReason, string>;
  readonly evidenceBasis: string;
  readonly partial: string;
  readonly notRecorded: string;
  readonly none: string;
  readonly yes: string;
  readonly no: string;
}

const EN: GeoKnowledgePackCopy = {
  sections: {
    entity: "Entity definition",
    facts: "Reliable facts",
    qa: "Questions and answers",
    comparisons: "Comparison knowledge",
    scope: "Scope and boundaries",
    evidence: "Evidence and trust",
    machine: "Machine-readable readiness",
    coverage: "Coverage and gaps",
  },
  fields: {
    aliases: "Also known as",
    categories: "Categories",
    shortDefinition: "Concise definition",
    standardDefinition: "Standard definition",
    detailedDefinition: "Detailed definition",
    audience: "For",
    notFor: "Not for",
    company: "Company information",
    disambiguation: "How to distinguish it",
    officialLinks: "Official links",
    variants: "Related ways people ask",
    directAnswer: "Direct answer",
    detail: "Additional context",
    product: "This product",
    verdict: "Summary",
    checkedAt: "Evidence checked",
    nextAction: "Recommended next step",
    observedAt: "Evidence observed",
    nextReviewAt: "Review again",
    types: "Detected types",
    locales: "Detected locales",
    sitemapUrls: "URLs listed",
    knowledgePages: "Knowledge pages listed",
  },
  factTypes: {
    price: "Price",
    policy: "Policy",
    feature: "Feature",
    integration: "Integration",
    company: "Company",
    audience: "Audience",
    data: "Data",
    other: "Other",
  },
  intents: {
    definition: "Definition",
    comparison: "Comparison",
    price: "Price",
    operation: "How it works",
    trust: "Trust",
    boundary: "Boundary",
    alternative: "Alternative",
    applicability: "Applicability",
    other: "Other",
  },
  scopeGroups: {
    does: "What it does",
    doesNot: "What it does not do",
    needsHuman: "Where people are still needed",
    misconceptions: "Common misconceptions",
  },
  evidenceGroups: {
    proof: "First-party proof",
    changelog: "Product changes",
    press: "Press coverage",
    thirdPartyProfiles: "Third-party profiles",
  },
  machineFields: {
    jsonLd: "Structured data",
    llms: "llms.txt",
    robots: "robots.txt",
    sitemap: "Sitemap",
    hreflang: "Language targeting",
  },
  machineStatuses: {
    present: "Present",
    absent: "Not detected",
    unreachable: "Could not be reached",
    not_checked: "Not checked",
  },
  coverageStatuses: { covered: "Covered", partial: "Partly covered", missing: "Missing" },
  comparisonStatuses: { available: "Compared", partial: "Partial evidence", unavailable: "Not enough evidence" },
  unavailable: {
    not_collected: "This information has not been collected yet.",
    not_published: "No published information was found for this section.",
    not_found: "The expected public information was not found.",
    timeout: "Reading the public pages timed out, so this section cannot be confirmed yet.",
    fetch_failed: "The public pages could not be read, so this section cannot be confirmed yet.",
    blocked: "The public pages blocked access, so this section cannot be confirmed yet.",
    rate_limited: "The public sources temporarily limited access.",
    invalid_response: "The public source returned content that could not be verified.",
    partial_body: "Only part of the public source was readable.",
    unsupported_language: "This language is not supported for knowledge synthesis yet.",
    generation_unavailable: "Knowledge synthesis was unavailable for this section.",
    outcome_unknown: "The synthesis outcome is unknown, so no result is shown.",
    insufficient_evidence: "The available evidence is not sufficient to form this section yet.",
    not_applicable: "This section does not apply to the current product.",
    context_stale: "The saved source context changed before this section could be completed.",
  },
  evidenceBasis: "Public basis",
  partial: "Current limitation",
  notRecorded: "Not recorded",
  none: "None",
  yes: "Yes",
  no: "No",
};

const ZH: GeoKnowledgePackCopy = {
  sections: {
    entity: "实体定义",
    facts: "可靠事实",
    qa: "问答知识",
    comparisons: "对比知识",
    scope: "能力边界",
    evidence: "证据与可信度",
    machine: "机器可读状态",
    coverage: "覆盖与缺口",
  },
  fields: {
    aliases: "其他名称",
    categories: "所属类别",
    shortDefinition: "核心定义",
    standardDefinition: "标准说明",
    detailedDefinition: "详细说明",
    audience: "适合谁",
    notFor: "不适合谁",
    company: "公司信息",
    disambiguation: "如何区分",
    officialLinks: "官方链接",
    variants: "用户也可能这样问",
    directAnswer: "直接回答",
    detail: "补充说明",
    product: "当前产品",
    verdict: "对比结论",
    checkedAt: "证据核对日期",
    nextAction: "建议下一步",
    observedAt: "证据日期",
    nextReviewAt: "建议复核日期",
    types: "已识别类型",
    locales: "已识别语言",
    sitemapUrls: "已列出网址",
    knowledgePages: "是否列出知识页面",
  },
  factTypes: {
    price: "价格",
    policy: "政策",
    feature: "功能",
    integration: "集成",
    company: "公司",
    audience: "适用人群",
    data: "数据",
    other: "其他",
  },
  intents: {
    definition: "定义",
    comparison: "对比",
    price: "价格",
    operation: "使用方式",
    trust: "可信度",
    boundary: "边界",
    alternative: "替代方案",
    applicability: "适用性",
    other: "其他",
  },
  scopeGroups: {
    does: "可以做什么",
    doesNot: "不能做什么",
    needsHuman: "仍需人工参与",
    misconceptions: "常见误解",
  },
  evidenceGroups: {
    proof: "第一方证明",
    changelog: "产品更新",
    press: "媒体报道",
    thirdPartyProfiles: "第三方档案",
  },
  machineFields: {
    jsonLd: "结构化数据",
    llms: "llms.txt",
    robots: "robots.txt",
    sitemap: "站点地图",
    hreflang: "语言定位",
  },
  machineStatuses: {
    present: "已检测到",
    absent: "未检测到",
    unreachable: "无法访问",
    not_checked: "尚未检查",
  },
  coverageStatuses: { covered: "已覆盖", partial: "部分覆盖", missing: "缺失" },
  comparisonStatuses: { available: "已有对比", partial: "证据不完整", unavailable: "证据不足" },
  unavailable: {
    not_collected: "这部分信息尚未采集。",
    not_published: "没有找到这部分已公开的信息。",
    not_found: "没有找到预期的公开信息。",
    timeout: "读取公开页面超时，暂时无法确认这部分内容。",
    fetch_failed: "公开页面读取失败，暂时无法确认这部分内容。",
    blocked: "公开页面限制了访问，暂时无法确认这部分内容。",
    rate_limited: "公开来源暂时限制了读取频率。",
    invalid_response: "公开来源返回的内容无法验证。",
    partial_body: "只能读取公开来源的部分内容。",
    unsupported_language: "当前语言暂不支持生成这部分知识。",
    generation_unavailable: "本次无法生成这部分知识。",
    outcome_unknown: "本次生成结果未知，因此没有展示未经确认的内容。",
    insufficient_evidence: "现有证据不足，暂时无法形成这部分内容。",
    not_applicable: "这部分不适用于当前产品。",
    context_stale: "保存的来源在生成完成前发生了变化。",
  },
  evidenceBasis: "公开依据",
  partial: "当前限制",
  notRecorded: "未记录",
  none: "无",
  yes: "是",
  no: "否",
};

export function geoKnowledgePackCopy(locale: string): GeoKnowledgePackCopy {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
