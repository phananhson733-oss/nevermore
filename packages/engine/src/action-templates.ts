import type { RuleId } from "./rule.ts";

/**
 * Static ActionTemplate registry (spec §9.2). Actions are NEVER model-authored.
 * Each template fixes templateId / artifactType / effort / risk and provides
 * English + Simplified-Chinese title/description/expectedOutcome copy. On confirm
 * the project delivery locale selects the copy (zh-CN else English fallback); the
 * Action creation transaction never calls an LLM.
 */

export type ArtifactType =
  | "content_brief"
  | "metadata_rewrite"
  | "technical_ticket"
  | "english_blog_draft";
export type Effort = "small" | "medium" | "large";
export type Risk = "low" | "medium" | "high";
export type ContentLocale = "en" | "zh-CN";

export interface ActionCopy {
  readonly title: string;
  readonly description: string;
  readonly expectedOutcome: string;
}

export interface ActionTemplate {
  readonly templateId: string;
  readonly artifactType: ArtifactType;
  readonly templateVersion: 1 | 2;
  readonly effort: Effort;
  readonly risk: Risk;
  readonly copy: Readonly<Record<ContentLocale, ActionCopy>>;
}

export const ACTION_TEMPLATES: Record<RuleId, ActionTemplate> = {
  "TECH-HTTP-001": {
    templateId: "fix_http_status.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "medium",
    risk: "medium",
    copy: {
      en: {
        title: "Fix broken or error HTTP responses",
        description:
          "Restore or redirect URLs returning 4xx/5xx so users and crawlers reach live content.",
        expectedOutcome:
          "Affected URLs return 2xx or a correct redirect; crawl/index coverage recovers.",
      },
      "zh-CN": {
        title: "修复 HTTP 错误响应",
        description:
          "对返回 4xx/5xx 的 URL 进行修复或重定向，使用户与爬虫能到达有效内容。",
        expectedOutcome:
          "受影响 URL 返回 2xx 或正确重定向；抓取/收录覆盖恢复。",
      },
    },
  },
  "TECH-CANONICAL-002": {
    templateId: "normalize_canonical.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "medium",
    risk: "high",
    copy: {
      en: {
        title: "Normalize conflicting canonical tags",
        description:
          "Resolve reciprocal, broken-target, and sitemap-contradicting canonicals to a single authoritative URL.",
        expectedOutcome:
          "Each page declares one reachable, self-consistent canonical; duplication signals clear.",
      },
      "zh-CN": {
        title: "规范化冲突的 canonical 标签",
        description:
          "修正互指、指向失效目标、以及与 sitemap 矛盾的 canonical，统一到单一权威 URL。",
        expectedOutcome:
          "每个页面声明唯一可达且自洽的 canonical；重复信号消除。",
      },
    },
  },
  "TECH-INDEXABILITY-006": {
    templateId: "resolve_sitemap_indexability_conflict.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "medium",
    risk: "high",
    copy: {
      en: {
        title: "Resolve a sitemap and indexability conflict",
        description:
          "Confirm the intended index state, then align the sitemap entry and page-level indexability signal without changing the canonical URL unintentionally.",
        expectedOutcome:
          "The URL no longer has contradictory sitemap membership and indexability signals, while the intended canonical URL remains verifiable.",
      },
      "zh-CN": {
        title: "解决 Sitemap 与可索引性冲突",
        description:
          "先确认页面预期的收录状态，再协调 Sitemap 条目与页面级索引信号，避免误改 canonical URL。",
        expectedOutcome:
          "该 URL 的 Sitemap 成员关系与可索引性信号不再冲突，同时预期 canonical URL 仍可验证。",
      },
    },
  },
  "TECH-LINKGRAPH-005": {
    templateId: "repair_internal_link_architecture.v2",
    artifactType: "technical_ticket",
    templateVersion: 2,
    effort: "medium",
    risk: "low",
    copy: {
      en: {
        title: "Repair internal-link architecture opportunities",
        description:
          "Review low-inbound pages, shorten avoidable crawl paths, and verify unresolved internal targets before changing links.",
        expectedOutcome:
          "Important pages gain stronger internal support, crawl paths become shorter, and unresolved targets are verified or repaired.",
      },
      "zh-CN": {
        title: "修复内链架构机会",
        description:
          "检查低入链页面、缩短不必要的抓取路径，并在修改链接前核验未解析的内部目标。",
        expectedOutcome:
          "重要页面获得更强的内部支持，抓取路径缩短，未解析目标得到核验或修复。",
      },
    },
  },
  "SEARCH-CTR-004": {
    templateId: "rewrite_search_metadata.v1",
    artifactType: "metadata_rewrite",
    templateVersion: 1,
    effort: "small",
    risk: "low",
    copy: {
      en: {
        title: "Rewrite title and description for CTR",
        description:
          "Rewrite the page title and meta description to better match intent for pages ranking 1–10 with low CTR.",
        expectedOutcome:
          "More clicks at the same ranking as the snippet better matches searcher intent.",
      },
      "zh-CN": {
        title: "重写标题与描述以提升点击率",
        description:
          "针对排名 1–10 但点击率偏低的页面，重写标题与元描述以更贴合搜索意图。",
        expectedOutcome:
          "在排名不变的情况下获得更多点击，摘要更契合搜索者意图。",
      },
    },
  },
  "SEARCH-DECAY-002": {
    templateId: "refresh_decaying_content.v1",
    artifactType: "content_brief",
    templateVersion: 1,
    effort: "medium",
    risk: "low",
    copy: {
      en: {
        title: "Refresh content losing search demand",
        description:
          "Refresh and expand pages whose clicks dropped ≥20% to recover lost search demand.",
        expectedOutcome:
          "Declining pages regain relevance and recover clicks over the following period.",
      },
      "zh-CN": {
        title: "更新流失搜索需求的内容",
        description:
          "对点击量下降 ≥20% 的页面进行更新与扩充，以挽回流失的搜索需求。",
        expectedOutcome: "下滑页面恢复相关性，在随后周期内挽回点击。",
      },
    },
  },
  "CONTENT-COVERAGE-001": {
    templateId: "create_priority_content.v1",
    artifactType: "content_brief",
    templateVersion: 1,
    effort: "large",
    risk: "low",
    copy: {
      en: {
        title: "Create content for uncovered priority intent",
        description:
          "Create a page covering a priority offer or use case that currently has no matching indexable page.",
        expectedOutcome:
          "The priority intent gains a dedicated, indexable page that can rank and convert.",
      },
      "zh-CN": {
        title: "为未覆盖的优先意图创建内容",
        description:
          "为当前没有匹配可收录页面的优先 offer 或用例创建内容页面。",
        expectedOutcome: "该优先意图获得专属可收录页面，具备排名与转化潜力。",
      },
    },
  },
  "CONTENT-GAP-011": {
    templateId: "create_gap_content.v1",
    artifactType: "content_brief",
    templateVersion: 1,
    effort: "large",
    risk: "low",
    copy: {
      en: {
        title: "Create content for an uncovered keyword cluster",
        description:
          "Create decision-stage content for a high-volume keyword cluster with no matching indexable page.",
        expectedOutcome:
          "The cluster gains a targeted page that captures existing demand.",
      },
      "zh-CN": {
        title: "为未覆盖的关键词簇创建内容",
        description: "为无匹配可收录页面的高需求关键词簇创建决策阶段内容。",
        expectedOutcome: "该关键词簇获得针对性页面以承接既有需求。",
      },
    },
  },
  "CRO-PATH-001": {
    templateId: "connect_conversion_path.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "small",
    risk: "medium",
    copy: {
      en: {
        title: "Connect commercial pages to the conversion path",
        description:
          "Add direct internal links from commercial/priority pages to the conversion destination.",
        expectedOutcome:
          "Visitors on commercial pages reach the conversion action in one click.",
      },
      "zh-CN": {
        title: "打通商业页面到转化路径",
        description: "从商业/优先页面添加直达转化目标的内部链接。",
        expectedOutcome: "商业页面访客一键即可到达转化动作。",
      },
    },
  },
  "CRO-LANDING-003": {
    templateId: "improve_landing_conversion.v1",
    artifactType: "content_brief",
    templateVersion: 1,
    effort: "medium",
    risk: "medium",
    copy: {
      en: {
        title: "Improve underperforming landing conversion",
        description:
          "Improve the landing content and CTA for organic pages converting below site baseline.",
        expectedOutcome:
          "Landing key-event rate moves toward or above the site baseline.",
      },
      "zh-CN": {
        title: "改善转化偏低的落地页",
        description: "改进转化率低于站点基线的自然流量落地页的内容与 CTA。",
        expectedOutcome: "落地页关键事件转化率向站点基线靠拢或超越。",
      },
    },
  },
  "GEO-ENTITY-001": {
    templateId: "add_entity_and_proof.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "medium",
    risk: "medium",
    copy: {
      en: {
        title: "Add entity coverage and proof blocks",
        description:
          "Add named entities and specific proof (named customers + concrete numbers) to priority pages for AI/GEO citability.",
        expectedOutcome:
          "Priority pages carry verifiable entities and proof that AI answers can cite.",
      },
      "zh-CN": {
        title: "补充实体覆盖与佐证块",
        description:
          "为优先页面补充具名实体与具体佐证（具名客户 + 明确数字），提升 AI/GEO 可引用性。",
        expectedOutcome: "优先页面具备可验证的实体与佐证，便于 AI 回答引用。",
      },
    },
  },
  "GEO-CRAWLER-002": {
    templateId: "review_ai_crawler_access.v1",
    artifactType: "technical_ticket",
    templateVersion: 1,
    effort: "small",
    risk: "high",
    copy: {
      en: {
        title: "Review AI crawler access in robots.txt",
        description:
          "Review robots.txt rules that Disallow AI crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot) on commercial paths.",
        expectedOutcome:
          "AI crawler access is an intentional, documented decision rather than an accidental block.",
      },
      "zh-CN": {
        title: "审查 robots.txt 中的 AI 爬虫访问",
        description:
          "审查在商业路径上 Disallow AI 爬虫（OAI-SearchBot、ChatGPT-User、PerplexityBot、ClaudeBot）的 robots.txt 规则。",
        expectedOutcome: "AI 爬虫访问成为有意且有记录的决策，而非意外拦截。",
      },
    },
  },
};

/** Resolve action copy for a delivery locale (zh-CN else English fallback). */
export function resolveActionCopy(
  template: ActionTemplate,
  deliveryLocale: string,
): { copy: ActionCopy; contentLocale: ContentLocale } {
  if (deliveryLocale.toLowerCase() === "zh-cn") {
    return { copy: template.copy["zh-CN"], contentLocale: "zh-CN" };
  }
  return { copy: template.copy.en, contentLocale: "en" };
}
