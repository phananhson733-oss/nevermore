# GEO 知识库重设计（设置 → 网站 → 与产品 Profile 同级）

日期：2026-09-07
基线：`origin/main@4a3c4100`（PR #319）
状态：**落地中**。设计稿 v3.2（吸收内部规格评审三轮 + codex 跨模型评审三轮）为基准；第 15 节起是落地期间对设计稿的更正、跨模型评审判决与新发现的缺陷，与前 14 节冲突时以第 15 节为准。第 11 节的 D1–D12 按推荐执行，D6 本轮不做、D4（S3 输出层）本轮不做
线上样本：`/zh/account/websites/1f08f279-…`（astrologywiki.com）

## 0. 一句话

把 GEO 知识库从「测量管线的副产品」改成「网站在 AI 引擎面前的官方档案」：一份可发布、有版本、逐条带来源与采用决定、Owner 可修正的知识包，提问集降为它的派生输出。入口不变，仍在设置 → 网站，与产品 Profile 同级同形。

## 1. 现状与诊断

### 1.1 线上现在长什么样

- GEO 卡展开只有三样东西：一行状态「更新未完成，仍显示上次的知识内容」、一个「重新生成」按钮（文案：抓网站、读 Search Console、三次模型调用、完成后直接冻结）、一张 23 条的「完整提问集」表。
- 同页上方的产品 Profile 卡是分区表单 + 900 ms 自动保存 + 「确认画像」+ 已确认 v3 折叠摘要。两张卡上下并列（两个原生 `<details>`），形态断层。

### 1.2 为什么只剩提问集（生产账本，只读查询）

| 事实 | 依据 |
|---|---|
| 09-04 剪枝把冻结视图除提问集外的全部面板移出 DOM | `docs/plans/2026-09-04-geo-kb-frozen-view-pruning-design.md` |
| 09-05 知识包（8 模块）作为 prepared candidate v2 的伴生物上线，只在候选是 v2 时渲染 | PR #316；`geo-kb-version-content.tsx:211` |
| astrologywiki 的两个冻结快照都在 09-04（候选 v1）→ `knowledgePack: null` | `marketing_geo_kb_snapshots` 2 行，`last_freeze 2026-09-04 03:10Z` |
| 09-07 13:45 的「重新生成」在第一步 `roles` 就以 `invalid_output` 失败（模型返回 3562 token，解析器拒收）；`knowledge_pack` 与 `questions` 从未启动 | `marketing_geo_kb_generations` 最新一行 |
| 一键流程是 roles → knowledge_pack → questions → freeze 的串行链，任何一步失败整链停止 | `use-geo-kb-v2-editor.ts:543-582, 712-768` |

结论：知识包这个形态本身已经是对的方向，但它 (a) 从未在真实站点上产出过，(b) 被挂在一条全有或全无的链末端，(c) 生成即冻结，Owner 没有任何修正机会，(d) 站外证据两组在代码里硬编码为空数组（`kb-knowledge-pack.ts:88`），UI 又把空组直接省略（`geo-knowledge-pack.tsx:170`），读者看不出缺了什么。

### 1.3 结构性问题（09-02 诊断三根因的延续）

1. 资产单位：`profileCopy` 仍复制 Profile 全部 28 字段（roles 提示词遍历 `WEBSITE_PROFILE_FIELD_NAMES`，`kb-synthesis-input.ts:40`），冻结上下文只留 3 条 provenance 路径；13 字段子集与路径已在 `kb-profile-subset.ts` 定义但未接线。
2. 页面形态：没有「静止态」。冻结版本没有折叠摘要卡；失败时用户看不到自己上一版知识包（因为从未有过）。
3. 抓取零共享：GEO 的两个页面读取器都不传 `cacheProbe`（`kb-enrichment-deps.ts:43, 110`），`public_tool_crawl_cache` 一次都没用过；和 Profile 扫描、seo-audit、internal-link-audit 共用每目标 4 次/小时的闸门（`crawl-gate.ts`，`CRAWL_TARGET_MAX = 4`）；`marketing_geo_knowledge_bases` 与 `marketing_websites` 无外键。

## 2. GEO 知识库应遵循的规则

这是设计的依据。每条规则后面是「本设计如何落实」。

| # | 规则（AI 引擎提及并引用一个实体需要什么） | 本设计如何落实 |
|---|---|---|
| R1 | 实体先于内容：唯一官方名、别名、25 / 55 / 120 词三档定义、品类、消歧、官方链接、sameAs。sameAs 只能指向明确描述同一实体的页面（有名称与域名互指），同名品牌页、转载页不算 | 模块「实体定义」；别名自动分词变体；sameAs 候选来自站外采集，逐条带「互指核对」结果，核对不上只列为「疑似」，不进 sameAs |
| R2 | 事实必须原子、可核、带日期、带来源 URL；数字只能来自证据原文。引用存在 + 数字字面量匹配只证明「引用与字面量对得上」，不证明整句成立 | 模块「可靠事实」；现有两项校验保留，但 UI 与导出把它们叫「引用核对通过」，不叫「已核实」；「已核实」只给 Owner 逐条确认过的条目 |
| R3 | 每个问题一个直接回答 + 展开；问题按意图分层（定义 / 操作 / 价格 / 对比 / 替代 / 信任 / 边界 / 适用） | 模块「问答知识」；意图枚举已存在 |
| R4 | 对比必须点名、双侧有证、中立、带核对日期；缺证据标不可得，不填 0 | 模块「对比知识」；双侧引用校验已存在 |
| R5 | 边界与误解要显式写出（做什么 / 不做什么 / 仍需人工 / 常见误解） | 模块「能力边界」 |
| R6 | 可信度来自独立来源：第三方档案、媒体、评价、更新频率；Owner 自填的第三方档案、转载报道不算独立证明 | 模块「证据与可信度」真实采集站外来源（今天硬编码为空）；每条标「独立 / 自填 / 转载 / 未判定」；采集第 2 层 |
| R7 | 机器可读与引用资格：可索引（无 noindex）、摘要许可（无 nosnippet / max-snippet:0）、CDN 与源站实际可达、SSR 正文、canonical、sitemap、hreflang、结构化数据与可见正文一致；robots 对 AI 爬虫要分「搜索用途」与「训练用途」（OAI-SearchBot / ChatGPT-User 与 GPTBot 相互独立；Google-Extended 只影响训练，不影响 AI Overviews）。llms.txt 与专用 schema 是可选产物，不是资格条件 | 模块「机器可读状态」按上述项逐条只报观察，缺 llms.txt 只标「未检测到」，不扣「可见性」；输出层草案（第 7 节，后续切片） |
| R8 | 新鲜度与版本：每条知识有观察时间与复核时间；知识库有版本；改动可追溯 | 发布版本 `kb@vN`；`nextReviewAt` 到期提示；不自动重跑 |
| R9 | 覆盖：每个意图是否有一个页面承接；缺口交给内容工具 | 模块「覆盖与缺口」；缺口交接 Content Brief 放后续切片，先核实消费口径 |
| R10 | 人机分工：模型只能归纳与表述，不能授予自己「已核实」；Owner 的修正是最高来源，但修正后的数字不能再由旧网页背书 | 每条独立保存「来源性质」与「采用决定」两个属性（第 3 节 L4）；修正后来源变「Owner 声明」，原引用降为「修正前依据」 |
| R11 | 原创证据与作者资历：一手数据、亲历证据、作者与审阅者身份及专长是引擎判断可靠性的信号 | 采集自家站页面时观察 `author` / `reviewedBy` / `Person` 结构化数据与署名块，进「证据与可信度」的「第一方证明」组；不做评分 |

## 3. 获得逻辑：知识从哪里来

四层来源，每一层的来源标签都不能冒充上一层。每条知识同时带两个属性：**来源性质**（origin）与**采用决定**（decision），两者独立保存、独立展示、独立导出。

```
来源性质 origin
  observed_own          自家站页面观察（URL + 观察时间 + bodyHash）
  observed_competitor   竞品页面观察
  observed_third_party  站外页面观察（附独立性判定：independent / self_submitted / syndicated / undetermined）
  observed_gsc          Search Console 查询观察（property + 日期窗口）
  declared_profile      已确认 Profile 的 13 个字段（profile@vN）
  declared_owner        Owner 手工修正 / 新增
  synthesized           模型归纳（每条 ≥ 1 条 evidenceRef，数字逐字出现在被引证据里）

采用决定 decision
  pending               生成后默认
  accepted              Owner 逐条确认 → UI 才显示「已确认」
  accepted_in_bulk      批量接受（模块的「全部接受」按钮与发布时的兜底都写这个值）→ UI / Brief / 导出显示
                        「批量接受 · 未逐条确认」；synthesized 条目再加「模型归纳」。没有任何批量操作能写出 accepted
  excluded              不进发布版本、不进导出；key 进 suppressions，下次更新同 key（或相似度 ≥ 0.9）再出现仍被排除
```

```
L0 声明   已确认 Profile 的 13 个字段（kb-profile-subset.ts）+ Owner 手工修正
L1 观察   自家站（首页 + about/pricing/product/integrations/docs/faq/changelog ≤ 8 页
          + FAQPage JSON-LD + 署名/author 结构化数据 + robots/sitemap/llms.txt/hreflang/noindex/nosnippet）
          竞品（≤ 5 家 × 首页 + 定价或产品页）
          Search Console 近 90 天 query（`kb-source-handler.ts:36-61`，lengthDays 90）
L2 站外   SERP 品牌查询（DataForSEO，复用 `serp-landscape.ts` 客户端）：`"品牌名"`、`品牌名 reviews`、`品牌名 alternatives`
          → 按域名归类：第三方档案（Wikipedia / Wikidata / Crunchbase / G2 / Capterra / Product Hunt / LinkedIn / GitHub / 应用商店）、媒体、评价
          → 读取落地页（≤ 8 页，走同一 SSRF 安全抓取边界，单页 8 s，总预算 30 s；SERP 摘要不足以做下面两项判定）
          → 每条做实体互指核对（页面正文写明品牌名且链接回官方域名 = 通过；只有其一 = 疑似；都没有 = 不通过）
             与独立性判定（要有正面依据才算独立：页面有与品牌不同的作者署名或出版方身份，且无「由品牌方提交 /
             claimed by owner / 官方账号 / sponsored / 广告」类标记，且正文与自家站任一页句子重合 < 60%；
             有自填标记 = 自填；重合 ≥ 60% = 转载；抓不到、或抓到但凑不齐正面依据 = 未判定。「没发现反证」不等于独立）
          → 一手证据观察（R11）：只记录自家站页面上「有没有」这些东西，不判断真伪：author / reviewedBy / datePublished
             结构化数据、署名块、含数据表或图表且有 methodology / data / survey 类标题的页面（记为 first_party_data_candidate）
L3 归纳   模型一次调用产出定义 / 问答 / 对比 / 边界 / 原子事实；引用不存在的来源直接拒收
L4 审阅   Owner 逐条 accepted / 修正（→ declared_owner）/ excluded；「全部接受」与发布兜底都是 accepted_in_bulk
```

抓取复用（09-02 报告第五节的三条，按收益排序）：

1. 自家站页面进网站证据观察库（第 6 节）。抓取前判据是**新鲜度**：同 `(kind, url)` 最近一次观察在 TTL 内（自家站 24 h、竞品 24 h、站外 24 h；Profile 扫描今天是 1 h，S2 统一）就复用，不看 bodyHash；TTL 外重抓，即使 bodyHash 相同也写一条新观察（新的 observed_at）。
2. 竞品身份（brandName / aliases）按域名进 `public_tool_crawl_cache` 的 `geo-competitor-identity` 命名空间，TTL 24 h，跨用户共享。
3. 站外 SERP 结果进同一命名空间体系，TTL 24 h。

闸门：每目标 4 次/小时不变；一次「更新知识库」对自家站只开一次闸（今天已如此）。

## 4. 目标形态

### 4.1 卡片骨架（与 Profile 同形）

```
GEO 知识库                                              ⌄
品牌匹配、事实、问答、证据与发布版本
┌────────────────────────────────────────────────────────┐
│ astrologywiki.com                                       │
│ 已发布 kb@v3 · 2026-09-04 · 产品档案已有新版本，可更新   │  ← 常驻 aria-live 状态行
│ [更新知识库]  [发布 kb@v4]                              │  ← 计费 / 免费两个动作
│ 一次更新会抓取你的网站与站外来源、读取 Search Console， │
│ 并发起两到三次模型调用（计费）。更新后的草稿需要你发布。 │
└────────────────────────────────────────────────────────┘
A 身份          ┃ 实体定义 · 能力边界
B 事实与回答    ┃ 可靠事实 · 问答知识 · 对比知识
C 可信度        ┃ 证据与可信度
D 可达性        ┃ 机器可读状态 · 覆盖与缺口
E 测量（默认折叠）┃ 提问集 · 23 条 · 用于 AI 可见性体检 →
┌ 发布 ──────────────────────────────────────────────────┐
│ 与 kb@v3 相比有 6 项变化 · 4 条待确认将以「未逐条确认」发布 │
│ [发布 kb@v4]                                            │
└────────────────────────────────────────────────────────┘
```

发布后整卡折叠成摘要（镜像 Profile 的「已确认 v3」卡）：

```
✓ 已发布 kb@v4                                  [查看] [编辑]
AstrologyWiki · astrologywiki.com
事实 18（已确认 6）· 问答 12 · 对比 4/6 · 站外来源 5 · 2026-09-07
```

### 4.2 状态模型

知识库级：

```
none ──更新──▶ collecting ──▶ assembling ──▶ synthesizing ──▶ draft(可审阅)
                                                                   │ 发布（免费）
                                                                   ▼
                              published kb@vN ◀──────────────────────
                                   │ 档案改了 / 站点内容变了 / nextReviewAt 到期
                                   ▼
                              published + 可更新 ──更新──▶ draft v(N+1)（已发布版本不受影响）
```

模块级（8 个知识模块各自独立）：沿用知识包契约既有的 `available` / `partial(limitation)` / `unavailable(reason)` 三态，不新增状态；模型步失败用既有 reason `generation_unavailable`，结果未知用 `outcome_unknown`（`kb-knowledge-pack.ts:13`）。模型失败时：定义 / 问答 / 对比 / 边界四个模块 `unavailable`；「可靠事实」标 `partial`，限制说明写明「仅含档案声明与 FAQ 观察，模型归纳事实缺失」（装配器本来就合并 `narrative.facts` 与已接受事实，`kb-knowledge-pack.ts:74-80`）。确定性模块（实体链接、机器可读、覆盖骨架、FAQ 事实、档案声明事实）在采集完成后立即可见，不等模型。

条目级：decision `pending` → `accepted` / `accepted_in_bulk` / `excluded`；修正另改 origin → `declared_owner`。

### 4.3 条目行的样子

```
[功能] 免费本命星盘计算器，无需注册即可生成                      ┌ 待确认 ┐
       网站 · /en/birth-chart-calculator · 2026-09-04 · 复核 2026-12-03    [接受] [修正] [排除]

[价格] Pro 档每月 9 美元                                          ┌ Owner 声明 ┐
       已修正 2026-09-07 · 修正前依据：网站 · /en/pricing · 2026-09-04     [改回]

[功能] 支持合盘与组合盘                                           ┌ 批量接受 · 未逐条确认 ┐
       模型归纳 · 2 条依据 · 引用核对通过
```

- 来源芯片只用客户能理解的词：网站 / 竞品页 / 站外 · 域名（独立 / 自填 / 转载）/ 产品档案 v3 / Search Console / 模型归纳 · n 条依据 / Owner 声明。
- 内部 ID、哈希、receipt、generationId 一律不进 DOM（延续 09-04 剪枝契约）。
- 「修正」打开单行编辑，保存后 origin 变 `declared_owner`，原 sourceRefs 移入 `priorSourceRefs`（只展示为「修正前依据」，不作为支持证据）；修正后的数字事实在导出里标「声明」。
- 「排除」条目留在草稿、不进发布版本、不进导出；其 itemKey 进 `suppressions`。

### 4.4 动作语义

| 动作 | 计费 | 做什么 | 前置 |
|---|---|---|---|
| 更新知识库 | 是（抓取 + 站外 SERP + 2 到 3 次模型调用） | 采集 → 装配 → 归纳 → 提问集 → 写入草稿；已发布版本不动 | Profile 已确认 |
| 发布 kb@vN | 否 | 先把剩余 pending 置 `accepted_in_bulk` **写回草稿**（产生新草稿版本，发布后草稿与已发布版本一致），再由**新的发布 RPC**按该草稿版本装配候选 v3（无模型调用）并冻结。不复用 `marketing_geo_freeze_prepared_kb`（它把候选的 `questionSet` 原样写进 `question_set`，`20260905155607:416`，还对候选整体跑 `generation_input_current`，`:413`）。幂等：`marketing_geo_kb_snapshots` 有 `unique(kb_id, content_hash)`（`0006:71`），同内容二次发布返回既有版本并标 `reused_existing`，不铸新候选 | 草稿的 `generationInputHash` 与**实际被复用的**每条生成记录一致（下文）；知识归纳与提问集**至少一个**成功 |
| 接受 / 修正 / 排除 | 否 | 改草稿条目决定或 origin；900 ms 自动保存 | 草稿存在 |
| 全部接受 | 否 | 当前模块 pending 全部置 `accepted_in_bulk`（不是 `accepted`：换个按钮不能让同一批模型输出拿到更强的标签） | — |

**发布时提问集缺失的规则**（回答「知识包成功、提问集失败」能否发布）：能。候选 v3 的 `questionSet` 是 `available | unavailable(reason, failedGenerationId?)`，reason ∈ roles_missing / generation_unavailable / outcome_unknown / unsupported_language / not_attempted。合法表示：快照 `question_set` 列为 `null`，候选记录 `questionSet: {status: "unavailable", reason}`，context v3 里 `questionSetHash` 取规范文本 `null` 的 sha256（作为文档化哨兵值），装配器 v2 在 `unavailable` 时跳过所有与提问集相关的核对（今天的装配入口强制解析完整 questionSet 并核对 `context.questionSetHash`，`kb-knowledge-pack.ts:51`，所以必须是新装配器）。发布校验只针对**实际被复用**的生成记录：`available` 时校验 questions 记录，`unavailable` 时不要求存在 questions 记录，只把 reason（与失败记录 id，若有）写进候选。`unavailable` 的版本在 AI 可见性体检与 GEO Brief 的版本选择器里显示「此版本无提问集」且不可选，上一个带提问集的版本仍可选（Visibility 本来就按冻结版本列出）。D8 的非英语站点走同一出口：知识包可发布，提问集 `unavailable(unsupported_language)`。

**审阅期间的身份契约**（回答「审阅改了草稿，旧生成物还能不能复用」）：草稿分两个哈希域，且**只复用生成物，不复用 context**。
- `generationInput`：identity（targetUrl / officialName / aliases / categoryTerms / market）+ profileRef + competitors + roles + 证据目录哈希。它在 run 内**只锁定一次**：角色步（模型 1）结束后（成功用提案，失败用种子角色）锁定，之后的知识归纳与提问集两个模型步读的是同一份，各自的生成记录 `input` 里都存 `generationInputHash`。锁定时 roles 的 review 一律置 `accepted`（沿用 v2 枚举；context 要求只有 accepted 角色才能进 `eligibleLayers`，`snapshot-context-v2-shape.ts:52`）——角色不在 D3 的可审阅范围内，也不受 D12 约束，它们是提问集的内部输入，不对客户展示。审阅期间这些字段只读，**两处拦**：草稿保存 RPC 的 v3 分支拒绝 `hash(generationInput) !== runRef.generationInputHash` 的保存（除非是 run 本身在写），发布时再校验一次 fail-closed；要改它们必须再「更新」（计费）。
- `review`：每条的 decision / override / suppressions。随便改，不影响生成物身份。
- 发布时校验 `hash(generationInput) === runRef.generationInputHash`，并对**实际被复用**的每条生成记录（knowledge 必有；questions 仅在 `available` 时）校验 `input.generationInputHash` 等于同一值，一致才允许复用它们的结果；不一致（例如 Profile 又确认了新版本）显示「依据已变化，请先更新」。
- context **不复用**，发布时由服务端从候选确定性构建，且**升版为 `marketing-geo-snapshot-context.v3`**：v2 context 要求正事实 `review = accepted`、`sourceUrl` 与 `observedAt` 非空、`crawl` 事实引用精确 receipt、最多 24 条、value ≤ 200 字符，并要求 `profile` / `sourceReceiptRefs` / `evidenceCatalog` / `sourceSummary` / 角色血统 / `skippedLayers`（`snapshot-context-v2-shape.ts:26-57`）；Owner 声明事实没有 URL、批量接受的模型事实没有 receipt，v2 装不下，硬凑投影就是在撒谎。context v3 刻意做薄：`payloadHash = digest(payload v3)`、`questionSetHash` 按上一段规则、`profileRef`、`evidenceRefs`（观察 id + 哈希；S1 阶段为 receipt refs）、`roles` 与血统（来自 generationInput）、`sourceSummary`（各来源计数）、`skippedLayers`；**不再携带事实**，事实只有一份，在知识包 v2 里（每条带 origin / decision / sourceRefs），Brief 直接读知识包。今天装配边界要求 `context.payloadHash === digest(payload)`（`kb-knowledge-pack.ts:53`），而 review 就在 payload 里，所以 run 时的 context 在审阅后必然失配，只能重建。候选 v3 记录 `generationInputHash` 与 `reviewHash`，快照内容哈希覆盖两者。

**修正跨更新的合并规则**（回答「按条目 key 保留修正」怎么不串条）：
- 知识归纳提示词 v2 让模型把事实输出成 `{subject, attribute, qualifiers[], value}`（qualifiers 是限定维度：套餐 / 市场 / 计价周期 / 平台 / 版本，没有就空数组）、把问答输出成 `{intent, canonicalQuestion, variants[]}`，不再只是一句陈述。
- `itemKey` 与证据无关，只由内容决定：facts = `sha(module, type, 规范化 subject, 规范化 attribute, 排序后的规范化 qualifiers)`；qa = `sha(module, intent, 规范化 canonicalQuestion)`；comparisons = `sha(module, competitorKey, dimension)`；scope = `sha(module, kind, 规范化陈述)`；entity 字段按字段名。规范化 = NFKC + 小写 + 去标点 + 折叠空白 + 去冠词与语气词。今天事实 ID 含 source ID（`kb-knowledge-pack.ts:77`），换证据就换身份，v3 不再这样。
- 同 key 不同 value：只有当新观察与旧观察来自**同一来源页面**（sourceRefs 的 URL 相同）时才算同一事实的新观察（走下面「内容变了」分支）；来自不同页面则作为**并存的新条目**进入 pending，并标「与现有事实可能冲突」由 Owner 处置。一个套餐的修正或排除永远不作用于另一个套餐（qualifiers 不同即不同 key）。
- 措辞漂移：key 精确不匹配时，在同 module + 同 type / intent 内做规范化文本的 token Jaccard 相似度，**只用于生成提示，永不自动继承决定**：≥ 0.75 出「可能是同一条（原决定：已排除 / 已修正）」提示，由 Owner 一键继承或忽略；< 0.75 视为新条目。suppressions 只按精确 key 自动生效；相似度命中的排除记录只提示（两条 scope 陈述只换一个词就能相似度 0.9，自动继承排除会让另一平台的陈述直接消失）。
- 每个决定记录 `{itemKey, decision, override?, baseContentHash, decidedAt, baseDraftVersion}`。
- run 的合并步：同 key 且新内容哈希 = baseContentHash → 决定原样保留；同 key 同来源页内容变了 → 保留决定，附 `newObservation{content, observedAt}`，UI 标「有新观察」，Owner 可一键采用新观察；key 消失 → `declared_owner` 的修正条目保留（它本来就不依赖观察），`excluded` 记录保留在 suppressions；新出现的 key → pending（带相似度提示，若有）。
- 旧观察、Owner 修正、新观察三者各自带时间，都进候选，导出时只出 Owner 当前采用的那份。

## 5. 生成管线（解耦）

```
POST /api/tools/geo-knowledge-base/v3/run        maxDuration 300，单次调用执行预算 250 s
  step 1 collect     无模型  自家站 ≤ 8 页 + 机器资源 + 竞品 ≤ 5×2 + GSC + 站外 SERP 3 次
                             + 站外落地页 ≤ 8 页                                              → 证据集（先读观察库）
  step 2 assemble    无模型  写草稿：竞品身份、种子角色、FAQ 事实、档案声明事实、实体链接、
                             机器可读、覆盖骨架、站外互指与独立性判定                          → 草稿立即可见
  step 3 roles       模型 1  角色提案（现有提示词；失败 → 保留 step 2 的种子角色；种子也为空 → roles: []）
                             ── 此处锁定 generationInput 并写 generationInputHash ──
  step 4 knowledge   模型 2  定义 / 问答 / 对比 / 边界 / 原子事实（narrative 提示词 v2：三元组事实 + canonicalQuestion）
                             输入 = generationInput 投影 + 证据目录                             → 失败见 4.2
  step 5 questions   模型 3  提问集（现有提示词；roles 为空或失败 → questionSet unavailable(roles_missing)）
  step 6 merge       无模型  按 4.4 合并规则合并 Owner 既有决定 → 写草稿 v(N+1)，写 runRef
```

- 角色步放在知识归纳之前，是为了让 `generationInput` 在所有需要绑定它的模型步之前只锁定一次：今天采用 roles 时会改写 competitors / facts 再保存（`use-geo-kb-v2-editor.ts:706`），knowledge 若先跑就会被这次保存打掉身份。知识归纳与提问集两步读同一份锁定输入，各自的生成记录都存同一个 `generationInputHash`，发布时逐条校验。
- roles 为空不再阻断：v3 里提问集是可选产物，`role_missing` 只作用于提问集（`questionSet: unavailable(roles_missing)`），不作用于发布。
- **付费操作级幂等**：run 内每个会计费或会扣闸门的操作（每条 SERP 查询、每次页面抓取、每个模型步）各自有一条 `marketing_geo_kb_run_operations` 记录（operation_key、state、result_ref、started_at）。恢复时逐条读：`dispatched` / `outcome_unknown` 先读结果不重发；`succeeded` 直接复用；只有 `not_started` / 可重试失败才发起。run 有单一执行者租约（lease_token + 到期），并发第二次调用只能轮询。
- 一次路由调用预算将尽时返回 `{status: "in_progress", nextOperation}`；标签页开着时客户端用同一 `runId` 自动再调；标签页关闭后再打开，页面显示「继续更新」按钮，由人点击恢复。
- 每个模型步仍是一条 `marketing_geo_kb_generations` 记录（现有 durable 账本全部保留），run_operations 只存指针。
- step 6 写草稿与 Owner 的 900 ms 自动保存共用 CAS（`p_base_version`）：run 处于 running 时客户端自动保存暂停（今天的 `autosaveHold: "running"` 已有此语义），step 6 读最新草稿版本后合并再保存，遇 409 重读重合并最多 3 次，仍失败则 run 停在 step 6 并提示「继续更新」。
- Workflow DevKit 作为备选（D9）。

## 6. 数据模型

| 层 | 表 | 变化 |
|---|---|---|
| 网站注册 | `marketing_websites` | 不变 |
| 网站证据观察库（新） | `marketing_website_evidence_observations` | 不可变观察记录：`website_id`(FK) / `kind`(own_page, competitor_page, robots, sitemap, llms, gsc, third_party) / `url` / `observed_at` / `status`(ok, unavailable + reason) / `body_hash` / `excerpts` / `structured`（JSON-LD 类型、FAQ 对、hreflang、robots 规则、noindex / nosnippet、署名）/ `independence`(仅 third_party)。唯一 `(website_id, kind, url, observed_at)`；GSC 的 url 位置存 `property + 窗口起止`。新鲜度判据（第 3 节）只读最近一条；快照上下文引用观察 id，旧版本的证据时间永远不被刷新改写。Profile 扫描与 GEO 采集都写这里；owner-scoped RLS，写走 RPC |
| 知识库注册 | `marketing_geo_knowledge_bases` | 加 `website_id` 复合 FK（D10）；`canonical_site_key` 保留兼容 |
| 草稿 | `marketing_geo_kb_drafts.payload` | 新 schema `marketing-geo-kb.v3` = `generationInput`{identity, profileRef（引用 + 13 字段子集，D5）, competitors, roles, evidenceContentHash} + `knowledge`{8 模块，每条 {itemKey, value, origin, sourceRefs, priorSourceRefs?, evidenceChecks}} + `review`{decisions[], suppressions[]} + `runRef`{runId?（S1 阶段为 null，S4 起必填）, generationInputHash, knowledgeGenerationId?, rolesGenerationId?, questionsGenerationId?}。上限按分项预算：`knowledge` ≤ 512 KiB（与今天知识包封顶一致，`20260905155607:292`）、`review` ≤ 128 KiB、其余 ≤ 256 KiB，总计 ≤ 1 MiB；check 约束是 forward-only，S1 定值前先用真实站点草稿实测 |
| 候选 | `marketing_geo_kb_prepared_candidates` | **保留这套机制，但身份要改**。今天 `id = questions 生成 id`、`generation_id NOT NULL UNIQUE`（`20260831122810:41`），由 finish RPC 在 questions 完成时插入。v3 由「发布」动作插入，同一 run 可发布多次（修正后再发布），所以候选 v3 的 `id` 独立铸造（新 uuid），`generation_id` 改为可空且去掉唯一约束（v3 用 `run_ref` JSON 记录三个生成 id），快照的 `prepared_id` 唯一约束按内容幂等保留。`marketing-geo-prepared-candidate.v3` = payload v3 + `questionSet`（沿用 v2 契约，或 `unavailable(reason)`）+ `context`（**新版 `marketing-geo-snapshot-context.v3`**，发布时构建，薄：哈希 + profileRef + evidenceRefs + roles 血统 + sourceSummary + skippedLayers，不含事实；`marketing_geo_snapshot_contexts.context` 的尺寸约束按版本分档，v3 ≤ 256 KiB）+ `knowledgePack`（**新版 `marketing-geo-knowledge-pack.v2`**：在 v1 上给每条加 `origin` / `decision` / `priorSourceRefs` / `ownerDeclaredAt`，excluded 条目不进包；`declared_owner` 条目跳过数字字面量核对，改标 `evidenceChecks: owner_declared`；v1 契约每条都是 `.strict()`，多一个字段即解析失败，所以必须是新版本；v1 渲染器保留给历史版本）+ `generationInputHash` + `reviewHash`。由「发布」在服务端确定性生成，不调模型；上限与 v2 相同 2.25 MiB（问题集本身封顶 256 KiB） |
| 版本 | `marketing_geo_kb_snapshots` | v3 快照 = payload v3 + `question_set`（v2 契约或 null）+ `context`（v3 契约）+ `prepared_id` → 候选 v3。`question_set` 契约不升版；context 升 v3；Brief / Visibility 的读取路径要接受 payload v3、context v3 与「无提问集」，事实改从候选的知识包 v2 读；v1 / v2 快照原样可读，不回填 |
| 运行（新，S4） | `marketing_geo_kb_runs` + `marketing_geo_kb_run_operations` | runs：`run_id` / `kb_id` / `user_id` / `idempotency_key` / `lease_token` / `lease_expires_at` / `state` / `generation_input_hash`。operations：`run_id` / `operation_key`（如 `serp:"brand"`、`fetch:own:<url>`、`model:knowledge`）/ `state` / `result_ref` / `started_at` / `finished_at` / `reason`。S1 阶段没有 runs 表，「更新」仍由客户端按今天的三连调（sources → roles → knowledge → questions）产出 v3 草稿，`runRef.runId` 为 null |
| 生成账本 | `marketing_geo_kb_generations` | **表结构不变，但八处入口必须改**，否则 v3 草稿一条生成都发不出：(a) `marketing_geo_generation_input_current` 要求 `profileCopyHash = hash(payload->'profileCopy')` 且 `validate_profile_copy` 通过（`20260831122810:138-151`），v3 没有 `profileCopy` → 永远 `input_stale`；S1 要给它加 v3 分支，改校验 `profileRef`（websiteId / snapshotId / revision / hash 对得上当前确认快照）。(b) `kind='questions'` 的 result 被 check 约束钉为 prepared-candidate v1/v2，finish RPC 的 questions 分支会立即插入候选并要求 payload v2（`20260905155607:19-23, 172-194, 226`）；v3 需要一个「只含提问集」的 result schema（`marketing-geo-question-generation-result.v1`）与不插候选的 finish 分支。(c) 草稿保存 RPC 拒绝把带 `profileCopy` 的草稿保存成没有 `profileCopy`（`20260831100603:146-148`），astrologywiki 现有 v2 草稿升不到 v3；S1 要允许 v2 → v3 升级路径。(d) claim `knowledge_pack` 时的 `marketing_geo_knowledge_input_valid` 钉「恰好 7 键」+ `profileCopyHash` 正则 + input schema v1（`20260905155607:39-40, 47-48, 364`），v3 输入多 `generationInputHash`、少 `profileCopyHash` → 永远 `conflict`。(e) roles 的 finish 分支比较 `p_result->>'profileCopyHash' = input->>'profileCopyHash'`（`:166`），两边都 null 时布尔为 null → `invalid_result`，roles 在 v3 也发不出。(f) narrative 提示词 v2 换了 narrative 契约（v1 的 fact 是 `statement`，`kb-knowledge-synthesis-contract.ts:101`），`marketing_geo_knowledge_result_valid` 钉 narrative v1 / 6 键 / result v1（`:95, 103, 109`），result 的 check 约束也钉 v1（`:23`），都要 v2 分支。(g) TS 侧角色血统用 `profileCopyHash` 做身份比对（`kb-role-proposal.ts:16, 31, 70`；`resolveGeoModelRoleLineage`，`kb-generation-preparer.ts:374-375`），v3 换成 `generationInputHash`。(h) `marketing_geo_snapshot_v2_requires_prepared`（`20260831122810:55-58`）是 `(schema_version='v2') = (prepared_id is not null)`，会直接拒绝带 `prepared_id` 的 v3 快照，要扩到 v3。D6（合并 roles 与 questions）本轮不做 |
| 消费者读取 | `kb-complete-read.ts` / `brief-facts.ts` / `brief-load-projection.ts` / `visibility-workflow-steps.ts` / `kb-versioned-read.ts` | 今天钉死 v1 / v2 配对（`kb-complete-read.ts:52-63`），`brief-facts.ts:16` 遇非 v2 context 直接抛 `complete_v2_context_required`，`kb-versioned-read.ts:73` 对 null 提问集取 `.questions.length` 会抛。S1 必须同时让它们接受 payload v3 + context v3 + 可能为空的 question_set，Brief 的事实表在 v3 下从候选的知识包 v2 读（不再读 `context.facts`），否则 v3 站点的 Brief 静默断掉 |

不变量（沿用，不得拆）：CAS 保存；双向哈希；内容幂等冻结；`context_stale` fail-closed；`outcome_unknown` 不自动重试；payload 禁止 number 类型；客户端不得 import 服务端 barrel。新增不变量：`generationInput` 在审阅期间只读；origin 与 decision 永不合并成一个字段；`priorSourceRefs` 不参与任何「有证据」判定。

## 7. 输出层（D4，后续切片，本轮不做）

从已发布版本派生、明确标为「草案 · 未上线」的三样东西，各带复制按钮：

1. `llms.txt` 草案：实体定义 + 官方链接 + 可靠事实摘要 + 问答索引。
2. JSON-LD 草案：`Organization`（name / alternateName / url / sameAs / description）。`FAQPage` 只在「覆盖与缺口」里已有一个承接页面且该页面可见正文含这些问答时才给，否则给的是「FAQ 页面内容草案」而不是 schema（结构化数据必须与可见正文一致）。`SoftwareApplication` / `Product` 需要一条从 `categoryTerms` 出发的判据，判据定了再加。
3. 事实表 Markdown：只含 accepted 与 declared_owner 条目，逐条带 origin。

「机器可读状态」模块继续只报观察结果；草案区永远不声称文件已存在。

## 8. 与其他工具的衔接

| 消费者 | 读什么 | 变化 |
|---|---|---|
| AI 可见性体检 | 已发布版本的提问集、`payload.competitors`、`context.profile.coreFeatures` | S1 内完成：接受 payload v3 与 context v3（coreFeatures 改从 `profileRef` 子集读）；无提问集的版本在选择器里标「此版本无提问集」不可选 |
| 页面可引用性检查 | 不读知识库 | 不变 |
| GEO Brief / Content Brief | `context.facts`、`payload.roles`、提问集 | S1 内完成：接受 payload v3 与 context v3；事实改读候选 v3 的 `knowledgePack.facts`，逐条带 origin 与 decision，`accepted_in_bulk` 的 synthesized 条目在 Brief 里标「批量接受 · 未逐条确认」，`declared_owner` 条目标「声明」；无提问集的版本不可选 |
| 完整读取 | `kb-complete-read.ts` | S1 内完成：接受 v3 快照与候选 v3 配对 |
| Content Draft Writer | Brief | 不变 |
| 覆盖与缺口 → Content Brief | 缺口条目 | 后续切片；上线前先按消费口径核实 |

## 9. 方案对比

| | A 知识库为主体，模块独立（推荐） | B 最小改动接上知识包 | C 可编辑文档式知识库 |
|---|---|---|---|
| 做什么 | 第 3–6 节；分 5 个必做切片（S0 / S1a / S1b / S2 / S4）+ 1 个后续（S3） | 修 roles 失败；失败兜底；渲染已有知识包 | Owner 逐字段撰写，模型只做建议；无发布版本概念 |
| 优点 | 形态完整；Owner 有修正权且修正不冒充观察；抓取共享省闸门 | 1–2 天；用户立刻看到 8 模块 | 最高控制力 |
| 代价 | 必做切片约 16–23 人日（粗估） | 仍无审阅、无站外证据、生成即冻结、抓取仍重复 | 偏离「抓取 / 获得」逻辑；重；与冻结 / 测量链脱节 |
| 判断 | 采用；B 即 A 的切片 S0 | 作为 S0 先做 | 否决 |

## 10. 落地切片

| 切片 | 内容 | 动什么 | 粗估 |
|---|---|---|---|
| S0 止血 | roles `invalid_output` 根因；**不调顺序**（knowledge 生成被库端与 TS 两侧钉在精确的草稿版本 / 哈希上，`20260905155607:333-340`，采纳 roles 会改草稿并保存，先跑 knowledge 就会 `input_stale`）；**roles 失败仍然停止**，但状态行要说清「角色生成未完成，知识库未更新」而不是笼统的「更新未完成」（`kb-import.ts:65` 的档案映射在 label 为空或超长时返回空数组、返回对象没有 `source.kind`、也给不出英文 `questionLabel`，一键流程在无提案时直接返回 `use-geo-kb-v2-editor.ts:700`，所以 S0 没有现成的种子角色兜底可用；角色可选要等 S1 的 v3 契约）；knowledge 失败 → 退回候选 v1 冻结（无知识包，提问集照常）；证据模块空组显式标「未采集」；根因修复后让现有站点跑出第一份知识包。**「部分成功可发布」不在 S0**：候选 v2 的库端校验要求引用一条 `succeeded` 的 knowledge_pack 生成（`20260905155607:180-188, 286-338`），要等 S1 的候选 v3 | `use-geo-kb-v2-editor.ts`、`kb-generation-preparer.ts`、`geo-knowledge-pack.tsx`；不动表 | 1–2 天 |
| S1a 契约与迁移 | payload v3（generationInput 含 targetUrl / knowledge / review / runRef，S1 阶段 runId 为 null，`generationInputHash` 由客户端串行调用在角色步之后锁定并由服务端写进每条生成记录的 input）、候选 v3、context v3（薄，不含事实）、知识包 v2 + 装配器 v2（提问集可缺、`declared_owner` 跳过数字核对）、narrative 契约与提示词 v2（带 qualifiers 的事实 + canonicalQuestion）、角色提案身份改用 `generationInputHash`、v3 快照、发布 RPC（含幂等与写回草稿）；**消费者兼容**（`kb-complete-read` / `brief-facts` / `brief-load-projection` / `visibility-workflow-steps` / `kb-versioned-read` 接受 payload v3 + context v3 + 无提问集，Brief 事实改读知识包）；部分成功可发布；角色可选；itemKey 定义。验收：fixture + 无头发布 + Visibility → Brief 链路 | `kb-v3-contract.ts`、`snapshot-context-v3-shape.ts`、`kb-knowledge-pack-contract.ts` v2、`kb-knowledge-pack.ts` v2、`kb-knowledge-synthesis-contract.ts` v2、`kb-knowledge-synthesis-prompts.ts` v2、`kb-role-proposal.ts`、`kb-generation-preparer.ts`、一条迁移，内容必须包含：schema 放开（drafts / snapshots / candidates / contexts 接受 v3；snapshots.question_set 可空；`snapshot_v2_requires_prepared` 扩到 v3；contexts 尺寸按版本分档）、候选表身份改造（独立 id、`generation_id` 可空非唯一）、`generation_input_current` 的 v3 分支（校验 `profileRef`）、`knowledge_input_valid` / `knowledge_result_valid` / result check 约束的 v2 分支、roles finish 分支的 null 比较修正、questions 的「只含提问集」result schema 与不插候选的 finish 分支、草稿保存 RPC 的 v2 → v3 升级放行与 generationInput 只读检查、分项尺寸上限、发布 RPC、候选 v3 / 知识包 v2 / context v3 校验函数 | 5–7 天 |
| S1b 形态 | 四组分区 + 状态芯片；条目审阅（接受 / 修正 / 排除 / 全部接受=批量接受）；origin 与 decision 双属性展示；「更新」「发布」两动作；发布后折叠摘要卡；文案迁回 next-intl；相似度提示与合并步（首次发布不需要合并，放在片末） | 组件重写（`geo-knowledge-base-v2.tsx` 及 `geo-kb-*` 系列）、`use-geo-kb-v2-editor.ts` 改造、i18n | 4–5 天 |
| S2 采集 | 网站证据观察库；Profile 扫描写入；GEO 采集先读库（新鲜度判据）；竞品身份进公共缓存；站外 SERP 三查询 → 互指核对 + 独立性判定 → 证据模块真实填充与 sameAs 候选；署名观察；`website_id` 外键 | 新表 + RPC；`kb-knowledge-evidence.ts`、`profile-refresh-handler.ts`、`kb-enrichment-deps.ts`；SERP 客户端复用 `serp-landscape.ts` | 4–6 天 |
| S4 编排 | 单 run 路由 + runs / run_operations 表；付费操作级幂等；分段执行与自动续调；「继续更新」从断点恢复 | 新路由 + 新表；客户端改轮询 | 2–3 天 |
| S3 输出（后续） | llms.txt / JSON-LD（Organization；FAQPage 有条件）/ 事实表草案 + 复制；缺口 → Content Brief 交接 | 纯派生，无新表 | 2–3 天 |

每个切片各自出实施计划、各自评审（含跨模型评审）、各自上线。S0 可立即开工；S1a 是其余切片的契约基础，S1b、S2、S4 都依赖 S1a；S1b、S2、S4 三者互相独立可并行；S3 在必做切片之后再立项。数据库与契约按仓库规则只能一个 owner 合并，所以 S1a 内部不并行。

## 11. 待 Owner 拍板

| # | 决定 | 推荐 | 不采纳的后果 |
|---|---|---|---|
| D1 | 知识库为主体，提问集降为派生末节（默认折叠） | 是 | 页面仍是测量工具的样子 |
| D2 | 生成 → 审阅 → 发布（两动作），而不是生成即冻结（一动作） | 是，镜像 Profile 的保存 / 确认 | Owner 无修正权；模型错误直接进消费者 |
| D3 | 可审阅范围：实体 / 事实 / 问答 / 对比 / 边界可接受、修正、排除；机器可读 / 覆盖 / 证据只读 | 是 | — |
| D4 | 输出层草案（llms.txt / JSON-LD / 事实表）作为后续切片 S3，推翻 09-04 的非目标 | 是，但排在必做切片之后 | 知识库只能看不能用 |
| D5 | `profileCopy` 收缩为引用 + 13 字段子集（`kb-profile-subset.ts` 的 `GEO_PROFILE_SUBSET_FIELDS`：productName, oneLinePositioning, coreFeatures, country, locale, categories, buyer, primaryIcp, triggerPain, icpPain, qualificationSignals, icpInterests, directCompetitors） | 是 | 草稿继续背 28 字段副本；roles 提示词继续吃 28 字段 |
| D6 | 角色提案并入提问集生成（3 次模型调用 → 2 次） | **否，本轮不做**：省钱结论推不出来（抓取、SERP、更长提示词的成本不按调用数缩减），且要动角色血统校验；等真跑有实际费用与问题质量数据再定 | — |
| D7 | 站外采集：DataForSEO SERP 三查询（每次更新约 3 次调用）+ 互指核对 + 独立性判定 | 是，S2 | 证据模块永远只有第一方；sameAs 空 |
| D8 | 语言：知识包正文跟站点主语言；提问集维持现有 en 限制，非英语站点发布「无提问集」版本并明说 | 是 | 中文站产不出中文知识 |
| D9 | 编排：单 run 路由（推荐）还是 Workflow DevKit | 单 run 路由 | Workflow 引入新的部署与测试模型 |
| D10 | `marketing_geo_knowledge_bases` 加 `website_id` 外键，合并两套注册表 | 是，S2 | 继续靠字符串对齐 |
| D11 | 复核周期：`nextReviewAt` 默认 90 天，到期只提示不自动重跑 | 是 | — |
| D12 | 任何批量接受（「全部接受」按钮、发布兜底）都写 `accepted_in_bulk`，在 UI / Brief / 导出里显示「批量接受 · 未逐条确认」；只有逐条接受的才显示「已确认」 | 是 | 模型输出冒充已核实 |

## 12. 刻意不做

- 不做「AI 当前认知」模块（引擎现在怎么说）——那是 AI 可见性体检的职责，知识库只提供提问集。
- 不替客户发布任何文件到其网站；不声称草案已上线。
- 不回填、不改写 v1 / v2 历史快照。
- 不自动同步 Profile 与 GEO；档案变化只提示「可更新」。
- 不做定时重跑；不给可信度打分。

## 13. 无论是否采纳都要修的生产缺陷

1. `roles` 生成 `invalid_output`（09-07 13:45，模型有返回、解析器拒收）——根因待查，先于一切。
2. 证据模块 `press` / `thirdPartyProfiles` 硬编码空数组，UI 又省略空组 → 局部测量被渲染成完整。
3. 现有站点的冻结候选全是 v1，永远不会有知识包；需要一次成功的重生成。
4. 客户文案硬编码在 `geo-knowledge-base-v2.tsx:32-48`，绕开 next-intl；i18n 里 `editor.generateNone/generateCurrent/generateStale`（`en.json`/`zh.json:5712-5714`）已成孤儿。
5. GEO 抓取不接 `public_tool_crawl_cache`，与三个工具抢同一个每目标 4 次/小时闸门。

## 14. 验证（每个切片的最低要求）

- 契约：v3 schema 严格；v1 / v2 快照可读且逐字节不变；decision 的合法转移；origin 永不由 decision 改写；`priorSourceRefs` 不被任何「有证据」判定计入；itemKey 对证据来源不敏感（换 source 不换 key）。
- 管线：run 内每个付费操作幂等；任一模型步失败其余模块仍可见；`outcome_unknown` 不重试；标签页关闭后可恢复且不重复计费（用 operations 表逐条断言）。
- 审阅：改 review 不改 `generationInputHash`；改 generationInput 字段被拒并提示更新；`accepted_in_bulk` 条目在 KB、Brief、导出三处都带「未逐条确认」；「全部接受」按钮写出的值是 `accepted_in_bulk` 而不是 `accepted`（变异测试：把按钮改成写 `accepted` 必须有测试变红）。
- 发布：context v3 由候选构建，`payloadHash === digest(payload v3)`，且不含任何事实字段；无提问集版本的 `questionSetHash` 等于哨兵值且不要求 questions 生成记录存在；被复用的每条生成记录的 `input.generationInputHash` 等于草稿值，任一不等发布被拒；用只有 Owner 声明事实（无 URL）的 fixture 证明发布成功且 Brief 能读到它。
- 合并：同 key 同来源页内容变化保留决定并出现「有新观察」；同 key 不同来源页产生并存 pending 并标「可能冲突」；qualifiers 不同的两条价格互不影响；相似度 ≥ 0.75 只出提示，变异测试：把「提示」改成「自动继承」必须有测试变红；excluded 只按精确 key 自动生效；declared_owner 条目在观察消失后仍在。
- 站外：互指核对三态与独立性四态各有 fixture；SERP 摘要单独不能产生「通过」或「独立」；一个抓取成功但无署名、无出版方身份的页面必须落在「未判定」而不是「独立」。
- 组件：8 模块 + 提问集从 fixture 渲染；`partial` / `unavailable` 各有文案；空组显式标注；DOM 无任何内部 ID / 哈希；zh / en 各渲染一次。
- 采集：观察库 TTL 内命中不重抓、TTL 外重抓写新行；闸门每目标只扣一次；站外结果带独立性判定与互指核对结果。
- 消费者：用正向断言，不钉错误码——v3 快照 + context v3 下 `geoBriefFactsForSnapshot` 必须返回从知识包 v2 投影的 factTable（今天非 v2 payload 走的分支抛的是 `snapshot_context_version_mismatch`，`brief-facts.ts:35`，钉 `complete_v2_context_required` 会天然通过）；`kb-versioned-read` 对 null 提问集不抛；无提问集版本在 Visibility / Brief 选择器不可选；Visibility 读到的提问集与候选 v3 逐字节一致。
- 发布幂等：同内容二次发布返回既有版本（`reused_existing`），不新增候选行；发布后草稿版本与已发布版本的 review 一致。
- 生产：一次真跑（计费），用生产 HTML 逐模块对照；发布后 Visibility → Brief → Draft 链路走通。
- 本地按仓库规则只跑相关测试与 typecheck / lint；不跑 GitHub Actions。

## 15. 实现中发现的偏差（2026-09-07 落地时补记）

设计稿 v3.2 定稿后开始落地，逐条核对数据库与消费链时发现下面这些事实，设计稿此前写错或没写。它们不改变设计方向，但改变实现清单。

| # | 事实 | 依据 | 对设计的影响 |
|---|---|---|---|
| 1 | 第 4.4 节引用的发布幂等约束 `unique(kb_id, content_hash)`（`0006:71`）**已经不存在**：`20260831035712:19-22` 把它 drop 了，换成唯一索引 `marketing_geo_kb_snapshot_context_identity_idx (kb_id, content_hash, coalesce(context_hash,''))` | 迁移原文 | 发布幂等要基于这个三列索引，不是原来那条 |
| 2 | `marketing_geo_draft_v2_shape`（`20260831122810:10-13`）的形式是「schema_version ≠ v2 或 (...)」，对 v3 **空洞成立**，什么都不检查 | 迁移原文 | 「八处入口」实为九处：v3 要自己的 shape 约束（payload 里必须有 generationInput / review / runRef，且不得有 profileCopy） |
| 3 | `marketing_geo_freeze_kb`（legacy 冻结）的 `if v_draft.payload ? 'profileCopy' then outcome := 'context_required'` 闸门（`20260831100603:403`）对 v3 是**开的**：v3 草稿能走进 legacy 路径，一直到 `:453` 才因 schema_version CHECK 炸出不透明的约束违例 | 迁移原文 | 第十处入口：legacy 冻结要显式拒绝 v3 |
| 4 | `marketing_geo_kb_snapshots.question_set` 与 `question_set_hash` 都是 `not null`（`0006:66-69`） | 迁移原文 | 「无提问集版本」需要一条把两列改可空的迁移，并加「要么都空、要么都非空」约束；v1/v2 快照仍必须非空 |
| 5 | `marketing_geo_knowledge_input_valid` 的 receiptId 正则钉了版本位 `[1-5]`（`20260905155607:59`） | 迁移原文 | 这个产品的实体 id 是 UUIDv8，凡是新写的校验一律不得钉版本位。v2 分支用不钉版本的正则 |
| 6 | `marketing_geo_kb_generations.input` 的 192 KiB 上限（`20260831122810:19`）从未提升过 | 迁移原文 | `generationInput` 连同 13 字段档案子集必须留在 192 KiB 内，这是比草稿上限更紧的约束 |
| 7 | `service_role` 对 `marketing_geo_kb_generation_keys` **没有任何权限**（`20260905155607:429` 只授了另外两张表） | 迁移原文 | 幂等键只能经 RPC 访问，任何新路径不要试图直接读它 |
| 8 | `kb-history.ts:10` 的列清单缺 `prepared_id`，而 `kb-versioned-read.ts:54` 对每个 v2 快照都要求这一列 → 任何有 v2 版本的账号，版本列表整体返回 `frozen_history_unavailable` | 代码 + `kb-store.ts:192-199` 的注释早已警告过这个陷阱 | 既有真 bug，与 v3 无关。已在落地时修复：改为复用 `GEO_KB_SNAPSHOT_COLUMNS`，并补了含反面断言的回归测试 |
| 9 | 浏览器侧有一份**独立复刻**的知识包 zod schema（`geo-kb-v2-wire.ts:96-121`），不做完整性校验也不校验哈希 | 代码 | 知识包升 v2 必须同步这份复刻，否则前端会静默拒收新版本 |
| 10 | Brief 的事实表需要 `label` / `value`(可空) / `reason` / 证据 URL，而知识包 v1 的 fact 只有整句 `statement` | `brief-facts.ts` 与 `packages/public-tools/.../parse-geo-brief.ts` | 知识包 v2 的 fact 必须同时携带短值与标签，否则「Brief 事实改读知识包」这条无法实现。已在 v2 契约里加上 |
| 11 | ~~三处事实口径互不相同：冻结上下文 ≤ 24 条、能进包的已接受事实源 ≤ 8 条、知识包上限 64 条 ⇒ Brief 会从 24 收窄到 8~~ **本条已作废，见 15.4 的订正**：24 是 **v2 payload** 的事实上限（`kb-v2-contract.ts:57`，不是冻结上下文），8 是 `kb-generation-preparer.ts:141` 对 **v2 owner 录入事实复用为知识生成证据源** 的截断（`kind: "accepted_fact"`），既不在 v3 发布链上，也从不决定包里有几条事实。v3 的真实上限是 `GEO_KNOWLEDGE_LIMITS.facts = 64` | 代码 | Brief 改读知识包后是**放宽**（24 → 64），不是收窄。原来那句「需 Owner 知情的收窄」不成立，已撤回 |
| 12 | `marketing_geo_json_hash(NULL)` 返回 NULL（内部的规范化函数是 `strict`），因此「两边都没有 profileCopyHash」的比较求值为 NULL 而不是真 | `0005:141` + `20260831122810:77-80` | roles 的 finish 分支（`20260905155607:166`）用 `=` 比较两个 NULL 会让整个 `v_valid` 变 NULL 从而判 `invalid_result`；必须改成 `is not distinct from` |

第 11 条是唯一需要 Owner 拍板的：它是一次口径收窄。其余都是实现清单的补充。

### 15.1 跨模型评审（gpt-6-astra high）对四个地基契约的判决

对 `kb-item-identity.ts` / `kb-item-key.ts` / `kb-knowledge-shape.ts` / `kb-v3-contract.ts` 做了一轮对抗式评审：**0 个 P0，8 个 P1，3 个 P2**，全部当轮修完并各配回归用例。

| # | 缺陷 | 修法 | 对设计的影响 |
|---|---|---|---|
| 1 | 身份归一化把 `\p{P}\p{S}` 折成空格并删停用词，于是 `Pro` 与 `Pro+` 同 key、`requires macOS and Linux` 与 `... or Linux` 同 key。这是精确 key 的碰撞，会绕过相似度提示 | 拆成两个函数：`normalizeGeoIdentityText` 只折大小写/兼容形/控制符/空白，标点符号和每一个词都保留；`normalizeGeoSimilarityText` 保持原来的有损口径，只用于「要不要问 Owner」 | 代价是同一条陈述换个标点会产生新 key、条目回到 pending。方向是刻意选的：丢决定可恢复，合并两条声明是替 Owner 认了没认过的东西 |
| 2 | `sitemap.urlCount` 是 `z.number()`，而 payload 的规范形式禁止任何 JSON number ⇒ **任何真有 sitemap 的站点都存不成 v3 草稿** | 改成十进制字符串（新 `geoCount`） | 无 |
| 3 | 解析器从不校验 `itemKey` 是否真的由该条目内容派生 | 新增服务端 `assertGeoItemKeyIntegrity()`（浏览器侧没有 sha256，做不了），在草稿保存/发布/导入三处边界调用 | 「内容决定身份」从约定升级为可执行检查 |
| 4 | 修正没有绑定目标条目：给事实填一条 `module: "scope"` 的修正能通过 | 解析时建立 itemKey → (module, entityField) 索引并逐条比对 | 同时把实体字段路径收成枚举（见下） |
| 5 | 事实修正没走生成内容那条 value/reason 一致性规则，能写出「有值且 reason=notPublished」 | 抽出 `refineGeoFactContent`，生成内容与修正共用 | 无 |
| 6 | `cited_and_literals_match` 被无条件采信：引用的源可以完全没有正文，声明里的数字可以不出现在任何摘录里 | 解析时强制：至少一个被引用源可用且有摘录；每条声明的数字字面量必须出现在它自己引用的摘录中。新增共享 `geoLiteralsSupported` | 这个标签是卡片上唯一关于证据的措辞，现在它有内容 |
| 7 | 重复的 source id 被 `new Set` 静默吞掉，引用从此有歧义 | 比对 Map 大小与目录长度，重复即拒 | 无 |
| 8 | 契约无法表达 §4.4 要求的「同 key 不同来源页 ⇒ 并存 pending 并标可能冲突」：唯一性检查会直接拒掉 | **改为一条身份携带多份观察**：每个草稿条目新增 `alternateObservations[]`；事实一旦有冲突就 `value: null` + `reason: "conflicting"`，不替 Owner 挑赢家 | 偏离设计稿字面（不是「两条并存条目」）。理由：两条条目会各自被接受、各自发布，知识库就会同时声明两个价格；一条身份两份观察保证决定目标唯一 |
| 9 | v3 复用了 v2 的角色 schema，`pending`/`excluded` 角色能进「已锁定」的生成输入 | 加 v3 专属 refine：全部必须 `review: "accepted"` | 无 |
| 10 | qualifier 按多重集归一化，`["Pro"]` 与 `["Pro","pro"]` 产生不同 key | key basis 先按归一化去重再排序；schema 侧改用 `geoNormalizedUnique` | 无 |
| 11 | 序列化器只拒 NUL，不拒孤立代理项 —— 这类字符串没有任何合法 `jsonb::text` 形式，量出来的字节数是量了一个 PostgreSQL 会拒收的东西 | 序列化边界加 `hasLoneSurrogate`；生成输入的裸 `z.string()` 换成新的 `geoPlainString` | 无 |

评审同时验证了没有问题的部分：分隔符不产生拼接歧义、被审的对象分支都是 strict、草稿 provenance 确实拒绝 `declared_owner` 与 `owner_declared`、UUIDv8 通过、三个「客户端安全」文件的传递 import 图经 esbuild browser bundle 实测不含 `node:crypto` 或 `server-only`。

### 15.2 本轮新增的两条口径收窄

| # | 收窄 | 理由 |
|---|---|---|
| 13 | 实体字段从自由文本收成枚举：`GEO_ENTITY_FIELD_PATHS`（20 条，可有 itemKey、可被排除）与其子集 `GEO_ENTITY_CORRECTABLE_PATHS`（11 条标量，可被就地修正）。列表、URL 与 `sameAs` 有 key 但改不了 | 修正只携带一个短字符串，改不动数组和 URL；自由文本会让修正指向一个谁都应用不了的字段 |
| 14 | 发布时 `alternateObservations` 不进知识包 v2 —— 冲突事实以 `value: null` / `reason: "conflicting"` 发布，两个来源页仍在 `sourceRefs` 里，冲突本身写在 `statement` 里 | 给知识包 v2 加字段会在三个并行 agent 中途改契约。已发布版本仍然诚实（不声明价格），只是少了结构化的「哪两页各说了什么」 |

### 15.3 落地时新发现、尚未修的缺陷

| # | 事实 | 依据 | 处置 |
|---|---|---|---|
| 15 | **已修**（27/27 绿，零删除用例，1 条改名 + 1 条新增）。`payloadV3()` 现在从 `completePayloadV3()` 派生，候选走真 `buildGeoSnapshotContextV3` / `buildGeoKnowledgePackV3` / `createGeoPreparedCandidateV3`，畸形输入由**真对象单点变异**产生。重建过程挖出四类「只因假形状绕开了守卫才通过」的用例，比修复本身更值钱：**(A)** 整个知识生成组跑在一份产品造不出来的 manifest 上——它把 `buildGeoKnowledgeSynthesisInputV1()` 的输出去掉 `contentHash`、把 `schemaVersion` 改标成 v2，即**一个 12 键的 V1 对象披着 V2 的标签**（真 V2 是 14 键）。它能活下来是因为数据库的 V2 分支只钉键**名**不钉键数——正是今天补的键数钉死才终于抓到它。**(B)** 「接受 UUIDv8 收据、V1 下拒绝」的 V1 那一半什么也没证明：同一份 V2 标签的合成输入会让 V1 分支先因版本拒绝，与收据 id 的版本位无关。**(C)** 候选里的 `knowledgePack` 是个无效对象，而 RPC 从不解析它，所以 `parseGeoPreparedCandidateV3` 的三条规则（包的市场/语言要与身份一致、发布的每个 key 必须在被审草稿里、被排除的 key 不得发布）从 SQL 侧完全没被走到。**(D)** 旧候选带顶层 `runRef`、上下文带 `roleLineage` 和 `skippedLayers:["third_party"]`，而两个 schema 都是 `.strict()`、`third_party` 也不在层枚举里——**这个套件造出来的候选，没有一个能被读者的解析器读回来**。另有 **(E)**：上下文篡改用例是用**原候选哈希**发布的，所以它死在哈希守卫而不是 `targetHost` 守卫上；那条用例保留（它验的是真守卫），能真正走到 `targetHost` 重新推导的那条在 `kb-v3-publish.integration.test.ts` 里 | ~~`kb-v3.integration.test.ts` 的 `payloadV3()` 是凭空手写的，与 TS 契约**完全不符**：`evidenceChecks: "citation_matched"`（真值是 `cited_and_literals_match`）、`itemKey: "entity/definition/w25"`（真值是 sha256）、模块写成裸数组（真形状是 `{status, value}`）、decision 带一个不存在的 `note` 字段、三个子结构各带一个不存在的 `schemaVersion`。数据库 CHECK 只验「是不是 object」「有没有 profileCopy」，所以这些全部通过 | 迁移 `20260907143000:44-66` 与 `kb-v3-contract.ts` 的 `payloadSchema.strict()` | **待修**：把 `payloadV3()` 改为从 `completePayloadV3()` 派生。当前 SQL 套件证明的是「数据库接受一个产品永远产不出来的 payload」，即 [[verify-the-thing-you-ship]] 那类失败。等运行编排切片的迁移落地后一并做，避免两个工作并发跑同一个测试库 |
| 16 | 数据库对 v3 payload 的形状**实际上不设防**（只查三个键是不是 object）。TS 契约是唯一的形状权威 | 同上 | 这是可接受的分工，但必须写明：任何「数据库会拦住畸形草稿」的假设都是错的。尺寸、版本、提问集成对性由数据库管；形状由 TS 管 |
| 17 | ~~D10 与 D11 本轮尚无人认领~~ **D10 已落地**（`20260907190000_geo_kb_website_link.sql` + `kb-website-link.integration.test.ts` 7/7）。做法比设计稿写的严一档：外键带上 `canonical_site_key` 做**三列复合引用**（`(website_id, user_id, canonical_site_key) → marketing_websites(id, user_id, canonical_site_key)`），所以数据库自己就能拒绝「指向一个真实存在、归属正确、但描述另一个站点的 Website 行」——两列外键会放行那一种。不用触发器。`website_id` **刻意可空**：GEO 工具允许在没有确认档案时先建知识库，为了满足约束去凭空造一行 Website 是往档案注册表里塞一条没人创建的记录；`marketing_geo_upsert_kb` 在两边都存在的第一时间补链，只做 null → 值，从不改指。删除规则 `restrict`，与 `marketing_websites` 上其余三条外键一致 | 第 11 节 | D11 仍未认领：需要装配器在写事实时算出到期日 |

### 15.4 发布链路的四处契约错配（已修，2026-09-07 19:2x）

这一组是最严重的一处：**在修复之前，v3 没有任何一个版本能被发布或读回**，而单元测试全绿——因为没有任何一个测试同时跑 TS 契约和真 RPC。单元测试用 TS 契约造候选喂给假 store；SQL 测试手写 JSON 喂给真 RPC。两边各自自洽，接缝上四处独立错配全部存活。

| # | 错配 | 裁决 | 修法 |
|---|---|---|---|
| 18 | `marketing_geo_publish_kb_v3` 要求 `context.candidateId` 与 `context.generationInputHash`，而 `snapshot-context-v3.ts` 的 `contextSchema` 是 `.strict()` 且两个字段都没有 ⇒ 每次发布都 `candidate_mismatch` | **改 SQL 迁就 TS**。TS 是形状权威（第 16 条）；且 `buildGeoSnapshotContextV3` 「是 payload/提问集/kbId 的纯函数」这条性质有实际价值——它让发布时的重新推导成为真检查而不是复制，塞进 candidateId 就在那个字段上退化成复制。候选与版本的绑定已经有真列 `marketing_geo_kb_snapshots.prepared_id`，比 JSON 字段强 | 删掉这两条守卫 |
| 19 | RPC 把 `p_candidate->'questionSet'` 当作裸的提问集读（找 `schemaVersion`），而契约给的是判别联合 `{status:"available", value:…}` / `{status:"unavailable", reason, failedGenerationId}` ⇒ available 分支永远不成立 | 改 SQL 读判别槽 | 见迁移；同时把存进 `question_set` 列的值从整个槽改成 `->'value'`，否则存下去的东西 `parseGeoQuestionSetV2` 读不出来 |
| 20 | 哈希域不同：TS 是 `geoV2Digest(questionSet.value)` / 缺席时 `geoV2Digest(null)`；SQL 是 `marketing_geo_json_hash(<整个槽>)` | 改 SQL。已实测 `marketing_geo_json_hash('null'::jsonb)` 与 `GEO_ABSENT_QUESTION_SET_HASH` 是同一个值 | 见迁移 |
| 21 | RPC **从不把候选与它声称要发布的草稿做比较**：`baseDraftHash` 只跟候选自己的 payload 比（自洽检查，对并发一无所知），`baseDraftVersion` 根本没人读 ⇒ 两个标签页各自发布自己审过的 payload，后到的旧版本会静默成为当前冻结版本 | 补上真 CAS，沿用既有的 `input_stale` 结局（v2 冻结路径已经是这个语义，`kb-v3-store.ts:92` 已经在读它，TS 侧零改动） | `baseDraftVersion` 比 `v_draft.draft_version`、`baseDraftHash` 比 `v_draft.content_hash` |

顺带修掉同一个文件里三处相邻缺陷：

| # | 事实 | 处置 |
|---|---|---|
| 22 | 幂等复用键里的 `c.context->>'generationInputHash' is not distinct from v_context->>'generationInputHash'` 是**恒真**——没有任何 v3 上下文带这个字段，两边都是 NULL。而且它本来就多余：RPC 自己的注释写明「定义一个 v3 版本的元组是 payload 摘要加提问集摘要，评审决定与生成输入都在 payload 里」 | 删掉。这是等价清理不是修 bug——变异测试 M7 把它加回去，没有任何测试变红，正说明它什么都没做 |
| 23 | `generation_input_locked` 守卫 keyed on `runRef.runId`，而契约把它注释为「单次运行路由存在之前恒为 null」⇒ 在**唯一存在的三调用流程上，这个锁从来没有生效过一次** | 改为四个 runRef id 任一非空即上锁（覆盖未来的单次运行路由和当前的三调用流程） |
| 24 | `marketing_geo_knowledge_result_valid` 的 v2 分支放弃了 narrative 的键数钉死，理由写的是「narrative v2 带三元组事实和 canonicalQuestion，键数不是 6」——这是错的，那些是 `facts[]` / `qa[]` **内部**的形状，narrative v2 顶层就是和 v1 一样的 6 个键 | 给 v2 分支补回键数钉死（narrative 6、synthesisInput 14），并且这两个数字由测试从真 builder 派生出来断言，而不是靠我数 |

**修完补上了那个缺席的测试**：`kb-v3-publish.integration.test.ts` 用真 TS 契约造候选（同一个 sweep、同一个包装配器、同一个上下文构造器、`createGeoPreparedCandidateV3`），调真 RPC，再用读者会用的解析器把表里的东西读回来。10 个用例全绿，并对上面每一处生产改动做了变异测试：

| 变异 | 变红的用例 |
|---|---|
| 把 `candidateId` 守卫加回去 | 4 个 |
| 提问集按裸对象读 | 3 个 |
| 哈希整个槽而不是 `->'value'` | 3 个 |
| 去掉草稿 CAS | 「草稿已经动过就拒绝」 |
| 锁只看 `runId` | 「三调用流程上也要锁住 generationInput」 |
| `question_set` 列存整个槽 | 「读回来的东西解析器认得」 |
| 把恒真的复用键加回去 | **无**（如上，等价） |

#### 15.4b 追加：那把锁原本没有出口（我自己修出来的陷阱）

15.4 第 23 条把 `generation_input_locked` 从只看 `runRef.runId` 改成四个 id 任一非空即上锁。运行编排切片交回时指出：**这样一改，锁就没有释放路径了**——第二次更新按定义要锁定一个新的生成输入（新的 `evidenceContentHash`），而它会被上一轮遗留的 `rolesGenerationId` 永远拒在第一次保存上。我把「锁从不生效」修成了「锁再也解不开」。

规则改成：**哈希和它产出的那些生成必须一起动**。同一次保存把四个 runRef id 全部清空时，才允许改 `generationInputHash`。

这没有削弱锁要保护的东西。生成记录只在输入哈希与草稿相等时才可认领（`marketing_geo_generation_input_current` 的 v3 分支），所以清空 id 就等于放弃旧输入付费买到的全部复用权——**释放的代价正好是它应该付的**；而旧哈希下的记录在新哈希落地那一刻就不再匹配，任何决定都不可能被归到它不是针对的输入上。

变异测试两条：完全去掉释放（退回绝对锁）打红「三调用流程上也要锁住」；把释放放宽成「只需清 `runId`」同时打红两条——后者证明了逐个 id 的覆盖不是摆设（否则还剩三条把陈旧生成带进新输入的路）。

#### 15.4a 追加：提问集槽的键集也钉死了

SQL 套件重建时探测出一处：**RPC 不检查槽里的多余键，而槽里的内容决定了存什么**。
`{status:"unavailable", reason:"roles_missing", failedGenerationId:null, value:<一份真的提问集>}` 会以 `published` 通过，`question_set` 列写 NULL——**电线上带着一份提问集，冻结下来的版本却声明自己没有提问集**。
`questionSetSlotSchema` 是 `.strict()`，走契约的调用方造不出来；但「唯一的写入方行为端正」不是被存下来的记录能依赖的性质，而钉键集很便宜。现在两个分支各自钉死键数与键名（available 2 键、unavailable 3 键）。

这里还踩了一次**空护栏**，值得记：第一版测试把槽换成畸形值，但候选原本是 available 的，`context.questionSetHash` 因此是「有提问集」的那个哈希——**哈希守卫先炸了，键集护栏根本没被走到**。变异测试立刻暴露：去掉 unavailable 那条钉死，测试全绿。修法是让每个用例从**同样可用性**的候选造起，再加一条对照断言（同一候选不动槽必须能发布），证明它确实走到了那道门。判据：一个「拒绝了」的断言，如果不能同时说明**是哪道门拒的**，它就可能在证明别的事。

顺带记一条 plpgsql 陷阱：**IF 条件里不能内联 `CASE`**。plpgsql 读 IF 条件时扫到第一个 `THEN` 就停，不认识 CASE 有自己的 `THEN`，表达式会被从中间截断，报的是 `syntax error at end of input`。要先赋值给变量。

### 15.5 排除实体字段：装配器与界面的两半（已修）

跨模型评审确认的 P1：**排除一个实体字段只删掉了它的溯源行，值照发**——而且发出去时既没有来源标签也没有决定标签，于是被 Owner 明确否决的那段文字，在卡片上读起来比它旁边被接受的条目**更没有限定**。违反设计稿第 171 行「排除条目不进发布版本、不进导出」。

装配器侧已修：排除移除的是**值**。13 条可移除路径按形状处置（列表清空、可空标量置 null、可空 URL 置 null），其余 7 条是必填（`name` / `categories.primary` / 三个 definitions / `audience.who` / `links.home`）——它们没有可发布的缺席形式，排除后整节以新理由 `owner_excluded_required` 扣下。同时新增 `owner_excluded_all`：被 Owner 排空的模块此前复用 `insufficient_evidence`，卡片因此说「现有证据还不足以形成这一节」、Coverage 说「内容当前不可用」，**两句都是在讲采集，而两句都是假的**——采集拿到了内容，是 Owner 删掉的。那条分支只有排除/压制能走到，别无它路。

界面侧本轮补齐（装配切片交回时明确点名的缺口）：审阅界面此前**照样对必填字段提供「排除」**，Owner 要等到发布之后才发现整个身份区块被扣下——把后果藏在最难撤销的那个动作后面。现在按钮保留但禁用，理由以真实元素渲染在行内并由 `aria-describedby` 指向：**不用 tooltip**，因为触屏看不到、不 hover 的读屏软件也读不到，而那正是最需要这句话的读者。

为此把「哪些路径可移除」从装配器搬进了 `kb-knowledge-shape.ts`——审阅界面是 client 组件，不能 import 装配器（会把 digest/server 链拖进浏览器包），但它必须不提供一个装配器会拒绝的手势。两边不会漂移，且不是靠约定：装配器的 `ENTITY_REMOVALS` 类型是对 `GeoEntityRemovablePath` 的**全量 Record**，可移除路径少写一个 remover、或给必填路径写了 remover，**都是编译错误**；`GEO_ENTITY_REQUIRED_PATHS` 由列表取补集派生，新路径没登记就自动落进必填——fail-closed 方向。

`owner_excluded_required` 并未因界面拦截而变成死路：压制（suppression）按 key 存活、跨草稿继承，直接调 API 也能写，所以那条分支仍可达并有测试钉住。

五处变异各自打红对应用例（按钮不禁用 / 理由不渲染 / 去掉 `aria-describedby` / 界面不标必填 / 对所有实体字段都标）。

## 16. 整合清单（各切片交回的接缝）

每个切片都在自己的边界上停住了，把跨切片的部分交回来。这一节是整合时要逐条闭合的东西，**不是新设计**。

### 16.1 必须有人接线，否则功能不可达

| # | 接缝 | 谁提出 | 谁来接 |
|---|---|---|---|
| A1 | ~~运行编排有口子但没有生产者/执行器~~ **部分闭合**：`fetch` 已接（`kb-run-collect.ts` + `kb-run-collect-executor.ts`），`serp`/`gsc` 有意排除，`model` 因缺四个生产者仍是 `unsupported`。详见 16.1b | S4 | 采集/装配切片提供 seed 与 executor |
| A2 | `runRef.runId` 目前**没有任何代码写入**。运行编排切片**刻意没写**，理由是先要有解锁故事——见 15.4b（锁的释放已补上，但写 `runId` 仍要求先想清楚谁在什么时候清它） | S4 | 装配切片写草稿时绑定 |
| A3 | `driveGeoKbRun` / `readGeoKbRunState` 是客户端续跑循环，但按钮、「继续更新」提示和状态行没接 | S4 | 卡片接线切片 |
| A4 | ~~`geo-kb-v2-wire.ts:34` 把 `frozen.knowledgePack` 钉死在 v1~~ **已闭合**：wire 现在带 `knowledgePackV2Schema`（`:178`）并按 `schemaVersion` 分支（`:208`） | 展示层 | 消费链切片 |
| A5 | ~~「剩余 pending 写回草稿为 `accepted_in_bulk`」必须由发布 RPC 完成~~ **已闭合，但落点与设计稿写的不同**：由**发布 handler** 完成，不是 RPC。`kb-v3-publish-handler.ts` 先 `applyGeoV3ReviewAction(..., {kind:"accept_all"})`（`kb-v3-review.ts:124` 写 `accepted_in_bulk`）、`materializeGeoV3Review`，再 `saveDraft`，最后才带着 swept payload 去发布。这个顺序是必须的，不是偶然：新加的草稿 CAS（第 21 条）要求候选命名的 draft version/hash 就是表里的那份，所以「先扫尾、再存草稿、再发布」是唯一能通过的顺序，`kb-v3-publish.integration.test.ts` 按这个顺序跑通 | 发布装配器 | 审阅/发布接线切片 |
| A6 | 站外落地页抓取没有接 `kb-evidence-reuse.ts` 的 24 小时新鲜度复用计划 | 站外采集 | 采集/装配切片 |

### 16.1b ⚠️ v3 目前整条链在生产上不可达（本轮最大的开口）

运行编排切片在接线时发现，缺的不是 A1 那一处，而是**四个生产者**，其中第一个决定了全部：

| # | 缺什么 | 后果 |
|---|---|---|
| A7-1 | **没有任何代码创建 v3 草稿**。`saveGeoKbDraftV3` 只被 `kb-v3-review-handler.ts` 和 `kb-v3-publish-handler.ts` 调用，而这两个都要求 v3 草稿**已经存在**。`GeoProfileRefV3` 没有构造器——`kb-profile-subset.ts` 给得出 13 字段子集，但没有任何东西组装 `{websiteId, snapshotId, snapshotRevision, profileHash, subsetHash, subset}` | **整个 v3 特性不可达**，不只是运行编排。第一个 v3 草稿无从产生 |
| A7-2 | 没有 v3 的生成 preparer。`createGeoKbGenerationPreparer` 对任何没有 `profileCopy` 的 payload 返回 `invalid_input`——那就是每一份 v3 草稿 | 三次模型调用都进不去 |
| A7-3 | 知识合成 v2 没有 runner。`prepareGeoKnowledgeSynthesis` / `synthesizeGeoKnowledgeNarrative` 解析的是输入 **v1**；`buildGeoKnowledgeSynthesisInputV2`、`buildGeoKnowledgeSynthesisV2Prompt` 和 `GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA` 只有测试和 fixture 引用 | v2 合成链没有生产调用方 |
| A7-4 | `marketing-geo-question-generation-result.v1` 没有 TS 契约。它只作为字符串字面量出现在 `kb-v3-publish-handler.ts:115` 和 SQL 的 finish 分支里，没有 builder、没有 parser | 提问集结果无法在 TS 侧构造或校验 |

另外零生产调用方的还有：~~`assembleGeoKnowledgeBodyV3`、`mergeGeoDraftV3`~~、`collectGeoOffsiteEvidence`。

> **2026-09-08 复核（逐个 grep 非测试调用者）**：前两个已接——`kb-v3-assemble-handler.ts:260` 与 `:280`，该文件开头注释自己写明「这两个在 …… 时没有运行时调用点」。**`collectGeoOffsiteEvidence` 仍是零。**
> 这不是一个说谎的缺口：`kb-v3-assemble-handler.ts:273` 传 `offsite: null` 并注释说明 `null` 是「未采集」，证据模块照此渲染，**不会**说「搜过了没找到」。但它意味着 **S2 的站外那一半（D7：SERP 三查询 → 互指核对 → 独立性判定 → sameAs 候选）建好了却没有接线**，证据与可信度模块在生产上永远只有第一方来源——正是第 29 行诊断 (d) 里那个问题的下一个版本。
> **不需要新裁决——裁决已经写在代码里了，是我上一条注记没连上。** `GEO_RUN_KNOWLEDGE_MODEL_SEED` 的注释（`kb-run-collect.ts:127-137`）写明一次更新只播种 `fetch` + 一个 `model:knowledge`，并且 **`roles` 和 `questions` 是有意缺席**的，理由是「给一个没有执行者能做的步骤播种，只会多出一条诚实结果是 `unsupported` 的操作」；§16.1 A1 同样记着 `serp`/`gsc` 有意排除。
>
> 所以站外采集器零调用者不是遗漏，是那条已裁决排除的**下游结果**：SERP 阶段没进 run，采集器就没有调用点。装配 handler 传 `offsite: null` 并注明是「未采集」，证据模块照此渲染。**站外验证那一半是接了的**——`readGeoOffsitePageSignals` 在 `kb-run-collect-executor.ts:382` 对抓到的页面运行；没接的只有 SERP 驱动的那个采集器。
>
> 剩下的是一次**产品决定**（S2 站外这一半是否随本轮启用），不是工程缺口，且默认路径不说谎。

**第 5 节没写出来的一条顺序约束**：`marketing_geo_generation_input_current` 的 v3 分支（`20260907143000:227-231`）要求 `input.generationInputHash == draft.runRef.generationInputHash`。也就是说生成输入必须**先被写进存储的草稿**，任何模型步骤——包括 roles——才可能成功。「generationInput 在 roles 步锁定」不能理解成 roles 铸造它；免费的装配步必须先把它存下来。

**A1 本轮实际交付**：`fetch` 一种操作（对着站点证据观测库，`resultRef` 是观测 id），带真实的可续跑、防重复计费语义。`serp`/`gsc` 有意排除（各自没有 per-operation 的结果存储），`model` 保持 `unsupported`——**没有生产者的操作类型不得被 stub 成假成功**。种子从 `geoVersionedPayloadIdentity` 派生，因此对 v1/v2 草稿今天就可达。诚实的边界：它写的是观测，不是草稿；在装配切片落地之前没有下游读这些行。

### 16.1c A7 四项已建成，但链条断在**接缝**上（2026-09-07 20:19–21:1x，13 agent）

A7-1..A7-4 四个生产者全部落地，tsc 零错、单测 9802/9802 全绿（一条 `content-draft-v2-workflow.test.tsx` 的负载相关 flake，文件未被改动，隔离重跑 3/3 绿）。**但整树审计的结论是：每一片自身完整且有测试，片与片之间的接缝从来没人接。**

| 步骤 | 状态 | 断在哪 |
|---|---|---|
| 建草稿 | ✅ 但只能 HTTP 调 | 全树唯一的 `post("draft")` 是 `use-geo-kb-v2-editor.ts:424`（v2 端点）；v3 editor 只发 `review` / `publish` |
| **断点 1** | ❌ v3 卡片从未挂载 | `website-geo-editor.tsx:103` 渲染 `<GeoKnowledgeBaseV2>` 却不传 `v3Draft`/`onUpdateV3`；`geo-knowledge-base-v2.tsx:37` 据此二选一 ⇒ **整棵 v3 审阅树是 UI 死代码** |
| **断点 2** | ❌ 三种生成只有一种能跑 | `kb-generation-preparer.ts:401` 对非 `knowledge_pack` 一律 `unsupported_draft`；而 `knowledge_pack` 也够不到，因为 `kb-editor-loader.ts:54` 与 `kb-v2-runtime.ts:163` **直接拒绝 v3 草稿** |
| 审阅 | ⚠️ 机制正确，无事可做 | `knowledge === null` ⇒ `geo-kb-v3-review.tsx:738` 算出 `sections = null` |
| **断点 3** | ❌ 发布恒 422 | `kb-v3-draft-create.ts:244,249-251` 写死 `knowledge: null` 和四个 runRef id 为 null，**全仓再无第二处非测试写入**；于是 `questionsGenerationId` 恒 null ⇒ `resolveQuestionSet` 恒 `not_attempted` ⇒ `kb-v3-publish-handler.ts:199` 恒返回 `nothing_to_publish` |

**孤儿装配层**：`assembleGeoKnowledgeBodyV3`（`kb-knowledge-assemble.ts:402`）与 `mergeGeoDraftV3`（`kb-knowledge-merge.ts:316`）**零运行时调用点**——它们正是把证据变成 `payload.knowledge` 的那座桥。断点 3 就是这座桥没建。

> **这一轮最该记住的不是这三个断点，而是它们的成因**：六个 agent 各自「完成并验证」了自己那片，六份报告都诚实、都全绿、都带变异表。**没有任何一个人的验收范围包含接缝**，所以接缝的缺失不出现在任何一份报告里，只出现在第七个人的整树追踪里。派并行实现时，**必须单独派一个只看接缝的角色**，而不是指望实现者交回时自己发现。

### 16.1d 复核抓出的实缺陷（六个区六比六全中）

每个实现 agent 配一个对抗式复核，**六个区无一例外都被抓到真缺陷**，其中数条是「我刚修好并验证过」的那部分。按危害排：

| 级别 | 缺陷 | 位置 |
|---|---|---|
| P0 | **把不存在渲染成 0**：卡片对业主显示「提问集 · 0 个问题 · 供 AI 可见性检查使用」，而提问集只是**尚未存在**。同一张卡片高一节处刚写过一条「绝不把读不到的步数显示成 0」的专门测试；`:752` 的注释表明作者知道它不可用，然后照样写了 0 | `geo-kb-v3-review.tsx:753` |
| P0 | **建库时的抓取绕过复用库，双花共享闸门**：`collectEvidence` 不读 `readLatestObservation` 也不写 `recordObservation`，而兄弟生产者两样都做。业主确认档案(1)→建库(2)→跑更新(3)，同小时内再有一次审计就 `rate_limited`，知识库降级为 partial | `kb-v3-runtime.ts:115-128` |
| P0 | **诚实的拒绝在接缝处被压成不诚实的**：`input_too_large` 落进 `invalid_input` 兜底，与畸形载荷、哈希失配同一个码。业主被告知「输入无效」，实际是「证据太多，我们不愿意付这个钱发出去」 | `kb-generation-preparer.ts:429` |
| P0 | **构造器会造出数据库必拒的结果**：uuid 正则带 `/i` 且比较两侧 `.toLowerCase()`，而 SQL 是对 Postgres 小写渲染的精确相等 ⇒ 大写 hex 的 kbId 被接受、`finish` 返回 `invalid_result`、**已付费的模型调用被丢弃**。同一文件 `:108` 却因大写拒绝 `receiptId` | `kb-question-generation-contract.ts:87,167,170` |
| P1 | **能力悬崖**：采集器满配输出 18 个来源，而合成契约在 18 个来源时**连输入都构造不出来**（抛错），可用天花板约 10-12 个。作者报告里写「应该有人拿真实目录量一下」——**他自己的 fixture 就是那次测量** | `kb-knowledge-synthesis-v2.ts` + `kb-knowledge-evidence.ts:11-13` |
| P1 | **预算门只量了一半**：`suppressions` 实测占 `reviewBytes` 的 48.9%（512 行 = 64,035 字节），而三条新测全传 `[]` ⇒ 把 `jsonbBytes(review)` 改成 `jsonbBytes(review.decisions)` 两侧判定完全一致。业主攒够 suppressions 后应用层放行、数据库 CHECK 拒收 | `kb-v3-contract.test.ts:41-45` |
| P1 | **`Math.max(1,…)` 关掉了 1000 个值里的 1 个，注释却宣称关掉了这一类**：`minPageMs: 0` 且 `remaining ∈ [1,999]` 时照样派发必失败的抓取，并产出 `:59-66` 明令不得产生的那句「抓到了但读不出来」 | `kb-offsite-collect.ts:342-344` |
| P1 | **付费提示词的品牌身份无人断言**：把 `market` 换成 language、`aliases` 换成 `[]`、`officialName` 换成任意短串，10 条新测全绿 | `kb-generation-preparer.ts` v3 分支 |
| P2 | `not_configured` 会被记成「provider 已应答」（`attemptedCalls: 1`），而那次调用从未离开进程 | `kb-knowledge-synthesis-v2.ts:230-239` |
| P2 | 失败文案承诺「你可以继续」但**首次 drive 失败时根本没渲染继续按钮**；会话过期时建议还是错的（该去登录）；同时还渲染「刷新页面看更新写了什么」——那次运行从未开始 | `geo-kb-v3-review.tsx:716` |
| P2 | 金额声明「没有在它们上面花钱」所依赖的守卫零覆盖：塌成一行后 16 条测试全绿 | `geo-kb-v3-review.tsx:541-542` |
| P2 | 32 条 receipt 上限、uuid/hash 格式校验、`MAX_BYTES` 字面量三处**删掉全绿**（后者改成两倍仍绿，解析器开始放行数据库会拒的） | `kb-question-generation-contract.ts:66,84,87,97` |
| P2 | 「去重并截断」测试的输入去重后正好等于上限 ⇒ 从没测过截断；且 `kb-v3-contract.ts:142` 把 `.max(8)` 写成字面量而非读常量，两者无任何耦合 | `kb-v3-draft-create.test.ts:97` |
| P2 | 两处所有权守卫删掉 45/45 全绿；`profileHash` 传递只由集成测试钉住（而 CI 是手动触发，那层最不可能跑） | `kb-v3-draft-create.ts:406,439` |

空洞测试的六种复现形状已单独记进记忆（`vacuous-test-shapes-checklist`），派复核 agent 时直接贴给它们比泛泛说「找空洞测试」有效得多。

### 16.2 两处口径打架，必须有一方改

| # | 冲突 | 影响 |
|---|---|---|
| B1 | ~~`categoryTerms` 上限：归纳契约 v2 是 12，草稿是 8~~ **已解决**：唯一的生产者是角色归纳输出，它自己就钉死在 8（`kb-synthesis-contract.ts:59/71`），所以 12 是永远够不到的死档——一条永不触发的上限是在陈述这个系统能构造出它构造不出的输入。已把归纳 v2 改成引用同一个常量并加了对齐断言 | 无 |
| B2 | ~~机器可读来源 kind：草稿 v3 不约束，知识包 v2 要求 llms→`llms`、sitemap→`sitemap`~~ **已解决**：规则搬进 `kb-knowledge-shape.ts` 的 `GEO_MACHINE_SOURCE_KINDS`，草稿解析时同样强制。能存下的草稿现在就是能发布的草稿，失败点从「付费之后、Owner 看着」提前到「装配器还能改」。三个测试文件里各自绕开这个接缝的补丁已删除 | 无 |
| B3 | `coverage` 模块有两个语义在抢同一个槽：R9 采集到的意图覆盖骨架（草稿里），与「每个已发布章节完不完整」（发布时重算）。知识包 v2 只有一个 coverage | 需要裁决：留哪一个，或者给另一个换名字 |
| B4 | ~~`generationInputHash` 的定义~~ **已解决**：唯一定义是 `geoGenerationInputHashV3()`（`kb-prepared-v3-contract.ts:121`）= `geoV2Digest(payload.generationInput)`。顺带修了一个真缺陷：共享 fixture 原本把这个哈希写成一个常量，于是审阅和发布两处「拒收哈希已失配的草稿」的测试**是靠 fixture 自己写错才通过的**。已让 fixture 算真哈希，另加显式的 `stalePayloadV3()` 供这类反面用例使用 | 无 |

### 16.2b 装配切片交回的口径，已就地裁决

| # | 问题 | 裁决 | 依据 |
|---|---|---|---|
| B5 | `generationInput.evidenceContentHash` 覆盖到哪：只有站内，还是站内 + 站外？ | **只有站内，且这是对的**。归纳输入 v2 的 `sourceCatalogue` 完全来自 v1 站内证据回执（`kb-knowledge-synthesis-v2-contract.ts:228-229`），站外证据从不进模型。所以这个哈希覆盖的正是「模型看过的东西」，站外集合换了也可以复用已付费的归纳 | 代码路径可离线证伪 |
| B6 | 由 B5 推出的**能力边界**：模型无法用任何第三方证据支撑结论。站外采集（SERP、互指核对、独立性判定）只喂确定性的证据模块与 `sameAs`，不影响归纳出的问答与边界陈述 | 与设计第 3 节一致，但要写明：知识库里的信任类陈述全部只由站点自己的页面支撑；「有独立第三方证据」这件事只体现在证据模块，不体现在模型写的句子里 | 同上 |
| B7 | 装配器把 FAQ 标记归到 `qa` 而不是设计第 4.2 节写的 `facts` | **接受**。事实需要 subject / attribute / value 三元组，FAQ 问答对一个都没有；硬塞进 facts 只能 `value: null`，而 reason 枚举里没有能诚实描述这种情况的值。模型失败时 `qa` 因此是 `partial`（限制说明里写明只有观察到的标记），不是 `unavailable` | — |
| B8 | 冲突只有事实会「不给值」，问答/边界/对比行保留最新观察并把旧的记为 alternate | **接受**，因为只有事实的形状能表达「withheld」。实体字段完全不参与冲突（其声明文本可能超过 alternate 的 800 码点上限） | — |

### 16.2c 「批量接受 · 未逐条确认」怎么让读者看见（D12 的落点）

之前挂起的问题是：`GeoContentBrief.fact_table` 没有字段能承载这个标签，是否给 `label` 加后缀。**裁决：不加。**

四条理由，任何一条单独成立即可：`label` 是这条事实回答的属性名，Draft Writer 会把它写成散文；`parse-geo-brief.ts` 把它截到 200 码点；`geo-fact-support.ts` 与 `geoMissingFacts` 跨版本比对 label，加后缀会让同一条事实看起来有两个 label；而已发布的知识包**每条都带 `decision`**，是无损的，label 后缀只是它的第二份有损副本——和「把 origin 并进 decision」是同一种失败。

改为在读者真正据以决策的三个位置呈现：审阅行的决定芯片（`decisions.acceptedInBulk`，两个语种里都是与 `decisions.accepted` 完全不同的词条）、发布框在兜底扫描前显示的 pending 计数、以及发布响应的 `counts { accepted, acceptedInBulk }` 与 `bulkAccepted`。

变异证明：把 `accept_all` 分支改成写 `accepted`，**五个测试文件共 12 个用例同时变红**（纯算法、路由、发布处理器、编辑器 hook、渲染面板各有覆盖）。

### 16.3 已知会咬人，但本轮范围外

| # | 事实 | 出处 |
|---|---|---|
| C1 | `createGeoEnrichmentPageReader`（`kb-enrichment-deps.ts:43`）**按页开闸**：自家站上有 4 条以上 fact URL，一次更新就吃满 `CRAWL_TARGET_MAX = 4`，之后 Profile 扫描 / seo-audit / internal-link-audit 全拿 `target_busy`。同文件 `:110` 的 knowledge reader 已经做了每 host 一次 admission，两个读取器对同一件事做法不一致。**⚠️ 接手时不要照抄那个 Map**：knowledge reader 是**每次采集 new 一个**（`kb-v2-runtime.ts:63` 注入的是工厂 `createKnowledgeResourceReader`，handler 按 run 调用），它的 admissions Map 因此是 run 作用域；而 `createGeoEnrichmentPageReader()` 在 `DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES:164` 是**模块级单例**，往它身上挂 Map 会让闸门在进程生命周期里只开一次、此后对所有用户所有请求彻底旁路——比现状危险得多。正确修法是把 `GeoKbEnrichmentDependencies.fetchPage` 改成和 knowledge reader 一样的**工厂**（`createPageReader(clientIp)`），由 handler 每次请求造一个。另记一条：knowledge reader 的 `release()` 在**第一页**的 `finally` 就执行了，所以那个 admission 是一次性的限流令牌，不是持有到采集结束的并发槽——命名容易读错 | 观察库切片 |
| C2 | 将来给 GEO 接 `cacheProbe` 时，缓存命中返回的 `kind: "cached"` 会被当成 `fetch_failed` 报出去——「缓存越好用越像抓取失败」。接线时必须同时加 `kind === "cached"` 分支 | 同上 |
| C3 | `openCrawlGate` 的 `cacheProbe` 是第 4 个位置参数，而 `profile-refresh-handler.ts:108` 注入时放在第 3 位。传错不报错，只是缓存永不命中，与现状无法区分 | 同上 |
| C4 | `read_public_tool_crawl_cache` **每次读都执行一次 7 天清理 delete**。四个工具共用，把 GEO 也接进来后读频率会上一个量级 | 同上 |
| C5 | 知识包 v2 的 `assertPackIntegrity` 把整个实体值当一条声明、且从 `entity.origin`（不存在的字段）读 ownerDeclared，所以**带数字的实体字段修正会被拒**。已用测试钉住，改动必须是有意的 | 发布装配器 |
| C6 | 对比修正可以把 `product`/`competitor` 置空却保留 `availability: "available"`，装配器不重算可用性，发布时被拒。编辑器必须同时清可用性 | 同上 |
| C7 | 事实的 `label` / `value` / `reason` 在条目行里没渲染（只出整句）。`reason` 的四个枚举值没有客户文案，需要新增 4 组 i18n key 才能展示 | 展示层 |
| C8 | `declared_profile` 的档案 revision 渲染成 null（只出「产品档案」不出「产品档案 v3」）：知识包 v2 的条目 provenance 没带 revision。`originDetail.profile` 这个 key 已备好 | 同上 |
| C9 | 站外归类表的 `other` 桶**不映射到任何证据组**：陌生域名照样抓、照样进来源目录、照样能做互指核对，但不填 `press` 也不填 `thirdPartyProfiles`。把陌生博客叫「press」是在断言它是媒体 | 站外采集，有意为之 |

> **测试环境注记（2026-09-07）**：多路并行落地期间本机 load average 一度到 366，`visibility-wire.test.ts`
> 里两个 50 题规模的用例会撞 5 秒超时。该文件与其 import 链未被本轮改动（`git diff --stat` 为空），
> 判为负载导致；机器空闲后需复跑确认，**不要在负载下判定它是回归**。
| C10 | 档案声明事实（第 4.2 节「档案声明事实」）未做：把 13 个档案字段映射成 subject / attribute / qualifiers 三元组是 Owner 级判断，且每条都需要一行 `accepted_fact` 目录项（今天由 `kb-generation-preparer.ts` 拥有）。**后果**：发布装配器里的 `GEO_FACTS_WITHOUT_MODEL_LIMITATION` 目前不可达——模型失败时事实模块拿不到任何可发布内容 | 装配切片 |
| C11 | `snippetsBlocked` 没有生产者（没有代码读页面级 `noindex` / `nosnippet`），所以机器可读模块的片段权限在生产上一直是 `not_checked` | 同上 |
| C12 | 模型失败那一轮，对失败模块的既有修正无法带过来（facts / qa / scope 没有可插入的值）。上一版草稿和已发布版本仍然持有它们，排除也仍然存活 | 同上 |

### 16.1e 第二波结果：七项落地，断点 2 被推翻，断点 3 差临门一脚（2026-09-08 凌晨）

**16 个 agent 里 9 个撞会话限额**——8 个复核者、装配桥实现者、整树检查全死，7 个实现者活着交回。**所以有七份改动进了工作区且从未被复核**（第三波正在补）。我自己跑的整树状态：**tsc 零错，550 文件 / 9899 测试全绿**（比上一轮多约 97 条）。

已闭环的（择要）：

- **断点 1 比报告写的更严重**：`initialView` 和 `v3Draft` 是两个独立 prop 且 `initialView` 必填，而 v2 loader 拒绝 v3 草稿 ⇒ **这一对永远无法同时满足，v3 分支是构造上不可达**，不只是没接线。已改成可辨识联合。
- **建库路由现在完全不联网**：没有去接复用库，而是**整个删掉了建库时的抓取**，改锁一个 absent-evidence 哨兵（仿 `GEO_ABSENT_QUESTION_SET_HASH`）。一举关掉双花闸门和时间戳哈希两个缺陷，依据是设计 §16.2b B5——`evidenceContentHash` 命名的是「模型被展示了什么」，而建库时没有任何模型被展示过任何东西。顺带抓到一条没人报的红线违规：`draftVersion: saved.currentDraftVersion ?? -1` 把未知渲染成了 `-1`，而 store 本来就会返回 `null`。
- **能力悬崖真解了**：新增 `projectGeoKnowledgeSynthesisV2Catalogue`——每个来源都展示**同样条数的前导摘录**，取「从 8 往下数、整份目录能装下」的最大档，不丢来源、不截断摘录，被缩短的来源标 `partial`。满配 21 个来源从「构造器直接抛错」变成「cap 4、21/21 全留、提示词 109,604 B < 131,072、买得起」。还加了一句系统提示词，防止模型把「摘录里没有」当成「产品没有」——**否定式声明不带数字，任何下游证据检查都抓不到它**。
- **卡片不再把不存在渲染成 0**：`measurementCount` 改 `number | null`，DOM 上用 `data-kb-measurement-items="unavailable" | "count"` 区分两态；顺带修了 ICU 复数和失败文案（现在拆成「发生了什么」+「接下来做什么」，后者与是否画出继续按钮**由同一个事实决定**）。
- **第七条空洞测试**：question contract 那条 `…case-insensitively` 测试里，fixture 的 id 全是数字（`11111111-…`），所以 `.toUpperCase()` 是个空操作——它正躺在 F1 那个缺陷的正上方。

#### ⚠️ 断点 2 的命题是错的，我给的简报也错了

我写的是「shape 存在，缺的是 preparer 分支」。实现 agent **拒绝实现，并给出了两条可证的矛盾**：

- **roles**：`createGeoRoleProposal` 是 `marketing-geo-role-proposal.v1` 的唯一写入者，schema `.strict()` 且 `profileCopyHash` **必填**；而 v3 的 finish 分支要求 `p_result->>'profileCopyHash' is not distinct from v_row.input->>'profileCopyHash'`，v3 输入根本没有这个键。**于是这个构造器能造出的每一份提案都会在 finish 被拒——而那是在模型调用付过钱之后。** 它用一次性探针在运行时验证了这点，不是读代码猜的。另外 `buildGeoRoleSynthesisBasis` 开头就 `if (payload.profileCopy === undefined) throw`，且读的是 28 个 v1 Profile 字段，而 v3 只有 13 字段的 `profileRef.subset`。
- **questions**：`GeoQuestionSetV2` 的唯一生产写入者是 `kb-preparation.ts:151`，其第一步就是 `parseGeoKbPayloadV2`；三个吃标定注册表的函数是模块私有的。**能 fork 出来，但 fork 的结果是 `registryVersion: "none"`**——业主会拿到一份一条标定问题都没有的 v3 提问集，而 v3 自己那条 `unsupported_language` 拦截的理由恰恰是「提问步跟随英文注册表」。**那是个没人做过的产品降级，而且下游全程不可见。**

它没有硬上，而是**把拒绝锚定到了证据**：新测试双向钉住这两个阻塞点，等谁补上缺失的 shape，那条测试就会变红并点名这个文件。**这是对的做法**——「让拒绝活得比它的理由更久」正是这个仓库反复出问题的地方。

**所以断点 2 的真实代价不是一个分支**：roles 要动 SQL finish 分支（迁移，我的活），questions 要一个 v3 提问集装配器**外加一个产品裁决**。

#### 断点 3：差一个集成测试

装配桥 agent 死在半路，但**文件已经落地且是像样的**：346 行 handler、560 行测试 21 条全绿、路由已接。缺的是它没来得及写的集成测试，因此**「装配之后发布真的能成功」这件事至今没有任何证据**。第三波正在补，并要求它先判断现有测试是否可信，再写集成测试，再修测试暴露的东西。

### 16.1f 第三波：七项复核补齐，链条精确断点已定位（2026-09-08 上午，9/9 无失败）

整树：**tsc 零错，550 文件 / 9902 测试全绿**。

#### 本轮最重的一个 bug：已发布的知识库装配第二次会永久失败

装配桥 agent 发现并修掉的。`kb-v3-assemble-handler.ts:269` 把 `next` 构造成 `{...stored, knowledge: 新body, runRef}`——**上一轮的 review 被带到了新的 body 上**。`mergeGeoDraftV3` 会把 `next` 当整份 payload 解析，`assertOverrideTargets` 在「决定指向 body 里不存在的条目」时抛错，handler 兜成 `assembly_invalid` (422)。

**而且是永久的**：出问题的那次 generation 仍是最新一次，每次重试走同一条路；唯一出口是释放 generation-input 锁，等于作废全部已付费运行。实测**发布会把每条 pending 都扫成一条 decision**（首发后 decisions: 17 / items: 17），所以**任何已发布的知识库只要下一轮少产出一个条目就再也装配不了**——这是正常更新周期，不是角落。

修法只有一行语义改动（`next` 传空 review）：`previous` 就是同一份已存草稿，而 merge 本来就以**更高优先级**读被替换草稿的 review（`kb-knowledge-merge.ts:326-329` 把 `previous` 放在第二位覆盖），所以此前所有通过的用例合并输出**字节相同**，消失的那条决定改走它本该走的 `dropped` 路径，排除以 suppression 形式存活。

**它为什么躲过了 21 条单测 + 4 条集成测试**：所有 review fixture 用的都是「条目仍存在」的 decisions，于是 `reviveSuppression` 一次都没跑过。已单独记入记忆（`test-the-second-cycle-not-the-first`）。

#### 链条的精确断点（两处，修任一处都不够）

| 位置 | 事实 |
|---|---|
| **主断点 `kb-run-collect.ts:123`** | v3 运行**只种站内 fetch 操作**，从不派发模型步，因此 v3 草稿永远不会有 `knowledge_pack` generation 记录。`kb-run-runtime.ts:14-21` 明写这是有意的（只注册 `COLLECT`）。**讽刺之处**：`/v2/generation` 正是那条 preparer 接受 v3 knowledge_pack 的路由，但它只被 `use-geo-kb-v2-editor.ts:116` 调用，而 v3 草稿从不渲染那个编辑器——**能力存在且不可达** |
| **次断点** | `handleGeoKbV3Assemble` 全仓只有一处引用：它自己的路由文件。客户端 hook 只 post `draft` / `review` / `publish` |

发布那条无条件拒绝**确实修好了**（`kb-v3-publish-handler.ts:199` 现在是条件的），但两个合取项在当前部署里恒为真，所以仍返 422——**因为上游，不是因为它自己**。

#### 对上一轮 roles 判断的更正

上一波 agent 证明 roles 存在 shape 矛盾并据此拒绝实现。整树追踪**确认矛盾为真但更正了归因**：`kb-generation-preparer.ts:429` 会先拒（非 knowledge_pack 一律 `unsupported_draft`），所以那条 SQL 矛盾**根本走不到**。两件事都成立，但「阻塞点在哪」的答案不同——这决定了将来谁去修。

#### 七项复核的收获（每一份都找到了真缺陷）

择要：uuid 大小写修复**只钉住了五段里的一段**（把最后一段改成大小写不敏感，31/31 依旧全绿，`…1111111111FF` 被接受）——**F1 在 F1 的修复里复发**；hash 的长度上界、uuid 首段长度、`baseDraftVersion` 的安全整数 refine 三处删掉全绿；`kb-run-plan.ts` 那条「无法分类就拒绝」的断言**在有预算时是假的**（那道门在预算门里面，唯一 fixture 是 `remainingMs === 0`）；`runTally` 漏了第二个带金额含义的 reason——`probeOne` 写的 `{failed_permanent, reason: "outcome_unknown"}` 是**派发过、可能已计费、结果无法确认**的操作，却被显示成「没能完成」；合成的字节预算是复合的，而 `profileRef`（合法最大字段）在测算时被按 fixture 大小计入，**悬崖仍然可达**。

### 16.1g 第四波：链条在 API 层闭合，但业主那条路还断着（2026-09-08 中午，15/15 无失败）

**API 层闭合已被独立证实。** 审计者自己跑了 `kb-run-seam.integration.test.ts`（2/2，真 Postgres），而且那条测试不是自证：它**先断言旧的 422**（新草稿上 `nothing_to_publish`），再驱动真实的 `handleGeoKbRun` 到 `complete`，断言 `operations.map(kind) === ["fetch","fetch","model"]` 全部 succeeded、运行自己的幂等键下恰好一条 `knowledge_pack` generation 行、`after.payload.knowledge !== null`，最后发布 → **200，`revision: 1`**，且快照行的 payload 里带着 knowledge。只有页面 reader 和 LLM 两处是假的。

新增接线：`kb-run-collect.ts:157-162` 的 `geoRunUpdateSeeds` 在 fetch 种子之后追加 `GEO_RUN_KNOWLEDGE_MODEL_SEED`；`kb-run-runtime.ts:660` 把 `model` 路由到 KNOWLEDGE；`:616-622` 调 `handleGeoKbV3Assemble`。原来那个断点 `kb-run-collect.ts:123` 现在是 `geoRunCollectSeeds`，被新函数包住的 fetch-only 那半。

#### ⚠️ 但「可达」这个结论本身是错的——而且错法值得记

第四波的整树审计报告「卡片可达 ✅」，追踪链写得很具体。**它追的是组件树，没追喂给组件的那条路由。** 复核者发现：`app/api/account/websites/[websiteId]/geo/route.ts:20` 传的是 `loadGeoKbEditorV2`，而 `loadGeoKbEditorAny`（其 doc 注释自称「网站 GEO 路由**应该**依赖的那个 loader」）**全仓零生产调用者**。于是 v3 草稿在那条唯一喂编辑器视图给浏览器的路由上恒返 unavailable → `geo-route.ts:50` 一律映射成 503。**业主拿到一条永久的「服务不可用」，而他的知识库完好无损**；组件里那两个判 `marketing-geo-kb-editor.v3` 的分支是死代码。

自底向上追踪时每一层都「存在且正确」，每步都能打勾——但可达性不是每层都存在，而是某个**具体入口**能走通全程。已记入记忆（`trace-reachability-from-the-entry-point`），并已把「从 HTTP 路由开始追，不要从组件开始」写进收尾波的审计提示词。

#### 两条 P0 金额/诚实性缺陷

1. **`model` 操作里藏着一次不入账的抓取。** `kb-run-plan.ts:5-9` 写着账本的立身之本：「每一个花钱或消耗共享抓取额度的操作都要有自己的持久行」。而 `kb-generation-preparer.ts:444-450` 用**硬编码空的** `reusedSources: []` 调 `collectKnowledgeEvidence`，拿到一个**全新的** reader，于是在一个「model」操作内部又抓了一遍首页、内链、robots/sitemap/llms，**外加每个已确认竞品的首页和一个定价页**——全部撞在采集步刚花过的同一个 4 次/小时配额上。三个后果：站点和竞品每次更新被抓两遍；运行里那些 `fetch` 操作**是装饰性的**（观测账本没有任何消费者，装配器读的是 generation 记录里的 evidence），而且因为 `planGeoRun` 跳过 `failed_permanent` 继续走，**采集全失败模型步照跑**；UI 把那两次 fetch 记成 `done`，把付费采集呈现为产出知识的工作，而真正产出知识的那次抓取一行账都没有。**这正是另一个 agent 已经在 `kb-v3-runtime.ts:99-113` 修好过的缺陷，在另一个接缝上原样复发。**
2. **卡片的费用句在三件事上说谎。** `card.cost` 声称一次更新「读取 Search Console」（从不）、抓取「站外来源」（从不）、以及「两到三次计费模型调用」（恰好一次）。它无条件渲染在每张 v3 卡片上，**两个语种都没有任何测试钉住它**。

#### 复核的其他确认项（择要）

`chargeUnresolved` 那句新的金额文案**只和它自己比对**——把 en.json 那个叶子换成「从未发送，因此没有花钱」，30/30 依然全绿（新增的空洞形状 #9：i18n 断言拿组件刚渲染的同一个目录叶子做期望值，对任何措辞都成立，包括相反的断言）；而且它捅穿了旁边那条现成的护栏——那条注释写着「页面上没有任何地方声称没花钱」的断言只检查了 `unsupported` 那个叶子。合成的字节悬崖**在真实 Profile 上限处仍然可达**（实测 prompt 137,482 vs 上限 131,072，超 6,410），因为上一轮的 `heavyProfileRef()` 只撑大了 13 个字段里的 5 个数组字段，五个 2,000 字符的文本字段仍停在 fixture 的 ~136 字符。收据 id 的规范化守卫**从未被证明会扫过第一个元素**（所有大写 fixture 都是单元素数组）。

### 16.1h 第五波：闸门全绿，但合并前还有五项（2026-09-08 下午，13/13 无失败）

审计者自己跑的闸门：**tsc 零错；单测 551 文件 / 10013 条全绿；集成 17 文件 / 263 条全绿**（唯一那条「失败」是 `geo-persisted-chain` 只认自己专属库的护栏，换库单跑 1/1 通过）。

**路由 → 卡片这一段真修好了**，而且是被一条驱动真实 `POST` 并从响应体读 `marketing-geo-kb-editor.v3` 的测试钉住的。**已有 v3 草稿之后的每一步也都成立**，由 `kb-run-seam.integration.test.ts` 在真 Postgres 上证明。

#### ⚠️ 同一个形状第三次咬人：这次断在「谁来造第一份 v3 草稿」

`createGeoKbV3Draft`（`use-geo-kb-v3-editor.ts:254`）是唯一会 POST `/v3/draft` 的客户端函数，**零非测试调用者**；`handleGeoKbV3DraftCreate` 也只被自己的路由文件和测试引用。

于是真实业主看到的是：v2 loader 先跑，没有草稿时合成一份 v1→v2 payload，返回 `marketing-geo-kb-editor.v2`，渲染**旧卡片**；按下它的按钮跑 v2 管线、产出 v2 草稿；而 `handleGeoKbV3DraftCreate` 拒绝任何已存在的草稿（409）——**那个账号从此永远无法变成 v3**。

三次审计、三次「可达 ✅」、三次错在同一处：**每次都从叶子往里追，停在了真相的前一层**。第一次停在组件树（漏了路由传的是 v2-only loader），第二次停在路由（漏了没人造草稿）。已把「从入口正向追 + 对每个新导出入口 grep 生产调用者」写死进后续所有审计提示词。

#### 新的空洞测试形状 #10：端到端测试把缺陷所在的接缝 stub 掉了

第四波那条 P0（model 操作里的不入账抓取）**第五波仍然活着**，而且现在能说清它为什么活着：唯一驱动整条运行的集成测试在 `kb-run-seam.integration.test.ts:286` 把 `collectKnowledgeEvidence` stub 成了固定装置，**正好把缺陷所在的那个接缝挡住了**。同时 `geo-kb-card.test.tsx:95-140` 钉住了费用句的三条禁止声明，但它的推理只看 `planGeoRunCollection`，从不看模型步实际抓了什么。

费用句被改过一次，**改完仍然是假的**：新版本说「每天至多重读一页」，而模型步那次抓取 `createGeoKnowledgeResourceReader` **不查任何缓存和观测库，每次都重抓**，并在同一次更新里对业主自己的主机开**第二个**抓取闸门许可（4 次/小时，与 Profile 扫描、seo-audit、内链审计共享）。一次最多 18 个请求。

#### 新发现：业主确认新的 Profile 版本会把知识库变砖

`generationInput` **只有一个写入者**（`kb-v3-draft-create.ts:528`），而那条路由在草稿已存在时一律拒绝。SQL 的 `marketing_geo_generation_input_current` v3 分支要求 `generationInput.profileRef` 仍然指向该站点**当前**已确认的 Profile 快照。所以业主一旦确认新的 Profile 版本，之后每一次 generation claim 都被拒，更新按钮永久失败。

释放路径在 SQL 里是有的（`generation_input_locked` 允许在同一次保存里清空全部四个 `runRef` id 时改哈希），**但没有任何 TypeScript 写入者去做那次释放性保存**。

#### 合并前必修五项（审计者给的清单）

1. 没有生产代码创建第一份 v3 草稿——整个改版不可达
2. 费用句仍然是假的（模型步的第二次不入账抓取）
3. 确认新 Profile 会把知识库变砖（缺 re-lock 路径）
4. 发布后的变更计数错误（`baseline` 在挂载时捕获一次，发布后不更新，于是刚发布 kb@v1 就显示「相对 kb@v1 有 17 处变更」）
5. 「已在发布版本中完整展示」指向一个 v3 业主永远看不到的界面（没有任何东西渲染已发布的 v3 包）

第六波正在攻这五项。

### 16.1i 第六波：链条对「新站点」真的通了（2026-09-08 傍晚，9/9 无失败）

闸门（审计者自己跑）：**tsc 零错；单测 552 文件 / 10084 条全绿；集成 17 文件 / 265 通过 + 1 跳过。**

**八个入口全部有了真实生产调用者**——`loadGeoKbEditorAny`、`createGeoKbV3Draft`、`handleGeoKbV3DraftCreate`、`handleGeoKbRun`、`driveGeoKbRun`、`handleGeoKbV3Assemble`、`handleGeoKbV3Review`、`handleGeoKbV3Publish`，逐个 `grep` 验证。`kb-run-seam.integration.test.ts:388` 从建库一路驱动到发布，并从 `marketing_geo_kb_snapshots` 里把 `revision: 1` 读了出来。

**范围裁决（有意，不是缺陷）**：v3 只提供给**既无草稿又无已发布版本**的知识库（`geo-knowledge-base-v2.tsx:90`）。不做任何迁移，现存站点（包括线上样本 astrologywiki.com 的两个 09-04 快照）永远留在 v2 卡片上。**这次改版只对合并之后新建的站点生效。**

#### 合并前必修四项

1. **确认新 Profile 版本会把知识库锁死，而且浏览器里没有出口。** SQL 要求 `profileRef` 仍指向当前已确认快照；确认新版本后 claim 返回 `input_stale` → 409 → 被映射成 `failed_retryable` → `kb-run-plan.ts:65-67` 永远重启且**没有次数上限** → 运行停在 `running`，唯一活跃索引挡住后续所有运行，重载后 `resume !== null` 把「更新」按钮**禁用**，只剩「继续更新」而它每次都 stall。**relock 的服务端已经建好并被集成测试证明**，但没有任何客户端发 `intent: "relock"`；也没有任何客户端发 `action: "abandon"`。业主看到的是 `run.failedUnavailable`——一句永远不会自愈的「服务不可用」。
2. **发布一个 v3 知识库会让整个账号的 AI 可见性检查 503。** `visibility-context-handler.ts:63` 那个 `return` 在 `for (const listed of websites.value)` 循环**里面**，于是一次拒绝中止整个响应，把该账号其他站点（v1/v2 完好）一并打掉。选 503 而不是 `frozen: null` 的理由是诚实（v3 包确实读不了），**理由成立，错的是波及面**。
3. **「没有尝试，也没有花费任何额度」印在一次已经抓过站的操作上。** preparer 先跑实时抓取（`:570`），随后的 `invalid_input` / 拒绝 / `input_too_large` 全被映射成 422 → `unsupported` → 渲染那句话。而且 `geo-kb-v3-review.test.tsx:541` 把相反的命题写成了自己的前提，且所有 `unsupported` fixture 都是手写的 `fetch` 行——**没有任何测试把一个 model 操作驱动到 422**。
4. **创建路由没有 `frozen` 守卫。** 阻止在**遗留已发布版本**之上创建 v3 草稿的，只有一个客户端 `if`。陈旧标签页或重放请求就能绕过，而 `kb-editor-loader.ts:184` 会把那个状态变成该知识库的永久 503，客户端无从恢复。

#### 复核抓到的终局状态：一个正常的 Profile 就能走进去

`categories` **不在** `REQUIRED_PROFILE_FIELDS` 里，所以 Profile 不填品类也能确认。确认 ⇒ GEO 编辑器渲染 ⇒ 起始卡片渲染 ⇒ 按下去**草稿真的建了**，带着 `blockers: ["category_terms_missing"]`，而起始卡片把 `result.draft` 整个丢掉，重载后审阅卡印「草稿已就绪，等你发布」。但计费更新永远构不出输入——`buildGeoKnowledgeSynthesisInputV2` 的 schema 是 `.min(1)`（scratchpad 实测抛 `Too small`）。**而且回不去**：没有 relock 客户端，原本能用的 v2 卡片对这个知识库也永远消失了。文案两个语种都早就存在，v1 卡片也早就在渲染这个 blocker——**没有任何东西拦着起始卡片去读它**。

#### 又一条「删掉全绿」

把起始卡片的 `statusText={copy.status.none}` 改成 `copy.status.draft`，一个什么都没存的知识库会宣布「草稿已就绪，等你发布」——**552 文件 / 10084 条测试全绿**。全仓没有任何测试读那条状态行，两个语种都没有。这个改动存在的全部理由就是不说这句话，而这句话恰恰是自由的。

### 16.1j 第七波：四项必修关掉三项（2026-09-08 深夜，7/7 无失败）

闸门：**tsc 零错；单测 552 文件 / 10167 条全绿；集成 18 文件 / 267 条全绿。**（另记两条环境事实：Postgres 服务端必须 `lc_messages=C`，否则 26 条断言英文错误文本的测试会因为错误的原因全红；`geo-persisted-chain` 只认它自己那个库名。）

**已关闭并逐条追踪验证：**

- **(a) 确认新 Profile 后能自己走出来。** `RecoveryPanel` 渲染「从已确认的档案重建这份草稿」和「放弃这次停住的更新」；`rebuildOnce` 先 relock、只有 relock 确实推动了什么才去清那个被钉住的运行；客户端循环有界（stall 上限 3、最多 400 次调用）所以会走到 `stalled` 而不是空转；拒绝表只对「路由在 `saveDraft` 之前就拒掉」的码才说「什么都没改」。
- **(c) 抓过站之后的 422 不再说「没花钱」。** 现在只有 `unsupported_draft` 映射到 `unsupported`，其余 422 一律 `invalid_output`（计入「未能完成」，不对金额作任何声称）。而且核了顺序：`unsupported_draft` 在 `collectKnowledgeEvidence` **之前**返回，所以那条分支是「诚实但不可达」而不是错的。
- **(d) 创建路由加了 `frozen` 守卫**，对**任何** schema 的已发布版本返回 `published_version_exists`，且在 `readProfile` 之前、任何写入之前。
- **品类缺失那个终局状态也关了。** 审阅卡从它正在渲染的锁定输入里重新推导 blockers，状态变成 `blocked`、文案是「这份草稿还不能更新」而**不是**「草稿已就绪」，计费按钮被禁用，理由列在旁边，relock 落地后列表自动消失。

**未关闭：(b) 账号级 503。** 机制换了，症状没换。审计者用注入依赖探针实测：两个站点，其中一个有 v3 已发布知识库 ⇒ `STATUS 503`，**另一个站点的行一并丢失**。而且 `visibility-context.ts` **完全没改**，`preparation.status` 还是原来五个值，`visibility-handler-deps.ts:48` 把没有提问集的 v3 版本**静默 continue 掉**——三态（可读 / 没有冻结版本 / **这个消费者读不了**）仍然被压成两态，第三态被丢弃。

#### 复核抓到：出口被画成可点，但按下去什么都不发生

这正是我在简报里写明要避免的那种「修法」。`RecoveryPanel` **从来没拿到 `runPhase`**，两个按钮只 `disabled={working}`，而两个处理函数都在 `runPhase !== "idle"` 时 `return`，**且不设置任何状态节点**——按下去没有请求、没有提示。两个可达窗口都实测了：挂载时那次免费 `read` 期间（阻塞草稿上面板已经画出来了，而那是业主唯一能按的按钮，且没有 `AbortSignal` 也没有超时，读挂住就永久可点且永久无效）；以及服务端答 `run_busy` 的续跑循环（`busy` 在 stall 计算**之前**就 `continue` 了，所以永远不累加，退避 3 秒最多 400 次 ≈ **20 分钟**）。

#### 系统性偏差：事后文案钉得住，事前文案没人钉

三条**事前告知**文案（「会丢弃它持有的知识，下一次更新将重新生成并再次付费」等）**每一条换成空字符串，全套测试都是绿的**；而同一组件里的事后结果文案钉得好好的。同一轮里 `gesture` 双击闩锁三处全删也全绿，而它真的承重——去掉 `rebuild()` 那处，一次点击发**两个 `intent:"relock"`**，打在 4 次/小时的桶上。

成因是结构性的：测试天然围绕「做了之后会怎样」写，因为那有返回值可断言；而告知文案的作用发生在**动作之前、在人的脑子里**，闩锁的作用发生在**不该发生的那次点击**上——两者保护的都是「没发生的事」，而测试只覆盖发生了的那次。已记入记忆（`consent-copy-goes-unpinned`）并写进后续复核提示词。

### 16.1k 第八波收口：账号级 503 关闭，第三态在界面上真的存在了（2026-09-08 晚）

闸门：**tsc 零错；营销站单测 552 文件 / 10218 条全绿；EN/ZH 叶子各 7175，零单边。**

**先修的是一个把分支打死的问题**：`visibility-context.ts` 把 `frozen` 改成判别联合之后，`ai-visibility-source.tsx` 这个消费者没跟上，`tsc` **26 个错误**（组件 19 + 它的测试 7）。分支当时是编译不过的。修法分四步，其中第三步值得记：把三岔渲染从「否定式三元链」改成**先判可读这条正臂**——`readable === null` 推不出 `unreadable`，TS 在负链里始终认为 `readable` 可能为 null。

#### (b) 账号级 503：关闭

`visibility-context-handler.ts` 现在对两种读不了的已发布版本各给一个**行内状态**而不是整份响应的拒绝：没有提问集 ⇒ `no_question_set`；带提问集但是 v3 载荷 ⇒ `unsupported_payload_version`。循环继续，同账号其他站点的行不再被一起打掉。**有意保留的整份拒绝只剩一处**：v1/v2 载荷旁边配了 v3 context —— 那是错配损坏，不是「这个读取者不会说的版本」，对损坏大声失败值得那个波及面。

第三态因此在契约里真的存在了：`preparation.status` 多了 `frozen_unreadable`，`profileSync` 多了 `unknown`，并且 `visibility-context.ts:75` 用一条不变量把两者钉成一一对应。

#### 界面与文案这一半（本轮补完）

- **两个原因不共用同一个出口。** `no_question_set` 是一次没产出提问的生成，重新发布就会有，指向编辑器是对的；`unsupported_payload_version` 相反——知识库完整正确，**读不了它的是这个面板**，再把人送回编辑器等于指一条改变不了任何东西的路。所以「完善该网站的知识库」这个链接**只对前者渲染**。
- **文案不再说「因此无法在此选用」。** 复核证明这句话对 `unsupported_payload_version` 是**假的**：`visibility-handler-deps.ts:59` 有意**保留**带提问集的 v3 版本，于是它就在下拉里、还是选中值。真正成立的说法是「跑不了、也展示不了」，不是「选不了」。
- **来源面板不再被挡在接缝外。** 那个 `SEAM` 守卫的注释写的是「等那个文件会处理 `frozen.kind` 就把守卫去掉」——现在它会处理了，于是去掉：可读的那一半（当前 Profile、同步行、两个链接）仍然是业主的，读不了的那一半由面板自己那一句说明白。历史报告那条路径**保持不动**，它另有 `historicalSourceUnavailable` 解释。
- **新增 10 个叶子**（两语种各 5）：`frozenUnreadable.{no_question_set,unsupported_payload_version,identity}`、`workbench.frozenUnreadableOption`、`workbench.readiness.frozen_unreadable`、`source.unreadable.{...}`、`source.status.frozen_unreadable`、`source.sync.unknown`。

#### 把守卫去掉才暴露出来的两个缺口

守卫在的时候，那条路径上的组件根本不渲染，于是**它需要的两个键缺了也没人知道**：`source.status.frozen_unreadable` 和 `source.sync.unknown`。后者尤其说明问题——`unknown` 是契约里和「读不了」一一绑定的合法值，**从加进枚举那天起就没有任何语种给过它文案**。

配套的钉法也换了：这一节的三个键，删掉任何一个都会让新加的那条 `labels every part of the state it renders, in both components` 变红（逐条实测），因为它断言的是**渲染文本里不出现 `[missing copy:`**，而不是某一句话出现。断言某句话出现，对「另一个键缺了」是瞎的。

#### 三次删除变异，全部按预期变红

1. 把出口链接改回无条件渲染 ⇒ `does not offer the editor to a version the editor cannot help` 红。
2. 删 `source.status.frozen_unreadable` ⇒ 上述 labels 测试红。
3. 删 `source.unreadable.unsupported_payload_version` ⇒ 同上红。

原先那条 `marks copy that has not landed instead of printing a key path as prose` **已按其自身注释的要求换掉**——它断言的是键没落地时的占位符，键落地之后它证的就是自己的反面了。替换它的是上面两条：一条钉真实 `en.json` 的句子（`copy()` 对不存在的键会抛，所以那是对目录的钉而不是对测试文件自己措辞的钉），一条钉「两个原因的出口不一样」。

### 16.1l 跨模型复核（gpt-6-astra high，2026-09-08 晚）：7 条，其中一条掀出根因

给 codex 划死了边界——只喂本轮那 4 个文件的 450 行 diff 加 10 个新叶子，**不让它自己去找 diff**（上次那样做是全天零发现）。三条线各一个视角：文案真伪 / 测试是否空洞 / 拆守卫放进来了什么。**7 条全部经我复核为真**，第三条线零发现（并独立确认了付费路径的分析）。

#### 最重的一条：我把出口装在了修不了的那条臂上

codex 指出「重新发布一次知识库就会生成一份」是假的。核实下来比它说的还硬：

- `runRef.questionsGenerationId` **只在草稿创建时被写成 `null`**（`kb-v3-draft-create.ts:378`），**全仓没有任何生产代码再写它**（唯二的非 null 赋值都在 `.test.ts` 里）。
- 于是 `kb-v3-publish-handler.ts:106` 的 `resolveQuestionSet` 对每一次发布都走 `generationId === null` ⇒ `{status:"unavailable", reason:"not_attempted"}`。
- 于是**这个部署能发布的每一个 v3 版本都没有提问集**，`visibility-context-handler.ts:70` 的第一条分支恒真。

三个后果，逐条都要写下来：

1. **`unsupported_payload_version` 今天在生产上不可达**。它要求「带提问集的 v3 载荷」，而 v3 版本永远没有提问集，第一条分支先命中。那条臂是为未来写的。
2. **我上一轮的裁决是反的**。我把「完善该网站的知识库」这个链接**保留在 `no_question_set`、撤出 `unsupported_payload_version`**，理由是前者「重新发布就能修」。真相相反：前者是**普遍且永久**的状态、编辑器里做什么都改不了；后者不可达。所以那个链接被放在了唯一会被真人看到、且唯一帮不上忙的地方——**正是这条通知存在的理由所要避免的那件事**。现在两条臂都不给出口，导航仍由下方来源面板承担。
3. **产品级后果**：v3 上线后，**AI 可见性体检对任何 v3 站点都永远给不出测量**。这是 §16.1b A7-4（提问集生成没有 TS 契约、没有生产者）的下游表现。
   **但知识库这一侧的告知链已经是诚实的**，我逐条核实过并且两处都有生产渲染点：`card.sections.measurement.itemsUnavailable`（`geo-kb-card.tsx:177`）在发布**之前**就说「本次更新不会生成提问集，因此 AI 可见性体检无法针对你发布的版本运行」，`card.review.publishNoQuestionSet`（`geo-kb-v3-review.tsx:1421`）在发布卡上再说一次；两个语种措辞一致，工具名也和 `aiVisibility.title`（「AI 可见性体检」）对得上。
   **工程侧的裁决同样已经写在代码里**：`GEO_RUN_KNOWLEDGE_MODEL_SEED`（`kb-run-collect.ts:127-137`）写明 `questions` 是有意不播种的，因为没有执行者能做那一步。所以剩下的**不是诚实性缺口、也不是待办的接线**，是一次**产品决定**：接上提问集生成，还是带着这个已被两处界面如实告知的限制上线。本轮把可见性面板那一侧改成与之一致——在此之前它说的是「重新发布就会生成一份」，和知识库卡片上那句话直接矛盾。

#### 另外两条文案（已修）

- **「审阅资料更新」出现在什么都没比较过的地方**。`ai-visibility-source.tsx:139` 按 `frozen === null` 二选一，于是不可读那条臂拿到了 `source.review`——而 `profileSync` 恰恰是 `unknown`，含义就是「没做过比较」。已加中性的 `source.open`（「打开知识库」）。
- **「展开后可逐项核对各自实际保存的内容」在只剩一个可展开项时仍然照印**。已加 `source.subtitleUnreadable`。

#### 测试线的四条，全部是真的

第 4 条打在我自己刚写的测试上，而且正是空洞形状 **#9**：断言把渲染文本和**组件渲染时用的同一个目录叶子**相比，改了叶子两边一起动。把那句话改回「因此无法在此选用」，测试照绿。现在改成断言那句话**不能与之矛盾的事实**——版本就在下拉里、且是选中值。

第 1 条同样值得记：那条 `it.each` 的「不许印出键路径」断言查的是**带点的**路径，而本应用渲染缺失键用的是 `[missing copy: a/b/c]`——**斜杠**；而且 `copy()` 在 `t.has()` 为假时**根本不调 `t()`**，所以 `intlErrors` 也是空的。删掉 `workbench.readiness.ready` 后整套测试全绿，而选择框里印的是诊断路径。

第 3 条：所有 unreadable fixture 都继承了 `currentProfile: null`，于是「可读的那一半仍然是业主的」这句注释**从来没被断言过**——给渲染条件加一个 `unreadable === null` 就能把真人的档案披露弄没，全绿。

我也接受了它关于「删掉占位符测试丢了一个真保障」的判断：那条测试证的是**键不在时页面显示什么**，替换它的两条跑的都是完整目录。已给 `mount` 加了 `omitPath`（`mergeMessages` 只能加不能删，而「删」正是这个保障要表达的），恢复了那条断言。

#### 五次变异，逐条实测变红

| 变异 | 变红的用例 |
|---|---|
| 给当前档案的渲染条件加 `unreadable === null` | keeps the readable half（两个 reason 各一条） |
| 把 `workbench.readiness.ready` 改名 | prints a state, not a key path, for ready |
| 把「因此无法在此选用」加回不支持版本那句 | does not claim a version cannot be selected… |
| 把「就会生成一份」的承诺加回来 | offers no exit for no_question_set… |
| 把 `copy()` 缺失键那条臂改成 `""` | marks a sentence that is not in the catalogue… |

### 16.1m 四项开放阻断项：两项已闭合、一项修掉、一项决定不修（2026-09-08 晚，8/8 无失败）

四路只读调查各配两个对抗复核者（判「已修复」的按脚本短路，不派复核）。**四个复核者全部驳回了 proposal，但四个都确认了诊断。** 这一节最该记住的是：被驳回的两条里，**药方比病更危险**。

#### 已闭合两项（我另行独立验过，没有只信 agent 的「已修复」）

- **事前文案与双击闩锁**：我把 `recovery.rebuildNote` 清成空串，`geo-kb-v3-review.test.tsx` + `geo-kb-card.test.tsx` **2 条变红**。原记录成立于工作树的更早状态，现在钉住了。调查者另用 scratchpad 的 vitest config + `resolve.alias` 做了完整变异矩阵（仓库零写入），三条同意文案、三处 `gesture` 读取逐个变异都红。**残余缺口**：三个手势共用一个闩锁，而四条测试都只按单个按钮，「共用」这条不变量没被覆盖——是回归路径，不是现存缺陷。
- **发布后变更计数 / 已发布 v3 界面**：`use-geo-kb-v3-editor.ts:470` 的 `baseline` **已经不是挂载时快照**，是 `view.published?.decisions ?? {}` 的逐次渲染派生（我自己读了那 20 行注释与代码）。D2 那句话也改了，现在说的是「本节没有需要裁决的内容，其内容不在此展示」——真话，不再把人指向一个不存在的界面。

#### 费用句：确认为假，已修（C 线）

`tools.geoKnowledgeBase.card.cost` 里那句「其余页面每次更新都会重新读取」/「every other page is read again on each update」**是假的**。机制我逐行核过：`kb-knowledge-evidence.ts:200-202` 里 `existingHome` 为真时 `home = reusedHome ?? null`，而 `reusedEvidence` 全仓零生产调用者 ⇒ `reusedHome` 恒为 undefined ⇒ **`home === null`，那个七链接循环整个不跑**；竞品那半被 `readPage` 开头的 `reusedUrls.has(...)` 挡住，于是第二个竞品页也读不到。仓库自己的 `kb-v2-runtime.test.ts:327-338` 断言的正是这个（热路径只剩三个机器文件）。

**更糟的是那句假话是被测试强制要求的**：`geo-kb-card.test.tsx` 的 `COST_REQUIRED` 把它列为必需，于是**任何真实的改写都会在那里失败**。这是「钉子把谎钉住了」的实例。

两个复核者都驳回了调查者提议的替换文案，理由各自成立且不同——一个指出「全部能复用时一个页面都不会再读」对当天第一次更新是假的（本次更新自己的 ledger fetch 刚刚读过），另一个指出 21 次那条路径不是「ordinary」。**采纳的是三段式口径**：每次必读三个机器文件；除此之外读自家首页 + 每个已确认竞品首页（≤5），有一天内结果就复用；一条都用不上时才退回到最多八页 + 每竞品两页的抓取。EN/ZH 都重写，`COST_LINE` / `COST_REQUIRED` 同步，并把那句假话加进 `COST_FORBIDDEN`——**粘贴目录新值这个「常见修法」绕不过去**。

三次变异逐条变红：加回那句假话；删掉「同一天第二次只重读三个文件」；删掉竞品上限（这条同时打红了行为级的 `reads no more on the cold path than the card's price sentence names`，说明冷路径上限仍与真实请求数绑定，不只是措辞）。

#### 恢复出口 / busy 窗口：诊断为真，**决定不修**（A 线）

原阻断项确实已闭合：`recoveryHold`（`:1089-1093`）已经传进 `RecoveryPanel`，按钮是 `disabled={held}` 而不是 `disabled={working}`，每个被禁用的按钮都带一句说明为什么，挂载时那次免费 `read` 有了 15 s 上限（`GEO_KB_RUN_CHECK_MS`）。调查者做了四次变异实证这些是承重的。

它转而报的新缺陷——busy 退避期间卡片说「更新中…」而面板其实拥有一句真话（`run.blocked`）却到不了——**复核把严重性和药方都推翻了**：

1. **busy 退避本身就是自动恢复机制。** 租约 6 分钟，`kb-run-advance.ts:232-240` 在 `finally` 里**每条路径**都释放（包括抛异常那条），只有进程死掉才会留着不放——而那正是要保护「可能还在飞的请求」的场景。租约过期后循环下一次调用直接认领并继续。提议的 `GEO_KB_RUN_BUSY_LIMIT = 10`（≈27 秒）会在运行重新可认领**之前 5 分半**掐掉循环，**把自动恢复删掉**，换成一个必须人来按的按钮。
2. **提议的测试跑的是一个不存在的响应形状。** advance 路由在 `kb-run-handler.ts:180-181` 走 `privateJson({ data: ... }, 409)`，**没有 `error` 字段**；fixture 里的 `409 {error:{code:"run_busy"}}` 是 `abandon` 分支（`:141-151`）的形状。测试之所以还是绿的，是因为它从 `data` 读 status——**为生产从不发送的形状而绿**。
3. **「什么都没在更新」这句话本身过头了。** 迁移 `20260907170000_geo_kb_runs.sql:370` 的注释说的是相反的：活租约意味着有执行者可能正在请求中。真正「没在更新」的只有陈旧租约那一种，而那一种恰恰会自愈。
4. 提议的 edit 5/8 还会让**一次正常的瞬时 busy**（`geo-kb-run-continue.test.ts:141-161` 就是这个用例）把实时状态行翻成「请稍后再试」——在标签页自己已经在重试的时候叫人去手动重试。

我又自己核了两件事：`RunPanel` 的 `status` 是**先看 phase** 的（`:658-666`），所以那个从不清空的 `runView` 今天**根本到不了屏幕**——它是提议的改法会激活的潜在 bug，不是现存 bug；以及上面那条 `finally` 释放。

**已按复核者给的正确方向改掉，没有采纳原方案。** 三条约束全部守住：

- **循环时长一个字没动。** 没有 busy 上限、没有新的提前返回。改的只有那句话说什么。租约到期后自己认领继续这条自愈路径完好。
- **持续 busy 才发声。** 新常量 `GEO_KB_RUN_BUSY_VOICE = 5`（在循环自己的退避下约 15 秒）。连续 busy 达到这个数，`RunPanel` 的状态行才让 view 越过 phase，显示面板本来就有的 `run.blocked`；一次普通的交接（`geo-kb-run-continue.test.ts:141-161` 那个用例）**永远够不到**。
- **计数是「还在发生的拒绝」而不是「发生过的拒绝」。** 任何非 busy 的答复把连击清零，起新 drive 也清零。

三次删除变异逐条实测变红：把 phase 优先改回去；把阈值降成 1（那条「一次 busy 不算被挡住」立刻红）；让连击永不清零（要一条**单次 drive 内** busy×4 → running → busy 的用例才抓得到——第一版测试没抓到，因为按第二次「继续」时的整体清零把它盖住了，补了这条才真）。

`recoveryHold` **有意没动**：按钮被禁用的理由仍是「正在驱动」，那是真的——标签页确实还在驱动，被拒绝的是服务端。把运行状态那句话搬进禁用理由是复核者明确反对的，两处会显示同一句话，而 hold 那个 span 的注释本来就写着它不是 `role="status"`，因为上面的运行面板已经在实时播报同一件事。

另外一处诚实标注：`driveOnce` 开头那句 `setRunView(null)` 是**防御性的、且当前观察不到**（连击清零后 phase 又重新优先了），注释里写明了这一点，没有为它编一条不会失败的测试。

## 17. 落地后对抗式审计（2026-09-07 晚）

对已落地的 v3 代码做了一轮八维度对抗式审计。**第一轮的结论不能直接用**：123 个 agent 里 90 个撞上会话限额，而那套 workflow 的判真规则是「三个验证者里至少两个没能驳倒」——agent 崩掉返回 null 被 `filter(Boolean)` 丢掉，票数不够，findings 就掉进了 `refuted` 桶。那 35 条里有两条是 `confirmed` 里同一缺陷的重复发现，还有一整簇 SQL 发布链缺陷是我自己读代码复核为真的（见 15.4）。**「没人反驳成功」和「没人来反驳」在结果结构上长得一模一样，而后者被写成了前者。**

限额恢复后按「未验证清单」重跑：每条两个视角独立复核（一个专找反证，一个查可达性与后果），再由第三个 agent 亲自读代码裁决。75/75 完成，0 失败，0 未裁决。

### 17.1 判定为真（14 条）

| # | 级别 | 位置 | 结论 | 归属 |
|---|---|---|---|---|
| #12 | P1 | `apps/marketing/src/lib/geo-tools/kb-generation-preparer.ts:356-367` | For kind "knowledge_pack", prepare runs the full live evidence crawl (up to 18 fetches, 70s deadline, crawl-gate quota) before any idempotency claim, and folds collection wall-clock (evidence.collectedAt via ev… | 付费调用组 |
| #11 | P2 | `apps/marketing/src/components/tools/geo-knowledge-pack-v2.tsx:233-234` | geo-knowledge-pack-v2.tsx:234 renders the raw dotted entity field path (`definitions.w25`, `categories.primary`, `links.pricing`, ...) as visible UI text with no i18n lookup, producing byte-identical untranslat… | 字面量组 |
| #18 | P2 | `apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:342` | The v3 review contract types an entity correction's value as free text (kb-v3-contract.ts:343, `value: geoShortText`) while `founded.year` is typed `geoYear` = /^\d{4}$/ (kb-knowledge-shape.ts:65,219), so a cor… | 契约组 |
| #21 | P2 | `apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:516-530` | `assertEvidenceChecks` audits only the text `geoV3Items` puts in each item's `claims` list, and that list omits four fields the pack publishes — `qa.question`, `qa.variants`, `qa.canonicalQuestion` and `fact.la… | 契约组 |
| #24 | P2 | `apps/marketing/src/lib/geo-tools/kb-knowledge-shape.ts:414-417,` | `geoNumericLiterals` (apps/marketing/src/lib/geo-tools/kb-knowledge-shape.ts:483-485, regex on :484) only treats `[$€£¥]` as part of a numeric literal and never NFKC-normalizes, so every other currency — ₩, ₹, … | 字面量组 |
| #4 | P3 | `apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v2-contract.ts:130-140` | In apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v2-contract.ts the `return` at line 136 makes an unavailable fact (`value === null`) skip `refineProvenance` entirely, so the published-pack contract accept… | 字面量组 |
| #5 | P3 | `apps/marketing/src/lib/geo-tools/kb-v3-contract.test.ts:95-108` | The test named for the review budget (apps/marketing/src/lib/geo-tools/kb-v3-contract.test.ts:95-108) proves nothing about it — its 400 decisions all carry itemKey FACT_KEY_PRO, so payloadSchema.parse (kb-v3-co… | 契约组（追加） |
| #6 | P3 | `apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:338` | The facts arm of `geoOverrideSchema` (apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:338) lists `"conflicting"` as an allowed `reason`, but the union's own superRefine at :346 always calls `refineGeoFactCon… | 契约组 |
| #13 | P3 | `apps/marketing/src/lib/geo-tools/kb-offsite-serp.ts:358-371` | On a thrown SERP call, kb-offsite-serp.ts:362-367 pushes `{status:"unavailable", reason:"fetch_failed"}` and `continue`s before line 368-369, so a dispatch the provider may have billed increments neither `costU… | 付费调用组 |
| #16 | P3 | `apps/marketing/src/lib/geo-tools/kb-offsite-collect.ts:276-284` | The landing-page loop in kb-offsite-collect.ts (lines 316-325, not the cited 276-284) guards only on `remaining <= 0`, so the last candidate before the wall clock expires is admitted with a timeout as small as … | 未派工 |
| #22 | P3 | `apps/marketing/src/lib/geo-tools/snapshot-context-v3.ts:118-120,` | The v3 snapshot context's `sourceSummary` is computed from the draft knowledge body alone and therefore counts items the owner excluded or suppressed, while its doc comment at apps/marketing/src/lib/geo-tools/s… | 契约组 |
| #33 | P3 | `apps/marketing/src/lib/geo-tools/kb-generation.ts:62-71,` | The `rejection` diagnostic token is produced and threaded through three layers (kb-role-proposal.ts:46,48 -> kb-generation-preparer.ts:69-71,83,93 -> kb-generation.ts:71,89,136,144,165) but no production code r… | 付费调用组 |
| #34 | P3 | `apps/marketing/src/lib/geo-tools/kb-run-plan.ts:69-71` | `geoRunActionSpends` (apps/marketing/src/lib/geo-tools/kb-run-plan.ts:69-71) has no production importer — the only references outside its definition are three in its own test — while the invariant it encodes ("… | 未派工（kb-run-plan.ts 在别人手上） |
| #35 | P3 | `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-v2-contract.ts:526-528` | `geoKnowledgeNarrativeV2Digest` (apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-v2-contract.ts:526-528) is an exported three-line passthrough with zero callers anywhere in the repo — no production code… | 未派工 |

### 17.1b 已处理

- **#35 已删**：`geoKnowledgeNarrativeV2Digest` 全仓零引用（生产、测试、构建产物皆无），删除后 58/58 仍绿、typecheck 干净。它存在的原因值得记一笔——它是 `kb-knowledge-synthesis-contract.ts:133` 那个**同样没人调用**的 v1 函数的忠实移植。**照抄一份契约时，死代码是会跟着一起被抄过来的**，而且移植过来的那份看起来比原件更像「新写的、大概有用」。v1 那个双胞胎本轮不动（属于冻结的 legacy 契约，超出本轮范围），但下次动它时应一并删。

### 17.1c 付费调用组与契约组交回（2026-09-07 20:0x–20:1x）

#### 付费调用组：#12 只修了一半，另一半要动迁移

- **#12 顺序已修**：`handleGeoKbGeneration` 现在**在 `prepare` 之前**读幂等键，且只对 `kind === "knowledge_pack"` 这么做（`kb-generation-handler.ts:72-107`）。命中既有 generation 直接 `reused: true` 返回，那趟抓取不再发生。roles/questions 刻意保留原路径：它们的输入是已存草稿的纯函数，短路会跳过 `prepare` 里的草稿陈旧检查（mutation M6 证明那道门是真的）。
- **⚠️ #12 的时钟没修，而且不能靠改代码修。** `geoGenerationInputHash` 对 `{kind, input}` 整体求哈希，所以**哈希域就是那份持久化输入**，其形状被 `marketing_geo_knowledge_input_valid`（7 键 / 12 键 synthesis input）和 `marketing_geo_claim_generation` 的 SQL 再推导同时钉死——改它必须配一个迁移。而且不止一个时钟：`evidence.collectedAt`（经 `evidenceContentHash`）、以及 `sourceCatalogue[].observedAt` 每资源一个（被 `sourceCatalogueHash` 和 synthesis input 的 `contentHash` 各digest 一次），共三处。把它们归一化会**伪造证据**：`assertEvidenceIntegrity` 要求 `observedAt <= collectedAt`，`buildGeoKnowledgeGenerationResultV1` 要求 `generatedAt >= collectedAt`。他们落了一个 characterization test，把「需要迁移」写在注释里，并明确**没有**把它当成护栏、也没给它 mutation 条目。
- **仍然敞着的口子（说清楚）**：同键两个请求在任一方 claim 之前同时到达，仍然都会抓取；第二个标签页铸一个新键，仍然会抓取、并且**再付一次 LLM 的钱**。两者都要那个哈希修复才能关上。**迁移是我的活**（manifest v3 + 一个新的 CHECK 分支 + `parseGeoPreparedCandidateV2`），本轮未做。
- **#33 已接通**，但接的过程里发现那个字段的文档注释是**假的**：注释写「绝不含模型文本、绝不含用户数据」，而旧的 `message.slice(0, 120)` 兜底会把一条引用了模型自己发明的键名的严格 schema 错误原样倒出来。已收紧 `rejectionOf`（`kb-generation-preparer.ts:63-88`）：保留具名 `(check:path)` token，保留我们自己代码写的消息全文，其余一律降为 `unknown`。
- **#13 已修**：`GeoOffsiteSerpReading` 增 `unpricedQueries`，catch 分支自增并向成本日志写 `cost_usd=unknown`（`onCost` 放宽为 `number | null`）。**是计数，不是金额估算。**
- **收集器接缝已由我接上**：`GeoOffsiteCollection.spent` 增 `unpricedSerpQueries`（`kb-offsite-collect.ts:161,392` + fixture）。`spent.costUsd` 是全仓唯一能读到这趟花费的地方且**目前无人消费**，在此之前它把一个下限渲染成了总额。48/48 绿，tsc 干净。

#### 契约组：四条全closed，但都比原报告宽

- **#22 改的是文档不是数字**：计数留在草稿侧。理由比判决书更硬——**「数published的」根本不可能靠过滤得到**：被修正的条目以 `declared_owner` 发布（`kb-knowledge-pack-v3.ts:188`），而 summary schema **有意**没有 `declared_owner` 桶（它自己第二句就这么写）。所以那个文档块的两句话本来就自相矛盾，且**准确的那句早就写在那儿了**。要让它表示「已发布」需要新桶 + `GEO_SNAPSHOT_CONTEXT_SCHEMA_V3` bump，而且会重复已经无损冻结在旁边的信息（每个 pack item 自带 `origin` 和 `decision`）。**纯度不是理由**（`review` 属于 `payload`，review-aware 的 summary 依然是纯函数）——我的简报暗示纯度可能否决它，是错的。
- **#21 比报告多抓三个字段**：原报告点名四个，实际还有 `fact.subject` / `fact.attribute` / `fact.qualifiers` 也被 pack 发布却两层都不检查。现在 `kb-v3-contract.test.ts` 断言 `[...CLAIM_FIELDS, ...UNCLAIMED_FIELDS].sort()` 等于 `Object.keys(shape).sort()`，**新字段进不了 pack 除非有人给它归类**。
- **`comparison row.dimension` 有意留空，理由写在测试文件里**：`product` 和 `competitor` 双 null 的行今天一条 claim 都没有；把 `dimension` 追加进去会让它变成 `claims[0]`，而 `kb-knowledge-merge.ts:243` 把 `claims[0].text` 当人读的摘要写进冲突时的 `alternateObservations`——一个维度标签会伪装成一条观察。pack 仍会拒这种行，只是拒在发布时。要根治得给 `GeoV3Item` 加显式 `summary` 字段并改 merge。
- **#18 是双向的**：判决书说「那里封 200 是安全的」——**错，那是同一个缺陷翻个面**。11 条可修正路径里 8 条是 `geoText`(800)，业主重写一段 120 词的定义、audience 行、`founded.team/location` 或 `disambiguation` 都会被切在 200 并吃一个不透明的 400。同类问题隔壁还有一处：Q&A override 的 `expansion` 是 `geoText`(800) 而发布字段是 `geoBoundedText(2_400)`，于是**任何 expansion 较长的 Q&A 根本无法修正**（面板会原样带回既有 expansion）。都已改。
- **#6 已删**：override 的 fact `reason` 枚举里去掉 `"conflicting"`，并注明为什么 override 永远不可能合法地是 conflicting。

#### 契约组交回、等我接线的两项

1. `geo-kb-v3-review.tsx`：entity 草稿在 `geoEntityCorrectionIssue(draft.field, draft.value) !== null` 时 `overrideOf()` 返回 `null`（Save 已经是 `disabled={override === null}`），理由**以真实元素 + `aria-describedby` 内联渲染，不用 tooltip**（照 §15.5）。导出已备好：`geoEntityCorrectionRule(field)`、`geoEntityCorrectionIssue(field, value)`。
2. 两个 i18n 键（`tools.geoKnowledgeBase.card.review`）：`correctionYear`、`correctionPlainText`（后者带 `{max}`，措辞要同时覆盖超长与不可打印字符两种拒绝方式——只说「太长」对粘进控制字符的情况是错的）。

> ✅ **已派工**（字面量组收工后）：连同 A3 的运行循环接线一起交给界面组。当时挂起的理由记在这里因为它是个可复用的判断——它的 #11 也在改 pack UI，而 i18n 目录我已经因为整文件重排被咬过一次（见 §15.3）；**两个 agent 同时改同一份 catalogue 不值得赌，宁可串行**。

#### 字面量组：#24 / #11 / #4

- **#24 的真实规模是七份拷贝，不是一处**：同一条正则散在两个家族的七个文件里（其中四个是**已发布的 tracked 文件**）。**七份全都字节一致——但那是运气，没有任何东西在维持它们相等。** 现在只剩一份实现（`geoLiteralTokens` / `geoLiteralsSupported` / `geoLiteralsAllSupported`），`geoNumericLiterals` 已不存在。搜法值得记：除了搜函数名，还按**正则形状**搜（不依赖币种清单）、并对**所有文件类型**搜 `€£¥`（这才捞出 `geo-tools` 之外的两个文件）。
- **设计选择**：`\p{Sc}` 而不是更长的清单——护栏不能取决于谁记得敲哪个符号。NFKC 只在**比较时对副本**施加，任何东西都不写回，存下的摘录保留页面实际发出的字节。代价写清楚了：`½`→`1⁄2`、`²`→`2`，于是 `"2²"` 现在切成 `22`；两侧同样归一化，所以只是略微放宽了「相等」。
- **⚠️ 判决书给的「符号为 null 就放行」是个洞，已否决。** 两条独立证伪：(1) 它**立刻**弄红一条已发布的测试——`"3 seats are available."` 这条事实不得由 `"$3 seats are available."` 的摘录支撑；(2) 改成单向之后剩下的那半仍是洞，且被新写的测试当场抓到：`"It supports teams of 2"` 被当成 `"₩2 per team"` 的证据，`"$19 per month"` 被当成 `"₹19 per month"` 的证据。**声明不得发明页面从未展示过的单位。** 落地规则是严格的：`core` 相等**且** `symbol` 相等，含 `null`。这相对生产**不是收紧**——`$ € £ ¥` 本来就这么行为，四符号清单才是 ₩ 和 ₹ 行为不同的唯一原因。代价是假阴（条目被丢弃或 `not_applicable`），**永远不会是发布出去的假话**。
- **仍然够不到的**（已对真函数探测过，写进代码注释）：`R$9,900` / `US$19` 因为前缀是字母而按 `$` 切；`₨100` 被 NFKC 拆成字母 `Rs` 因而**回来时无符号**；后缀词单位（`9,900원`、`9,900 円`、`9,900 USD`）对符号型分词器不可见。正确修法是**教分词器认后缀单位，而不是把符号比较放松回去**。
- **#11 的结论和报告相反**：i18n 目录**本来就是完整的**——`GEO_ENTITY_FIELD_PATHS` 的 20 条路径两个语种全都有词条，一个 key 都不用加。缺的是渲染层没去查。验证方式值得记：**通过 `useGeoKbCopy` 做运行时探测，而不是读 JSON**——next-intl 对缺失 key 是渲染 key 本身而不是抛错，所以读 JSON 或断言「字符串出现在页面上」都证明不了什么。完备性断言写成：每条路径解析出的 label 非空、不含 `entityFields`（key 回显的特征）、不等于路径本身、**且 en 与 zh 不同**——最后一条才是修复前无法满足的那条。
- **#4 已修**：`refineProvenance` 增加默认 `requireSource = true`，`factSchema` 的 `value === null` 分支改为 `refineProvenance(fact, ctx, false)` 而不是直接 return。「不可用事实无需来源」这条豁免保留并有测试，**其余被那个 return 一并跳过的检查全部恢复**。
- **已另开任务**：`packages/artifacts/src/llm/reference-check.ts:34,40` 与 `finding-summary-client.ts:307` 带着同一类四符号缺陷，但属于另一个子系统、正则结构不同、消费者不同——不照抄，单开一轮。

#### 两位 agent 对我的简报的更正（记下来免得再犯）

- 我在简报里写「tsc 基线带着既有报错」——**错了**，他们的基线上 tsc 是干净的。我把飞行中其它 agent 的瞬时状态当成了基线。
- 我曾告诉 Owner「Brief 从 24 条既得事实收窄到 8 条」——**错了**，24 是 v2 payload 上限，8 是 v2 路径的一个证据来源切片，v3 真实上限是 64，Brief 是**放宽**。（已在 §15 更正，此处再记一次因为这是同一类错误：拿一个数字去解释另一个域的口径。）

### 17.2 判定不成立，**不要再报**（11 条）

这些不是「暂不处理」，是**复核后认定命题本身不成立**。理由逐条留全，因为「为什么不是 bug」正是下一轮审计会重新推导一遍的东西。

**#1 — apps/marketing/src/lib/geo-tools/kb-offsite-verification.ts:430-449 (with kb-offsite-serp.ts:104, 126-134 and kb-offsite-collect.ts:202-205)**

> 原命题：`ownerSubmittable` — the venue table's own record that the subject may write or edit a listing — is never read by the independence judgement, so a vendor-claimed directory profile publishes as "Independent".

`ownerSubmittable` is genuinely read by nothing (declared at kb-offsite-serp.ts:104, set on ~40 table rows, consumed nowhere), but that is a documented, spec-conformant decision rather than a missing guard, and it does not cause a vendor-claimed profile to publish as "Independent": the venue property is a capability ("the subject *can* claim or edit this record"), the table comment at kb-offsite-serp.ts:96-101 names `ownerPublished` as "the one venue property the independence judgement is allowed to consume", the design spec (docs/plans/2026-09-07-geo-kb-redesign-design.md:87-89) defines independence with no venue-capability term at all, and the vendor-claimed case is guarded at page level by GEO_OFFSITE_OWNER_SUBMITTED_MARKERS ("claimed by the owner", "claimed by the vendor", "profile claimed by", "official account of", "由品牌方提交", "官方账号") checked at kb-offsite-verification.ts:438 ahead of the overlap measurement, plus the syndication gate (:445), the "no identity distinct from the brand -> undetermined" gate (:447) and the "overlap not measurable -> undetermined" gate (:448).

**#2 — apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v3.ts:323-332**

> 原命题：`factsModule` overwrites an existing `partial` limitation when it stamps the model-failure sentence, silently dropping whatever disclosure the facts module already carried.

`factsModule` at apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v3.ts:408 does structurally replace rather than merge an existing `partial` limitation, but no draft can hold the required state — facts=`partial` implies a non-null narrative, and a non-null narrative guarantees the `scope` module is `available` (scopeSchema refines "Scope cannot be empty"), so the `MODEL_MODULES.every(unavailable)` gate at line 403 always returns first with the original limitation intact.

**#8 — apps/marketing/src/lib/geo-tools/kb-first-party-proof.ts:311-317 (producer); rejected at apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v2-contract.ts:361-363 and 397-405**

> 原命题：First-party proof observations put machine-computed element counts into an evidence summary, and the pack contract's numeric-literal check then rejects the publish.

The producer does inject machine-computed counts that no cited excerpt contains, but the stated consequence is wrong: such a row never reaches the pack contract, because the sole path into a v3 knowledge body (geoEvidenceModule's `keep`, kb-knowledge-assemble-observed.ts:310-336) applies the identical `geoLiteralsSupported` predicate over the identical excerpt union and silently drops the item as `literals_unsupported` — so no publish is rejected; the only residual (much smaller, and in code with no non-test callers) issue is that `first_party_data_candidate` is self-defeating and vanishes behind an anonymous "N collected item(s) could not be shown with their evidence" line.

**#9 — apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-v2-prompts.ts:145 (schema offered to the model); rejected at apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:224-241 and 296-302**

> 原命题：Synthesis narrative v2 and its model JSON schema admit `reason: "conflicting"`, which the v3 draft contract rejects because `conflicting` requires alternates the model cannot supply.

The two halves of the claim are individually true but never meet: the v2 model schema does offer `reason: "conflicting"` (kb-knowledge-synthesis-v2-prompts.ts:145) and the v3 contract does refuse a conflicting fact without alternates (kb-v3-contract.ts:235-238, not :296-302 which is the unrelated evidence-collected check) — but the sole bridge between them, `factsModule` in kb-knowledge-assemble.ts:189-195, unconditionally drops any model-declared conflicting fact first with a `generated_conflict` accounting entry, writing every surviving fact with `alternateObservations: []`, so the rejection the claim describes cannot occur; `conflicting` is reserved for the merge, which sets `alternateObservations` and `reason = "conflicting"` in the same block (kb-knowledge-merge.ts:253-259).

**#10 — apps/marketing/src/lib/geo-tools/kb-v3.test-fixtures.ts:165-168 (fixture); enforced only at apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v2-contract.ts:378-393**

> 原命题：The machine-module source-kind rule exists only in the published pack, not in the v3 draft contract, so the session's own `completePayloadV3()` parses in one layer and would fail the other.

The machine-module source-kind rule is enforced in BOTH layers, so there is no parse asymmetry: the v3 draft contract checks it in assertMachineSourceKinds (apps/marketing/src/lib/geo-tools/kb-v3-contract.ts:620-631, called unconditionally from parseGeoKbPayloadV3 at line 650) using the shared GEO_MACHINE_SOURCE_KINDS table (apps/marketing/src/lib/geo-tools/kb-knowledge-shape.ts:404-412), and the published pack checks the same rule at apps/marketing/src/lib/geo-tools/kb-knowledge-pack-v2-contract.ts:379-395; the two tables are value-for-value identical and completePayloadV3() satisfies both.

**#14 — apps/marketing/src/lib/geo-tools/kb-evidence-reuse.ts:63-64, 95-97, 151-156**

> 原命题：planGeoEvidenceReuse promises one crawl-gate admission per target, but its gate key merges apex with www while the only reader that opens the gate does not.

Not a defect: `geoEvidenceGateKey` (apps/marketing/src/lib/geo-tools/kb-evidence-reuse.ts:95-97) is a re-export of `canonicalCrawlTargetKey`, which is the very function the crawl gate uses to spend its per-target budget (apps/marketing/src/lib/tools/crawl-gate.ts:101 -> :176 `crawlTargetBucket(targetKey)`), so the plan's apex/www merge matches what the gate charges; and the "reader that opens the gate" named by the claim (`createGeoKnowledgeResourceReader`, apps/marketing/src/lib/geo-tools/kb-enrichment-deps.ts:101-108, which memoizes by exact `new URL(url).host`) never reads the plan — the inconsistency, if it ever surfaces, is on the reader's side, not the plan's.

**#15 — apps/marketing/src/lib/geo-tools/kb-run-plan.ts:58-65**

> 原命题：failed_retryable is restarted on every invocation with no attempt cap and no backoff, while the sibling unresolved state has GEO_RUN_PROBE_LIMIT.

The code reading is exact — kb-run-plan.ts:60-62 returns "start" for failed_retryable with no attempt counter and no backoff, while outcome_unknown is capped by GEO_RUN_PROBE_LIMIT=3 — but it is not the defect claimed: the two constants are not comparable (probe does not spend, and failed_retryable is by contract a response we saw and were not billed for, DB-enforced as writable only by finishOperation from `dispatched`, migration :196-198), one invocation advances at most one operation, the browser driver halts after GEO_KB_RUN_STALL_LIMIT=3 no-progress calls (~4 attempts total), and the behaviour matches the frozen design at docs/plans/2026-09-07-geo-kb-redesign-design.md:217.

**#19 — apps/marketing/src/lib/geo-tools/kb-knowledge-merge.ts:335, 355-363 (with kb-v3-review.ts:271-278)**

> 原命题：The "has a new observation" state is not durable: the merge compares the previous draft against the new one instead of against the decision's baseContentHash.

The claim's factual observation is right but its conclusion is wrong: kb-knowledge-merge.ts:365 does compare the previous draft's item hash to the new draft's, but that only labels the entry in the returned per-run `outcomes` report; the durable "has a new observation" signal is the owner decision's stale `baseContentHash`, which the merge pushes verbatim at :360 (before that comparison) and re-stamps only for revived suppressions at :412-415, so the mismatch persists across every later merge until the owner re-decides.

**#20 — apps/marketing/src/lib/geo-tools/kb-item-content.ts:33 (vs kb-v3-item-content.ts:26)**

> 原命题：Two incompatible digests both write the same `baseContentHash` field, so two records in one decisions[] array are hashes of different things.

The claim's premise is false: apps/marketing/src/lib/geo-tools/kb-item-content.ts does not exist (and never did — no git history for it), and there is exactly one producer of item content digests in the repo, geoV3ItemContentHashes at kb-v3-item-content.ts:26, through which every production write of baseContentHash routes, so there are no two incompatible digests competing over that field.

**#23 — apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-v2-contract.ts:61, 369-372, 375-379; gates at 423, 430, 448, 453, 486, 511-516**

> 原命题：The competitor-evidence and proper-name-evidence gates in the v2 synthesis contract are built on Latin word boundaries, so they never fire on Chinese/Japanese text.

The claim is wrong on mechanism and dead on reachability: the competitor gate (kb-knowledge-synthesis-v2-contract.ts:370-372) is a script-neutral Unicode separator rule, not a Latin word boundary, and it does fire on CJK names flanked by spaces or punctuation (verified: mentions("Compared to 阿里云, we are cheaper.") === true, mentions("当社は アリババクラウド より安い") === true); only PROPER_SUBJECT_CLAIM (:61) is genuinely English-only (ASCII [A-Z] plus an English verb list, so "楽天 provides free shipping." yields []), and it is a narrow sentence-initial heuristic that is already blind to mid-sentence proper names in English, sitting beside script-independent bindings (source-id existence :509, own_page/accepted_fact requirement :518, verbatim numeric literals :519-521, two-sided comparison evidence :473-480) that carry the actual guarantee.

**#25 — apps/marketing/src/lib/geo-tools/kb-item-identity.ts:55-63, 66-69, 77-87**

> 原命题：geoItemSimilarity tokenises by splitting on whitespace, so the "is this the same item?" prompt required by design section 4.4 never fires for Japanese, Thai or Khmer.

The whitespace tokenisation is real, but the claim is false as stated: Khmer's normal U+200B word separator is \p{C} and is folded to a space, so Khmer tokenises exactly like English (0.500 on a 3-token one-word drift, 0.750 on 7 phrases); and for Japanese/Thai/Chinese the prompt is not dead — punctuation-only drift, the case the module's own docstring (kb-item-identity.ts:29-33) names as the prompt's purpose, mints a new identity key yet scores 1.000 and fires. Design §4.4 prescribes only "token Jaccard over normalised text, used only to prompt, never to inherit a decision" (design doc line 194), specifies no word segmentation, so nothing "required by 4.4" is missing; and the residual under-reporting is a documented, tested property of low token counts, not a language gap — English one-word drift at 4 tokens scores 0.600, likewise below the 0.75 threshold, asserted deliberately at kb-item-identity.test.ts:69-74.


## 18. 五项开放裁决的调查结论（2026-09-07 深夜，只读）

在第二波实现跑的同时派了五路**严格只读**调查，各配一个挑战者。**⚠️ 只有 D11 的挑战者活了下来（其余四个撞会话限额），所以下面五条里有四条是「单一 agent 的未经复核建议」。** 这个区别很重要：唯一跑完的那个挑战者，在一份「引用全部精确、两个 bug 都真、结论成立」的报告里仍然找出三处错误，**其中一处照做会导致线上事故**。因此下面凡标「未复核」的，不得当成已定案。

### 18.1 D11 `nextReviewAt`（✅ 已复核）

调查结论：D11 的前提「一个没人读的字段」**是假的**——它在两个语种里都渲染在条目来源行上。但 R8 承诺的机制（到期提示 → 「published + 可更新」）**在仓库里不存在**。所以它是标签上的一个日期，不是一道保障。建议：保留 + 修两个 bug + 改文案，不要删、不要改成业主自填。

挑战者的三处更正，按危害排：

1. **⚠️ 那条「收紧不变量」跑在读路径上，而报告声称「无需迁移、不阻塞任何东西」。** `parseGeoKnowledgePackV2` 与构造器共用同一个 `assertPackIntegrity`，而它在 `kb-prepared-v3-contract.ts:106` 被用于**已存储的数据**；`readCompleteGeoV3` 整个包在 `kb-complete-read.ts:54` 的 `try` 里，`catch` 返回 `unavailable()`。于是**已经存进去的、带任何「已修正事实」的包会整版静默变暗**，连校验错误都看不到。「存储的 jsonb 形状不变」这句话为真但不相干——**变的是被接受的集合，而这个仓库在读的时候会重新校验**。正确次序是先修生产者，再确认零受影响行或在读侧归一化。
2. 报告说 90 天「没有任何东西证成」——措辞可辩护，但它漏了设计稿 `:296` 的 D11 行本身：**90 是本文档自己已采纳的决定**，代码符合它。所以是「已规定但未证成」，不是「无据可查」。
3. 「R8 承诺的机制在仓库里不存在」**说过头了**：`visibility-context.ts:29` 的 `profile_update_available` 就是「档案改了」那条臂，只有「`nextReviewAt` 到期」那条没建。这降低了建提示的成本——已有可挂载的面。

**我的裁决**：保留 90 天，先修那两个 bug（`publishFact` 把 `nextReviewAt` 留在 `observedAt: null` 的已修正事实上；UI 半边同理），**但收紧不变量那一项按挑战者的次序做**——生产者先修，读路径确认零受影响行之后再收紧，绝不同批。

### 18.2 B3 coverage 槽（⚠️ 未复核）

**调查直接推翻了设计稿**：B3 写的「R9 采集到的意图覆盖骨架」在代码里**根本不存在**——仓库里没有任何 intent→page 覆盖。草稿侧的 `coverage` 和发布侧的是**同一个计算在两个时刻各跑一次**：同一个 key、字节相同的 TS 形状、两份都持久化、**且必然不一致**。

这比原命题更糟也更好：没有语义要仲裁（只有一个语义），但两个值同名同形共存于一行，而这个名字还被许诺给了第三样尚不存在的东西。

**我的裁决（暂定，待复核）**：**合并前删掉草稿侧的槽**，只留发布时重算的那份，并改名成它真正度量的东西（每节完整度），把 `coverage` 这个名字留给 R9。理由是「一名两义」正是本项目反复栽跟头的那一类，而**现在做零版本 bump 零迁移，合并后做就都要**。已让装配桥 agent 不要把依赖钉死在草稿侧的值上。

### 18.3 C11 `snippetsBlocked`（⚠️ 未复核）

确认无生产者，但**推翻了「生产上一直是 not_checked」**——相关文件全是 untracked，`git grep HEAD` 为空，**这东西从没上过线**，是发布前缺口，所以现在补最便宜。

**影响面比 C11 写的大**：`kb-knowledge-assemble-observed.ts:235-238` 的 `complete` 要求 `snippets.status !== "not_checked"`，而它恒为 `not_checked` ⇒ **机器可读模块永远不可能是 `available`**。这不是一个字段没填，是一整个模块被钉死在非可用态。

**我的裁决（暂定）**：本轮补。已把这条连同「不要发明一个值来糊弄过去」一起交给装配桥 agent 作为约束。三态（允许片段／禁止片段／**没检查**）必须各自可表达，不得压成两态。

### 18.4 C10 档案声明事实（⚠️ 未复核）

**建议：不做。** 13 个字段全都需要 Owner 裁决，而且**做了也修不好它声称要修的那个后果**。C10 的诊断（常量不可达）对，但归因错了，因而药方也错：背后是两个各自独立的缺陷，两个都能今天修、都不需要 Owner。

顺带纠正了一处所有权：C10 说 `accepted_fact` 目录行「今天由 `kb-generation-preparer.ts` 拥有」——那是 **v1/v2** 的 preparer；v3 的目录由 `kb-knowledge-assemble-sources.ts:69-86` 拥有，而它**从不铸 `accepted_fact` 行**。v3 路径上没有任何东西会被复用。

**我的裁决（暂定）**：接受「不做」。等挑战者复核那两个「今天就能修」的缺陷是什么，再单独派工。

### 18.5 #12 去重哈希里的时钟（⚠️ 未复核，但论证很硬）

**建议推翻了我给的方案**。我提的是「存一个 clock-free 的 identity digest 在完整输入旁边」。调查指出这不成立，理由是一句我没想到的事实：

> `buildGeoKnowledgeSynthesisV2Prompt` 的 user turn **就是**那份 canonical 输入，逐字节相同（`kb-knowledge-synthesis-v2-prompts.ts:56-63`，注释写明「no hidden additions」）。

所以一个「排除了 `observedAt` 的 identity digest」等于在断言「这个字段不可能影响模型输出」——而**那个字段字面就在模型的输入里**。这正是本仓库证据诚实性规则禁止的那类断言。**唯一站得住的排除方式是不再把它发给模型。**

而且污染面比我说的窄：**全部在 `knowledgeSynthesisInput` 内部，正好四个字段**。manifest 其余六键已经是 clock-free 的；`generationInputHash` 覆盖的 `generationInput` 五键里，`evidenceContentHash` 是 roles 步锁定的**已存草稿值**、`profileRef.subset.fieldProvenance[].observedAt` 是 Profile 作用域的——**两个标签页读的是同一份已存草稿，都不随请求变化**。

**我的裁决（暂定）**：按「让持久化输入本身 clock-free、时钟只留在 result 里」的方向做，不做 side-car digest。仍需迁移，仍是我的活，**且必须等挑战者复核**——这是一条会改动付费路径哈希域的变更，错了要赔钱。

> **这一节最该记住的**：五条里有四条**推翻或实质修正了设计稿/我自己的表述**（B3 的 R9 骨架不存在、C11 从没上过线、C10 归因错误、#12 的方案不成立）。这不是调查做得好，是**设计稿里积压了一批「写下来时是真的、后来被代码走远了」的陈述**。凡是要据此动代码的条目，先只读核一遍成本极低，收益是避免照着一份过期的地图施工。

