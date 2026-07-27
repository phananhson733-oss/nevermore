# Nevermore 关键词增长治理与持续监控设计

**日期：** 2026-07-27
**状态：** 已接受的实施方向
**产品主体：** Nevermore
**客户品牌：** GenGrowth
**批准依据：** 当前产品目标明确要求“按照建议顺序去落地”，并要求先审核需求、再以 Artifact 呈现、最后进入正式实现
**需求来源：** `gengrowth-ops/inbox-maboyang/00-inbox/2026-07-23-gengrowth工具优化需求-关键词库模块.md`
**上位产品基线：**

- `docs/plans/2026-07-21-unified-growth-opportunity-prd.md`
- `docs/plans/2026-07-21-unified-growth-opportunity-design.md`
- `docs/plans/2026-07-27-nevermore-customer-artifact-and-production-convergence.md`

---

## 1. 决策摘要

Nevermore 不新增一个与现有产品并行的“SEO 工具”，也不把 13 条需求直接翻译成 13 个前端卡片。正式方案继续使用统一的客户链路：

`URL / 产品画像 → 页面、关键词、竞品与技术证据 → 统一增长机会 → 执行交付物 → 发布或变更回执 → 效果追踪`

本设计采用以下决策：

1. 保留现有 `keyword_occurrences`、`keyword_entities`、`keyword_entity_sources`、`competitor_entities` 等 canonical 底座。
2. 关键词发现、CSV 导入、GSC/DataForSEO 入库和 AI 候选生成可以先发生；关键词进入执行、映射现有页面或创建新内容之前，必须完成话题模型与页面归属审核。
3. 话题地图是关键词治理的可视化与版本化界面，不是导入前的空白人工门禁。
4. 新的话题模型必须成为 `cluster_key` 的正式治理来源；不能在前端或新表中保留两套彼此可漂移的 Cluster/Page Assignment 真相。
5. “可能重复”只生成可解释的候选关系。系统不自动删除或硬合并关键词；人工决定主词、支持词、保持独立或暂缓。
6. 排名趋势、内容衰减、竞品变化、GEO 引用和外链机会必须来自不可变 Observation/Snapshot 及明确的新鲜度，不能由界面 mock 或当前值反推历史。
7. 参考来源由 Evidence/Research Pack/Artifact provenance 透传，不要求用户在关键词卡片重复手填 URL。
8. 任务阻断与进度属于 Action/Artifact 的正式业务状态，不复用 `async_runs.progress` 冒充客户任务进展。
9. 客户可见数据连接仍只有 GSC、GA4 和 GitHub。VOC、用户评价、DataForSEO、SERP、AI Citation 与 Backlink Provider 属于内部证据能力，其来源可在证据旁披露，但不作为虚假的客户连接卡。
10. Artifact 是正式需求审计交付物，用于展示真实审核结论、当前证据、目标状态、阶段和验收边界；它不证明尚未实现的功能已经上线。

---

## 2. 当前生产基线

### 2.1 已经存在的正式能力

| 对象 | 当前事实 | 设计影响 |
| --- | --- | --- |
| `keyword_occurrences` | 保存关键词显示值、规范化身份、市场、语言、Query Kind、Source Kind、Scope、来源指针、采集时间和 Provider Data As Of | 保留为不可变来源与指标关联事实 |
| `keyword_entities` | 保存稳定关键词身份、状态、意图、Buyer Stage、`cluster_key`、页面映射、审核状态和 `mapping_revision`；当前 Revision 是 `reviewAndMap` 整行乐观并发令牌，不是 append-only 通用审核历史 | 继续作为当前状态投影；Stage 1 增加 append-only Keyword Review Decision authority，并通过兼容投影迁移到正式 Topic Node |
| `keyword_entity_sources` | 保存 Entity 与多个来源发生记录的关系 | 所有新来源必须保留这一 lineage |
| `competitor_entities` | 保存正式竞品身份、状态、来源与最近观测时间 | 竞品监控扩展在此基础上增加周期快照与 Delta |
| Growth Map | 生产 UI 已有 `pages / keywords / competitors` 三个对象模式 | 新地图与历史能力在统一 Growth Map 内扩展，不另造第二产品 |
| Topic Cluster read model | 当前将 `cluster_key` 和 `mapped_site_page_id` 作为 Cluster/Page Assignment 真相 | 新 Topic Model 必须显式完成 authority migration |
| Content Shadow | 已有 Research Sources、Research Pack、QA、Revision History 与阻断 Claim | 提炼为 Artifact-level provenance 与 blocker pattern |
| Overview/Opportunity | 从 Finding、Action、Artifact 聚合当前优先事项 | 陈旧机会必须增加 durable decision state，不能只改排序 |

### 2.2 明确不存在的能力

- 可编辑、可确认、可版本化的话题模型。
- 语义重复/蚕食候选与人工决策账本。
- 客户可写入的 Keyword Review/Mapping 公共命令闭环。
- 通用 Artifact 参考来源投影。
- 通用 Action 阻断原因、解锁条件和业务阶段进度。
- 关键词指标历史 DTO、Endpoint 和 Change Receipt Overlay。
- Durable Opportunity Decision/Snooze 状态。
- Canonical Internal Link Graph。
- 内容衰减 Policy/Detector/Alert。
- Citation Observation Writer 与诚实的 GEO 观测详情。
- Backlink Provider-neutral 数据模型。
- 竞品周期采集、Snapshot Delta 与提醒。

### 2.3 不允许被当作完成证据的内容

- `docs/artifacts/GenGrowth-Interactive-Artifact.html` 中的场景数据。
- 只在 UI 本地保存的 Topic、Duplicate、Progress 或 Reminder 状态。
- `sourceOccurrences` 列表冒充 90 天排名序列。
- Content Shadow Research Sources 冒充所有 Artifact 类型的来源。
- 当前排名、当前点击或当前 Finding 被前端拼成“历史变化”。
- 一个可点击按钮、Toast 或跳转被当作 canonical mutation 已完成。

---

## 3. 需求审核

### 3.1 审核维度

每条需求按以下维度判断：

1. 对客户决策或交付是否有真实价值；
2. 是否与 Nevermore 统一 Opportunity 生命周期一致；
3. 是否已有可复用 canonical 对象；
4. 是否会产生第二套真相；
5. 是否依赖新的 Provider、授权、成本或采集频率；
6. 是否能定义不夸大的验收证据；
7. 是否适合进入近期上线范围。

### 3.2 逐条结论

| # | 需求 | 审核决定 | 改写后的正式口径 | 阶段 |
| --- | --- | --- | --- | --- |
| 1 | 话题地图作为 Step 0 | 改写后纳入 | 系统先生成 Draft Topic Model；审核确认后约束关键词进入执行和 Cluster 选择，不阻断初始发现与入库 | 1 基础模型，2 完整地图 |
| 2 | 同意图词标记重复 | 改写后纳入 | 通过 Topic、Intent、SERP overlap、Mapped Page 等生成候选组；人工选择 Primary/Supporting/Keep Separate/Park | 1 |
| 3 | 用户评价来源 | 改写后纳入 | 拆分 Interview Summary 与 User Review；先支持受治理的手工/CSV 来源，再按授权接外部平台；不新增虚假连接卡 | 3 |
| 4 | 交付物参考来源 | 直接纳入 | 将来源提升为通用 Artifact Provenance Sidecar；来源由 Evidence/Research Pack/Finding lineage 透传，不在关键词卡重复维护 | 1 |
| 5 | 阻断任务解锁条件 | 直接纳入 | Action/Artifact read model 暴露 blocker、owner、unblock condition、next action 与 freshness | 1 |
| 6 | 任务完成进度 | 改写后纳入 | 先显示真实业务阶段；只有拥有正式 Step Definition 的任务才显示 `completed/total` | 1 |
| 7 | 14 天机会提醒 | 改写后纳入 | 使用可配置 SLA、最后决策时间、负责人、Snooze Until 和延后原因；默认可为 14 天但不写死 | 2 |
| 8 | 内链地图 | 直接纳入后续阶段 | 从 Crawl/PageSnapshot 的 Link Observation 生成可追溯 Graph；建议可生成正式 Action | 2 |
| 9 | 90 天排名趋势 | 直接纳入 | 从不可变 Keyword Metric Observation 聚合历史；Stage 1 先交付关键词详情原始序列，Receipt-backed 事件叠加和 Results 对比在 Measurement 依赖完成后交付 | 1 序列，2 事件与 Results |
| 10 | 老内容衰减 | 改写后纳入 | Policy 可配置；包含最低样本、季节性、品牌词、缺数和新鲜度；命中后生成 Alert/Opportunity | 2 |
| 11 | 外链数据 | 后置但保留契约 | 先定义 Provider-neutral Snapshot/Metric/Opportunity，并支持受治理的文件导入；外部深接进入阶段 3 之后 | 3+ |
| 12 | GEO 归因 | 改写后纳入 | 展示 Query、Platform、Answer Snapshot、Citation URL、Passage、Captured At；结构差异只标注为分析，不称为因果 | 3 |
| 13 | 竞品动态监控 | 分阶段纳入 | 对已审核竞品执行周期采集，生成 Snapshot Delta；只有真实变化才更新 Opportunity/Reminder | 2–3 |

### 3.3 对原始优先级的调整

原需求将 4、6 放在 P2，但它们是客户理解 Execution 是否可信的基础，因此提升到第一阶段。原需求将 8 放在 P1，但它依赖稳定的 Page/Cluster/Link Observation，不能早于 canonical link graph。需求 9 保持高优先级，但其第一个交付不是折线图，而是正确的历史读模型与变更事件。

需求 11 继续后置。需求 12 不能承诺“为什么被引用”的因果归因。需求 3 不会改变当前客户可见连接面。

---

## 4. 产品体验与信息架构

### 4.1 顶层信息架构保持不变

客户主导航仍为：

1. 概览
2. 增长地图
3. 执行中心
4. 效果追踪

产品画像与数据连接仍是辅助入口，不新增一个平行“SEO 工具”。

### 4.2 概览

概览回答“今天为什么要做什么”，新增两种由真实状态驱动的条目：

- `待决策机会`：超过项目 SLA 且没有 Action、Decision 或有效 Snooze；
- `健康度预警`：由 Decay Policy 命中的页面或 Keyword Cluster。

每条卡必须展示：

- 触发原因与时间窗；
- 数据新鲜度和缺数状态；
- 关联 URL/Keyword/Cluster；
- 推进、延后或不做的正式决策入口；
- 已有任务时直接进入 Execution，不重复建任务。

### 4.3 增长地图

Growth Map 继续以 `页面 / 关键词 / 竞品` 为对象主入口，并增加结构与历史能力：

- 页面视图：URL Portfolio、Finding、Opportunity、Internal Link Graph；
- 关键词视图：Keyword Library、Topic Model、Duplicate/Cannibalization Review、Metric History；
- 竞品视图：Competitor Corpus、Coverage、Snapshot Delta；
- 外链：阶段 3 后作为页面/竞品的证据维度，不在没有数据时显示活跃 Tab。

话题地图和内链地图可以复用同一个 Graph Interaction Primitive，但绝不复用同一个业务数据结构：

- Topic Graph 的 Node 是话题；
- Link Graph 的 Node 是页面；
- 两者的边、状态、Revision、来源和动作都不同。

内链建议的“去执行”必须调用受 Scope、Idempotency Key 和 Revision 保护的 Action 创建命令。若同一来源页、目标页和建议类型已经存在未解决 Action，界面直接打开原任务，不重复创建。

### 4.4 执行中心

Execution 保持“任务队列 + 交付物主体 + 治理侧栏”：

- 队列卡展示业务阶段、阻断原因和下一步；
- 主体直接展示 English Blog、Content Brief、Metadata、Schema/Code Patch、Publish/UTM；
- 治理侧栏展示参考来源、QA、Revision、Approval、Publication/Change Receipt；
- 不同 Artifact 类型允许不同来源种类，但使用统一 `ArtifactSourceRef` 投影；
- 阻断状态和进度来自 canonical Action/Artifact/Run 组合，不由组件猜测。

### 4.5 效果追踪

Results 同时承载：

- 技术修复复查；
- GSC/GA4 固定窗口页面观察；
- Campaign/UTM；
- Keyword Rank History 与目标词变化；在 Publication/Change Receipt 尚未完成时只展示原始观测序列，不展示伪造改动点或动作归因；
- GEO Citation Observation；
- 发布和变更事件时间线。

任何“前后变化”必须显示窗口、来源、新鲜度和归因边界。“变化发生在动作之后”不等于“动作导致变化”。

---

## 5. Canonical 数据设计

### 5.1 Topic Model

新增概念：

- `topic_model_revisions`
  - Project 内单调 Revision；
  - `draft | confirmed | superseded`；
  - Root Topic、生成依据、Evidence Refs、Created/Confirmed By；
  - Confirmed Revision 不可修改。
- `topic_node_identities`
  - Project 内稳定、不可复用的 Topic Node UUID；
  - Rename 时保留同一 Identity；
  - Split/Merge 不复用被替代节点的 Identity，而是记录显式 successor relationship。
- `topic_node_revisions`
  - 属于一个 Topic Model Revision，并引用稳定 Topic Node Identity；
  - Parent Identity、Label、Description、Intent Envelope、Lifecycle State；
  - Draft 中可增删改；Confirmed 后通过新 Revision 修改。
- `topic_cluster_aliases`
  - 将历史 `cluster_key` label 映射到稳定 Topic Node Identity；
  - 保存有效 Topic Revision、原始 label、canonical/current 状态；
  - 旧 alias 永不删除，避免历史 Finding/Opportunity/Content Shadow 引用失效。
- `keyword_review_decisions`
  - Append-only；
  - Keyword Entity、Status、Intent、Buyer Stage、Topic Node Identity、Topic Revision、Mapping Decision、Mapped Page、Review State、Reviewer、Reason、Timestamp；
  - 使用 Expected Revision 防止并发覆盖。

Authority migration：

1. 先从每个 Project 的 distinct reviewed `cluster_key` 回填一个稳定 Topic Node Identity、初始 confirmed Topic Revision 和 legacy alias；
2. 现有 `keyword_entities.cluster_key` 继续作为当前 label 的兼容投影；
3. 新的 confirmed Keyword Review Decision ledger 成为新写入 authority；
4. 同一事务更新兼容投影，并写入当前 alias；
5. Repository/Contract Test 证明 review ledger、current alias 与 `keyword_entities` 当前投影一致；
6. 所有新 UI/API 只写 Decision Ledger，不直接自由填写 `cluster_key`；
7. `mapped_site_page_id` 仍是页面归属权威，不创建平行 `page_assignments` 真相；
8. 新的 Finding Target/Opportunity projection 同时携带稳定 `topicNodeId` 与 `clusterKeyAtObservation`；旧 `target_ref=<cluster label>` 通过 alias resolver 回填/解析；
9. Content Shadow 新版本冻结 `topicNodeId + topicModelRevision + clusterKeyAtFreeze`，创建时按该 Revision 验证 review decision；之后的 Rename 不使已冻结 Pack 失效；
10. 旧 Content Shadow Pack 保持原 schema 和现有校验语义，不原地改写；adapter 在读取历史 Pack 时使用 legacy alias resolver；
11. Rename 保留 Topic Node Identity 并增加 alias；Split/Merge 创建新的 Identity、记录 `split_into`/`merged_into` successor relationship，并要求受影响关键词重新审核，不能静默迁移；
12. Backfill 完成且新旧读链双读校验通过前，不切换 Opportunity、Finding 与 Content Shadow 的 authority。

Keyword Review Revision 迁移：

- 当前 `mapping_revision` 虽然命名为 mapping，但 `reviewAndMap` 同时保护 Status、Intent、Buyer Stage、Cluster 和 Page Mapping 的一次整行更新；
- 迁移无法重建过去已经丢失的中间版本，因此只为每个现有 Keyword Entity 写入一条 `migration_baseline` Decision，保留当时 `mapping_revision`、当前字段和迁移时间，并明确标注 earlier history unavailable；
- 新命令先 append `keyword_review_decisions(revision = expected + 1)`，再在同一事务更新 `keyword_entities` 当前投影和兼容 `mapping_revision`；
- API 对外使用中性的 `governanceRevision`，旧 `mappingRevision` 在兼容窗口内映射到相同值；
- Topic Assignment 不再拥有另一条独立可写决策账本，避免 Status/Intent/Topic/Page Mapping 被多个 authority 分割；
- Duplicate/Cannibalization 属于 Keyword 间关系，继续使用独立 Relation Decision Revision，不占用单一 Keyword 的 Governance Revision。

历史引用不变式：

- Frozen FindingTarget 的 `target_ref` 不改写；
- Frozen Opportunity 继续展示当时的 `clusterKeyAtObservation`；
- 旧 label 通过 alias 仍可解析到当时的 Topic Node Identity；
- 当前 Growth Map 展示 current Topic label，同时明确历史名称；
- 任一 rename/split/merge 后，旧 Audit Run、Artifact Revision、Research Pack 与 Results Receipt 仍可重放；
- successor relationship 仅用于导航和重新审核提示，不将历史证据重新归因到新节点。

### 5.2 Duplicate/Cannibalization Governance

新增：

- `keyword_relation_candidates`
  - Unordered Keyword Pair 或 Candidate Group；
  - Rule Version；
  - Signals：Topic、Intent、Mapped Page、SERP overlap、Lexical similarity；
  - Evidence Refs、Generated At、Freshness；
  - `open | decided | stale`。
- `keyword_relation_decisions`
  - `primary_supporting | keep_separate | park_secondary | needs_research`；
  - Primary Keyword（需要时）；
  - Reviewer、Reason、Expected Revision、Timestamp。

约束：

- 不删除 `keyword_occurrences`；
- 不改变关键词稳定身份；
- “折叠”只是列表默认可见性和 Relationship 状态；
- 搜索、Brief、Results 仍可追溯 Supporting Keyword；
- 新证据使候选依据变化时，旧决定保留，新候选进入 review。

### 5.3 Source Taxonomy

扩展 Keyword Source Kind：

- `interview_summary`
- `user_review`
- 现有 `manual`、`csv_import`、`dataforseo_ranked`、`gsc_top_query`

每条新来源仍需：

- Source Pointer/Ref；
- Collected At；
- Provider Data As Of；
- Scope Basis；
- Snapshot/Observation lineage；
- 内容许可、可见性和保留策略。

`user_review` 的 Provider 可以是 `manual_upload`、`app_store`、`g2`、`capterra` 等，但 Provider 不等同于客户连接卡。

### 5.4 Artifact Provenance

定义统一只读投影 `ArtifactSourceRef`：

- Source ID/Kind；
- Title/URL（若允许披露）；
- Authority Tier；
- Captured At/Data As Of；
- Content Hash/Hash Method；
- Excerpt 及截断状态；
- Evidence/Research Pack Pointer；
- Availability、Freshness、Limitation；
- Customer Visibility。

来源由 Artifact Type adapter 生成：

- Content Artifact：Research Pack；
- Technical/Metadata Artifact：Finding/Evidence/PageSnapshot；
- Publish/UTM Artifact：Approved Revision、Publication Plan、Measurement Plan。

不复制完整正文，不将用户临时输入 URL 变成权威来源。

### 5.5 Action Blocker 与 Progress

新增业务投影：

- `ActionBlocker`
  - Code、Summary、Unblock Condition、Owner、Source、Observed At、Freshness；
  - Active/Resolved；
  - 可关联 Claim、Provider Readiness、Approval、Dependency 或 Async Failure。
- `ActionProgress`
  - Phase、State、Completed Steps、Total Steps、Next Step、Updated At；
  - Step Count 只有存在 versioned Step Definition 时有效。

`async_runs.progress` 仍只表示机器运行进度。Action Progress adapter 可以引用它，但不能把它直接当成整项业务任务完成度。

### 5.6 Keyword Metric History 与 Change Event

历史读模型按稳定 Keyword Entity 聚合 immutable Observation：

- Observed At/Data As Of；
- Rank、Volume、KD、URL（按 Provider 能力）；
- Provider、Market、Language、Device、Location；
- Missing/Partial/Stale 状态；
- Observation/Snapshot Pointer。

Change Event 只接受：

- Approved Artifact Revision；
- Publication Receipt；
- GitHub Change/PR Receipt；
- Verified Technical Recheck；
- 受审核的 Manual Change Receipt。

UI 默认显示 90 天；API 支持受限窗口，不把 Source Occurrence 数组作为 Metric Series。

交付拆分：

1. Stage 1 只完成 Growth Map Keyword Detail 的原始 Rank Series、Provider/Market/Device 分面、Missing/Partial/Stale 和 Observation Pointer；
2. 如果当前已经存在可验证 Receipt，可以显示对应事件，但没有 Receipt 时保持明确的空事件轨；
3. Results 的目标词改前/改后、发布事件 Overlay 与动作后 Measurement Window 属于 Stage 2 的 Receipt-backed Measurement；
4. Stage 2 依赖正式 Publication/Change Receipt、Outcome Collection 和固定 Observation Window；这些依赖没有完成时，Requirement 9 只能标记为“历史已完成、效果验证待完成”，不能整体标记完成。

### 5.7 Opportunity Decision 与 Monitoring

新增稳定的 Opportunity State Ledger，而不是复制完整 Finding：

- Opportunity Fingerprint；
- First/Last Seen；
- Last Decision；
- `advance | decline | defer | snooze`；
- Reason、Owner、Snoozed Until；
- Related Action。

监控器只基于 canonical history：

- Decay Monitor：Page/Keyword metrics + Policy；
- Competitor Monitor：Approved Competitor snapshots + Delta；
- Citation Monitor：Citation observations；
- Backlink Monitor：Backlink snapshots。

所有提醒都必须去重、可解释、可解决，并关联原始证据。

Competitor Monitor Policy：

- Project 级默认值为 `monthly`，可选 `off | weekly | monthly | quarterly | custom`；
- `custom` 最短 7 天、最长 90 天，防止意外高频采集或失去监控意义；
- 单个 Approved Competitor 可以继承 Project 默认值或设置 Override；
- 客户在竞品详情中看到监控频率、上次成功、下次计划、数据新鲜度与最近失败，并可在 Provider/权限允许时修改；
- Provider 不可用时控件显示结构化 unavailable 原因，不保存一个不会执行的假计划；
- 每次执行产生 immutable Snapshot/Collection Run；失败不覆盖上一次成功数据；
- 同一个 Snapshot Delta 只生成一个未解决 Reminder/Opportunity。

---

## 6. API 与命令边界

第一阶段新增或升级以下行为：

- Keyword Review/Mapping command；
- Topic Model Draft/Confirm/Revise command；
- Keyword Relation Candidate list/detail/decision command；
- Keyword Metric History query；
- Artifact Sources query；
- Action Blocker/Progress query；
- Opportunity Decision command。

通用要求：

- OpenAPI 与 Zod 同步；
- Workspace/Project scope 强制；
- Expected Revision/Idempotency；
- Append-only Decision/Receipt；
- Cursor/Window 有上限；
- 不可用数据返回结构化 `unavailable/partial/stale`，不填 `0`；
- 写命令返回新的 Revision 和审计信息；
- 每个可见按钮都对应真实命令、抽屉、页面或明确 unavailable 状态。

阶段 2–3 再加入：

- Link Graph query；
- Decay Alert query/policy；
- Competitor Schedule/Snapshot Delta；
- Citation Observation；
- Backlink Snapshot。

---

## 7. 审计 Artifact 设计

### 7.1 目的与身份

Artifact 名称：

`Nevermore 关键词库与 SEO/GEO 能力需求审计`

副标题：

`正式产品方案 · 13 条需求的审核、改写、影响范围与落地证据`

它是当前真实需求的产品评审交付物，不是 RelayOps 场景 Demo，也不是客户工作台的第五个路由。生成文件必须独立、离线、可分享、中文优先，并明确写明“审核通过不等于已上线”。

### 7.2 视觉方向

采用“编辑部审阅册 + 证据台账”的精炼视觉：

- 暖米白纸张背景、深森林绿主色、朱红审核标记、少量石墨灰；
- 中文正文不小于 16px，关键结论 20–32px；
- 标题可使用有编辑感的中文宋体 fallback，正文使用可读黑体 fallback；
- 避免密集小字、等宽标签泛滥、紫色渐变和大面积无意义统计卡；
- 桌面使用左侧需求清单、中央审核详情、右侧影响与证据摘要；
- 窄屏退化为单列，详情在 Drawer/Dialog 中展示；
- 所有状态同时使用文字与颜色，不依赖颜色单独传意。

### 7.3 五个信息区

1. `审核结论`
   - 13 条需求总数；
   - 直接纳入、改写后纳入、后置；
   - 推荐架构；
   - 当前生产基线与未实现边界。
2. `需求审核台`
   - 左侧 13 条可筛选需求；
   - 右侧显示原始诉求、问题、当前证据、审核决定、正式改写、影响模块、依赖、验收证据；
   - URL/Keyword/Competitor/Action/Artifact 等对象可点击查看关系。
3. `模块影响`
   - 概览、增长地图、执行中心、效果追踪；
   - 选中模块后筛选关联需求并显示客户界面变化。
4. `分阶段落地`
   - Stage 1 Canonical Governance；
   - Stage 2 Structure & Monitoring；
   - Stage 3 External Evidence；
   - 每阶段展示包含/不包含、依赖和退出门槛。
5. `验收证据矩阵`
   - Data；
   - Contract/API；
   - Service；
   - UI；
   - Mutation/Audit；
   - Unit/Integration/E2E；
   - Live Provider 或诚实 Unavailable。

### 7.4 交互合同

- 点击结论卡：筛选相应审核决定，不弹通用 Toast；
- 点击需求：切换完整详情并同步 URL Hash；
- 点击模块：进入模块影响视图并高亮关联需求；
- 点击阶段：显示该阶段的范围、依赖、验收和不包含项；
- 点击证据：打开结构化证据抽屉，不泄露工作站绝对路径；
- 浏览器前进/后退恢复选中需求、筛选和视图；
- 键盘可遍历，Dialog Trap Focus，Escape 关闭并恢复焦点；
- 支持 `prefers-reduced-motion`；
- 无网络、无远程字体、无外部脚本；
- 生成必须 deterministic；
- HTML 不包含凭据、绝对路径或客户不应看到的内部实现标识。

### 7.5 Artifact 真相标签

每条需求必须显示：

- `当前已存在`
- `部分存在`
- `尚未实现`
- `依赖外部接入`

每条审核结论必须显示：

- `直接纳入`
- `改写后纳入`
- `后置`

页面固定范围声明：

> 本 Artifact 展示 Nevermore 的正式需求审核与目标方案。代码、数据、合同、测试和真实 Provider 证据全部完成之前，目标状态不视为已经上线。

---

## 8. 分阶段落地

### Stage 0：审计与计划

交付：

- 本设计文档；
- 中文交互式审计 Artifact；
- 需求到生产对象的 Evidence Matrix；
- 详细 TDD 实施计划。

退出门槛：

- 13 条需求无遗漏；
- 每条有决定、改写口径、依赖和验收；
- Artifact 可离线打开、所有交互有真实目的；
- Artifact 清楚区分 current/target；
- 计划不覆盖或提交其他进行中的工作。

### Stage 1：Canonical Governance 与 Execution Transparency

范围：

- Topic Model/Assignment authority 基础；
- Keyword Review/Mapping 写命令；
- Duplicate/Cannibalization candidate + decision；
- Artifact Source sidecar；
- Action Blocker/Progress；
- Keyword Metric History 原始序列；
- 对应 Growth Map、Execution UI；Results 的 Receipt-backed 目标词对比属于 Stage 2。

退出门槛：

- 任何客户编辑刷新后仍存在；
- Revision conflict fail closed；
- 所有决策可审计；
- Keyword History 来自真实 Observation，且没有 Receipt 时不显示变更事件；
- Artifact Source 有 lineage；
- 阻断与进度不是前端推测；
- DB integration、Contract、Service、E2E 全绿。

### Stage 2：Structure 与 Monitoring

范围：

- 完整 Topic Map；
- Internal Link Graph；
- Opportunity SLA/Snooze；
- Content Decay Policy/Alert；
- Competitor Snapshot Delta；
- Project 默认与单竞品 Override 的 Competitor Monitor Policy；
- Receipt-backed Keyword Change Event 与 Results 目标词前后窗口；
- Overview/Map/Execution 闭环。

退出门槛：

- Graph 由 canonical node/edge 生成；
- Reminder 可去重、延后、拒绝和推进；
- Alert 显示窗口、阈值、样本和缺数；
- 生成 Action 后可进入 Execution；
- 重新采集会更新证据而不覆写历史；
- Keyword Results 只锚定真实 Publication/Change Receipt 和固定 Measurement Window。

### Stage 3：External Evidence

范围：

- Interview/User Review 来源；
- GEO Citation Observation；
- Backlink manual import 与 Provider adapter；
- 完整竞品动态来源。

退出门槛：

- Provider 授权、使用条款、频率、成本和保留策略明确；
- 所有来源有 snapshot/pointer/freshness；
- 客户连接面保持真实；
- 没有 Provider 时显示 unavailable，不显示 mock 指标；
- GEO 不做因果夸大。

---

## 9. 验收策略

### 9.1 每个能力的六层证据

一个需求只有同时满足以下适用层级才算完成：

1. 数据模型与迁移；
2. Repository/Domain invariant；
3. OpenAPI/Zod/Generated Client；
4. Service/Route/Mutation；
5. 客户界面与可访问交互；
6. Integration/E2E/Provider evidence。

静态 Artifact 只能证明设计与交互意图，不能替代任何生产层。

### 9.2 关键失败用例

- 两人同时审核同一关键词时旧 Revision 被拒绝；
- Topic Revision 确认后不能原地编辑；
- Supporting Keyword 被折叠但历史、来源与结果仍可读取；
- Keyword History 缺数时不补零；
- 没有 Change Receipt 时图表不显示伪造改动点；
- Blocker 已解决后旧阻断不继续显示；
- Async Run 完成不等于整个 Action 自动完成；
- Snooze 中机会不重复冒泡，到期后再次出现；
- 低样本或季节性页面不被简单 20% 规则误报；
- Citation 抓取不可用时不保留旧值冒充当前结果；
- 外部 Provider 未连接时不显示活跃数据卡；
- Internal Link Graph 不从 Finding 临时反推；
- Artifact Sources 不泄露不可披露正文或内部 URL。

---

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 新 Topic Model 与 `cluster_key` 双写漂移 | Assignment Ledger 成为 authority；同事务兼容投影；一致性测试和迁移退出计划 |
| Semantic duplicate 误杀长尾词 | 只产候选，不自动合并；提供 keep separate；保留全部 occurrence |
| 历史图看似精确但来源混杂 | 按 Provider/Market/Device 分序列；展示 limitation 和 freshness |
| Reminder 噪声过多 | 可配置 SLA、最小证据、去重、Snooze、owner、reason |
| 任务进度沦为装饰 | 只有 versioned Step Definition 才显示分数；否则显示阶段 |
| 用户评价接入带来许可/PII 问题 | Provider policy、最小存储、内容哈希、可见性和保留期审查 |
| GEO 被解释为因果 | 使用 Observation/Analysis 文案，永不写“因为 X 所以被引用” |
| 外链接入成本失控 | Provider-neutral contract；先 manual import；深接单独批准 |
| Artifact 被误认成上线证明 | 固定 current/target 标签、范围声明和 Evidence Matrix |
| 与当前 Content Shadow 未提交变更冲突 | 新功能按独立文件/任务提交；每次提交精确暂存；不回退其他工作 |

---

## 11. 明确不做

- 不建立一个独立 SEO/GEO 产品或第二套项目身份。
- 不将话题地图设为关键词发现/导入前的空白硬门禁。
- 不自动删除或不可逆合并关键词。
- 不让用户在每个 Keyword Card 手工维护一份参考 URL 真相。
- 不将所有来源展示成客户连接卡。
- 不使用前端本地状态承担生产决策。
- 不把 `async_runs.progress` 当作客户任务完成度。
- 不用 `sourceOccurrences` 冒充排名历史。
- 不用一次 AI Citation Observation 推断因果。
- 不在没有 Provider 的情况下显示外链、评论或竞品动态 mock 数据。
- 不把静态 Artifact 当作正式功能完成。

---

## 12. 后续文档与实施

本设计之后必须产生一份逐任务、TDD、精确到文件和命令的实施计划。实施顺序为：

1. 审计 Artifact source/build/verify/E2E；
2. Stage 1 的 DB/Repository/Contract；
3. Stage 1 的 Service/Route；
4. Stage 1 的 Growth Map/Execution UI 与原始 Keyword History；
5. Stage 1 全链路验收；
6. Stage 2 在 Receipt/Measurement 依赖复核后实施 Structure、Monitoring 与 Results；
7. Stage 3 在 Provider/授权审批后实施。

任何后续变更若与本设计冲突，需要在新的 Decision/Design Revision 中显式覆盖，不能通过前端实现悄悄改变产品 authority。
