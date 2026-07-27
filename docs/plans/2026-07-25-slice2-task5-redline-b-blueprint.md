# Slice 2 Task 5 实现蓝图 · 红线 B 上游硬化(confirmed content Finding → 恰一 Action → 一 content_brief)(2026-07-25)

基线:worktree `unified-growth-opportunity-v03` @ `4025577`(Task 2 已落 + authority 快照已推进到 0020)。配套:
`2026-07-25-slice2-content-shadow-execution-plan.md`(裁决 B = 本 Task 核心)、
`2026-07-25-slice2-task4-content-shadow-blueprint.md`(D3 已把 `createContentShadowRun`/`getContentShadowRun` 的 op/契约/route/冻结/enqueue **归 Task 4**)。

**本 Task 一句话定义**:Task 4 让管道能跑;**Task 5 让管道的输入不可能是脏的**。Task 5 **零迁移、零新 op、零新队列**,只做 service 断言硬化 + 上游 Finding-Review 路径的错误语义收口 + 反例测试锁死。

> **开工第一步(强制)**:`git log --oneline` 确认 Task 4 已 commit,然后 `git show` 其 diff。凡 Task 4 已经实现的断言,Task 5 **只补测试,不重写**。本蓝图 §3 的边界表按"Task 4 蓝图 §3 文本"划线;若 Task 4 的**实际代码**超出或偏离该文本,**以已 commit 的代码为准**,把差异回报主 agent(见 OQ7)。

---

## 1. 现状事实核实(逐行证据)

### 1.1 链条第一段:content Finding confirm → Action

`reviewProjectFinding`(`apps/web/src/lib/services/finding-review.ts:46-149`)+ `confirmFinding`(同文件 `162-286`)的真实行为:

| 步骤 | 证据 | 事实 |
|---|---|---|
| 读 Finding(事务外) | `finding-review.ts:61-71` | `review_revision !== body.baseRevision` → 409 `VERSION_CONFLICT` |
| 解析模板 | `finding-review.ts:42-44,171` | `ACTION_TEMPLATES[finding.rule_id as keyof ...]` —— **裸 cast,无 undefined 保护** |
| 计算 actionKey | `finding-review.ts:172-176` | `contentHash({projectId, finding.finding_key, template.templateId})` |
| 事务:锁 project | `finding-review.ts:193-203` | `ProjectsRepository.findByIdForUpdate` —— **整个并发正确性挂在这把项目级行锁上** |
| 事务:CAS 改 review_state | `finding-review.ts:205-221` | `updateReview(expectedRevision)`,失败 → 409 |
| 事务:append 审计 | `finding-review.ts:222-232` | `finding_review_events`,DB `UNIQUE (finding_id, revision)`(`0001_init.sql:578`) |
| 事务:Action find-or-create | `finding-review.ts:234-243` | `findByKey(actionKey)` 命中 → `mergeEvidenceRefs` → **原样返回 existing** |
| 事务:insert Action | `finding-review.ts:244-263` | `sourceDiagnosticRunId: finding.last_seen_run_id` |
| 事务:遥测 | `finding-review.ts:264-274` | `action_confirmed` |

**关键事实:`confirmFinding` 全程不触碰 `execution_artifacts` / `artifact_revisions`。** 确认只产 Action,不产 content_brief。

DB 硬约束(已存在,Task 5 不新增):

| 约束 | 位置 | 保证 |
|---|---|---|
| `findings UNIQUE (project_id, finding_key)` | `0001_init.sql:542` | finding_key ↔ finding 行在项目内 1:1(所以 actionKey 不会跨 Finding 行别名) |
| `actions UNIQUE (project_id, action_key)` | `0001_init.sql:606` | 同一 (project, findingKey, templateId) 只有一行 Action |
| **`actions UNIQUE (source_finding_id, template_id)`** | `0001_init.sql:607` | **一 Finding × 一 template 至多一 Action,DB 强制** |
| `enforce_action_source_lineage` | `0011:207-273` | 血缘不可变(`212-218`);INSERT 时要求 `finding.last_seen_run_id = NEW.source_diagnostic_run_id`(`259-269`) |
| `ACTION_TEMPLATES` 是 `Record<RuleId, ActionTemplate>` | `packages/engine/src/action-templates.ts:35` | rule → templateId 是全函数且 1:1(11 条) |

→ **"一 Finding → 至多一 Action" 是 DB 强制的,不是碰巧。** content 四规则的 artifactType 全 = `content_brief`:`action-templates.ts:127-148`(SEARCH-DECAY-002 / `refresh_decaying_content.v1`)、`149-170`(CONTENT-COVERAGE-001 / `create_priority_content.v1`)、`171-191`(CONTENT-GAP-011 / `create_gap_content.v1`)、`213-233`(CRO-LANDING-003 / `improve_landing_conversion.v1`)。

### 1.2 链条第二段:Action → content_brief

**当前代码不存在任何"确认即产 brief"的路径。** content_brief 只由操作员显式调 `createActionArtifact`(`apps/web/src/lib/services/artifacts.ts:113-454`,路由 `POST /projects/{projectId}/actions/{actionId}/artifacts`)产生:

| 步骤 | 证据 | 事实 |
|---|---|---|
| 幂等前置 | `artifacts.ts:127-144` | completed key 先 replay |
| dismissed 拒绝 | `artifacts.ts:176-181` | 422 `ACTION_NOT_EXECUTABLE` |
| 类型必须匹配模板 | `artifacts.ts:182-197` | **`if (expectedType && …)` —— `expectedType` 为 undefined 时整条校验被跳过** |
| 反查表 | `artifacts.ts:45-47` | `ARTIFACT_TYPE_BY_TEMPLATE: Record<string,string>`,由 `ACTION_TEMPLATES` 派生;`actions.template_id` 在 DB 是**无约束 text**(`0001_init.sql:589`) |
| live 复用(regenerate) | `artifacts.ts:202-207,332-339` | `findLiveByActionType` 命中 → 复用 artifact id |
| 血缘漂移 | `artifacts.ts:302-320` | `finding.last_seen_run_id !== action.source_diagnostic_run_id` → **409 `VERSION_CONFLICT`** ← Task 5 的漂移语义直接照抄这条 |
| 唯一冲突兜底 | `artifacts.ts:426-450` | 捕获 `execution_artifacts_one_active_type_idx` / `async_runs_one_active_key_idx` → 409 |

DB 硬约束:
- `execution_artifacts_one_active_type_idx`:`UNIQUE (action_id, artifact_type) WHERE status <> 'archived'`(`0001_init.sql:649-651`)→ **一 Action 至多一 live content_brief,DB 强制**。
- `CHECK (status IN ('generating','failed') OR current_revision >= 1)`(`0001_init.sql:646`)→ draft/ready 必有 revision ≥ 1。
- artifact_type 闭集扩到 4 类:`0020_content_shadow_foundation.sql:31-40`。

### 1.3 Task 2 已落的 DB 兜底覆盖了什么、**没**覆盖什么

`enforce_flow_shadow_run_provenance`(`0020:117-166`)已强制:

- `137-138` Finding 存在且 `review_state='confirmed'`
- `139-140` `rule_id ∈ {SEARCH-DECAY-002, CONTENT-COVERAGE-001, CONTENT-GAP-011, CRO-LANDING-003}`
- `146-147` Action 存在、`source_finding_id` 匹配、`status <> 'dismissed'`
- `149-150` `finding.last_seen_run_id = action.source_diagnostic_run_id`(无漂移)
- `152-158` brief 的 `action_id` / `artifact_type='content_brief'` / `current_revision >= NEW.content_brief_revision`
- `159-163` 冻结的那一版 `artifact_revisions` 行确实存在
- `124-131` canonical run 必须是 `kind='content_shadow'` + `mode='shadow'` + `side_effect_class='internal_write'`

**触发器明确没有查的四件事(Task 5 的靶心)**:
1. **`execution_artifacts.status`** —— `archived` / `failed` 的 brief **能通过触发器**。
2. **`execution_artifacts.validation_state`** —— `invalid` 的 brief 能通过。
3. **"该 Finding 恰有一个非 dismissed Action"** —— 触发器只查传入的那个 Action 非 dismissed,不查基数。
4. **`site_id` 与 Finding/Action 的一致性** —— `flow_shadow_runs.site_id` 只有 FK,无跨行一致性校验(Task 4 的 R4 service-load 断言负责)。

### 1.4 "恰一"当前哪里只是碰巧 —— 结论表

| # | 现象 | 当前为什么"碰巧"成立 | 破坏条件 | 现失败形态 |
|---|---|---|---|---|
| **F1** | 确认 content Finding 不会 500 | `ACTION_TEMPLATES[rule_id]` 裸 cast(`finding-review.ts:42-44,171`);`findings.rule_id` 的 DB CHECK 只是**正则**(`0001_init.sql:515`),不是枚举 | 引擎新增/改名规则、或历史行带未注册 rule_id | `template.templateId` → `TypeError` → **500 无 problem+json** |
| **F2** | 并发两次 confirm 不会双写 Action | 靠 `ProjectsRepository.findByIdForUpdate` 项目级行锁串行化(`finding-review.ts:194`);`findByKey`-then-`insert` **没有** 23505 catch | 任何人为了性能移除/下推该项目锁 | unique 仍挡住 → 但变成 **500(未捕获 23505)**,不是 409 |
| **F3** | 确认时 `last_seen_run_id` 与 insert 一致 | `finding` 在**事务外**读(`finding-review.ts:61-64`),`last_seen_run_id` 直接带进 insert(`248`);`0011:259-269` 触发器要求二者相等 | 并发 diagnostic 在读与 insert 之间推进 `last_seen_run_id` | 触发器 23514 → **500** |
| **F4** | 一个 confirmed content Finding 有一个 content_brief | **没有任何代码保证**:brief 是操作员另一次显式 POST 的产物 | 操作员没点、或点了 `metadata_rewrite` | 静默为 0 个 brief;下游 Task 4 断言才会 422 |
| **F5** | `countActionsForFinding===1` | 该方法(`packages/db/src/repositories/actions.ts:283-299`)**生产代码零调用点**,当前只被测试用(`actions.test.ts`、`technical-opportunity-vertical.integration.test.ts:125,131`) | —— | 上游没有任何地方在跑这个断言 |
| **F6** | 重新确认不产第二个 Action | `findByKey` 不带 status 谓词(`actions.ts:57-72`),命中即返回(`finding-review.ts:235-243`) | Action 已被 override 成 `dismissed`(`actions-service.ts:19-20` 允许 `candidate/planned → dismissed`) | **finding 变 confirmed,但返回的 action.status 仍是 `dismissed`,`countActionsForFinding` = 0** —— "confirmed 但零活跃 Action" 是可达状态 |
| **F7** | 公开 artifact 路由不会铸 `english_blog_draft` | 只靠 `if (expectedType && …)`(`artifacts.ts:182-183`);wire 枚举**已包含** `english_blog_draft`(`packages/contracts/src/zod/artifacts.ts:10-14`) | `actions.template_id` 不在注册表(text 列无约束) | `expectedType` undefined → 校验整条跳过 → **公开路由可为任意 Action 铸 `english_blog_draft`**,破 Task 4 D2 前提 |
| **F8** | 冻结的 brief 是"活的" | `findLiveByActionType` 在 service 侧过滤 archived,但**触发器不查 status/validation_state**(§1.3) | 操作员 archive brief(`artifact-state.ts:16-17` 允许 draft/ready → archived)后再发起 shadow run | 若 service 不查,archived / invalid 的 brief 会被冻进 `flow_shadow_runs` |

**一句话结论**:红线 B 的**上界**("不超过一个")已被 DB 两条 UNIQUE 强制得很硬;红线 B 的**下界**("确实有一个、且是活的、且是当前血缘的")当前**完全没有强制**,只靠操作流程碰巧成立。Task 5 = 补下界。

---

## 2. 红线 B 可执行断言清单

层级记号:**L1 = DB(已存在,不新增迁移)**,**L2 = service 断言(Task 5 落)**,**L3 = 测试(Task 5 落)**。

| ID | 断言 | L1 | L2(HTTP 语义) | L3 | 为什么不能只靠一层 |
|---|---|---|---|---|---|
| **A1** | 一 Finding 至多一 Action | `0001:607` UNIQUE(source_finding_id, template_id) | 无需(DB 已强制);仅在 catch 里把 23505 翻成 409 `VERSION_CONFLICT` | I4 直插反例 | DB 给正确性,但裸 23505 会变 500;测试锁死"这是 DB 强制而非 service 惯例",防重构时被"优化"掉 |
| **A2** | 该 Finding 恰有一个**非 dismissed** Action | **无**(UNIQUE 不带 status 谓词) | `countActionsForFinding` ≠ 1:<br>`0` → **422 `ACTION_NOT_EXECUTABLE`**("确认的机会已被驳回,先恢复该 Action")<br>`>1` → **409 `FINDING_ACTION_ACTIVE`**(**2026-07-26 修订,见 OQ8**;原写 503) | I3 dismiss→re-confirm 反例 | DB 结构上做不到(dismissed 也占 UNIQUE 坑位);只有 service 能读到基数;只有测试能证明 F6 那条可达路径被堵 |
| **A3** | 第 N 次 confirm 复用同一 Action,不新建 | `0001:606/607` | 无新增(现状即对) | **I2 反例(必测)** | 这是红线 B 的字面表述,必须有反例测试,否则将来任何"确认时顺手铸 artifact"的改动都会静默破坏它 |
| **A4** | 一 Action 至多一 live content_brief | `0001:649-651` partial UNIQUE | catch 已有(`artifacts.ts:426-450`)→ 409 | I1 断言唯一性 | 同 A1 |
| **A5** | 被冻结的 brief 必须 **live + 有 revision + validation 非 invalid** | **无**(触发器不查 status/validation_state) | **422 `VALIDATION_ERROR`**,`errors[].pointer='/actionId'`,分别用 code `brief_archived` / `brief_missing_revision` / `brief_invalid` | I5 反例:archived brief → service 422,**但直插 repo 仍能过触发器**(正是"只靠 DB 不够"的证明) | 触发器故意不管人工状态机;service 是唯一知道 `archived` 语义的层;测试把这个缺口钉在文档里 |
| **A6** | Finding 仍 confirmed、且未越过冻结的 diagnosis | `0020:137-138,149-150` 23514 | **409 `VERSION_CONFLICT`**,文案**逐字复用** `artifacts.ts:317-319`:"Finding changed after this Action was created; review the current opportunity before generating an artifact." | I1 + 漂移反例 | DB 只会 23514 → 500;409 语义告诉前端"刷新后可重试",422 会误导成"永远别试" |
| **A7** | `rule_id` ∈ 四条 content 规则 | `0020:139-140` 23514 | **422 `VALIDATION_ERROR`**,pointer `/actionId`,code `rule_not_content` | U4 | 同上,且 service 能给出"这条 Finding 产 technical_ticket,不走 Content Shadow"的可读文案 |
| **A8** | 公开 `createActionArtifact` 拒 `english_blog_draft`,且未知 template_id 不再跳过类型校验 | 无 | **422 `ACTION_NOT_EXECUTABLE`**(未知 template)/ **422 `VALIDATION_ERROR`** + `errors[]{pointer:'/artifactType', code:'type_not_operator_mintable'}`(english_blog_draft) | U3 + I7 | 纯 service 缺口(F7);DB 的 artifact_type CHECK 是 4 元闭集,拦不住;这是 Task 4 D2("public createActionArtifact 拒 english_blog_draft")的**前提条件**,必须真的成立 |
| **A9** | 确认一个 rule 不在注册表的 Finding 不再抛裸 TypeError | 无 | **503 `DEPENDENCY_UNAVAILABLE`**(见 OQ1) | U(纯单测,mock 一个未注册 rule_id 的 row) | 纯 service;当前是 500 + 栈,没有 problem+json,前端无法降级 |
| **A10** | confirm 事务内的 `last_seen_run_id` 与事务外读的一致 | `0011:259-269` 23514 | **409 `VERSION_CONFLICT`**(事务内重读 Finding,不一致即冲突) | 集成:并发推进 last_seen 后 confirm | 见 OQ3;DB 已挡住写坏数据,但错误形态是 500 |

**三层不可互相替代的总原则**(写进 PR 描述):
- **L1 只给"不可能写坏"**,不给"为什么写不进去"。裸 23505/23514 到路由层是 500,操作员无法自救。
- **L2 只给"可操作语义"**(409 = 刷新重试 / 422 = 换个输入 / 503 = 服务端问题),但 L2 可被新 caller 完全绕过(worker 直接用 repo 写),所以 **L2 永远不能取代 L1**。
- **L3 锁死"这条不变式是被谁保证的"**。L1/L2 都可能在未来重构中被删;反例测试(尤其 I2/I3/I5)是唯一会在 CI 里尖叫的东西。

---

## 3. Task 4 / Task 5 职责边界表

按 Task 4 蓝图 §3(`2026-07-25-slice2-task4-content-shadow-blueprint.md:56-63`)逐项对照。

| 项 | Task 4 蓝图 §3 已覆盖 | Task 5 新增硬化 | 判定 |
|---|---|---|---|
| `createContentShadowRun` op / zod / openapi / route | ✅ 全部(含全部契约税) | — | **Task 5 不碰** |
| `getContentShadowRun` | ✅ | — | **Task 5 不碰** |
| `buildContentShadowFrozenInput` + `content_hash` | ✅ | — | Task 5 只加"search/generative 分离对 hash 敏感"的单测(U5) |
| 事务顺序 / idempotency / enqueue / 202 | ✅ | — | **Task 5 不碰** |
| Action 存在、非 dismissed、`source_finding_id==finding` | ✅ | — | Task 5 只补测试 |
| Finding `confirmed` 且 `last_seen_run_id==action.source_diagnostic_run_id` | ✅ | **A6 的错误码固定为 409 + 逐字复用 artifacts.ts 文案** | Task 4 未指定码 → Task 5 收口 |
| `rule_id ∈ 4 条` | ✅ | **A7 错误码/pointer 固定** | Task 4 未指定码 → Task 5 收口 |
| content_brief 存在、type 正确、action_id 正确、**目标 revision 存在** | ✅ | **A5:再加 `status <> 'archived'`、`status <> 'failed'`、`validation_state <> 'invalid'`、`current_revision >= 1`** | **Task 5 净新增** |
| `countActionsForFinding === 1` | ✅(只写了 `===1`) | **A2:定义 `0` 与 `>1` 的**不同**错误码;把该调用抽成共享断言 helper 供 service 复用** | **Task 5 净新增语义** |
| 实体集在 project scope(R4) | ✅ | — | Task 5 不碰 |
| search / generative 分离(invariant 8) | ✅ | 只加 U5 hash 敏感性单测 | 测试补齐 |
| 断言与触发器双层冗余 | ✅(原则) | **把"触发器没查什么"写成 §1.3 清单 + I5 证明** | **Task 5 净新增** |
| **上游 `reviewProjectFinding`** | ❌ 完全没提 | **A9(未知 rule 不 500)、A10(事务内重读 Finding)、A3 反例测试** | **Task 5 独占** |
| **上游 `createActionArtifact`** | ❌ 完全没提(仅 D2 假定"public 拒 english_blog_draft") | **A8(显式拒 + 未知 template 不跳过校验)** | **Task 5 独占** |
| **dismiss → re-confirm 语义** | ❌ | **A2 + I3 定义并锁死** | **Task 5 独占** |
| E2E / stop gate | — | — | **Task 9** |
| RL/SC/citability 真判定 | — | — | **Task 6** |

**防重复实现的一条硬规矩**:Task 5 **不得**在 `content-shadow.ts` 里新增第二个 `assert*` 函数集。若 Task 4 已写了内联断言,Task 5 **就地增强**(补 A5/A2 分支),而不是新起一个 `hardened-assertions.ts`。

---

## 4. 反模式清查表(review 必查)

对应 Task 4 蓝图 §3 结尾的 6 条红线 B 反模式。每条给"在代码里怎么检出"。默认在 worktree 根跑;`rg` 不可用时用 `grep -rn --include=*.ts`。

### AP1 —— 在 Content Shadow 路径上新建 Action / approval / checkpoint / opportunity 行

```bash
# 1. Action 写方法在全仓的调用点,必须只有 finding-review.ts:244(insert)与 actions-service.ts(override)
rg -n "\.(insert|mergeEvidenceRefs|applyOverride)\(" --type ts apps packages \
  | rg -i "action" | rg -v "__tests__|\.test\."
# 2. Content Shadow 两个模块内不得出现 ActionsRepository 的写用法
rg -n "ActionsRepository" apps/web/src/lib/services/content-shadow.ts apps/worker/src/content-shadow/ \
  | rg -v "findById|findByIdForUpdate|countActionsForFinding|findActiveByFinding"
# 3. Task 5 不得产生迁移
ls packages/db/migrations/ | rg "^0021"          # 期望:无输出
# 4. 全仓不得出现 approval / checkpoint / opportunity 持久化面
rg -in "approval|checkpoint" packages/db/migrations/*.sql
rg -n "CREATE TABLE" packages/db/migrations/0020*.sql   # 期望:仅 3 张 flow_shadow_* 表
```
**期望**:1/2/3/4 全部无新增命中;`scripts/spec-v0.3-lock.json` 的 `tables` 仍是 44。

### AP2 —— 修改 Finding 的 review 状态

```bash
rg -n "updateReview|review_state|reviewState" \
  apps/web/src/lib/services/content-shadow.ts apps/worker/src/content-shadow/
```
**期望**:仅出现在**只读比较**里(`finding.review_state !== "confirmed"`),绝无赋值/传参给 repo。全仓 `FindingsRepository(...).updateReview` 调用点只允许 `finding-review.ts:111` 与 `:205`:
```bash
rg -n "updateReview\(" --type ts apps packages | rg -v "__tests__|\.test\.|repositories/findings"
```

### AP3 —— 重新生成 content_brief 而不是冻结它

```bash
rg -n "buildTemplateArtifact|buildContentBrief|createActionArtifact|startRegeneration|setGenerated" \
  apps/web/src/lib/services/content-shadow.ts apps/worker/src/content-shadow/
```
**期望**:对 **content_brief** 的操作只允许 `findById` / `findLiveByActionType` / `findRevision`。`setGenerated*` 只可作用于 **english_blog_draft** 的 artifact id —— review 时逐行确认被写的 `artifactId` 变量来源是 draft 的 find-or-create,而非 `frozen.contentBriefArtifactId`。
```bash
# 硬检查:brief 的 id 变量绝不能流进任何写方法
rg -n "contentBriefArtifactId" apps/worker/src/content-shadow/ -A2 | rg "insert|update|setGenerated|setStatus"
```

### AP4 —— 给 brief 新 ArtifactType,或让 english_blog_draft 变成 ActionTemplate

```bash
# ACTION_TEMPLATES 必须恰 11 条
rg -c '^  "(TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3}": \{' packages/engine/src/action-templates.ts   # 期望 11
# 任何模板都不得声明 english_blog_draft
rg -n 'artifactType: "english_blog_draft"' packages/engine/                                              # 期望 0
# ArtifactType 四元闭集的 5 处必须一致
rg -n '"english_blog_draft"' packages/contracts/src/zod/artifacts.ts packages/artifacts/src/types.ts \
  packages/engine/src/action-templates.ts
rg -n "english_blog_draft" openapi/mvp.yaml packages/db/migrations/0020_content_shadow_foundation.sql
```
**期望**:11 / 0 / 五处齐备且都是四元集合。加一条单测(U2)把三处 TS 枚举做集合相等断言,防止某处偷偷加第五个类型。

### AP5 —— 副作用把 artifact 标成 ready / published(破红线 D)

```bash
rg -n "'ready'|\"ready\"|published|publish" apps/worker/src/content-shadow/ apps/web/src/lib/services/content-shadow.ts
rg -in "publish" packages/flow-shadow/src/                                  # 期望 0
rg -n "setStatusIfRevision|setStatus\(" apps/worker/src/content-shadow/     # 期望 0
```
**期望**:worker 只 `setGeneratedForGenerationRun(..., status:'draft')`;`ready` 只能由现有人工 PATCH 路径产生(`artifact-state.ts:16-17`),Content Shadow 代码里出现 `ready` 字面量即为红旗。E2E 侧(Task 9)另有 `exportRequests == []` 断言。

### AP6 —— search 与 generative 塌缩成共同 volume

```bash
# 冻结元组必须是两个独立字段
rg -n "searchCluster|generativeQueryEntityIds" apps/web/src/lib/services/content-shadow.ts
# 禁止任何把二者合流的表达式
rg -n "\.concat\(|\[\s*\.\.\.\s*(searchCluster|keywordEntityIds)" apps/web/src/lib/services/content-shadow.ts packages/flow-shadow/src/
rg -in "totalVolume|combinedVolume|mergedQueries|allQueries" packages/flow-shadow/src/ apps/worker/src/content-shadow/
```
**期望**:全 0。配 U5 单测:交换 `searchCluster.keywordEntityIds` 与 `generativeQueryEntityIds` 两组 id 后 `content_hash` **必须改变**(证明二者在寻址上不可互换)。

---

## 5. 契约税评估

**结论:Task 5 = 零契约税。** 逐项核实:

| 税目 | Task 5 是否触发 | 证据 |
|---|---|---|
| 新 apiOperation | ❌ | D3 已把两个 op 移到 Task 4(execution-plan 第 100 行的归属被 task4 蓝图 §5 覆盖) |
| 新 asyncOperation | ❌ | 同上 |
| 新表 / 新迁移 | ❌ | 本 Task 全部断言落在 service 层;A5 刻意**不**加 DB 检查(见 OQ5) |
| 新枚举值(ArtifactType / async kind / result_type / queue) | ❌ | 全在 Task 2/4 已落 |
| `scripts/spec-v0.3-lock.json` | ❌ | apiOperations / asyncOperations / tables 计数均不变;**注意仍需刷新被改文件的 sha256**(见下) |
| `verify-implementation.mjs` / authority `verify-spec.mjs` EXPECTED 计数 | ❌ | 无 op/表/枚举变化 |
| **新 ProblemCode** | **不需要,且推荐坚决不加** | openapi `Problem.code` 是 `pattern: '^[A-Z][A-Z0-9_]+$'` 的自由字符串(`openapi/mvp.yaml:1458`),**新增 code 不产生 openapi/lock/verifier 税**;但 `authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md:880` 有一份 422 code 的**叙述性清单**,新增 422 code 需同步该行(文档税)。§2 的全部断言已用现有 code 覆盖 → **保持零税** |

**唯一需要注意的机械动作**:若 `scripts/spec-v0.3-lock.json` 记录了被 Task 5 修改文件的 sha256(`finding-review.ts` / `artifacts.ts` / `actions.ts`),需 `shasum -a 256` 刷新。开工时用
```bash
rg -n "finding-review|artifacts\.ts|repositories/actions" scripts/spec-v0.3-lock.json
```
核实;若无命中则连这一步也不需要。

**如果实现中发现确实需要新 op**(不应发生):立即停下回报主 agent,并按 execution-plan:108 的 7 处同步执行 —— ①`openapi/mvp.yaml` ②`authority/.../openapi.yaml`(字节一致、同 sha256)③`packages/contracts/src/generated/openapi.ts`(`pnpm contracts:generate`)④`scripts/spec-v0.3-lock.json`(计数 + file hash)⑤`scripts/verify-implementation.mjs`(EXPECTED 数组)⑥`authority/.../scripts/verify-spec.mjs`(EXPECTED_*_COUNT)⑦`authority/.../MVP-IMPLEMENTATION-SPEC.md`(operation 表)。**必须同 commit。**

---

## 6. TDD 测试计划

顺序严格 RED → GREEN。每条先写测试、跑挂、再改实现。

### 6.1 单测(vitest,无 DB)

| ID | 文件 | 用例 |
|---|---|---|
| **U1** | `packages/engine/src/action-templates.test.ts`(扩) | `ACTION_TEMPLATES` 恰 11 条;`artifactType==='content_brief'` 的 rule 集合**严格等于** `{SEARCH-DECAY-002, CONTENT-COVERAGE-001, CONTENT-GAP-011, CRO-LANDING-003}`;无任何模板声明 `english_blog_draft` |
| **U2** | `packages/contracts/src/zod/artifacts.test.ts`(扩) | 三处 `ArtifactType`(contracts zod / `@sf/artifacts` types / `@sf/engine`)集合相等,且恰 4 元 |
| **U3** | `apps/web/src/lib/services/__tests__/artifacts-service.test.ts`(扩) | (a) `artifactType:'english_blog_draft'` + 合法 content Action → **422**,且**不产生任何 repo 写调用**;(b) `template_id` 不在注册表 + 任意 artifactType → **422 `ACTION_NOT_EXECUTABLE`**(RED:当前会放行) |
| **U4** | `apps/web/src/lib/services/__tests__/content-shadow.test.ts`(Task 4 已建则扩) | mock repo 驱动 `createContentShadowRun` 断言分支:`count=0`→422 `ACTION_NOT_EXECUTABLE`;`count=2`→503;brief `status='archived'`→422;brief `validation_state='invalid'`→422;brief `current_revision=0`→422;`last_seen_run_id` 漂移→409 + 逐字文案;`rule_id='TECH-HTTP-001'`→422 |
| **U5** | 同上 | `buildContentShadowFrozenInput`:交换 search / generative 两组 id → `content_hash` 必须不同;两组 id 有交集时…(见 OQ9) |
| **U6** | `apps/web/src/lib/services/__tests__/finding-review.test.ts`(新建或扩) | mock 一个 `rule_id='TECH-NOPE-999'` 的 finding row → `reviewProjectFinding(confirmed)` 抛 `ProblemError`(非 TypeError),code 见 OQ1 |

### 6.2 集成测试(需 `DATABASE_URL`)

主文件:**`apps/web/src/lib/services/__tests__/content-opportunity-vertical.integration.test.ts`** —— **严格镜像** `technical-opportunity-vertical.integration.test.ts`(207 行,含注释块风格)。

fixture:`runCommonChain(handle, ctx, "content-vertical")`。已核实:
- `verticalFor`(`full-chain-harness.ts:202-204`)对任何非 `b2c` 前缀的 label 返回 **b2b** fixture;
- b2b golden fixture 触发 `CONTENT-COVERAGE-001` 与 `CRO-LANDING-003`(`full-chain-b2b.integration.test.ts:142-143`);
- `runCommonChain` **只 confirm `TECH-HTTP-001`**(`full-chain-harness.ts:990` 附近),content Finding 保持 `unreviewed` → **本测试独占它的 confirm**。
- 开工时先跑一次 `listProjectFindings` 打印 ruleId 列表核实;若 `CONTENT-COVERAGE-001` 缺席则改用 `CRO-LANDING-003`。

| ID | 用例 | 断言 |
|---|---|---|
| **I1** | 正链:confirm content Finding → `createActionArtifact(content_brief, template)` → `runArtifact` | `action.templateId==='create_priority_content.v1'`;`RULE_OPPORTUNITY_PROJECTION['CONTENT-COVERAGE-001'].artifactType==='content_brief'`(`packages/contracts/src/zod/opportunities.ts:439-447`);`countActionsForFinding===1`,其余 finding 全 0;artifact `status='draft'`、`current_revision===1`、`validation_state==='valid'`、`content_format==='markdown'`;`findLiveByActionType(action,'content_brief')` 唯一 |
| **I2** | **第二次确认反例(红线 B 字面)** | 用新 `baseRevision` 再 confirm 同一 Finding → 返回 `action.id` **相同**;`actions` 表该 `source_finding_id` 行数仍 **1**;`finding_review_events` 出现 **2** 行(revision 1、2);该 Action 的 `execution_artifacts` 仍 **1** 行 content_brief,且 `current_revision` **未变**(证明"确认不铸/不重铸 artifact") |
| **I3** | **dismiss → re-confirm 反例** | 把 Action override 成 `dismissed` → 再 confirm → 返回的 `action.status` 仍 `'dismissed'`;`countActionsForFinding===0`;**若 Task 4 的 `createContentShadowRun` 已可调用** → 422 `ACTION_NOT_EXECUTABLE`,且 `flow_shadow_runs` 零新行 |
| **I4** | **DB 兜底反例** | 直接用 `ActionsRepository.insert` 为同一 Finding 插第二个 Action(同 `template_id`、不同 `action_key`)→ 抛 unique violation(`actions_source_finding_id_template_id_key`),证明 A1 是 **DB 强制** |
| **I5** | **"只靠 DB 不够"的证明** | 把 content_brief 置 `archived` → `findLiveByActionType` 返回 null;`createContentShadowRun` → **422**;**但**用 `FlowShadowRunsRepository.create` 直插同样的冻结元组 → **触发器放行**(0020:152-163 不查 status)。测试用注释写明:此即 A5 必须活在 service 层的原因 |
| **I6** | 跨租户 | 另一 workspace 的 findingId / actionId → **404**,不是 403 |
| **I7** | `english_blog_draft` 经公开 service | `createActionArtifact(..., artifactType:'english_blog_draft')` → 422;`execution_artifacts` 无新行;`async_runs` 无新行 |
| **I8**(OQ3 采纳时) | confirm 的 `last_seen_run_id` TOCTOU | 在 confirm 前推进 Finding 的 `last_seen_run_id`(镜像 `full-chain-b2b.integration.test.ts:440-490` 的 drift 构造)→ confirm 抛 **409 `VERSION_CONFLICT`**,不是 500 |

### 6.3 验证门(Task 5 提交前必须全绿)

```
pnpm verify:spec
pnpm implementation:check
pnpm openapi:lint
pnpm contracts:check            # 必须 no diff(零契约税的机械证明)
pnpm lint && pnpm typecheck
pnpm test                       # 单测
pnpm test:integration           # 需 DATABASE_URL
pnpm db:smoke && pnpm db:migrate:check
pnpm build
```
E2E 不在 Task 5(Task 9)。**若 `contracts:check` 出现 diff,说明不慎产生了契约税 —— 停下回报主 agent。**

---

## 7. 风险与开放问题(需主 agent 裁决)

| # | 问题 | 选项 | **推荐** |
|---|---|---|---|
| **OQ1** | 未注册 `rule_id` 的 Finding 被 confirm 时的错误码(现为裸 `TypeError` → 500,F1) | (a) 422 `VALIDATION_ERROR` (b) 422 `ACTION_NOT_EXECUTABLE` (c) 503 `DEPENDENCY_UNAVAILABLE` | **(c)**。请求本身合法,问题在服务端注册表漂移;5xx 保留告警语义,同时给出干净 problem+json。镜像 `artifacts.ts:306-311` 对完整性缺口用 `DEPENDENCY_UNAVAILABLE` 的既有先例 |
| **OQ2** | dismissed Action + 重新 confirm 的语义(F6) | (a) 保持现状:confirm 返回 dismissed Action,`count=0`,下游 422 (b) confirm 自动把 dismissed 复活成 `candidate` | **(a)**。(b) 会绕过 Action 状态机(`actions-service.ts:19-24` 只允许 `dismissed → planned`),且违反 `actions.ts:9-16` 的显式契约"re-confirm never overwrites human priority/status"。Task 5 只把错误语义定义清楚(A2)+ I3 锁死 |
| **OQ3** | `confirmFinding` 的 `last_seen_run_id` TOCTOU(F3,现为 500) | (a) 纳入 Task 5:事务内 `FindingsRepository.findById` 重读并比对,不一致 → 409 (b) 留给独立 tech-debt 轮 | **(a) 纳入,最小改动**。它影响所有 vertical(Slice 1 遗留),但"上游硬化"正是本 Task 的定义。改动量 ~10 行 + I8 一条测试。若主 agent 认为跨 Slice 风险太大则降级为 (b) 并在 stop gate 如实记录 |
| **OQ4** | A8 的 `english_blog_draft` 拒绝落在哪层 | (a) service 黑名单(零税) (b) 给公开路由一个窄枚举 `OperatorArtifactType`(动 contracts barrel + openapi → 有税) | **(a)**。(b) 会把零契约税的 Task 5 变成有税 Task,且 wire 枚举需保留四元以供 Task 4 的 `getContentShadowRun` 响应复用 |
| **OQ5** | 是否给 `flow_shadow_runs` 加 DB 层的 "brief 非 archived / validation 非 invalid" 检查 | (a) 不加,只在 service(A5) (b) 加 0021 迁移 | **(a)**。加迁移会打破"Task 5 零迁移零税"的定位,且 `archived` 是人工状态机概念、不属于血缘不变式(触发器的既有职责边界)。I5 会把这个取舍钉成可读文档。若主 agent 要 DB 兜底,建议合并进 Task 6 的迁移 |
| **OQ6** | `countActionsForFinding` 的口径是否要改成含 dismissed | (a) 保持排除 dismissed(现状,`actions.ts:270,290`) (b) 改成任意状态计数 | **(a)**。与 `findActiveByFinding` / spec §9.1 review gate 同口径;改口径会连带影响 `technical-opportunity-vertical.integration.test.ts:185-189` 的既有绿测。用 A2 把 `0` 的语义补齐即可 |
| **OQ7** | Task 4 实际代码与本蓝图 §3 边界表冲突时以谁为准 | (a) 已 commit 的 Task 4 代码 (b) 本蓝图 | **(a)**。Task 5 只做 diff 补齐 + 测试;发现冲突立即回报,不擅自重写 Task 4 的产物 |
| **OQ8** | `>1` 个非 dismissed Action(A2)的错误码 | (a) 503 `DEPENDENCY_UNAVAILABLE` (b) 409 `VERSION_CONFLICT` | ~~**(a)**。该状态被 `0001:607` UNIQUE 证明不可达;真出现说明数据破损,不是客户端冲突,不该建议重试~~<br>**2026-07-26 改判为 409 `FINDING_ACTION_ACTIVE`**(实现即此,见 `content-shadow.ts:220-232`)。本行原判据不成立:`UNIQUE (source_finding_id, template_id)` 只保证「一 Finding + 一 template」唯一,当规则集版本把同一 `rule_id` 映到**新的** `template_id` 时,该 Finding 可以合法地在新 template 下再得一个 Action。所以这是**可达的产品状态**,不是数据破损;503 的「稍后重试」是假话——重试永不收敛,需要人来指定哪个 Action 是 canonical,这正是 409 的语义。**本条是蓝图跟随实现,不是实现跟随蓝图。** |
| **OQ9** | 冻结元组里 search / generative 两组 id **有交集**时是否拒绝 | (a) 拒绝(422,强制 invariant 8 的物理分离) (b) 允许(同一 query 文本可以既是 search 又是 generative) | **(b) 允许,但 hash 分槽**。`keyword_entities.query_kind`(`0018:242-244`)是行级 CHECK,同一实体行只可能是其中一种,所以 id 交集本身即数据破损 → 实际应 **(a)**;但这属于 Task 4 的 R4 scope 断言范畴。**推荐**:Task 5 只加 U5 的 hash 敏感性单测,把"交集是否拒绝"回报主 agent 决定归属(倾向 Task 4 补) |

---

## 8. 实现前必核

1. `git log --oneline -3` + `git show <task4-commit> --stat`,确认 Task 4 已落地范围;**本蓝图 §3 的"Task 4 已覆盖"列以实际代码为准**。
2. 以真实文件核实所有行号(本蓝图基于 `4025577`;Task 4 提交后 `finding-review.ts` / `artifacts.ts` 行号不变,但 `content-shadow.ts` 是新文件)。
3. **只读原则**:Task 5 **不得**修改 `packages/db/migrations/`、`openapi/`、`authority/`、`scripts/spec-v0.3-lock.json` 的计数字段。允许修改的文件面(预期):
   - `apps/web/src/lib/services/finding-review.ts`(A9 / A10)
   - `apps/web/src/lib/services/artifacts.ts`(A8)
   - `apps/web/src/lib/services/content-shadow.ts`(A2 / A5 / A6 / A7 —— Task 4 产物,就地增强)
   - `packages/db/src/repositories/actions.ts`(仅在需要时加注释,**不改语义**)
   - 测试文件若干(§6)
4. 严格红线:无真实 CMS/publish 写、无 runtime import 兄弟仓库(`rg -n "gengrowth-flow-mvp" --type ts .` 期望 0)、shadow 只消费已确认 brief 不重铸、search/generative 分离。
5. 跑**完整** CI gate 集(§6.3),不只窄集。`contracts:check` 有 diff = 契约税泄漏 = 停。
