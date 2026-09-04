---
title: Handoff · /agents/seo 检查项删减 + 爬取范围分层
date: 2026-09-04
基线: origin/main 至 PR #305（含 2026-09-04 全天 9 个 PR）
来源: /Users/wzb/Downloads/2026-09-04-交办-彪哥-agents-seo检查项删减与爬取分层.md
交付对象: 落地这份工作的 code agent
范围: 只涉及 /agents/seo。/tools/on-page-seo-check 不动。
---

# Handoff · /agents/seo 检查项删减 + 爬取范围分层

彪哥那份交办的方向对，但它是对着 9 月 4 日上午的生产实测写的，当天下午又上了 9 个 PR，
有几条前提已经变了；另有三处它「不确定」或写错的地方，代码里能查到确切答案。
这份 handoff 把交办翻译成可以直接开工的任务，并把每一处偏离原文的地方标出来。

**读这份文档之前先读**：`docs/plans/2026-09-03-seo-agent-key-pages-accordion-design.md`
§5.3（fail-closed 裁决）、§5.4（聚合表）、§7（契约与版本链）。下面反复引用的
「只对提交页判定」「wire guard」「台账」三个词都在那里定义。

---

## 0. 一分钟摘要

| # | 交办原文 | 裁决 | 成本 |
|---|---|---|---|
| 1 | 删 2.3「Title contains the target query」，改引导语 | **照做，但范围扩到关键词类 5 项**，不是 1 项也不是彪哥怀疑的「不确定还有没有同类」——同类清单代码里有精确定义（§2.1） | 低 |
| 1b | 「2× check weight 要从总分公式里去掉」 | **不需要改公式**——分母是动态求和，删掉条目它自己就变；要改的是那行硬编码特判和锁权重的测试（§2.3） | 低 |
| 1c | 「89 项里凡是 tested 1 的按同样逻辑处理」 | **不能一刀切**。只对提交页判定的共 15 项，其中只有关键词类 5 项符合「Checker 做得更深」；另 10 项 Checker 不做或做得不深，必须留（§2.2） | — |
| 2 | 候选页按五条规则收（首页/导航直链/路径集群/内链前 15/黑名单） | **照做**。规则 2 需要把爬虫已解析但没投影的导航链接暴露出来（§3.2）；「不做发现式爬取」一句有逻辑矛盾要修正（§3.1） | 中 |
| 2b | 「Broken internal links / Orphan pages 到底实现了没」 | **孤岛页实现了（C1、C5），断链没实现（C2 只有目录条目，没有 detector）**。彪哥在 gengrowth.ai 上找不到孤岛页是因为它通过了或截断退出，不是没做（§3.4） | — |
| 3 | 免费档 / 付费档两档运行 | **需要 Owner 拍板两件事再开工**：积分单价、以及现有 10 积分的 agent-audit 落在哪一档（§4.3）。技术准备工作可以先做 | 中 |

**本轮明确不做**：不新增检查、不加进度条、不改 On-Page Checker。

---

## 1. 现状核对：交办里的前提 vs 代码事实

| 交办说 | 代码事实 | 对 handoff 的影响 |
|---|---|---|
| 2.3 是「tested 1 · affected 1」单页判断 | 对。`title_without_target_query` 在 `KEYWORD_EVIDENCE_RECORD_IDS`，进 `TARGET_ONLY_RECORD_IDS`（`agent-key-page-records.ts`），非提交页上 fail-closed 为 excluded | 删它不影响关键页聚合 |
| 「现在的 12 页像是 BFS 前 12」 | 不是 BFS，但效果接近：服务端 `selectAgentKeyPageCandidates` 取首页→提交页→按深度层、每层按 `inboundLinks` 降序，≤24；客户端 `agent-key-pages.ts` 用画像 `coreFeatures` 整词匹配 +1000 打分取 12 | 彪哥的批评成立——深度优先排序在导航链 20 个工具页的站上，会按内链数砍掉一部分。五条规则替换这两层 |
| 「产品内部已经把 214 页发现和 12 页深度检查分开了」 | 对。抓取全站→`result.pages`；关键页是抓取后的投影。两者在同一次运行里 | 分档 = 让「抓多少」成为运行参数，而不是重做检查逻辑 |
| 「不做站内发现式爬取，不追踪候选池之外的链接」 | **逻辑矛盾**：规则 3（路径集群「聚集 3 个以上」）和规则 4（「按站内内链数排序」）都要先爬过链接源才算得出。零发现就没有内链数 | 免费档的真实形态是「浅层发现 + 规则筛选」，见 §3.1 |
| 「Broken internal links / Orphan pages 一条都没找到，不确定实现了没」 | C1 孤岛页占比：**实现了**（记录 `sitemap_page_without_observed_inlink`）。C5 失去发现路径：**实现了**（`page_without_any_discovery_path`）。C2 断链数：**没实现**——目录有条目、`EVIDENCE` 表里没有它的记录 | 孤岛页不是「设计成付费专属」而是「移到付费档」；断链是全新实现 |
| 「上限约 950 页 / 4 分钟」 | 预算 `PUBLIC_TOOL_SYNC_CRAWL_BUDGET = { maxUrls: 2000, maxDepth: 6, maxWallClockMs: 240_000, perHostConcurrency: 5, minHostDelayMs: 250 }`（`packages/sources/src/crawl/public-preview.ts:70`）。950 是限速下的实测上限 | 付费档维持这个预算即可 |
| 「X/12 key pages」标签 | 今天 PR #305 之后**一个检查在几个关键页命中就拆成几行**，行上印页面路径，不再是一行带计数 | 交办第 99 行「每个页面一行的评分卡」的形态**已经部分存在**，别重做 |
| 「引导到 On-Page Checker」 | 今天 PR #304 之后每个非提交的命中页旁已有「检查这一页」按钮，写 `seo-agent-key-page` handoff 跳 checker | 删 2.3 后的引导语要和这个按钮**说同一件事**，别出现两套措辞 |

---

## 2. 任务一：检查项删减

### 2.1 删哪些：精确清单，不用再猜

只对提交页判定的记录集合是代码里的常量 `TARGET_ONLY_RECORD_IDS`
（`apps/marketing/src/components/agents/agent-key-page-records.ts`），由四个来源集合拼成。
反查 `EVIDENCE` 表（`packages/public-tools/src/agent-audit/catalog.ts`）得到 **15 个检查**：

| 类 | 检查 | 记录 id | Checker 是否做得更深 | 处置 |
|---|---|---|---|---|
| 关键词 | **2.3** Title 含目标词 | `title_without_target_query` | 是（keyword placement · 标题位点） | **删，改引导** |
| 关键词 | **3.2** H1 含目标词 | `h1_without_target_query` | 是（H1 位点） | **删，改引导** |
| 关键词 | **2.10** 目标词在 description/副标题/开头正文 | `target_query_slot_coverage` | 是（三个位点分别给分） | **删，改引导** |
| 关键词 | **4.2** 目标词密度 | `target_query_density` | 是（密度分） | **删，改引导**（本来就是 observed-only，删了无判定损失） |
| 关键词 | **4.3** 目标词首次出现位置 | `target_query_first_appearance` | 是（开头正文位点） | **删，改引导**（同上） |
| 页型 | 3.4 H2 数量区间 | `h2_count_outside_reviewed_range` | 否 | 留 |
| 页型 | 3.5 H3 数量区间 | `h3_count_outside_reviewed_range` | 否 | 留 |
| 页型 | 3.6 H3 下段落过薄 | `thin_section_under_h3` | 否 | 留 |
| 页型 | 7.2 schema 类型与页型不匹配 | `schema_type_unmatched_to_page_type` | 否 | 留 |
| 性能 | 8.5 页面总传输体积 | `page_total_transfer_bytes` | 否 | 留 |
| 性能 | 5.2 图片超传输预算 | `image_over_transfer_budget` | 否 | 留 |
| SERP | 9.1 AI 答案块存在 | `ai_answer_block_present` | 否 | 留 |
| SERP | 9.3 首页无低流量站点 | `page_one_without_a_low_traffic_site` | 否 | 留 |
| SERP | 9.4 无社区结果 | `no_community_result_present` | 否 | 留 |
| SERP | 9.5 目标词排名区间 | `target_query_ranking_band` | 否 | 留 |

**判据**是交办自己给的：「同一件事 Checker 做得更深」。后 10 项 Checker 不做（SERP、CrUX
性能）或做得不深（页型），删了就是能力净损失，不是去重。它们「只测提交页」是 fail-closed
裁决的结果（设计 §5.3），不是缺陷。

### 2.2 怎么删：只删目录条目，不动服务端台账

**不要**从 `KEYWORD_EVIDENCE_RECORD_IDS` 里删记录 id。理由：`hasCompleteNeutralRecordLedger`
要求响应里的记录数**等于**台账长度，改台账必须 bump `seo_audit.sitewide.v18 → v19` 和
`AGENT_KEYWORD_CHECKS_VERSION`，旧缓存行会被 wire guard 拒绝为「无法安全展示」
（8 月和本周各出过一次这种事故）。删目录条目不碰台账，缓存不受影响，记录变成没人引用的
孤儿，不渲染。

改动点（都在 `packages/public-tools/src/agent-audit/catalog.ts`）：

1. `PAGE_TITLES` 数组删 2.3 / 3.2 / 2.10 / 4.2 / 4.3 五行
2. `EVIDENCE` 表删这五个 key
3. `scoreWeight: id === "2.3" || id === "6.1" ? 2 : 1`（约 1136 行）→ 只剩 `6.1`
4. `BLOCKER_EVIDENCE` / `BLOCKER_CAPABLE` **不含**这五项（已核实），不用动
5. `HOW_TO_FIX` 表删这五项的修复文案（2.3 在 860 行、3.2 864、4.2 908、4.3 932、2.10 964）
6. `DECLARES_NO_JUDGEMENT` 命中清单里 4.2 / 4.3 会自然消失，**检查 §5.4 聚合表的
   observed-only 行是否还有其他成员**（A7 B4 B5 C6 D7 E4 4.4 6.5 还在，行不空）

**已核实孤儿记录不会让契约测试红**：`detector-contract.test.ts:131`「emits every evidence
record the catalog says it reads」的方向是**目录→记录**（目录引用的记录必须被发出），删目录
条目只会缩小这个集合；`:161`「emits exactly the record ledger every consumer pins」钉的是
台账，台账不动就不变。所以不需要白名单。**不要**为了任何理由去删台账。

### 2.3 总分不用改公式

`groupHealth`（`packages/public-tools/src/agent-audit/evaluate.ts:395-420`）是对 `scored`
检查做 `reduce` 求权重和与得分和，删掉条目分母自动变小。交办第 44 行担心的「总分对不上」
不存在。

会红的是 `catalog.test.ts` 的 `keeps the v2 weights, inventory, Agent defaults, and
heading presets` 和 `freezes 5/31 site and 9/58 page entries`——它们钉了条目数与权重表。
页面条目现在是 **58**，删后 **53**；站点条目 31 不变。更新这两条的期望值，**期望值要从新的
常量派生**（`PAGE_AUDIT_GROUPS.flatMap(g => g.checks).length`），不要再写死数字。

同步改：`docs/plans/2026-09-03-...-design.md` §6 的「覆盖数 89」和 `catalog.ts` 里派生
「本 build 能判定 N/M 项」的那段（约 1760 行起，它是动态的，确认一下就行）。

### 2.4 引导语：和已有的按钮说同一件事

删掉的位置（Meta 组 2 结尾、Content 组 4 结尾）各放一条**不判定、不计分、不进 actionable**
的引导。它和 PR #304 的「检查这一页」按钮指向同一个目的地，措辞要一致：

> 想知道某一页是否真的覆盖了目标词？用 On-Page SEO Checker 逐位点看标题、H1、描述、
> 开头正文和密度，附 SERP 预览。

**实现形态**：不要造一个新的「引导型检查」——那会进 89 项分母。在 `agent-issue-accordion.tsx`
的组标题旁或组尾加一个静态 `<p>`，文案进 `agents.workbench.issues.groupHint.{2,4}`。
链接用 `TOOL_HANDOFF_LINK_PROPS`（`target=_blank rel=opener`），如果画像有 `targetQuery`
就写 `seo-agent-key-page` handoff 带提交页 URL，没有就纯链接。

**别漏**：`apps/marketing/src/i18n/messages/{en,zh}.json` 两边都加。缺 key 会静默渲染成
`agents.workbench.issues.groupHint.2` 这个路径字符串（next-intl 的行为），测试要断言
**中文原文出现**，不要只断言 key。

### 2.5 验收

- [ ] `PAGE_AUDIT_GROUPS` 总数 = 原数 − 5；`SITE_AUDIT_GROUPS` 不变
- [ ] 一次真实运行（astrologywiki.com 或 gengrowth.ai）的 issue 列表里不再出现 2.3 / 3.2 / 2.10 / 4.2 / 4.3
- [ ] 同一次运行的响应 `records[]` 里**仍有** `title_without_target_query`（证明台账没动、缓存没作废）
- [ ] 组 2、组 4 尾部出现引导语，点击落到 `/tools/on-page-seo-check` 且 checker 预填了 URL 和目标词
- [ ] `catalog.test.ts` 全绿且期望值从常量派生
- [ ] 变异：把五行中任意一行加回 `PAGE_TITLES` → 条目数测试变红

---

## 3. 任务二：候选页选取规则替换

### 3.1 先修正一处逻辑：免费档不是「零发现」

交办第 96 行「不做站内发现式爬取——不追踪候选池规则之外的任何链接」和它自己的规则 3、4
矛盾：判断 `/tools/` 下「聚集了 3 个以上页面」要先发现那些页面；「按被站内其他页面链接的
次数排序」要先爬过链接源。**零发现算不出内链数。**

正确的免费档形态：**浅层发现，规则筛选**。

- 抓首页 + 首页导航直链页（深度 1）+ 深度 1 页面的出链（深度 2），到此为止
- 从这些页面里按五条规则选候选池
- 候选池里的页面**逐页跑页面级检查**（它们已经在抓取结果里，不用二次请求）
- 抓取预算：`maxDepth: 2`，`maxUrls` 由规则规模决定（见 §3.3 安全阀），墙钟大幅缩短

深度 2 足够覆盖五条规则要的一切：导航在首页（深 0），导航直链页深 1，产品集群和内容页
绝大多数在深 1–2。内链数是深 0–2 之间的链接，对「网站主人认为重要」这个信号是够的——
它不是 GSC 那种全站真值，报告里要说明「按前两层内链计」。

### 3.2 规则 2 需要新信息：导航链接现在没投影出来

`CrawlLinkProjection`（`packages/sources/src/observations.ts`）只有
`targetSubjectUrl / rel / anchorText`，**不带「来自导航还是正文」**。但爬虫的解析器已经
把这件事做了：`parse-page.ts:64` 的 `navigationFetchTargets` 是 header/nav/footer 里的
链接目标，注释写「Ephemeral，只给 keyword context 用」，目前只被 `context-profile.ts:611`
消费，**不进 `CrawlPageProjection`**。

要做的是把它暴露到审计侧：

1. `CrawlPageProjection` 加一个可选字段 `navigationOutlinks?: readonly string[]`
   （只放 subjectUrl，不放 anchorText，体积小），只在深度 0 的页面上填——导航是站点级的，
   首页一份就够，每页都带是 N 倍冗余
2. `packages/sources/src/crawl/engine.ts` 构造 projection 处（约 1312 行）从
   `parsed.navigationFetchTargets` 填入
3. `SeoAuditReport.pages[]` 或 `siteResources` 加 `navigationUrls: readonly string[]`
   （从首页 projection 取）
4. **这是 `crawl.page.v1` 契约的新增字段**。链接字段本身是冻结的（`base href` / www 合并 /
   引号感知三样都曾被回退），**新增一个可选字段不改既有字段的语义，不算破坏**。已核实
   `docs/vendor/signalframe-manifest.json` 不覆盖 `observations.ts`，没有哈希锁要更新。
   但 `crawl.page.v1` 的 fixture 测试若做了 `toEqual` 全等比对会红——改成 `toMatchObject`
   或补字段，别删断言

**别用 anchorText 猜导航**（「Pricing」「About」这种词）：多语言站会漏，且正文里也有这些词。
用解析器已经给的容器语义。

### 3.3 五条规则的落点

全部在服务端 `apps/marketing/src/lib/agents/key-page-candidates.ts`，替换现有
`selectAgentKeyPageCandidates` 的排序逻辑。输入不变（`pages / siteOrigin / inspectedTargetUrl`），
新增 `navigationUrls`。输出类型 `AgentKeyPageCandidate` 加一个 `reason` 字段说明入选原因
（见 §3.5 报告要求）。

```ts
type KeyPageReason =
  | "home"
  | "target"            // 提交页，永远包含（交办没写但必须：它是唯一有完整文本的页）
  | "navigation"
  | { kind: "cluster"; prefix: string }
  | { kind: "content"; inboundLinks: number }
  | "manual";           // §3.6 用户追加
```

| 规则 | 实现 | 注意 |
|---|---|---|
| 1 首页 | 现有 `isHome` | — |
| 1b **提交页** | 现有 `isTarget` | 交办漏了这条。提交页是 15 项只对它判定的检查的唯一对象，且是唯一有 `targetPageExtract` 的页，**不可能不在候选池里** |
| 2 导航直链 | `navigationUrls` 每一个都收，**不设上限** | 黑名单对它无效（交办第 82 行） |
| 3 路径集群 | 对 `pages` 按 URL 第一段路径（`/tools/`、`/agents/`…）分组；组员 ≥3 且 ≤20 → 整簇收；>20 → 转规则 4 | 只看第一段路径。`/blog/2026/09/x` 的前缀是 `/blog/`。根路径 `/x` 不算集群 |
| 4 内容页 | 前缀命中 `/blog/ /posts/ /news/ /articles/` **或**规则 3 判为 >20 的簇 → 按 `inboundLinks` 降序取 15 | 排序键**必须是数量**（`inboundLinks`），tie-break 用 URL 字母序——参考记忆 `unknown-must-sort-last-and-tiebreaks-need-a-quantity` |
| 5 黑名单 | URL 路径含 `about contact privacy terms cookie careers jobs team` → 跳过 | **正则要按路径段匹配**（`/about/`、`/about-us`），不要子串——`/tools/about-page-checker` 不该被黑掉。且导航直链优先级高于黑名单 |
| 安全阀 | 总数 > 50 → 只压规则 4 的 15→10→5，**不动规则 2、3** | 交办第 84 行 |

**客户端打分（`agent-key-pages.ts`）怎么办**：五条规则不依赖画像，候选池由服务端定死。
建议**保留客户端打分但只做排序不做筛选**——`AGENT_KEY_PAGE_LIMIT = 12` 这个截断删掉，
候选池多少就评估多少（安全阀已经控了规模）。画像 `coreFeatures` 命中的页排前面，
用户先看到自己产品相关的。如果嫌复杂，直接删掉客户端打分也可以，用服务端顺序。

### 3.4 孤岛页 / 断链：一个移档，一个新做

- **C1 孤岛页占比、C5 失去发现路径**：已实现。免费档抓深度 2 就停，`stopReason` 非 null
  → `discoveryJudgeable = false`（`model.ts:457`）→ 这两项自动 `unverified`。**这正是
  交办要的效果，不用改代码**，只要报告里的 limitation 文案说清「需要全站抓取」并指向付费档
- **C2 断链数**：`EVIDENCE` 表里没有记录，是**从未实现**。要做就是新 detector：遍历
  `internalOutlinks`，目标 subjectUrl 在 `pages` 里且 `finalStatus >= 400` 或跳转链 >1
  → 一条观测。**这是新记录，要进台账、要 bump v19**——建议和分档一起做，一次 bump

### 3.5 报告必须显示候选池怎么选的

交办第 88 行。`AgentKeyPageCandidate.reason` 投影到客户端后，在 `agent-results.tsx` 结果
概览里加一段：「候选页 N 个：导航 a · 产品集群 b（`/tools/` `/agents/`）· 内容页 c
（按前两层内链取前 15）· 手动 d」。如果安全阀压缩过，列出**被压掉的 URL**（交办第 99 行
「未纳入检查的页面清单」）。

### 3.6 用户可手动追加

交办第 86 行。画像面板「运行上下文」区加一个多行输入「额外检查的页面（每行一个 URL）」，
上限 10 个，必须同源（`siteOrigin`），走现有 `normalizeSeoAuditUrl`。随审计请求上送
`extraKeyPages: string[]`，服务端**验证同源后**并入候选池，`reason: "manual"`。

**不要**把它塞进画像刷新契约（`AGENT_PROFILE_REFRESH_FIELD_PATHS`）——那是模型推断的
字段集，加一个用户输入进去要 bump schema 版本且语义不对。它是审计请求的一部分，走
`apps/marketing/src/lib/tools/seo-audit-input.ts`（注意在 `lib/tools/` 不在 `lib/agents/`）。

### 3.7 验收

- [ ] gengrowth.ai：候选池含首页、提交页、导航里所有链接、`/tools/` 全簇、`/blog/` 前 15；不含 `/about` `/privacy`
- [ ] 一个导航链 20 个工具页的站（构造 fixture）：20 个全在候选池，reason 全是 `navigation` 或 `cluster`
- [ ] 一个 `/blog/` 有 80 篇的站：只收 15，且是 `inboundLinks` 最高的 15
- [ ] 结果概览显示「导航 a · 集群 b · 内容 c」分解，数字与候选池一致
- [ ] 变异：把黑名单改成子串匹配 → `/tools/about-page-checker` 被黑掉的用例变红
- [ ] 变异：去掉「导航优先于黑名单」→ 导航里的 `/about` 被黑掉的用例变红

---

## 4. 任务三：两档运行

### 4.1 预算是被锁死的，要开一个只能收紧的口子

`scanSeoAuditSite`（`packages/public-tools/src/seo-audit/scan.ts:130`）注释明写
「API callers cannot provide crawl limits」，`PublicPreviewCrawlOptions.engineOptions` 的类型是
`Omit<CrawlEngineOptions, "budget">`——**故意**挡住调用方改预算，防止公开端点被用来放大抓取。

开口子的方式：加 `budgetCeiling?: Partial<CrawlBudget>`，引擎对每个字段取
`Math.min(default, ceiling)`。**只能收紧，永远不能放宽**——这条要有测试钉住：传一个比默认大
的 `maxUrls` 进去，实际预算仍是默认值。

免费档预算建议：`{ maxDepth: 2, maxUrls: 80, maxWallClockMs: 45_000 }`。80 是「首页 +
导航 ~20 + 深 2 出链」的量级上限，45 秒留给 Vercel 60 秒函数够余量。**先在 gengrowth.ai
和 astrologywiki.com 上实测这组数字**，不要直接上。

### 4.2 档位是请求参数，不是两个端点

`/api/agents/seo/audit` 请求体加 `tier: "key-pages" | "full-site"`，走
`apps/marketing/src/lib/tools/seo-audit-input.ts` 解析。默认值**由 §4.3 的裁决决定**。服务端按 tier 选预算和检查集：

| | key-pages | full-site |
|---|---|---|
| 预算 | §4.1 那组 | `PUBLIC_TOOL_SYNC_CRAWL_BUDGET` 不变 |
| 抓取 | 深度 ≤2 | sitemap 种子 + 发现（现状，`engine.ts:1065` 已用 sitemap） |
| 页面级检查 | 候选池逐页 | 全部收集页 |
| 站点级检查 A/B/C/D | 跑，但 `discoveryJudgeable=false` 让 C1/C5 自动 unverified；A/D 组按实际样本报，limitation 写「样本 N 页」 | 全跑 |
| C2 断链 | 不跑（reason: `full_site_only`） | 跑（新做，§3.4） |
| 缓存 | 两档**分开缓存**。现在的键是 `readCrawlCache(TOOL_NAME, host)`（`seo-audit-handler.ts:134,147`），namespace 改成 `${TOOL_NAME}:${tier}`。同一 host 的 key-pages 结果不能被 full-site 请求读到，反之亦然 | |

**不要**用「站点级检查在免费档不显示」来实现分档——它们本来就会因截断诚实地退出判定，
隐藏它们反而让用户不知道少了什么。显示，并在 limitation 里指向付费档。

### 4.3 需要 Owner 拍板的两件事

落地 agent **不要自己定**这两条，开工前问：

1. **积分**：`credits-config.ts` 里 `agent-audit: 10`，`on-page-seo-check: 1`。两档各多少？
   现有的 10 是免费档还是付费档的价？如果免费档要「免费」，是 0 积分还是走现有的首次
   运行奖励（`reportFirstToolRun`）？
2. **默认档**：没传 `tier` 的请求（老客户端、缓存的 handoff）落哪一档？建议 `key-pages`，
   因为它更便宜、更快，且现有用户的心智已经是「关键页」（PR #291 之后的界面）。

拍板之前可以先做的：§4.1 预算口子、§4.2 的 tier 解析和缓存分离、§3 全部。

### 4.4 验收

- [ ] key-pages 档在 gengrowth.ai 上 < 60 秒完成，页数 ≤ 80
- [ ] full-site 档行为与今天完全一致（回归：同 host 两档结果里 A/B 组的记录 `tested` 不同，D 组重复标题的 `tested` 也不同）
- [ ] key-pages 档的 C1/C5 是 `unverified` 且 limitation 提到「全站」
- [ ] 变异：`budgetCeiling.maxUrls = 5000` → 实际预算仍是 2000 的用例变红
- [ ] 两档缓存互不命中（同 host 先跑 key-pages 再跑 full-site，第二次 `cache.status !== "hit"`）

---

## 5. 不变量与护栏（改代码前必读）

这些不是风格意见，每条都是这个仓库被咬过的地方：

1. **改判定逻辑必须同 commit 扫 `catalog.ts` 的 threshold + howToFix**。本周 PR #293 删了
   2.10 代码里的 URL 槽位没删文案，读者被告知域名满足了一项它看不见域名的检查（PR #300 修）
2. **`prettier --write` 会把 `catalog.ts` 等长行文件整体重排**（887 行噪声）。用文本替换改，
   提交前 `git diff --numstat` 看每个文件的行数是不是和你的改动量级一致
3. **测试 fixture 里写死的数字（`22`、`53`、`89`）改成从常量派生**。今天加一个画像字段让
   18 个无关用例一起红，全是硬编码
4. **client 组件不能 import `@sf/sources` 或 `@sf/public-tools` 的 barrel**——`node:net`
   进浏览器包，只有 `pnpm --filter @sf/marketing build` 报错且会指错文件。类型要 import 就
   镜像一份（`agent-target-query-candidates.tsx` 顶部有例子和理由）
5. **每条守卫测试配变异验证**：把修复还原，断言必须变红。不红的测试是装饰
6. **观测的 URL 是 inspected 形态不是 submitted 形态**（`www.x.com` 提交、`x.com` 落地）。
   任何按 URL 匹配都用 `comparableUrl`（`agent-result-helpers.ts` 已导出），别再本地写一份
7. **`gg_gsc` cookie path 是 `/api`**，Agent 路由在 `/api/agents/*` 读得到；别再评估
   「要不要建 GSC 通路」
8. **不要 `git add -A`**；worktree 里可能躺着别人的在建代码

---

## 6. 建议的落地顺序

1. §2 检查项删减（低风险、独立、可先上）
2. §3.2 导航链接暴露 + §3.3 五条规则 + §3.5 报告分解（一个 PR，替换候选页逻辑，**不动预算**——
   此时仍是全站抓取，只是选页规则变了，可以独立验证规则对不对）
3. §4.1 预算口子 + §4.2 tier 解析与缓存分离（技术准备，默认 full-site，行为不变）
4. **等 Owner 拍板 §4.3** → 接积分、切默认档
5. §3.4 C2 断链 detector（需要 bump v19，和 §4 一起上，一次作废缓存）
6. §3.6 手动追加（最后，独立小 PR）

每步一个 PR，每个 PR 跑一次 codex 评审（`codex exec ... -s read-only`，给它 diff 加上
「已定裁决勿报」清单——今天那轮 7 条里 1 条误报就是因为它看不到 diff 外的调用方）。
