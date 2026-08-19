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
  ["A4", "Soft 404 page count", "软 404 页数", "0 pages; above 0 is Blocker. A page counts only when it answers 200, states a not-found phrase, and has less body text than the published floor — both signals, never one.", "0 页；大于 0 为阻断。只有同时满足三点才计入：返回 200、出现「找不到」类措辞、正文量低于公布的下限——两个信号缺一不可。"],
  ["A5", "Sitemap URLs robots.txt blocks from search", "robots.txt 拦截的 sitemap URL 数", "0 URLs; above 0 is Blocker. Counts URLs the sitemap declares for indexing that robots.txt forbids Google's crawler from fetching.", "0 个 URL；大于 0 为阻断。统计 sitemap 声明要收录、而 robots.txt 又禁止 Google 抓取的 URL。"],
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
  ["D4", "Image alt coverage", "图片 alt 覆盖率", "100% of the pages carrying images have alt on all of them; below 95% is Warning. An empty alt marks a decorative image and counts as covered.", "含图片的页面中，100% 的页面其图片都带 alt；低于 95% 为警告。空 alt 是装饰性图片的标记，计为已覆盖。"],
  ["D5", "Schema coverage", "Schema 覆盖率", "At least 90%; otherwise Warning", "至少 90%；否则为警告"],
  ["D6", "hreflang cluster completeness", "hreflang 簇完整性", "100% valid targets; any 4xx or 5xx target is Blocker. Only alternates this run also fetched are classified; one outside the crawl is reported as unclassified, never as valid.", "目标 100% 有效；任何 4xx 或 5xx 目标均为阻断。只对本次运行同时抓取到的备用地址判定；抓取范围之外的报为未分类，绝不算作有效。"],
  ["D7", "Pages whose canonical points at another page", "Canonical 指向他页的页数", "Listed for review, not judged: cross-page canonicals are often deliberate consolidation. Confirm each target is the intended one.", "仅列出待复核，不作判定：跨页 Canonical 常是有意收敛。请确认每个目标都是预期页面。"],
  ["E1", "Pages with impressions", "有曝光页数占比", "At least 60%; below 30% is Warning", "至少 60%；低于 30% 为警告"],
  ["E2", "Impression share in positions 1–6", "排名 1–6 的曝光占比", "At least 20%; below 10% is Warning", "至少 20%；低于 10% 为警告"],
  ["E3", "Impression share in positions 7–10", "排名 7–10 的曝光占比", "40% or less; above 60% is Warning", "不超过 40%；高于 60% 为警告"],
  ["E4", "Non-brand click share", "非品牌点击占比", "Internal heuristic only. A healthy split depends on brand maturity; review the trend, not the level.", "仅为内部启发式。健康的占比取决于品牌成熟度；看趋势而非绝对值。"],
  ["E5", "Time-sensitive content impression share", "时效内容曝光占比", "Below 40%; above 60% is Warning", "低于 40%；高于 60% 为警告"],
];

const PAGE_TITLES: readonly CheckSeed[] = [
  ["1.1", "HTTP status code", "HTTP 状态码", "200; any other final status is Blocker", "200；其他最终状态均为阻断"],
  ["1.2", "robots.txt allowance for search", "robots.txt 对搜索抓取的放行", "Allowed for Google's crawler; disallowed is Blocker. Read from the collected robots.txt for one crawler token, not from this run's own access.", "对 Google 的抓取器放行；被禁止为阻断。依据已采集的 robots.txt 按单一抓取器标记判定，不是依据本次运行自己的访问权限。"],
  ["1.3", "noindex directive", "noindex 标签", "Absent; presence is Blocker", "不存在；存在即为阻断"],
  ["1.4", "Canonical target", "Canonical 目标", "A canonical is present and self-referencing; a missing canonical or one pointing elsewhere is a Warning. Destination status is not collected.", "存在且自指的 Canonical；缺失或指向他页为警告。本工具不采集 Canonical 目标的状态码。"],
  ["1.5", "Included in sitemap", "是否在 sitemap 中", "Present in a collected sitemap; otherwise Warning. Not testable when no sitemap was collected.", "存在于已采集的 sitemap 中；否则为警告。未采集到 sitemap 时不判定。"],
  ["1.6", "Redirect chain length", "跳转链长度", "At most one hop; two or more is Warning, non-200 destination is Blocker", "最多一跳；两跳及以上为警告，终点非 200 为阻断"],
  ["1.7", "hreflang target validity", "hreflang 目标有效性", "No alternate returns 4xx or 5xx; one that does is Blocker. Only alternates this run also fetched are classified.", "没有返回 4xx 或 5xx 的备用地址；出现即为阻断。只对本次运行同时抓取到的备用地址判定。"],
  ["1.8", "Soft 404 detection", "软 404 检测", "Not a 200 response that both states a not-found phrase and falls below the published body floor; a soft 404 is Blocker. Thin content alone is not judged here.", "不是「返回 200、同时出现「找不到」类措辞、且正文量低于公布下限」的页面；软 404 为阻断。仅仅内容少不在这里判定。"],
  ["2.1", "Title length", "Title 长度", "Reviewed working range 15–70 characters; Google truncates by rendered width, not character count", "已审阅工作区间 15–70 个字符；Google 按渲染宽度截断，而非字符数"],
  ["2.2", "Sitewide title uniqueness", "Title 全站唯一", "Unique among evaluated canonical pages; otherwise Warning", "在已评估 Canonical 页面中唯一；否则为警告"],
  ["2.3", "Title contains the target query", "Title 含目标词", "Contains the confirmed target query as a token sequence; otherwise Warning; 2× check weight. No synonym or stemming set is applied.", "以词序列形式包含已确认目标词；否则为警告；检查权重 2 倍。不做同义词或词形还原。"],
  ["2.4", "Meta description length", "Meta description 长度", "Reviewed working range 50–165 characters; Google truncates by rendered width, not character count", "已审阅工作区间 50–165 个字符；Google 按渲染宽度截断，而非字符数"],
  ["2.5", "Meta description uniqueness", "Meta description 唯一", "Unique among evaluated canonical pages; otherwise Warning", "在已评估 Canonical 页面中唯一；否则为警告"],
  ["2.6", "Open Graph title, description, and image", "Open Graph 标题、描述与图片", "All three properties present; otherwise Tip", "三项属性均存在；否则为提示"],
  ["3.1", "H1 count", "H1 数量", "Exactly 1; otherwise Warning", "恰好 1 个；否则为警告"],
  ["3.2", "H1 contains the target query", "H1 含目标词", "Contains the confirmed target query as a token sequence; otherwise Tip. No synonym or stemming set is applied.", "以词序列形式包含已确认目标词；否则为提示。不做同义词或词形还原。"],
  ["3.3", "Continuous heading hierarchy", "标题层级连续", "No skipped levels; otherwise Tip", "无跳级；否则为提示"],
  ["3.4", "H2 count", "H2 数量", "Within the reviewed range for the confirmed page type; outside it is a Tip. The range is published with the finding — it is a reviewed working band, not a documented rule.", "落在已确认页面类型的审阅区间内；超出为提示。区间会与发现一同给出——它是审阅过的工作区间，不是有据可查的规则。"],
  ["3.5", "H3 count", "H3 数量", "Within the reviewed range for the confirmed page type; outside it is a Tip. The range is published with the finding — it is a reviewed working band, not a documented rule.", "落在已确认页面类型的审阅区间内；超出为提示。区间会与发现一同给出——它是审阅过的工作区间，不是有据可查的规则。"],
  ["3.6", "Average words beneath each H3", "每个 H3 下平均字数", "Within the reviewed substance range for the confirmed page type; below it is a Tip. Whitespace words between headings, so a CJK page is not measured here.", "落在已确认页面类型的审阅内容量区间内；低于该区间为提示。按标题之间的空白分词计，因此中日韩页面不在此判定。"],
  ["4.1", "Main-content word count", "正文字数", "At least 60% of the reviewed top-10 median; otherwise Warning", "至少为已审阅前十中位数的 60%；否则为警告"],
  ["4.2", "Target-query density", "目标词密度", "Listed for review, not judged: keyword density is not a documented ranking signal and is not used to judge a page.", "仅列出待复核，不作判定：关键词密度不是有据可查的排名信号，不用于判定页面。"],
  ["4.3", "First target-query occurrence", "目标词首次出现位置", "Internal heuristic only. Position in the text is not a documented ranking signal.", "仅为内部启发式。目标词在正文中的位置不是有据可查的排名信号。"],
  ["4.4", "Content-to-code ratio", "内容与代码比", "Listed for review, not judged: no documented ratio threshold exists. Read it as a rendering-weight hint, never as a defect.", "仅列出待复核，不作判定：不存在有据可查的比例阈值。把它当作体积提示来读，不要当成缺陷。"],
  ["4.5", "Similarity with other site pages", "与站内其他页相似度", "Below 70%; otherwise Warning; P6 false-positive gate required", "低于 70%；否则为警告；必须通过 P6 假阳性门禁"],
  ["5.1", "Images missing alt text", "无 alt 图片数", "0 images with no alt attribute; otherwise Warning. An empty alt marks a decorative image and counts as covered.", "没有 alt 属性的图片为 0 张；否则为警告。空 alt 是装饰性图片的标记，计为已覆盖。"],
  ["5.2", "Per-image file size", "单图体积", "Below 200 KB; otherwise Tip", "低于 200KB；否则为提示"],
  ["5.3", "Modern image format share", "现代图片格式占比", "At least 80% WebP or AVIF among images whose format the URL states; otherwise Tip. An unreadable extension leaves the ratio rather than counting against it.", "在 URL 能读出格式的图片中，WebP 或 AVIF 至少占 80%；否则为提示。读不出扩展名的图片不计入该比例，也不算作旧格式。"],
  ["5.4", "Above-the-fold image lazy loading", "首屏图片是否 lazy-load", "The first image in document order is not lazy-loaded; otherwise Warning. A static crawl has no viewport, so document order stands in for the fold.", "文档顺序中的第一张图片没有被 lazy-load；否则为警告。静态抓取没有视口，因此以文档顺序代替首屏折线。"],
  ["6.1", "Inbound internal link count", "入站内链数", "At least 1; zero is Warning; 2× check weight", "至少 1 条；0 条为警告；检查权重 2 倍"],
  ["6.2", "Outbound internal link count", "出站内链数", "At least 1 observed outbound internal link; zero is Warning", "至少观察到 1 条出站内链；0 条为警告"],
  ["6.3", "Broken internal links on this page", "本页出站断链数", "0 broken outbound internal links; above 0 is Warning", "本页出站内链断链为 0；大于 0 为警告"],
  ["6.4", "Click depth", "点击深度", "At most 4 clicks from the crawl entry point; deeper is a Tip", "距抓取入口最多 4 次点击；更深为提示"],
  ["6.5", "External dofollow / nofollow ratio", "外链 dofollow / nofollow 比", "Listed for review, not judged: display only, no pass/fail threshold. Included because nofollow on outbound links is a choice, not a score.", "仅列出待复核，不作判定：仅展示，不设通过阈值。列在这里是因为出站链接加不加 nofollow 是选择，不是分数。"],
  ["7.1", "JSON-LD presence", "JSON-LD 是否存在", "At least one parseable JSON-LD block; absent or malformed is a Tip", "至少 1 个可解析的 JSON-LD 块；缺失或损坏为提示"],
  ["7.2", "Schema type matches page type", "Schema 类型与页面类型匹配", "Declares a type from the reviewed set for the confirmed page type; otherwise Tip. Site-furniture types are ignored, and the reviewed set is published with the finding.", "声明了已确认页面类型对应审阅集合中的某个类型；否则为提示。站点通用类型不计入，审阅集合会与发现一同给出。"],
  ["7.3", "Required-property completeness", "必填字段完整性", "Every required property present for the types in the reviewed table; otherwise Warning. A type outside the table is not judged rather than assumed complete.", "审阅表中所列类型的必填字段齐全；否则为警告。表外的类型不作判定，而不是假定其完整。"],
  ["7.4", "FAQPage matches visible FAQ", "FAQPage 与页面 FAQ 是否一致", "Every item matches visible content; otherwise Warning", "逐条匹配可见内容；否则为警告"],
  ["7.5", "BreadcrumbList markup below the root", "根目录以下页面的 BreadcrumbList 标记", "Present on pages below the root; otherwise Tip. Presence only: this run keeps no visible trail to compare the markup against.", "根目录以下的页面存在该标记；否则为提示。仅判定是否存在：本次运行不保留可见路径，无法与标记比对。"],
  ["8.1", "Largest Contentful Paint (LCP)", "最大内容绘制（LCP）", "CrUX p75 over 28 days: 2.5 s or less good, over 2.5 s to 4.0 s needs improvement, over 4.0 s poor", "CrUX 28 天窗口 p75：不超过 2.5 秒为良好，超过 2.5 秒至 4.0 秒待改进，超过 4.0 秒为差"],
  ["8.2", "Interaction to Next Paint (INP)", "交互到下次绘制（INP）", "CrUX p75 over 28 days: 200 ms or less good, over 200 ms to 500 ms needs improvement, over 500 ms poor", "CrUX 28 天窗口 p75：不超过 200 毫秒为良好，超过 200 毫秒至 500 毫秒待改进，超过 500 毫秒为差"],
  ["8.3", "Cumulative Layout Shift (CLS)", "累积布局偏移（CLS）", "CrUX p75 over 28 days: 0.1 or less good, over 0.1 to 0.25 needs improvement, over 0.25 poor", "CrUX 28 天窗口 p75：不超过 0.1 为良好，超过 0.1 至 0.25 待改进，超过 0.25 为差"],
  ["8.4", "Time to First Byte (TTFB)", "首字节时间（TTFB）", "800 ms or less good, over 800 ms to 1.8 s needs improvement, over 1.8 s poor", "不超过 800 毫秒为良好，超过 800 毫秒至 1.8 秒待改进，超过 1.8 秒为差"],
  ["8.5", "Total page weight", "页面总体积", "Below 2 MB", "低于 2MB"],
  ["8.6", "Render-blocking resource count", "渲染阻塞资源数", "0 render-blocking stylesheets or synchronous scripts in the head; above 0 is a Tip. Read from the markup, not from a lab run.", "head 中阻塞渲染的样式表与同步脚本为 0；大于 0 为提示。依据标记判定，不是实验室运行。"],
  ["9.1", "AI answer block on the results page", "结果页是否出现 AI 答案块", "Absent; present is Warning because ranking may not produce a click. Presence only — whether the block fully answers the query is a content judgement this run does not make.", "不存在；存在则为警告，因为获得排名也可能没有点击。仅判定是否存在——该答案块是否完整回答了查询属于内容判断，本次运行不作此判断。"],
  // 9.2 "recently registered domains in the top 10" was removed on 2026-08-18.
  // It needs a domain registration date, which no wired provider returns. The
  // only substitute — a backlink's `first_seen` — is a different fact, and it
  // is wrong on exactly the young domains the check exists to find. Listing a
  // check that can never run is the same defect this whole effort removed from
  // the readiness count, one level up.
  ["9.3", "Lower-traffic sites in the top 10", "前十是否有低流量站点", "At least one; none reduces opportunity health", "至少 1 个；没有则降低机会健康度"],
  ["9.4", "Community result on the results page", "结果页是否有社区型结果", "At least one forum, Q&A or video result; none is a Tip. Read from the provider's item-type list for one live sample.", "至少有一个论坛、问答或视频类结果；没有则为提示。依据供应商对单次实时采样返回的条目类型清单判定。"],
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

/**
 * Which record, when it fires, makes a check a Blocker rather than a Warning.
 *
 * Separate from `BLOCKER_CAPABLE`, which only says a check is allowed to reach
 * that severity. Both are needed and they used to disagree silently: A5 and 1.2
 * publish "above 0 is Blocker", were listed as capable, and had no record here,
 * so a site that failed them was told Warning. The published text and the
 * executed severity are tied together by a test rather than by discipline.
 */
/**
 * Checks this run cannot observe at all, and why.
 *
 * Distinct from "no detector reads it yet", which is what an unwired check
 * says by default and which promises a later release. For these there is
 * nothing to read: the material is not in a bounded anonymous crawl and would
 * not be in the next one either. Saying so is the difference between a gap and
 * a boundary, and the visitor can only plan around the second.
 */
const UNMEASURABLE_HERE: Readonly<Record<string, AgentAuditLocalizedText>> = {
  B4: l(
    "Crawl budget has no published per-URL rate, and a comparison against the site's own history needs crawl logs this run does not receive.",
    "抓取预算没有官方的单 URL 速率，而与站点自身历史比较需要本次运行拿不到的抓取日志。",
  ),
  B5: l(
    "Separating discovery crawls from refresh crawls needs server logs or Search Console crawl stats; neither is available to this run.",
    "区分发现型抓取与刷新型抓取需要服务器日志或 Search Console 抓取统计，本次运行两者都拿不到。",
  ),
  C5: l(
    "A link-following crawl reaches a page by an internal link or from the sitemap, so a page in neither was discovered from a page this run's budget dropped. The filter would report our own budget as the site's defect.",
    "跟随链接的抓取只能通过内链或 sitemap 到达页面，因此两者都不在的页面，其实是从本次预算丢掉的那个页面被发现的。这个过滤器只会把我们自己的预算当成站点的缺陷来报。",
  ),
  E5: l(
    "No publish or modified date is collected, and whether content is time-sensitive is a judgement about the subject rather than a fact on the page.",
    "本工具不采集发布或修改日期，而内容是否具有时效性是关于主题的判断，不是页面上的事实。",
  ),
  "4.1": l(
    "The body text of the top ten results is never fetched, so there is no median to compare this page against.",
    "本工具从不抓取前十名结果的正文，因此没有可供本页面对比的中位数。",
  ),
  "5.2": l(
    "Per-image byte size needs one request per image, which is roughly two and a half times this run's entire request ceiling.",
    "逐张图片的字节大小需要每张图一个请求，约为本次运行整个请求上限的两倍半。",
  ),
  "5.4": l(
    "A static crawl has no viewport, so it has no fold to measure against.",
    "静态抓取没有视口，因此也就没有可供衡量的首屏折线。",
  ),
  "6.5": l(
    "External outbound links are dropped during parsing, and this check declares itself unscored in any case.",
    "外部出站链接在解析阶段就被丢弃了，而且这项检查本身也声明不参与评分。",
  ),
  "7.3": l(
    "The parser keeps JSON-LD types and error counts, not property keys, and no registry of required properties per type exists here.",
    "解析器只保留 JSON-LD 的类型和错误计数，不保留属性键，而且这里也没有「每种类型必需哪些属性」的登记表。",
  ),
  "7.4": l(
    "Same as 7.3, plus it would need a similarity judgement between markup and visible text that the launch gate forbids.",
    "与 7.3 相同，此外它还需要在标记与可见文本之间做相似度判断，而上线门槛禁止这样做。",
  ),
  "4.5": l(
    "Page bodies are collected, but the published rule requires a false-positive gate before it can run, and a paginated archive is the case it would get wrong.",
    "页面正文是采集到了，但公布的规则要求先通过假阳性门槛才能运行，而分页归档正是它最容易判错的那种情况。",
  ),
};

const BLOCKER_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  D6: ["hreflang_target_http_error"],
  "1.7": ["hreflang_target_http_error"],
  A4: ["soft_404_page"],
  "1.8": ["soft_404_page"],
  "1.1": ["non_2xx_final_status"],
  "1.3": ["noindex_directive"],
  "1.6": ["non_2xx_final_status"],
  "1.2": ["page_disallowed_for_search_crawler"],
  A5: ["sitemap_url_disallowed_by_robots"],
};

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
  "9.5": ["target_query_ranking_band"],
  A5: ["sitemap_url_disallowed_by_robots"],
  "1.2": ["page_disallowed_for_search_crawler"],
  "7.5": ["page_without_breadcrumb_list"],
  D4: ["image_alt_coverage"],
  "5.1": ["image_without_alt_text"],
  "5.3": ["image_in_legacy_format"],
  "2.6": ["open_graph_incomplete"],
  "3.3": ["heading_level_skipped"],
  A4: ["soft_404_page"],
  "1.8": ["soft_404_page"],
  D1: ["title_duplicate"],
  D6: ["hreflang_target_http_error"],
  "1.7": ["hreflang_target_http_error"],
  "4.4": ["content_to_code_ratio"],
  "6.5": ["external_link_follow_mix"],
  "3.4": ["h2_count_outside_reviewed_range"],
  "3.5": ["h3_count_outside_reviewed_range"],
  "4.2": ["target_query_density"],
  "7.2": ["schema_type_unmatched_to_page_type"],
  "8.6": ["render_blocking_head_resource"],
  "5.4": ["first_image_lazy_loaded"],
  "3.6": ["thin_section_under_h3"],
  "7.3": ["json_ld_missing_required_property"],
  "4.3": ["target_query_first_appearance"],
  E4: ["non_brand_click_share"],
  "8.1": ["core_web_vital_lcp"],
  "8.2": ["core_web_vital_inp"],
  "8.3": ["core_web_vital_cls"],
  "8.4": ["core_web_vital_ttfb"],
  "9.1": ["ai_answer_block_present"],
  "9.4": ["no_community_result_present"],
  "2.3": ["title_without_target_query"],
  "3.2": ["h1_without_target_query"],
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
  D1: [
    {
      // Published as "below 2%", and the record already excludes variants that
      // converge on a canonical — the first half of D1's launch gate, met by
      // the detector the duplicate checks have always shared.
      recordId: "title_duplicate",
      kind: "affected-ratio",
      passBelow: 0.02,
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
  D4: [
    {
      recordId: "image_alt_coverage",
      kind: "aggregate-min",
      label: "alt_coverage_share",
      passAtOrAbove: 1,
      failBelow: 0.95,
    },
  ],
  "5.3": [
    {
      // Published as "at least 80% modern", executed as "at most 20% legacy".
      // The same bound, written in the direction the rule kind can express;
      // the modern share is published beside it because that is the number the
      // threshold names and the reader will look for.
      recordId: "image_in_legacy_format",
      kind: "observation-value-max",
      label: "legacy_format_share",
      max: 0.2,
    },
  ],
  // The three published CrUX bands, expressed exactly: pass at or below the
  // good bound, degrade through the needs-improvement band, fail past it.
  "8.1": [
    {
      recordId: "core_web_vital_lcp",
      kind: "aggregate-max",
      label: "lcp_ms",
      passAtOrBelow: 2_500,
      failAbove: 4_000,
    },
  ],
  "8.2": [
    {
      recordId: "core_web_vital_inp",
      kind: "aggregate-max",
      label: "inp_ms",
      passAtOrBelow: 200,
      failAbove: 500,
    },
  ],
  "8.3": [
    {
      recordId: "core_web_vital_cls",
      kind: "aggregate-max",
      label: "cls_score",
      passAtOrBelow: 0.1,
      failAbove: 0.25,
    },
  ],
  "8.4": [
    {
      recordId: "core_web_vital_ttfb",
      kind: "aggregate-max",
      label: "ttfb_ms",
      passAtOrBelow: 800,
      failAbove: 1_800,
    },
  ],
  "9.5": [
    {
      // Published as "1-6 preferred; 7-10 low-click; 11+ ineffective", which
      // is a bound on the position itself, not on how many pages are affected.
      recordId: "target_query_ranking_band",
      kind: "aggregate-max",
      label: "query_position_band",
      passAtOrBelow: 6,
      failAbove: 10,
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
  // 8.5 and 8.6 stay: both need Lighthouse lab audit details (transfer bytes,
  // render-blocking resources) that the field read does not return, and 8.6's
  // detail array is absent rather than empty when the audit did not run, which
  // reads as a pass on something unmeasured.
  // 9.3 stays: it needs a traffic estimate per page-one domain, which is a
  // second paid call against a different endpoint, and the sample this one
  // takes carries domains without any measure of what they receive.
  // 8.5 still needs subresource bytes, which is one request per asset; 9.3
  // needs a traffic estimate per page-one domain, a second paid call.
  if (id === "8.5" || id === "9.3") return "not-integrated";
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
  "2.3": l(
    "The confirmed query does not appear in this page's title as a token sequence, so the one line a searcher reads before deciding whether to click does not name what they typed. Put the page's own subject first and the brand, if any, last: a title that opens with the site name spends its most valuable characters on a word the reader already chose. Write it for the reader, not for the match — a title that names the query and promises something the page does not deliver loses the click twice, once when they bounce and again when the result stops being shown.",
    "已确认的目标词没有以词序列的形式出现在这个页面的 title 里，也就是说，搜索者在决定是否点击之前读到的那一行，没有点出他们刚刚输入的东西。把页面自己的主题放在最前面，品牌名（如果要放）放在最后：以站点名开头的标题，把最值钱的那几个字符花在了读者本来就已经选定的词上。要为读者写，而不是为匹配写——一个点了词、却承诺了页面给不了的东西的标题，会两次失去这次点击：一次是读者跳出，一次是这条结果不再被展示。",
  ),
  "3.2": l(
    "The H1 does not contain the confirmed query as a token sequence. This is a Tip rather than a Warning because the H1 is read after the click, not before it, so it changes what a reader confirms rather than whether they arrive. Make it agree with the title without repeating it word for word: the title is the promise and the H1 is the first line of keeping it. Matching is a token sequence with no synonyms and no stemming, so a heading that means the same thing in different words is reported here and is not necessarily wrong.",
    "H1 里没有以词序列的形式包含已确认的目标词。这一项是提示而不是警告，因为 H1 是点击之后才被读到的，不是点击之前，所以它影响的是读者进来之后确认了什么，而不是他们会不会进来。让它与 title 一致，但不要逐字重复：title 是承诺，H1 是兑现承诺的第一句。匹配按词序列进行，不做同义词也不做词形还原，所以一个用不同词表达同一意思的标题会在这里被报出来，而它未必是错的。",
  ),
  A4: l(
    "Each of these answers 200, says it cannot find something, and has almost nothing else on it. To a search system that reads as a real page, so it gets crawled, considered for indexing, and competes with the pages you meant. Answer 404 or 410 for a URL that is genuinely gone — that is the whole fix and it is usually one route handler. If the URL should exist, the finding is the opposite one: the page is failing to render its content and the status is the only thing still correct. Check the linking pages either way, because a URL nothing links to and nothing lists does not need a status at all.",
    "这些页面都返回 200，页面上写着找不到东西，除此之外几乎什么都没有。在搜索系统看来这就是一个真实页面，于是它会被抓取、被考虑收录，并和你真正想要的页面竞争。如果这个 URL 确实已经没有了，就返回 404 或 410——这就是全部的修法，通常改一处路由处理即可。如果这个 URL 本该存在，那结论正好相反：是页面没能渲染出内容，而状态码是唯一还正确的东西。无论哪种情况都去看一下链到它的页面，因为一个没人链接、也不在任何清单里的 URL，根本不需要状态码。",
  ),
  "1.8": l(
    "This page answers 200 while telling the reader it has nothing. Both signals had to be present for it to be reported — the not-found wording and a body below the published floor — so a short page that says nothing of the kind is not here, and neither is an article about error pages. Serve 404 or 410 if the URL is gone; if it should exist, treat this as a rendering failure and fix what the page is not producing. Do not add noindex as the fix: the URL still resolves, still consumes crawl budget, and still collects internal links.",
    "这个页面返回 200，却在告诉读者它什么都没有。要被报出来必须两个信号同时成立——「找不到」类措辞，以及正文量低于公布的下限——所以内容少但没说这类话的页面不在这里，讲错误页的文章也不在这里。如果这个 URL 已经没有了，就返回 404 或 410；如果它本该存在，就把这当作渲染失败来查，修的是页面没能产出的东西。不要用 noindex 当修法：URL 依然解析得通，依然消耗抓取预算，依然在收内链。",
  ),
  "8.1": l(
    "LCP is when the largest thing above the fold finishes painting, so the fix is almost always about that one element rather than about the page. Find it first — it is usually the hero image or the first block of text — and then work in this order: make sure it is discoverable in the initial HTML rather than inserted by script, give it priority so nothing queues ahead of it, and only then optimise its bytes. Reordering what loads first beats compressing what loads late. This is CrUX p75 over a 28-day window of real visits, so it lags anything you ship today by weeks.",
    "LCP 是首屏中最大的那个元素完成绘制的时刻，所以修法几乎总是围绕那一个元素，而不是围绕整个页面。先把它找出来——通常是首屏大图或第一段文字——然后按这个顺序做：确认它在初始 HTML 里就能被发现、而不是由脚本插入；给它优先级，别让别的东西排在它前面；最后才去压它的体积。调整加载顺序的收益，大于压缩晚到的资源。这是真实访问在 28 天窗口上的 CrUX p75，所以你今天发布的改动要几周后才反映到这里。",
  ),
  "8.2": l(
    "INP measures how long the page takes to respond after a real person taps or clicks, so it is about the main thread being busy, not about download size. Look for the work that runs on interaction: a handler doing layout-triggering reads and writes together, a large re-render where a small one would do, third-party script executing on the same thread. Break long tasks up and yield between them — a visible response inside 200 ms with the real work continuing behind it counts as fast, because that is what the metric asks.",
    "INP 衡量的是真人点击或触摸之后，页面需要多久才响应，所以它关乎主线程是否繁忙，而不关乎下载体积。去找在交互时运行的那部分工作：一个把读布局和写布局混在一起的处理函数、一次本可以很小的大范围重渲染、跑在同一线程上的第三方脚本。把长任务拆开并在之间让出线程——在 200 毫秒内给出可见的响应、真正的工作在后面继续，这就算快，因为这正是这个指标所问的。",
  ),
  "8.3": l(
    "CLS counts content moving after the reader has started reading, and every cause is something that took up space it had not reserved. Give images and video explicit width and height, or an aspect ratio, so the box exists before the file arrives. Reserve the space for anything injected later — a banner, a consent notice, an ad slot — rather than pushing the page down when it appears. Late-loading webfonts shift text; a size-adjusted fallback stops that. None of this is a size problem, so compressing assets will not move it.",
    "CLS 统计的是读者已经开始阅读之后内容仍在移动，而每一个成因都是某个东西占了它没有事先预留的空间。给图片和视频写明宽高，或者写明宽高比，让盒子在文件到达之前就存在。为任何后插入的东西预留空间——横幅、同意提示、广告位——而不是等它出现时把页面往下推。晚加载的网页字体会让文字位移；用做过尺寸调整的兜底字体可以消除这一点。这些都不是体积问题，所以压缩资源不会让它变好。",
  ),
  "8.4": l(
    "TTFB is time spent before the first byte arrives, which means it is server and network, not page. Split it before optimising: DNS and connection setup, then how long the server took to produce the document, then how far the response travelled. A slow server response usually means an uncached database query or a render on every request; distance usually means the document is served from one region to a worldwide audience, and a CDN in front of the HTML — not just the assets — is the fix. Note that this number is above 800 ms for many perfectly healthy sites serving a distant audience, so read it next to where your visitors actually are.",
    "TTFB 是第一个字节到达之前花掉的时间，也就是说它属于服务端和网络，不属于页面。优化前先拆开看：DNS 与连接建立、服务端产出文档所用的时间、以及响应走过的距离。服务端慢通常意味着某个没有缓存的数据库查询或者每次请求都在重新渲染；距离远通常意味着文档只从一个区域提供给全球访客，此时该做的是在 HTML 前面——不只是静态资源前面——加一层 CDN。要注意：对许多完全健康、但受众离服务器很远的站点，这个数字也会超过 800 毫秒，所以要结合你的访客究竟在哪里来读它。",
  ),
  "9.1": l(
    "An AI answer block sits above the results and answers the question in place, so a first-place ranking here earns fewer clicks than the same ranking on a page without one. Do not treat it as a defect to fix — it is a fact about the query, and the decision it forces is whether this query is still worth the effort. Two things follow. Compare the query against ones with no such block before spending more on it. And if you keep it, aim the page at what the block cannot do: the specific case, the current number, the thing that needs your data rather than a summary.",
    "AI 答案块位于结果之上，直接就地回答了问题，因此在有它的结果页上拿到第一名，点击会少于在没有它的结果页上拿到第一名。不要把它当成需要修的缺陷——它是关于这个查询的事实，它逼你做的决定是「这个词还值不值得投入」。由此有两件事：在继续投入之前，把这个词和没有该答案块的词做比较；如果决定继续做，就把页面对准答案块做不到的地方——具体场景、当期数字、必须依赖你自己数据而非概要的那部分。",
  ),
  "9.4": l(
    "No forum, Q&A or video result appeared in this sample, which says the audience for this query is being served by publishers rather than by each other. That makes it harder, not impossible: there is no discussion thread to outrank, so the competition is other pages doing the same job as yours. Read it beside the AI answer check — a query with a block and no community results is one where the answer is settled and a page has little room to add, and that is the clearest signal to spend the effort somewhere else.",
    "本次采样中没有出现论坛、问答或视频类结果，这说明这个查询的受众是由出版方在服务，而不是由用户彼此服务。这让它更难，但不是不可能：没有讨论帖可以超越，竞争对手就是其他在做同样事情的页面。要和 AI 答案那一项结合起来读——一个既有答案块、又没有社区型结果的查询，意味着答案已经定型、页面能补充的空间很小，这是把力气花到别处去的最清晰信号。",
  ),
  "3.4": l(
    "The count sits outside the range reviewed for this page type, and the range is printed beside it so you can judge the judgement. Too few usually means one long section doing the work of three, and the fix is to find where the reader's question changes and put a heading there. Too many usually means headings used for emphasis rather than structure — those belong in the text. Neither is a rule: it is a working band, and a page with a good reason to sit outside it is a page sitting outside it on purpose.",
    "H2 数量落在为该页面类型审阅过的区间之外，区间就印在旁边，你可以自己判断这个判断。偏少通常意味着一个长小节在干三个小节的活，修法是找到读者的问题发生转变的地方，在那里加一个标题。偏多通常意味着标题被当成强调在用，而不是当成结构——那些内容应该回到正文里。两者都不是规则：这是一个工作区间，一个有充分理由待在区间之外的页面，就是有意待在外面。",
  ),
  "3.5": l(
    "Same reading as the H2 count, one level down: H3s are the steps inside a section, so too few means a section that a reader cannot scan and too many means the section should probably have been two. Check this one against the H2 count rather than on its own — a page with three H2s and thirty H3s is not a page with too many H3s, it is a page whose top level is too coarse.",
    "读法与 H2 数量相同，只是低一层：H3 是小节内部的步骤，所以偏少意味着这个小节读者没法扫读，偏多意味着这个小节本该拆成两个。这一项要和 H2 数量放在一起看，别单独看——三个 H2 配三十个 H3 的页面，问题不是 H3 太多，而是顶层划得太粗。",
  ),
  "4.2": l(
    "Published, not judged. Keyword density is not a documented ranking signal, and this check says so in its own threshold — the number is here because the run already computed it and a reader asking for it should not be told no detector exists. If you are going to act on anything in this area, act on whether the page answers the query, which is what checks 2.3 and 3.2 measure. Writing to hit a density figure is the failure mode this check refuses to encourage.",
    "只公布，不判定。关键词密度不是有据可查的排名信号，这项检查在自己的阈值里就是这么写的——数字放在这里，是因为本次运行本来就算出来了，而一个想看它的读者不该被告知「没有检测器」。如果你要在这个方向上动手，那就去看页面是否真的回答了这个查询，也就是 2.3 和 3.2 在测的东西。为了凑到某个密度数值去写作，正是这项检查拒绝鼓励的那种做法。",
  ),
  "7.2": l(
    "The page declares structured data, but not a type from the reviewed set for the page type you confirmed — and both the set and what was found are printed with the finding, so you can decide which one is wrong. Often it is the confirmation: a page can legitimately be more than one thing, and this is a Tip precisely because the mapping is a judgement rather than a rule. When the markup really is the mismatch, change the @type rather than adding a second block; two types competing to describe one page is how a rich result stops appearing at all. Site-furniture types are ignored here, so declaring only a breadcrumb does not pass.",
    "页面声明了结构化数据，但不是你所确认的页面类型对应审阅集合里的任何一个——审阅集合和实际发现的内容都会与结论一起印出来，你可以自己判断哪一边错了。很多时候错的是确认本身：一个页面完全可能同时是好几种东西，而这一项之所以是提示，正因为这个对照关系是判断而不是规则。如果确实是标记不对，那就改 @type，而不是再加一个块；两个类型争着描述同一个页面，正是富媒体结果彻底不再出现的成因。站点通用类型在这里不计入，所以只声明一个面包屑是不能通过的。",
  ),
  "8.6": l(
    "Each of these stops the parser where it sits, so the reader waits for it before seeing anything. Stylesheets come first: inline what the first screen needs and load the rest with a non-blocking pattern, because a single blocking sheet in the head delays every pixel. Then the synchronous scripts — most of them want `defer`, which keeps execution order and stops blocking; `async` only suits scripts that touch nothing else on the page. This is read from your markup, not from a lab run, so it tells you what will block rather than how long it blocked on one sample.",
    "这些资源都会在它所在的位置把解析器停住，读者要等它加载完才能看见任何东西。先处理样式表：首屏需要的内联进去，其余用非阻塞方式加载，因为 head 里哪怕只有一张阻塞样式表，也会推迟每一个像素。然后是同步脚本——它们大多数需要的是 `defer`，它保留执行顺序又不阻塞；`async` 只适合完全不碰页面上其他东西的脚本。这一项依据你的标记判定，不是依据某次实验室运行，所以它告诉你的是「什么会阻塞」，而不是「某一次采样阻塞了多久」。",
  ),
  "5.4": l(
    "The first image on this page defers its own load, which is almost always the one a reader sees first — and the browser will not even start fetching it until layout says it is needed. That delays the exact paint the loading metrics measure, so lazy-loading here costs more than it saves. Take `loading=\"lazy\"` off the first image and add `fetchpriority=\"high\"` instead; keep lazy for everything below it, where it does what it is for. This run has no viewport, so it reads document order as a stand-in for the fold — check that the first image really is the prominent one before acting.",
    "这个页面上的第一张图片给自己加了延迟加载，而它几乎总是读者最先看到的那张——浏览器要等布局判定需要它时才会开始下载。这恰好推迟了加载类指标所衡量的那次绘制，所以在这里做 lazy-load 是得不偿失的。把第一张图上的 `loading=\"lazy\"` 去掉，改成 `fetchpriority=\"high\"`；它下面的图片保持 lazy，那才是这个属性该用的地方。本次运行没有视口，因此用文档顺序代替首屏折线——动手前请确认第一张图确实就是那张主图。",
  ),
  "3.6": l(
    "The sections under these H3s are thinner than the range reviewed for this page type. Read it as a structure signal, not a word quota: a very short section usually means the heading promised something the text did not deliver, and the fix is to either answer the question the heading asks or fold the section into its neighbour. Adding words to reach a number is the failure mode. Counted in whitespace words between headings, so a page written in a script without word gaps is not measured here at all.",
    "这些 H3 下面的小节，内容量低于该页面类型的审阅区间。把它当作结构信号，不是字数配额：一个非常短的小节，通常意味着标题承诺了正文没有兑现的东西，修法要么是把标题提出的问题真正回答掉，要么把这个小节并进相邻的小节。为了凑数字而加字才是失败模式。按标题之间的空白分词计数，所以不使用词间空格的文字所写的页面，在这里根本不参与判定。",
  ),
  "7.3": l(
    "A type is declared without the properties that type needs, so a search system can read the markup and still cannot use it — which is the same outcome as having no markup, after the work of adding some. Fill the named properties from data the visible page already shows; a required property invented to satisfy a validator is worse than the gap, because it makes the page claim something it does not say. Only the types in the reviewed table are judged: a type outside it is left alone rather than assumed complete, so a clean result here is not a statement about every block on the page.",
    "声明了某个类型，却没带这个类型必需的字段，于是搜索系统读得到标记却用不了它——效果和完全没有标记一样，只是白做了加标记的工。用可见页面上已经展示的数据去补上点名的那些字段；为了让校验器通过而编造出来的必填字段比缺字段更糟，因为那会让页面声称它并没有说过的事情。只有审阅表里的类型会被判定：表外的类型不作处理，也不假定其完整，所以这一项通过并不代表页面上每一个块都没问题。",
  ),
  "4.3": l(
    "Published, not judged: where a term sits in the text is not a documented ranking signal, and this reports slots rather than character offsets because slots are what the run captured. What it is useful for is the coarse question — does the page name what it is about anywhere a reader meets early, or only far down. If the answer is \"none\", that is checks 2.3 and 3.2 speaking, and those are the ones worth acting on.",
    "只公布，不判定：一个词在文本中的位置不是有据可查的排名信号；这里报的是「槽位」而不是字符偏移，因为槽位才是本次运行真正采集到的东西。它有用的地方在于那个粗粒度的问题——页面有没有在读者早期就会读到的位置点明自己讲什么，还是只在很靠后的地方才出现。如果答案是「都没有」，那说话的其实是 2.3 和 3.2，值得动手的是那两项。",
  ),
  E4: l(
    "Published, not judged: a healthy split depends on how well known the brand already is, so the level says little and the trend says a lot — compare this run against your own earlier ones rather than against anyone else. A very high non-brand share on a site with a known name usually means the brand queries are being lost rather than that the rest is winning; a very low one means the site is being found by people who already knew it, which is a marketing result rather than a search one. Brand terms are derived from the property you authorised and matched as substrings, so \"acme pricing\" counts as brand.",
    "只公布，不判定：健康的占比取决于品牌本身已经多为人知，所以绝对值说明不了什么，趋势才说明问题——拿这次运行和你自己以前的比，别和别人比。一个已有知名度的站点如果非品牌占比极高，通常意味着品牌词的流量正在流失，而不是其余部分打赢了；占比极低则意味着找到这个站点的人本来就认识它，那是市场结果不是搜索结果。品牌词由你授权的那个资源派生并按子串匹配，所以「acme pricing」算作品牌词。",
  ),
  D6: l(
    "An alternate that answers 4xx or 5xx breaks the cluster for every language in it, not only the one that points at the dead URL: search systems treat the set as a set, and one unreachable member is enough to stop them swapping any of the others in. Fix the URL rather than deleting the tag — deleting it makes the cluster smaller and quietly correct, which loses the page the alternate was pointing at. Alternates outside this crawl are not classified either way, so a cross-domain cluster shows only the part that was reached.",
    "任何一个返回 4xx 或 5xx 的备用地址，破坏的是整个簇里所有语言，而不只是指向死链的那一个：搜索系统把这一组当作一组看，只要有一个成员不可达，其余成员的互换也会停下来。要修那个 URL，而不是删掉那个标签——删掉只会让簇变小然后「安静地正确」，代价是丢掉那个备用地址本来指向的页面。抓取范围之外的备用地址两个方向都不判定，所以跨域的簇在这里只显示被抓到的那部分。",
  ),
  "1.7": l(
    "This page declares an alternate that does not resolve. Check the direction of the error first: a 404 usually means the alternate was never published or its path changed, while a 5xx means it exists and is failing, and only the second is worth a retry before editing anything. Then check reciprocity — every page in a cluster must point back at every other, including itself. A one-way declaration is the most common way a cluster looks complete on one page and is invisible from the others.",
    "这个页面声明了一个解析不了的备用地址。先看错误方向：404 通常意味着这个备用地址从未发布或路径变了，而 5xx 意味着它存在但正在出错，只有后者值得先重试再动手改。然后检查互指——簇里每个页面都必须指回其余每一个，也包括它自己。单向声明是最常见的一种情况：在这一页看起来簇是完整的，从其他页面看却根本不存在。",
  ),
  "4.4": l(
    "This is the share of the delivered HTML that is text a reader can see. There is no threshold worth publishing for it, so nothing here fails — read it as a weight hint. A low ratio on a page that renders fine usually means inline data or a large framework payload shipped with the document; that costs transfer and parse time on every visit, and it is the same bytes the performance checks measure from the other side. A high ratio is not automatically good either: it is what a page with almost no markup looks like.",
    "这是交付的 HTML 里读者能看见的文字所占的比例。没有值得公布的阈值，所以这里不会判任何页面不通过——把它当作体积提示来读。一个渲染正常的页面比例偏低，通常意味着随文档一起发出的内联数据或较大的框架负载；这会在每次访问上消耗传输和解析时间，也正是性能检查从另一侧测到的同一批字节。比例高也不自动等于好：一个几乎没有标记的页面就长这样。",
  ),
  "6.5": l(
    "Counted by destination rather than by anchor, so one partner linked from the nav, the body and the footer counts once. There is no ratio worth publishing — nofollow on outbound links is a choice about what you vouch for, not a score — so read it as a description of what this page currently vouches for. The one entry worth acting on is links that open in a new tab without rel=\"noopener\": that is a security property, not an SEO one, and it is listed here because this is where the outbound links already are.",
    "按目标地址统计，不按锚点统计，所以一个合作方即使在导航、正文、页脚各链一次也只算一个。没有值得公布的比例——出站链接加 nofollow 是「你愿意为什么背书」的选择，不是分数——所以把它当作「这个页面目前为什么背书」的描述来读。这里唯一值得动手的一项是：在新标签打开却没有 rel=\"noopener\" 的链接。那是安全属性不是 SEO 属性，列在这里只是因为出站链接本来就在这。",
  ),
  D1: l(
    "Two pages with the same title are two pages asking to be shown for the same thing, and a search system picks one. Group the duplicates before editing: an exact repeat across a paginated archive or a filtered listing is a template that never varies its title, and the fix is to give the template a variable — the page number, the filter, the section — not to hand-write forty titles. If the pages really are the same page, the duplicate title is the symptom and the canonical is the fix. Variants that already converge on a canonical are excluded from this count, so what is left is genuinely competing.",
    "两个页面用同一个 title，就是两个页面在为同一件事争取展示，而搜索系统只会选一个。改之前先给重复项分组：分页归档或筛选列表上的完全重复，说明模板的标题从不随内容变化，修法是给模板加一个变量——页码、筛选条件、栏目——而不是手写四十个标题。如果这些页面本来就是同一个页面，那重复标题只是症状，Canonical 才是修法。已经收敛到 Canonical 的变体不计入这里，所以剩下的都是真的在互相竞争。",
  ),
  D4: l(
    "Group the uncovered pages by path shape before writing anything. If they share one, the template behind them renders images without an alt attribute and one edit covers the group; if they do not, the alt was skipped page by page and this is a content pass, not a code one. Write what the image conveys in the sentence it sits in, not what it depicts — the same photograph is \"the finished dashboard after setup\" on one page and \"our team in 2024\" on another. An image that carries no meaning takes alt=\"\", which this check already counts as covered.",
    "动手写之前，先按路径形状给未覆盖的页面分组。如果它们共用一种路径，说明背后的模板渲染图片时就没带 alt 属性，改一处即可覆盖一整组；如果不共用，那是逐页漏掉的，这就是一轮内容工作而不是代码工作。写的是这张图在它所处的句子里传达了什么，而不是它画了什么——同一张照片，在一个页面上是「配置完成后的仪表盘」，在另一个页面上是「2024 年的团队」。不承载信息的图片写 alt=\"\" 即可，本检查已经把它计为已覆盖。",
  ),
  "5.1": l(
    "Each image here has no alt attribute at all, so a reader using a screen reader is told nothing about it and a search system has only the file name. Write the alt from what the image is doing on this page: the instruction it illustrates, the state it shows, the person it names. Do not start with \"image of\" — the assistive technology already says that. If the image is purely decorative, give it alt=\"\" rather than leaving the attribute off; the empty form is a statement that there is nothing to say, and this check accepts it.",
    "这里的每张图片都完全没有 alt 属性，用读屏软件的读者因此得不到任何信息，搜索系统能拿到的也只有文件名。按这张图在本页面上正在做的事情来写：它说明的操作、它展示的状态、它指认的人。开头不要写「图片：」——辅助技术自己会先说这一句。如果图片纯粹是装饰，给它 alt=\"\" 而不是干脆不写这个属性；空写法本身就是「这里没有需要说的内容」这个陈述，本检查接受它。",
  ),
  "5.3": l(
    "These images are served in a format that costs more bytes than the same picture needs. The cheapest version of this fix is not a re-export: point the pipeline that already serves them at a format-negotiating layer — an image CDN, or your framework's own image component — so a browser that supports AVIF gets AVIF and one that does not still gets what it gets today. Do the largest files first; a single hero image usually outweighs every icon on the page. Images whose URL states no extension are not counted here at all, so this share is of what could be read.",
    "这些图片使用的格式，比同一张画面实际需要的字节数更贵。最便宜的修法不是重新导出：把已经在提供这些图片的链路指向一个能协商格式的层——图片 CDN，或者你所用框架自带的图片组件——让支持 AVIF 的浏览器拿到 AVIF，不支持的仍然拿到今天这一份。先处理体积最大的；单张首屏大图往往比页面上所有图标加起来还重。URL 里读不出扩展名的图片完全不计入这里，所以这个占比只针对能读出格式的那部分。",
  ),
  "2.6": l(
    "This page is missing at least one of og:title, og:description and og:image, so when someone shares it the platform falls back to whatever it can scrape — often the page title and a logo, sometimes nothing. Add all three or none: a card that renders a title with no image is not two-thirds of a preview, it is a preview that looks broken. The image is the part worth spending time on, because it is what a reader sees before any text, and it needs to be readable at the small size a timeline renders it at.",
    "这个页面缺少 og:title、og:description、og:image 中的至少一项，别人分享它时，平台只能退回去抓能抓到的东西——通常是页面标题加一个 logo，有时什么都没有。要加就三项都加，否则不如不加：只渲染出标题、没有图的卡片不是三分之二的预览，而是一个看起来坏掉的预览。其中最值得花时间的是那张图，因为读者在看到任何文字之前先看到它，而它必须在时间线渲染的那个小尺寸下依然读得清。",
  ),
  "3.3": l(
    "The outline jumps a level here — an h2 followed directly by an h4, say — which tells a reader navigating by headings that a section exists that does not. Almost always the cause is styling: someone picked the heading tag that looked right rather than the one that was right. Fix it by choosing the level from the document structure and moving the appearance into CSS. Levels are counted in document order from the page's first heading, including headings that contain only an icon, so what is reported is the sequence the markup actually declares.",
    "这里的标题层级跳了一级——比如 h2 后面直接接 h4——这会告诉靠标题导航的读者：存在一个其实并不存在的小节。成因几乎总是样式：有人挑了看起来对的标题标签，而不是结构上对的那个。修法是按文档结构选层级，把外观交给 CSS。层级是从页面的第一个标题开始、按文档顺序统计的，也包含只有图标没有文字的标题，所以这里报出来的就是标记实际声明的那个序列。",
  ),
  A5: l(
    "Each of these URLs is on the sitemap, which is the site asking for it to be indexed, and is also matched by a Disallow rule, which forbids fetching it. Both cannot be intended. Decide which one is right before editing anything: if the page should be indexed, remove or narrow the Disallow — it is usually a prefix that grew wider than it was meant to. If it should not be, take it out of the sitemap instead, and note that Disallow does not remove an already-indexed URL. That needs noindex, which requires the crawler to be allowed to fetch the page and read it.",
    "这些 URL 同时出现在两处：一是 sitemap，等于站点在要求收录它；二是被某条 Disallow 规则匹配，等于禁止抓取它。两者不可能都是本意。动手前先判断哪一边是对的：如果这个页面应该被收录，就删掉或收窄那条 Disallow——通常是某个前缀写得比原意更宽。如果不该被收录，那就把它从 sitemap 里去掉；并且要知道 Disallow 并不能移除已经收录的 URL，那需要 noindex，而 noindex 又要求抓取器能被允许抓到页面并读到它。",
  ),
  "1.2": l(
    "A Disallow rule matching this page stops Google fetching it, and a page that cannot be fetched cannot be judged on anything else this report says about it. Find the rule by longest match, not by reading top to bottom: the most specific matching pattern wins, and an equally specific Allow beats a Disallow. The common cause is a group written for one crawler while the site assumed it applied to all of them, or a prefix that covers more than it was meant to. Fix the file, then confirm the page fetches cleanly before treating any other finding on it as real.",
    "有一条 Disallow 规则匹配到了这个页面，Google 因此无法抓取它；而抓不到的页面，本报告对它说的其他任何结论都无从判定。找那条规则要按最长匹配来找，不能从上往下读：最具体的匹配模式生效，同等具体时 Allow 胜过 Disallow。常见成因是某条规则是为某一个抓取器写的、但站点以为它对所有抓取器都生效，或者某个前缀覆盖的范围超出了本意。改完文件后，先确认页面能被正常抓到，再把这个页面上的其他发现当真。",
  ),
  "7.5": l(
    "This page sits below the root and declares no BreadcrumbList, so search systems have no machine-readable statement of where it belongs. Add one whose itemListElement mirrors the trail a reader actually sees, in the same order, with the same names, ending at this page. Do not invent a hierarchy the navigation does not show — markup that disagrees with the page is worse than none, and this run cannot check the agreement for you: it reads only the markup.",
    "这个页面位于根目录以下，却没有声明 BreadcrumbList，搜索系统因此拿不到关于它归属位置的机器可读说明。加一个，让 itemListElement 与读者实际看到的路径一致：同样的顺序、同样的名称，最后一级落在本页。不要编造导航里并不存在的层级——与页面不符的标记比没有标记更糟，而本次运行无法替你核对这一致性：它只读得到标记本身。",
  ),
  "9.5": l(
    "This is where the page already sits for the queries you confirmed, averaged across them and weighted by impressions, so a query it is barely shown for cannot flatter the number. Read the best and worst beside it before acting: one average over several queries hides the case worth working, which is four near the top and one far outside. Past position 10 the page is being shown and almost never clicked, and the usual cause is not the page but the competition for that query — check what the results above it actually are before rewriting anything. Between 7 and 10 the cheapest move is almost always making one page unambiguously own the query, because two pages competing for it is the most common reason neither reaches the top band.",
    "这是该页面在你确认的目标词上目前所处的位置，按曝光加权取平均，所以一个几乎没被展示的词无法把数字拉好看。动手前先看旁边的最好和最差：一个跨多词的平均值，恰好会掩盖最值得处理的情况——四个靠前、一个远远在外。排到 10 名以后，页面在被展示却几乎没人点，常见原因不在页面本身而在这个词的竞争强度；先看清排在它上面的到底是什么结果，再决定要不要改写。落在 7 到 10 时，最便宜的动作几乎总是让某一个页面毫不含糊地独占这个词——两个页面互相争抢，是两个都进不了前档最常见的原因。",
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
  const blockerEvidenceRecordIds = BLOCKER_EVIDENCE[id] ?? [];
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
      UNMEASURABLE_HERE[id] !== undefined
        ? "Outside what a bounded anonymous crawl can observe"
        : engine(id, ready) === "access-required"
        ? "Authorized search source required"
        : engine(id, ready) === "not-integrated"
          ? "Required engine not integrated"
          : ready
            ? "Bounded crawl"
            : "Crawl collects the material; no detector reads it yet",
      UNMEASURABLE_HERE[id] !== undefined
        ? "超出有边界匿名抓取可观测的范围"
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
    // A check that publishes "not judged" must not then render a Warning.
    // The severity is read off the same sentence the reader sees, rather than
    // from a second list beside it — 4.2 says density "is not used to judge a
    // page" and was still resolving to Warning because nobody added it.
    failureResult:
      DECLARES_NO_JUDGEMENT.test(thresholdEn) ||
      ["A7", "C6", "D7", "B5", "D2", "2.1", "6.4", "6.5", "2.4", "2.6", "3.2", "3.3", "3.4", "3.5", "4.3", "4.4", "5.2", "5.3", "7.1", "7.2", "7.5", "9.4", "8.6", "3.6"].includes(id)
      ? "tip"
      : "warning",
    primaryAgent,
    inventoryReady: ready,
    engine: engine(id, ready),
    evidenceRecordIds: EVIDENCE[id] ?? [],
    issueRules: ISSUE_RULES[id] ?? [],
    boundary: l(
      UNMEASURABLE_HERE[id]?.en ??
        (ready
          ? "Decided only where this bounded run exposed a matching measurement."
          : "Excluded from scoring until a detector or the named source exists."),
      UNMEASURABLE_HERE[id]?.zh ??
        (ready
          ? "仅在本次有边界运行暴露匹配实测值处判定。"
          : "在检测器或指定来源具备之前排除评分。"),
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
 * How much of its own catalogue this build can decide.
 *
 * Derived on purpose. The visitor-facing method copy quotes these numbers, and
 * the hand-written pair drifted the moment the catalogue moved: the shipped
 * string read "24 of the 81 checks" while the code decided 33 of 80 — a smaller
 * promise than the product keeps, citing a total that no longer exists.
 * Anything that states the coverage must read it from here.
 *
 * `sourceGated` is the subset that has a detector but still needs the visitor
 * to connect a source, so the copy can name it instead of implying every
 * decided check lands on an anonymous run.
 */
function countCoverage(): {
  readonly total: number;
  readonly decided: number;
  readonly sourceGated: number;
} {
  const checks = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap((group) => group.checks);
  const decided = checks.filter((check) => check.inventoryReady);
  return {
    total: checks.length,
    decided: decided.length,
    sourceGated: decided.filter((check) => check.engine === "access-required").length,
  };
}

export const AGENT_AUDIT_COVERAGE = countCoverage();

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
