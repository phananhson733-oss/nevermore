# Slice 1 落地执行计划(2026-07-24)

本文件是 `2026-07-21-unified-growth-opportunity-implementation.md`(Task 1-9)在 R2/R3/R4 修正 + 剩余范围评估之后的**落地执行版**。它不重复原实施计划的逐 step 细节,而是:固定真实现状、记录开工前的架构裁决、明确排除项、定义本轮执行顺序与验收门。

基线:branch `codex/unified-growth-opportunity-v03` @ `1979b53`,产品 `0.3.0`,运行时契约 `2026-07-21`,authority 包 `authority/implementation-spec-v0.3/`,规则集沿用 `mvp.rules.0.2.0`(复用 11 条规则)。

上游依据:
- 实施计划:`docs/plans/2026-07-21-unified-growth-opportunity-implementation.md`
- PRD / 设计:同目录 `-prd.md` / `-design.md`
- 范围评估:`/Users/wzb/Code/nevermore/audit/remaining-scope-evaluation-2026-07-24.md`

---

## 1. 真实现状核实(完成度地图)

以仓库实际文件为准,不以文档勾选为准。

| Task | 主题 | 状态 | 证据 |
|---|---|---|---|
| Task 1 | v0.3 authority + 两个 migration-aware verifier | 完成 | `authority/implementation-spec-v0.3/` 全套 + `scripts/spec-v0.3-lock.json`(141 行) |
| Task 2 | Growth Audit/Opportunity/Capability 契约 | 完成 | `packages/contracts/src/zod/{audit,opportunities,capabilities}.ts`(333/492/61 行) |
| Task 3 | 五表持久化边界 | 完成 | `packages/db/migrations/0010_growth_audit_slice1.sql`(239 行,5 表 + provenance trigger,全部 append-only) |
| Task 4 | URL+ICP intake + 版本化 full-audit run | **未开始** | `audit-runs.ts` / `run-full-audit.ts` / `handlers/audit.ts` / `_audit-intake-view-model.ts` 全 MISS |
| Task 5 | Growth Audit/Opportunity 读模型投影 | **未开始** | `audit-projection.ts` / `opportunities.ts` service / `audit`·`opportunities` 路由 / `hooks-audit`·`hooks-opportunities` 全 MISS |
| Task 6 | 四入口 Growth Map shell | 部分 | shell + 换壳页在(`execution/page.tsx` 23 行、`results/page.tsx` 28 行);`e2e/growth-map.mock.spec.ts` MISS |
| Task 7 | 技术 Opportunity 单 Action 单 ticket | **未开始** | `_execution.tsx` MISS;`workspace-view.ts`(475 行)无 opportunity join |
| Task 8 | reviewed recheck + Results 比较 | **未开始** | recheck/results 全链 6 文件全 MISS |
| Task 9 | vertical E2E + stop gate | **未开始** | `e2e/audit-technical-vertical.mock.spec.ts` / stop-gate 文档 MISS |

结论:本轮落地 = 完整跑通 **Task 4 → 5 → 7 → 8 →(6 收尾)→ 9**。串行硬链:`audit_runs` 主干(Task 4)必须先建,Task 5 投影才有数据,Task 7 才能 join,Task 8 recheck 的 `priorRunId` 才能指向真实 `audit_runs` 行,Task 9 才能端到端。

五表关键设计(落地必须遵守):`audit_runs.diagnostic_run_id = capability_run_id = 同一个 async_run.id`(一个诊断运行同时被标记为能力运行,审计只是其只读投影,**无独立 status 列**);`capability_runs` PK 即 `async_run_id`;三张投影表由 provenance trigger 强制租户血缘,全部 append-only。

---

## 2. 开工前架构裁决(四项)

范围评估点名的四项开工前裁决,现基于 spec 与已 checked-in 契约做出决定并记录理由。**四项裁决全部导向:严格按实施计划 Task 4-9 的 Slice 1 边界落地,不扩张到 R5.11 demo 全量。** 依据是实施计划「Execution contract」的 9 条 release-blocker invariant(该文件 209-220 行)与 Definition of Done(1465-1482 行)。

### 裁决 1 — Results 状态枚举:采用 rule-level 三态 + direction

- 冲突:PRD R5.6 五态(technical_verified/observed/insufficient_data/unavailable/regressed)vs PRD §7.4 四态 vs 实施计划 Task 8 的 `compareRule` 三态(`verified | observed | insufficient_data`)+ direction(`resolved | unchanged | unknown`)。
- 裁决:**Slice 1 落地采用实施计划 Task 8 的 rule-level 三态 + direction**。`no_data` → `insufficient_data`;`unavailable` 由 `coverage_state='no_data'` 表达;`regressed` 由 direction 承载(`resolved` 的反向),但 Slice 1 的 technical recheck 不主张 traffic/rank/revenue/AI-citation 提升,故不引入 KPI 级五态。
- 理由:invariant 6/7/8 要求"no_data 不转 zero、recheck 只比较两个 immutable run、search 与 generative 观测分离"。三态 + direction 完全覆盖这些约束且不伪造 outcome。完整五态 KPI 属 Results 真数据阶段(需 GA4/GSC 采集通道),不属 Slice 1。

### 裁决 2 — Opportunity 投影层:保留并由 Task 5 消费

- 冲突:`opportunities.ts`(492 行)+ `audit.ts`(333 行)契约已 checked-in 但 app 层零消费;growth-map 走 R4 product-profile 数据面。
- 裁决:**按 Task 5 落地 `audit-projection.ts` + `opportunities.ts` service 消费这些契约**,消除孤儿漂移。
- 理由:Execution(Task 7)与 Results(Task 8)依赖 `Opportunity.primaryFindingId → Action.finding_id → execution_artifacts.action_id` 的决策面 join;这正是 opportunities 投影提供的。growth-map 的 product-profile 路径是 URL/keyword/competitor **数据面**,opportunities 投影是"可确认机会"**决策面**,互补不冲突。invariant 1/2 要求"reviewable Opportunity 恰有一个 primaryFindingId、confirmation 走现有 Finding Review 事务",投影层正是这个约束的载体。

### 裁决 3 — 审批持久化:Slice 1 复用现有 Finding Review + revision 机制,不新建审批表

- 冲突:范围评估建议新建 `artifact_review_events` append-only 审批表以支持"编辑即失效"。
- 裁决:**Slice 1 不新建审批表**。Opportunity confirmation 复用 `finding-review.ts` 的既有事务(invariant 2:Opportunity 投影永不写 Action);"编辑产生新 Revision 且旧 Approval 失效"映射到现有 `artifact_revisions` 的 `status`(draft/ready/archived)+ `baseRevision` 乐观并发(已实现 409 STALE_REVISION)。
- 理由:invariant 3/9 明确"一个 confirmed Finding 至多创建一个 canonical Action""stop gate 前不新增平行 approval/lifecycle 表"。Task 7 的 files 清单把 `finding-review.ts`/`artifacts.ts`/`run-artifact.ts` 标为 **Verify unchanged**。独立审批事件表是 R5.11 demo 目标态与 Slice 2/3 的更强要求,不属 Slice 1 生产验收。

### 裁决 5 — Worker 复用路径:走路 A(复用 diagnose 队列,不加 kind/queue/迁移)

- 冲突:实施计划 Task 4 files 列了 modify `queue.ts` + create `handlers/audit.ts` + `run-full-audit.ts`,暗示独立 growth_audit 队列。
- 裁决:**growth audit run 用 `async_runs.kind="diagnostic"` + 独立 `activeKey="growth_audit"`,复用 `diagnose` 队列**;worker 靠 `audit_runs` 投影是否存在区分诊断/审计。`run-full-audit.ts` 作为审计模块物化逻辑(`materializeAuditModules`),由 `computeAndPersist` 在 persist 事务末尾追加调用。
- 理由:`RunKind` 无 `growth_audit`;0010 迁移未扩 `async_runs.kind` CHECK;`audit_runs` 外键指向 `diagnostic_runs(id)` + CHECK(`diagnostic_run_id = capability_run_id`)强制审计的 async_run 必须产出 diagnostic_run → 只能 `kind="diagnostic"`。走独立 kind/queue 需补迁移且与已落地 0010 不一致。独立 `activeKey` 让审计与 legacy 诊断不互斥。事务顺序恒为 `async_run → diagnostic_run → capability_run → audit_run`(provenance trigger 要求三者先在)。

### 发现 — 契约税真实存在(与 plumbing 路调查结论相反)

grep openapi/mvp.yaml 确认:当前 38 operations 里**只有** growth-map 的 `listProjectAuditUrls`/`getProjectAuditUrl`(及 audit/keywords、audit/competitors 读路由)。**`createGrowthAuditRun`、`getProjectGrowthAudit`、`getProjectAuditModule`、`listProjectOpportunities`、`getProjectOpportunity`、`createActionRecheck`、`getProjectResults` 均不在 openapi**。所以每个新 operation 必须走完整 7 处同步:app openapi/mvp.yaml + authority openapi.yaml(**字节一致**,sha256 相同)+ `contracts:generate` 重生成 generated/openapi.ts + `spec-v0.3-lock.json` apiOperations 数组 + `verify-implementation.mjs`(EXPECTED_OPENAPI_OPERATIONS/EXPECTED_ASYNC_* / route 实现登记)+ authority `verify-spec.mjs`(EXPECTED_*_COUNT 硬编码 +1)+ authority MVP-IMPLEMENTATION-SPEC.md 的 `<!-- API_OPERATIONS -->`/`<!-- ASYNC_OPERATIONS -->` 块 + 手工 `shasum -a 256` 刷新 lock 的 authorityFiles/implementationFiles hash。基线:38 operations / 6 async / 41 tables / 11 rules。

### 裁决 4 — 交付物类型:Slice 1 只用 3 种既有 Artifact 类型

- 冲突:范围评估指出 R5.11 L429/§10.3 提到 landing_revision_brief、headline_cta_rewrite、utm_plan、publish_receipt、schema_patch、internal_link_plan、comparison_brief 等 4-7 个额外类型。
- 裁决:**Slice 1 只投影 `technical_ticket` / `metadata_rewrite` / `content_brief` 三种既有类型**(规则投影 freeze 表 11 行,实施计划 238-250 行已定死映射)。
- 理由:实施计划 DoD 末段明确"artifact demo 可视化 Content Shadow 仅供设计验证,不是 Slice 2 已实现的证据;其 content/fact-gate/review/publish 行为不属本计划"。R5.11 的 8/9 类交付物是 **demo 目标态**;Slice 1 执行中心只直出 3 种既有类型对应的真实 Action/Artifact。新类型一旦需要,走各自的 7 处契约同步 + parity review,属后续切片。

---

## 3. 明确排除项(本轮不做,需 Owner 门)

1. **R5.11 demo 全量交付物**(landing/headline/utm/publish-receipt 等模拟类型、独立审批事件表、结果侧完整 provenance 面板):demo 目标态,非 Slice 1 生产验收。
2. **Slice 2 Content Shadow**(Topic Cluster 建模、Page Assignment、GenerativeQuery Set、content demand-gap Finding、Research Pack、English Draft、三道 QA、Flow Shadow 抽取):设计文档 L1042 要求 Slice 1 stop gate accepted 后另写实现计划。
3. **Slice 3 真实 Publish**(CMS/GitHub 写、site-scoped 权限、rollback、publish/change receipt 台账):PRD L1556 双重 Owner 门锁死。
4. **发布上线动作**(push/merge、0010-0019 生产迁移、Railway worker 迁移、Vercel prod alias、Owner-gated 十项):代码就绪后独立执行,不阻塞开发。

---

## 4. 执行顺序与每 Task 验收门

每个 Task 严格 RED → GREEN → REFACTOR,聚焦测试先失败,再实现,再跑该 Task 的 verification 子集,最后 conventional commit。新增 operation 一律走 7 处同提交同步:app OpenAPI + authority OpenAPI + 再生成 `packages/contracts/src/generated/openapi.ts` + `scripts/spec-v0.3-lock.json` + `scripts/verify-spec-lock.mjs` + `scripts/verify-implementation.mjs` + `authority/.../scripts/verify-spec.mjs`(+ fixture/parity)。

### Task 4 — 全量审计运行链路
落地 `createGrowthAuditRun` 服务 + `audit-runs` route + `run-full-audit` worker + intake 接线(接到现有 R4 product-profile 就绪流程,不重建 ICP intake)。一个事务写 `async_run`(既是 diagnostic_run 又是 capability_run)+ `capability_runs` + `audit_runs` + 8 个 `audit_module_results`(空模块 `no_data`)+ `site_pages`/`page_snapshots`;idempotency 复用现有诊断 key 约定;worker 编排现有 11 规则 pipeline,不重写规则。
验收门:route 返回 202 `{operation:"growth_audit"}`;replay 不重复入队;8 模块行必写(含 no_data);11 规则仍是 canonical rule truth;service+integration 测试绿;7 处契约同步 + `verify:authority`/`verify:spec`/`implementation:check` 绿。

### Task 5 — 审计与机会读模型投影
落地 `audit-projection.ts` + `opportunities.ts` service + 6 个 GET 路由(audit、audit/modules/[id]、audit/urls、audit/urls/[id]、opportunities、opportunities/[id])+ `hooks-audit`/`hooks-opportunities`。规则投影 freeze 表 checked-in 并逐行测试;`existing_page_first` resolver 用证据判 improve/create(不靠 LLM);URL 详情追溯 Page Snapshot → Data Snapshot → Observation → Evidence → Finding。
验收门:同 target 的三张机会卡共享 targetRef 但永不共享 Confirm mutation;supporting finding 不成为 Action 输入;pass/no_data 不产生 Opportunity;确认路由仍是 `PATCH .../findings/{primaryFindingId}`(不新增 confirmOpportunity);投影/路由测试绿 + 7 处同步绿。

### Task 7 — Execution 单链投影
`workspace-view.ts` 加只读 join(primary finding / target / action / artifact type / revision / audit-recheck state),join 恒为 `Opportunity.primaryFindingId → Action.finding_id → execution_artifacts.action_id`(不加 opportunity_id 列);`_execution.tsx` 展示 canonical Action/Artifact。vertical integration test 证明 replay 幂等、一个 Finding 一个 Action 一个 technical_ticket、supporting finding 零 Action。`action-templates.ts`/`technical-ticket.ts`/`finding-review.ts`/`artifacts.ts`/`run-artifact.ts` **verify unchanged**。

### Task 8 — recheck + Results 比较
落地 recheck contract + service + route + `run-recheck` worker + results service + `hooks-results` + `_results.tsx`。recheck 是独立 v0.3 事务:新建 async_run/capability_run/diagnostic_run/audit_run + 自己的 immutable selected snapshots,payload 携带 `{operation:"growth_audit_recheck", priorRunId, actionId, targetScope, capabilityContractVersion, selectedSnapshotIds}`,不落 checkpoint 表。`compareRule` 三态(裁决 1);Results 只说"Technical condition verified",不说 impact/lift。
验收门:contract 拒绝 missing priorRunId/跨项目 prior run/跨项目 action/target 不符/版本错误/prior==new run id;无 query 或 migration 引用 `performance_checkpoints`;`createActionRecheck`+`getProjectResults` 两 operation 7 处同步绿。

### Task 6 收尾 + Task 9 — vertical E2E + stop gate
补 `e2e/growth-map.mock.spec.ts`(Task 6 遗留);写 `e2e/audit-technical-vertical.mock.spec.ts` 走完整链(URL+ICP → createGrowthAuditRun → Overview → Growth Map/Audit Evidence → Opportunity Review confirm primary only → Execution/one technical_ticket → mark done → createActionRecheck → Results 比较);写 `docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md`(7 项决策 + accepted|revise|stop)。
验收门:四入口 nav;Audit Evidence 无 remediation mutation;三张相关机会独立卡;只 confirm canonical 卡;一 Finding→一 Action→一 fixed artifact type;recheck 用新 run id 保留旧 run;technical 验证不主张流量/排名/营收/AI-citation;无 Content Shadow 生产写。最后跑全库 gate(verify/openapi/contracts/db:migrate:check/lint/typecheck/test/test:integration/test:e2e:mock/build/git diff --check)。

---

## 5. Slice 1 Definition of Done(引用实施计划 1467-1480)

- v0.3 authority/lock/OpenAPI/migrations/runtime 常量/generated contracts/两个 verifier 全部一致;
- 一次 full audit 冻结 URL/ICP/snapshot 输入,呈现 8 模块 coverage 状态于 3 个 frontstage lens;
- Growth Map 默认多 URL 组合,含 Keyword/Competitor 子视图与血缘,同一 Evidence 只出现一次;
- reviewable Opportunity 恰有一个 primary Finding、无直接 mutation 路由;
- 现有 Finding Review 事务创建一个 canonical Action + 一个 template-fixed Artifact 类型;
- Execution 展示该 canonical Action/Artifact 链;
- recheck 新建 immutable run 关联 prior run/Action/target scope/capability version;
- Results 诚实标注 technical condition / observed outcome / insufficient data;
- 仅 概览/增长地图/执行中心/效果追踪 四个主入口,legacy 深链安全;
- 全库 verification 绿;
- Slice 1 product stop gate 文档 accepted。

达成上述后,本轮落地完成;发布上线与 Owner-gated 十项按排除项 §3.4 独立执行。

---

## 6. Task 5/7 落地锚点(调查沉淀)

### Task 5 — 读模型投影(三条边界)
- URL 数据面**已完整**(`growth-map-projection.ts` 652 行 + `growth-map.ts`,绑定 GrowthMapUrl* 契约),**不扩展**。
- **新建** `apps/web/src/lib/services/audit-projection.ts`:`getProjectAudit`(`AuditRunsRepository.findLatest`→`listModuleResults`(8 行)→`AsyncRunsRepository.findById(capability_run_id)` 投影 status/completedAt→组装 8 modules/3 lenses/coverageAndLimitations→`GrowthAuditResponse.parse`)+ `getProjectAuditModule`(`listModuleResults` 过滤单模块)。
- **新建** `opportunities.ts` + `opportunities-projection.ts`(镜像 growth-map 的纯函数/service 分层):消费 findings + finding_targets + evidence + actions,按 `opportunityKey` 聚合,用契约已存在的 `RULE_OPPORTUNITY_PROJECTION`(opportunities.ts:397)+ `resolveRuleOpportunityWorkShape`(:482)。confirm 复用 `PATCH findings/{primaryFindingId}`→`reviewProjectFinding`→`confirmFinding`,投影只读回 confirmed 态,**绝不自己写 Action**。
- **新建 4 个 GET 路由**:audit、audit/modules/[moduleId]、opportunities、opportunities/[opportunityId](audit/urls、audit/urls/[sitePageId] 已存在,勿动)。
- **新建 hooks**:hooks-audit.ts、hooks-opportunities.ts(镜像 hooks-growth-map.ts 三段式;confirm 复用 useReviewFinding,onSuccess invalidate opportunities+findings 两 key)。
- 血缘链读法照抄 `packages/db/src/repositories/growth-map.ts:189-283` currentRunUrlInventoryCtes。
- **待定/阻塞项**(Task 5 开工必须先决):
  1. **audit lens 派生**:`GrowthAuditResponse` 要 3 个 frontstage lens summary,但只有 8 module 结果表,无 lens 表。lens 需从 module/findings 派生——读 `audit.ts` 的 `AuditLensSummary`/`FrontstageLensId` 定义确定构成公式(module→lens 非 1:1,performance/accessibility/best_practices_security/compliance_measurement 无直接 lens 归属)。
  2. **opportunityKey 派生公式**:测试用 `url:/customer-onboarding/:CONTENT-COVERAGE-001`(target:targetRef:ruleId),需确定权威派生层(是否落库)。
  3. **hasSuitableOwnedAsset 来源**:improve/create 判定输入,从 finding_targets 是否解析到已有 crawl PageSnapshot/SitePage 推导(resolver 已就绪,缺输入来源)。
- 契约强校验(parse 会强制):`ConfirmedOpportunity.action.artifactType===RULE_OPPORTUNITY_PROJECTION[ruleId].artifactType`、`action.findingId===primaryFindingId`;`ReviewableOpportunity.workShape===resolveRuleOpportunityWorkShape(...)`;8 module + 3 lens 必全;no_data 时 evidence/finding/provider/observedAt 必空、limitations 必非空;EXACT_VARIANT_RULE_IDS(TECH-HTTP-001/TECH-CANONICAL-002/TECH-LINKGRAPH-005)ruleVersion=2 其余=1。

### Task 7 — Execution 单链投影
- join 现可直写:`Opportunity.primaryFindingId == actions.source_finding_id == findings.id`;`Action.id == execution_artifacts.action_id`。三段 FK 齐全,**不加 opportunity_id 列**。
- **改** `workspace-view.ts`:`WorkspaceViewName` 加 'execution' + 新 `ExecutionView` 接口(仿 StudioView:322)+ getWorkspaceView 新 case + `buildExecutionChain`(仿 `buildOverviewHighlights`:200 内存 find/filter join),产出单链 DTO{primaryFindingId, targetRef, action{id,status}, fixedArtifactType(查 RULE_OPPORTUNITY_PROJECTION), currentRevision+status, auditRecheckState}。
- **新建** `ActionsRepository.countActionsForFinding`(仿 findActiveByFinding:253,用 count)——integration test 断言基数(reviewable 恰一 primaryFinding、confirmed 恰一 active Action)。
- `auditRecheckState` 读侧派生**不建列**:比较 finding.last_seen_run_id/resolved_at/regressed 与 action.source_diagnostic_run_id(run-artifact.ts:593 与 artifacts.ts:287-295 已把此判定当 VERSION_CONFLICT)。
- **verify unchanged**:三 artifact 模板(content-brief/technical-ticket/metadata-rewrite)+ templates/index.ts + run-artifact.ts;`_studio.tsx`/`_report.tsx` 生成链不改。Execution 只读投影。
- execution/page.tsx 现直接 createElement(StudioClient),Task 7 新建 `_execution.tsx` 展示单链侧栏或给 StudioClient 传新 prop。

### Task 8 — recheck/results(调查已完成,Task 7 后落地)
- **新建 `packages/contracts/src/zod/recheck.ts`**:`CreateActionRecheckRequest`{actionId, priorRunId, targetScope{kind,ref}, capabilityContractVersion:literal 'growth-audit.0.3.0'}.strict();`ActionRecheckResultsResponse`(只读):每规则比较项{ruleId, ruleVersion, priorStatus, currentStatus, state:enum(verified/observed/insufficient_data), disposition:enum(resolved/unchanged/unknown), label(仅技术条件措辞)}。index.ts 于 opportunities 后 export。
- **新建 `apps/web/src/lib/services/action-recheck.ts`**:`createActionRecheck` 照抄 `audit-runs.ts:206-393` createGrowthAuditRun 事务骨架(整段复用 249-375),新增校验:`priorRun=AuditRunsRepository.findById(scope,priorRunId)` 非空;`action=ActionsRepository.findById(scope,actionId)` 非空;`finding=FindingsRepository.findById(scope,action.source_finding_id)`;target 经 `FindingTargetsRepository.listForFindings(scope,action.source_diagnostic_run_id,[finding.id])` 取 root,其 target_kind/target_ref 须==targetScope;不变量 `action.source_diagnostic_run_id==priorRun.diagnostic_run_id`。写库:kind='diagnostic',**activeKey=`growth_audit_recheck:${actionId}`(per-action,不用裸 growth_audit 否则被唯一键与 full-audit 互斥),requestPayload={operation:'growth_audit_recheck', priorRunId, actionId, targetScope, capabilityContractVersion, selectedSnapshotIds}**,IDEMPOTENCY_SCOPE='createActionRecheck'。recheck 重新 `loadGrowthAuditInputs` 选最新 crawl 快照(新数据),各 run 携带自己 immutable snapshots。
- **新建 `apps/web/src/lib/services/recheck-results.ts`**:`compareRule(priorStatus,currentStatus)→{state,disposition}` 纯函数(prior='candidate'(fail);current 'pass'→verified/resolved;'candidate'→observed/unchanged;'skipped'|'inconclusive'→insufficient_data/unknown)+ 读侧 `getProjectResults`:先 `AuditRunsRepository.findById(scope,runId)` 对 prior/current 两 run 各做 scope 校验(因 `DiagnosticRunsRepository.listRuleResults(diagnosticRunId)` 无 scope 参数),再各 listRuleResults(auditRun.diagnostic_run_id),按 rule_id 关联聚焦 action 对应 finding.rule_id + targetScope target。文案禁 impact/lift,仅 "Technical condition verified"。
- **新建 route**:`.../actions/[actionId]/recheck`(POST createActionRecheck,202)+ `.../results`(GET getProjectResults);hooks-results.ts;`_results.tsx`(当前 ReportClient 换壳,复用 growth-map comparison strip `_growth-map.tsx:1174-1189` + details/summary + react-query)。
- **worker 无新增**:diagnose handler + runDiagnostic 自动复用(recheck 有 audit_run 投影,自动物化 8 module——无害副作用)。
- **不需迁移**:request_payload 是自由 jsonb(operation 免扩 CHECK);不建 performance_checkpoints;audit_runs 复用同表。
- **契约同步**:2 个新 operation(createActionRecheck async POST + getProjectResults GET)→ 43→45 operations、7→8 async。走完整 7 处同步。

**⚠️ 关键正确性风险 — recheck 投影污染 full-audit 读取**:`AuditRunsRepository.findLatest`(audit-runs.ts:125,按 created_at)会把 recheck 的 audit_run 当"最新 audit",劫持 Task 5 的 `audit-projection.ts`/Overview/Opportunities 读取。**缓解**:recheck 的 audit_run 用独立 `projectionVersion='growth-audit-recheck.0.3.0'`;`AuditRunsRepository` 加 `findLatestByProjectionVersion`(或 findLatest 加过滤参数),Task 5 的 audit-projection.ts 与相关读侧改为只取 full-audit projection_version='growth-audit.0.3.0'。这是 Task 8 落地必须一并修的跨 Task 点。
