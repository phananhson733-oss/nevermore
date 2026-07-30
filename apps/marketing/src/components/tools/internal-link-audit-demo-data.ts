// @input  -- none; fixed fictional P0-2 sample only
// @output -- typed nodes, links, and prioritized findings for the Internal Link Audit demo
// @pos    -- non-production demo dataset; must never be represented as a real crawl

import type { InternalLinkAuditLocale } from "./internal-link-audit-content";

export type LinkNodeKind =
  | "home"
  | "pillar"
  | "page"
  | "orphan"
  | "deep"
  | "broken";

interface LocalizedText {
  readonly en: string;
  readonly zh: string;
}

export interface InternalLinkNode {
  readonly id: string;
  readonly path: string;
  readonly shortLabel: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly kind: LinkNodeKind;
  readonly tags: readonly Exclude<LinkNodeKind, "home" | "page">[];
  readonly status: LocalizedText;
  readonly summary: LocalizedText;
  readonly evidence: LocalizedText;
  readonly limitation: LocalizedText;
  readonly source: string;
  readonly anchor: LocalizedText;
  readonly verify: LocalizedText;
}

export interface InternalLinkEdge {
  readonly from: string;
  readonly to: string;
}

export interface InternalLinkFinding {
  readonly id: string;
  readonly nodeId: string;
  readonly priority: "P0" | "P1";
  readonly title: LocalizedText;
  readonly metric: LocalizedText;
}

export const INTERNAL_LINK_NODES: readonly InternalLinkNode[] = [
  {
    id: "home",
    path: "/",
    shortLabel: "HOME",
    x: 450,
    y: 250,
    radius: 46,
    kind: "home",
    tags: ["pillar"],
    status: { en: "Core node · depth 0", zh: "核心节点 · 深度 0" },
    summary: {
      en: "The root distributes links to three primary clusters, but most editorial authority still flows through two guides.",
      zh: "根节点连接三个主要内容簇，但大多数正文关系仍集中在两个指南页面。",
    },
    evidence: {
      en: "31 inbound references in the sample · 12 outbound HTML links · shortest depth 0.",
      zh: "样本中 31 条入链 · 12 条 HTML 出链 · 最短深度 0。",
    },
    limitation: {
      en: "Demo importance is not PageRank and does not measure external authority.",
      zh: "演示重要度不是 PageRank，也不测量外部权重。",
    },
    source: "/",
    anchor: { en: "Not applicable", zh: "不适用" },
    verify: {
      en: "Re-crawl after navigation or homepage recommendation changes.",
      zh: "主导航或首页推荐位调整后重新抓取。",
    },
  },
  {
    id: "feeding",
    path: "/feeding-guides",
    shortLabel: "FEEDING",
    x: 210,
    y: 116,
    radius: 36,
    kind: "pillar",
    tags: ["pillar"],
    status: { en: "Pillar · 73% cluster coverage", zh: "Pillar · 簇覆盖 73%" },
    summary: {
      en: "The feeding pillar links to most series pages, but the multi-cat guide has no contextual link from the pillar.",
      zh: "喂食 Pillar 已连接多数系列页，但没有在正文中连接双猫指南。",
    },
    evidence: {
      en: "9 inbound links · 8 outbound links · depth 1 · two child pages connected only through global navigation.",
      zh: "9 条入链 · 8 条出链 · 深度 1 · 两个子页只通过全站导航连接。",
    },
    limitation: {
      en: "Body-versus-navigation classification is part of the fictional sample.",
      zh: "正文与导航位置分类来自虚构样本。",
    },
    source: "/feeding-guides",
    anchor: { en: "feeding two cats", zh: "两只猫的喂食方法" },
    verify: {
      en: "Confirm a rendered body link to /multi-cat-guide and recalculate its shortest path.",
      zh: "确认渲染后的正文链接到 /multi-cat-guide，并重新计算最短路径。",
    },
  },
  {
    id: "smart",
    path: "/best-smart-feeders",
    shortLabel: "SMART",
    x: 690,
    y: 106,
    radius: 35,
    kind: "pillar",
    tags: ["pillar"],
    status: { en: "Pillar · commercial cluster", zh: "Pillar · 商业内容簇" },
    summary: {
      en: "A strongly connected comparison page that can pass readers into setup and maintenance guidance.",
      zh: "连接较强的商业比较页，可以把用户继续引导到设置与维护指南。",
    },
    evidence: {
      en: "14 inbound links · 7 outbound links · depth 1 · three relevant destinations are not linked.",
      zh: "14 条入链 · 7 条出链 · 深度 1 · 三个相关目标尚未链接。",
    },
    limitation: {
      en: "Editorial relevance still requires human review.",
      zh: "编辑语境是否自然仍需人工审核。",
    },
    source: "/best-smart-feeders",
    anchor: { en: "feeder cleaning checklist", zh: "喂食器清洗清单" },
    verify: {
      en: "Confirm the added link is contextual, crawlable, and points directly to a 200 target.",
      zh: "确认新增链接位于正文、可抓取，并直接指向 200 目标。",
    },
  },
  {
    id: "multi-cat",
    path: "/multi-cat-guide",
    shortLabel: "2 CATS",
    x: 112,
    y: 216,
    radius: 24,
    kind: "deep",
    tags: ["deep"],
    status: { en: "Thin-linked · depth 4", zh: "低入链 · 深度 4" },
    summary: {
      en: "The page is not an orphan, but only one deep series page links to it and the pillar has no direct route.",
      zh: "该页面并非孤岛，但只有一个深层系列页指向它，Pillar 没有直接入口。",
    },
    evidence: {
      en: "1 inbound link · 3 outbound links · shortest observed path 4.",
      zh: "1 条入链 · 3 条出链 · 最短观测路径为 4。",
    },
    limitation: {
      en: "Depth is not a ranking guarantee and the demo has no search-performance data.",
      zh: "点击深度不等于排名保证，演示也没有搜索表现数据。",
    },
    source: "/feeding-guides",
    anchor: { en: "feeding two cats", zh: "两只猫的喂食方法" },
    verify: {
      en: "Re-crawl and confirm two contextual inbound links and a shortest path of 2 or less.",
      zh: "重新抓取，确认至少两条正文入链且最短路径不超过 2。",
    },
  },
  {
    id: "portion",
    path: "/portion-size-guide",
    shortLabel: "PORTION",
    x: 325,
    y: 68,
    radius: 18,
    kind: "page",
    tags: [],
    status: { en: "Healthy baseline · depth 2", zh: "健康基线 · 深度 2" },
    summary: {
      en: "A normally connected child page used as the sample’s healthy comparison.",
      zh: "一个连接正常的子页面，用作样本中的健康对照。",
    },
    evidence: {
      en: "5 inbound links · 4 outbound links · shortest observed path 2.",
      zh: "5 条入链 · 4 条出链 · 最短观测路径为 2。",
    },
    limitation: {
      en: "No issue is also a valid result; the demo does not force an action.",
      zh: "没有问题也是有效结果；演示不会强行生成动作。",
    },
    source: "/feeding-guides",
    anchor: { en: "portion size guide", zh: "份量指南" },
    verify: {
      en: "Monitor future child pages for accidental isolation.",
      zh: "后续检查新增子页是否意外失去入口。",
    },
  },
  {
    id: "wifi",
    path: "/wifi-feeders",
    shortLabel: "WI-FI",
    x: 790,
    y: 210,
    radius: 25,
    kind: "page",
    tags: [],
    status: { en: "Suggested source · depth 2", zh: "建议来源页 · 深度 2" },
    summary: {
      en: "Its first-connection section is a natural editorial source for the orphan app setup guide.",
      zh: "页面中的首次连接段落，是给孤岛 App 设置指南补链的自然来源。",
    },
    evidence: {
      en: "6 inbound links · 5 outbound links · one highly related orphan target.",
      zh: "6 条入链 · 5 条出链 · 存在一个高度相关的孤岛目标。",
    },
    limitation: {
      en: "Topic similarity is illustrative; a real recommendation needs inspectable text evidence.",
      zh: "主题相关度为演示值；真实建议必须提供可检查的正文证据。",
    },
    source: "/wifi-feeders",
    anchor: { en: "feeder app setup", zh: "喂食器 App 设置" },
    verify: {
      en: "Confirm the target returns 200 and the rendered anchor sits inside the setup section.",
      zh: "确认目标返回 200，且渲染后的锚文本位于设置段落。",
    },
  },
  {
    id: "app-orphan",
    path: "/app-setup-guide",
    shortLabel: "APP",
    x: 836,
    y: 88,
    radius: 25,
    kind: "orphan",
    tags: ["orphan"],
    status: { en: "Orphan candidate · sitemap only", zh: "候选孤岛 · 仅 Sitemap" },
    summary: {
      en: "The sample sitemap lists this guide, but no sampled HTML page links to it.",
      zh: "演示 Sitemap 中包含该指南，但样本 HTML 中没有任何页面指向它。",
    },
    evidence: {
      en: "0 inbound HTML links · 2 outbound links · present in the fixed sitemap set.",
      zh: "0 条 HTML 入链 · 2 条出链 · 存在于固定 Sitemap 集合。",
    },
    limitation: {
      en: "JavaScript event links and external discovery were not evaluated.",
      zh: "未评估 JavaScript 事件链接与站外发现入口。",
    },
    source: "/wifi-feeders",
    anchor: { en: "feeder app setup", zh: "喂食器 App 设置" },
    verify: {
      en: "Add the reviewed body link, then re-crawl and confirm inbound count, context, and target status.",
      zh: "增加审核后的正文链接，再复验入链数、位置和目标状态。",
    },
  },
  {
    id: "cleaning-orphan",
    path: "/feeder-cleaning-checklist",
    shortLabel: "CLEAN",
    x: 82,
    y: 438,
    radius: 22,
    kind: "orphan",
    tags: ["orphan"],
    status: { en: "Orphan candidate · review intent", zh: "候选孤岛 · 先审页面价值" },
    summary: {
      en: "Three pages discuss maintenance, but none links to the cleaning checklist in this sample.",
      zh: "三个页面讨论维护，但样本中没有页面链接到这份清洗清单。",
    },
    evidence: {
      en: "0 inbound links · 1 outbound link · three candidate source pages.",
      zh: "0 条入链 · 1 条出链 · 三个候选来源页面。",
    },
    limitation: {
      en: "The audit cannot decide whether this page should remain separate or be consolidated.",
      zh: "审计无法决定该页面应独立保留还是合并。",
    },
    source: "/best-smart-feeders",
    anchor: { en: "feeder cleaning checklist", zh: "喂食器清洗清单" },
    verify: {
      en: "Confirm independent page value before adding a contextual link and re-crawling.",
      zh: "先确认页面具备独立价值，再补充正文链接并重新抓取。",
    },
  },
  {
    id: "legacy-broken",
    path: "/old-feeder-setup",
    shortLabel: "404",
    x: 820,
    y: 360,
    radius: 20,
    kind: "broken",
    tags: ["broken"],
    status: { en: "Broken target · demo 404", zh: "断链目标 · 演示 404" },
    summary: {
      en: "A strongly connected guide still points to a retired setup URL.",
      zh: "一个连接较强的指南仍然指向已经下线的设置 URL。",
    },
    evidence: {
      en: "Linked from /best-smart-feeders with anchor “setup guide” · fictional 404 response.",
      zh: "来源为 /best-smart-feeders，锚文本为“设置指南” · 虚构 404 响应。",
    },
    limitation: {
      en: "No network request was made; the 404 is fixed demo data.",
      zh: "没有发出网络请求；404 是固定演示数据。",
    },
    source: "/best-smart-feeders",
    anchor: { en: "smart feeder setup guide", zh: "智能喂食器设置指南" },
    verify: {
      en: "Update the source link to the approved replacement and confirm a direct 200 response.",
      zh: "将来源链接更新到审核后的替代页面，并确认直接返回 200。",
    },
  },
  {
    id: "buyer-guide",
    path: "/automatic-feeder-buyers-guide",
    shortLabel: "BUYER",
    x: 650,
    y: 430,
    radius: 22,
    kind: "deep",
    tags: ["deep"],
    status: { en: "Deep page · depth 5", zh: "深层页面 · 深度 5" },
    summary: {
      en: "A purchase-intent page sits five clicks from home despite belonging to the commercial cluster.",
      zh: "一个高购买意图页面距离首页五次点击，虽然它属于商业内容簇。",
    },
    evidence: {
      en: "2 inbound links · 6 outbound links · shortest observed path 5.",
      zh: "2 条入链 · 6 条出链 · 最短观测路径为 5。",
    },
    limitation: {
      en: "The sample does not contain traffic, conversion, or ranking evidence.",
      zh: "样本不包含流量、转化或排名证据。",
    },
    source: "/best-smart-feeders",
    anchor: { en: "automatic feeder buyer’s guide", zh: "自动喂食器购买指南" },
    verify: {
      en: "Add a direct cluster link and confirm the shortest path falls to 2.",
      zh: "增加簇内直达链接，并确认最短路径降到 2。",
    },
  },
];

export const INTERNAL_LINK_EDGES: readonly InternalLinkEdge[] = [
  { from: "home", to: "feeding" },
  { from: "home", to: "smart" },
  { from: "home", to: "portion" },
  { from: "feeding", to: "multi-cat" },
  { from: "feeding", to: "portion" },
  { from: "smart", to: "wifi" },
  { from: "smart", to: "legacy-broken" },
  { from: "smart", to: "buyer-guide" },
  { from: "wifi", to: "smart" },
  { from: "multi-cat", to: "feeding" },
];

export const INTERNAL_LINK_FINDINGS: readonly InternalLinkFinding[] = [
  {
    id: "orphan-app",
    nodeId: "app-orphan",
    priority: "P0",
    title: { en: "App setup guide has no HTML inbound link", zh: "App 设置指南没有 HTML 入链" },
    metric: { en: "0 inbound · 2 clear sources", zh: "0 条入链 · 2 个明确来源" },
  },
  {
    id: "broken-setup",
    nodeId: "legacy-broken",
    priority: "P0",
    title: { en: "High-value guide links to a retired URL", zh: "高价值指南仍指向下线 URL" },
    metric: { en: "1 broken target · strong source", zh: "1 个断链目标 · 强来源页" },
  },
  {
    id: "orphan-cleaning",
    nodeId: "cleaning-orphan",
    priority: "P1",
    title: { en: "Cleaning checklist is structurally isolated", zh: "清洗清单在结构中完全孤立" },
    metric: { en: "0 inbound · review page value first", zh: "0 条入链 · 先审核页面价值" },
  },
  {
    id: "deep-multi-cat",
    nodeId: "multi-cat",
    priority: "P1",
    title: { en: "Multi-cat guide is four clicks deep", zh: "双猫指南距离首页四次点击" },
    metric: { en: "1 inbound · pillar gap", zh: "1 条入链 · Pillar 缺口" },
  },
];

export function localizeDemoText(
  value: { readonly en: string; readonly zh: string },
  locale: InternalLinkAuditLocale,
): string {
  return value[locale];
}
