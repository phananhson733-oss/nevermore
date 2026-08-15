import type {
  AgentAuditCheckDefinition,
  AgentAuditEngineState,
  AgentAuditGroupDefinition,
  AgentAuditHeadingPreset,
  AgentAuditIssueRule,
  AgentAuditLocalizedText,
  AgentAuditScope,
  AgentAuditThresholdAuthority,
} from "./types.ts";

const l = (en: string, zh: string): AgentAuditLocalizedText => ({ en, zh });

type CheckSeed = readonly [
  id: string,
  titleEn: string,
  titleZh: string,
  thresholdEn: string,
  thresholdZh: string,
];

const SITE_TITLES: readonly CheckSeed[] = [
  ["A1", "Index coverage rate", "索引覆盖率", "At least 90%; below 70% is Blocker, 70–90% is Warning", "至少 90%；低于 70% 为阻断，70–90% 为警告"],
  ["A2", "Deprecated URL impression share", "废弃 URL 曝光占比", "Below 5%; above 20% is Blocker", "低于 5%；高于 20% 为阻断"],
  ["A3", "Discovered, currently not indexed rate", "已发现但尚未编入索引占比", "Below 10%; otherwise Warning", "低于 10%；否则为警告"],
  ["A4", "Soft 404 page count", "软 404 页数", "0 pages; above 0 is Blocker", "0 页；大于 0 为阻断"],
  ["A5", "Pages incorrectly blocked by robots.txt", "robots.txt 误拦截页数", "0 pages; above 0 is Blocker", "0 页；大于 0 为阻断"],
  ["A6", "Redirect destinations returning 404", "跳转终点为 404 的 URL 数", "0 URLs; above 0 is Warning", "0 个 URL；大于 0 为警告"],
  ["A7", "Pages carrying a noindex directive", "带 noindex 指令的页数", "Listed for review, not judged: noindex is often deliberate. Confirm each page is meant to stay out of the index.", "仅列出待复核，不作判定：noindex 常常是有意为之。请逐页确认确实不希望被索引。"],
  ["A8", "Pages served over HTTP", "以 HTTP 提供的页数", "0 pages; any page whose final URL is not HTTPS is a Warning", "0 页；最终 URL 非 HTTPS 的页面均为警告"],
  ["B1", "Crawl waste rate", "抓取浪费率", "Below 10%; above 20% is Warning", "低于 10%；高于 20% 为警告"],
  ["B2", "5XX response rate", "5XX 占比", "Below 0.5%; otherwise Warning", "低于 0.5%；否则为警告"],
  ["B3", "Average response time", "平均响应时间", "Below 500 ms; above 1 s is Warning", "低于 500 毫秒；高于 1 秒为警告"],
  ["B4", "Crawl sufficiency", "抓取充裕度", "Internal heuristic only. Crawl budget has no published per-URL rate; compare a site against its own history.", "仅为内部启发式。抓取预算没有官方的单 URL 速率；只与站点自身历史比较。"],
  ["B5", "Discovery versus refresh crawl ratio", "发现与刷新抓取比", "Display only; no pass/fail threshold", "仅展示，不设通过阈值"],
  ["C1", "Orphan page rate", "孤岛页占比", "Below 5% passes; 5–20% is a Tip; above 20% is a Warning", "低于 5% 通过；5–20% 为提示；高于 20% 为警告"],
  ["C2", "Broken link count", "断链数", "0 links; above 0 is Warning", "0 个链接；大于 0 为警告"],
  ["C3", "Average click depth", "平均点击深度", "At most 3 clicks; above 4 is Warning", "最多 3 次点击；大于 4 为警告"],
  ["C4", "Pages deeper than four clicks", "点击深度大于 4 的页面占比", "Below 10% of inspected pages; otherwise Warning", "低于已检查页面的 10%；否则为警告"],
  ["C5", "Pages without a discovery path", "失去发现路径的页数", "0 pages; above 0 is Warning", "0 页；大于 0 为警告"],
  ["C6", "Pages reached through a redirect", "经跳转到达的页数", "Listed for review, not judged: check whether internal links can point straight at the destination.", "仅列出待复核，不作判定：检查内链是否可以直接指向终点。"],
  ["D1", "Duplicate title rate", "重复 Title 占比", "Below 2%; otherwise Warning; exclude canonical-converged variants", "低于 2%；否则为警告；排除已 Canonical 收敛变体"],
  ["D2", "Duplicate meta description rate", "重复 Meta description 占比", "Below 5%; otherwise Tip", "低于 5%；否则为提示"],
  ["D3", "Pages missing title or H1", "缺失 Title 或 H1 的页数", "0 pages; above 0 is Warning", "0 页；大于 0 为警告"],
  ["D4", "Image alt coverage", "图片 alt 覆盖率", "100%; below 95% is Warning", "100%；低于 95% 为警告"],
  ["D5", "Schema coverage", "Schema 覆盖率", "At least 90%; otherwise Warning", "至少 90%；否则为警告"],
  ["D6", "hreflang cluster completeness", "hreflang 簇完整性", "100% valid targets; any 404 target is Blocker", "目标 100% 有效；任何 404 目标均为阻断"],
  ["D7", "Pages whose canonical points at another page", "Canonical 指向他页的页数", "Listed for review, not judged: cross-page canonicals are often deliberate consolidation. Confirm each target is the intended one.", "仅列出待复核，不作判定：跨页 Canonical 常是有意收敛。请确认每个目标都是预期页面。"],
  ["E1", "Pages with impressions", "有曝光页数占比", "At least 60%; below 30% is Warning", "至少 60%；低于 30% 为警告"],
  ["E2", "Impression share in positions 1–6", "排名 1–6 的曝光占比", "At least 20%; below 10% is Warning", "至少 20%；低于 10% 为警告"],
  ["E3", "Impression share in positions 7–10", "排名 7–10 的曝光占比", "Below 40%; above 60% is Warning", "低于 40%；高于 60% 为警告"],
  ["E4", "Non-brand click share", "非品牌点击占比", "Internal heuristic only. A healthy split depends on brand maturity; review the trend, not the level.", "仅为内部启发式。健康的占比取决于品牌成熟度；看趋势而非绝对值。"],
  ["E5", "Time-sensitive content impression share", "时效内容曝光占比", "Below 40%; above 60% is Warning", "低于 40%；高于 60% 为警告"],
];

const PAGE_TITLES: readonly CheckSeed[] = [
  ["1.1", "HTTP status code", "HTTP 状态码", "200; any other final status is Blocker", "200；其他最终状态均为阻断"],
  ["1.2", "robots.txt allowance", "robots.txt 放行", "Allowed; a disallowed target page is Blocker", "允许；目标页被禁止抓取为阻断"],
  ["1.3", "noindex directive", "noindex 标签", "Absent; presence is Blocker", "不存在；存在即为阻断"],
  ["1.4", "Canonical target", "Canonical 目标", "A canonical is present and self-referencing; a missing canonical or one pointing elsewhere is a Warning. Destination status is not collected.", "存在且自指的 Canonical；缺失或指向他页为警告。本工具不采集 Canonical 目标的状态码。"],
  ["1.5", "Included in sitemap", "是否在 sitemap 中", "Present in a collected sitemap; otherwise Warning. Not testable when no sitemap was collected.", "存在于已采集的 sitemap 中；否则为警告。未采集到 sitemap 时不判定。"],
  ["1.6", "Redirect chain length", "跳转链长度", "At most one hop; two or more is Warning, non-200 destination is Blocker", "最多一跳；两跳及以上为警告，终点非 200 为阻断"],
  ["1.7", "hreflang target validity", "hreflang 目标有效性", "Every target returns 200; a 404 target is Blocker", "所有目标均返回 200；指向 404 为阻断"],
  ["1.8", "Soft 404 detection", "软 404 检测", "Not a 200 response with empty-shell content; a soft 404 is Blocker", "不是 200 空壳内容；软 404 为阻断"],
  ["2.1", "Title length", "Title 长度", "Reviewed working range 15–70 characters; Google truncates by rendered width, not character count", "已审阅工作区间 15–70 个字符；Google 按渲染宽度截断，而非字符数"],
  ["2.2", "Sitewide title uniqueness", "Title 全站唯一", "Unique among evaluated canonical pages; otherwise Warning", "在已评估 Canonical 页面中唯一；否则为警告"],
  ["2.3", "Title contains target query", "Title 含目标词", "Contains the confirmed target query; otherwise Warning; 2× check weight", "包含已确认目标词；否则为警告；检查权重 2 倍"],
  ["2.4", "Meta description length", "Meta description 长度", "Reviewed working range 50–165 characters; Google truncates by rendered width, not character count", "已审阅工作区间 50–165 个字符；Google 按渲染宽度截断，而非字符数"],
  ["2.5", "Meta description uniqueness", "Meta description 唯一", "Unique among evaluated canonical pages; otherwise Warning", "在已评估 Canonical 页面中唯一；否则为警告"],
  ["2.6", "Open Graph title, description, and image", "Open Graph 标题、描述与图片", "All three properties present; otherwise Tip", "三项属性均存在；否则为提示"],
  ["3.1", "H1 count", "H1 数量", "Exactly 1; otherwise Warning", "恰好 1 个；否则为警告"],
  ["3.2", "H1 contains target query or synonym", "H1 含目标词或近义词", "Contains confirmed query or reviewed synonym; otherwise Tip", "包含已确认目标词或审阅过的近义词；否则为提示"],
  ["3.3", "Continuous heading hierarchy", "标题层级连续", "No skipped levels; otherwise Tip", "无跳级；否则为提示"],
  ["3.4", "H2 count", "H2 数量", "Use the confirmed page-type soft preset", "使用已确认页面类型的软预设"],
  ["3.5", "H3 count", "H3 数量", "Use the confirmed page-type soft preset", "使用已确认页面类型的软预设"],
  ["3.6", "Average words beneath each H3", "每个 H3 下平均字数", "Use the confirmed page-type substance preset", "使用已确认页面类型的内容充实度预设"],
  ["4.1", "Main-content word count", "正文字数", "At least 60% of the reviewed top-10 median; otherwise Warning", "至少为已审阅前十中位数的 60%；否则为警告"],
  ["4.2", "Target-query density", "目标词密度", "Internal heuristic only. Keyword density is not a documented ranking signal and is not used to judge a page.", "仅为内部启发式。关键词密度不是有据可查的排名信号，不用于判定页面。"],
  ["4.3", "First target-query occurrence", "目标词首次出现位置", "Internal heuristic only. Position in the text is not a documented ranking signal.", "仅为内部启发式。目标词在正文中的位置不是有据可查的排名信号。"],
  ["4.4", "Content-to-code ratio", "内容与代码比", "Internal heuristic only. No documented ratio threshold exists; treat it as a rendering-weight hint.", "仅为内部启发式。不存在有据可查的比例阈值；仅作渲染体积提示。"],
  ["4.5", "Similarity with other site pages", "与站内其他页相似度", "Below 70%; otherwise Warning; P6 false-positive gate required", "低于 70%；否则为警告；必须通过 P6 假阳性门禁"],
  ["5.1", "Images missing alt text", "无 alt 图片数", "0 images; otherwise Warning with proportional deduction", "0 张图片；否则为警告并按比例扣分"],
  ["5.2", "Per-image file size", "单图体积", "Below 200 KB; otherwise Tip", "低于 200KB；否则为提示"],
  ["5.3", "Modern image format share", "现代图片格式占比", "At least 80% WebP or AVIF; otherwise Tip", "WebP 或 AVIF 至少 80%；否则为提示"],
  ["5.4", "Above-the-fold image lazy loading", "首屏图片是否 lazy-load", "No; otherwise Warning", "否；否则为警告"],
  ["6.1", "Inbound internal link count", "入站内链数", "At least 1; zero is Warning; 2× check weight", "至少 1 条；0 条为警告；检查权重 2 倍"],
  ["6.2", "Outbound internal link count", "出站内链数", "At least 1 observed outbound internal link; zero is Warning", "至少观察到 1 条出站内链；0 条为警告"],
  ["6.3", "Broken internal links on this page", "本页出站断链数", "0 broken outbound internal links; above 0 is Warning", "本页出站内链断链为 0；大于 0 为警告"],
  ["6.4", "Click depth", "点击深度", "At most 4 clicks from the crawl entry point; deeper is a Tip", "距抓取入口最多 4 次点击；更深为提示"],
  ["6.5", "External dofollow / nofollow ratio", "外链 dofollow / nofollow 比", "Display only; no pass/fail threshold", "仅展示，不设通过阈值"],
  ["7.1", "JSON-LD presence", "JSON-LD 是否存在", "At least one parseable JSON-LD block; absent or malformed is a Tip", "至少 1 个可解析的 JSON-LD 块；缺失或损坏为提示"],
  ["7.2", "Schema type matches page type", "Schema 类型是否匹配页面", "Matches confirmed page type; otherwise Tip", "匹配已确认页面类型；否则为提示"],
  ["7.3", "Required-property completeness", "必填字段完整性", "Every required property present; otherwise Warning", "所有必填字段均存在；否则为警告"],
  ["7.4", "FAQPage matches visible FAQ", "FAQPage 与页面 FAQ 是否一致", "Every item matches visible content; otherwise Warning", "逐条匹配可见内容；否则为警告"],
  ["7.5", "BreadcrumbList matches visible breadcrumbs", "BreadcrumbList 与可见面包屑是否一致", "Exact visible-route correspondence; otherwise Tip", "与可见路径精确对应；否则为提示"],
  ["8.1", "Largest Contentful Paint (LCP)", "最大内容绘制（LCP）", "CrUX p75 over 28 days: 2.5 s or less good, over 2.5 s to 4.0 s needs improvement, over 4.0 s poor", "CrUX 28 天窗口 p75：不超过 2.5 秒为良好，超过 2.5 秒至 4.0 秒待改进，超过 4.0 秒为差"],
  ["8.2", "Interaction to Next Paint (INP)", "交互到下次绘制（INP）", "CrUX p75 over 28 days: 200 ms or less good, over 200 ms to 500 ms needs improvement, over 500 ms poor", "CrUX 28 天窗口 p75：不超过 200 毫秒为良好，超过 200 毫秒至 500 毫秒待改进，超过 500 毫秒为差"],
  ["8.3", "Cumulative Layout Shift (CLS)", "累积布局偏移（CLS）", "CrUX p75 over 28 days: 0.1 or less good, over 0.1 to 0.25 needs improvement, over 0.25 poor", "CrUX 28 天窗口 p75：不超过 0.1 为良好，超过 0.1 至 0.25 待改进，超过 0.25 为差"],
  ["8.4", "Time to First Byte (TTFB)", "首字节时间（TTFB）", "Below 800 ms", "低于 800 毫秒"],
  ["8.5", "Total page weight", "页面总体积", "Below 2 MB", "低于 2MB"],
  ["8.6", "Render-blocking resource count", "渲染阻塞资源数", "0 in a separate Lighthouse lab run", "独立 Lighthouse 实验室运行中为 0"],
  ["9.1", "Target query fully answered by AI Overview", "目标词是否被 AI Overview 完整覆盖", "No; Yes is Warning because ranking may not produce a click", "否；若是则为警告，因为获得排名也可能没有点击"],
  ["9.2", "Recently registered domains in the top 10", "前十是否有近两年注册域名", "At least one; none reduces opportunity health", "至少 1 个；没有则降低机会健康度"],
  ["9.3", "Lower-traffic sites in the top 10", "前十是否有低流量站点", "At least one; none reduces opportunity health", "至少 1 个；没有则降低机会健康度"],
  ["9.4", "UGC result presence", "是否有 UGC 结果位", "At least one; none reduces opportunity health", "至少 1 个；没有则降低机会健康度"],
  ["9.5", "Current ranking band", "当前排名区间", "1–6 preferred; 7–10 low-click; 11+ ineffective", "优先 1–6；7–10 为低点击区；11 名以后效果弱"],
];

const SITE_GROUPS = [
  ["A", "Index health", "索引健康", 30],
  ["B", "Crawl efficiency", "抓取效率", 20],
  ["C", "Site structure health", "站点结构健康", 25],
  ["D", "Content consistency", "内容一致性", 15],
  ["E", "Search performance", "搜索表现", 10],
] as const;

const PAGE_GROUPS = [
  ["1", "Indexability and crawlability", "索引与可抓取", null],
  ["2", "TDK metadata", "TDK", 20],
  ["3", "Heading structure", "标题结构", 10],
  ["4", "Content", "内容", 15],
  ["5", "Images", "图片", 3],
  ["6", "Links", "链接", 15],
  ["7", "Structured data", "结构化数据", 4],
  ["8", "Performance", "性能", 8],
  ["9", "Search opportunity", "搜索机会", 25],
] as const;

const SITE_READY = new Set([
  "A2", "A5", "A6", "A7", "A8", "B1", "B2", "B3", "B4", "B5", "C1", "C2",
  "C3", "C4", "C6", "D2", "D3", "D4", "D5", "D6", "D7", "E1", "E2", "E3", "E4",
]);
const PAGE_READY = new Set([
  "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.1", "2.2",
  "2.4", "2.5", "3.1", "3.4", "3.5", "4.1", "5.1", "6.1", "6.2",
  "6.3", "6.4", "7.1", "9.5",
]);

const BLOCKER_CAPABLE = new Set([
  "A1",
  "A2",
  "A4",
  "A5",
  "D6",
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.6",
  "1.7",
  "1.8",
]);

const EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  C1: ["sitemap_page_without_observed_inlink"],
  C2: ["internal_target_http_error"],
  D2: ["meta_description_duplicate"],
  D3: ["title_missing", "h1_missing"],
  "1.1": ["non_2xx_final_status"],
  "1.3": ["noindex_directive"],
  "1.4": ["canonical_missing", "canonical_differs"],
  "1.6": ["redirect_chain", "non_2xx_final_status"],
  "2.2": ["title_duplicate"],
  "2.5": ["meta_description_duplicate"],
  "3.1": ["h1_missing", "multiple_h1"],
  "6.1": ["sitemap_page_without_observed_inlink"],
  "6.3": ["page_outbound_broken_link"],
  "7.1": ["json_ld_missing", "json_ld_parse_error"],
  C4: ["click_depth_beyond_reviewed_limit"],
  A7: ["noindex_directive"],
  A8: ["http_url"],
  C6: ["redirect_chain"],
  D7: ["canonical_differs"],
  "1.5": ["page_not_in_sitemap"],
  "2.1": ["title_length_outside_range"],
  "2.4": ["meta_description_length_outside_range"],
  "6.2": ["page_without_outbound_internal_link"],
  "6.4": ["click_depth_beyond_reviewed_limit"],
};

/**
 * Executed form of the thresholds these checks publish.
 *
 * Only checks whose displayed rule is a share or a per-observation limit need
 * one. The counting checks already mean "any affected unit fails" and stay on
 * the default.
 */
const ISSUE_RULES: Readonly<Record<string, readonly AgentAuditIssueRule[]>> = {
  C1: [
    {
      recordId: "sitemap_page_without_observed_inlink",
      kind: "affected-ratio",
      passBelow: 0.05,
      failAbove: 0.2,
    },
  ],
  D2: [
    {
      recordId: "meta_description_duplicate",
      kind: "affected-ratio",
      passBelow: 0.05,
    },
  ],
  "1.6": [
    {
      recordId: "redirect_chain",
      kind: "observation-value-max",
      label: "redirect_hops",
      max: 1,
    },
  ],
  C4: [
    {
      recordId: "click_depth_beyond_reviewed_limit",
      kind: "affected-ratio",
      passBelow: 0.1,
    },
  ],
};

function authority(id: string): AgentAuditThresholdAuthority {
  if (["8.1", "8.2", "8.3"].includes(id)) return "official";
  if (["3.4", "3.5", "4.1"].includes(id)) return "sop";
  if (
    [
      "A2", "A7", "C6", "D7", "B1", "C1", "E2", "E3", "E4", "E5",
      "B4", "2.1", "2.4", "3.6", "4.2", "4.3", "4.4", "4.5",
      "5.2", "5.3", "6.2", "6.4", "C4",
    ].includes(id)
  ) {
    return "judgment";
  }
  return "industry";
}

function engine(id: string, ready: boolean): AgentAuditEngineState {
  if (["A1", "A3", "E1", "E2", "E3", "E4", "9.5"].includes(id)) {
    return "access-required";
  }
  if (/^8\./.test(id) || /^9\.[1-4]$/.test(id)) return "not-integrated";
  return ready ? "ready" : "needs-supplement";
}

function impact(scope: AgentAuditScope, groupId: string): AgentAuditLocalizedText {
  const site = scope === "site";
  if (groupId === "1" || groupId === "A") {
    return l(
      site
        ? "This condition can prevent a meaningful share of the site from being indexed or consolidated as intended."
        : "This condition can prevent the target page from being crawled, indexed, or consolidated as intended.",
      site
        ? "该状态可能阻止站点中相当一部分页面按预期被索引或聚合。"
        : "该状态可能阻止目标页按预期被抓取、索引或聚合。",
    );
  }
  if (groupId === "8" || groupId === "B") {
    return l(
      "This condition can affect crawl efficiency or user-perceived performance; field and lab evidence must stay separate.",
      "该状态可能影响抓取效率或用户感知性能；现场数据与实验室数据必须分开。",
    );
  }
  if (groupId === "9" || groupId === "E") {
    return l(
      "This condition changes whether the confirmed query is a credible search opportunity; it does not predict traffic.",
      "该状态会影响已确认目标词是否构成可信搜索机会，但不预测流量。",
    );
  }
  return l(
    "This condition can weaken page clarity, discovery, consistency, or machine-readable meaning within the evaluated scope.",
    "该状态可能削弱已评估范围内的页面清晰度、发现路径、一致性或机器可读语义。",
  );
}

function fix(scope: AgentAuditScope, groupId: string): AgentAuditLocalizedText {
  if (groupId === "1" || groupId === "A") {
    return l(
      "Confirm owner intent, inspect the affected URL evidence, then correct response, directive, redirect, or canonical behavior and rerun validation.",
      "先确认负责人意图并检查受影响 URL 证据，再修正响应、指令、跳转或 Canonical 行为并复跑验证。",
    );
  }
  if (groupId === "8" || groupId === "B") {
    return l(
      "Collect the required field or lab source, isolate the bottleneck, review an owner-specific change, and compare the same metric after release.",
      "采集所需现场或实验室来源，定位瓶颈，审阅适配负责人上下文的变更，并在发布后比较同一指标。",
    );
  }
  if (groupId === "9" || groupId === "E") {
    return l(
      "Bind country, locale, device, page, and target query; obtain the authorized search source before choosing pursue, refine, or defer.",
      "绑定国家、语言、设备、页面与目标词；取得授权搜索来源后再决定推进、调整或暂缓。",
    );
  }
  return l(
    scope === "site"
      ? "Open the measured sample, identify the owning template or content set, make the smallest reviewed correction, then rerun the same ratio."
      : "Open the measured evidence, confirm page role and intent, make the smallest reviewed correction, then rerun this exact check.",
    scope === "site"
      ? "打开实测样本，识别所属模板或内容集合，完成最小审阅修正后复跑同一比例。"
      : "打开实测证据，确认页面角色与意图，完成最小审阅修正后复跑该检查。",
  );
}

function makeCheck(seed: CheckSeed, scope: AgentAuditScope): AgentAuditCheckDefinition {
  const [id, titleEn, titleZh, thresholdEn, thresholdZh] = seed;
  const groupId = scope === "site" ? id[0]! : id.split(".")[0]!;
  const ready = (scope === "site" ? SITE_READY : PAGE_READY).has(id);
  const blockerEvidenceRecordIds =
    scope === "page"
      ? id === "1.1"
        ? ["non_2xx_final_status"]
        : id === "1.3"
          ? ["noindex_directive"]
          : id === "1.6"
            ? ["non_2xx_final_status"]
            : []
      : [];
  const blocking = BLOCKER_CAPABLE.has(id);
  // A7 / C6 / D7 report conditions that are routinely deliberate (an intentional
  // noindex, a redirected internal URL, a consolidating canonical). They are
  // listed for review, and their thresholds say so, so they must not also
  // deduct from a score.
  const scored =
    !(scope === "page" && groupId === "1") &&
    !["B5", "6.5", "A7", "C6", "D7"].includes(id);
  const primaryAgent =
    scope === "page" && ["2", "3", "4", "5", "9"].includes(groupId)
      ? "seo"
      : scope === "site" && ["D", "E"].includes(groupId)
        ? "seo"
        : "tech";
  return {
    id,
    scope,
    groupId,
    title: l(titleEn, titleZh),
    impact: impact(scope, groupId),
    howToFix: fix(scope, groupId),
    threshold: l(thresholdEn, thresholdZh),
    thresholdAuthority: authority(id),
    dataSource: l(
      id === "D1" || id === "4.5"
        ? "Detector blocked by the P6 false-positive launch gate"
        : engine(id, ready) === "access-required"
        ? "Authorized search source required"
        : engine(id, ready) === "not-integrated"
          ? "Required engine not integrated"
          : "Bounded crawl or documented engine inventory",
      id === "D1" || id === "4.5"
        ? "检测器受 P6 假阳性上线门槛阻断"
        : engine(id, ready) === "access-required"
        ? "需要授权搜索来源"
        : engine(id, ready) === "not-integrated"
          ? "所需引擎尚未接入"
          : "有边界抓取或需求文档引擎库存",
    ),
    scoreWeight: id === "2.3" || id === "6.1" ? 2 : 1,
    scored,
    blocking,
    blockerEvidenceRecordIds,
    failureResult: ["A7", "C6", "D7", "B5", "D2", "2.1", "6.4", "6.5", "2.4", "2.6", "3.2", "3.3", "3.4", "3.5", "4.3", "4.4", "5.2", "5.3", "7.1", "7.2", "7.5"].includes(id)
      ? "tip"
      : "warning",
    primaryAgent,
    inventoryReady: ready,
    engine: engine(id, ready),
    evidenceRecordIds: EVIDENCE[id] ?? [],
    issueRules: ISSUE_RULES[id] ?? [],
    boundary: l(
      id === "D1" || id === "4.5"
        ? "P6 hard gate: exclude canonical-converged variants and pass known true-positive and false-positive fixtures before this check can run."
        : ready
        ? "Requirements inventory only until this run exposes a matching measurement."
        : "Excluded from scoring until the named source or engine is available.",
      id === "D1" || id === "4.5"
        ? "P6 硬门槛：必须排除已 Canonical 收敛变体，并通过已知真阳性和假阳性 fixture 后，此检查才能运行。"
        : ready
        ? "仅代表需求文档库存；本次运行暴露匹配实测值后才可判定。"
        : "在指定来源或引擎可用前排除评分。",
    ),
  };
}

function makeGroups(
  scope: AgentAuditScope,
  groups: readonly (readonly [string, string, string, number | null])[],
  seeds: readonly CheckSeed[],
): readonly AgentAuditGroupDefinition[] {
  const checks = seeds.map((seed) => makeCheck(seed, scope));
  return groups.map(([id, titleEn, titleZh, weight]) => ({
    id,
    scope,
    title: l(titleEn, titleZh),
    weight,
    checks: checks.filter((check) => check.groupId === id),
  }));
}

export const SITE_AUDIT_GROUPS = makeGroups("site", SITE_GROUPS, SITE_TITLES);
export const PAGE_AUDIT_GROUPS = makeGroups("page", PAGE_GROUPS, PAGE_TITLES);

/**
 * Where each Agent opens.
 *
 * The default has to land on a group this run can actually decide, or the first
 * screen is a wall of "excluded" and the visitor never sees their own evidence.
 * SEO opens on the content groups it owns and that the crawl measures (D, 2);
 * Tech opens on structure and indexability (C, 1).
 */
export const AGENT_AUDIT_DEFAULT_GROUPS = {
  seo: { site: "D", page: "2" },
  tech: { site: "C", page: "1" },
} as const;

export const AGENT_AUDIT_HEADING_PRESETS: Readonly<
  Record<string, AgentAuditHeadingPreset>
> = {
  homepage: { pageType: "homepage", h2: { min: 3, max: 6 }, h3: { min: 0, max: 6 }, substanceWords: 40, blocker: false },
  product: { pageType: "product", h2: { min: 4, max: 8 }, h3: { min: 2, max: 12 }, substanceWords: 60, blocker: false },
  tool: { pageType: "tool", h2: { min: 5, max: 9 }, h3: { min: 6, max: 18 }, substanceWords: 60, blocker: false },
  guide: { pageType: "guide", h2: { min: 5, max: 12 }, h3: { min: 8, max: 30 }, substanceWords: 80, blocker: false },
};
