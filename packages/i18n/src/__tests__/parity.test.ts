import { describe, it, expect } from "vitest";

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

  it("localizes the GA4 key-event input placeholder instead of hardcoding UI chrome", () => {
    expect(en.sources.keyEventsPlaceholder).toBe("purchase, sign_up");
    expect(zhCN.sources.keyEventsPlaceholder).toBe("购买, 注册");
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
});
