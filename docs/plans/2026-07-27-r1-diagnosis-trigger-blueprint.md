# R1 恢复蓝图:Growth Map 上的诊断触发入口(2026-07-27,v2 —— 经 codex 对抗评审修订)

Owner 裁决(2026-07-27,任务 #12):stop gate §14.8 R1 按「恢复入口」处理。本蓝图是实现
agent 的唯一权威;v2 修订吸收了 codex 第二意见的 6 项 P1 + 8 项 P2(评审存档见本文末尾
「评审记录」)。锚点写法:symbol 优先,行号是近似值,以 symbol 为准。

## 0. 背景(证据锚点)

- stop gate §14.8 R1:产品里没有任何 UI 能触发诊断。`useCreateDiagnosticRun`
  (`apps/web/src/lib/api/hooks-diagnosis.ts`,~:457)全仓唯一 caller 是无人 import 的
  `diagnosis/_diagnosis.tsx`。服务端 `POST /diagnostic-runs` 活着、全测、限流
  20 次/15 分钟(scope `diagnostic_run`,rate-limit 只对**相同 Idempotency-Key 的精确
  重试**不重复计数,`lib/http/rate-limit.ts` ~:98)。
- 首诊没有任何其他触发路径。**按钮语义 = 首跑 + 重跑二合一。**
- 无可读 run 时 Growth Map 服务端返回 **404 NOT_FOUND**(`lib/services/growth-map.ts`
  `getGrowthMapUrlPortfolio` ~:152),不是空 portfolio —— 首诊场景 UI 呈现的是错误态,
  按钮必须在这个状态下仍可用(它挂在 hero,不在 portfolio 分支里)。
- run 终态集合是**四个**:`completed / partial / failed / cancelled`
  (`hooks-diagnosis.ts` `isRunTerminal` ~:290;worker recovery 真的会写 cancelled)。
- 全局 QueryClient:retry 1 次、`refetchOnWindowFocus: false`(`app/providers.tsx`);
  `useProjectRun` 的轮询在 query error 后**停止**(`runPollInterval` 遇 error 返回
  false)—— 错误恢复必须显式做(见 D5)。

## 1. 变更边界(双层 allowlist,负空间写法)

### 1a. N-1 冻结面的定点解冻(growth-map 目录内)

- `_growth-map.tsx`:仅允许 ①新增 import;②hero 右列新增 wrapper(新类
  `styles.heroActions`,flex+gap)把既有 `<Link className={styles.sourceLink}>`
  (`GrowthMapClient` hero 内,~:3334)与新组件并排 —— **sourceLink 子树语义不变**
  (className/children/href 不变;允许因包裹产生的纯缩进/格式变化);③挂载新组件。
  不改其他任何组件函数体。
- `growth-map.module.css`:仅在文件末尾追加本功能新 class 的规则块。**selector 白名单
  约束**:所有新增 selector 必须以本功能新 class 为根,只能命中新 wrapper/新组件拥有的
  节点。禁止:`:global`、`html/body/:root`、裸元素 selector、既有 class(`.hero` /
  `.sourceLink` / `.objectTabs` / `.page` …)出现在任何新 selector(含逗号列表)中、
  重新绑定既有 `--gm-*`。允许新 class 自身的 media query(820px/560px 断点适配)。
- 允许**新增**:`growth-map/_run-diagnosis.tsx`、`growth-map/_run-diagnosis-view-model.ts`、
  `growth-map/_run-diagnosis-view-model.test.ts`(命名可微调,数量与职责不变)。
- 其余 growth-map 文件(`_growth-map-view-model.ts`、历史
  `_growth-map-navigation.ts`〔已于 2026-07-29 由同步 History API 取代〕、
  `_evidence-refs-disclosure.tsx`、`page.tsx`…)一行不改。

### 1b. 整个任务的精确文件 allowlist

`apps/web/src/lib/services/diagnostics.ts`、其对应集成测试文件
(`diagnostics-idempotency.integration.test.ts` 或新增同目录测试)、§1a 的五个文件、
`packages/i18n/src/messages/en.json` + `zh-CN.json`、`e2e/growth-map.mock.spec.ts`
(或新增一个 growth-map run 专属 mock spec)、`e2e/mock-api.ts`(仅当首诊场景需要
可切换 fixture 时,新增开关不改既有行为)、`e2e/real-vertical-chains.spec.ts`。
**最终 `git diff --name-only <base>...HEAD` 必须是该集合的子集;出现其他文件即停。**

### 1c. 视觉证据义务(固定参数,不许自选)

- 条件:Chromium、English deterministic mock、light theme、1440×900 与 390×844、
  同一 locator 的 element screenshot、base = 改动前 HEAD。
- hero 以外区域(provenanceBand、objectTabs、portfolio 首屏)改前/改后 sha256 相等;
  hero 区域 before/after 对照,差异只能是新增控件(sourceLink 位移须具名 + 像素证据)。
- 新组件自身:idle 与 expanded(terminal/error)各一组;390px 下额外跑 document
  overflow 检查与 axe(serious/critical 零违规)。
- 截图文件路径 + sha256 + 复现命令写进 commit message。

## 2. 设计裁决 D1-D9

**D1 gate 与错误恢复(显式 Retry,禁止「刷新页面」作为唯一恢复路径)。**
- POST body 契约 `{ snapshotIds: uuid[1..10], outputLocale }`(zod `.strict()`)。
  必须先拉 `useProjectSnapshots` + `selectLatestSnapshotIds` / `hasCrawlSnapshot`。
- snapshot 三态照抄 `_diagnosis.tsx` 的区分(error ≠ loading ≠ ready):
  - loading → disabled,说明文案;
  - **error → disabled + 错误说明 + `common.retry` 按钮调 `snapshots.refetch()`**
    (retry pending 时控件 disabled);
  - ready 且无 crawl → disabled + needsCrawl 说明 + sources 链接,零 POST。
- context **不预查**(不为此新增 project query;若 hero 作用域内已有现成 project 数据
  则可等价预查,实测后二选一并在 commit message 说明)。服务端 422
  `CONTEXT_INCOMPLETE` 返回后置 **sticky `serverGate="context"`**:纳入 disabled 条件、
  `aria-describedby` 给 context 链接、配显式「重新检查」动作解除 sticky(不许静默
  自动重复 POST)。
- disabled 原因经 `aria-describedby` 指向真实存在的说明节点。
- **性能取舍(已知并接受)**:`useProjectSnapshots` 穷举 cursor chain(上限 100 页)。
  约束:它只阻塞按钮自身,不得阻塞 Growth Map 主体渲染;mock 测试覆盖两页 cursor
  证明完整选择正确且主体先可见。

**D2 提交互斥与幂等语义。**
- 无确认弹窗(先例)。
- hook 每次 attempt 生成新 Idempotency-Key —— 所以组件必须自带**同步 single-flight
  fence**(`submitInFlightRef`:handler 第一行检查并置位,finally 释放);
  `createRun.isPending` 只负责视觉 disabled,不是并发门。
- 一次用户逻辑提交 = 一个 key;本轮不做自动传输重试(mutation 默认即可),手工再点
  是新 attempt。
- e2e:`dblclick`/并发派发断言 `diagnosticRequests` 恰好 1 条;主路径断言
  `Idempotency-Key` header 存在且是 UUID。

**D3 `outputLocale` = `useLocale()` 当前 UI locale,逐字沿用旧语义**
(`_diagnosis.tsx` `workbenchLocale = useLocale()` → `outputLocale: workbenchLocale`)。
不得取 `project.defaultDeliveryLocale`,不得为推断 locale 新增 query。
测试:en UI 断言 `outputLocale === "en"`,zh-CN 下再断言 `"zh-CN"`(防硬编码)。

**D4 闭合状态机(取代散落 boolean;抽为纯 reducer/view-model 配单测)。**

```text
idle
  └─ submit ─> submitting
                  ├─ 202 ──────────────────────> tracking(runId)
                  ├─ 409 + valid current.runId ─> tracking(runId) + runActive notice
                  ├─ 409 current 缺失/无效 ─────> conflictUnknown
                  └─ 422 ──────────────────────> serverGate(context|crawl)
tracking
  ├─ queued/running ──> locked,继续轮询
  ├─ status 读失败 ───> pollError:锁不解除 + runStatusReadError + 显式 Retry
  │                     (调 runQuery.refetch(),pending 时禁并发)
  ├─ completed/partial > terminal:pill 保留、解锁、invalidation 恰好一次
  └─ failed/cancelled ─> terminal:pill 保留、解锁、不触发成功刷新
```

- `trackedRunId` terminal 后**保留**(pill 数据源);`runLocked` 由「未读到终态或
  pollError」推导,**不得**由 `trackedRunId !== null` 推导(否则按钮永久 disabled)。
- 四个终态都解锁;`completed/partial` 每 runId 只 invalidate 一次(reducer 单测钉住)。
- terminal pill 在下一次提交前持续可见;409 接管的 run 到 terminal 后清除 runActive
  notice(不得同屏「正在运行」+「Completed」)。

**D5 终态刷新(修正 v1 的错误 key)。**
成功终态用**前缀失效**:
`queryClient.invalidateQueries({ queryKey: ["growth-map", projectId], refetchType: "active" })`
—— 命中全部 list/detail 后缀(实际后缀是 `urls/keywords/competitors` 与
`url/keyword/competitor`,没有统一 `"detail"`)与 en/zh-CN 两个 locale cache(缓存按
uiLocale 隔离,只失效当前 locale 会让切语言看到旧 run)。另审定并失效:
`["findings", projectId]`、`["snapshots", projectId]`;`["workspace", projectId]` /
`["project", projectId]` 由实现 agent 实测「诊断完成是否改变其投影」后决定,结论写
decisions。统一收进一个 `refreshAfterDiagnosticTerminal(queryClient, projectId)` helper,
配「每 runId 只执行一次」的单测。

**D6 服务端 409 补 `current` 指针(独立 commit,先于 UI)。**
`lib/services/diagnostics.ts` 两处(active 分支 ~:281 与唯一索引冲突分支 ~:469)对齐
`audit-runs.ts` `activeConflict` 的统一形状(`headers.Location` + body
`current: { runId, statusUrl }`)。零契约税(`Problem.current` 是 additionalProperties)。
两处各配集成测试断言 body 指针,变异各杀恰好一条。

**D7 客户端 409 消费(带解析边界)。**
- `ProblemBody.current` 类型只是 `Record<string, unknown>` —— 新增
  `parseDiagnosticRunPointer(current)`(zod safeParse,先例:`_growth-map-view-model.ts`
  ~:500 对另一个 `Problem.current` 的处理):`runId` 必须非空 UUID;`statusUrl` 若消费
  则须是本 project 的 run path。
- valid → 进入 tracking(runActive notice 显示);invalid/缺失/null → `conflictUnknown`:
  显示 runActive 文案 + 触发一次 `["growth-map", projectId]` 失效 + 显式 Retry/Reload
  恢复动作,**不许**按钮直接回到可连点状态(防 UUID 连发撞限流),**绝不**用未验证值
  拼 GET URL。
- e2e 覆盖 valid / missing / null / invalid runId 四况,断言 invalid 下没有
  `/runs/undefined` 之类的请求。
- 其余错误映射:`CRAWL_SNAPSHOT_REQUIRED`→needsCrawl、`CONTEXT_INCOMPLETE`→serverGate
  (D1)、default→common error。

**D8 run 状态可见性与 a11y。**
- 不扩 Growth Map 契约(「上次诊断于 X」留给后续;仓库层已 select `run_completed_at`
  未投影,`packages/db/src/repositories/growth-map.ts` `findLatestReadableRun`)。
- **文案是 session-scoped(刻意接受的限制,不声称识别历史 run)**:组件挂载后未完成过
  tracked run → `runDiagnosis`;任一 tracked run 到 terminal → `rerunDiagnosis`;重新
  挂载恢复 `runDiagnosis`。
- 状态区是**一个稳定容器**:`role="status" aria-live="polite"
  aria-label={t("runStatusLabel")}`,内放 StatusPill(`runState.*`)—— StatusPill 自身
  不带 role(组件契约如此),不得每次 render 重建 live region。
- e2e 按 named status region 断言 Queued/Running→Completed,不按裸文本找。

**D9 i18n:growthMap 命名空间新建 key,en 文案字面保持 diagnosis 原值。**
新增(zh-CN 与 en 行号对齐):`runDiagnosis / rerunDiagnosis / runInProgress /
runNeedsCrawl / runNeedsContext / runRecheckContext / runActive / runError /
runStatusReadError / runStatusLabel / runRetry(如复用 common.retry 则省)`,值复制自
`diagnosis.*`(en "Run diagnosis" / "Re-run diagnosis" 字面不变,real spec 按钮名断言
存活)。不引用 `diagnosis.*`。StatusPill 用既有顶层 `runState.*`。

## 3. 实现清单(TDD:红测先行;测试与被守护功能同 commit)

1. **commit A `fix(api)`**:D6 服务端指针 + 两条集成测试 + 变异记录。
2. **commit B `feat(growth-map)`**:状态机 view-model + 单测(reducer 全分支:四终态、
   pollError、conflictUnknown、once-only invalidation、single-flight)→ 组件 + 挂载 +
   CSS 追加 + i18n 双语 → **mock e2e 全场景**(见 §4 验收矩阵:主路径、首诊、双击、
   409 四况、错误恢复、终态解锁)。变异验证每条断言至少一杀,结果写 commit message。
   变异存活时先问「断言时目标分支挂载了吗」,连跑两遍(stop gate §20)。
3. **commit C `test(e2e)`**:重瞄 `real-vertical-chains.spec.ts` 的
   `runDiagnosisAndConfirmFinding` **整个 helper(~:443-512)**,按 Growth Map 真实 DOM:
   goto `/growth-map` → heading + 按钮 → 触发 → named status region 显示 Completed →
   portfolio 从 404 恢复可读 → 切 `data-detail-state="opportunity-review"`(Confirm 只在
   此面渲染,默认面是只读 audit_evidence)→ 以 `[data-finding-card]`+标题文本定位真实
   Finding(不得拿完成信号冒充 Finding 容器)→ card 内 `<summary>` 的键盘契约
   (EvidenceRefsDisclosure,dialog 名 "Inspect Evidence IDs",非按钮 "View evidence")→
   Confirm → 断言 `Confirmed` + `Open Execution` execution ref(旧 `Action created:`
   断言删除,那是退役 Diagnosis 的 DOM)。只允许改该 helper;若实测发现同文件其他
   helper 也依赖退役 DOM,先停下报告。
   **已知跨任务依赖(如实写进 commit message)**:该 spec 的完整链尾部
   `verifyReportAndExport` 依赖 R3(Results 报告恢复),R1 落地后该 spec 仍会红在
   report 段 —— 本 commit 的验收是「诊断段的断言按新 DOM 重瞄完成且逐段实测通过到
   report 段为止」,整条 spec 转绿属于 R3 之后的收尾轮。

## 4. 验收矩阵(mock e2e + 单测合计覆盖;每行至少一条断言)

| 场景 | 必须断言 |
|---|---|
| snapshots loading | 按钮 disabled;describedby 指向真实说明节点;Growth Map 主体不被阻塞 |
| snapshots error | disabled;有 Retry;Retry 成功后 enabled(两页 cursor 场景一并覆盖) |
| 无 crawl snapshot | disabled;sources 链接;零 POST |
| 首诊(audit/urls 与 detail 先返回真实形状 NOT_FOUND problem) | hero 与按钮仍可见可用;点击→恰好 1 条 POST;run 完成后 fixture 切换为正常;error 态消失、portfolio 出现;pill 保留、按钮 enabled、文案变 rerunDiagnosis |
| 正常 202 | 1 条 POST;Idempotency-Key 为 UUID;snapshotIds 为预期精确集合;outputLocale === UI locale(en 与 zh-CN 各测一次) |
| 快速双击 | 仍恰好 1 条 POST |
| running | named live status region 可见;按钮 locked |
| completed / partial | pill 保留;按钮 enabled;invalidation 恰好一次(audit/urls 第二次请求发生) |
| failed / cancelled | 对应 pill;解锁;不触发成功刷新(无第二次 audit/urls 请求) |
| poll read error | 锁不解除;Retry 出现;Retry 后恢复 tracking 至 completed |
| 409 valid pointer | runActive notice;只轮询该 pointer;terminal 后刷新、解锁、notice 清除 |
| 409 missing/null/invalid | 无畸形 GET;按钮不可连点;显式恢复动作存在 |
| 390px + terminal/error 文案 | 无横向 overflow;axe serious/critical 零违规 |

## 5. 门(最后一次改动之后跑;`pnpm -s` 吞输出,判据只看退出码)

**本地硬门**:`pnpm lint` / `pnpm typecheck`(另进 workspace 确认 `tsconfig.e2e.json`)/
`pnpm build` / `pnpm test` / **`pnpm test:integration`**(disposable DB,命名
`signalframe_codex_*`,跑完 drop;D6 的 targeted 集成测试必须在其中)/ 完整
`pnpm test:e2e:mock`(基线 81/0 + 新增全绿)/ `pnpm verify:spec` /
`pnpm verify:spec:test` / `pnpm implementation:check` / `pnpm contracts:check` /
`pnpm openapi:lint` / `pnpm secrets:scan`。
**real e2e**:commit C 的重瞄以「逐段实测到 report 段」为验收(§3);完整
`test:e2e:real` 全绿是收尾轮(R3 之后)的硬门,不在本轮宣称。
**契约**:零 OpenAPI 变更、零迁移、计数不变(49/9/44/11);需要动即停下报告。
**Prettier hook**:注意 diff 噪声,必要时走 Bash 写入。

## 6. 红线

- 变更文件必须是 §1b allowlist 子集;overview/sources 一行不碰。
- 既有测试变红:停下报告,不许改既有测试(commit C 点名的 helper 除外)。
- 不动版本常量、不加迁移、不动 authority 快照。
- commit message 不写没做过的验证。

## 评审记录

v1 → v2:codex 第二意见(2026-07-27)确认 6 P1 + 8 P2,全部采纳:real helper 重瞄范围
扩至整个函数并按 Growth Map 真实 DOM 写明步骤;allowlist 重写为双层负空间(修复
「禁止自己要求的新文件」的自相矛盾);snapshot/status 读失败补显式 Retry;状态机闭合
(cancelled、terminal 解锁、pill 保留、once-only invalidation);门集补 integration +
verify 族并明确 real 的分轮验收;新增首诊 mock 场景;invalidation 改前缀失效(v1 的
`"detail"` key 不存在)+ 跨 locale;single-flight fence;`current` 指针 zod 解析边界 +
conflictUnknown;sticky serverGate 解决 context 矛盾;Run/Re-run 明确 session-scoped;
live region 稳定容器;CSS selector 白名单;视觉证据参数固定;snapshots cursor chain
性能取舍具名。
