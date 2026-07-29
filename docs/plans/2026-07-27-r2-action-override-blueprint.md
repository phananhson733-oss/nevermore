# R2 恢复蓝图:Execution 上的 Action 覆盖编辑(2026-07-27,v2 —— 经 codex 对抗评审修订)

Owner 裁决(任务 #12):stop gate §14.8 R2 按「恢复入口」处理。本蓝图是实现 agent 的唯一
权威。v2 吸收 codex 评审的 5 P1 + 6 P2(末尾「评审记录」)。锚点 symbol 优先,行号近似。

## 0. 背景(证据锚点,已核验)

- Execution 屏真实实现 = `studio/_studio.tsx`(~3073 行);`execution/_execution.tsx`
  只是组合层。`/plan` `/studio` 都 redirect 到 `/execution`。
- 服务端全活全测:`PATCH /actions/{actionId}`、状态机 `ACTION_STATUS_TRANSITIONS`
  (`actions-service.ts` ~:16:candidate→planned|dismissed; planned→in_progress|blocked|
  dismissed; in_progress→done; blocked→in_progress; done→planned; dismissed→planned)、
  `action_override_audit` append-only。body:`baseRevision` 必填、`reason` trim 3..1000
  必填、status/priorityBand/roadmapLane 至少一个、`note` ≤4000 可选、`.strict()`。
- ⚠️ 非法转换与陈旧 revision **共用 409 `VERSION_CONFLICT`**(`actions-service.ts`
  ~:98 与 ~:101)——见 D5 状态机。
- 队列行是 **Artifact** 非 Action(多对一);`selectedAction` 由
  `actionById.get(selected.actionId)` 派生,rail 是**单实例**(`_studio.tsx`
  `<EvidenceRail artifact={selected} action={selectedAction}/>` ~:3069)。
- 桌面 rail 仅 **238px** 宽且 `overflow: hidden`(`studio.module.css` ~:104 与 ~:213);
  Plan 的 overrideGrid 是三列 —— **不能整段塞进 rail**(v1 的 D1 已废,见 D1)。
- `useProjectActions` 是 infinite query(每页 ≤100);`selectedAction` 只查已加载页;
  execution deep-link 命中 artifact 不要求其 action 已加载 —— 跨页时 action undefined。
- `useUpdateAction`(`hooks-plan.ts` ~:109)onSuccess invalidate `["actions", projectId]`,
  与 `hooks-studio.ts` 的 `useProjectActions` key 一致(已核验)。
- mock 的 `GET /actions` 返回**不可变**单个 planned action(`mock-api.ts` ~:268/:590),
  PATCH `/actions/{id}` 路由不存在 —— 装置要新建且必须是 **mutable**(D7)。

## 1. 变更边界

### 1a. 精确文件 allowlist(最终每个 commit 用 `git show --name-only --format= <sha>`
自查为该集合子集;**不许**用整个脏 worktree 的 `git diff` 当证据 —— 同 worktree 可能有
其他任务的未提交产物)

```text
apps/web/src/app/p/[projectId]/plan/_action-status-transitions.ts        移动(删)
apps/web/src/app/p/[projectId]/plan/_plan-status.test.ts                 移动(删)
apps/web/src/app/p/[projectId]/plan/_plan.tsx                            仅 import 行
apps/web/src/app/p/[projectId]/_action-status-transitions.ts             新增(移动目标)
apps/web/src/app/p/[projectId]/_plan-status.test.ts                      新增(移动目标)
apps/web/src/app/p/[projectId]/studio/_studio.tsx
apps/web/src/app/p/[projectId]/studio/_action-override.tsx               新增
apps/web/src/app/p/[projectId]/studio/_action-override-view-model.ts     新增
apps/web/src/app/p/[projectId]/studio/_action-override-view-model.test.ts 新增
apps/web/src/app/p/[projectId]/studio/studio.module.css
packages/i18n/src/messages/en.json
packages/i18n/src/messages/zh-CN.json
e2e/mock-api.ts
e2e/action-override.mock.spec.ts                                         新增
# 已于 2026-07-29 退役：不得重采 authenticated App 快照；
# 客户视觉权威仅为 docs/artifact-src/ 及其确定性生成物。
```

overview / growth-map / sources 一行不碰;服务端零改动;R1 已落地的新文件不碰。

## 2. 设计裁决 D1-D10

**D1 挂载形态:rail 触发器 + dialog。**
EvidenceRail 只承担:①既有 lane/priority badge 行**追加一个 status badge**
(`actionStatus.*`,唯一允许的既有 JSX 行内改动);②「Adjust action」触发器
(`aria-haspopup="dialog"`)。完整表单放**dialog**(以 `action.id` 为 identity),复刻
本仓既有模态先例的 a11y 契约(`aria-modal`、focus trap、Escape 关、焦点归还触发器;
参考 product-profile 模态与 growth-map 模态键盘契约那轮的做法)。**禁止**把三列
overrideGrid 塞进 238px rail。dialog 内表单单列布局即可(不必保留三列)。

**D2 表单逻辑移植 `OverrideForm`(`_plan.tsx` ~:194-382)+ `PlanSelect`(~:159-178),
布局按 dialog 单列重排,逻辑不重新发明**:三个原生 `<select>`(「保持不变 — {当前值}」
哨兵)、只把真实变化字段进 body、全空提示 noChange、reason 本地校验 trim ≥3 **且
`maxLength={1000}`**、note `maxLength={4000}`(契约上界补齐 UX;2/3/1000/1001 与
4000/4001 边界进单测,超界不发 PATCH)。CSS 从 `plan.module.css` 按 **symbol 清单**复制
到 `studio.module.css`:`overrideForm overrideHead overrideTitle overrideDesc
overrideGrid(改单列) overrideKept overrideError overrideActions sectionKicker
selectInvalid`;`select` 类 studio 已有,复用不复制。颜色一律 `var(--sf-*)`。

**D3 编辑 identity 与脏状态。**
- identity = `{projectId, action.id}`;dialog 内容组件必须 `key={action.id}`,任何
  本地 state 不得跨 Action 存活。
- dirty(reason/note/任一选择非哨兵)时:dialog 的模态性天然阻止底层 selection 变化;
  Escape/关闭按钮在 dirty 时先走**丢弃确认**(照 product-profile 模态的 discard
  confirm 先例);浏览器返回/刷新守卫复用共享 `_unsaved-navigation-guard.ts`
  (9b144c3 抽出的,Studio 已在用;`confirmLinkClick` 模态场景不传 —— 该文件注释已
  写明原因)。
- e2e:A 上填 reason → 尝试关闭 → 取消保留;确认丢弃 → 打开 B → 表单空、keep label
  是 B 的值;提交 B 的 PATCH 不含 A 的任何值。

**D4 状态图共享与防漂移。**
`_action-status-transitions.ts` 移到 `p/[projectId]/` 共享层(先例:`_view-model.ts`),
两处 import 更新。下拉 options 只渲染 `allowedActionStatusTargets(current)`,提交前二次
校验。**新增 parity test**:遍历全部 `current × target` 断言客户端
`allowedActionStatusTargets` 与服务端 `isAllowedActionStatusTransition` 逐对一致
(两份真相的最低防漂移标准;不把 map 合并成共享模块 —— 那是服务端改动,超范围)。

**D5 提交与 409 闭合状态机(抽 view-model 配单测)。**

```text
open(action=A, baseRevision=R)
  └─ submit(single-flight fence,handler 首行同步置位) ─> submitting
       ├─ 200(updated) ─> 先把成功响应写入 ["actions", projectId] cache(setQueryData),
       │                  再后台 invalidate;关闭 dialog 并清空;badge/keep label 用新值
       ├─ 409 ─> conflictRefreshing(禁再次 PATCH)─ refetch actions:
       │    ├─ 成功且 newRevision !== R ─> staleConflict:更新 baseRevision/keep label,
       │    │    保留 reason/note;status 选择若对新 current 不再合法则清空;
       │    │    priority/lane 若已等于新 current 则清空;conflict 文案 + ProblemNotice
       │    ├─ 成功且 newRevision === R ─> transitionConflict:清空 status 选择,
       │    │    明示「该转换当前不允许」,必须重新选值才能提交(防永久 409 循环)
       │    └─ 失败 ─> conflictRefreshError:保持锁定,仅提供 Retry refresh
       └─ 其他 ApiError ─> 错误显示 + 解锁
```

ProblemNotice 真实 props:`message` 必填 ——
`<ProblemNotice error={caught} message={t("studio.override.conflict")}
onRetry={conflictRefreshError ? retry : undefined} compact/>`,外层不再重复渲染
conflict `<p>`(防读屏重复播报)。双击:e2e `dblclick` 断言恰好 1 条 PATCH。

**D6 i18n:`studio.override.*` 子命名空间新建,值复制自 `plan.*` 并补漏**:
`override hideAdjustment overrideTitle overrideKicker overrideDescription overrideKept
newStatus newPriority newLane keepUnchanged reason reasonHelp reasonPlaceholder
reasonRequired reasonTooLong noteTooLong noChange conflict conflictTransition
conflictRefreshFailed applyOverride applying note noteOptional notePlaceholder`。
改写含 plan 语义的:`conflict`("…The queue has been refreshed…"/「…队列已刷新…」)、
`override`("Adjust action"/「调整行动」)。en 与 zh-CN 行号对齐。选项文案用既有顶层
`actionStatus.* / priorityBand.* / lane.*`。不引用 `plan.*`。

**D7 mock 装置必须 mutable。**
`e2e/mock-api.ts` 新增 `PATCH {BASE}/actions/{id}`:维护 `state.currentAction`,成功
PATCH 应用变更且 revision+1,**后续 GET /actions 返回更新值**;stale-409 开关:返回
409 前先把 `currentAction` bump 到新 revision(模拟别处修改);illegal-409 开关:
revision 不变返回 409。`state.actionPatchRequests` 记录器。断言 UI badge / keep label /
下一次请求的 `baseRevision`,**不只数请求次数**。

**D8 跨页 Action 可达性。**
`selected !== null && selectedAction === undefined && actionsQuery.hasNextPage` 时自动
`fetchNextPage`(bounded,沿用既有 cursor 上限),直到找到 / 页尽 / 上限。期间 rail
显示 linked-action loading;分页失败给 retry;页尽未找到显示 scoped unavailable。
e2e:两页 actions fixture(artifact 第一页、action 第二页)断言自动分页后 override
可用。

**D9 覆盖缺口如实声明(不修)。** 覆盖模型按三维写:artifact 是否存在 × action 是否
已加载 × 是否 dismissed。residual 写法:「有可选 artifact 且 action 已加载的六种状态
全部可编辑(D8 把 "已加载" 扩到自动分页);无 artifact 的 Action 无直接入口 —— 非
dismissed 的在 ActionPicker 可见但须先生成 artifact,dismissed 且无 artifact 的在
Execution 不可见」。用多 Action fixture 实证,不从单 planned fixture 推断。不给
ActionPicker 加编辑入口(范围蔓延)。

**D10 视觉基线。** rail 新增 badge + 触发器会改变 canonical studio 截图(如果
canonical 视觉屏含 studio/execution)。实现 agent 先实测哪些 baseline 受影响:受影响
则 darwin 本机重采;linux 用 playwright 官方 docker image 重采(先探测 docker 可用性)。
**docker 不可用且 baseline 受影响 → 标 BLOCKED 停下报告,不许以「CI 待采」交付。**
新组件自身 idle/dialog-open 两态截图(1440×900 与 390×844)+ 390px overflow 检查 +
axe(serious/critical 零违规)进 mock spec。

## 3. 实现清单(TDD;测试与被守护功能同 commit)

1. `refactor(action-status)`:D4 移动 + import + 测试跟移 + parity test。
2. `feat(execution) 状态控制器`:view-model 纯函数 + 单测先行(changes 构造、哨兵
   过滤、reason/note 边界、D5 全分支、single-flight、identity reset)。
3. `feat(execution) rail 触发器 + dialog`:组件、挂载、D7 装置、i18n、CSS、
   `action-override.mock.spec.ts` 全场景(§4)。变异验证每条断言至少一杀,写 commit
   message(存活时先问「断言时目标分支挂载了吗」,连跑两遍)。
4. `test(execution) 响应式与视觉`:三视口可达性、跨页 fixture、受影响 baseline 重采。

## 4. 验收矩阵(mock e2e + 单测合计;每行至少一条断言)

| 场景 | 必须断言 |
|---|---|
| 六状态 options | 每个 current 的下拉 = allowedActionStatusTargets + 哨兵,恰好 |
| status-only / priority-only / lane-only / 组合 | body 只含变化字段 + baseRevision + reason |
| reason 2/3/1000/1001;note 4000/4001 | 边界内发、边界外不发 + 文案 |
| no-change | 不发 PATCH + noChange 文案 |
| 双击 | 恰好 1 条 PATCH |
| 成功 | dialog 关闭;badge/keep label/revision 用**成功响应**更新(含后台 refetch 失败时) |
| A dirty → 切换/关闭 | 取消保留 A;确认后 B 表单干净、keep label 是 B |
| 409 stale(mock 先 bump) | staleConflict 行为:baseRevision 更新、reason 保留、非法选择清空 |
| 409 illegal(revision 不变) | transitionConflict 文案;必须重选才能再提交;无循环 |
| 409 后 refetch 失败 | 锁定 + Retry refresh;Retry 成功恢复 |
| 跨页 action | 自动分页后入口可用;分页失败有 retry |
| 三视口(1440/1280 断点/390) | dialog 全部控件可见、可聚焦、可提交;390 无横向 overflow;axe 零 serious/critical |

## 5. 门(最后一次改动之后跑;`pnpm -s` 只看退出码)

`pnpm verify:spec` / `verify:spec:test` / `implementation:check` / `contracts:check` /
`openapi:lint` / `secrets:scan` / `lint` / `typecheck`(+ workspace 内单独跑
`tsconfig.e2e.json`)/ `build` / `pnpm test` / `pnpm test:integration`(disposable DB
`signalframe_codex_*`,跑完 drop;本任务零服务端改动,integration 是回归确认)/ 完整
`pnpm test:e2e:mock`(基线 81/0 + 新增全绿)。real 套件:受影响 baseline 按 D10;完整
real 全绿属收尾轮。契约:零 OpenAPI 变更、零迁移、计数不变;需要动即停。Prettier hook
注意 diff 噪声。

## 6. 红线

- 变更文件必须是 §1a allowlist 子集(per-commit 自查)。
- 既有测试变红:停下报告(D4 纯移动除外)。
- 不动服务端、不动契约、不动版本常量。
- commit message 不写没做过的验证。

## 评审记录

v1 → v2:codex 第二意见确认并已采纳 —— 238px rail 装不下三列表单(改 rail 触发器 +
dialog);单实例 rail 的跨 Action state 串号(identity=action.id + key + dirty 确认);
409 双语义未闭合会永久循环(D5 状态机 + mutable mock);跨页 action 不可达(D8 自动
分页);门集缺 verify 族/integration/visual(§5);双击竞态(single-flight + 先写
cache);`overrideKicker` key 与 `overrideTitle/sectionKicker` CSS 漏项(D2/D6);
ProblemNotice `message` 必填(D5);D8 覆盖模型改为三维(D9);reason/note 契约上界
UX(D2);parity test 防状态图漂移(D4);allowlist 精确化 + per-commit 检查(§1a)。
