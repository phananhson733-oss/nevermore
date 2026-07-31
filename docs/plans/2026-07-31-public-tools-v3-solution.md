# Public Tools v3.1 · P0-1 / P0-3 / P0-5 重设计方案（按证据强度分阶段）

日期：2026-07-31
状态：**v3.1 final draft — 已并入 codex 评审（附录 A，12 条）与架构评审（附录 B，16 条），零拒绝项。Phase 0-A/0-B 完成后即为实施基线。**
取代关系：本方案取代 v2 spec（`2026-07-31-public-tools-p0-1-p0-3-p0-5-spec.md`）的 §5/§6/§7，**并显式修订其 §4（GSC 读取层）与 §12（验收）**——codex 指出 v3.0 声称"只替换 §5–7"会留下两套矛盾合同，成立。
v2 spec 的 §1–§3（方案 D / One Tap / cookie）、§8（成本边界）、§9（前端）继续有效。

实证依据链：
- `2026-07-31-p0-1-p0-3-evaluation-results.md`（真实 GSC 数据）
- `2026-07-31-p0-5-spike-tranche1-results.md`（P0-5 全链路 spike）
- 本文档 §七.5（v3 算法在真实数据上的干跑）
- codex 评审（2026-07-31，含 Wilson 检出力定量分析与 DFS client 代码事实核查）

---

## 零、v3.1 的核心转向：产品按证据强度分层，不按工具分期

三轮实测 + codex 评审共同指向一个结论：**三个工具能诚实交付的东西，证据强度差异极大**。v3.0 还在试图让每个工具都做"智能诊断器"；v3.1 改为——**每个工具 v1 只交付其证据能支撑的最强产品，把因果归因留给有了新证据源之后的版本**。

| 里程碑 | 交付 | 证据基础 | 状态 |
|---|---|---|---|
| **M1** | P0-3 =「流量变化时间线」 | 日级序列 + 变化窗口 + 观察模式 —— 全部是 GSC 直接观测 | 设计冻结后可开工 |
| **M2** | P0-1 =「CTR 证据表」 | 站点自身曲线 + 离群观察 + 匿名缺口披露 —— 观测 + 站内统计 | 同上 |
| **M3** | P0-5 =「已验证初始关键词方向」 | 需要 DFS Phase 0 spike 通过 | **spike 前不产品化** |

**砍掉的（codex 裁决 + 我们接受，v1 不做）**：
- P0-1 自动 Title/Meta 草稿（没有因果识别能力，也没有测量闭环）
- "答案吸收型 SERP"的**自动因果归因**（CTR 聚合无法区分 AI Overview / snippet / 视频 / 无点击意图 / 国家设备结构 / 匿名化偏差 —— 只能输出观察模式）
- P0-3 自动"报告所有历史事件"（冷启动误报未解决前只出图 + 最近候选事件 + 用户选窗）
- P0-5 GEO 泳道的 PAA/SERP 特性校验（端点未实测）
- 跨工具的自动闭环（GEO 加权、demand→seed）——降级为普通链接跳转
- SiteBaseline 跨请求缓存（GSC 私有查询数据无存储合同前，v1 改为 per-run 查询计划）

**保留并优先的**：GSC property 服务端校验、`sc-domain:` 处理、分层 GSC 读取、`unavailable ≠ 0`、`partial` 与匿名缺口披露、observedPatterns/hypotheses/ruledOut 结构、页面价值排序爬取、可解释失败态、独立 provider 账号 + 跨实例限流。

---

## 一、共享基座：SiteBaseline（v3.1 修订版）

**形态改变（codex §6 裁决）**：v1 不做跨请求缓存，改为 **per-run 查询计划** —— 每次工具运行内构建、用完即弃，与"不保存任何结果"的无状态承诺一致。跨请求缓存（Upstash）留待有了明确的存储/隐私合同后再引入，且介时 key 必须是 server-side HMAC（非裸 `sha256(sub)`），GSC 私有 baseline 与 DFS/crawl 公共缓存**绝不共用权限语义**。

**文件落点（架构评审裁决，遵守"领域包纯函数、副作用在 apps/* 边界"）**：

```
packages/public-tools/src/site-baseline/    纯函数，零 I/O
  build.ts / ctr-curve.ts / change-point.ts / normalize.ts（查询归一化，P0-1 品牌过滤 + P0-5 覆盖过滤共用）
packages/public-tools/src/gsc-analytics/
  reader.ts       分层查询编排，client 经 seam 注入
apps/marketing/src/lib/tools/               handler 层（依赖注入模式照抄 internal-link-audit-handler.ts）
```

```
SiteBaselinePlan（per-run，纯函数构建）：
  dailySeries    ← [date] 全历史（≤16 个月，1 次调用，~490 行单页）
  ctrCurve       ← [query] 28 天（1 次）——非品牌、位置分桶、曝光加权
  pageTotals     ← [page] 28 天（1 次，单页）
  pageQueries    ← [page,query] 按需（仅候选页面，filter 限定）
  dataStartDate  ← 无 API 字段，从 [date] 结果的首个非空日期推断（架构评审指出 v3.0 留白）
  anonymizedGap / freshness ← 派生
```

三个修正（架构评审 §7.6 / §3.2 / §1.2）：

1. **ctrCurve 窗口从 3 个月改为 28 天**。`[query]` 给出的是每查询一个曝光加权平均位置 —— 按 3 个月的平均位置分桶会在查询级复刻 v1 被证伪的"先平均后查表"错误（一个查询前 6 周排 3 位、后 6 周排 15 位，平均 9，点击曝光整体落错桶）。28 天窗把位置漂移压到可接受范围，**并作为已知近似显式写进方法论区块**；层 2 离群标记若要更精细需 `[date,query]` 日级行，届时另行计价。
2. **queryIndex 不服务 P0-3 的群组分析**。需求群组要的是事件窗（位置长度任意）内的逐查询 delta —— P0-3 自行发 2 次 `[query]`（peak 窗 + trough 窗）。"一次构建三处使用"的说法作废。
3. **构建并行化**：4 类调用互不依赖，`Promise.allSettled` 并发，单维度失败降级为该维度 `unavailable` 而非整 run 失败。p90 约 3–8 秒。

**对 v2 §4 的显式修订**：现有 `packages/sources/src/gsc/client.ts` 固定 `[date,page,query]` + 25k 分页至 250k，且 **429 直接抛错无退避**（`client.ts:78` 映射为 `RATE_LIMITED`）—— 与上述查询计划不兼容。需**新写**参数化 reader（维度/filter/行数/分页按用途声明 + 带抖动的 429 退避重试一次）。这是新建组件，工期按新建计。

**对 v2 §12 的显式修订**：验收清单增加——reader 的每种查询形态各一条 fixture 测试；`insufficient` 细分状态（见 §二.4）各一条断言；per-run plan 不落任何存储的负向断言。

---

## 二、M2 · P0-1 =「CTR 证据表」

**对外承诺校准**：落地页可以继续叫 SEO Quick Wins，但 v1 交付物是**证据表 + 可测试假设**，不是"改标题就能涨"的诊断。

### 2.1 检测统计模型（codex §1/§8 裁决后收紧）

干跑 + Wilson 检出力分析（codex 定量验证）确认：0 点击查询要在 0.4× 站点曲线阈值下显著，需要 **1,369–1,880 曝光**；astrologywiki 全站 ≥1,000 曝光的查询只有 2 条。**query 级离群检测在小站上接近零检出力** —— 这不是缺陷要修，是产品现实要承认。

因此模型分两层：

**层 1（v1 交付）：证据表** —— 不做二值"命中"判定：

```
对每条非品牌查询（impr ≥ 100，位置桶质量 ≥ 500）：
  observed_ctr、site_bucket_ctr（留一法：基线排除该查询自身）、
  observed_clicks vs expected_clicks、尾部概率（连续披露，非阈值）
按 expected−observed 缺口排序，CSV 可导出
```

**层 2（v1.1+，统计模型冻结后）：离群标记** —— 需满足 codex 列出的全部构件：留一法基线、分层 Beta-Binomial/经验贝叶斯收缩（桶不足时向相邻桶收缩而非机械合桶）、FDR 控制（q ≤ 0.10）、`siteCurve < 1%` 的位置段默认不做 query 级判定（只输出站点级观察模式）。

### 2.2 站点级低 CTR 模式（因果归因已删除）

触发条件不变（站点曲线 < 全网参考线 30%，桶质量足够），**输出文案改为纯观察 + 假设分级**：

> "在当前非品牌查询样本中，你的 4–10 位观测 CTR（0.5–0.7%）显著低于公开参考线（3–7%）。GSC 数据无法区分原因（SERP 特性 / 意图结构 / 摘要展示 / 样本偏差），可能的解释包括 [hypotheses，各带证据等级 unverified]。"

v3.0 的"答案吸收型 SERP（知识面板/AI 答案）"断言删除 —— 数值模式成立，因果文案没有证据（codex §8.5，接受）。

### 2.3 Recommendation 分级表（取代三重闸门）

| 证据等级 | 允许输出 | 禁止输出 |
|---|---|---|
| 仅站内离群/低 CTR 观察 | "观测到 CTR 低于站内同位置基线" | "标题没有命中意图" |
| （未来）有 SERP 抽样特性 | "当前抽样 SERP 出现 X 特性，可能压低点击" | "X 是过去 28 天低 CTR 的确定原因" |
| （未来）有改版前后对照 | "建议测试 title/meta 变体" | "改完一定提升" |

v1 停在第一行。"同页其他查询健康"不再作为放行"改标题"的闸门（codex §2.1：同页不同查询的 SERP/意图完全可以不同，不构成反事实），仅作为证据表的展示列。

### 2.4 insufficient 细分（并入 DTO）

`insufficient_bucket_sample` / `insufficient_query_sample` / `high_query_anonymization_gap` / `partial_gsc_export` / `serp_cause_unobserved` —— 每种是**成功结果**，带各自的解释文案与"达到什么条件再来"。

---

## 三、M1 · P0-3 =「流量变化时间线」（首发工具）

codex 建议首发 P0-3 而非 P0-1，理由成立：它的痛点被实测确认（固定 28 天窗输出 +329%，用户体感 −81%），且交付物全部是直接观测，不需要任何统计模型冻结。

### 3.1 v1 交付

```
1. 日级 clicks/impressions 序列图（全部可用历史）
2. 默认视图：最近 7 天 vs 前 7 天 + 最近 28 天 vs 前 28 天（并排，明示两种口径）
3. 对比窗口全部由系统固定给出，不开放任何手动调整（Owner 2026-07-31）
   —— 用户自选窗 = 换个窗口换一个结论，这是"找一个想听的答案"而非诊断；
   同时省掉区间校验、窗口长度不等的口径处理、重算触发与限流、窗口态持久化
4. 自动提示"最近显著变化候选"（单一最近事件，历史事件不展开）
5. observedPatterns[]（模式非因果）+ 数据截止日 + prev_year 可用性检查
6. 查询群组 = "下降贡献拆分"（哪些查询贡献了下降量的多少%），不输出"需求消失"结论
```

### 3.2 事件检测定义（冻结版，并入 codex §3/§9 全部构件）

```
输入门槛：≥ 12 周历史（按日历跨度，不是行数——GSC 会略过零展现日）
候选峰：右对齐完整 7 日窗（按日历日切，不按数组下标）；同时满足：
       peakClicks ≥ 100 且 peakImpressions ≥ 1,000（codex）
       且 peak ≥ 1 × median(峰之前的 7d 滚动和)
       且峰后至少还有 7 天数据（末尾的峰是增长，不是下降）
候选谷：与峰窗不重叠；峰后 7–28 天内；
       至少两个不重叠后续窗（≈持续 14 天）均低于峰值 60%，
       否则 → transient_visibility_anomaly
季节性闸门：若峰后水平回到峰前常态的 [0.6, 1.5] 区间 → no_material_decline
           + limitation returned_to_prior_normal（促销/季节尖峰结束不是下降）
未定稿尾部：最近 3 天不裁剪（裁了工具就对最新事件失明），但凡对比窗
           触及这 3 天 → limitation recent_window_unfinalized
输出四态：sustained_decline / transient_visibility_anomaly /
         insufficient_history / no_material_decline
clicks 与 impressions 共同分型；位置变化只是 observed pattern
检测器必须配 5–8 条已知答案的真实序列 fixture，否则不可证伪（架构评审）
```

**2026-07-31 落地修正（三路对抗性评审确认，实测证伪）**：

| 原参数/行为 | 改为 | 为什么（评审给出的失败场景） |
|---|---|---|
| `peak ≥ 2 × median(全序列)` | `≥ 1 × median(峰之前)` | 两处致命：① 平台崩塌（稳定流量掉下悬崖）永远检测不到，因为那里"峰"就等于常态；② 全序列中位数随崩塌一起下沉，崩塌超过一半历史后工具反而闭嘴 |
| 窗口按数组下标切 | 按日历日切，且要求 7 天齐全 | GSC 略过零展现日，缺行时"7 天窗"实际跨 10–19 天，与真实周对比无意义 |
| 同星期几基线按下标回溯 | 按日期回溯 | 缺一行就把周六和周三比，正常周末变成"故障" |
| 无季节性控制 | 回到峰前常态区间 → 不报下降 | 零售站每年一月都会被诊断成"崩塌" |
| 未定稿尾部无处理 | 照常判定 + 披露 | 最近 2–3 天必然偏低，headline 跌幅被系统性夸大 |
| `checks` 未跑也报 `clear` | 未跑一律 `not_available` + 原因 | **完全去索引的站会被告知"站点级可见性归零：未发现"** |
| `two_stage_decline` 不看 state | 仅 `sustained_decline` 才发布 | transient/无法判定时仍以 `observed` 口吻发布两段式结论 + do 类建议 |
| `dayCount` = 行数 | = 日历跨度 | 有安静期的老站被当成新站，同比闸门误判 |
| 无数据时日期取当天 | `null` | 用运行当天的日期冒充数据边界 |
| 重复日期不处理 | 去重（不求和） | 求和会凭空制造一个峰 |

**探测预算修正（架构评审 §3.3 —— v2 §6.4 的三个数字在数学上互斥：20 探测 ÷ 并发 2 × 8s 超时 = 80s > 30s 墙钟，实际只探得完 ~7 个）**：

```
PUBLIC_TOOL_PROBE_BUDGET = {
  maxProbes: 20, perProbeTimeoutMs: 5_000,
  perHostConcurrency: 4, minHostDelayMs: 300, maxWallClockMs: 45_000,
}
未完成探测的 URL 必须输出 observation: "not_probed" + availability: "unavailable"
—— 绝不落入"未发现技术问题"（那是对 unavailable ≠ 0 的直接违反）
```

P0-3 总时长（架构评审核算）：GSC 4 次 10–20s + 计算 <1s + 探测 45s = **p90 ~65s，单端点 `maxDuration=120` 即可** —— 三个工具里唯一时长健康的，支持首发。

实测案例的正确输出因此变为**两个事件**：7/16 起的 `sustained_decline`（世界杯群组贡献拆分）+ 7/27–28 的 `transient_visibility_anomaly`（两天悬崖后回弹，与索引证据时间戳边界"数据截至 7/24"并列展示）—— v3.0 的单事件输出把两者压成一个 −81%，codex 指出后修正。

### 3.3 保留自 v2/v3.0 的构件

hypotheses[]（证据等级 + 反证 + 何以定案）、ruledOut[]、insufficientEvidence[]、currentTechnicalState[]（探测 ≤20 URL 预算）、证据时间戳边界、prev_year 数据起点检查。

---

## 四、M3 · P0-5（spike 通过前不产品化）

### 4.1 前置：DFS Phase 0 spike（用独立账号，固定市场/语言/设备 + 20 词）

codex 核实的代码事实：现有 `dataforseo/client.ts:814-818` 硬编码 `search_volume > 0 AND rank_group ∈ [4,20]`（**排除排名 1–3**），KD 字段全仓零处读取，无 keyword_overview、无 SERP API。v3.0 写"此端点仓库已封装"是误导 —— 自校准闸门需要**独立的 request policy + 新字段解析**，全部未建。

必测清单（原样采纳 codex）：
1. `ranked_keywords` 原始 payload：KD 字段路径与 null 比例、rank 1–3 可否请求、`volume=0/null/未返回` 三态区分
2. `keyword_overview`：端点与批量上限、与 ranked_keywords 的 KD 同源性（同词同市场同期逐词比对）
3. SERP：top-10 是否直接带 domain rank、无则需追加哪些调用、每 task 真实 `costUsd`、p50/p90、429 率
4. 结论要求：可赢性从单一 KD 闸门改为**多信号排序**；无逐词 SERP 证据时 UI 只能显示 `estimated_competitiveness`，不得称"可赢"

### 4.2 通过 spike 后的产品形态（两阶段同步 POST，架构评审方案）

单端点串行最坏 ~840s、现实 p90 ~325s，超出 `maxDuration=300` —— 必须拆。但**不做轮询/job**（那需要服务端 run store，真正破坏无状态承诺）。改为两个同步 POST：

```
POST /api/tools/hidden-keywords/context        （≤90s）
  爬取（页面价值排序）+ LLM 卖点提炼 → { evidence[], contextToken }
POST /api/tools/hidden-keywords/opportunities  （≤180s）
  Body: { contextToken, marketCode, languageCode, seeds? }
  LLM 发散 + DFS 校验 + SERP 抽样 + 覆盖过滤
```

- `contextToken` = AES-256-GCM 封缄的自包含负载（结构化卖点 + 通过 guard 的来源 URL + 输入哈希 + `sub` 绑定 + ≤10 分钟 TTL），走 response body 非 cookie。服务端零存储 —— 对"不保存任何结果"的冲击为零，信任模型与 `gg_gsc` 同构。
- **限额键必须打在第 2 步**（否则 token 变成"免费重跑贵的那一半"的 oracle，重新打开 §8.2 的成本敞口）；token 内不放 access token、不放原始爬取正文。
- 并行编排：爬取 ∥ SiteBaseline ∥ ranked_keywords 三路 t=0 同时起（互不依赖，省 20–40s）；SERP 抽样内部并发 3–5 + 硬 deadline，超时词标 `serp_evidence: "unavailable"`。
- 每次 ≤ 40–60 候选；`maxProviderCostUsd` 预设；provider 未完成 → `partial` 不装完整。

**GEO 道脱离 DFS 故障域（架构评审 §5.2 —— v3.0 的真缺口）**：GEO 道的最小可交付证据改为**纯本地**——问句形态（本地判定）+ 站内哪一页能回答它（爬取事实）+ 显式"无搜索量数据"；DFS 的 PAA/question 特性降级为**富化项而非前置条件**。DFS 全挂时输出 `seo: unavailable` + `geo: available (evidenceGrade: hypothesis)` + HTTP 200 —— 差异化叙事的载体不与付费供应商绑在同一故障域。

状态码语义（写死）：`DATAFORSEO_ENABLED=false` → 503（配置态）；DFS 运行时故障 → **200 + 该道 `unavailable`**；单道超 deadline → 200 + `lane_deadline_exceeded`，**绝不返回截断列表当完整结果**；爬取被 bot 防护挡 → 200 + `insufficient_evidence` + 可理解失败文案。

**验收线的算术修正（架构评审 §7.9）**：5.7% 净产出率是消费内容站的数；B2B 实测期望 ~2 个，**按构造过不了 ≥5 的门**。裁决：保留 150 候选与 ≥5 门槛，但**显式声明"B2B 站点常态性返回 insufficient_evidence，这是刻意的诚实结果而非故障"**，落地页与结果页都写明。spike 报告曾建议候选提到 175–260 —— 不采纳（成本同比上升而 B2B 的瓶颈不在候选数，在品类搜索行为本身）。

### 4.3 覆盖判定：四证据态（取代三桶）

| 状态 | 机器含义 |
|---|---|
| `observed_exact_strong` | exact 归一化查询，曝光 ≥ 门槛且**窗口内曝光加权位置** ≤ 10 |
| `observed_exact_weak` | exact 查询有曝光但位置弱 |
| `related_coverage_unverified` | URL/title 相似，非 GSC exact 证据 —— 语义匹配只能进这态，不做硬过滤 |
| `not_observed_in_gsc_query_sample` | 当前样本无 exact 观测 —— **明确不等于"未覆盖"**（匿名缺口 46%） |

`bestPosition` 不得取行级最小值（一次偶然首位曝光会误标"强"）—— 用窗口加权位置。

---

## 五、跨工具协同（收窄为真价值）

**保留**：一次授权三工具共用；统一 property 校验 / 新鲜度 / 匿名缺口 / partial 语义 / evidence contract；工具间**普通链接跳转**（只传 property、日期窗、query，不传结论）。

**删除**（codex §12 裁决）：P0-1 低 CTR → P0-5 GEO 自动加权（无因果链）；P0-3 下降群组 → P0-5 自动 seed（诱导追逐已消失的需求）；P0-5"可见但弱"→ P0-1 的"闭环"承诺（降级为"查看 P0-1 的 11–20 位证据（若样本足够）"链接）。

## 六、产品预期对照（意图仍未变，承诺按证据校准）

| | 产品文档预期 | v3.1 v1 交付 | 后续版本 |
|---|---|---|---|
| P0-1 | 机会清单 + 四段式 | CTR 证据表 + 站点级观察 + 可测试假设 | 统计模型冻结后加离群标记；SERP 证据源接入后恢复建议 |
| P0-3 | 根因归类 + 四段式 | 变化时间线 + 双窗对比 + 观察模式 + 贡献拆分 | 事件检测多站校准后自动分型 |
| P0-5 | 带依据标签的词表 + 聚类 | —（spike 通过前不发） | 同步收窄版 |

## 七、干跑验证记录（v3.0 遗留，v3.1 语义修正）

（保留原始数据，结论按 codex 校准）

- P0-1：同一批 14 条查询，v2 全网基准命中 9 条全误报；v3 站点自校准命中 1 条 —— **但该命中对 z 值选择敏感**（单侧 z=1.645 通过、双侧 z=1.96 不通过），支持 codex "0.4× 常数未经校准，不得作硬阈值"的裁决 → v1 改为连续披露的证据表，不做二值判定。
- 站点级模式在 4–11 位三桶触发（ratio 0.10–0.22）、1–3 位不触发（1.2–1.4×）——**数值模式成立，因果文案已删**。
- P0-3：7d 峰谷法在 91 天真实序列上检出唯一 −81% 事件、爬坡期零误报 —— 但需按 §三.2 冻结版补"持续性确认"与 transient 分型（7/27–28 应单独成事件）。

## 八、工程实施（架构评审已回填，2026-07-31）

### 8.1 DTO 冻结集（Phase 0-A 一次冻结，全文见架构评审记录）

**契约内核**（三工具共享）：
- `PublicToolMode` += `"connected_run"`；`PublicToolPersistence` += `"client_held_token"`；`Availability` 四值含 `insufficient_evidence`
- `PublicToolRun` += `dataAsOf {gscLastFinalDate, indexReportAsOf, probedAt, crawledAt}` + `anonymizedGap` + `propertyScope {siteUrl, propertyType}`
- `PublicToolEvidenceV2 {label, value, source, method, methodVersion, observedAt, window, availability, stance, sourceUrl: GuardedUrl|null, limitation}`
- **`GuardedUrl` 品牌类型**：只能由爬取/探测层构造 —— 用类型系统杜绝 LLM 编造 URL 混过检查
- 既有缺陷一并修：`createPublicToolResult`（contract.ts:66-69）硬编码 mode/persistence，Phase 0-A 改掉，不许三处各自绕

**工具专属结果类型**（各自模块拥有，**不硬套 `PublicToolCheck`** —— 那是审计打分 DTO，对三工具都不合适）：
- P0-1：`SiteLevelFinding`（含 **`suppresses: findingId[]`** —— 站点级模式压制逐查询建议必须是机器可验证的字段，不是文案）+ `QuickWinFinding`（含 `withheldReason` 四值，其中 **`peer_evidence_unavailable`** 处理 `[page,query]` 按点击截断导致对照组不可判的情况）
- P0-3：`DeclineEvent[]` + `magnitude.series` 必选 + `comparisonWindows {adaptive, fixed28d, fixed7d}` 三组并排 + `DemandCohort {memberQueries, dropShare, method: "token_overlap.v1"}` + `hypotheses[].evidenceGrade: "A"|"B"|"C"|"unverifiable_yet"` + `evidenceCutoff`
- P0-5：`Candidate.validation` 为**按 lane 判别的联合类型**（SEO 道 `volumeAvailability: "available"|"provider_no_data"|"explicit_zero"` 三态；GEO 道 `volume: null` + `questionForm` + `supportingPage`，绝不用 volume:0 表达）+ `winnability {verdict, basis, isEstimate}` + `coverage`（§四.3 四态）+ `Funnel`（zero 与 no-data 分开的整数字段）

**包导出**：`packages/public-tools` 从单一 barrel 改为受控子路径 exports（`./contract`、`./quick-wins`、`./traffic-drop`、`./keyword-map`）—— 全 barrel 会把 DFS/GSC/爬虫代码全拖进营销站 bundle；门禁仍按 import-path 级检查。

### 8.2 时长预算（每工具一列 p90 墙钟，行和 < maxDuration）

| 工具 | 端点 | p90 墙钟 | maxDuration |
|---|---|---:|---:|
| P0-3 | 单端点 | ~65s（GSC 10–20 + 探测 45） | 120 |
| P0-1 | 单端点 | ~30s（baseline 3–8 + [page,query] + 计算） | 120 |
| P0-5 | context | ~50s（爬取 35 + LLM 15） | 90 |
| P0-5 | opportunities | ~120s（LLM + DFS batch + SERP 并发 60 + 过滤） | 180 |

**Phase 0-B 第一优先测量项（几十分钟，决定架构）**：DFS SERP 端点是否支持一次 POST 提交多 task（通常上限 ~100）——若支持，20 词 SERP 抽样 = 1 次 HTTP 调用，最大时长项塌缩到 20–40s。

### 8.3 handler 与测试

- 依赖注入照抄 `internal-link-audit-handler.ts` 模式；P0-5 有 8 个 seam（crawl / extractPropositions / expandCandidates / validateVolume / sampleSerp / readQueryIndex / rateLimit / extractClientIp）—— 不可注入的网络代码会直接拉红全仓 80% 覆盖率门（`vitest.config.ts:63-68`）
- P0-5 一个 POST 返双道结果（两道共享爬取 + 提炼 + queryIndex，拆端点 = 贵的步骤做两遍 + 双限额键）；HTTP 200 只要至少一道给出诚实答案

### 8.4 工期（架构评审重估）

| Phase | v2 | v3.1 | 主因 |
|---|---:|---:|---|
| 0-A 合同冻结 | 2–4 | 3–5 | DTO 面扩大 + createPublicToolResult 改造 |
| 0-B spike | 3–5 | 5–8 | ≥20 站 + 生产 model + 独立 DFS 账号 + SERP 批量/等价字段测量 |
| 1 授权层 | 8–12 | 8–12 | 未触及 |
| 2 P0-1 | 5–8 | 7–11 | baseline + 站点级压制接线 + 反例 fixture |
| 3 P0-3 | 8–12 | 10–14 | 变点检测 + 序列 fixture 语料 + 群组聚类 |
| 4 P0-5 | 10–15 | **16–24** | 两阶段爬取 3–5、新 DFS builder/parser 2–3、keyword_overview 2、SERP 池 2（批量可行则 0.5）、contextToken 2–3、GEO 独立证据链 2、覆盖 2、Upstash 限流 1–2 |
| 5 前端双语 | 8–12 | 8–12 | 持平 |
| 横向 | 3–5 | 4–6 | DTO 面 |
| **合计** | 44–68 | **60–91** | +35%，增量几乎全在 P0-5 |
| **仅 M1+M2（P0-3 + P0-1）** | — | **≈36–52** | 恰好是引擎被真正修好的两个 |

## 九、Owner 决策点（更新）

- [ ] **接受 M1→M2→M3 的分阶段发布**（P0-3 首发，P0-1 次之，P0-5 spike 门控）—— 这改变了"三工具一起上"的默认预期
- [ ] P0-1 v1 不含 Title/Meta 草稿、不含"改标题"建议（证据表产品）—— 落地页文案需按此写
- [ ] **P0-5 的 GSC 授权硬性化有一个排期连锁（架构评审 §7.11）**：若三个工具全部硬依赖 `webmasters.readonly`（sensitive scope），则全部卡在 Google 审核后面 —— spec §3.0.3"先发 One Tap 登录不等审核"的分批计划将失去意义（第一个里程碑只交付一个背后什么都没有的登录）。若选硬性，需同时接受"审核通过前无任何工具可发"；若选降级模式，P0-5 的覆盖判定按 §四.3 的诚实措辞
- [x] ~~P0-3 的"交互式图上选窗"v1 是否要~~ —— **已决（Owner 2026-07-31）：窗口一律由变点检测固定给出，连日期选择器也不做**。Phase 3 从 10–14 降到 8–11
- [ ] P0-5 验收线保留 ≥5 + 显式声明"B2B 站常态 insufficient_evidence"（§四.2 算术修正）
- [ ] P0-5 DFS Phase 0 spike 的独立账号开通（唯一的真金成本前置）
- [ ] **若要压总工期：只做 M1+M2（≈36–52 人日），P0-5 移出本程序作为研究项** —— codex 与架构评审独立得出同一建议

---

## 附录 B · 架构评审裁决表（2026-07-31）

| # | 架构评审结论 | 裁决 | 落点 |
|---|---|---|---|
| 1 | 三层文件落点（纯函数/reader/handler 缓存边界） | 接受 | §一 |
| 2 | TTL-1h 缓存是虚构（仓库无 Redis、跨 isolate 命中≈0、私有数据无存储合同、key 漏品牌词） | 接受（v3.1 已改 per-run） | §一 |
| 3 | ctrCurve 3 个月窗复刻 v1 数学错误 | **接受 —— codex 与我都漏了** | §一修正 1 |
| 4 | queryIndex 服务不了 P0-3 群组；选双窗两次调用 | 接受 | §一修正 2 |
| 5 | 新 reader 必须带 429 退避（HttpGscClient 无） | 接受 | §一 |
| 6 | dataStartDate 无 API 字段，需从首个非空日期推断 | 接受 | §一 |
| 7 | 探测预算三数互斥（80s>30s，只探得完 7 个）；未探 URL 必须 not_probed 非"正常" | 接受 | §三.2 |
| 8 | 变点检测需噪声下限（peak ≥ 2×中位）+ 序列 fixture 语料 | 接受（与 codex 常量合并） | §三.2 |
| 9 | P0-5 单端点 p90 ~325s 超 300；两阶段同步 POST + 封缄 contextToken | 接受 | §四.2 |
| 10 | GEO 道没逃离 DFS 故障域；最小证据改纯本地 | 接受 | §四.2 |
| 11 | 验收线对 B2B ICP 数学上过不了；150 候选静默维持无理由 | 接受（显式声明 + 维持 150 并给出理由） | §四.2 |
| 12 | DTO 全集草案 + GuardedUrl + suppresses + peer_evidence_unavailable + lane 判别联合 | 接受 | §八.1 |
| 13 | 子路径 exports 替代 barrel | 接受 | §八.1 |
| 14 | 时长预算表须按 p90 墙钟列 | 接受 | §八.2 |
| 15 | GSC 硬性化的排期连锁（One Tap 分批计划失去意义） | 接受 | §九 |
| 16 | 工期 60–91（仅 M1+M2 则 36–52） | 接受 | §八.4 |

无拒绝项。两路评审独立收敛于同一战略建议（P0-5 移出首发程序），且互补零冲突（codex 主攻统计与证据语义，架构主攻时长、DTO 与代码事实）。

---

## 附录 A · codex 评审裁决表（2026-07-31）

| # | codex 结论 | 裁决 | 落点 |
|---|---|---|---|
| 1 | 小站桶质量问题实存；需留一法/收缩/FDR/低 CTR 段降级 | **接受** | §二.1 |
| 2 | 三重闸门不足以支撑"改标题"因果建议；分级表替代 | **接受** | §二.3 |
| 3 | 变点检测需冻结定义（峰体量/持续性/transient 分型/历史门槛） | **接受** | §三.2 |
| 4 | DFS 自校准"已封装"为误导；rank 4–20 过滤 + 零 KD 读取（已核实 client.ts:814-818） | **接受** | §四.1 |
| 5 | 覆盖三桶 → 四证据态；"不可见"≠"未覆盖"；bestPosition 加权 | **接受** | §四.3 |
| 6 | 调用预算是愿望清单；选同步收窄版；SiteBaseline v1 去缓存 | **接受** | §一/§四.2 |
| 7 | 分阶段替代方案（P0-3 首发） | **接受** | §零 |
| 8 | Wilson 检出力定量：0 点击需 1.4–1.9k 曝光；query 级检测小站近零检出力 | **接受**（与干跑一致） | §二.1 |
| 9 | 峰谷法方向成立但需持续性 + transient 分型；爬坡误报风险实存 | **接受**（干跑的 35 门槛改 100/1000） | §三.2 |
| 10 | KD 同源性/SERP 端点/单价全部不能编，必须 Phase 0 | **接受** | §四.1 |
| 11 | 过度设计砍单（title 草稿/因果归因/全事件/GEO 校验/共享缓存/交互编辑器） | **接受** | §零 |
| 12 | 跨工具协同 1 真 3 PPT；收窄为链接 + 共享合同 | **接受** | §五 |

无拒绝项。v3.0 → v3.1 的全部修改均可追溯至上表。

---

*v3.1，2026-07-31。§八待架构评审回填后即为实施基线候选。*
