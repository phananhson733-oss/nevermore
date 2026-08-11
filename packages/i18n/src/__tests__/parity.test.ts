import { describe, it, expect } from "vitest";

import { DEFAULT_LOCALE } from "../config.ts";
import en from "../messages/en.json";
import zhCN from "../messages/zh-CN.json";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Recursively collect the full dotted key paths of a message object.
 * Only object nodes are descended into; every leaf (including arrays and
 * primitives) yields a terminal path. Backs AC-011 (locale key parity).
 */
function collectKeyPaths(value: Json, prefix = ""): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return collectKeyPaths(value[key] as Json, nextPrefix);
    });
}

describe("i18n message key parity", () => {
  const enPaths = collectKeyPaths(en as unknown as Json);
  const zhPaths = collectKeyPaths(zhCN as unknown as Json);
  const enSet = new Set(enPaths);
  const zhSet = new Set(zhPaths);

  const missingInZh = enPaths.filter((path) => !zhSet.has(path));
  const missingInEn = zhPaths.filter((path) => !enSet.has(path));

  it("has no keys present in en but missing in zh-CN", () => {
    expect(missingInZh, `Keys in en.json missing from zh-CN.json:\n${missingInZh.join("\n")}`).toEqual([]);
  });

  it("has no keys present in zh-CN but missing in en", () => {
    expect(missingInEn, `Keys in zh-CN.json missing from en.json:\n${missingInEn.join("\n")}`).toEqual([]);
  });

  it("has identical key sets across locales", () => {
    expect(new Set(enPaths)).toEqual(new Set(zhPaths));
  });

  it("keeps the GenGrowth customer brand Chinese-first", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(en.auth.subtitle).toBe("Sign in to your GenGrowth workspace.");
    expect(zhCN.auth.subtitle).toBe("登录你的 GenGrowth 工作区。");
    expect(en.provider.system).toBe("GenGrowth system");
    expect(zhCN.provider.system).toBe("GenGrowth 系统");
    expect(en.diagnosis.evidence.provider.system).toBe("GenGrowth system");
    expect(zhCN.diagnosis.evidence.provider.system).toBe("GenGrowth 系统");

    expect(JSON.stringify(en)).not.toContain("SignalFrame");
    expect(JSON.stringify(zhCN)).not.toContain("SignalFrame");
  });

  it("describes exactly three customer-managed connectors and an honest GitHub plan", () => {
    expect(en.sources.connections).toEqual({
      customerTitle: "Customer-managed connections",
      customerDescription:
        "Connect the analysis and delivery services your team manages.",
      githubLabel: "GitHub",
      githubStatus: "Planned",
      githubDescription:
        "Reserved for approved pull-request and merge workflows. GenGrowth cannot access repositories or create pull requests yet.",
    });
    expect(zhCN.sources.connections).toEqual({
      customerTitle: "客户可管理连接",
      customerDescription: "连接由你的团队管理的分析与交付服务。",
      githubLabel: "GitHub",
      githubStatus: "待接入",
      githubDescription:
        "为已批准的拉取请求与合并流程预留。GenGrowth 当前不会访问代码仓库或创建拉取请求。",
    });
  });

  it("localizes the GA4 key-event input placeholder instead of hardcoding UI chrome", () => {
    expect(en.sources.keyEventsPlaceholder).toBe("purchase, sign_up");
    expect(zhCN.sources.keyEventsPlaceholder).toBe("购买, 注册");
  });

  it("keeps Growth Map chrome Chinese-first while preserving canonical ID terms", () => {
    expect(zhCN.nav).toMatchObject({
      overview: "概览",
      growthMap: "增长地图",
      execution: "执行中心",
      results: "效果追踪",
    });
    expect(zhCN.growthMap).toMatchObject({
      selectedUrl: "所选 URL",
      observedMetricsEyebrow: "审计证据 · 只读",
      findingsEyebrow: "机会审核",
    });
    expect(zhCN.growthMap.ids).toEqual({
      observation: "观测记录 ID（Observation）",
      evidence: "证据 ID（Evidence）",
      finding: "问题记录 ID（Finding）",
      pageSnapshot: "页面快照 ID（PageSnapshot）",
      snapshot: "数据快照 ID（Snapshot）",
      sitePage: "页面对象 ID（SitePage）",
      diagnosticRun: "诊断运行 ID",
      crawlSnapshot: "抓取快照 ID",
    });
    expect(en.growthMap.ids).toEqual({
      observation: "Observation ID",
      evidence: "Evidence ID",
      finding: "Finding ID",
      pageSnapshot: "PageSnapshot ID",
      snapshot: "Snapshot ID",
      sitePage: "SitePage ID",
      diagnosticRun: "Diagnostic Run ID",
      crawlSnapshot: "Crawl Snapshot ID",
    });
    expect(en.growthMap.noData).toBe("No data");
    expect(zhCN.growthMap.noData).toBe("数据不足");
    expect(en.growthMap.sourceOriginalLimitation).toBe(
      "Source record · original wording",
    );
    expect(zhCN.growthMap.sourceOriginalLimitation).toBe(
      "来源记录 · 保留原文",
    );
  });

  it("renders the DataForSEO backlink provider as a customer-facing label", () => {
    expect(en.growthMap.backlinks.provider.dataforseo).toBe("DataForSEO");
    expect(zhCN.growthMap.backlinks.provider.dataforseo).toBe("DataForSEO");
  });

  it("labels execution previews as presentational validation targets in both locales", () => {
    expect(en.growthMap.executionPreview).toEqual({
      eyebrow: "Execution preview",
      validationTarget: "Validation target",
      artifactType: "Artifact",
      effort: "Effort",
      risk: "Risk",
      notAvailable:
        "No deterministic execution preview is available for this Finding.",
      artifactTypes: {
        content_brief: "Content brief",
        metadata_rewrite: "Metadata rewrite",
        technical_ticket: "Technical ticket",
        english_blog_draft: "English blog draft",
      },
      efforts: {
        small: "Small",
        medium: "Medium",
        large: "Large",
      },
      risks: {
        low: "Low",
        medium: "Medium",
        high: "High",
      },
    });
    expect(zhCN.growthMap.executionPreview).toEqual({
      eyebrow: "执行预览",
      validationTarget: "验证目标",
      artifactType: "交付物",
      effort: "投入成本",
      risk: "风险",
      notAvailable: "该 Finding 暂无可确定生成的执行预览。",
      artifactTypes: {
        content_brief: "内容简报",
        metadata_rewrite: "元数据改写",
        technical_ticket: "技术工单",
        english_blog_draft: "English 博客草稿",
      },
      efforts: {
        small: "小",
        medium: "中",
        large: "大",
      },
      risks: {
        low: "低",
        medium: "中",
        high: "高",
      },
    });
    expect(en.growthMap.executionPreview).not.toHaveProperty("apply");
    expect(en.growthMap.executionPreview).not.toHaveProperty("publish");
    expect(en.growthMap.executionPreview).not.toHaveProperty("deploy");
    expect(zhCN.growthMap.executionPreview).not.toHaveProperty("status");
    expect(zhCN.growthMap.executionPreview).not.toHaveProperty("progress");
  });

  it("keeps the libraries Chinese-first, customer-readable, and free of unsupported actions", () => {
    expect(zhCN.growthMap.keywordLibrary).toMatchObject({
      libraryScopeTitle: "已入库关键词及其来源",
      selectedKeyword: "关键词详情",
      classificationTitle: "分类与页面",
      metricsTitle: "关键词指标",
      sourcesTitle: "来源记录",
      notAvailable: "暂无数据",
      viewSourceDetails: "查看来源详情",
      viewRecordDetails: "查看记录详情",
    });
    expect(zhCN.growthMap.competitorLibrary).toMatchObject({
      libraryScopeTitle: "已入库竞品及其来源",
      governanceEyebrow: "审核信息",
      noCanonicalObservation: "暂无可用数据",
      originsTitle: "来源记录",
      viewOriginDetails: "查看来源详情",
      viewRecordDetails: "查看记录详情",
    });
    expect(
      zhCN.growthMap.platformLimitations.competitorSerpWriterUnavailable,
    ).toContain("Competitor Library v1");
    expect(
      zhCN.growthMap.platformLimitations.competitorSerpWriterUnavailable,
    ).toContain("SERP-overlap");
    expect(
      zhCN.growthMap.platformLimitations.competitorAiCitationWriterUnavailable,
    ).toContain("AI citation");
    expect(
      zhCN.growthMap.platformLimitations
        .competitorSourceApprovedReviewPending,
    ).toContain("Product Profile");
    expect(zhCN.growthMap.keywordLibrary.metric).toEqual({
      volume: "搜索量",
      kd: "关键词难度（KD）",
      currentRank: "当前排名",
      currentUrl: "当前排名 URL",
      competitorDomain: "竞品域名",
      competitorRank: "竞品排名",
    });
    expect(en.growthMap.keywordLibrary.metric).toEqual({
      volume: "Search volume",
      kd: "Keyword difficulty (KD)",
      currentRank: "Current rank",
      currentUrl: "Current ranking URL",
      competitorDomain: "Competitor domain",
      competitorRank: "Competitor rank",
    });
    expect(zhCN.growthMap.keywordLibrary).not.toHaveProperty("importAction");
    expect(zhCN.growthMap.keywordLibrary).not.toHaveProperty("addAction");
    expect(en.growthMap.keywordLibrary).not.toHaveProperty("importAction");
    expect(en.growthMap.keywordLibrary).not.toHaveProperty("addAction");
    expect(zhCN.growthMap.competitorLibrary).not.toHaveProperty("manualAction");
    expect(zhCN.growthMap.competitorLibrary).not.toHaveProperty("addAction");
    expect(en.growthMap.competitorLibrary).not.toHaveProperty("manualAction");
    expect(en.growthMap.competitorLibrary).not.toHaveProperty("addAction");
  });

  it("keeps Keyword system-suggestion approval compact and explicit in both locales", () => {
    expect(zhCN.growthMap.keywordLibrary.review.suggestion).toEqual({
      title: "系统建议",
      description:
        "以下建议来自已确认的产品画像、关键词证据和已发布 Topic。批准后会原样记录为人工确认；需要例外时再展开修改。",
      reasonLabel: "建议依据",
      approve: "批准系统建议",
      approving: "正在批准…",
      expandEdit: "展开修改",
      collapseEdit: "收起修改",
      detailLoading: "正在读取最新关键词建议…",
      detailError: "无法读取最新关键词建议。",
      approvalConflict:
        "关键词或建议已更新；系统已重新加载最新建议，请核对后再批准。",
      approvalError: "无法批准系统建议，请重试。",
      stateLabel: "系统建议状态：{state}",
      railState: {
        pending_ready: "系统建议待批准",
        pending_needs_review: "需要人工修改",
        generating: "系统建议生成中",
        stale: "系统建议已过期",
        unavailable: "系统建议不可用",
      },
      railBadge: {
        pending_ready: "可批准",
        pending_needs_review: "需修改",
        blocked: "已阻断",
      },
      state: {
        generating: "系统正在生成建议",
        pending_needs_review: "这条建议仍需人工补充",
        stale: "建议已过期",
        unavailable: "当前无法生成可批准建议",
      },
    });
    expect(en.growthMap.keywordLibrary.review.suggestion).toEqual({
      title: "System suggestion",
      description:
        "This suggestion uses the confirmed Product Profile, Keyword evidence, and published Topic. Approving records it unchanged as a human decision; expand the editor only for exceptions.",
      reasonLabel: "Why this is suggested",
      approve: "Approve system suggestion",
      approving: "Approving…",
      expandEdit: "Edit suggestion",
      collapseEdit: "Hide edits",
      detailLoading: "Loading the latest Keyword suggestion…",
      detailError: "The latest Keyword suggestion could not be loaded.",
      approvalConflict:
        "The Keyword or suggestion changed. The latest suggestion has been reloaded; review it before approving.",
      approvalError:
        "The system suggestion could not be approved. Please try again.",
      stateLabel: "System suggestion status: {state}",
      railState: {
        pending_ready: "System suggestion awaiting approval",
        pending_needs_review: "Human edits required",
        generating: "System suggestion in progress",
        stale: "System suggestion out of date",
        unavailable: "System suggestion unavailable",
      },
      railBadge: {
        pending_ready: "Ready to approve",
        pending_needs_review: "Needs edits",
        blocked: "Blocked",
      },
      state: {
        generating: "The system is generating a suggestion",
        pending_needs_review: "This suggestion still needs human input",
        stale: "This suggestion is out of date",
        unavailable: "No approvable suggestion is currently available",
      },
    });
  });

  it("localizes every Context control group and app-shell accessibility name", () => {
    expect(en.context.fields.marketCodes).toBe("Target markets");
    expect(zhCN.context.fields).toMatchObject({
      marketCodes: "目标市场",
      siteLanguageCodes: "网站语言",
      defaultDeliveryLocale: "默认交付语言",
      brandConstraints: "品牌约束",
      complianceConstraints: "合规约束",
      technicalConstraints: "技术约束",
      resourceConstraints: "资源约束",
      personaName: "姓名",
      personaRole: "角色或背景",
      personaJobs: "待完成任务",
      personaPains: "痛点",
      conversionLabel: "转化名称",
      conversionType: "转化类型",
      conversionTargetUrl: "目标 URL",
    });
    expect(zhCN.context.help).toEqual({
      perLine: "每行一项。",
      markets: "每行一个——使用大写 ISO-2 代码（例如 US、GB）。",
      languages: "每行一个——使用 BCP-47 标签（例如 zh-CN、en-US）。",
      locale: "BCP-47 标签（例如 zh-CN）。",
      urls: "每行一个 URL。",
    });
    expect(zhCN.context.options).toEqual({
      customerModel: { b2b: "B2B", b2c: "B2C", hybrid: "混合模式" },
      businessProfile: {
        b2b_saas: "B2B SaaS",
        b2b_services: "B2B 服务",
        b2c_ecommerce: "B2C 电商",
        b2c_subscription: "B2C 订阅",
        marketplace: "平台型市场",
        publisher: "内容发布",
        other: "其他",
      },
      conversionType: {
        demo: "演示",
        signup: "注册",
        trial: "试用",
        purchase: "购买",
        lead: "销售线索",
        contact: "联系",
        subscribe: "订阅",
        offline: "线下转化",
        other: "其他",
      },
    });
    expect(zhCN.context.version).toContain("{version}");
    expect(zhCN.context.newVersion).toBe("新建");
    expect(zhCN.context.leaveWarning).toContain("未保存");
    expect(zhCN.appShell.projectSections).toBe("项目分区");
    expect(zhCN.appShell.breadcrumb).toBe("面包屑导航");
    expect(zhCN.appShell).toMatchObject({
      switchProject: "切换项目",
      programTitle: "90 天计划",
      programProgress: "90 天计划进度",
      help: "帮助",
      settings: "设置",
      account: "账户",
    });
    expect(en.overview.footer).toEqual({
      analysisWindow: "Analysis window",
      latestSnapshot: "Latest snapshot",
      limitations: "Limitations",
    });
    expect(zhCN.overview.footer).toEqual({
      analysisWindow: "分析窗口",
      latestSnapshot: "最新快照",
      limitations: "限制说明",
    });
  });

  it("keeps the customer Overview Chinese-first and labels provider wording as a source record", () => {
    expect(zhCN.overview.customer.sources.providers).toEqual({
      gsc: "Google Search Console",
      ga4: "Google Analytics 4",
      github: "GitHub",
    });
    expect(zhCN.overview.customer.sources.originalRecord).toBe(
      "来源记录 / 原始说明（保留原文）",
    );
    expect(zhCN.overview.customer.priority.resultUnavailable).toContain(
      "审计前后结果",
    );
    expect(zhCN.overview.customer.priority.resultUnavailableDescription).toContain(
      "数据源快照不等于增长 Result",
    );
    expect(en.overview.customer.sources.originalRecord).toBe(
      "Source record / original wording",
    );
  });
});
