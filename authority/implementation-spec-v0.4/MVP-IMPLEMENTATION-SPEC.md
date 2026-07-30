---
authority_version: 0.4.0
authority_status: active
normative: true
product_version: 0.3.0
contract_version: 2026-07-21
rule_set_version: mvp.rules.0.2.2
prompt_set_version: mvp.prompts.0.2.0
---

# Nevermore / GenGrowth v0.4 完整增长工作台可执行权威

## 0. 规范范围

本文件冻结当前完整四模块产品面。OpenAPI 精确声明 **78 个 operation 与 10 个
shared async operation**，ordered migrations 精确声明 **78 张应用表**，引擎
精确注册 **11 条规则**。`createProjectMeasurementWindow` 是额外的 typed
measurement `202`，使用 `MeasurementWindowAcceptedHttpResponse`，不计入十个
共享 `AsyncAccepted` operation。

冲突顺序为本文件 → 同目录 OpenAPI → 由 ordered migrations 生成的 schema →
active lock → 运行时实现。任何冲突必须显式修复并让所有 verifier 同时通过，
不得在 UI、repository 或 worker 中加入未声明的兼容猜测。

四模块是同一条 canonical chain 的客户投影：

```text
概览
→ 增长地图（URL / Keyword / Competitor / Topic / Link / Finding）
→ 执行中心（Action / State / Artifact / Revision / Approval）
→ 效果追踪（Change Receipt / Measurement Window / Observation）
```

关键词库、竞品库、Technical SEO、GEO、Content、CRO、内链、外链与 Topic
Model 均属于增长地图的增长路径与判断依据。它们不创建额外顶层工作台，也不
使用离线 mock Artifact 代替生产数据。

## 1. 产品画像与项目上下文

1. 客户输入核心 URL 与能可靠回答的基础业务信息；URL-first 创建可声明产品名、
   B2B/B2C/混合客户模式、单一主要市场和有限集合的增长目标。这些值只作为
   可追溯、可编辑的 declared facts，不得冒充 Crawl、DFS 或 AI 观察结果。
2. Crawl 生成 immutable Snapshot、PageSnapshot 与 Observation。
3. Product Profile synthesis 只可引用冻结证据，输出可审核的产品类别、商业
   模式、目标市场、ICP/JTBD、价值主张、转化目标和竞品候选。
4. AI 草稿是 draft；每个推断字段必须携带 provenance/limitation，用户可以
   修改后生成新的 append-only ICP version。
5. 只有 complete profile 可成为诊断的冻结输入；确认画像不隐式启动分析。
6. Production operator 必须来自 Supabase Auth 且已经存在对应
   `operator_profiles`；登录不能自动授予 workspace membership。

## 2. 数据来源

分析事实只来自以下真实路径：

- Crawl：站点 URL inventory、HTTP、canonical、页面抽取、链接结构与技术事实。
- GSC：query/page clicks、impressions、CTR、position 与时间窗口。
- GA4：landing page、session、conversion 与 UTM/campaign 观察。
- DataForSEO：关键词 demand/rank/competitor SERP observations。
- 客户明确上传的 CSV 或 manual entry：必须保留 origin、actor、时间和限制。

OAuth connected、credential present 或 provider enabled 都不等于数据 available。
规则只能消费已完成、未过期、scope 一致并且写入 canonical Snapshot /
Observation 的数据。缺数据必须成为 skipped/inconclusive/no_data/unavailable，
绝不能合成 0、虚构关键词、虚构竞品或虚构 before/after lift。

GitHub 预留为未来代码交付连接；它不是当前分析数据来源。Sitemap、内部 Crawl、
keyword relation、topic model、competitor monitor、GEO citation 和 backlink
projection 是内置能力，不要求客户另行连接。

`createCollectionRun` 只允许客户触发 Crawl、已连接 GSC 或已连接 GA4；
CSV 继续使用专用 import command。DataForSEO 是 Analysis Refresh worker 的
内置 provider，客户不能通过 collection request 选择、配置或提供凭据/API key。
该写边界不移除 DataForSEO 的 canonical Source/Snapshot/Observation/Evidence
lineage，也不阻止 server-owned Analysis Refresh 运行其成本受限的可选步骤。

DataForSEO Search Landscape（DFS）是该步骤唯一当前的 server-owned 身份：
服务端从冻结 primary Site 的 host、单一 market、canonical language 与服务端
row cap 生成固定的 ranked-keywords 与 competitors-domain 两个请求。两个请求
共享同一 target/market/language 作用域，并原子形成一个
`dataforseo.search_landscape.v1` Snapshot；任何一边失败都不能发布半个
Search Landscape。DFS 只把 ranked Keyword observation 与 SERP-overlap
Competitor origin 投影进现有增长地图，不创建第五模块，不接受客户提交 target、
location、language、limit、provider credential 或任意第三个 query。

### 2.1 Durable Analysis Refresh

`createAnalysisRefreshRun` 是唯一 server-owned 的完整分析刷新 command。客户端
只能提交空 strict object，不能选择 provider、改变顺序、注入 Snapshot 或跳过
required step。command transaction 创建 `analysis_refresh` async run，并以
`analysis_refresh_run` resource identity 冻结 primary Site、confirmed ICP、
完整 plan manifest 与 plan hash；queue 名为 `refresh.analysis`。

计划固定为五步，且每个父 run 都持久化全部五行：

1. Crawl（required）；
2. connected GSC（optional；未连接时明确 skipped）；
3. connected GA4（optional；未连接时明确 skipped）；
4. built-in DataForSEO Search Landscape（DFS，optional；
   disabled/unavailable 时明确 skipped）；
5. Growth Audit（required）。

父 lifecycle 只来自 `async_runs`。step execution state 只能是
pending/running/completed/skipped/failed；optional failure/skip 不得伪装成功，
required failure 必须使父 run failed。父行与 step identity append-only，worker
只可推进 step execution state，并保留 child async run、result Snapshot、
skip reason 或 bounded error。最终 Growth Audit 必须消费本次 refresh 产生并
冻结的 exact Snapshot ids，不得在末步重新选择“当时最新”数据。

详细 step read model 后续另行加入；当前客户端只通过既有
`getProjectRun` 的 progress/status 轮询，不新增 GET operation。

## 3. 概览

概览只回答四类客户问题：

1. 当前已确认的产品、市场与 ICP 是什么；
2. 哪些真实数据连接可用、最后观测时间和覆盖范围是什么；
3. 当前最优先的 Opportunity/Action/Artifact 是什么；
4. 当前审计中的 URL 组合、工作量与可继续步骤是什么。

加载态必须终止为 data、no_data、unavailable 或 problem；不得无限 loading。
四个概览卡都读取 canonical service projection，不读取浏览器内置 demo 数据。

## 4. 增长地图

URL、Keyword 与 Competitor 的 list/detail GET 属于同一个 published-generation
读取协议：

- 可选 `diagnosticRunId` 必须是 canonical lowercase UUID，并且只能固定当前
  project 中一个已发布、可读的 DiagnosticRun generation；省略时服务端读取
  最新可读 generation。未知、跨租户、未发布或不可读的 pin 不得回退到 latest。
- `view=review` 只存在于 Keyword/Competitor detail GET，用于读取当前 mutable
  governance projection；URL read 与所有 list read 都不接受该参数。
- `view=review` 与 `diagnosticRunId` 互斥，重复 scalar 或未知 query 参数均返回
  validation problem，不能任选一个继续。
- Keyword/Competitor PATCH 是 mutation command，拒绝全部 query 参数；review
  语义只来自 strict governed request body。

### 4.1 URL portfolio

- 列表支持多个 URL，选择任一行必须加载该 URL 的独立指标、Finding、Action 和
  Artifact refs。
- URL identity 来自同一 Project/Site 的冻结 Crawl 或已精确映射的 GSC/GA4
  Observation；不得 union 任意历史 URL。
- Click、position、conversion 与 opportunity signal 公开 provider、snapshot、
  observedAt、freshness 和 limitation。
- URL detail 的 Finding membership 来自当前 DiagnosticRun 的 immutable
  `finding_targets`，不从可变 summary 猜测。

### 4.2 Keyword Library

- 来源包括 GSC top query、DataForSEO Search Landscape ranked observation、
  competitor/content gap、VOC/manual/CSV；每条 occurrence 保留来源、scope
  和时间。
- keyword identity、review decision、cluster/topic mapping、existing/new target、
  relation candidate/decision 与 rank history 都是稳定、可追溯的治理面。
- volume、KD、current rank、competitor rank 等各自保留 Observation pointer；
  缺失字段独立 unavailable。
- relation refresh 只产生候选；人工 decision 通过 optimistic revision 追加，
  不覆盖历史。

### 4.3 Competitor Library

- 产品画像可初始化直接/间接竞品；同一个 DataForSEO Search Landscape Snapshot
  产生的 SERP overlap、keyword gap、manual、AI citation 等来源以 typed origin
  occurrence 追加，且不得把 intersection count 解释为百分比或竞争关系。
- candidate/approved/excluded、relationship 和 analysis scope 都有独立 revision；
  用户审核不能改写旧来源。
- dynamic monitor 只比较可比的 immutable snapshots，signal 必须带匹配关键词、
  URL、topic 与 limitation；首次发现不等于发布日期证据。

### 4.4 Technical / Content / GEO / CRO

- 11 条确定性规则覆盖 Technical SEO、Search、Content、CRO、GEO。
- Topic Model、internal link map、backlink authority 与 GEO citation 都复用
  canonical URL/keyword/topic identity。
- Finding 默认 unreviewed；只有显式 review 才能形成或更新一个 primary Action。
- Opportunity 是 canonical facts 的只读 projection，不创建第二套 Opportunity
  table。

## 5. 执行中心

1. 一个 primary Finding 只拥有一个 canonical Action。
2. Action execution state 由 append-only step definitions 和 state events 投影；
   batch read 与单 Action timeline 必须一致。
3. Artifact 只能从 Action 创建；内容变化追加 immutable ArtifactRevision。
4. 支持的客户交付包括 Content Brief、English Blog Draft、Metadata Rewrite、
   Technical Ticket/Code Patch 及其可审核 revision。
5. Content Shadow 冻结 ICP、目标 URL、关键词簇、竞品集、Research Pack、prompt、
   provider/model、输入输出 hash 与 QA verdict。
6. approval event 精确绑定 Artifact、revision、content hash、QA snapshot 和 actor；
   revoked/superseded 不删除历史。
7. UI 的批准、修改、重新生成、执行状态与分享动作必须进入对应 route/dialog，
   不得只显示 toast 或修改浏览器内存。

Content Shadow state: **reviewed, not published**

## 6. Publication authority 与外部写入边界

v0.4 的数据库与 HTTP 已激活：

- delivery authorization、Artifact approval ledger；
- GitHub/WordPress destination/preview/attempt/receipt 的严格 persistence；
- publish / rollback preview 的 issue 与 revoke；
- Delivery Receipt → verified Change Receipt lineage；
- measurement clock 对 verified Change Receipt 的引用。

preview 是短期、server-issued authority，不是外部写入；Delivery Receipt 也不
证明内容 live。只有同 provider、同 artifact content、同 remote scope 且完成
live canonical URL 验证的 Change Receipt 才能成为 Measurement Window anchor。

Current v0.4 external-write boundary: **no external writes**

当前 78 个 operation 不包含真正执行 GitHub PR/merge 或 WordPress publish 的
publication-attempt command。production UI 必须把这类能力显示为
unavailable/尚未连接，而不能写“已发布”。新增外部写入必须原子加入 provider
adapter、worker handler、idempotency、remote precondition、rollback、
reconciliation、route/OpenAPI 与测试。

## 7. 效果追踪

- Results 从 immutable Measurement Window 读取，不从 Artifact status 推断效果。
- before/after 时间窗由服务端从 verified Change Receipt 的 changedAt 对称冻结；
  浏览器不能提交窗口、目标、provider、metric 或结果。
- GSC、GA4/UTM、keyword rank 与 GEO citation 各自保留 Snapshot/Observation
  lineage。
- insufficient_data、not_observed、provider unavailable 与真实 0 必须区分。
- before/after 是 observation，不自动声明 causality；limitation 在客户界面可见。
- `createProjectMeasurementWindow` 虽返回 `202`，使用专用 accepted envelope，
  其 measurement window identity 与 run status 都必须可继续读取。

## 8. 安全、隔离与运行

- same-origin API、HttpOnly session、CSP nonce 与 Supabase session refresh 是
  production request boundary。
- 页面未登录时重定向 `/login?next=...`；API 由 route auth 返回 401 problem。
- 除 login 与 health 外页面不公开。health 不依赖用户 session，但 ready 必须
  真实检查数据库、迁移、queue 与 worker。
- repository 查询以 workspaceId/projectId 同 SQL scope；未知或跨租户 child ID
  返回 404。
- `app` schema 对 Supabase `anon` / `authenticated` 无 USAGE/table 权限。
- dev auth 只在 development + exact loopback APP_ORIGIN + explicit flag 成立；
  production/staging/test 均 fail closed。
- 所有异步 canonical command 在同一 DB transaction 写 run/domain/idempotency/
  pg-boss job；active key 与 idempotency 防重复副作用。
- Crawl/provider 网络遵守 SSRF、防私网、DNS/IP pin、redirect 重验、timeout 与
  credential redaction。

## 9. 冻结 API inventory

以下列表必须与 OpenAPI 的 78 个 operationId 完全一致。

<!-- API_OPERATIONS_BEGIN -->
- `listProjects`
- `createProject`
- `getProject`
- `getProjectContext`
- `updateProjectContext`
- `getProjectProductProfile`
- `updateProductProfileDraft`
- `createProductProfileSynthesisRun`
- `reviewProductProfileCompetitor`
- `addProductProfileCompetitor`
- `confirmProductProfile`
- `getProjectWorkspaceView`
- `listProjectSources`
- `connectProjectSource`
- `handleGoogleOAuthCallback`
- `importProjectSourceFile`
- `disconnectProjectSource`
- `createCollectionRun`
- `createAnalysisRefreshRun`
- `listProjectSnapshots`
- `getProjectRun`
- `createDiagnosticRun`
- `createGrowthAuditRun`
- `createContentShadowRun`
- `listContentShadowRuns`
- `getContentShadowRun`
- `reviewContentShadowRevision`
- `createActionRecheck`
- `listProjectAuditUrls`
- `getProjectAuditUrl`
- `getProjectAuditInternalLinkMap`
- `getProjectAuditBacklinks`
- `getProjectAuditTopicModelWorkspace`
- `getProjectAuditTopicModelInsights`
- `beginProjectAuditTopicModelDraft`
- `patchProjectAuditTopicModelDraft`
- `confirmProjectAuditTopicModelDraft`
- `listProjectAuditKeywords`
- `getProjectAuditKeyword`
- `reviewProjectAuditKeyword`
- `getProjectAuditKeywordRankHistory`
- `listProjectAuditKeywordRelations`
- `refreshProjectAuditKeywordRelations`
- `getProjectAuditKeywordRelation`
- `decideProjectAuditKeywordRelation`
- `listProjectAuditCompetitors`
- `getProjectAuditCompetitor`
- `reviewProjectAuditCompetitor`
- `getProjectAuditCompetitorMonitor`
- `updateProjectAuditCompetitorMonitor`
- `listProjectFindings`
- `reviewProjectFinding`
- `listProjectActions`
- `updateProjectAction`
- `getArtifactExecutionStateBatch`
- `getActionExecutionStateTimeline`
- `updateActionExecutionState`
- `listProjectArtifacts`
- `createActionArtifact`
- `getProjectArtifact`
- `updateProjectArtifact`
- `appendArtifactApprovalEvent`
- `getProjectReport`
- `createProjectExport`
- `getProjectExport`
- `getProjectGrowthAudit`
- `getProjectAuditModule`
- `listProjectOpportunities`
- `getProjectOpportunity`
- `getProjectResults`
- `issuePublicationPreview`
- `issuePublicationRollbackPreview`
- `revokePublicationPreview`
- `getProjectRecentMeasurementWindows`
- `getProjectMeasurementTargetKeywordRanks`
- `getProjectMeasurementGeoCitations`
- `createProjectMeasurementWindow`
- `getProjectMeasurementWindowHistory`
<!-- API_OPERATIONS_END -->

十个共享 AsyncAccepted operation：

<!-- ASYNC_OPERATIONS_BEGIN -->
- `createProductProfileSynthesisRun`
- `importProjectSourceFile`
- `createCollectionRun`
- `createAnalysisRefreshRun`
- `createDiagnosticRun`
- `createGrowthAuditRun`
- `createContentShadowRun`
- `createActionRecheck`
- `createActionArtifact`
- `createProjectExport`
<!-- ASYNC_OPERATIONS_END -->

## 10. 冻结数据库 inventory

以下 78 张应用表来自 ordered migrations 与 static schema catalog；pg-boss 自有表
不计入。

<!-- TABLES_BEGIN -->
- `workspaces`
- `operator_profiles`
- `client_projects`
- `sites`
- `icp_profiles`
- `source_connections`
- `source_credentials`
- `oauth_intents`
- `import_previews`
- `async_runs`
- `analysis_refresh_runs`
- `analysis_refresh_steps`
- `collection_runs`
- `data_snapshots`
- `normalized_observations`
- `provider_discrepancies`
- `diagnostic_runs`
- `diagnostic_run_rules`
- `analysis_invocations`
- `evidence`
- `findings`
- `finding_observations`
- `finding_review_events`
- `actions`
- `action_override_audit`
- `execution_artifacts`
- `artifact_revisions`
- `export_bundles`
- `idempotency_keys`
- `telemetry_events`
- `capability_runs`
- `audit_runs`
- `audit_module_results`
- `site_pages`
- `page_snapshots`
- `product_profile_runs`
- `product_profile_invocation_attempts`
- `finding_targets`
- `keyword_occurrences`
- `keyword_entities`
- `keyword_entity_sources`
- `competitor_entities`
- `competitor_origin_occurrences`
- `flow_shadow_runs`
- `flow_shadow_research_packs`
- `flow_shadow_qa_gates`
- `delivery_authorization_grants`
- `artifact_approval_events`
- `publication_destinations`
- `publication_preview_events`
- `publication_attempts`
- `publication_receipts`
- `measurement_windows`
- `measurement_gsc_dimensions`
- `measurement_ga4_dimensions`
- `measurement_geo_dimensions`
- `measurement_utm_identities`
- `measurement_ga4_campaigns`
- `topic_model_revisions`
- `topic_node_identities`
- `topic_node_revisions`
- `topic_cluster_aliases`
- `topic_node_successors`
- `keyword_review_decisions`
- `keyword_relation_identities`
- `keyword_relation_candidates`
- `keyword_relation_decisions`
- `action_execution_step_definitions`
- `action_execution_state_events`
- `competitor_monitor_settings`
- `competitor_monitor_runs`
- `competitor_monitor_evaluations`
- `competitor_monitor_signals`
- `geo_query_observations`
- `geo_citation_occurrences`
- `backlink_authority_snapshots`
- `backlink_facts`
- `backlink_page_metrics`
<!-- TABLES_END -->

## 11. 冻结规则

规则集 `mvp.rules.0.2.2` 的 11 条规则与版本：

<!-- RULES_BEGIN -->
- `TECH-HTTP-001`: 2
- `TECH-CANONICAL-002`: 2
- `TECH-LINKGRAPH-005`: 2
- `SEARCH-CTR-004`: 1
- `SEARCH-DECAY-002`: 1
- `CONTENT-COVERAGE-001`: 1
- `CONTENT-GAP-011`: 2
- `CRO-PATH-001`: 1
- `CRO-LANDING-003`: 1
- `GEO-ENTITY-001`: 1
- `GEO-CRAWLER-002`: 1
<!-- RULES_END -->

规则输出只能是 deterministic pass/candidate/skipped/inconclusive 及其 Evidence。
阈值或 Evidence shape 改变必须 bump 对应 rule version；registry、ALL_RULES、
lock、authority 与 export manifest 必须同时变化。

## 12. 原子变更与验收

active surface 的任何扩展必须在同一 reviewed change 中更新：

1. OpenAPI 与 generated contracts；
2. route/service/repository/worker/provider implementation；
3. ordered migration、schema catalog 与 schema smoke；
4. authority mirror/generated schema、narrative marker blocks；
5. active lock inventory、versions 与 hashes；
6. positive、negative、cross-scope、idempotency、no-data 与 failure tests。

最低验收：

- `pnpm verify:authority`
- `pnpm verify:spec`
- `pnpm verify:spec:test`
- `pnpm implementation:check`
- `pnpm contracts:check`
- `pnpm openapi:lint`
- `git diff --check`

验证器必须在 operation、shared async classification、migration/table、generated
schema、mirror bytes、rule version、active pointer 或 reviewed hash 被故意修改时
失败。CI 不自动重算 lock；显式运行 lock generator 只准备待审核变更，不等于批准。
