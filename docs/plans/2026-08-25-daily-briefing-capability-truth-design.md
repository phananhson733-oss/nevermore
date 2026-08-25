# Daily Briefing：把「能力」说成能力，把「没看」说成没看

状态：已落地并经三轮跨模型评审（契约 `daily_search_briefing.v3`），未 push
分支：`feat/daily-briefing-capability-truth-20260825`（基于 `0bb08d59`）
上游：PR #205 / #206 已上生产（契约 `daily_search_briefing.v2`）

落地结果见本文末「落地记录」。

## 起因

Owner 用真实 GSC 授权跑 gengrowth.ai，展开「为什么没有更多信号」后发现形态不对。
双模型审计（Claude 6 条 + codex 追加 7 条）确认：**这一轮变化检测的严格输入集
是空的，而页面在四个地方声称不是。**

真跑事实（生产截图，非夹具）：

- KPI：点击 14（-7）、曝光 2,534（-167）、CTR 0.6%、均位 25.7（+0.4）
- mode = `position_first`，cadence = weekly，0 条变化、0 条动作
- 观察三行：`manual seo service` 11.8→9.7（观察，有页面）、`free seo company`
  25.0→10.7（样本积累中）、`cheapest seo tools` 14.2→15.2（样本积累中，页面证据不足）
- CTR 卡：未评估 / `insufficient_band_impressions`（本次 brandTermsConfirmed=true）
- 漏斗：177 条可见词；3 条「达到可评估样本门槛」；3 条 50–99；7 条 lane 全部
  「已观察 · 0」
- 站点趋势：标题「站点点击出现实质下降」，正文「本次变化为 7，低于该样本量下的
  自身波动幅度 9.2」

`positionCapableQueries = 0` 由排除法证明：3 个 ≥100 的词中，`manual seo service`
上一窗口 <100 在能力计数前就被跳过；另两个 far 带词若真处于带内，从 ≤30 退到 >40
必然 ≥3，会触发 `actionable_position_decline`（实际为 0）。

## 裁决清单

编号沿用审计记录，供改完逐条核对。

### P1 · 必须修

**A1 未越噪声却编码成下降（原 F1）**
`propertyTrendFor` 先按阈值生成 `sitewide_click_decline`，噪声底线只决定是否发
action。结果标题断言「实质下降」、正文当场撤回。不是漏改文案，是 kind 语义错。
→ 未越噪声时用中性 kind（`sitewide_click_observation` 一类），只有
`noiseFloor.cleared === true` 才允许「实质下降/增长」措辞。

**A2 mode 只看点击类能力（原 F3 加强）**
`mode` 判定只检查 `clickDeclineCapableQueries === 0 && ctrOpportunityCapableQueries === 0`，
从不检查 `positionCapableQueries`。所以 `position_first` 实际含义是「点击类没输入」，
本次位置类同样为 0 却照报 position_first。
→ mode 改四值，按真实能力表达：
- 有任一严格 change lane 输入 → `change_detection`
- 无严格输入但有 provisional position 输入 → `position_observation`
- 只有当前窗口观察项 → `current_position_watchlist`
- 读取不可用 → `unavailable`

**A3 漏斗把「未评估」显示成「已观察 · 0」（原 F4）**
`SignalFunnelEvidence({ funnel })` 只按 `funnel.evidence === "observed"` 给所有
lane 打徽章，完全不读 `laneCapability.lanes`。三态 contract 已存在，缺接线。
顶部 CTR 卡说「未评估」，折叠区同时说「CTR 基线 已观察」。
→ 每条 lane 的状态必须由 `laneCapability.lanes[kind]` 驱动。

**A4 门槛说明解释不了本次结果（原 F5）**
`evidence.thresholdSummary` 缺：变化类要求**双窗口各 ≥100**（本次 Owner 看不懂
11.8→9.7 为何不入选的直接原因）、跨入 1–10 需改善 ≥1.5、可行动带 ≤30 且退步 ≥3、
站点趋势的 `2·√基准` 噪声底线、`first_observed` 的位置区间与覆盖要求。
现文案「平均排名变化不超过 0.5 才称为稳定」紧邻两个要求位置显著移动的 lane，
会被读成所有位置判断都要求 ≤0.5。

**A5「3 条达到可评估样本门槛」不成立（codex 新增）**
`actionEligibleQueries` 只统计当前窗口 ≥100，不含任何 lane 前提。同一页的观察项
正文已诚实写明「只说明样本够了，不代表任何一条信号规则评估过它」，噪声块却把同
一个数称作「可评估样本门槛」。
→ 改成可核对的拆分：「当前窗口 3 条达到 100 曝光；其中 0 条具备双窗口位置比较
条件、0 条具备点击变化比较条件、CTR 基线未形成」。

**A6「其余低于门槛」是错的（codex 新增）**
fold summary 只用 `shownChanges.length` / `shownObservations.length`，不检查未展示
记录的原因。本次至少 2 条 far 带词曝光 ≥100（不是低于门槛，是被 3 行上限挤掉），
且 `observationCandidates = 3` 但只显示 2 条 sample-building。
→ 拆成「0 条查询词变化 · 展示 3/N 条观察候选 · M 条低于观察门槛或缺少比较条件」，
分别披露「未展示」与「未评估」。

**A7 观察项挤掉合格候选未披露（codex 新增）**
排序本身正确（行动距离优先于曝光量），问题是 UI 一边称展示的是「最值得检查」，
一边把被挤掉的说成「低于门槛」。
→ 显示「另有 N 条观察候选未展示，其中 2 条当前曝光 ≥100 但处于 far band」，或提供
「查看全部观察项」。不要把 far 带行硬塞回前三。

**A8 `filteredObservedRows` / `countComplete` 语义不诚实（codex 新增，潜伏）**
brandTermsConfirmed=true 且双窗口 observed 时，无论 CTR lane 是否可用都会得出
`filteredObservedRows = 177`、`countComplete = true`。这个数只能读作「177 条未形成
严格候选」，不能读作 zh 文案的「未通过任何信号门槛」——大多数记录根本没进入评估。
当前组件未渲染，属潜伏 contract bug；恢复 `filteredComplete` 文案会立刻制造更严重
的误报。
→ 拆成 `notSelectedVisibleRows` / `notEvaluatedRowsByLane` / `evaluatedNoSignalRowsByLane`，
或至少加 reason breakdown。

### P2

**B1 版式（原 F6）** `NoiseSummary` 原是独立 section，PR #205 整段搬进 `<details>`
的 CARD 内，保留了 `sm:flex-row sm:items-center` 两列布局 + `shrink-0` 左标签，
中文标签又无 `whitespace-nowrap`，形成窄左列 + 正文大块首行缩进。
→ 折叠区内改单列：标签置于正文上方，不建立永久左列。**不要**恢复成 KPI 后的常驻区块。

**B2「相互独立的信号路径」不成立** CTR 基线是 `click_opportunity` 的上游前提，
不是并列 lane；「页面归因被抑制」是候选产生后的抑制阶段。
→ 改称「信号评估与抑制路径」，分三层：前置能力与基线 / 实际候选 lane / 页面归因抑制。

**B3 折叠标题「0 条变化」不含站点趋势** 同页却说「站点点击出现实质下降」+
「1 条站点整体趋势」。→ 写「0 条查询词变化 · 1 条站点趋势观察」。

**B4 `first_observed` capability 无条件 evaluated** `laneCapabilityFor` 只要 funnel
可计算就标 `"evaluated"`，但该 lane 依赖双窗口 query/page 读取、聚合一致性与覆盖率。
→ 与 A3 一并修。

## 门槛裁决（codex 明确否决了两个更简单的方案）

**保留严格变化/动作的双窗口各 ≥100。** GSC 均位是曝光加权混合值，不是稳定固定
排名；只把上一窗口降到 50 却继续叫「变化」，会重开上一轮禁掉的低样本口子。

**新增一层「待确认的位置移动观察」**：

- 当前窗口查询曝光 ≥100
- 上一窗口查询曝光 ≥50
- 两边位置均有效
- 跨入 1–10：上一 >10、当前 ≤10、改善 ≥1.5
- 可行动带下滑：任一窗口 ≤30、退步 ≥3

约束：**不计入 `changes`、不生成 `DailyBriefingAction`、不得使用「实质变化 / 机会
成立 / 需要优化」措辞。** 当前窗口有合格页面证据时可给「检查承载页」的观察性入口，
但必须与「今日建议动作」分开、不进入动作计数，并写明「上一窗口只有 50–99 曝光，
尚未达到严格变化门槛」。

**低流量站第二步**（可选，本轮不一定做）：7 天双窗口 position-capable 为 0 时，
额外计算「最近完整 28 天 vs 前 28 天」，仍坚持双窗口各 ≥100，UI 明示窗口。比降低
正式门槛更能增加有效信息且不降证据等级。

**capability 必须分别报告**，`notEvaluated` 与 `evaluatedNoSignal` 不能再共用 0：

- `strictPairedPositionQueries`：双窗口各 ≥100
- `provisionalPairedPositionQueries`：当前 ≥100、上一 50–99
- `currentFloorOnlyQueries`：只有当前 ≥100

## UI 参考

Owner 指定复刻 artifact `52101854-4486-424e-9b50-bcdb4b172615`（每日搜索简报 mock）。
它对这块区域的处理与线上完全不同：

- **没有 lane 网格、没有徽章**
- 噪声只有 KPI 旁一句话：「噪声过滤已开启 · 已隐藏 47 条低于阈值的波动（<50 次
  展示或未通过显著性检验）。以下 3 项超出阈值。」
- 「做不到什么」是**数据边界**段的 4 句白话，不是计数表
- 变化表列：变化 / Query·Page / Clicks / Position / 解读，方向 chip（▲上升 ▼下降 ✦新出现）
- 动作：编号 1/2/3 + 标题 + 证据句 + CTA「在 Opportunity Finder 查看证据 →」

**张力（必须解决而不是绕过）**：lane 网格承载 M5 要求的「未评估 vs 无信号」区分。
照 mock 直接删网格会把区分一起删掉。正确做法是保留区分、换成 mock 的表达方式——
用几句能核对的话说明哪条路径没跑、为什么，而不是 7 格「已观察 · 0」。

## 验收

- 用本文档开头的真跑数据做夹具（**不要**再像上一轮那样为了让 lane 触发而两窗口
  都塞 200 曝光——那是照实现反推期望，codex 已两次指出）
- 断言：漏斗不得出现「已观察 · 0」当 lane 实际 `not_applicable`；站点趋势未越噪声
  时标题不含「实质」；fold summary 的分母能对上；`manual seo service` 出现在
  provisional 观察层且不产生 action
- `pnpm build`、两个 project tsc、改动文件 eslint、相关 vitest

## 落地记录（2026-08-25）

A1–A8、B1–B4 与新观察层全部实现，契约 bump 到 `daily_search_briefing.v3`。

设计阶段没预料到、实现时才定的三件事：

1. **`change_detection` 比预想的更常见。** mode 改为「任一严格 lane 为 `evaluated`
   即 change_detection」。用真跑数据跑出来是 `change_detection`——因为两个 far 带词
   确实双窗口各 ≥100，跨入 lane 真的问过它们。这是实话，不是回退：诚实的收益在于
   漏斗现在说「移入 1–10 区间：4 条未评估 · 2 条已评估但无信号 · 0 条形成候选」，
   而不是七格「已观察 · 0」。
2. **cadence 必须与 mode 解耦。** v2 的 `mode !== "change_detection"` 之所以成立，
   是因为当时 mode 就等于「点击类有输入」。mode 变宽后再读它，会给 14 次周点击的
   站点承诺日更。现在直接问两条点击 lane。
3. **lane 的 `continue` 短路可以删掉且行为不变**（三条位置/点击 lane 的判定条件
   互斥），删掉后每条 lane 才能对全部记录做分账，A8 的三分法才成立。

自查（对着真跑渲染看版式）又抓到三处我自己新引入的问题，已在同分支修掉：折叠摘要
把「没读到」写成 `0/0`、站点趋势正文重复噪声句、`pageAttributionWithheld` 的两种
来源被同一句话概括。

**验收方式的教训**：把 lane 分账写成「三个数相加等于总行数」是恒真断言——三个数
本来就是互相相减得到的。改成逐 lane 字面值（可对着夹具手算）之后，立刻抓出我把
`first_observed` 的可评估数记多了一条。

## 跨模型评审记录（三轮）

codex 三轮共抓出 7 高危 + 10 中低危。**两轮的 P0 都在「我刚修好」的代码里**。

第一轮的两个 P0（我自查完全没看见）：

1. **`lanes.click_opportunity` 直接读 `ctrLane.state`。** 位置段可用 ≠ 该查询词拿得到
   留一法基线。反例：5 个各 100 曝光的词落在同一段——段够用，但去掉任一个都不够，
   于是每个词的留一法基线都失败。结果同一份数据既说「该路径已评估」+ **daily 节奏**，
   又说「5 条全部未评估」。
2. **上一窗口 50–99 的词仍可能是严格 `click_opportunity`**（那条路径只看当前窗口），
   于是同一个词既在动作列表里，下面又写着「不进入今日动作」。

其余高危：`pageAttributionWithheld` 把「没有可比窗口」算成「承载页被隐去」（而那个页面
就显示在同一页上）；观察名单拿 49 次曝光的上一窗口渲染 `11.8 -> 9.7`；门槛说明把
「两窗口各 100」说成对全部五条路径成立（实际只管三条，`click_opportunity` 和
`first_observed` 各有自己的门）。

第二轮又在我第一轮的修复里抓到两处**信息丢失**：把临时层按「严格候选」过滤，会让
落选的严格候选从三个列表里同时消失；把 1–49 的上一窗口置空，会把「观察到但样本太小」
显示成「未观察」。

方法论：

- 恒真断言（三个互相相减的数相加等于总数）等于没测。换成逐 lane 字面值后，立刻抓出
  我把 `first_observed` 可评估数记多了一条。
- 「某个 blocker 存在」这种断言，在 blocker 被换掉时照样绿。要钉字面值。
- 把 diff 落盘再喂给 codex，三轮都在十分钟内出结论。
