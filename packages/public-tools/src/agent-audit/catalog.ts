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
  ["A6", "Redirect destinations returning an error", "跳转终点返回错误的 URL 数", "0 URLs; above 0 is Warning. Counts any 4xx or 5xx destination, so a 5xx one is also counted under crawl efficiency.", "0 个 URL；大于 0 为警告。统计任何 4xx 或 5xx 终点，因此 5xx 终点也会同时计入抓取效率。"],
  ["A7", "Pages carrying a noindex directive", "带 noindex 指令的页数", "Listed for review, not judged: noindex is often deliberate. Confirm each page is meant to stay out of the index.", "仅列出待复核，不作判定：noindex 常常是有意为之。请逐页确认确实不希望被索引。"],
  ["A8", "Pages served over HTTP", "以 HTTP 提供的页数", "0 pages; any page whose final URL is not HTTPS is a Warning", "0 页；最终 URL 非 HTTPS 的页面均为警告"],
  ["B1", "Crawl waste rate", "抓取浪费率", "Below 10% passes; 10-20% is a Tip; above 20% is a Warning", "低于 10% 通过；10–20% 为提示；高于 20% 为警告"],
  ["B2", "5XX response rate", "5XX 占比", "Below 0.5%; otherwise Warning", "低于 0.5%；否则为警告"],
  ["B3", "Average response time", "平均响应时间", "500 ms or less; above 1 s is Warning", "不超过 500 毫秒；高于 1 秒为警告"],
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
  ["E3", "Impression share in positions 7–10", "排名 7–10 的曝光占比", "40% or less; above 60% is Warning", "不超过 40%；高于 60% 为警告"],
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
  A6: ["redirect_destination_error"],
  B3: ["average_response_time"],
  E1: ["page_without_search_impressions"],
  E2: ["impression_share_top_positions"],
  E3: ["impression_share_low_click_positions"],
  C3: ["average_click_depth"],
  B1: ["fetch_without_direct_page"],
  B2: ["server_error_response"],
  // C5 stays unwired on purpose. A link-following crawl reaches a page either
  // by an internal link or from the sitemap, so any collected page that is in
  // neither was discovered from a page the budget dropped. The filter would
  // report a budget artefact as a lost page, and a check that fires only when
  // it is wrong is worse than one that says it is not integrated.
  // Site-wide Schema coverage is the same measurement as the page-level
  // "is there any JSON-LD" check, read as a share instead of a verdict, so it
  // reuses the record rather than crawling for it twice.
  D5: ["json_ld_missing"],
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
  B1: [
    {
      recordId: "fetch_without_direct_page",
      kind: "affected-ratio",
      passBelow: 0.1,
      failAbove: 0.2,
    },
  ],
  B2: [
    {
      recordId: "server_error_response",
      kind: "affected-ratio",
      passBelow: 0.005,
    },
  ],
  E1: [
    {
      // Published as "at least 60% of pages have impressions"; the record
      // counts the pages that do not, so the bound is the complement.
      recordId: "page_without_search_impressions",
      kind: "affected-ratio-at-most",
      passAtOrBelow: 0.4,
      failAbove: 0.7,
    },
  ],
  E2: [
    {
      recordId: "impression_share_top_positions",
      kind: "aggregate-min",
      label: "top_position_impression_share",
      passAtOrAbove: 0.2,
      failBelow: 0.1,
    },
  ],
  E3: [
    {
      recordId: "impression_share_low_click_positions",
      kind: "aggregate-max",
      label: "low_click_position_impression_share",
      passAtOrBelow: 0.4,
      failAbove: 0.6,
    },
  ],
  B3: [
    {
      recordId: "average_response_time",
      kind: "aggregate-max",
      label: "average_response_ms",
      passAtOrBelow: 500,
      failAbove: 1_000,
    },
  ],
  C3: [
    {
      recordId: "average_click_depth",
      kind: "aggregate-max",
      label: "average_click_depth",
      passAtOrBelow: 3,
      failAbove: 4,
    },
  ],
  D5: [
    {
      recordId: "json_ld_missing",
      // "At least 90% covered" is satisfied at exactly 90%, so the bound is
      // inclusive on the missing share.
      kind: "affected-ratio-at-most",
      passAtOrBelow: 0.1,
    },
  ],
};

/**
 * The controlled vocabulary a threshold uses to say it is not a verdict.
 *
 * Adding a phrase here silently unscores every check whose threshold contains
 * it, so catalog.test.ts pins the resulting set by name.
 */
const DECLARES_NO_JUDGEMENT =
  /Internal heuristic only|Display only|Listed for review, not judged/;

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

/**
 * Why this run cannot decide a check, when it cannot.
 *
 * `access-required` and `not-integrated` name a source outside this codebase:
 * Search Console for the impression and index checks, CrUX or a SERP provider
 * for the rest. `needs-integration` names one inside it — the crawl already
 * collected the material and no code reads it yet. Keeping the two apart is the
 * point of the state: `needs-supplement` belongs to the evaluator, which uses it
 * for a detector that ran and matched nothing. That is a measurement, not a gap,
 * and reading it as a gap is what made the panel look uniformly unfinished.
 */
function engine(id: string, ready: boolean): AgentAuditEngineState {
  // A2 and E5 read like crawl checks because the crawl supplies the URL set,
  // but both are impression shares and an impression only exists in Search
  // Console. They are gated exactly like E1-E4.
  if (["A1", "A2", "A3", "E1", "E2", "E3", "E4", "E5", "9.5"].includes(id)) {
    return "access-required";
  }
  if (/^8\./.test(id) || /^9\.[1-4]$/.test(id)) return "not-integrated";
  return ready ? "ready" : "needs-integration";
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

/**
 * What to actually do about one check, written per check.
 *
 * The group-shaped fallback below covers four groups for eighty-one checks, so
 * every check in a group told the reader the same sentence: "open the measured
 * sample, make the smallest reviewed correction, rerun". True of everything,
 * useful for nothing. A check that this run can decide has earned instructions
 * that name the file, the element, and the way to tell it worked, so entries
 * land here as their detector lands.
 */
const HOW_TO_FIX: Readonly<Record<string, AgentAuditLocalizedText>> = {
  A7: l(
    "Do not bulk-remove these. Read the list and confirm each page is one you want out of the index: staging, thank-you pages, faceted duplicates, and internal search results usually belong there. For any page that should rank, delete the noindex from the template or CMS field that emits it, then request indexing for that URL — removal is not automatic.",
    "不要成批删除。逐页确认它们确实是你不想被索引的：预发布页、感谢页、筛选重复页、站内搜索结果通常本来就该在这里。对于应该获得排名的页面，去发出该指令的模板或 CMS 字段里删掉 noindex，然后对那个 URL 手动请求编入索引——移除不会自动生效。",
  ),
  A8: l(
    "Serve every one of these over HTTPS and redirect the HTTP form to it with a single 301. Then fix what still points at http:// — internal links, canonical tags, sitemap entries, and hardcoded asset URLs — because a redirect that works still spends a hop and still tells crawlers the site has two addresses.",
    "把这些页面全部改为 HTTPS 提供，并用单条 301 把 HTTP 形态重定向过去。然后修掉仍然指向 http:// 的地方——内链、canonical 标签、sitemap 条目、写死的资源 URL——因为跳转即使有效也白费一跳，而且等于告诉抓取器这个站有两个地址。",
  ),
  C1: l(
    "These pages are in your sitemap but nothing on the site links to them, so a crawler only reaches them by reading the sitemap. Decide per page: if it matters, add a link from the section page or hub that owns it, using anchor text that describes the destination; if it does not, remove it from the sitemap rather than leaving a page you do not vouch for.",
    "这些页面在 sitemap 里，但站内没有任何链接指向它们，抓取器只能靠读 sitemap 找到。逐页决定：重要的，就从它所属的栏目页或聚合页加一条链接过去，锚文本要描述目标页内容；不重要的，就从 sitemap 里删掉，而不是留着一个你自己都不背书的页面。",
  ),
  C2: l(
    "Each broken target is a link a reader clicks and lands on nothing. Per target, pick one: repoint the link if the content moved, restore the URL if it should exist, or remove the link if it should not. Fix it in the template or content source that emits it, not on one rendered page — a broken link in a nav or footer repeats site-wide.",
    "每个断链目标都是读者点了之后落空的链接。逐个目标三选一：内容搬走了就改指向，本该存在就恢复该 URL，不该存在就删掉链接。要在发出它的模板或内容源里改，不要只改某个渲染页——导航或页脚里的一条断链会在全站重复。",
  ),
  C4: l(
    "Depth is counted from the crawl entry point, so these pages need a shorter path in, not a rewrite. Add a link from a page that is already shallow — the hub, the category page, or a related-content block on a popular page. Adding pagination links or a section index usually moves a whole set at once, which is cheaper than linking each page.",
    "深度是从抓取入口开始算的，所以这些页面需要的是更短的到达路径，不是重写内容。从一个本来就很浅的页面加链接过去——聚合页、分类页，或热门页面上的相关内容模块。加分页链接或栏目索引通常能一次挪动一整批，比逐页加链接便宜得多。",
  ),
  C6: l(
    "Nothing here is broken; these are internal links pointing at a URL that redirects. Repoint each link at the destination the redirect lands on, so readers and crawlers stop paying a hop. Keep the redirect itself — external links and bookmarks still use the old URL.",
    "这里没有坏掉的东西；这些是指向了会跳转的 URL 的内链。把每条链接直接改指向跳转的终点，让读者和抓取器不再多花一跳。跳转本身要保留——外部链接和收藏夹还在用旧 URL。",
  ),
  D2: l(
    "Pages sharing a description are usually pages sharing a template, so fix the template first: derive the description from fields that already differ per page rather than from a fixed string. Where a page needs its own, write one that says what decision this page helps the reader make — a description that would fit any sibling page is the same defect with new words.",
    "描述相同的页面通常是共用模板的页面，所以先改模板：让描述从各页本来就不同的字段生成，而不是来自一个固定字符串。确实需要单独写的页面，就写清楚这个页面帮读者做什么决定——一段放在任何兄弟页面上都成立的描述，是换了措辞的同一个缺陷。",
  ),
  D3: l(
    "A page with no title or no H1 gives search engines and readers nothing to identify it by. Add both at the source: the title in the page's metadata, the H1 as the first visible heading, and make them say the same thing without being byte-identical. If the count is large, the emitting template is missing the field rather than each page being wrong.",
    "没有 Title 或没有 H1 的页面，等于没有给搜索引擎和读者任何辨识依据。两个都要在源头补上：Title 放页面元数据，H1 作为第一个可见标题，两者说同一件事但不必逐字相同。如果数量很大，那是发出这些字段的模板漏了，而不是每个页面各自写错。",
  ),
  D7: l(
    "Not a defect on its own — a canonical pointing elsewhere is how you consolidate duplicates deliberately. Confirm per page that the target is the version you want indexed, that the target returns 200, and that the target does not itself canonicalise somewhere else. A canonical pointing at a redirect or a 404 silently drops the page.",
    "这本身不是缺陷——canonical 指向他页正是有意收敛重复页的做法。逐页确认：目标是你希望被索引的那个版本、目标返回 200、目标自身没有再指向别处。canonical 指向一个跳转或 404，会让这个页面被静默丢弃。",
  ),
  "1.1": l(
    "The page does not return 200, so nothing else on this report applies to it. Find out which: a 404 means the URL is wrong or the content is gone, a 5xx means the server failed and may still be failing, a 403 usually means a firewall or bot rule is blocking non-browser clients. Fix the response first, then rerun.",
    "这个页面不返回 200，因此本报告其余部分对它都不适用。先弄清是哪一种：404 说明 URL 写错了或内容没了，5xx 说明服务端出错且可能还在出错，403 通常是防火墙或 bot 规则拦掉了非浏览器客户端。先修好响应，再重新运行。",
  ),
  "1.3": l(
    "This page carries a noindex directive, so it will be removed from the index regardless of anything else you improve on it. If that is deliberate, stop here. If not, find where it comes from — a template default, a CMS visibility toggle, an X-Robots-Tag response header, or a staging config that shipped — remove it, and request indexing for the URL.",
    "这个页面带 noindex 指令，无论你在它上面改进什么，它都会被移出索引。如果这是有意的，到此为止。如果不是，找出它从哪来——模板默认值、CMS 的可见性开关、X-Robots-Tag 响应头，或者跟着上线的预发布配置——删掉它，然后对该 URL 请求编入索引。",
  ),
  "1.4": l(
    "A page with no canonical lets every URL variant that reaches it compete as a separate page. Add a self-referencing canonical carrying the absolute, final URL. If the canonical points elsewhere, confirm that is deliberate consolidation and that the target returns 200 — otherwise this page is asking not to be indexed.",
    "没有 canonical 的页面，会让每一个能到达它的 URL 变体都作为独立页面互相竞争。加一条自指 canonical，写绝对的、最终形态的 URL。如果 canonical 指向别处，确认那是有意的收敛且目标返回 200——否则这个页面等于在请求不要被索引。",
  ),
  "1.5": l(
    "The page is not in any sitemap this run collected. If it should be indexed, add it to the sitemap your CMS or build generates, and confirm robots.txt actually points at that sitemap file. A sitemap is a discovery aid, not an indexing guarantee — so also check the page has at least one internal link.",
    "本次采集到的 sitemap 里都没有这个页面。如果它应该被索引，就加进 CMS 或构建生成的那份 sitemap，并确认 robots.txt 确实指向了那个 sitemap 文件。sitemap 只是发现路径的辅助，不保证被索引——所以也要确认这个页面至少有一条内链。",
  ),
  "1.6": l(
    "Every extra hop costs crawl budget and a little of the signal the original link carried. Collapse the chain to a single redirect from the first URL straight to the final destination, then update the internal links that still point at the first URL so the common path costs no hop at all.",
    "每多一跳都会消耗抓取预算，也会损耗原始链接携带的一部分信号。把整条链压成一条：从第一个 URL 直接跳到最终目标，然后更新仍然指向第一个 URL 的内链，让常规路径一跳都不用花。",
  ),
  "2.1": l(
    "Rewrite the title so the page's own subject comes first and the brand, if present, comes last. The range is a working range, not a rule — search results truncate by rendered width, so a short title full of wide characters can still be cut. Check it against sibling pages afterwards: a title that fits but repeats theirs has not been fixed.",
    "重写 Title，把这个页面自己的主题放最前面，品牌名（如果要放）放最后。那个区间是工作区间不是硬规则——搜索结果按渲染宽度截断，所以一个字数不多但字形很宽的标题照样会被切。改完和兄弟页面对一下：长度合适但和它们重复的标题，等于没改。",
  ),
  "2.2": l(
    "Another evaluated page already uses this exact title, so search engines have to pick between them and may pick neither. Differentiate by what each page actually does for the reader, not by appending a number or a location. If the two pages genuinely serve the same intent, the fix is to merge them and redirect one, not to rename both.",
    "另一个已评估页面用了完全相同的标题，搜索引擎只能在两者之间挑一个，也可能一个都不选。按每个页面真正为读者做什么来区分，而不是加个编号或地名。如果这两个页面确实服务同一意图，正确做法是合并并把其中一个跳转过去，而不是把两个都改名。",
  ),
  "2.4": l(
    "Write a description that gives the reader a reason to choose this result — what they will be able to do after opening it. It is not a ranking factor, so accuracy beats keyword placement: a description that overpromises costs you the click twice, once when they bounce and once when the result stops being shown.",
    "写一段能给读者选择这条结果的理由的描述——打开之后他们能做成什么。它不是排名因素，所以准确比塞词重要：一段过度承诺的描述会让你损失两次点击，一次是他们跳出，一次是这条结果不再被展示。",
  ),
  "2.5": l(
    "This description already appears on another evaluated page. Fix it where it is generated: if a template emits one fixed string, derive it instead from fields that already differ per page. Search engines rewrite descriptions often, but a duplicate makes rewriting the default rather than the exception.",
    "这段描述已经出现在另一个已评估页面上。在生成它的地方修：如果模板发出的是一个固定字符串，就改成从各页本来就不同的字段生成。搜索引擎经常会重写描述，但重复会让重写从例外变成默认。",
  ),
  "3.1": l(
    "Exactly one H1 tells a reader and a parser what this page is. If there are none, promote the visible page title to an H1. If there are several, keep the one that names the page's subject and demote the rest to H2 — usually the extras come from a site name in the header, a sidebar module, or a card component that hardcodes its heading level.",
    "恰好一个 H1，才能让读者和解析器知道这个页面是什么。一个都没有，就把可见的页面标题提升为 H1。有多个，就保留点明页面主题的那个，其余降为 H2——多出来的通常来自页头的站名、侧栏模块，或者写死了标题层级的卡片组件。",
  ),
  "6.1": l(
    "No page in the crawled set links here, so this page depends entirely on the sitemap to be found and receives no internal signal from the rest of the site. Add links from pages that are actually about the same thing — a hub, the parent category, or a related block — and use anchor text that describes this page rather than \"read more\".",
    "抓取范围内没有任何页面链接到这里，所以这个页面完全依赖 sitemap 被发现，也拿不到站内其余部分传来的任何信号。从真正相关的页面加链接——聚合页、上级分类，或相关内容模块——锚文本要描述这个页面本身，不要用「阅读更多」。",
  ),
  "6.2": l(
    "This page links nowhere internal, so it takes signal in and passes none on, and a reader who finishes it has no next step. Add links to the pages that answer what someone naturally asks next, placed in the body where the topic comes up rather than collected in a block at the bottom.",
    "这个页面没有任何出站内链，所以它只进不出，读完的人也没有下一步可去。链接到那些回答「读者接下来自然会问什么」的页面，放在正文里话题出现的位置，而不是堆在页尾的一个模块里。",
  ),
  "6.3": l(
    "This page links to internal URLs that do not resolve. Fix them at the source that emits them; if the same broken target appears on many pages, it is one template or one content include, not many mistakes. After fixing, check one nearby working link too — an edit that repoints a link often touches its neighbours.",
    "这个页面链接到了打不开的内部 URL。在发出它们的源头修；如果同一个坏目标出现在很多页面上，那是一个模板或一个内容片段的问题，不是很多处各自出错。修完顺便检查旁边一条正常的链接——改链接的编辑经常会碰到相邻的链接。",
  ),
  "6.4": l(
    "Depth is measured from the crawl entry point, so this is about the path in, not the page itself. One link from a shallow, relevant page fixes it. If many pages sit at this depth, the site's navigation stops before it reaches them, and adding a section index moves the whole group at once.",
    "深度是从抓取入口算的，所以这说的是到达路径，不是页面本身。从一个较浅且相关的页面加一条链接就能解决。如果很多页面都在这个深度，说明站点导航在它们之前就断了，加一个栏目索引能一次挪动整组。",
  ),
  A6: l(
    "A redirect that lands on an error is worse than no redirect: the reader is sent somewhere and finds nothing, and the crawler spends the request anyway. Read the destination status first — a 4xx means the target is gone, so repoint the redirect at a live page serving the same intent or drop the redirect and let the original URL return 404 honestly; a 5xx means the target exists and its server failed, which is a server fix, not a redirect fix. Do not blanket-redirect these to the homepage — a homepage that answers nothing the reader asked is read as a soft 404.",
    "跳到错误页的跳转比不跳转更糟：读者被送到某处却什么也没有，而抓取器照样花掉了这次请求。先看终点状态码——4xx 说明目标没了，把跳转改指向一个服务同样意图的可用页面，或者干脆撤掉跳转、让原 URL 老实返回 404；5xx 说明目标存在但它的服务器出错了，那是服务端的修法，不是跳转的修法。不要把它们一律跳到首页——一个回答不了读者问题的首页会被判为软 404。",
  ),
  B1: l(
    "Read the cause off each row before deciding where to edit, because they do not share a fix. A row with redirect hops and a 2xx destination is a link problem: repoint the internal links at the destination and keep the redirect for external traffic. A 4xx destination is also a link problem: repoint or remove it. A 5xx destination is not — nothing about the linking page is wrong, and the work is on the server that failed. Fixing the first two is usually most of the number.",
    "先从每一行读出成因再决定改哪里，因为它们的修法不一样。有跳转且终点是 2xx 的行是链接问题：把内链改指向终点，跳转本身为外部流量保留。终点是 4xx 的也是链接问题：改指向或删除。终点是 5xx 的不是——发出链接的页面没有任何问题，要做的事在出错的那台服务器上。修掉前两类通常就解决了这个数字的大部分。",
  ),
  B2: l(
    "A 5xx means the server failed, not that the page is wrong, and a crawler that meets enough of them slows down across the whole site. Read the server log for these exact URLs at the timestamp of this run: the usual causes are a dependency timing out, a memory limit, or one slow query on a page type. Confirm the fix by requesting the same URLs again rather than by the page loading in a browser.",
    "5xx 说明服务端出错，不是页面写错，而抓取器碰到足够多之后会把整站的抓取速度降下来。按本次运行的时间戳去查这些确切 URL 的服务端日志：常见成因是某个依赖超时、内存超限，或某类页面上的一条慢查询。验证方式是重新请求同样这些 URL，而不是在浏览器里打开看它加载出来了。",
  ),
  B3: l(
    "This is one uncached request per URL from one location, so treat it as a signal about the server rather than as what your visitors feel. Compare the slowest URL against a fast one on the same site: if only some page types are slow, the cost is in that template's data fetching; if everything is slow, it is the host, the origin region, or a cold start. Field data from CrUX is what confirms user impact — this run does not collect it.",
    "这是每个 URL 从单一位置发起的一次无缓存请求，所以把它当作关于服务端的信号，而不是访客的真实体感。拿最慢的 URL 和同站一个快的比：如果只有某些页面类型慢，成本在那个模板的数据获取上；如果全都慢，那是主机、源站区域或冷启动。真正确认用户影响的是 CrUX 现场数据——本次运行不采集它。",
  ),
  C3: l(
    "Average depth is a shape measurement: it says how far the typical page sits from the entry point, not that any one page is wrong. If it is high, the navigation stops before it reaches most of the site — hub pages, a section index, or pagination that links more than the next page each move a whole group at once. Adding links page by page moves the average almost not at all.",
    "平均深度衡量的是站点形状：它说的是典型页面离入口有多远，不是说某个页面有问题。数值偏高，意味着导航在覆盖到站点大部分之前就断了——聚合页、栏目索引，或者不只链接下一页的分页，每一样都能一次挪动一整组。逐页加链接对平均值几乎没有影响。",
  ),
  E1: l(
    "These pages have been crawled and were never shown for anything in the window. Check them in this order, because the cheap answer is usually first: are they indexable at all (a noindex or a canonical pointing elsewhere makes impressions impossible), were they published recently enough that Search Console has not seen them, and do they answer a question anyone is searching for. Only the last one is a content decision; the first two are defects this same run already reports.",
    "这些页面已经被抓取到，但在统计窗口内从未因任何查询被展示过。按这个顺序排查，因为便宜的答案通常在前面：它们到底能不能被索引（带 noindex 或 canonical 指向他页，就不可能有曝光）、它们发布得是不是太新以致 Search Console 还没见过、以及它们回答的问题是否真的有人在搜。只有最后一条是内容决策，前两条是本次运行已经报出来的缺陷。",
  ),
  E2: l(
    "A low share here means the site is visible but rarely near the top. Do not spread the effort: pull the queries whose impressions are large and whose position sits just outside the band, because moving one of those moves more impressions than fixing ten pages nobody sees. For each, confirm one page owns the query — two pages competing for it is the most common reason neither gets close.",
    "这个占比低，说明站点能被看见但很少靠前。不要把力气摊开：挑出曝光量大、且排名刚好落在这一档之外的查询，推动其中一个带来的曝光变化，比修十个没人看的页面都大。逐个确认有且只有一个页面在争这个词——两个页面互相竞争，是两个都靠不上去最常见的原因。",
  ),
  E3: l(
    "Positions 7 to 10 earn impressions and very few clicks, so a large share here is effort already spent that has not converted into traffic. Treat it as a queue, not a defect: these are the queries closest to paying off. Work the ones where a single page already ranks and the intent matches what that page does; a query whose intent no page on the site serves belongs in a content decision, not in a fix list.",
    "排名 7 到 10 有曝光、几乎没有点击，所以这一档占比大，意味着已经付出的功夫还没有转化成流量。把它当队列而不是缺陷：这些是最接近见效的查询。优先处理那些已经有单一页面在排、且意图与该页面所做的事情吻合的；如果某个查询的意图站内没有页面在服务，那属于内容决策，不属于修复清单。",
  ),
  D5: l(
    "This run knows which pages parsed no JSON-LD; it does not know why. Sort the uncovered URLs by path shape first: if they share one, the template behind them emits no markup and one edit covers the group, which is the cheap case. If they do not, they were missed individually. Either way add a block whose @type matches what the page actually is and derive every property from data the template already renders.",
    "本次运行知道哪些页面解析不出 JSON-LD，但不知道原因。先按路径形状给未覆盖的 URL 分组：如果它们共用一种路径，说明背后的模板不输出标记，改一处就覆盖一整组，这是便宜的情况。如果不共用，那就是逐个漏掉的。两种情况都一样：加一个 @type 与页面实际身份匹配的块，每个字段都从模板已经渲染的数据里取。",
  ),
  "7.1": l(
    "No parseable JSON-LD block was found, so nothing on this page is machine-readable beyond the HTML itself. Add one block whose @type matches what the page actually is, and fill only properties the visible page supports. Validate the output, not the source — a template that emits invalid JSON produces the same result as no markup at all.",
    "没有找到可解析的 JSON-LD 块，所以除了 HTML 本身，这个页面上没有任何机器可读的东西。加一个 @type 与页面实际身份匹配的块，只填可见内容支持得起的字段。要校验输出而不是源码——发出非法 JSON 的模板，效果和完全没有标记一样。",
  ),
};

function fix(
  id: string,
  scope: AgentAuditScope,
  groupId: string,
): AgentAuditLocalizedText {
  const specific = HOW_TO_FIX[id];
  if (specific !== undefined) return specific;
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
  // A detector exists for this check exactly when something emits an evidence
  // record it reads. The two hand-kept "ready" sets this replaces had drifted to
  // 47 entries against 24 real detectors, so the panel advertised what the
  // requirements document covered as though it were working code.
  const ready = (EVIDENCE[id] ?? []).length > 0;
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
  // A check that publishes "this does not judge the page" must not move the
  // score, so the exclusion is read off the threshold rather than kept in a
  // second list beside it. Three checks report conditions that are routinely
  // deliberate (an intentional noindex, a redirected internal link, a
  // consolidating canonical); five more publish a number with no defensible
  // pass mark - keyword density says in its own threshold that it "is not used
  // to judge a page" while deducting from Health, which is the contradiction
  // this removes.
  const scored =
    !(scope === "page" && groupId === "1") &&
    !DECLARES_NO_JUDGEMENT.test(thresholdEn);
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
    howToFix: fix(id, scope, groupId),
    threshold: l(thresholdEn, thresholdZh),
    thresholdAuthority: authority(id),
    dataSource: l(
      id === "D1" || id === "4.5"
        ? "Detector blocked by the P6 false-positive launch gate"
        : engine(id, ready) === "access-required"
        ? "Authorized search source required"
        : engine(id, ready) === "not-integrated"
          ? "Required engine not integrated"
          : ready
            ? "Bounded crawl"
            : "Crawl collects the material; no detector reads it yet",
      id === "D1" || id === "4.5"
        ? "检测器受 P6 假阳性上线门槛阻断"
        : engine(id, ready) === "access-required"
        ? "需要授权搜索来源"
        : engine(id, ready) === "not-integrated"
          ? "所需引擎尚未接入"
          : ready
            ? "有边界抓取"
            : "抓取已采到原料，尚无检测器读取",
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
          ? "Decided only where this bounded run exposed a matching measurement."
          : "Excluded from scoring until a detector or the named source exists.",
      id === "D1" || id === "4.5"
        ? "P6 硬门槛：必须排除已 Canonical 收敛变体，并通过已知真阳性和假阳性 fixture 后，此检查才能运行。"
        : ready
          ? "仅在本次有边界运行暴露匹配实测值处判定。"
          : "在检测器或指定来源具备之前排除评分。",
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
