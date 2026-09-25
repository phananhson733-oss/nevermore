# 工作台 v2（对话式）规格化设计稿

**Status:** rev4 · 2026-09-25 · Owner 已裁决：§16 D1–D9 全按推荐（2026-09-25）· 下一步写实施计划
**Branch:** `feat/workbench-v2-design`（自 `origin/main` c569f464 新开，worktree `workbench-v2-20260925`）
**Reviews:** 三轮：gpt-6-astra 合同核对 12 + 2 条、Claude 一致性评审 36 + 19 + 20 条（第三轮 0 P0），全部处置见 §18

> 本稿把 `GrowthWorkbench.jsx` 原型（WorkBuddy 风格「任务对话 + 交付物右栏」）的每一个概念钉到 app 已有的实体与合同上，列出必须新增的 authority 变更、在建集成分支的处置，以及需要 Owner 裁决的事项。评估报告见 https://claude.ai/artifact/96J5KaTPWg1fpLic24N1sK （私有链接，结论已抄进 §0 与 §10）。本稿只写「怎么落」，不再重评「要不要落」。
>
> 阅读约定：「原型」指 `~/Downloads/GrowthWorkbench.jsx`；「规格」指 `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`；「已有」指 `main` 上已冻结、已实现的合同；「新增」指本稿提出、尚未进 authority 的合同；「已核」指本稿作者或评审在来源文件里核过。所有「新增」都要按规格 §12 的扩展程序走。`[[…]]` 是作者私有笔记的键，读者不必打开，旁边那句话就是结论。

## 0. 一页结论

- **采什么：** 原型的交互合同——一个项目里的工作以「任务」为单位展开，任务是一条对话线程，右栏承载交付包与证据，交付包逐版审核，审核后进入执行中心，执行后安排复查。
- **不采什么：** 原型的前端事实源（`tasks/packages/actions/credits` 内存状态）、演示逻辑（`buildRun/classify/revisePackage/play`）、13 个脚本化工具的假数据、积分/成员/分享/智能体/技能页。
- **同构关系：** 原型 `候选 → 选择 → 交付包 v1/v2 → 逐版审核 → 执行中心 → 安排复查` 与 app 主链 `Finding → Action → ArtifactRevision → ApprovalEvent → Recheck` 一一对应；任务不是新的事实源，它只是把这条链按时间顺序摆出来的一个视图，外加用户自己说过的话。
- **必须新增的合同：** 两张表（任务、任务条目）、六个 operation（其中 `createWorkbenchTaskRun` 是第 11 个 shared `AsyncAccepted` 异步命令）、一列（revision 关联 run）、以及为了让包装命令「同事务」成立而对 7 个既有 service 做的内核拆分（不改它们的 HTTP 合同）。其余全部复用已有 operation。
- **不动的合同：** Action 状态图、ArtifactType、Finding review、approval event、SourceState、Evidence、主链顺序、「无外部写入」边界、10 个既有异步命令的请求体。
- **集成分支：** 停线不发布；只按文件清单 cherry-pick 与 IA 无关的地基（§13）。
- **首版不做：** LLM 自由文本路由、GEO 三件套、营销站私有引擎、任务归档、任何积分/成员/分享。

## 1. 目标、非目标、成功标准

### 1.1 目标

1. 用一个「任务」视图取代当前四模块里「客户不知道下一步点哪」的问题：进入项目就能提出一件事、看它跑、拿到交付包、审核、推进、复查。
2. 每一屏显示的每一个事实都能回读到 canonical 表：run、Finding、Action、Artifact revision、approval event、Evidence。刷新、换设备、跨天回来看到的是同一份。
3. 把原型 13 条 P0 诚实性缺陷在合同层面关死，而不是在组件里打补丁（§10 逐条对应）。

### 1.2 非目标（本稿明确不做）

- 不做 RBAC/成员/席位/门户、积分/计费/用量、PDF/PPT、公开 API/webhook、单一 SEO 分数、无证据的模型答案可见性监控、真实外部写入——全部是规格划定的 v0.4 外。
- 不做 LLM 意图路由：用户先选工具再说话。
- 不做 SSE/WebSocket：沿用 202 + 轮询。
- 不把公开工具引擎的输出自动变成 Finding 或 Action。
- 不改 Growth Map 的治理页（关键词库、竞品库、Topic、内链、外链），它们保留为「库」页。
- 不做任务归档/删除（`archived_at` 列先留着，归档 operation 另批）。

### 1.3 成功标准

- 主链能走完并可回读（每一步刷新页面后状态不变）：建 `audit` 任务 → Growth Audit run 轮询到 completed → 候选列表 → 确认一条（Finding review，Action 以 `candidate` 落地）→ 生成交付包 → 「要求修改」产生 revision 2 → 设为 ready（校验 valid）→ 批准 revision 2 → 排入计划（`candidate → planned`）→ 开始执行（执行状态事件 `in_progress`）→ 安排复查（`priorRunId` = 服务端由 `action.source_diagnostic_run_id` 推出的 `audit_runs.id`，不是 async run 的 id）→ 复查结果。
- 这条链有两层测试：mock e2e 证明界面接线，**真 Postgres 的集成测试**（`vitest --project integration`，仓库已有 `e2e/analysis-refresh.real.integration.vitest.ts` 先例）证明包装命令的事务、幂等重放、`priorRunId` 校验这些 mock 里能被写绿的东西。
- `pnpm verify:authority`、`verify:spec`、`verify:spec:test`、`implementation:check`、`contracts:check`、`openapi:lint`、`git diff --check` 全绿。
- 生产模式 CSP 冒烟通过（无 inline style）。
- 两个语种无缺 key（`{}` 参数门禁）。

## 2. 原型概念 → app 实体映射

| 原型概念（源码位置） | app 实体 / 合同 | 是否已有 | 说明 |
|---|---|---|---|
| 任务 `Task`（`tsk_*`，`state.tasks`） | `workbench_tasks` + `workbench_task_entries` | **新增** §3 | 任务 ↔ AsyncRun 一对多（一条 run 只属于一个任务，§3.2 部分唯一索引）；任务本身不存任何 run/Artifact 的状态副本 |
| 任务消息 / 追问 `sendFollowUp` | `workbench_task_entries.kind = user_message` | 新增 | 用户原话持久化；带 `operatorInstructions` 的生成命令由包装命令在同一事务写这条消息（§3.4） |
| 任务步骤 / 日志 `play()` | `AsyncRun.progress {phase,current,total,messageKey}` + `lastError` | 已有 | 步骤只来自 run 投影，不预生成（关掉原型 F23） |
| 任务「需要输入」/ 阻塞 | 两级预检读模型 `previewWorkbenchToolPreflight`（只读 POST，§3.4） | 新增 | 预检不通过则**不创建**；每次预检重新算全量缺口（关掉原型 F6） |
| 候选 `candidates` | `GrowthOpportunity`（`readiness = candidate/reviewable/confirmed`；身份是字符串 `opportunityKey`，detail 路径的 UUID 指 primary Finding） | 已有 | `listProjectOpportunities` 只读最新可读诊断 generation（已核 `opportunities.ts` `findLatestReadableRun`）；确认只能走 `reviewProjectFinding` |
| 选择候选 | `reviewProjectFinding` + `ReviewFindingRequest {baseRevision, reviewState: confirmed}` → 同事务 upsert Action，初始 `status ∈ candidate/blocked`（低置信度硬门，已核 `packages/engine/src/priority.ts`） | 已有 | 任务里追加 `finding_ref` + `action_ref`；`candidate` 级机会没有 primary Finding，只能追加 `opportunity_ref`，不能「确认」 |
| 交付包 `package`（v1/v2，`sections`） | `Artifact`（`artifactType ∈ content_brief/metadata_rewrite/technical_ticket/english_blog_draft`）+ `ArtifactRevision` | 已有 | 原型「优化交付包」= `metadata_rewrite`；「内容简报」= `content_brief`；「英文稿」= Content Shadow 产出。生成只拒绝 `dismissed` 的 Action（已核 `artifacts.ts`），`candidate` 也能生成 |
| 交付包版本号 `version` | `ArtifactRevision.revision` | 已有 | 单调递增、不可变、带 `contentHash` |
| 局部修改 `revisePackage` / 「要求修改」 | `createActionArtifact` REGENERATE 语义 + `operatorInstructions`（≤4000） | 已有 | 同 action+type 再次创建 = 复用 id、追加 revision |
| 手工改一段 | `updateProjectArtifact`（content 分支）→ `generated_by = operator` 新 revision，`baseRevision` CAS，409 `STALE_REVISION` | 已有 | 编辑后回到 `draft` |
| 变更清单 `changes` | `TaskView` 里对同一 Artifact 相邻两版 JSON 内容做 key 级 diff（服务端派生，不存储，§3.3） | 新增（读模型字段） | markdown 版只给「本版有改动」布尔 |
| 逐版审核 `approve` | `appendArtifactApprovalEvent` `{eventKind: approved, artifactRevisionId, expectedArtifactRevision, expectedQaGateVersion, customerAcknowledgementInput}`；前置：当前版 `ready` 且 `valid` | 已有 | revoked/superseded 不删历史；快照逐字段引用 |
| 交付包能否采纳 | `Artifact.adoption {blocked, blockingClaimIds}`（Content Shadow QA 门） | 已有 | `null` 不等于「允许」，界面不得这么画 |
| 行动六态 | `Action.status` 六态为主标签 + 交付包生命周期/批准绑定/执行流/复查四个独立切面（§5） | 已有 + 派生 | 原型六态里「已上线/待上线」没有事实来源，不显示 |
| 执行中心「开始/完成/受阻」 | `updateActionExecutionState`（`in_progress/completed/blocked` 三个 discriminated 请求，带 `expectedRevision`）；Action 级与 per-Artifact 两条流（`artifactId = null` 为 Action 级，已核） | 已有 | 与 `Action.status` 永不隐式聚合（已核 `action-execution-state.ts`） |
| 安排复查 `resume`/复查中 | `createActionRecheck {actionId, priorRunId, targetScope, capabilityContractVersion: "growth-audit.0.3.0"}`；`priorRunId` 是 **`audit_runs.id`**（自有主键，不是 async run id；`createGrowthAuditRun` 的 202 用 `resourceRef {type: audit_run}` 带出，`AsyncRun.resultRef` 枚举里没有 `audit_run`，已核），且 `action.source_diagnostic_run_id === priorRun.diagnostic_run_id`（已核 `action-recheck.ts`）；服务端用 `AuditRunsRepository.findByDiagnosticRunId(action.source_diagnostic_run_id)` 推出并放进 `TaskView.action_ref.recheckPriorRunId`，客户端不猜；结果 `ActionRecheckResultsResponse.rules[]`：`priorStatus/currentStatus ∈ pass/candidate/skipped/inconclusive`、`state ∈ verified/observed/insufficient_data`、`disposition ∈ resolved/unchanged/unknown`、`label`；顶层 `limitations[]` | 已有 | 只报技术规则条件；`disposition = unknown` 与 `state = insufficient_data` 原样显示 |
| 效果 | `MeasurementWindow`；`createProjectMeasurementWindow`（专用 202）需要 exact verified Change Receipt | 已有 | 本稿不假定环境里存在合格 receipt；没有时创建不可用，界面显示 unavailable/尚未连接，不得写「已发布」 |
| 项目资料 `ctxSections`（产品/受众/竞品/冲突） | `ConfirmedProductProfile`（`confirmedIcpProfileVersion`）+ `competitorCandidates[].reviewStatus ∈ candidate/approved/excluded` + `conflictingFields`/`fieldProvenance.derivation = contradicted` | 已有 | 「只把已确认资料当事实」= 只读 confirmed 版本 + `approved` 竞品 |
| 数据来源开关 `srcState` | `SourceConnection.state`（9 态）+ `latestSnapshot` + `featureEnabled` | 已有 | `connected ≠ available`；运行输入是精确 snapshot，不是布尔开关 |
| DataForSEO 开关 | 无客户侧开关；DFS 是 Analysis Refresh 的 server-owned 步骤 | 已有 | 界面只显示「服务端会否包含」的只读说明 |
| 下一步 handoff `startTool(toolId)` | `WorkbenchHandoff`（typed，§6） | 新增 | 消费端校验，缺字段拒绝，不默认、不改写 |
| 引用/证据栏 `evidence` | `Evidence`（五维：`origin/method/grade/availability/support`）+ `subjectRefs` | 已有 | 证据只来自 Finding/Action 挂载的 Evidence，不复制报告表格 |
| 概览四卡 | `getProjectWorkspaceView` → `OverviewView` | 已有 | 任务首页的「项目状态条」直接消费这个读模型 |
| 积分 `credits`、成员、分享、智能体、技能页 | 无 | 删除 | 规格 v0.4 外 |

## 3. 任务合同（新增 authority）

### 3.1 设计原则

1. **引用不复制。** 任务条目只存外键与用户原话；run 状态、Artifact 内容、审核结论、Action 状态全部读取时从 canonical 表拼装。任务表没有 `status` 列（和 `ContentShadowRunSummary` 的 state-free 原则一致）。
2. **用户的话是唯一新事实。** `user_message` 是任务表里唯一的新内容。带 `operatorInstructions` 的生成命令，由包装命令在同一事务写一条 `user_message`（内容取自该字段），客户端不再单独发，两边不会分叉。
3. **一个事务一次副作用。** 在任务里发起的异步命令，用一个包装命令在同一事务里调用既有 service 内核（写 run/domain/idempotency/pg-boss job）并追加 `run_ref` 条目。这要求 7 个既有 service 先拆出接收 `(tx, …)` 的内核（§12 A3）；隔离级别沿用各自现状，pg-boss 入队沿用已有 `enqueueRunInTx`。
4. **阻塞不落库。** 预检不通过就不建任务、不发命令；界面上的「缺 X，去连接」来自预检读模型，不是任务状态。
5. **一条 run 只属于一个任务。** 从旧页面发起的 run 不属于任何任务，任务视图不去认领。

### 3.2 表（ordered migration `0054_workbench_tasks.sql`，A2 的一列并入同一迁移）

```sql
CREATE TABLE IF NOT EXISTS app.workbench_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,   -- 冻结 primary Site
  tool_id text NOT NULL CHECK (tool_id IN (
    'audit','collect','refresh','deliverable','draft','recheck','export')),  -- v1 闭合词表，§7.2
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  handoff jsonb,                               -- 创建时携带的 WorkbenchHandoff 快照（§6），可空
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,                     -- v1 不写；归档 op 另批
  next_seq integer NOT NULL DEFAULT 1 CHECK (next_seq >= 1),  -- 条目序号计数器：UPDATE … RETURNING 分配，不用 max(seq)+1（RR 快照下会撞号）
  UNIQUE (workspace_id, project_id, id)        -- 供条目表的复合外键引用
);
CREATE INDEX IF NOT EXISTS workbench_tasks_project_idx
  ON app.workbench_tasks(project_id, created_at DESC, id DESC);

-- 父表复合唯一约束：供下表的三列外键引用。父表 id 已是主键，这里只多一个索引，不改语义。
-- 写法照抄既有迁移给 actions 补 actions_workspace_project_id_key 的幂等保护（已核 schema.sql）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'async_runs_workspace_project_id_key') THEN
    ALTER TABLE app.async_runs
      ADD CONSTRAINT async_runs_workspace_project_id_key UNIQUE (workspace_id, project_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostic_runs_workspace_project_id_key') THEN
    ALTER TABLE app.diagnostic_runs
      ADD CONSTRAINT diagnostic_runs_workspace_project_id_key UNIQUE (workspace_id, project_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'findings_workspace_project_id_key') THEN
    ALTER TABLE app.findings
      ADD CONSTRAINT findings_workspace_project_id_key UNIQUE (workspace_id, project_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.workbench_task_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (kind IN (
    'user_message','run_ref','opportunity_ref','finding_ref','action_ref','handoff_out')),
  body text CHECK (body IS NULL OR length(body) <= 4000),
  run_id uuid,
  command_kind text CHECK (command_kind IS NULL OR command_kind IN (
    'growth_audit','collection','analysis_refresh','artifact_generation',
    'content_shadow','recheck','export')),     -- 包装命令写入；区分同为 kind=diagnostic 的 Growth Audit 与复查 run
  opportunity_key text,                        -- 机会没有落库表：GrowthOpportunityBase.opportunityKey 是读模型派生键，无 FK
  diagnostic_run_id uuid,                      -- opportunity_ref 必带：该键在哪个冻结 generation 里被读到
  finding_id uuid,
  action_id uuid,                              -- run_ref 在 command_kind ∈ artifact_generation/content_shadow/recheck 时也带
  handoff jsonb,
  target_task_id uuid,                         -- handoff_out 必带：交给了哪条任务
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 租户一致：条目与任务同 workspace/project；引用对象同 workspace/project（沿用既有复合外键写法，如 measurement 表）
  FOREIGN KEY (workspace_id, project_id, task_id)
    REFERENCES app.workbench_tasks(workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, run_id)
    REFERENCES app.async_runs(workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, diagnostic_run_id)
    REFERENCES app.diagnostic_runs(workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, finding_id)
    REFERENCES app.findings(workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, action_id)
    REFERENCES app.actions(workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, target_task_id)
    REFERENCES app.workbench_tasks(workspace_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (task_id, seq),
  -- 每种 kind 只允许自己的列非空，其余必须为空
  CHECK (
    (kind = 'user_message'    AND body IS NOT NULL AND run_id IS NULL AND command_kind IS NULL
       AND opportunity_key IS NULL AND diagnostic_run_id IS NULL AND finding_id IS NULL
       AND action_id IS NULL AND handoff IS NULL AND target_task_id IS NULL)
 OR (kind = 'run_ref'         AND run_id IS NOT NULL AND command_kind IS NOT NULL AND body IS NULL
       AND opportunity_key IS NULL AND diagnostic_run_id IS NULL AND finding_id IS NULL
       AND handoff IS NULL AND target_task_id IS NULL
       AND ((command_kind IN ('artifact_generation','content_shadow','recheck')) = (action_id IS NOT NULL)))
 OR (kind = 'opportunity_ref' AND opportunity_key IS NOT NULL AND diagnostic_run_id IS NOT NULL
       AND body IS NULL AND run_id IS NULL AND command_kind IS NULL AND finding_id IS NULL
       AND action_id IS NULL AND handoff IS NULL AND target_task_id IS NULL)
 OR (kind = 'finding_ref'     AND finding_id IS NOT NULL AND body IS NULL AND run_id IS NULL
       AND command_kind IS NULL AND opportunity_key IS NULL AND diagnostic_run_id IS NULL
       AND action_id IS NULL AND handoff IS NULL AND target_task_id IS NULL)
 OR (kind = 'action_ref'      AND action_id IS NOT NULL AND body IS NULL AND run_id IS NULL
       AND command_kind IS NULL AND opportunity_key IS NULL AND diagnostic_run_id IS NULL
       AND finding_id IS NULL AND handoff IS NULL AND target_task_id IS NULL)
 OR (kind = 'handoff_out'     AND handoff IS NOT NULL AND target_task_id IS NOT NULL AND body IS NULL
       AND run_id IS NULL AND command_kind IS NULL AND opportunity_key IS NULL
       AND diagnostic_run_id IS NULL AND finding_id IS NULL AND action_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS workbench_task_entries_task_idx
  ON app.workbench_task_entries(task_id, seq);
-- 一条 run 只属于一个任务（§3.1 第 5 条）
CREATE UNIQUE INDEX IF NOT EXISTS workbench_task_entries_one_task_per_run_idx
  ON app.workbench_task_entries(run_id) WHERE kind = 'run_ref';

-- A2：revision 关联 run（可空；不对历史行追溯执法；手工编辑的版本必须为空）
ALTER TABLE app.artifact_revisions ADD COLUMN IF NOT EXISTS async_run_id uuid
  REFERENCES app.async_runs(id) ON DELETE RESTRICT;
ALTER TABLE app.artifact_revisions ADD CONSTRAINT artifact_revisions_operator_has_no_run
  CHECK (generated_by <> 'operator' OR async_run_id IS NULL);
```

复合外键需要父表有 `(workspace_id, project_id, id)` 唯一约束。已核 schema.sql：`actions` 已有（`actions_workspace_project_id_key`）；`async_runs`、`diagnostic_runs`、`findings` 没有，上面的 `DO` 块在建条目表之前补上；`workbench_tasks` 建表时自带。`measurement` 系列表的复合外键是同款写法。

条目里**没有** `artifact_revision_ref`：哪一版由哪次运行产生，读取时从 `run_ref(command_kind = artifact_generation).run.resultRef` 与 A2 那一列推出，不靠客户端「成功后补条目」（否则用户关掉页面这条就永远缺了）。

同步更新：`authority/implementation-spec-v0.4/schema.sql`、`schema-smoke.sql`、schema catalog、`packages/db/src/schema.ts` + repository、`scripts/spec-v0.4-lock.json`（`migrationHead → 0054`，`tables 84 → 86`）。

### 3.3 派生读模型（不落库）

```text
TaskSummary = task 行 + decidingRun(AsyncRun | null) + phase
phase 按下面顺序从上往下，第一条命中即停；decidingRun 就是命中那一条所依据的 run（按 seq 取最后一条满足条件的）：
  active     任一 run_ref 的 run.status ∈ {queued, running}
  failed     seq 最大的 run_ref 的 run.status ∈ {failed, cancelled}
  partial    seq 最大的 run_ref 的 run.status = partial
  completed  seq 最大的 run_ref 的 run.status = completed
  open       没有 run_ref
```

`phase` 只回答「这条线程现在有没有东西在跑、最后一次跑成没成」。「交付包待审核」「行动进行中」这类状态**不属于任务**，它们在右栏按各自实体显示（§5）。v1 的列表过滤枚举只有这五个值。

`TaskView = task + entries[]（按 kind 水合）+ deliverables[] + derivedEvents[]`：

- `run_ref` → `AsyncRun` + `commandKind` + `actionId`；
- `finding_ref` → `Finding`；`action_ref` → `Action` + Action 级执行状态流最新事件 + `recheckPriorRunId`（服务端 `findByDiagnosticRunId(action.source_diagnostic_run_id)` 推出的 `audit_runs.id`，没有则 null）+ `activeRecheckRunId`（= 本任务内 `command_kind = recheck` **且 `run_ref.action_id` = 该 action** 且 `queued/running` 的 run；从旧页面发起的复查不在此列，界面说明「本任务内」）+ §5 四个切面的**原始输入**（Artifact 状态/校验态、approval ledger 摘要、执行流最新事件、复查 run 状态），前端只做映射；
- `opportunity_ref` → 只拿 `opportunityKey` 去**当前**最新可读 generation 里查（现有读模型没有按 `diagnosticRunId` 读历史 generation 的路径，已核 `opportunities.ts`）；查不到时显示「该候选在当前诊断里已不存在（记录于 generation <id>）」，不消失；
- `deliverables[]` = 本任务里 `artifact_generation` run 产生的 Artifact，**加上** `content_shadow` run 经 `resourceRef {type: flow_shadow_run}` 关联到的 `english_blog_draft` Artifact（它只由 Content Shadow worker 铸造，已核 schema.sql 注释与 `run-content-shadow.ts`；A2 列也要由该 worker 写入），各自带 revision 列表。相邻两版附 `revisionDiff {fromRevision, toRevision, changed: boolean, changedFields: string[] | null}`：JSON 内容比较顶层 key 得 `changedFields`；markdown/csv 只给 `changed`、`changedFields = null`。来源标签四种（单测穷举）：`operator` → 「手工编辑」（CHECK 保证无 run）；`template/llm` + `async_run_id` 属于本任务 → 「本任务第 N 次运行」；`template/llm` + `async_run_id` 属于别的任务或旧页面 → 「其他运行」带链接；`template/llm` + NULL → 「来源未记录」（旧行）；
- `recheckResults[]`：本任务每个 `command_kind = recheck` 且终态为 `completed` 或 `partial` 的 run 各一份，形状同 `ActionRecheckResultsResponse`。现有 `getProjectResults` 只返回项目级最新一次复查（已核 `recheck-results.ts` `findLatestByProjectionVersion`），所以这是 TaskView 的新字段（A4），服务端按 audit run id 读同一份 rule ledger 投影；
- `derivedEvents[]` 由关联对象**读取时**生成：approval event（approved/revoked/superseded，`superseded` 与 `revoked` 在这里分开显示）、Action 状态变更（读 `app.action_override_audit` 的 `old_values/new_values/reason/actor_id/created_at`，已核 schema.sql:618；§1.3 的「排入计划」就靠它在线程里出现）、执行状态事件、复查结果就绪。它们有自己的时间戳与 actor，不需要再写一条任务条目。

### 3.4 Operation（新增 6 个）

| operationId | 方法 / 路径 | 请求 | 响应 | 备注 |
|---|---|---|---|---|
| `listWorkbenchTasks` | `GET /projects/{projectId}/tasks?cursor&limit&phase` | — | `TaskSummary[]` + cursor | 游标键 `(created_at, id)` 降序；`phase` 是派生值，实现为「按游标取一页再过滤」，一页可以不满、`nextCursor` 仍前进（与 `opportunities` 同款 cursor 契约） |
| `createWorkbenchTask` | `POST /projects/{projectId}/tasks` | `{toolId, title?, message?, handoff?}` | 201 `Task` | 需 `Idempotency-Key`。服务端先跑**工具级**预检（§3.4.1），不通过返回已有 `Problem` 形状的 422（`Problem` 是闭合对象，没有顶层 `missing`）：`code = TOOL_PRECONDITION_MISSING`，每个缺项一条 `errors[] {pointer, code: "MISSING_<KIND>", message}`（pointer 规则见 §3.4.1）。`requiredHandoffFields` 非空的工具（§7.2：`deliverable`/`draft`/`recheck`）**必须带 `handoff`**，否则一条 `MISSING_HANDOFF@/handoff`；composer 直接发起时 handoff 的 `sourceTaskId/sourceEntrySeq` 为 null（§6）。**带 `handoff.actionId` 时同一事务追加一条 `action_ref`**，这三种任务后续命令里的 `actionId` 必须等于它（不等 → 422 `VALIDATION_ERROR`，pointer `/command/request/actionId` 或 `/command/actionId`）。`title` 省略时服务端按项目 `defaultDeliveryLocale` 生成并**存死**（不随界面语言变）：`<taskTools.<toolId> 标签> · <message 前 60 字>`，无 message 则 `<标签> · <YYYY-MM-DD>`；`defaultDeliveryLocale` 不是 en/zh-CN 时标签回退 en（消息目录只有这两种，避免把 key 路径存进标题）。`handoff.sourceTaskId` 非空时在同一事务给来源任务追加 `handoff_out`（含 `target_task_id`）；来源任务不在同项目或 `sourceEntrySeq` 在来源任务里不存在 → 404 |
| `getWorkbenchTask` | `GET /projects/{projectId}/tasks/{taskId}` | — | `TaskView` | 跨租户 404 |
| `appendWorkbenchTaskEntry` | `POST /projects/{projectId}/tasks/{taskId}/entries` | `{kind ∈ user_message/opportunity_ref/finding_ref/action_ref, ...}`（discriminated） | 201 `TaskEntry` | 需 `Idempotency-Key`（重放返回同条目，条目数不变）。`run_ref`、`handoff_out` 不开放给客户端。引用的 finding/action/diagnostic run 不在同项目 → 404。`seq` 分配：`UPDATE workbench_tasks SET next_seq = next_seq + 1 WHERE id = $1 RETURNING next_seq - 1`；包装命令写条目也走同一句。串行化失败（40001）会中止整个事务，所以重试粒度是**整个包装事务从 prepare 起重来**，≤ 3 次，耗尽后返回 409 `VERSION_CONFLICT`（注册表既有 409 码，已核 `problem.ts`），客户端可重发同一 `Idempotency-Key` |
| `createWorkbenchTaskRun` | `POST /projects/{projectId}/tasks/{taskId}/runs` | `{command}`（discriminated union，§3.4.2） | **202 `AsyncAcceptedResponse`** | 第 11 个 shared `AsyncAccepted`。需 `Idempotency-Key`（透传给被包装 service 的幂等 scope）。先跑**命令级**预检（§3.4.1）；同事务：调用既有 service 内核 → 追加 `run_ref(command_kind, action_id)` → 若命令带 `operatorInstructions` 再追加一条 `user_message`。既有 service 透传出来的 422 `VALIDATION_ERROR`，其 `errors[].pointer` 是相对内层请求体的（如 `/artifactType`），包装命令统一加前缀 `/command/request` |
| `previewWorkbenchToolPreflight` | `POST /projects/{projectId}/tasks/preflight`（只读，无副作用，不需要 `Idempotency-Key`） | `{toolId, handoff?}`（工具级，与 `createWorkbenchTask` 同构）或 `{taskId, command}`（命令级，与 `createWorkbenchTaskRun` 同构） | `{ready, missing[]}` | 用 POST 是因为 GET 装不下 `handoff`/`command`；`missing[].kind ∈ profile/source/snapshot/action/artifact/prior_run/brief/handoff`，每条带 `pointer` + `code`（与 422 的 `errors[]` 按 `(pointer, code)` 一一对应）与 `remedyHref` |

#### 3.4.1 两级预检

| 级别 | 何时跑 | 检查什么 | 输入 |
|---|---|---|---|
| 工具级 | `createWorkbenchTask`、预检 POST 的 `{toolId, handoff?}` 形 | 该 `tool_id` 的通用前提（§7.2「工具级前提」列）+ `requiredHandoffFields` | 与 create 请求体同构 |
| 命令级 | `createWorkbenchTaskRun`、预检 POST 的 `{taskId, command}` 形 | 该 command 的**缺失前提**（§7.2「命令级前提」列） | 与 run 请求体同构 |

两级都返回同一形状；422 的 `errors[]` 与预检的 `missing[]` 按 `(pointer, code)` 一一对应（同一缺口两处都出现，缺一处即红）。`pointer` 是请求体里的 JSON pointer（如 `/handoff/actionId`、`/command/request/priorRunId`），同一个对象在不同命令里的 pointer 不同，所以比对键必须带 `code`。

预检**只报「缺」**，不报「不合法」也不报「冲突」：字段合法性（`scope`、`artifactType` 与模板一致、locale、`targetUrl` 越出 Site host）由既有 service 或包装命令以 `VALIDATION_ERROR` 422 报，且**先于预检**返回；活跃运行冲突由既有 service 以 `RUN_ALREADY_ACTIVE` 409 报并原样透传（§3.4.3）。否则预检会把 409 挡在前面，§14 的「409 透传」用例就只能在竞态下出现。

`pointer` 的三条规则（`Problem.errors[].pointer` 是必填）：

1. 项目状态类缺口（`profile/source/snapshot/artifact`）在请求体里没有对应字段，pointer 固定为空串 `""`（JSON pointer 的根）。
2. handoff 整体缺失 → 一条 `MISSING_HANDOFF@/handoff`；handoff 在而某必填字段为 null → 只报一条 `MISSING_<KIND>@/handoff/<field>`（如 `MISSING_ACTION@/handoff/actionId`），不再叠加 `MISSING_HANDOFF`。
3. 命令级缺口指向命令体：`MISSING_PRIOR_RUN@/command/request/priorRunId`、`MISSING_BRIEF@/command/request/contentBriefRevision` 等。

#### 3.4.2 `command` union

只包既有请求体，不发明新字段：

```text
{ kind: "growth_audit",        request: CreateGrowthAuditRunRequest }        // §7.2 audit 工具
{ kind: "collection",          request: CreateCollectionRunRequest }
{ kind: "analysis_refresh",    request: CreateAnalysisRefreshRunRequest | null }   // 该 op 的 requestBody 本就可省略
{ kind: "artifact_generation", actionId, request: CreateArtifactRequest }    // actionId 在既有 op 的路径里，故外层带
{ kind: "content_shadow",      request: CreateContentShadowRunRequest }      // actionId 在 request 内
{ kind: "recheck",             request: CreateActionRecheckRequest }         // actionId 在 request 内；不再外层重复
{ kind: "export",              request: CreateExportRequest }
```

不进 union 的 3 个既有异步命令及理由：`createDiagnosticRun`（不写 `audit_runs` 行，产出的 run 不能做复查的 `priorRunId`，任务里一律用 Growth Audit）；`createProductProfileSynthesisRun`（属于画像页/onboarding，画像确认是一切任务的前提，不在任务里跑）；`importProjectSourceFile`（multipart 文件上传，不是 JSON 命令，留在 Sources 页）。

`tool_id → 允许的 command kind`（越界返回 422 `COMMAND_NOT_ALLOWED_FOR_TOOL`）：

| tool_id | 允许的 command kind |
|---|---|
| `audit` | `growth_audit`、`artifact_generation`、`content_shadow`、`recheck`、`export`（主线全在这一个任务里） |
| `collect` | `collection` |
| `refresh` | `analysis_refresh` |
| `deliverable` | `artifact_generation`、`export` |
| `draft` | `content_shadow` |
| `recheck` | `recheck` |
| `export` | `export` |

#### 3.4.3 包装命令的三种冲突

内核的边界（已核既有 service 的结构）：既有 service 在**事务之前**依次做校验/派生（如 `action-recheck.ts` 的 `loadRecheckContext` 先于重放查找，`artifacts.ts` 的模板 locale 归一化与 `assertOperatorMintable`）、幂等查找、活跃预检；**事务体内**还有一条 `if (!reserved) { … return replayed }` 的并发重放分支（七个都有，已核）；在**事务中止之后**按各自的唯一索引清单（active-key 索引，`artifacts.ts` 还认 `execution_artifacts_one_active_type_idx`）捕获 23505 转成 409。所以拆成三段：

- `prepare(...)` helper：按各 service 原有顺序做校验、归一化、哈希派生、重放查找、活跃预检；
- 内核 = 事务体，入参是 prepare 的产物，返回 `{replayed: boolean, run}`（事务内的并发重放分支也走这个返回值）；
- `toConflictProblem(err)` helper：按各 service 原有的唯一索引清单做 409 转换。

包装命令的顺序：prepare → 开包装事务（内核 → 看 `replayed` 决定追不追加条目 → 条目）→ 提交；任何 23505 让整个包装事务回滚（条目随之消失）→ 409 转换。

| 情形 | 行为 |
|---|---|
| `Idempotency-Key` 重放（既有 service 按 `(workspace, scope=其 operationId, key)` + 请求哈希判重放，已核；哈希规则各入口不同，原样保留），不论命中在 prepare 还是事务内并发分支 | `run_id` 已挂在**同一任务** → 不追加，原样 202，条目数不变 |
| 重放出的 run 已挂在**别的任务**，或**没挂在任何任务**（旧页面用过的 key 再发到包装命令；§3.1 第 5 条不认领） | 409 `RUN_ALREADY_ATTACHED`，包装事务回滚，不追加。事务内并发重放时 23505 会落在 `workbench_task_entries_one_task_per_run_idx` 上，409 转换 helper 也要认这个索引 |
| `active_key` 冲突（`async_runs_one_active_key_idx`：同项目、同非空 `active_key` 最多一个 `queued/running` run；既有 service 抛 `RUN_ALREADY_ACTIVE`，`current.runId` 在竞态分支可能为 null，已核） | 包装事务回滚后转 409 原样透传，**不追加** `run_ref`；界面拿 `current.runId` 显示「已有一次同类运行在跑」，该 run 可能属于别的任务或旧页面 |

限流 scope（如 `growth_audit_recheck`）沿用被包装的 service。

**决定性的取舍：** 为什么不给 10 个既有异步请求体各加一个 `taskId`？因为它们全是 `additionalProperties: false` 的冻结合同，改 10 处的锁与生成物，代价大于加 1 个包装命令；而且包装命令让「在任务里发起」和「在旧页面发起」的 run 都是同一种 run，任务只是多了一条引用。代价是 7 个 service 要拆内核（§12 A3），这是本稿最大的一项实现工作量。

### 3.5 生命周期

- 创建：`createWorkbenchTask`（可带首条 `user_message`）。
- 推进：`createWorkbenchTaskRun` / `appendWorkbenchTaskEntry`。人类决定**继续走各自已有 route**；其中只有「确认 Finding」需要任务视图在成功后追加 `finding_ref` + `action_ref`（追加失败不回滚已成立的决定，界面可重试，幂等）；批准 revision、改 Action 状态、执行状态事件三类**不写条目**，由 `derivedEvents[]` 读取时呈现（§3.3）。
- 归档、删除：v1 不提供。

## 4. 交付包 = Artifact revision

### 4.1 三种「改」

| 用户动作 | 合同 | 产生的 revision | 回到什么状态 |
|---|---|---|---|
| 「要求修改：把标题改短」 | `createWorkbenchTaskRun {command: {kind: artifact_generation, actionId, request: {artifactType, generationMode, outputLocale, operatorInstructions: <用户原文>}}}` | worker 追加 `generated_by ∈ template/llm` 的新版 | `generating → draft` |
| 直接改一段 | `updateProjectArtifact {baseRevision, contentFormat, content, editorNote}` | `generated_by = operator` | `draft`；旧批准绑定的是旧 revision，因而不再适用于当前版（派生事实，不是自动追加的 `superseded` 事件） |
| 重新生成 | 同第一行，不带指令 | 新版 | 同上 |

规则：

- 生成中（`Artifact.activeRun` 非空）禁止再发起生成，界面按 Studio 的 generation fence 处理（按钮保持可用、`role=alert` 解释原因，不是灰掉不解释）。
- 「变更清单」由 `TaskView.deliverables[].revisionDiff` 给出（§3.3）。**不允许**像原型那样只升版本号不变内容。
- `outputLocale` 用模板生成只支持 en/zh-CN，其他语种必须 `structured_llm`（已有规则，界面照抄 Studio 的提示）。

### 4.2 审核

- 批准的前置条件（已有 route 描述，已核）：当前 revision 必须是 `ready` 且 `validationState = valid`。生成/编辑后回到 `draft`，所以完整链条是 `draft → updateProjectArtifact {baseRevision, status: ready} → appendArtifactApprovalEvent approved`；`draft → ready` 受 Content Shadow adoption 门约束。右栏要把「设为 ready」和「批准」画成两步，不能合成一个按钮。
- 「批准这一版」= `appendArtifactApprovalEvent` approved，请求体带 `artifactRevisionId + expectedArtifactRevision + expectedQaGateVersion + customerAcknowledgementInput`。任何一项与服务端当前不符 → 409，界面刷新后重新展示再让用户确认（[[a-confirmation-authorizes-what-was-shown]]：确认授权的是弹框那一刻的内容，不是一个布尔）。
- 批准后再改 → 新版；旧批准绑定的是第 2 版，右栏必须画出「批准的是第 2 版，当前是第 3 版」。是否追加 `superseded` 终止事件由人显式决定（`appendArtifactApprovalEvent {eventKind: superseded}`），编辑与重新生成都不会自动追加（`artifact-update.ts`、`artifacts.ts`、worker `run-artifact.ts` 均无此副作用，已核）。「不再适用」与「已 superseded」是两个不同事实，界面分开画。
- `Artifact.adoption.blocked = true` 时「设为 ready」按钮保持可用但点击后显示阻塞的 `blockingClaimIds`；`adoption = null` 只表示没有质量门，不能画成「可采纳」。

## 5. 行动显示态：一个主标签 + 四个切面

原型六态（待审核/待开始/进行中/待上线/已上线/复查中）不是一个枚举能表达的，它混了四种事实。本稿改成：**主标签 = `Action.status`（六态，总函数，永远恰好一个）**，外加四个互相独立的切面（每个切面在自己的输入上也是总函数，有优先级的写明优先级）。原型六态的每一个都能表达成主标签 + 切面的组合（末表），「已上线/待上线」没有事实来源，不出现。

| 层 | 取值 | 事实来源 |
|---|---|---|
| 主标签 | `candidate`（候选）/ `planned`（已排入计划）/ `in_progress`（进行中）/ `blocked`（受阻）/ `done`（已关闭）/ `dismissed`（已忽略，默认过滤） | `Action.status`；改动只走 `updateProjectAction {baseRevision, status, reason ≥ 3 字}`，沿用 `_action-status-transitions.ts` 冻结图 |
| 切面 A1 交付包生命周期 | 对**本任务 `deliverables[]` 里该 Action 的每个 Artifact**各算一个（没有 Artifact 就没有这行）：`generating` / `draft` / `ready` / `failed` / `archived`，= `Artifact.status` 原值（总函数）；另带一个独立布尔 `invalid`（`validationState = invalid`），不是第六个值 | `Artifact.status/validationState` |
| 切面 A2 批准绑定 | 同上逐 Artifact，按优先级从上往下第一条命中：`current`（存在绑定当前 revision、未被 revoked/superseded 终止的 `approved`）→ `terminated`（**存在**绑定当前 revision 的 `approved`，**且**全部已被终止；不能写成「全部已终止」，空集会让它空真）→ `stale`（存在绑定旧 revision、未被终止的 `approved`，且当前 revision 无任何 `approved`）→ `none`。§14 的六种 ledger 形状依次落到 none / current / terminated / stale / current / none。终止是 revoked 还是 superseded，由 `derivedEvents[]` 分开显示，切面不区分 | approval ledger（事件精确绑定 revision，所以旧版批准天然不算当前版） |
| 切面 B 执行流 | Action 级流最新事件：`none` / `in_progress` / `blocked`（带 `blocker`）/ `completed`；per-Artifact 流各自显示在该 Artifact 卡片内 | `getActionExecutionStateTimeline`（`artifactId = null` 为 Action 级）；与主标签永不聚合 |
| 切面 C 复查（本任务内、该 action） | 按优先级：`running`（`activeRecheckRunId` 非空）→ `completed` / `partial` / `failed` / `cancelled`（该 action 按 `seq` 最后一条复查 `run_ref` 的终态，四值与 `RunStatus` 终态一一对应）→ `none`（本任务内没复查过） | `TaskView.action_ref.activeRecheckRunId` + 本任务 `command_kind = recheck` 且 `action_id` 相同的 run 状态 + `TaskView.recheckResults[]` |

原型六态的对照（A1/A2 逐 Artifact 计算：对照按「该 Action 在本任务里的每个 Artifact 卡片」逐个成立；Action 级摘要取**任一** Artifact 满足即显示该态，多个 Artifact 同时满足不同态时并列显示）：

| 原型态 | 主标签 + 切面 |
|---|---|
| 待审核 | 任意主标签（通常 `candidate`）+ A1 = `ready` 且 `invalid = false` + A2 ∈ {`none`, `stale`, `terminated`} |
| 待开始 | `planned` + A2 = `current` + B = `none` |
| 进行中 | `in_progress`（B 通常 = `in_progress`；B 与主标签不一致时两者都照实显示，不合成） |
| 受阻 | `blocked`（B 的 `blocker` 作为说明） |
| 复查中 | 任意主标签 + C = `running` |
| 已上线 / 待上线 | 不显示：需要 verified Change Receipt，v0.4 无外部写入（规格 §6） |

「批准的是第 2 版，当前是第 3 版」（§4.2）= A1 = `draft` + A2 = `stale`，两个切面各说各的，不需要谁压过谁。

写入流分开：`Action.status` 走 `updateProjectAction`；执行状态事件走 `updateActionExecutionState`（`in_progress/completed/blocked` 三种 discriminated 请求，带 `expectedRevision`、`phase`、`nextStep`、`blocker`、`progress`）。「排入计划」= `updateProjectAction {status: planned, reason}`，是主链里一个显式的人类动作（§1.3），不由批准自动触发。

## 6. Typed Handoff

```text
WorkbenchHandoff (schemaVersion "workbench-handoff.0.1.0")
  sourceTaskId          uuid | null     从别的任务交接来时必填；composer 直接发起时为 null（此时不写 handoff_out）
  sourceEntrySeq        integer | null  与 sourceTaskId 同有同无：触发交接的那一条条目（不是 handoff_out 自己）
  sourceRunId           uuid | null     产生这次交接的 run（只作出处，不兼作复查的 priorRunId）
  sourceDiagnosticRunId uuid | null     冻结的诊断 generation
  findingId / actionId  uuid | null
  artifactId            uuid | null
  artifactRevision      integer | null  与 artifactId 同时有或同时没有
  targetUrl             uri | null      必须落在冻结 primary Site 的 host（含 www/apex 变体）内；不改写
  queries               string[≤20] | null   原样，不去重不裁剪
  profileVersion        integer | null  = Project.confirmedIcpProfileVersion
  market / language     MarketCode | LocaleCode | null
  sourceSnapshotIds     uuid[≤10] | null     这次交接所依据的精确快照
```

消费规则：

1. 每个工具在服务端声明 `requiredHandoffFields`（§7.2 表列）；**必填 = 非 null；数组必填时至少 1 项**。缺一个就 422（一条 `MISSING_<KIND>@/handoff/<field>`，§3.4.1 规则 2），**不用默认值、不用 fixture 补**（关掉原型 `compsFromContext` 回退 typeform/jotform、`startTool` 只传 toolId 两条 P0）。
2. `createWorkbenchTask` 带 `handoff` 且 `sourceTaskId` 非空时，同一事务：新任务写 `handoff` 快照；来源任务追加 `handoff_out {handoff, target_task_id}`。两处内容相同、各自不可变；「这次任务从哪来」读任务表，「我把它交给了谁」读来源条目的 `target_task_id`。`sourceTaskId` 为 null（composer 直接选了 `deliverable`/`draft`/`recheck` 并在选择器里挑了 Action/Artifact）时只写任务表。
3. `targetUrl` 不在冻结 primary Site 的 host 内 → 422 `VALIDATION_ERROR`，`errors[] {pointer: "/handoff/targetUrl", code: "HANDOFF_TARGET_OUT_OF_SITE"}`；这是合法性错误，不进预检的 `missing[]`，且先于预检返回（§3.4.1）。
4. 客户端只做镜像校验给即时反馈，服务端是权威。

## 7. 工具词表与波次

### 7.1 波 0（只读，不新增合同）

项目状态条（`OverviewView`）、来源状态（`SourceConnection`）、候选列表（`listProjectOpportunities`）、Finding/Action/Artifact 列表、复查结果、Results。

### 7.2 波 1（既有异步命令，v1 工具词表）

| tool_id | command kind → 既有命令 | 工具级前提（建任务时查） | 命令级前提（发命令时查） | requiredHandoffFields |
|---|---|---|---|---|
| `audit` | `growth_audit` → `createGrowthAuditRun {siteId, icpProfileId, scope, outputLocale, capabilityContractVersion}` | confirmed Product Profile（`profile`）；至少一个当前项目 crawl snapshot（`snapshot`） | 无缺失类前提（`scope`/`icpProfileId` 合法性由 service `VALIDATION_ERROR`） | 无 |
| `collect` | `collection` → `createCollectionRun {provider ∈ crawl/gsc/ga4, sourceConnectionId?, operation?}` | 无（crawl 总可发起） | gsc/ga4：对应 `SourceConnection` 不存在或 `state` 不可采集（`source`） | 无 |
| `refresh` | `analysis_refresh` → `createAnalysisRefreshRun` | confirmed Product Profile（`profile`；DFS 由服务端决定是否包含） | 无 | 无 |
| `deliverable` | `artifact_generation` → `createActionArtifact {artifactType, generationMode, outputLocale, operatorInstructions?}` | `handoff.actionId` 指向的 Action 存在且非 `dismissed`（`action`） | 同左；`artifactType` 与模板一致由 service 报 422，活跃运行由 service 报 409 | `actionId` |
| `draft` | `content_shadow` → `createContentShadowRun {actionId, searchCluster, outputLocale, capabilityContractVersion, contentBriefRevision?}` | `handoff.artifactId/artifactRevision` 指向的 `content_brief` revision 存在（`brief`） | 同左 | `actionId`、`artifactId`、`artifactRevision` |
| `recheck` | `recheck` → `createActionRecheck {actionId, priorRunId, targetScope, capabilityContractVersion}` | `handoff.actionId` 指向的 Action 存在且非 `dismissed`（`action`）；服务端能由 `action.source_diagnostic_run_id` 推出 `audit_runs` 行（`prior_run`；推不出 = 该 Action 来自普通 `createDiagnosticRun`，复查不可用） | `request.priorRunId` 必须等于推出的那一行（不等 → `VALIDATION_ERROR`）；活跃复查由 service 报 409 | `actionId` |
| `export` | `export` → `createProjectExport {kind ∈ service_bundle/client_bundle, outputLocale}` | 至少一个 `ready` Artifact（`artifact`，以现有 service 判定为准） | 同左 | 无 |

`missing[].kind` 与 `errors[].code` 的对应：`profile → MISSING_PROFILE`、`source → MISSING_SOURCE`、`snapshot → MISSING_SNAPSHOT`、`action → MISSING_ACTION`、`artifact → MISSING_ARTIFACT`、`prior_run → MISSING_PRIOR_RUN`、`brief → MISSING_BRIEF`、`handoff → MISSING_HANDOFF`。

原型「主线」不是一个工具，是 `audit` 任务里依次追加 `run_ref(growth_audit) → finding_ref → action_ref → run_ref(artifact_generation) → run_ref(recheck)` 的一条线程。复查的 `priorRunId` **不是**第一条 `run_ref` 的 run id，而是 `createGrowthAuditRun` 同时写下的 `audit_runs.id`（已核 `audit-runs.ts` 549–596 行在同一事务写 AsyncRun、DiagnosticRun、CapabilityRun、AuditRun）；界面从 `TaskView.action_ref.recheckPriorRunId` 取，填进命令体。Finding 取自「最新可读 generation」，它不一定来自本任务第一条 run，所以推导必须从 Action 出发而不是从任务出发。

### 7.3 波 2（共享 `packages/public-tools` 引擎进 app，需要新增合同）

`briefing`（daily-briefing）、`opportunity`（keyword-opportunity / quick-wins）、`drop`（traffic-drop）、`gap`（competitor-keyword-gap）、`linkaudit`（internal-link-audit）、`kwmap`（关键词机会的多阶段流程，逐项核）。

前提合同（本稿只定边界，另起附录稿）：新 `RunKind: tool_analysis`（scope 内 `toolId`）、一张 `tool_results` 不可变输出表（输出 JSON、依据的 snapshotIds、limitations、观察时间）、一个 `getToolResult` 读操作。硬约束：

- **GSC 身份**：只用项目 `SourceConnection` 与其 `latestSnapshot`，绝不用营销站 `gg_gsc` cookie；每次运行绑定 workspace + project + sourceRef + snapshot + 时间窗。
- **Product Profile 投影**：只传 confirmed 版本、`approved` 竞品；`candidate/excluded` 竞品不进输入。
- **输出是 Evidence，不是 Finding**：波 2 结果可以在右栏展示、可以 handoff，但不自动产生 Finding/Action；「提交为候选」要另立合同才做。

### 7.4 波 3（营销站私有库先抽包）

`pagecheck`（`apps/marketing/src/lib/on-page-checker`）、`citability`（`geo-tools/citability-*`）、`geobrief`/`visibility`（依赖 GEO KB v3——KB 在 app 中不存在）。**GEO 三件套在 KB 的归属、版本解析、发布/冻结状态、采样协议（公开工具 5 采样 vs app fixed-20）与费用合同进 authority 之前不开工**；否则就是规格排除的「无证据的模型答案可见性监控」。

## 8. 运行驱动的步骤渲染

- 轮询沿用 `useProjectRun`（1s → 2s → 4s → 5s，页面不在前台不轮询）；任务视图同一时间只轮询「当前任务里 queued/running 的 run」。
- 步骤条来自每种 **`command_kind`**（不是 `RunKind`：Growth Audit 与复查同为 `kind = diagnostic`）的静态 phase 表（i18n `taskSteps.<commandKind>.<phase>`）+ `progress.phase/current/total`。未知 phase 显示原始 phase 码并计入监控，不隐藏、不猜（[[nextintl-missing-key-renders-the-path]]：缺 key 会渲染成路径而不抛错，所以要用已知 phase 白名单兜底）。
- 终态：`completed` 正常；`partial` 显示「部分完成」，限制说明从 `resultRef` 指向的结果读模型取（如 `ActionRecheckResultsResponse.limitations`、`Coverage.limitations`、`DataSnapshot.limitation`；`AsyncRun` 本身没有 `limitations` 字段），该类结果没有限制字段时只显示状态；`failed/cancelled` 显示 `lastError.summary` 原文，`lastError` 为 null 时显示「失败，服务端未记录错误详情」，不翻译成好听的话。
- run 不存在之前没有步骤；run 结束后步骤条冻结为最后一次投影。没有「日志」概念。
- 数据截止日、观测时间只从 `DataSnapshot.capturedAt/sourceWindow` 与 `Evidence.observedAt` 取，同一屏只有一个口径（关掉原型 F24）。

## 9. IA、路由与导航

规格 §0 冻结了「四模块产品面」，因此本节任何一项都是 authority 变更（Owner 裁决 D2，已采纳推荐）。

采纳方案：

| 路由 | 用途 | 与现有的关系 |
|---|---|---|
| `/p/[projectId]/tasks` | 任务首页：左栏任务列表、中栏 composer、右栏项目状态条（`OverviewView`） | 成为根重定向目标；`/overview` 保留路由并 308 到 `/tasks`（兼容旧链接） |
| `/p/[projectId]/tasks/[taskId]` | 三栏：任务列表 / 线程 / 交付物面板（交付包、证据、行动、复查四个 tab） | 深链 `?entry=<seq>` |
| `/growth-map/*` | 库页不变 | 任务右栏的「在增长地图中查看」跳转目标 |
| `/execution`、`/plan`、`/studio` | 保留为深链目标（完整编辑器、批量状态） | 交付物面板只做单个 Artifact 的看/改/审；复杂编辑「在 Studio 中打开」 |
| `/results`、`/report` | 不变 | — |
| `/context`、`/sources`、`/setup-sources`、`/settings` | 不变 | 预检 `remedyHref` 指向这里 |

主导航：`任务 · 增长地图 · 执行 · 结果`（`任务` 占用原 `概览` 位；`apps/web/src/components/app-shell/nav-model.ts` 的 `PrimaryNavKey` 增加 `tasks`、`overview` 从主导航移除但路由保留）。

手机宽度：单栏 + 顶部两个 tab（线程 / 交付物）；任务列表折叠为抽屉。所有三栏在 1280px 以下自动降为两栏（列表折叠）。

## 10. 原型缺陷 → 合同关口

| 原型缺陷（评估报告编号） | 本稿关口 |
|---|---|
| 取消勾选 GSC 仍读 GSC（`srcExcluded` 不进 `buildRun`） | 输入是精确 snapshot / `sourceConnectionId`；没有布尔开关 |
| 待确认竞品进付费 DFS（`ctxMissing` 只查非空） | DFS server-owned；Profile 投影只传 `approved` |
| 单个竞品被换成 typeform/jotform | handoff 缺字段 422，无默认值 |
| 「对 /pricing 做单页检查」拿到别的查询（`startTool` 只传 toolId） | `WorkbenchHandoff.targetUrl/queries` 按工具必填校验 |
| 示例入口跑不出候选（只在 fixture） | 候选只来自 `listProjectOpportunities` |
| 追问只升版本、内容不变（F-doc） | revision 由 worker 产生；`revisionDiff` 派生；手工 PATCH 相同内容不产生新版（`artifact-update.ts` 已有规则，已核）；worker 重新生成得到相同内容是否追加版本**未核实**，PR-D 实施前定 |
| resume 只查首次缺失（F6） | 预检每次全量重算，两级都是 |
| 日志开跑前预生成（F23） | 步骤只来自 `AsyncRun.progress` |
| 各工具数据截止日互相矛盾（F24） | 单一口径：snapshot/evidence 时间戳 |
| 证据栏复制报告表格冒充观测（F22） | 证据只来自 `Evidence` |
| 可引用性报告自相矛盾（F25） | 波 3 不做 |
| composer 草稿跨项目携带 | 草稿以 `projectId` 为键存 `sessionStorage`；切项目即切草稿 |
| 阻塞原因是资料缺失却提示「先连接来源」 | `missing[].kind` 分八种，文案按 kind 分开；每条带 `remedyHref`（[[refusal-copy-needs-a-control]]：提示写「请先做 X」就得有 X 的按钮） |
| 数值列「—」排最前 | `unavailable` 排最后，tiebreak 用真数量（[[unknown-must-sort-last-and-tiebreaks-need-a-quantity]]） |

## 11. 样式、CSP、i18n、状态

- **CSP**：生产 `style-src 'self' 'nonce-…'`，无 `unsafe-inline`。禁止 `style={{}}`、`<style>`；进度条宽度用 CSS 变量 + 预定义档位或 `data-*` 驱动的类。每个 PR 跑生产模式冒烟（mock e2e 跑的是 dev CSP，看不见）。
- **样式机制**：复用 PR-1 地基——Tailwind v4 经 `apps/web/src/app/workbench.css`、`.wb-reset` 作用域，避免与现有 CSS Modules 打架。外观取原型的浅色三栏密度；token 值另定（Owner 裁决 D3）。
- **i18n**：`packages/i18n/src/messages/{en,zh-CN}.json` 新增命名空间 `tasks`（界面）、`taskTools`（词表名与说明）、`taskSteps`（每种 command kind 的 phase）、`taskStatus`（§5 主标签与切面）；`runState/actionStatus/sourceState` 复用。缺 key 门禁在两语种上跑，ICU 校验传 `{}`（[[nextintl-compiles-only-in-dev]]：坏 ICU 常只在开发机现形）。
- **浏览器状态**：只有 composer 草稿（`sessionStorage`，键含 `projectId`）与右栏选中的 tab（`localStorage`）。选中的任务、条目在 URL 里。其余一律不在浏览器里存。
- **状态管理**：TanStack Query，query key 含 `projectId/taskId`；写操作 `onSuccess` 只 invalidate，不手工 patch 缓存。§5 的主标签与切面由服务端在 `TaskView` 里给齐输入，前端 `_display-status.ts` 只做纯映射。
- **文件组织**：每文件 < 800 行、函数 < 50 行；组件按 `_composer.tsx / _task-list.tsx / _thread.tsx / _run-card.tsx / _deliverable-panel.tsx / _status-strip.tsx / _steps-model.ts / _display-status.ts / _handoff.ts` 拆分；派生逻辑放纯函数文件配表驱动单测。

## 12. authority 变更清单（规格 §12 程序）

同一批评审、分 PR 落地（§15）；每个 PR 各自让全部 verifier 通过。

| # | 变更 | 触及 |
|---|---|---|
| A1 | 新表 `workbench_tasks`、`workbench_task_entries`（§3.2，含复合外键与部分唯一索引） | `packages/db/migrations/0054_workbench_tasks.sql`、`schema.sql`、`schema-smoke.sql`、schema catalog、`packages/db/src/schema.ts` + repository、lock `tables 84 → 86`、`migrationHead → 0054` |
| A2 | `artifact_revisions.async_run_id` 可空列 + `operator ⇒ NULL` CHECK（并入 0054） | worker `run-artifact.ts` 与 `run-content-shadow.ts` 写入；`ArtifactRevision` schema 增 `generationRunId: uuid | null`。纯新增字段在 strict 客户端 re-parse 下会打死旧标签页（[[contract-version-bump-breaks-open-tabs]]：常量编译进 bundle）；已核 Studio（`hooks-studio.ts`）不校验响应、execution-state 批量读的 `safeParse` 不含 `ArtifactRevision`，实施前再 `grep -rn "ArtifactRevision.*parse" apps/web/src` 一次，仍为空则与 PR-B 同发，否则读取端单列一个 PR |
| A3 | 6 个 operation（§3.4），其中 `createWorkbenchTaskRun` 为第 11 个 shared `AsyncAccepted`；**7 个既有 service 拆出 `(tx, …)` 内核**（`audit-runs`、`collection`、`analysis-refresh`、`artifacts`、`content-shadow`、`export-service`、`action-recheck`；事务入口已核：`audit-runs.ts:488`、`collection.ts:270`、`analysis-refresh.ts:665`、`artifacts.ts:284`、`content-shadow.ts:844`、`export-service.ts:195`、`action-recheck.ts:261`；`diagnostics.ts` 不在内，因为任务不发 `createDiagnosticRun`），HTTP 合同不变；内核只含事务体，事务前的重放查找与事务后的 409 转换抽成两个 helper 供旧 route 与包装命令共用（§3.4.3）；各入口的幂等哈希规则原样保留（「请求体哈希」是简称，实际含 `projectId`，部分含路径 `actionId`、派生 locale、排序后的数组，`analysis-refresh` 只哈希 `{projectId}`）；三个 `repeatable read` 内核（`audit-runs.ts:621`、`analysis-refresh.ts:799`、`action-recheck.ts:276`）沿用原隔离级别 | `openapi/mvp.yaml`、`packages/contracts` 生成物、routes、services、lock `apiOperations 80 → 86`、`asyncOperations 10 → 11` |
| A4 | 新 schema：`Task`、`TaskSummary`、`TaskPhase`、`TaskEntry`、`TaskView`（含 `deliverables[].revisionDiff`、`action_ref.{recheckPriorRunId, activeRecheckRunId}`、`recheckResults[]`、`derivedEvents[]`（四种：approval / Action 状态变更 / 执行状态 / 复查就绪）、四个切面的原始输入）、`CreateWorkbenchTaskRequest`、`AppendWorkbenchTaskEntryRequest`、`WorkbenchTaskRunCommand`（`{command}` 包装体）、`WorkbenchToolPreflightRequest`/`ToolPreflight`、`WorkbenchTaskListResponse`（带 cursor）、`WorkbenchHandoff`（runtime refinement：`artifactId`/`artifactRevision` 同有同无、`sourceTaskId`/`sourceEntrySeq` 同有同无）；新 Problem code 进**冻结的注册表** `packages/observability/src/problem.ts`（`ProblemCode` 闭合联合 + `PROBLEM_STATUS` + 标题表，已核）：`TOOL_PRECONDITION_MISSING`(422)、`COMMAND_NOT_ALLOWED_FOR_TOOL`(422)、`RUN_ALREADY_ATTACHED`(409)，以及 `errors[].code` 词表 `MISSING_*`/`HANDOFF_TARGET_OUT_OF_SITE` | OpenAPI components、contracts、runtime refinement、problem 注册表 |
| A5 | 四模块产品面改为「任务 · 增长地图 · 执行 · 结果」 | 规格 §0 正文（**§0 会改两次**：PR-B 改计数句，PR-E 改四模块正文，各自刷新 authority 哈希）、`nav-model.ts`、根重定向、`/overview` 兼容重定向 |
| A6 | i18n 四个命名空间 | messages 两语种 + 门禁 |
| A7 | 计数与哈希。已核的硬编码位置：`scripts/verify-docs-consistency.test.mjs:137` `[80, 11, 84, 12]`、`:153` `=== 53`；`authority/implementation-spec-v0.4/scripts/verify-spec.mjs:212/226/234`（53 迁移 / 84 表 / 80 op 硬断言）、`:250`（**shared async 必须是 10**）、`:490` 起的正则；`authority/…/scripts/verify-spec.test.mjs:75–80/110/128`；`scripts/verify-implementation.mjs:86`（`EXPECTED_MIGRATION_HEAD`）、`:2412`（`=== 53`）、`:2749–2752`（`EXPECTED_TABLES 84 / REQUIRED_INDEXES 118 / REQUIRED_TRIGGERS 166 / REQUIRED_ROUTINES 105`，新表带索引与外键会动前两个）、`:2944`；`scripts/verify-implementation-source.test.mjs:48–50/79`；`packages/db/src/migrate-check.ts` 的 `EXPECTED_TABLES`（`:581` 精确计数）。规格正文：计数句在 §0（L15–16）、§6（L496）、§9（L534）、§10（L638–639）；**§9/§10 的 marker 清单**（L536–617 operation、L623–634 async、L642–727 tables）要新增 6 个 op、1 个 async、2 张表，不只是改数字。文档清单句在 `README.md`、`CLAUDE.md`、`docs/PROGRESS.md`、`docs/DEPLOYMENT.md`、`authority/implementation-spec-v0.4/README.md`，都在 lock 的 `implementationFiles`/`authorityFiles` 哈希里。**枚举不可信，PR-B 开工先跑一遍扫描并逐条处置**：`grep -rn "\b(80\|84\|53\|10\|118\|166\|105)\b" scripts authority/implementation-spec-v0.4/scripts packages/db/src/migrate-check.ts --include='*.mjs' --include='*.ts' \| grep -v test-fixture`。**两种 async 口径**：lock 的 `asyncOperations` 数 shared `AsyncAccepted`（10 → 11），文档句子多算 measurement 专用 202（11 → 12） | verify 脚本与 migrate-check 的常量、规格计数句 + marker 清单、五份文档、lock 哈希、authority mirror markers、`docs/PROGRESS.md` 记录 |

最小验收：`pnpm verify:authority && pnpm verify:spec && pnpm verify:spec:test && pnpm implementation:check && pnpm contracts:check && pnpm openapi:lint && git diff --check`。

波 2 的 `RunKind: tool_analysis` + `tool_results` 表 + `getToolResult`（A8）另起稿，不混进本批。

## 13. 集成分支处置

Owner 已选 A：`feat/workbench-ui-port` 停线不发布；新线从 `main` 起，只搬与 IA 无关的地基。

盘点口径：只读 `origin/main...origin/feat/workbench-ui-port`，**钉死到 6eac6bf5**（PR-3 合并提交；本地 `feat/workbench-ui-port` 分支停在 335 个提交之前的 f9398734，上面根本没有 `workbench.css`，已核，不要用本地分支名），393 文件，merge-base f28a1900。**A** = 内容不用改、与 IA 无关；**B** = 需先改造（混着 mock，或 import 落在 B/C）；**C** = 放弃。统计：A 99 文件（+9,707），B 86（+21,425），C 208（+35,583）。

| 类别 | 内容 | 处置 |
|---|---|---|
| A 可原样搬（剪裁后） | Tailwind v4 接入（`postcss.config.mjs`、`workbench.css`、根 layout `data-theme="light"`）、Tailwind 扫描范围门禁（`tailwind-source-*`）、`workbench-css.test.ts`、UI 原语 13 个（含 `RunningSteps`、`Dialog`/`ConfirmDialog`、`Tabs`，测试里带「不得有内联 style」断言）、`ui/{cn,ids,keyboard,focus-order,panel,stat-format}` 与对比度门禁 `color-pairs.test.ts`、`shell/{useGlobalShortcut,useMediaQuery,useProjectShellEffects,useContextNavigationConfirm}`、`shell/gsc-connection.ts`、`views/data-sources/real-connections.ts`、`lib/workbench/{download,truncate}`、mock e2e 分 lane（`vitest.config.ts`、`playwright.mock.config.ts`、`e2e/mock-e2e-lane*`、`mock-global-teardown.ts`、`.gitignore`、`eslint.config.mjs`）、`e2e/mock-api.ts` 的 DELETE 204、`e2e/workbench-targets.ts`、`session.ts hasAuthSession()`、`project-shell.ts marketCode`、`_project-switcher.tsx` | PR-A 按附录 A 的命令 cherry-pick；`apps/web/package.json` 与 `pnpm-lock.yaml` **不整文件 checkout**，手工只加 tailwindcss / @tailwindcss/postcss / clsx / tailwind-merge 四个依赖后重新 lock |
| A 中剪掉的（属于 IA） | `legacy/overview/*` 12 文件、`page-title-typography.test.ts`、改走 `/legacy/overview` 的 `e2e/overview-read-model.mock.spec.ts`、`e2e/project-isolation.spec.ts` | 不搬：本稿 D2 保留 `/overview` 路由做兼容重定向，没有 legacy 段 |
| A 中改手工合并的 | `globals.css`：只合并 `:where(:not(.wb-reset *))` 作用域那一段；分支版第 241 行的 `[data-wb-main]:focus-visible` 依赖 ShellChrome 的 DOM（已核），随 PR-C 的新壳一起进 | 不整文件 checkout |
| B 值得改造后搬 | `mock/provenance.ts stampArtifact`（解耦 `types.ts`）、`store/import-graph-walker.ts` + `ui-shell-import-gate.test.ts`（换掉 import C 的 fixture）、`views-i18n-limiters.ts` 匹配器（用例表重写）、`artifact-file.ts`（解耦 enums）、`settings/DeleteProjectSection.tsx`（去掉 `forgetProject`）、`views/data-sources/DataSourcesPanel.tsx`（解耦 `mock/time`）、`shell/Topbar.tsx` 两行顶栏与存储状态 live region（去掉示例 chip/产物筐）、`shell/CommandPalette.tsx`（列表改读新导航）、`hooks/useNowStamp.ts`（解耦 `mock/time`）、`e2e/legacy-style-parity.*`（去掉对五个 C 视图的 `h1` 断言）、`e2e/workbench-shell.mock.spec.ts` 的 CSP/⌘K/删除清 key 三段 | 在 PR-C/PR-D 需要到时逐个搬，搬一个写一个测试；不在 PR-A 里 |
| B 放弃 | `app/p/[projectId]/layout.tsx` 的 WorkbenchShell 替换、`_nav.tsx` 删除、`AppShell.tsx` 删 project 变体、`settings/data-sources` 路由改造、`login/_workbench-sweep`、`SignOutButton` 清扫、`useAddArtifact`/`usePreparedArtifact`、`routes.ts`（15 页）、`types.ts`（mock 域类型）、`no-transition-store-writes.test.ts`、i18n `workbench.*` 11 个子树、`CLAUDE.md`/`PROGRESS.md`/lock 的 15 项壳声明、三份 PR 计划稿、改成断言 15 项 rail 的 e2e | 与 store/IA 绑死 |
| C 放弃 | 15 项 IA 占位路由、`Sidebar`/`workbench-nav`、`ArtifactDrawer`/`DemoChip`、四个 mock 视图目录（43 文件）、本浏览器 GSC 导入（8 文件）、`NotifyBlock`、`enums.ts`、`mock/**`（94 文件）、`store/*`（23 文件）、PR-2 计划稿、PR-3 流程 e2e | 不搬 |

PR-A 的一处必要手工改动（不是 cherry-pick）：项目 `layout.tsx` 保留 AppShell/ProjectNav，只加 `import "../../workbench.css"`、`--font-wb` 字体变量与 `<div id="wb-root">`，否则 `workbench-css.test.ts` 的挂载断言会红。

已核实（截至 `origin/main` c569f464）：`_project-history-position.ts` 在 main 上存在；merge-base f28a1900 之后 main 的 7 个提交没有改动 A 类任何文件（`git diff --stat` 为空）。PR-A 开工时再核一次。

分支本身：打 tag `archive/workbench-ui-port-2026-09-25`（指向 6eac6bf5）后关闭 PR-4 分支，集成分支不再合 main；`docs/plans/2026-09-11-workbench-ui-port-design.md`、`-pr1-foundation.md`、`2026-09-13-workbench-pr2-mock-domain.md`、`-pr3-first-views.md` 留在该分支作参考（Owner 裁决 D6）。

## 14. 测试与验收

| 层 | 内容 |
|---|---|
| 单测（vitest） | 全部用 **oracle 表**（原始输入 → 期望输出），不用「输出值当输入」的假穷举：§3.3 `phase`：对 `run_ref` 序列（长度 0–3，每个 run 六种状态）穷举，表给出期望 `phase` 与 `decidingRun`（例如 `[running, failed]` → `active`，`[failed, running]` → `active`，`[completed, failed]` → `failed`）；§5：切面 A1 对 `Artifact.status` 五值 × `validationState` 三值给期望；A2 对 approval ledger 的六种形状（无 / 当前版 approved / 当前版 approved 后 revoked / 旧版 approved / 旧版 approved + 当前版 approved / 旧版 approved 后 superseded）给期望；C 对 run 状态序列给期望；三张表各自「每个输入组合恰好一个期望值」由表自身保证；handoff 校验器（每个工具的 `requiredHandoffFields` 逐项缺失拒绝、null 视为缺、`sourceTaskId`/`sourceEntrySeq` 只有一个时拒绝、`targetUrl` 跨 host 拒绝、www/apex 变体接受、`artifactId`/`artifactRevision` 只有一个时拒绝）；`revisionDiff`（JSON 相邻版本；markdown/csv 只布尔）；来源标签四种；步骤模型未知 phase 兜底；默认标题规则（按 `defaultDeliveryLocale`） |
| 变异测试 | 删实现映射表任意一行、把 A2/C 的优先级顺序对调、改动 20/10/4000/200/60 这几个上限常量，都必须红（[[vacuous-test-shapes-checklist]]：只断言存在不断言值的测试是空的；[[required-pins-can-mandate-a-lie]]：钉住假文案的测试会把谎锁死） |
| Route 测试 | 跨租户 404（任务本身；`*_ref` 引用别的项目的 finding/action/diagnostic run → 404）；`Idempotency-Key` 重放：`createWorkbenchTask`/`append`/`createWorkbenchTaskRun` 三个都断言「返回同对象且条目数不变」；`RUN_ALREADY_ATTACHED` 409 且条目数不变；`RUN_ALREADY_ACTIVE` 409 透传且条目数不变；`COMMAND_NOT_ALLOWED_FOR_TOOL` 422；`deliverable`/`draft`/`recheck` 不带 handoff → 422 `MISSING_HANDOFF`；预检失败 422 的 `Problem.errors[]` 与预检 POST 的 `missing[]` 按 `(pointer, code)` 一一对应；`run_ref`/`handoff_out` 客户端写入被拒；`recheck` 命令的 `priorRunId`：不存在 → 404（`action-recheck.ts:99` 既有行为），存在但属于本项目另一条诊断 → 422（用例的取值来源写明是同项目另一个 Growth Audit 的 `audit_runs.id`），等于推出值 → 通过；`sourceEntrySeq` 在来源任务不存在 → 404；三种带 `handoff.actionId` 的任务建好后 TaskView 有 `action_ref`；`defaultDeliveryLocale = de` 的项目默认标题落到 en 标签而不是 key 路径 |
| DB 集成测试（**必跑**，`vitest --project integration`，真 Postgres） | 包装命令：内核失败时不留条目、条目失败时 run 与 pg-boss job 不提交；`active_key` 23505 后包装事务回滚、返回 409、条目数不变；**同一 `Idempotency-Key` 两个连接并发发同一命令**：一个 202 追加、另一个走事务内重放分支后 202 不追加，条目恰好一条；`seq` 并发：append × append、**包装命令（RR 内核）× append** 两组各两个连接并发，不报 23505、seq 连续；handoff 原子性：目标任务与来源 `handoff_out` 同生同灭；复查 `priorRunId`：用 `createDiagnosticRun` 产生的 Action 预检报 `MISSING_PRIOR_RUN`、用 Growth Audit 产生的 Action 推出 `audit_runs.id` 并通过；真走 `reviewProjectFinding` 确认后断言 Action 初始态 ∈ {candidate, blocked}；A2 列由两个 worker 写入后 `deliverables[]` 能回读（含 `english_blog_draft`） |
| mock e2e（`e2e/*.mock.spec.ts`） | §1.3 的整条链；刷新恢复；切项目草稿隔离；生成中 fence；「设为 ready」与「批准」两步；批准后再改显示「批准的是第 N 版，当前是第 N+1 版」且不出现 superseded 字样，显式追加 `superseded` 后才显示；`adoption.blocked` 的拒绝文案；`lastError = null` 的失败文案 |
| 生产模式冒烟 | CSP 无 inline style；`/overview` 308；根重定向到 `/tasks` |
| a11y | 三栏 landmark；焦点在对话框内循环；状态变更 `aria-live` |
| i18n | 两语种缺 key 为零；ICU 编译传 `{}` |
| 真实链（可选） | `e2e/*.real.spec.ts` 用 `real-chain-fixture.ts` 跑一次 audit → deliverable |

## 15. PR 序列

| PR | 范围 | 验收 |
|---|---|---|
| PR-A 地基 | §13 A 类文件 cherry-pick（附录 A）+ 两处手工合并；不含任何任务 UI | 现有全部测试绿；生产 CSP 冒烟绿；`git diff --stat` 只含清单文件 + `globals.css`/项目 `layout.tsx`/`package.json`/lock |
| PR-B authority | §12 A1–A4、A6、A7：迁移、OpenAPI、contracts、problem 注册表、7 个 service 内核拆分、repo、services、routes、route/DB 集成测试；规格只改 §0/§6/§9/§10 的计数句与 §9/§10 的 marker 清单；**无 UI** | §12 最小验收；A7 的扫描命令跑过且每条命中都有处置；五份文档同步改 |
| PR-C 只读任务视图 | `/tasks` 与 `/tasks/[taskId]` 只读：列表、线程、步骤条、右栏读模型；入口经环境标志 `WORKBENCH_TASKS_ENABLED === "true"` 暴露（沿用 `apps/web/src/env.ts` 的 `getEnv()` 与 `DATAFORSEO_ENABLED` 同款写法），导航不改；未开启时路由 404。同步：`playwright.mock.config.ts` 的 webServer `env` 清单是显式枚举的（已核，`DATAFORSEO_ENABLED: "false"` 在其中），要加 `WORKBENCH_TASKS_ENABLED: "true"`；`.env.example` 与 `apps/web/src/env.test.ts` 同步加；「未开启时 404」这条用 route 测试而不是 mock e2e（mock 只有一条车道，开关只能取一个值） | mock e2e 只读用例；刷新恢复；轮询不在后台；route 测试覆盖关闭态 404 |
| PR-D 主线写操作 | composer + 两级预检 + 建任务 + 包装命令 + 追加条目；交付包三种「改」+ 设为 ready + 逐版审核 + 排入计划 + 执行状态 + 复查 | §1.3 整条链 mock e2e；DB 集成测试全绿 |
| PR-E 切换入口 | A5：导航、根重定向、`/overview` 兼容、规格 §0 四模块正文；删除环境标志；**迁移或改写引用 `/overview` 的测试与链接**（`grep -rln "/overview" e2e apps/web/src` 命中 19 个文件，已核） | 生产冒烟；旧深链全部可达；19 个文件逐个处置 |
| PR-F 波 2（另稿） | `tool_analysis` 合同 + 首批 3 个共享引擎（briefing / drop / gap） | 另稿验收 |

每个 PR 开 PR 前：`git branch --show-current` 与 `origin/<branch> == HEAD` 核对；推送用显式 refspec（[[subagent-worktree-detached-head-push]]：子代理会留下 detached HEAD，push 只推了第一个提交）。

## 16. Owner 裁决

**2026-09-25 Owner 裁决：D1–D9 全部按「推荐」列执行。** 下表保留备选与影响作为记录；后续实施计划以推荐列为准，改判需回到本稿改这一行。

| # | 事项 | 推荐（已采纳） | 备选 | 影响 |
|---|---|---|---|---|
| D1 | 任务进不进 authority | **进**：两表六 op + 7 个 service 内核拆分（§3） | 首版不落库，只做「run 工作记录视图」（按 run 列表拼线程，用户消息不保存） | 备选无法保存「要求修改」的原文与 handoff，深链只能到 run；换设备丢上下文 |
| D2 | 导航 | **`任务` 取代 `概览` 位；`/overview` 308 到 `/tasks`** | 五项导航（任务 + 原四项）；或任务作为 `/overview` 内的一个区块 | 规格 §0 冻结四模块，任一选择都要改 §0；推荐项改动最小且不留两个「首页」 |
| D3 | 外观 | **机制取 PR-1（Tailwind/`workbench.css`/`.wb-reset`），外观取原型浅色三栏密度，token 重定** | 沿用 PR-1 opengengrowth 暗色壳 | 影响 PR-A 清单（暗色 rail 色板与 `workbench-tokens.test.ts` 去留）与 PR-C 的 token 文件；不影响合同 |
| D4 | 自由文本路由 | **v1 不做**：先选工具再说话；无工具的文本 = 当前任务的追问 | 规则式关键词路由（原型 `classify`） | 规则路由的误判即错答（[[wrong-answer-is-worse-than-no-answer]]：分类拿不准应退回 unknown 而不是猜） |
| D5 | 波 2 的运行种类 | **新 `RunKind: tool_analysis`** | 复用 `analysis_refresh` 挂子步骤 | 复用会让 DFS 成本与工具输出混在同一 run 里，无法单独限流与解释 |
| D6 | 集成分支 | **打 tag 归档（6eac6bf5）、关 PR-4 分支、不合 main** | 保留分支不动 | 不影响本稿 |
| D7 | GEO | **延后到 KB 进 app 的独立稿** | 先做 `citability` 一项（不依赖 KB） | `citability` 仍需抽营销站私有库 |
| D8 | `artifact_revisions.async_run_id` | **加（可空，不追溯）** | 不加，界面只对 llm 版本显示来源（经 `analysis_invocation.async_run_id`） | 不加则 template 版本的「第 N 版由哪次运行产生」空着 |
| D9 | 包装命令的原子性 | **同事务：拆 7 个 service 内核（工作量最大的一项）** | 两阶段：既有 service 照旧提交 run，再单独追加 `run_ref`；失败留孤儿 run，界面提供「挂到本任务」重试 | 备选省掉内核拆分，但 §3.1 第 3 条降级，且孤儿 run 需要一个认领 UI |

## 17. 已知缺口与风险

- 机会（`GrowthOpportunity`）没有落库表且现有读模型只读最新 generation；`opportunity_ref` 只能存键 + 冻结 `diagnostic_run_id` 作出处，回读按当前 generation 解释（§3.3）。
- 「已上线」在 v0.4 下永远不可显示；客户会问。文案必须写「尚未连接发布」而不是「已发布」（规格 §6）。
- 包装命令让 shared `AsyncAccepted` 从 10 变 11，规格 §0、lock、`verify-docs-consistency.test.mjs` 的常量、五份文档的清单句要同批改；漏一处 `verify:spec:test` 红（§12 A7）。
- 7 个 service 内核拆分是隐性最大工作量；其中 3 个用 `repeatable read`，拆分时隔离级别不能降，各入口的幂等哈希规则也不能统一成一种。
- 「Finding 确认 → Action 以 `candidate/blocked` 落地」只核到 `priority.ts` 的推导，`reviewProjectFinding` 的实际落库调用链未逐行核；§14 的 DB 集成测试要用真确认流程断言初始态。
- 波 2 的两套 GSC 身份是最容易在实现时被「反正都是 GSC」合并掉的边界；PR-F 的 route 测试要专门钉「无项目 Source 时 422，绝不读 cookie」。
- §5 的切面是四张表拼出来的；[[derived-guards-can-be-tautological]]：两端出自同一张表就什么也没证明，测试要跨到真实 approval/execution-state 行断言，不能只测派生函数。
- 三栏在 CSS Modules 与 Tailwind 并存时的作用域冲突，PR-A 要用现有页面的视觉回归先证明 `.wb-reset` 不泄漏。
- 从旧页面发起的复查不会出现在任务的「复查中」切面（§3.3）；界面文案写「本任务内」。
- 现有 `getProjectResults` 只给项目级最新一次复查；任务里逐次复查的结果靠 `TaskView.recheckResults[]` 新字段（A4），它复用 `recheck-results.ts` 的投影逻辑但按 audit run id 读——这是本稿唯一「复制既有投影逻辑」的地方，实施时抽成共享函数而不是复制。
- `verify-spec.mjs:250` 硬断言 shared async = 10，PR-B 不改它就必红；这条和 `verify-docs-consistency` 的 `[80, 11, 84, 12]` 是两处独立常量。

## 18. 评审处置

### 18.1 gpt-6-astra 合同核对（2026-09-25，只读，攻击面：「已有」是否真有、「新增」是否漏改）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| R1 | P0 | `reviewFinding`、`createExport` 不是冻结 operationId | 已改为 `reviewProjectFinding`、`createProjectExport`（§2、§7.2） |
| R2 | P0 | 归档 PATCH 若并入 v1，计数应是 7 个 / 87 | 归档明确不做（§1.2、§3.5），本批 6 个 / 86 |
| R3 | P1 | 批准要求当前版 `ready` 且 `valid`，稿子漏了「设为 ready」 | §1.3 链条、§4.2 前置条件、§5 切面 A |
| R4 | P1 | 把 `Action.status` 与执行状态事件流写成同一种写入 | §5 重写为主标签 + 切面，两条流不聚合，已核 `action-execution-state.ts` |
| R5 | P1 | 复查规则字段不是 `status` | 改为 `priorStatus/currentStatus/state/disposition/label`（§2） |
| R6 | P1 | `AsyncRun` 没有 `limitations`，`lastError` 可空 | §8 改为从 `resultRef` 的结果读模型取限制说明；null 错误有兜底文案 |
| R7 | P1 | 422 顶层 `missing[]` 不符合闭合的 `Problem` | 映射到 `Problem.errors[]`，结构化 `missing[]` 只在预检（§3.4、§14）；rev3 起预检由 GET 改为只读 POST，见 D2 |
| R8 | P1 | `opportunity_id` 没有落库表可指 | 改为 `opportunity_key` + `diagnostic_run_id`（§3.2、§17）；candidate 无 primary Finding 只能引用不能确认（§2） |
| R9 | P2 | 「MeasurementWindow 不可创建」扩大了 §6 的边界 | 改为「创建合同已有；无合格 receipt 时不可用」（§2） |
| R10 | P2 | `active_key` 互斥范围写大了 | 改为同项目同非空键（§3.4.3） |
| R11 | P2 | 「相同内容不产生新版」只在手工 PATCH 有 | §10 标明 worker 重新生成路径未核实 |
| R12 | P2 | 编辑不会自动追加 `superseded` | §4.1/§4.2 区分「不再适用」与「已 superseded」 |

### 18.2 Claude 一致性评审（2026-09-25，只读，攻击面：自洽、状态组合、事务/幂等、可测试性、未声明假设）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| C1 | P0 | 建任务/预检请求缺命令级字段，§7.2 前提判断不了 | 拆成两级预检（§3.4.1），§7.2 分列工具级/命令级前提；rev2 曾给 GET 加参数，rev3 按 D2 改为只读 POST 与请求体同构 |
| C2 | P0 | `audit` 映射 `createDiagnosticRun` 产不出复查的 `priorRunId`；union 少 3 个既有异步命令没说明 | `audit` 改映射 `createGrowthAuditRun`（已核 `audit-runs.ts` 同时写 `audit_runs`）；union 加 `growth_audit` 去 `diagnostic`；§3.4.2 写明 3 个不收的理由 |
| C3 | P0 | 7 个 service 各自开事务，「同事务」要先拆内核，稿子没列 | §3.1、§12 A3、§15 PR-B 明列内核拆分；D9 给出两阶段备选 |
| C4 | P0 | 新 Action 是 `candidate/blocked`，§5 无行可显示；`planned` + 事件流 `in_progress` 显示为空 | §5 重写：主标签 = `Action.status` 总函数，独立切面（rev2 三个，rev3 按 D3 拆成四个）；§1.3 加「排入计划」步骤 |
| C5 | P1 | 表序取第一行会压住已忽略/复查中；哪个 Artifact、哪条流没说 | 切面设计消除优先级问题；切面 A 按本任务 `deliverables[]` 逐 Artifact 算，B 明确 Action 级流 |
| C6 | P1 | `async_runs` 无 scope 列，复查 run 是 `kind = diagnostic`，前端认不出 | `run_ref` 增 `command_kind` + `action_id`；`TaskView.action_ref.activeRecheckRunId` 服务端给（§3.2/§3.3） |
| C7 | P1 | phase 匹配顺序与 `latestRun` 未定义 | §3.3 写明从上往下、`decidingRun` 定义；v1 过滤枚举去掉 archived |
| C8 | P1 | 重放会撞 `UNIQUE(task_id, run_id)` | §3.4.3：已存在则不追加、原样 202；route 测试断言条目数不变 |
| C9 | P1 | 同 key 发到另一任务会变多对多 | 部分唯一索引 `one_task_per_run_idx` + 409 `RUN_ALREADY_ATTACHED`（§3.2/§3.4.3） |
| C10 | P1 | `RUN_ALREADY_ACTIVE` 409 后要不要挂 run 没写 | 写死：不追加，只把 `current.runId` 交给界面（§3.4.3） |
| C11 | P1 | `seq` 分配与并发、append 无幂等键 | append 要求 `Idempotency-Key`；DB 集成测试并发用例（§3.4、§14）；rev2 的「`FOR UPDATE` 取 max+1」在 RR 内核下会撞号，rev3 按 D9 改为 `next_seq` 计数器 |
| C12 | P1 | `user_message` = `operatorInstructions` 无机制保证 | 包装命令同事务写 `user_message`，客户端不再单独发（§3.1、§3.4） |
| C13 | P1 | `artifact_revision_ref` 由谁写没定义，客户端补条目会留缺口 | 删除该 kind；`deliverables[]` 读取时由 `run_ref` + A2 列推出（§3.2/§3.3） |
| C14 | P1 | `*_ref` 未约束同 workspace/project | 复合外键 + 服务层 404 + route 测试（§3.2/§3.4/§14） |
| C15 | P1 | `tool_id` 能发哪些 command、后续命令是否重预检未写 | §3.4.2 允许表 + `COMMAND_NOT_ALLOWED_FOR_TOOL`；命令级预检每次跑 |
| C16 | P1 | handoff 两处写入不原子；「交给了谁」表达不出 | `createWorkbenchTask` 同事务写来源 `handoff_out {target_task_id}`；`sourceEntrySeq` 定义为触发条目（§6） |
| C17 | P1 | `requiredHandoffFields` 未逐工具列出，null 未定 | §7.2 增列；必填 = 非 null、数组至少 1 项（§6） |
| C18 | P1 | `opportunity_ref` 按旧 generation 回读没有读取路径 | §3.3 写明只按当前 generation 查，查不到显示出处；不加历史读模型 |
| C19 | P1 | `changedFields` 放哪没定，§12 没列 | 定在 `TaskView.deliverables[].revisionDiff`，A4 列出（§3.3/§12） |
| C20 | P1 | `async_run_id` NULL 会把手工版标成「来源未记录」 | 先按 `generated_by` 分（§3.3），单测四种组合（§14） |
| C21 | P1 | §12「一起进」与 §15 拆 PR 矛盾 | 改为「同一批评审、分 PR 落地」，§0 改两次各自刷哈希（§12） |
| C22 | P1 | 漏了 `verify-docs-consistency.test.mjs` 常量与四份文档哈希 | A7 补齐，并写明两种 async 计数口径（§12） |
| C23 | P1 | 附录 A 用本地分支名，本地停在 335 提交前 | 钉死 6eac6bf5 / `origin/feat/workbench-ui-port`（§13、附录 A） |
| C24 | P1 | `globals.css` 整文件 checkout 与手工合并矛盾 | 移出清单，改手工合并（§13、附录 A） |
| C25 | P1 | 「每个不显示一个反例」永不失败 | §14 改为全组合穷举，断言恰好一个主标签且不是已上线/待上线 |
| C26 | P1 | 整条链只靠 mock e2e，跨前后端接缝没测 | DB 集成测试列为必跑（§1.3、§14） |
| C27 | P2 | 变异测试说法不清 | §14 写明删行/交换/改常量三种变异 |
| C28 | P2 | CHECK 未要求其余列为空；`site_id` 无 FK | §3.2 每 kind 显式要求其余列 NULL；`site_id REFERENCES app.sites(id)`；复合外键指向 `(workspace_id, project_id, id)` |
| C29 | P2 | A4「互斥」与 §6「同在」相反 | A4 改为「同有同无」 |
| C30 | P2 | §5 引言与表对不上、列名叫「原型态」 | §5 重写，末表才是原型对照 |
| C31 | P2 | `title?` 默认规则、recheck 双 actionId 未定 | §3.4 默认标题规则；recheck 去掉外层 actionId |
| C32 | P2 | 迁移头与 `nav-model.ts` 路径前后不一 | A2 并入 0054；路径写全（§9） |
| C33 | P2 | 「未核实」项已可核 | 改为已核实（截至 c569f464）（§13） |
| C34 | P2 | PR-E 没提 `/overview` 测试迁移 | PR-E 范围加 19 个文件处置（§15） |
| C35 | P2 | phase 过滤与游标怎么配合没写 | §3.4 写明按游标取页再过滤、页可不满 |
| C36 | P2 | 缺 Status 行、§18.2 占位、附录依赖会话记录、wikilink 无结论 | 头部加 Status；§18.2 回填；附录 B 改为可复现的盘点命令；每个 `[[…]]` 旁加一句结论 |

### 18.3 gpt-6-astra 第二轮（rev2 新增「已核」断言与 SQL 可行性）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| S1 | P0 | SQL 块没写三张父表的复合唯一 DDL，建条目表会失败 | §3.2 加 `DO` 块，照既有 `actions_workspace_project_id_key` 的幂等写法 |
| S2 | P1 | A3 清单列了 `diagnostics`，漏了包装命令实际用的 `audit-runs` | A3 改为 `audit-runs`，附七个事务入口行号与幂等哈希保留说明 |
| — | 通过 | `createGrowthAuditRun` 写 `audit_runs`、`priorRunId` 校验、两条流不聚合、`current.runId` 可空、计数常量、`(A) = (B)` CHECK、A2 ALTER 与既有 CHECK 不冲突 | 无需改；「Action 初始态 candidate/blocked」只核到 `priority.ts` 的推导，Finding review 的实际落库调用链本轮未核（§14 DB 集成测试覆盖） |

### 18.4 Claude 第二轮（rev2 处置落实与新矛盾）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| D1 | P0 | `priorRunId` 是 `audit_runs.id` 不是 run id，稿子三处混用 | §1.3/§2/§7.2 改为服务端 `findByDiagnosticRunId` 推出、放 `TaskView.action_ref.recheckPriorRunId`；handoff `sourceRunId` 不再兼作默认值 |
| D2 | P0 | 预检 GET 装不下 handoff/command 输入，pointer 当不了比对键 | 预检改只读 POST、与 create/run 同构；按 `(pointer, code)` 比对（§3.4、§3.4.1） |
| D3 | P0 | 切面 A 不是函数（draft+stale、archived+current、revoked 无值） | 拆成 A1 生命周期（= `Artifact.status` + `invalid` 布尔）与 A2 批准绑定（current > revoked > stale > none；rev4 按 E3 把 revoked 改为「存在且全部终止」并改名 `terminated`）（§5） |
| D4 | P1 | 「全组合穷举」拿输出当输入，恒真；「交换行」变异恒绿 | §14 改为 oracle 表；变异改为对调 A2/C 优先级 |
| D5 | P1 | `activeRecheckRunId` 没按 action 过滤 | §3.3 加 `run_ref.action_id = 该 action` |
| D6 | P1 | 切面 C 不是函数且结果无来源 | C 加优先级与作用域；`TaskView.recheckResults[]` 新字段（§3.3、§5、A4、§17） |
| D7 | P1 | `english_blog_draft` 只由 Content Shadow 铸造，`deliverables[]` 漏它 | §3.3 纳入 `content_shadow` run 经 `flow_shadow_run` 关联的 Artifact；A2 由两个 worker 写 |
| D8 | P1 | §3.5「追加 `*_ref`」与 §3.3「不写条目」矛盾，批准无对应 kind | §3.5 只保留确认 Finding 的追加 |
| D9 | P1 | RR 内核里 `max(seq)+1` 会撞号 | `workbench_tasks.next_seq` + `UPDATE … RETURNING`，40001 重试；§14 加包装命令 × append 并发 |
| D10 | P1 | 内核边界装不下事务外的重放/竞态恢复 | §3.4.3 写明内核只含事务体，重放查找与 409 转换抽 helper；23505 令包装事务回滚 |
| D11 | P1 | 预检把 409/合法性挡在前面 | §3.4.1/§7.2：预检只报「缺」；活跃冲突与合法性交给既有 service |
| D12 | P1 | 不带 handoff 建三种任务未定义 | `requiredHandoffFields` 非空 ⇒ 必带 handoff，否则 422 `MISSING_HANDOFF`；composer 直接发起时 `sourceTaskId` 为 null（§3.4、§6） |
| D13 | P1 | A7 漏 `verify-spec.mjs:250`/`:490`、`verify-implementation.mjs`、规格 §6/§9/§10 | A7、§15 PR-B、§17 补齐（已核行号） |
| D14 | P2 | A4 漏 Problem 注册表与几个请求 schema | A4 补齐（`packages/observability/src/problem.ts` 冻结注册表，已核） |
| D15 | P2 | A2「读取端先发一轮」没排 PR | A2 改为：已核 Studio 不校验；实施前再 grep，仍为空则同 PR |
| D16 | P2 | `revisionDiff` 形状与来源标签不全 | §3.3 补 `changed`、csv、四种标签 |
| D17 | P2 | §4.1 少 `command` 一层 | 已改 |
| D18 | P2 | 「confirmed Action」未定义 | §7.2 改为「存在且非 `dismissed`」 |
| D19 | P2 | 默认标题语种未定 | 按项目 `defaultDeliveryLocale` 生成并存死（§3.4） |

### 18.5 Claude 第三轮（rev3 窄范围终审：0 P0）

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| E1 | P1 | 内核边界漏了事务前的校验/派生（`loadRecheckContext`、locale 归一化），409 转换要认各 service 自己的索引清单 | §3.4.3 拆成 prepare / 内核 / `toConflictProblem` 三段 |
| E2 | P1 | 事务体自带并发重放分支，同 key 并发会在包装事务里撞 `one_task_per_run_idx` 变 500 | 内核返回 `{replayed, run}`，包装命令在事务内按同一分支判定；409 helper 认该索引；§14 加同 key 并发用例 |
| E3 | P1 | A2 `revoked`「全部已终止」空真成立，`stale/none` 走不到 | 改为「存在且全部已终止」并改名 `terminated`（§5） |
| E4 | P1 | 切面 C 对 `cancelled` 无值；`recheckResults[]` 口径与 C 不一致 | C 加 `cancelled`、按 seq 取最后一条；`recheckResults[]` 覆盖 `completed ∪ partial`（§3.3、§5） |
| E5 | P1 | §3.5 说 Action 状态变更走 `derivedEvents[]`，§3.3 清单里没有 | §3.3 加「Action 状态变更」（读 `action_override_audit`，已核 schema.sql:618）；A4 同步 |
| E6 | P1 | composer 直建的 `deliverable/draft/recheck` 任务没有 `action_ref`，切面输入与 `recheckPriorRunId` 无处取 | `createWorkbenchTask` 带 `handoff.actionId` 时同事务追加 `action_ref`；后续命令 actionId 必须相等（§3.4） |
| E7 | P1 | 项目状态类缺口没有 pointer；字段 null 报几条未定；`HANDOFF_TARGET_OUT_OF_SITE` 混进预检会让「一一对应」红 | §3.4.1 三条 pointer 规则；越界 targetUrl 改走 `VALIDATION_ERROR` 且先于预检（§6） |
| E8 | P1 | 默认标题按任意 BCP-47 取标签会把 key 路径存进标题 | 非 en/zh-CN 回退 en；§14 加 `de` 用例（§3.4） |
| E9 | P1 | A7 还漏 `verify-spec.mjs:212/226/234`、`verify-spec.test.mjs`、`verify-implementation.mjs:2749–2752/2944`、`verify-implementation-source.test.mjs`、`migrate-check.ts`；§9/§10 是 marker 清单不只是计数句 | A7 补齐并改为「先扫描再逐条处置」；PR-B 措辞改 |
| E10 | P2 | A3 只列一个 RR 内核，§17 说三个 | A3 列出三个（已核行号） |
| E11 | P2 | 40001 重试粒度与耗尽响应未写 | 整个包装事务从 prepare 重来 ≤ 3 次，耗尽 409 `VERSION_CONFLICT`（§3.4） |
| E12 | P2 | 重放出「没挂任何任务」的 run 无分支 | 并入 409 `RUN_ALREADY_ATTACHED`（§3.4.3） |
| E13 | P2 | 透传 422 的 pointer 相对内层请求体 | 包装命令加 `/command/request` 前缀（§3.4） |
| E14 | P2 | `priorRunId` 不存在是 404 不是 422 | §14 分开写两种取值来源 |
| E15 | P2 | `sourceEntrySeq` 无存在性校验 | 不存在 → 404（§3.4、§14） |
| E16 | P2 | 旧批准被 superseded 与从未批准都落 `none`，§4.2 要求分开画 | 切面不区分终止原因，`derivedEvents[]` 分开显示（§3.3、§5） |
| E17 | P2 | 六态对照对多 Artifact 没有量词 | 逐卡片成立、Action 级取任一（§5） |
| E18 | P2 | run 行没写 `Idempotency-Key` | 已补（§3.4） |
| E19 | P2 | mock 配置的 env 清单是显式枚举；关闭态 404 在单车道 e2e 里测不了 | PR-C 同步 `playwright.mock.config.ts`/`.env.example`/`env.test.ts`；404 用 route 测试（§15） |
| E20 | P2 | §18 历史处置里留着被推翻的做法 | R7/C1/C11 各加「rev3 已改」 |

第三轮核实通过（不计条目）：`findByDiagnosticRunId(scope, diagnosticRunId)` 签名相容；`problem.ts` 是新增 code 该去的地方；A7 已列行号与 A3 七个事务入口全部正确；`CreateContentShadowRunRequest`/`CreateActionRecheckRequest` 的 `actionId` 都是 required，`run_ref` 的 CHECK 能填出 `action_id`；`missing[].kind` 八种与 `MISSING_*` 八个 code 一一对应。

## 附录 A · PR-A cherry-pick 文件清单

剪裁后的命令草稿（未执行；`[projectId]` 在 pathspec 里是通配符，故加 `--literal-pathspecs`；**必须用 `6eac6bf5`**，本地 `feat/workbench-ui-port` 分支是旧的；`package.json`/`pnpm-lock.yaml`/`globals.css` 不在清单内，手工合并）：

```bash
git --literal-pathspecs checkout 6eac6bf5 -- \
  apps/web/postcss.config.mjs \
  apps/web/src/app/layout.tsx apps/web/src/app/workbench.css \
  apps/web/src/app/workbench-css.test.ts apps/web/src/app/workbench-tokens.test.ts \
  apps/web/src/app/tailwind-source-{bindings,exports,extract,scan,values}.ts \
  apps/web/src/app/tailwind-source-{extract,scope}.test.ts \
  apps/web/src/lib/auth/session.ts apps/web/src/lib/auth/session.test.ts \
  apps/web/src/lib/services/project-shell.ts apps/web/src/lib/services/__tests__/project-shell.test.ts \
  'apps/web/src/app/p/[projectId]/_e2e-shell-fixture.ts' \
  'apps/web/src/app/p/[projectId]/_project-switcher.tsx' \
  apps/web/src/components/workbench/ui/{Chip,ConfirmDialog,Delta,Dialog,EmptyState,Field,InPane,OutPane,PageHead,RunningSteps,StatCard,Tabs,Toggle}.tsx \
  apps/web/src/components/workbench/ui/{Chip,ConfirmDialog,Delta,Dialog,EmptyState,Field,InPane,OutPane,PageHead,RunningSteps,StatCard,Tabs,Toggle}.test.tsx \
  apps/web/src/components/workbench/ui/{cn,ids,keyboard,focus-order,panel,stat-format}.ts \
  apps/web/src/components/workbench/ui/{keyboard,focus-order,panel,stat-format,color-pairs}.test.ts \
  apps/web/src/components/workbench/hooks/useShortcutLabel.ts apps/web/src/components/workbench/hooks/useShortcutLabel.test.tsx \
  apps/web/src/components/workbench/shell/{useGlobalShortcut,useMediaQuery,useProjectShellEffects}.ts \
  apps/web/src/components/workbench/shell/{useGlobalShortcut,useMediaQuery,useProjectShellEffects}.test.tsx \
  apps/web/src/components/workbench/shell/useContextNavigationConfirm.ts \
  apps/web/src/components/workbench/shell/gsc-connection.ts apps/web/src/components/workbench/shell/gsc-connection.test.ts \
  apps/web/src/components/workbench/views/data-sources/real-connections.ts apps/web/src/components/workbench/views/data-sources/real-connections.test.ts \
  apps/web/src/lib/workbench/{download,truncate}.ts apps/web/src/lib/workbench/{download,truncate}.test.ts \
  .gitignore eslint.config.mjs vitest.config.ts playwright.mock.config.ts \
  e2e/mock-e2e-lane.ts e2e/mock-e2e-lane.vitest.ts e2e/mock-global-teardown.ts e2e/mock-api.ts e2e/workbench-targets.ts
```

`workbench-tokens.test.ts` 钉的是暗色 rail 的文字 token 对比度；若 D3 判为浅色壳且 rail 色板随之删除，这个测试与 `workbench.css` 里的 rail 色板一起删。

## 附录 B · 盘点的可复现口径

盘点不依赖会话记录，任何人可重跑：

```bash
git fetch origin
git diff --stat origin/main...6eac6bf5 | tail -1            # 393 files, +66,715 −907
git diff --name-only origin/main...6eac6bf5                 # 全量文件名
git --literal-pathspecs diff --stat f28a1900 origin/main -- <附录 A 全部路径>   # 应为空
git show 6eac6bf5:apps/web/src/app/globals.css | grep -n 'data-wb-main'          # 第 241 行
```

A/B/C 的判据：A = 该文件不 import `lib/workbench/store/*`、`lib/workbench/mock/*`（`provenance.ts` 除外）、`shell/{Sidebar,WorkbenchShell,ShellChrome,ArtifactDrawer}`、`workbench-nav.ts`、`routes.ts`、`types.ts`，且不引用 `/legacy/overview` 或 15 项 rail；B = import 了上述之一但本体是通用能力；C = 其余。

## 附录 C · 术语对照

| 原型词 | 本稿用词 | 合同名 |
|---|---|---|
| 任务 | 任务 | `Task` |
| 交付包 | 交付包 | `Artifact` + `ArtifactRevision` |
| 候选 | 候选机会 | `GrowthOpportunity` |
| 行动 | 行动 | `Action` |
| 复查 | 复查 | recheck run（Growth Audit capability 下的 `kind = diagnostic` run）+ `ActionRecheckResultsResponse` |
| 项目资料 | 产品画像 | `ConfirmedProductProfile` |
| 数据来源 | 来源连接 | `SourceConnection` |
| 引用 | 证据 | `Evidence` |
| 下一步 | 交接 | `WorkbenchHandoff` |
