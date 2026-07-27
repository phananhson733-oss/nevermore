# Slice 2 Task 4 实现蓝图 · Content Shadow 流水线(队列 + worker + pinned Flow adapter)(2026-07-25)

基线:worktree `unified-growth-opportunity-v03` @ `7b0f951`。配套:`2026-07-25-slice2-task2-flow-shadow-blueprint.md`(Task 2/5)、`2026-07-25-slice2-content-shadow-execution-plan.md`(落地计划)。

## 主 agent 已批准的 4 项开放裁决(不要偏离)

- **D1(draft 可复现定义)**:draft 用 **pinned LLM**(现有 markdown envelope,`structured_llm`)。`flow_shadow_runs.content_hash` 是**输入寻址**(冻结元组),**不是** LLM 输出逐字节哈希——与 `audit_runs` 完全同构。"可复现" = 给定相同冻结输入 + pinned adapter/prompt 版本,run 是良定义、可审计(`AnalysisInvocation` 记 inputHash/outputHash)的函数;**非** LLM 逐字节可复现。批准。替代方案(确定性 draft = content_brief 复读)丧失 Flow Shadow 价值,否决。
- **D2(draft artifact 幂等铸造)**:worker 直接 `ExecutionArtifactsRepository.insert/insertRevision`(public `createActionArtifact` 拒 english_blog_draft)。crash re-delivery 必须收敛:**先 `findLiveByActionType(action, 'english_blog_draft')` 复用,无则 insert**;或用 `flow_shadow_run.id` 派生的确定性 UUID 作 artifact id。实现 agent 选与 `run-artifact.ts` 一致的更干净者。批准 find-or-create 收敛语义。
- **D3(createContentShadowRun 归属)**:**Task 4 落 op + 契约 + route + 冻结/enqueue 骨架 + read-only 断言**(使管道端到端可 enqueue/poll);**Task 5 硬化红线 B 上游 Finding→brief 保证**(复用 reviewProjectFinding、countActionsForFinding===1 语义强化)。批准——避免契约税跨两 commit 割裂。**据此落地计划的该 op 从 Task 5 移到 Task 4。**
- **D4(ANALYSIS_INVOCATION_TASKS 扩展)**:Task 4 加 `content_shadow_draft`(draft 走 LLM envelope 需 task 值);QA-LLM 判官(Task 6 若用)按需再加 `content_shadow_qa`。批准 Task 4 加 `content_shadow_draft`(一处小契约同步:`packages/artifacts/src/types.ts:27` 闭集 + 可能 DB CHECK)。

## 现状锚点(Task 2 已超范围落地的地基)

- **三表 + 触发器已建**:flow_shadow_runs / flow_shadow_research_packs / flow_shadow_qa_gates,append-only(55000),`enforce_flow_shadow_run_provenance` 已强制 9 条 provenance 不变式(见 content-shadow-foundation.integration.test.ts 的 9 个 reject 用例)。
- **Repo 已建**:FlowShadowRunsRepository(create/findById/findByCapabilityRunId/findByContentHash/listByProject cursor)、FlowShadowResearchPacksRepository(insert/findByRun)、FlowShadowQaGatesRepository(insert/findByRun),均 onConflictDoNothing + immutable-match 幂等。常量 `CONTENT_SHADOW_PROJECTION_VERSION="content-shadow.0.3.0"`(flow-shadow-runs.ts:18);adapter 版本字面量 `"content-shadow-adapter.0.3.0"`。
- **english_blog_draft 已全链路接入**(枚举/format/openapi/authority/schema/MVP-SPEC)。**强约束信号**:templates/index.ts:37 的 english_blog_draft case **抛错**("minted by the Content Shadow worker via the markdown LLM envelope, never here");validators/index.ts:79 free-form markdown 无必需 section;envelope.ts:228 MarkdownEnvelope.kind 含 english_blog_draft。→ **draft 走 markdown LLM envelope,不是确定性模板**(D1)。
- 持久化面:api 45 / async 8 / tables 44 / rules 11。authority verify-spec:EXPECTED_OPERATION_COUNT=45、EXPECTED_ASYNC_OPERATION_COUNT=8、EXPECTED_TABLE_COUNT=44。
- **兄弟仓库真相**:`/Users/wzb/gengrowth-flow-mvp` 非可 import 库,是 docs + .mjs 工具(deps 仅 marked^17 + sanitize-html^2,MIT)。移植 = 把纯 Node 确定性逻辑**重写进** SignalFrame。**绝不修改兄弟仓库**。

## 1. Pinned Flow adapter 提取

**核心洞察**:gengrowth-flow-mvp 工具**从不自调 drafting LLM**(Phase1 写 prompt→外部跑模型→Phase2 ingest 跑确定性 gate)。确定性活在 scaffolding+校验,不在生成。SignalFrame 同构。

可移植(纯 Node 零依赖):`tools/scripts/lib/red-lines.mjs`(RL1-12,RL8 科学背书无支撑=FAIL、RL12 幻觉引用=FAIL 是 unsupported-claim 核心)、`lib/structure-checks.mjs`(SC1-10 字数/标题/内链/FAQ/Sources/CTA)、`lib/citability.mjs`+`structure-checks.geo.mjs`(GEO 评分,clean-room 源自公开论文,**advisory 非 gating**,保留 provenance 头注)。**不移植**:md→HTML 渲染(Slice3)、draft 生成(LLM,用 @sf/artifacts envelope)、Google Sheets/占星模板/真实 CMS/publish/index/GA4/cron/抓取。

**位置:新建 versioned 包 `packages/flow-shadow/`**(镜像 @sf/artifacts/@sf/engine,纯函数可脱 worker 单测):
```
packages/flow-shadow/
  package.json   # "@sf/flow-shadow"; Slice 2 无第三方 runtime dep
  src/version.ts # export const CONTENT_SHADOW_ADAPTER_VERSION = "content-shadow-adapter.0.3.0"  (R3 服务端固定)
  src/index.ts   # barrel
  src/research/  # 确定性 research pack 组装(Task 4)
  src/qa/        # red-lines.ts/structure-checks.ts/citability.ts(移植;Task 6 落判定)
  src/types.ts   # ResearchPack/QaVerdict/QaClaim 纯类型
```
无 runtime import 三重保证:(1) 移植成 worktree 内独立文件无 sibling 路径;(2) package.json 无兄弟仓库依赖;(3) 建议 verify-implementation.mjs 加 guard:grep 全仓禁止 `gengrowth-flow-mvp` 字面量 import。**Task 4 只需**:包骨架 + version.ts + research/ 确定性组装 + qa/ 接口与占位纯函数(RL/SC/citability 真判定是 Task 6)。

## 2. worker 设计

**队列**(packages/db/src/queue.ts):`QueueName` 加 `"content-shadow"`;QUEUE_CONFIG 加 `{expireInSeconds:600, retryLimit:2, retryBackoff:true, heartbeatSeconds:60}`(参考 diagnose,长运行)。
**handler**:新建 `apps/worker/src/handlers/content-shadow.ts`(薄注册镜像 handlers/diagnose.ts),`ctx.boss.work("content-shadow",{includeMetadata:true},…)` → `prepareRunDelivery(ctx, job, (payload,runCtx)=>runContentShadow(runCtx,payload))`。index.ts 在 registerArtifactHandlers 后 `await registerContentShadowHandler` + finishInterruptedBoot 守卫(第 10 queue,改顶注释 nine→ten)。
**recovery**(handlers/recovery.ts):`queueForRun` switch 加 `case "content_shadow": return "content-shadow"`(否则 recovery 判 QUEUE_MAPPING_INVALID)。

**`runContentShadow`**(apps/worker/src/content-shadow/run-content-shadow.ts,镜像 run-diagnostic + run-artifact;flow_shadow_run 行已由 service 事务创建冻结,worker 只 append 子行):
1. claim(scope,runId)→无则 return;scope 不符→setTerminal failed(RUN_SCOPE_MISMATCH)。
2. FlowShadowRunsRepository.findByCapabilityRunId(scope,runId)(capability_run_id==async_run_id==runId);缺失→failed(NOT_FOUND)。
3. **重放守卫(红线 C)**:重算冻结元组 contentHash 与 row.content_hash 比对;重校 brief revision 存在、Finding 仍 confirmed 且 last_seen_run_id==source_diagnostic_run_id(镜像 run-artifact.ts 守卫)。漂移→failed(CONTENT_SHADOW_INPUT_DRIFT)。
4. **RESEARCH**:@sf/flow-shadow 确定性组装 → FlowShadowResearchPacksRepository.insert(幂等)。
5. **DRAFT**:铸 english_blog_draft execution_artifact(action_id=source_action_id,execution_artifacts_one_active_type_idx 允许同 action 不同 type)+ insertRevision;走 @sf/artifacts markdown envelope(structured_llm);记 AnalysisInvocation(task=`content_shadow_draft`,D4)。**find-or-create 幂等(D2)**。
6. **QA**:评判 draft revision → FlowShadowQaGatesRepository.insert。**Task 4 落 verdict:'needs_review' 骨架**(不 block);Task 6 落 RL/SC/citability 真判定。
7. setTerminal(completed, resultType='flow_shadow_run', resultId=flowShadowRun.id)。
transient→resetToQueued;permanent→setTerminal failed。子表插入 onConflictDoNothing 幂等,phase 由子行存在派生(R1)。

## 3. 服务设计

**`createContentShadowRun`**(apps/web/src/lib/services/content-shadow.ts,镜像 createGrowthAuditRun,唯一写事务):
read-only 断言(事务外预检 + 事务内 findByIdForUpdate 复检):Action 存在非 dismissed 且 source_finding_id==finding;Finding confirmed 且 last_seen_run_id==action.source_diagnostic_run_id;Finding rule_id∈{SEARCH-DECAY-002,CONTENT-COVERAGE-001,CONTENT-GAP-011,CRO-LANDING-003};content_brief artifact 存在 type=content_brief action_id==actionId 且目标 revision 存在;**countActionsForFinding===1**(反第二确认,actions.ts:283);实体集全在 project scope(R4 service-load);**search 与 generative 分离**(invariant 8)。断言与 DB 触发器双层冗余(service 给 422/409,触发器 23514 兜底)。
`buildContentShadowFrozenInput`(镜像 buildDiagnosticFrozenInput,@sf/db contentHash,无 DB 侧 hash):冻结元组={primaryFindingId,sourceActionId,sourceDiagnosticRunId,contentBriefArtifactId,contentBriefRevision,competitorEntityIds[sorted unique],searchCluster{clusterKey,keywordEntityIds[sorted unique]},generativeQueryEntityIds[sorted unique],flowAdapterVersion=CONTENT_SHADOW_ADAPTER_VERSION,promptSetVersion=PROMPT_SET_VERSION,projectionVersion=CONTENT_SHADOW_PROJECTION_VERSION,outputLocale}。
事务顺序(provenance load-bearing):idem.begin → ProjectsRepo.findByIdForUpdate+断言 → AsyncRunsRepo.insertQueued(kind='content_shadow',activeKey='content_shadow:'+actionId) → CapabilityRunsRepo.create(capabilityId='content-shadow',version='0.3.0',mode='shadow',sideEffectClass='internal_write') → FlowShadowRunsRepo.create(冻结+contentHash) → enqueueRunInTx(boss,tx,'content-shadow') → idem.complete。捕获 async_runs_one_active_key_idx 冲突→replay-or-409。
202 结果镜像 GrowthAuditAcceptedResult。
**红线 B 反模式(review 必查)**:(1) 建 Action/approval/checkpoint/opportunity 行;(2) 改 Finding review 状态;(3) 重新生成 content_brief 而非冻结;(4) 给 brief 新 ArtifactType 或让 english_blog_draft 成 ActionTemplate(ACTION_TEMPLATES 保持 11 行);(5) 副作用标 artifact ready/published(破红线 D);(6) search+generative 塌缩共同 volume。

**`getContentShadowRun`**(read-only,镜像 getProjectRun/getProjectAudit):按 flowShadowRunId 读 + 派生子行,返回 ContentShadowRunResponse(蓝图 §4);phase 派生 queued|research|draft|qa|complete|failed;404-not-403 跨租户。

## 4. 契约税增量

净变化:apiOperations **45→47**(+createContentShadowRun +getContentShadowRun)、asyncOperations **8→9**(+createContentShadowRun,两列表都在)、tables 不变(44)。同 commit 同步:①openapi/mvp.yaml 加 2 path(POST `/projects/{projectId}/content-shadow-runs`、GET `/{flowShadowRunId}`)+ CreateContentShadowRunRequest/ContentShadowRunResponse schemas ②authority openapi.yaml 字节一致 ③generated(contracts:generate)④spec-v0.3-lock.json:apiOperations+2、asyncOperations+1、刷新 file sha256 ⑤verify-implementation.mjs:EXPECTED_OPENAPI_OPERATIONS+2、EXPECTED_ASYNC_OPERATIONS+1、EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS 加 createContentShadowRun route ⑥authority verify-spec.mjs:OPERATION 45→47、ASYNC 8→9 ⑦MVP-SPEC.md operation 表加 2 行。
非税同 commit 代码:queue.ts(QueueName+CONFIG)、recovery.ts(queueForRun case)、index.ts(第 10 handler)、handlers-registration.test.ts(9→10 + 有序队列名加 content-shadow)、recovery.test.ts(content_shadow→'content-shadow' 断言)、contracts/src/index.ts(barrel export content-shadow.ts)、新 zod/content-shadow.ts+.test.ts、types.ts(ANALYSIS_INVOCATION_TASKS 加 content_shadow_draft,D4)。
zod 草案 CreateContentShadowRunRequest(.strict()):actionId:Uuid;contentBriefRevision?:int>=1;flowAdapterVersion?:literal(CONTENT_SHADOW_ADAPTER_VERSION)(R3 忽略或 validate-equals);competitorEntityIds:Uuid[]<=50 unique default[];searchCluster{clusterKey:1..200,keywordEntityIds:Uuid[1..500] unique};generativeQueryEntityIds:Uuid[]<=500 unique default[](与 search 分离);outputLocale:Bcp47Locale;capabilityContractVersion:literal('content-shadow.0.3.0')。route POST 镜像 audit-runs(operatorRoute+requireIdempotencyKey+assertWorkspaceRateLimit(scope:'content_shadow_run')+parseJsonBody+asyncAccepted),GET 镜像 audit GET(operatorRoute+ok)。

## 5. Task 边界

- **Task 4(本蓝图)**:pg-boss content-shadow 队列 + runContentShadow worker + handler 注册 + recovery 映射;@sf/flow-shadow 包骨架 + version + 确定性 RESEARCH 组装;createContentShadowRun/getContentShadowRun 契约+service+route(端到端可 enqueue/poll);DRAFT 走 LLM envelope 铸 artifact+revision;QA 落 needs_review 骨架;全契约税。止于:管道跑通,QA 占位不 block。
- **Task 5**:硬化红线 B 上游(复用 reviewProjectFinding→恰一 Action→一 brief;createContentShadowRun read-only 断言全落地)。
- **Task 6**:移植 RL8/RL12/SC1-10/citability 进 @sf/flow-shadow/qa,落真判定(无支撑 claim→blocked/needs_review;Research Pack 携带 authority A/B/C/D;GEO advisory)。
- Task 7(Execution 渲染)、Task 8(side-by-side + reviewContentShadowRevision)在 Task 6 后。

## 实现前必核

以真实 schema/文件核实列名与既有断言(尤其 enforce_flow_shadow_run_provenance 已覆盖 9 条不变式,service 断言与之双层冗余而非重复语义)。严格红线:无真实 CMS/publish 写、无 runtime import 兄弟仓库、shadow 只消费已确认 brief 不重铸、search/generative 分离。跑完整 CI gate 集(verify:spec/typecheck/db:smoke/db:migrate:check/queue.integration/集成/单测),不只窄集。
