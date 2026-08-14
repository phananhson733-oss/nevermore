// @input  -- one local Agent Profile draft plus presentation locale
// @output -- read-only Product Information document content for the known supplied source
// @pos    -- presentation-only companion; it does not change profile, refresh, or intent contracts

import type { AgentProfileDraft } from "./agent-profile";

export interface AgentProductPricingItem {
  readonly name: string;
  readonly price: string;
  readonly detail: string;
}

export interface AgentProductFeatureItem {
  readonly name: string;
  readonly detail: string;
}

export interface AgentSuppliedProductInformation {
  readonly website: string;
  readonly productType: string;
  readonly functionOverview: string;
  readonly targetCustomers: string;
  readonly features: readonly AgentProductFeatureItem[];
  readonly pricing: readonly AgentProductPricingItem[];
  readonly paymentProcessor: string;
  readonly currencies: readonly string[];
  readonly technicalSignals: readonly string[];
}

const ASTROLOGY_PRODUCT_INFORMATION_EN: AgentSuppliedProductInformation = {
  website: "astrologywiki.com",
  productType: "Software as a service (SaaS)",
  functionOverview:
    "Users enter a birth date, time, and place to generate an accurate natal chart in 30 seconds, covering the Sun, Moon, Ascendant, and every planetary position.",
  targetCustomers:
    "People interested in astrology who use a birth chart for self-understanding and psychological exploration, especially personal growth, relationship analysis, and emotional insight.",
  features: [
    {
      name: "Free natal chart calculator",
      detail: "Swiss Ephemeris · Sun, Moon, Ascendant, and every planet in 30 seconds",
    },
    {
      name: "Planetary transits",
      detail: "Current sky effects on the personal chart",
    },
    {
      name: "Synastry analysis",
      detail: "Compatibility, tension, and relationship dynamics across two charts",
    },
    {
      name: "Astrology timeline",
      detail: "Important planetary cycles and life milestones",
    },
    {
      name: "AI oracle",
      detail: "3 questions / week on Free · 10 questions / week on Pro",
    },
    {
      name: "CBT astrology journal",
      detail: "Emotional journal with monthly insight reports on Pro",
    },
    {
      name: "Astrology encyclopedia and tools",
      detail: "Reference material, supporting calculators, and a Saturn return calculator",
    },
  ],
  pricing: [
    {
      name: "Free",
      price: "$0",
      detail: "Core birth chart, encyclopedia, and CBT journal",
    },
    {
      name: "Pro monthly",
      price: "$6.99 / month",
      detail: "Cancel anytime",
    },
    {
      name: "Pro annual",
      price: "$41.99 / year",
      detail: "50% off the first subscription · 7-day Pro trial",
    },
    {
      name: "Credit packs",
      price: "$4.99 – $34.99",
      detail:
        "100 / $4.99 · 300 / $12.49 · 500 / $19.99 · 1,000 / $34.99",
    },
  ],
  paymentProcessor: "Airwallex",
  currencies: ["USD", "EUR", "GBP", "CNY"],
  technicalSignals: [
    "Swiss Ephemeris astronomical calculations",
    "Anonymous calculation; birth data is not written to URLs or analytics events",
    "Multilingual interface, including Chinese",
    "Airwallex multi-currency payments in USD, EUR, GBP, and CNY",
    "Credits and subscriptions can be used together",
    "Web SaaS; no download; supports use without registration",
  ],
};

const ASTROLOGY_PRODUCT_INFORMATION_ZH: AgentSuppliedProductInformation = {
  website: "astrologywiki.com",
  productType: "软件即服务（SaaS）",
  functionOverview:
    "用户输入出生日期、时间和地点，可在 30 秒内生成精准本命星盘，涵盖太阳、月亮、上升点及全部行星位置。",
  targetCustomers:
    "对占星感兴趣、将星盘用于自我认知与心理探索的普通用户，尤其关注个人成长、关系分析和情绪洞察的人群。",
  features: [
    {
      name: "免费本命星盘计算器",
      detail: "瑞士星历表 · 30 秒生成太阳、月亮、上升点及全部行星位置",
    },
    {
      name: "行星过境预测",
      detail: "查看当前天象对个人星盘的实时影响",
    },
    {
      name: "合盘分析",
      detail: "对比两张星盘的契合点、张力与关系动态",
    },
    {
      name: "占星时间轴",
      detail: "呈现重要行星周期与人生节点",
    },
    {
      name: "问卦神谕",
      detail: "免费版每周 3 次 · 专业版每周 10 次",
    },
    {
      name: "认知行为疗法占星日记",
      detail: "情绪日记；专业版含每月情绪洞察报告",
    },
    {
      name: "占星百科与工具库",
      detail: "知识查阅、辅助计算工具与土星回归计算器",
    },
  ],
  pricing: [
    {
      name: "免费版",
      price: "$0",
      detail: "核心星盘、百科及认知行为疗法日记",
    },
    {
      name: "专业版月付",
      price: "$6.99 / 月",
      detail: "可随时取消",
    },
    {
      name: "专业版年付",
      price: "$41.99 / 年",
      detail: "首次订阅 5 折 · 7 天专业版试用",
    },
    {
      name: "积分包",
      price: "$4.99 – $34.99",
      detail:
        "100 / $4.99 · 300 / $12.49 · 500 / $19.99 · 1,000 / $34.99",
    },
  ],
  paymentProcessor: "Airwallex",
  currencies: ["USD", "EUR", "GBP", "CNY"],
  technicalSignals: [
    "基于瑞士星历表进行天文精算",
    "支持匿名计算；出生数据不写入网址或分析事件",
    "支持多语言界面（含中文）",
    "Airwallex 多币种支付：美元、欧元、英镑、人民币",
    "积分与订阅可混合使用",
    "网页端 SaaS；无需下载；支持免注册使用",
  ],
};

/** Return only the explicitly supplied Product Information document content. */
export function getSuppliedProductInformation(
  profile: AgentProfileDraft,
  locale: string,
): AgentSuppliedProductInformation | null {
  if (
    profile.host !== "astrologywiki.com" ||
    profile.sources.product !== "product_information_supplied"
  ) {
    return null;
  }
  return locale.toLowerCase().startsWith("zh")
    ? ASTROLOGY_PRODUCT_INFORMATION_ZH
    : ASTROLOGY_PRODUCT_INFORMATION_EN;
}
